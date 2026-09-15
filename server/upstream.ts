import {
  createHash,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
  type KeyObject,
} from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createLocalJWKSet, EncryptJWT, jwtDecrypt, jwtVerify } from "jose";
import { z } from "zod";
import {
  authMethodSchema,
  clientAuthentication,
  createClientResolver,
  type ClientOptions,
  type UpstreamClient,
} from "./upstream-client.ts";
import {
  diagnosticFor,
  callbackFields,
  type CallbackContext,
  SignInError,
  signInStep,
  type SignInDiagnostic,
  type SignInStage,
} from "./oidc-errors.ts";

export const DEFAULT_UPSTREAM_ISSUER = "https://app.openworklabs.com/api/auth";
export const ORG_CLAIM = "https://app.openworklabs.com/org_id";
export const CALLBACK_PATH = "/oauth/upstream/callback";
const TTL = 300;
const RESPONSE_LIMIT = 64 * 1024;
const STATE_LIMIT = 8192;
const opaque = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
export const boundedClaim = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .refine(
      (value) =>
        value.trim().length > 0 && !/[\u0000-\u001f\u007f]/.test(value),
    );
export const realIdentitySchema = z.object({
  identityMode: z.literal("openwork"),
  sub: boundedClaim(256),
  name: boundedClaim(256),
  email: boundedClaim(320),
  identity_issuer: boundedClaim(2048),
  org_id: boundedClaim(256).nullable().default(null),
});
export type OpenWorkIdentity = z.infer<typeof realIdentitySchema>;
const downstreamSchema = z
  .object({
    client_id: boundedClaim(512),
    redirect_uri: boundedClaim(2048),
    resource: boundedClaim(2048),
    code_challenge: opaque,
    state: z.string().max(1024).optional(),
  })
  .strict();
export type DownstreamRequest = z.infer<typeof downstreamSchema>;
const transactionSchema = z.object({
  purpose: z.literal("oidc-transaction-v2"),
  clientId: boundedClaim(512),
  authMethod: authMethodSchema,
  redirectUri: boundedClaim(2048),
  browserHash: z.string().regex(/^[0-9a-f]{64}$/),
  nonce: opaque,
  verifier: opaque,
  downstream: downstreamSchema,
});
export type UpstreamOptions = ClientOptions & {
  diagnostics?: (value: SignInDiagnostic) => void;
  logCallbackSuccess?: boolean;
};
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid upstream response");
  return Object.fromEntries(Object.entries(value));
}
function equal(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
export function upstreamIssuer(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new SignInError("configuration");
  }
  const local =
    /^http:\/\/127\.0\.0\.1(?::\d+)?(?:\/|$)/.test(value) &&
    url.hostname === "127.0.0.1";
  if (
    (url.protocol !== "https:" && !local) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    /[\s\\]/.test(value) ||
    value.endsWith("/") ||
    value !== url.origin + (url.pathname === "/" ? "" : url.pathname)
  )
    throw new SignInError("configuration");
  return url;
}
export function createUpstream(
  appIssuer: string,
  privateKey: KeyObject,
  configuredIssuer = DEFAULT_UPSTREAM_ISSUER,
  options: UpstreamOptions = {},
) {
  const upstream = upstreamIssuer(configuredIssuer);
  const callback = `${appIssuer}${CALLBACK_PATH}`;
  const secure = new URL(appIssuer).protocol === "https:";
  const cookieName = secure
    ? "__Host-openwork-binding"
    : "openwork-local-binding";
  const key = new Uint8Array(
    hkdfSync(
      "sha256",
      privateKey.export({ type: "pkcs8", format: "der" }),
      Buffer.from(appIssuer),
      Buffer.from(`employee-home-oidc-state-v2\0${configuredIssuer}`),
      32,
    ),
  );
  const clients = createClientResolver(
    configuredIssuer,
    callback,
    privateKey,
    options,
  );
  const digest = (value: string) =>
    createHash("sha256").update(value).digest("hex");
  function endpoint(value: unknown): string {
    const raw = boundedClaim(2048).parse(value);
    const url = new URL(raw);
    if (
      url.origin !== upstream.origin ||
      url.username ||
      url.password ||
      url.hash ||
      /[\s\\]/.test(raw) ||
      !url.pathname.startsWith(
        `${upstream.pathname === "/" ? "" : upstream.pathname}/`,
      )
    )
      throw new Error("Untrusted upstream endpoint");
    return url.href;
  }
  async function request(
    stage: SignInStage,
    url: string,
    init: RequestInit = {},
  ): Promise<Record<string, unknown>> {
    return signInStep(stage, async () => {
      const response = await fetch(endpoint(url), {
        ...init,
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
        headers: { Accept: "application/json", ...init.headers },
      });
      if (
        !/^application\/(?:[a-z0-9.+-]*\+)?json\b/i.test(
          response.headers.get("content-type") ?? "",
        )
      ) {
        await response.body?.cancel();
        throw new SignInError(stage, undefined, undefined, response.status);
      }
      const length = response.headers.get("content-length");
      if (
        length &&
        (!/^\d+$/.test(length) || Number(length) > RESPONSE_LIMIT)
      ) {
        await response.body?.cancel();
        throw new SignInError(stage, undefined, undefined, response.status);
      }
      if (!response.body)
        throw new SignInError(stage, undefined, undefined, response.status);
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) break;
          size += chunk.value.byteLength;
          if (size > RESPONSE_LIMIT) {
            await reader.cancel();
            throw new SignInError(stage);
          }
          chunks.push(chunk.value);
        }
      } finally {
        reader.releaseLock();
      }
      const data = record(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      if (!response.ok || data.error !== undefined)
        throw new SignInError(
          stage,
          data.error,
          data.error_description,
          response.status,
        );
      return data;
    });
  }
  async function discover() {
    return signInStep("discovery", async () => {
      const data = await request(
        "discovery",
        `${configuredIssuer}/.well-known/openid-configuration`,
      );
      if (
        data.issuer !== configuredIssuer ||
        !Array.isArray(data.code_challenge_methods_supported) ||
        !data.code_challenge_methods_supported.includes("S256") ||
        !Array.isArray(data.token_endpoint_auth_methods_supported)
      )
        throw new SignInError("discovery");
      const authMethods = z
        .array(authMethodSchema)
        .min(1)
        .parse(
          data.token_endpoint_auth_methods_supported.filter(
            (value: unknown) => authMethodSchema.safeParse(value).success,
          ),
        );
      const advertised = data.id_token_signing_alg_values_supported;
      const algorithms = ["EdDSA", "RS256", "ES256", "PS256"].filter(
        (alg) => Array.isArray(advertised) && advertised.includes(alg),
      );
      if (!algorithms.length) throw new SignInError("discovery");
      return {
        authorization: endpoint(data.authorization_endpoint),
        token: endpoint(data.token_endpoint),
        registration:
          data.registration_endpoint === undefined
            ? undefined
            : endpoint(data.registration_endpoint),
        jwks: endpoint(data.jwks_uri),
        userinfo: endpoint(data.userinfo_endpoint),
        algorithms,
        authMethods,
      };
    });
  }
  let discovery: ReturnType<typeof discover> | undefined;
  const metadata = () => (discovery ??= discover());
  async function register(): Promise<UpstreamClient> {
    return signInStep("registration-create", async () => {
      const info = await metadata();
      if (!info.authMethods.includes("none"))
        throw new SignInError("configuration");
      if (!info.registration) throw new SignInError("registration-create");
      const data = await request("registration-create", info.registration, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_name: "Employee Home identity bridge",
          redirect_uris: [callback],
          token_endpoint_auth_method: "none",
          response_types: ["code"],
          grant_types: ["authorization_code"],
          scope: "openid profile email",
          application_type: "web",
        }),
      });
      if (
        data.token_endpoint_auth_method !== "none" ||
        !Array.isArray(data.redirect_uris) ||
        data.redirect_uris.length !== 1 ||
        data.redirect_uris[0] !== callback
      )
        throw new SignInError("registration-binding");
      return {
        clientId: boundedClaim(512).parse(data.client_id),
        authMethod: "none",
        issuer: configuredIssuer,
        redirectUri: callback,
      };
    });
  }
  function cookie(res: ServerResponse, value: string, age: number) {
    res.setHeader(
      "Set-Cookie",
      `${cookieName}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${secure ? "; Secure" : ""}`,
    );
  }
  function bindingCookies(req: IncomingMessage) {
    return (req.headers.cookie ?? "")
      .split(";")
      .map((entry) => entry.trim())
      .filter((entry) => entry.split("=", 1)[0]?.trim() === cookieName);
  }
  function callbackContext(req: IncomingMessage): CallbackContext {
    const cookiePresent = bindingCookies(req).length > 0;
    return { cookiePresent, stateMatch: false, redirectUriMatches: false };
  }
  function emit(diagnostic: SignInDiagnostic, success = false) {
    try {
      if (options.diagnostics) options.diagnostics(diagnostic);
      else
        console.error(
          JSON.stringify({
            event: success ? "oidc-callback-complete" : "oidc-sign-in-failed",
            ...diagnostic,
          }),
        );
    } catch {}
  }
  function report(
    error: unknown,
    fallback: SignInStage,
    context?: CallbackContext,
  ) {
    emit({ ...diagnosticFor(error, fallback), ...callbackFields(context) });
  }
  function success(context?: CallbackContext) {
    if (options.logCallbackSuccess === false) return;
    emit(
      {
        stage: "callback-complete",
        error: "none",
        error_description: "none",
        ...callbackFields(context),
      },
      true,
    );
  }
  function failure(
    res: ServerResponse,
    error: unknown,
    fallback: SignInStage,
    context?: CallbackContext,
  ) {
    cookie(res, "", 0);
    report(error, fallback, context);
    res.statusCode = 400;
    res.removeHeader("Location");
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    );
    res.end(
      `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Sign-in expired</title></head><body><main><h1>Sign-in expired, try again</h1><p>Stage: ${diagnosticFor(error, fallback).stage}</p><p>Return to your app connection and choose Connect to start a new sign-in. This page will not retry automatically.</p></main></body></html>`,
    );
  }
  async function begin(res: ServerResponse, downstream: DownstreamRequest) {
    const validated = await signInStep("authorization-start", () =>
      downstreamSchema.parse(downstream),
    );
    const client = await clients.resolve(true, register);
    const info = await metadata();
    if (!info.authMethods.includes(client.authMethod))
      throw new SignInError("configuration");
    const binding = randomBytes(32).toString("base64url");
    const nonce = randomBytes(32).toString("base64url");
    const verifier = randomBytes(32).toString("base64url");
    const state = await new EncryptJWT({
      purpose: "oidc-transaction-v2",
      clientId: client.clientId,
      authMethod: client.authMethod,
      redirectUri: client.redirectUri,
      browserHash: digest(binding),
      nonce,
      verifier,
      downstream: validated,
    })
      .setProtectedHeader({ alg: "dir", enc: "A256GCM", typ: "oidc-state+jwt" })
      .setIssuer(appIssuer)
      .setAudience(callback)
      .setIssuedAt()
      .setExpirationTime(`${TTL}s`)
      .encrypt(key);
    if (Buffer.byteLength(state) > STATE_LIMIT)
      throw new SignInError("authorization-start");
    const url = new URL(info.authorization);
    url.search = new URLSearchParams({
      client_id: client.clientId,
      redirect_uri: client.redirectUri,
      response_type: "code",
      scope: "openid profile email",
      state,
      nonce,
      code_challenge: createHash("sha256").update(verifier).digest("base64url"),
      code_challenge_method: "S256",
    }).toString();
    if (Buffer.byteLength(url.href) > 16384)
      throw new SignInError("authorization-start");
    cookie(res, binding, TTL);
    res.statusCode = 302;
    res.setHeader("Location", url.href);
    res.end();
  }
  async function complete(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
    context: CallbackContext = callbackContext(req),
  ): Promise<{ downstream: DownstreamRequest; identity: OpenWorkIdentity }> {
    cookie(res, "", 0);
    const params = url.searchParams;
    await signInStep("callback-parameters", () => {
      for (const name of new Set(params.keys()))
        if (params.getAll(name).length !== 1)
          throw new SignInError("callback-parameters");
      if (params.has("iss") && params.get("iss") !== configuredIssuer)
        throw new SignInError("callback-parameters");
    });
    const tx = await signInStep("state-decrypt", async () => {
      const encrypted = boundedClaim(STATE_LIMIT).parse(params.get("state"));
      const { payload } = await jwtDecrypt(encrypted, key, {
        issuer: appIssuer,
        audience: callback,
        keyManagementAlgorithms: ["dir"],
        contentEncryptionAlgorithms: ["A256GCM"],
        typ: "oidc-state+jwt",
        requiredClaims: ["iat", "exp"],
        maxTokenAge: TTL,
      });
      if (
        typeof payload.exp !== "number" ||
        typeof payload.iat !== "number" ||
        !Number.isSafeInteger(payload.iat) ||
        !Number.isSafeInteger(payload.exp) ||
        payload.exp <= payload.iat ||
        payload.exp - payload.iat > TTL ||
        payload.aud !== callback
      )
        throw new SignInError("state-decrypt");
      return transactionSchema.parse(payload);
    });
    context.stateMatch = true;
    await signInStep("browser-binding", () => {
      if (Buffer.byteLength(req.headers.cookie ?? "") > 8192)
        throw new SignInError("browser-binding");
      const matches = bindingCookies(req);
      if (matches.length === 0) return;
      context.cookieMatch = false;
      if (matches.length !== 1) throw new SignInError("browser-binding");
      const entry = matches[0];
      if (!entry || !entry.includes("="))
        throw new SignInError("browser-binding");
      const binding = opaque.parse(entry.slice(entry.indexOf("=") + 1));
      context.cookieMatch = equal(digest(binding), tx.browserHash);
      if (!context.cookieMatch) throw new SignInError("browser-binding");
    });
    if (params.has("error"))
      throw new SignInError(
        "upstream-authorization",
        params.get("error"),
        params.get("error_description"),
      );
    const code = await signInStep("callback-parameters", () =>
      boundedClaim(8192).parse(params.get("code")),
    );
    const client = await clients.resolve(false, register);
    context.clientIdUsed = digest(client.clientId);
    context.redirectUriUsed = digest(client.redirectUri);
    context.redirectUriMatches =
      client.redirectUri === tx.redirectUri && tx.redirectUri === callback;
    if (
      !equal(client.clientId, tx.clientId) ||
      client.redirectUri !== tx.redirectUri ||
      tx.redirectUri !== callback ||
      client.authMethod !== tx.authMethod
    )
      throw new SignInError("registration-binding");
    const info = await metadata();
    if (!info.authMethods.includes(client.authMethod))
      throw new SignInError("configuration");
    const auth = clientAuthentication(client);
    const tokens = await request("token-exchange", info.token, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        ...auth.headers,
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: client.redirectUri,
        code_verifier: tx.verifier,
        ...auth.fields,
      }).toString(),
    });
    const tokenPair = await signInStep("id-token-response", () => {
      if (
        typeof tokens.token_type !== "string" ||
        tokens.token_type.toLowerCase() !== "bearer"
      )
        throw new SignInError("id-token-response");
      return {
        idToken: boundedClaim(16384).parse(tokens.id_token),
        accessToken: boundedClaim(16384).parse(tokens.access_token),
      };
    });
    const jwks = await request("jwks", info.jwks);
    const keySet = await signInStep("jwks", () => {
      if (
        !Array.isArray(jwks.keys) ||
        jwks.keys.length === 0 ||
        jwks.keys.length > 20
      )
        throw new SignInError("jwks");
      const keys = jwks.keys.map((value: unknown) => {
        const item = record(value);
        const kty = boundedClaim(8).parse(item.kty);
        if (!["OKP", "RSA", "EC"].includes(kty) || "d" in item || "k" in item)
          throw new SignInError("jwks");
        return { ...item, kty };
      });
      return createLocalJWKSet({ keys });
    });
    const claims = await signInStep("id-token-verification", async () => {
      const verified = await jwtVerify(tokenPair.idToken, keySet, {
        issuer: configuredIssuer,
        audience: client.clientId,
        algorithms: info.algorithms,
        requiredClaims: ["iss", "aud", "sub", "exp", "iat"],
        maxTokenAge: 600,
        clockTolerance: 5,
      });
      if (
        verified.payload.aud !== client.clientId ||
        (verified.payload.azp !== undefined &&
          verified.payload.azp !== client.clientId)
      )
        throw new SignInError("id-token-verification");
      return verified.payload;
    });
    await signInStep("nonce-validation", () => {
      if (!equal(opaque.parse(claims.nonce), tx.nonce))
        throw new SignInError("nonce-validation");
    });
    const sub = await signInStep("subject-validation", () =>
      boundedClaim(256).parse(claims.sub),
    );
    const userinfo = await request("userinfo", info.userinfo, {
      headers: { Authorization: `Bearer ${tokenPair.accessToken}` },
    });
    if (userinfo.sub !== sub) throw new SignInError("userinfo-subject");
    const org = await signInStep("org-claim-validation", () => {
      const present = [
        claims[ORG_CLAIM],
        claims.org_id,
        userinfo[ORG_CLAIM],
        userinfo.org_id,
      ]
        .filter((value) => value !== undefined && value !== null)
        .map((value) => boundedClaim(256).parse(value));
      if (new Set(present).size > 1)
        throw new SignInError("org-claim-validation");
      return present[0] ?? null;
    });
    const identity = await signInStep("profile-claims", () =>
      realIdentitySchema.parse({
        identityMode: "openwork",
        identity_issuer: claims.iss,
        sub,
        name: claims.name ?? userinfo.name,
        email: claims.email ?? userinfo.email,
        org_id: org,
      }),
    );
    return { downstream: tx.downstream, identity };
  }
  return { begin, complete, report, failure, success, callbackContext };
}
