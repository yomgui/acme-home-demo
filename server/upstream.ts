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

export const DEFAULT_UPSTREAM_ISSUER = "https://app.openworklabs.com/api/auth";
export const ORG_CLAIM = "https://app.openworklabs.com/org_id";
export const CALLBACK_PATH = "/oauth/upstream/callback";
const TTL = 300;
const RESPONSE_LIMIT = 64 * 1024;
const COOKIE_LIMIT = 3800;
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
  org_id: boundedClaim(256),
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
  purpose: z.literal("oidc-transaction"),
  clientId: boundedClaim(512),
  state: opaque,
  nonce: opaque,
  verifier: opaque,
  downstream: downstreamSchema,
});
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
  const url = new URL(value);
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
    throw new Error(
      "UPSTREAM_ISSUER must be a canonical HTTPS issuer or explicit http://127.0.0.1 local issuer",
    );
  return url;
}
export function createUpstream(
  appIssuer: string,
  privateKey: KeyObject,
  configuredIssuer = DEFAULT_UPSTREAM_ISSUER,
) {
  const upstream = upstreamIssuer(configuredIssuer);
  const callback = `${appIssuer}${CALLBACK_PATH}`;
  const secure = new URL(appIssuer).protocol === "https:";
  const cookieName = secure
    ? "__Host-openwork-transaction"
    : "openwork-local-transaction";
  const key = new Uint8Array(
    hkdfSync(
      "sha256",
      privateKey.export({ type: "pkcs8", format: "der" }),
      Buffer.from(appIssuer),
      Buffer.from(`employee-home-oidc-transaction-v1\0${configuredIssuer}`),
      32,
    ),
  );
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
    url: string,
    init: RequestInit = {},
  ): Promise<Record<string, unknown>> {
    const response = await fetch(endpoint(url), {
      ...init,
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
      headers: { Accept: "application/json", ...init.headers },
    });
    if (
      !response.ok ||
      !/^application\/(?:[a-z0-9.+-]*\+)?json\b/i.test(
        response.headers.get("content-type") ?? "",
      )
    ) {
      await response.body?.cancel();
      throw new Error("Upstream request failed");
    }
    const length = response.headers.get("content-length");
    if (length && (!/^\d+$/.test(length) || Number(length) > RESPONSE_LIMIT)) {
      await response.body?.cancel();
      throw new Error("Upstream response too large");
    }
    if (!response.body) throw new Error("Empty upstream response");
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
          throw new Error("Upstream response too large");
        }
        chunks.push(chunk.value);
      }
    } finally {
      reader.releaseLock();
    }
    return record(JSON.parse(Buffer.concat(chunks).toString("utf8")));
  }
  async function discover() {
    const data = await request(
      `${configuredIssuer}/.well-known/openid-configuration`,
    );
    if (
      data.issuer !== configuredIssuer ||
      !Array.isArray(data.code_challenge_methods_supported) ||
      !data.code_challenge_methods_supported.includes("S256") ||
      !Array.isArray(data.token_endpoint_auth_methods_supported) ||
      !data.token_endpoint_auth_methods_supported.includes("none")
    )
      throw new Error("Unsupported upstream metadata");
    const advertised = data.id_token_signing_alg_values_supported;
    const algorithms = ["EdDSA", "RS256", "ES256", "PS256"].filter(
      (alg) => Array.isArray(advertised) && advertised.includes(alg),
    );
    if (!algorithms.length) throw new Error("Unsupported ID token algorithms");
    return {
      authorization: endpoint(data.authorization_endpoint),
      token: endpoint(data.token_endpoint),
      registration: endpoint(data.registration_endpoint),
      jwks: endpoint(data.jwks_uri),
      userinfo: endpoint(data.userinfo_endpoint),
      algorithms,
    };
  }
  let discovery: ReturnType<typeof discover> | undefined;
  const metadata = () => (discovery ??= discover());
  async function register() {
    const data = await request((await metadata()).registration, {
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
      throw new Error("Invalid upstream registration");
    return boundedClaim(512).parse(data.client_id);
  }
  let registration: ReturnType<typeof register> | undefined;
  function cookie(res: ServerResponse, value: string, age: number) {
    res.setHeader(
      "Set-Cookie",
      `${cookieName}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${secure ? "; Secure" : ""}`,
    );
  }
  async function begin(res: ServerResponse, downstream: DownstreamRequest) {
    const validated = downstreamSchema.parse(downstream);
    const clientId = await (registration ??= register());
    const state = randomBytes(32).toString("base64url");
    const nonce = randomBytes(32).toString("base64url");
    const verifier = randomBytes(32).toString("base64url");
    const encrypted = await new EncryptJWT({
      purpose: "oidc-transaction",
      clientId,
      state,
      nonce,
      verifier,
      downstream: validated,
    })
      .setProtectedHeader({
        alg: "dir",
        enc: "A256GCM",
        typ: "oidc-transaction+jwt",
      })
      .setIssuer(appIssuer)
      .setAudience(callback)
      .setIssuedAt()
      .setExpirationTime(`${TTL}s`)
      .encrypt(key);
    if (Buffer.byteLength(encrypted) > COOKIE_LIMIT)
      throw new Error("Transaction exceeds cookie budget");
    const url = new URL((await metadata()).authorization);
    url.search = new URLSearchParams({
      client_id: clientId,
      redirect_uri: callback,
      response_type: "code",
      scope: "openid profile email",
      state,
      nonce,
      code_challenge: createHash("sha256").update(verifier).digest("base64url"),
      code_challenge_method: "S256",
    }).toString();
    cookie(res, encrypted, TTL);
    res.statusCode = 302;
    res.setHeader("Location", url.href);
    res.end();
  }
  async function complete(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
  ): Promise<{ downstream: DownstreamRequest; identity: OpenWorkIdentity }> {
    cookie(res, "", 0);
    if (Buffer.byteLength(req.headers.cookie ?? "") > 8192)
      throw new Error("Invalid transaction cookie");
    const matches = (req.headers.cookie ?? "")
      .split(";")
      .map((entry) => entry.trim())
      .filter((entry) => entry.startsWith(`${cookieName}=`));
    if (matches.length !== 1) throw new Error("Missing transaction cookie");
    const encrypted = matches[0]?.slice(cookieName.length + 1);
    if (!encrypted || encrypted.length > COOKIE_LIMIT)
      throw new Error("Invalid transaction cookie");
    const { payload } = await jwtDecrypt(encrypted, key, {
      issuer: appIssuer,
      audience: callback,
      keyManagementAlgorithms: ["dir"],
      contentEncryptionAlgorithms: ["A256GCM"],
      typ: "oidc-transaction+jwt",
      requiredClaims: ["iat", "exp"],
      maxTokenAge: TTL,
    });
    if (
      typeof payload.exp !== "number" ||
      typeof payload.iat !== "number" ||
      payload.exp - payload.iat > TTL
    )
      throw new Error("Invalid transaction lifetime");
    const tx = transactionSchema.parse(payload);
    const params = url.searchParams;
    for (const name of new Set(params.keys()))
      if (params.getAll(name).length !== 1)
        throw new Error("Duplicate callback parameter");
    const state = opaque.parse(params.get("state"));
    if (
      !equal(tx.state, state) ||
      params.has("error") ||
      (params.has("iss") && params.get("iss") !== configuredIssuer)
    )
      throw new Error("Invalid callback state or issuer");
    const code = boundedClaim(8192).parse(params.get("code"));
    const info = await metadata();
    const tokens = await request(info.token, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        client_id: tx.clientId,
        redirect_uri: callback,
        code_verifier: tx.verifier,
      }).toString(),
    });
    const idToken = boundedClaim(16384).parse(tokens.id_token);
    const accessToken = boundedClaim(16384).parse(tokens.access_token);
    if (
      typeof tokens.token_type !== "string" ||
      tokens.token_type.toLowerCase() !== "bearer"
    )
      throw new Error("Unsupported upstream token type");
    const jwks = await request(info.jwks);
    if (
      !Array.isArray(jwks.keys) ||
      jwks.keys.length === 0 ||
      jwks.keys.length > 20
    )
      throw new Error("Invalid upstream JWKS");
    const keys = jwks.keys.map((value: unknown) => {
      const item = record(value);
      const kty = boundedClaim(8).parse(item.kty);
      if (!["OKP", "RSA", "EC"].includes(kty) || "d" in item || "k" in item)
        throw new Error("Invalid public key");
      return { ...item, kty };
    });
    const verified = await jwtVerify(idToken, createLocalJWKSet({ keys }), {
      issuer: configuredIssuer,
      audience: tx.clientId,
      algorithms: info.algorithms,
      requiredClaims: ["iss", "aud", "sub", "exp", "iat", "nonce"],
      maxTokenAge: 600,
      clockTolerance: 5,
    });
    const claims = verified.payload;
    if (
      claims.aud !== tx.clientId ||
      (claims.azp !== undefined && claims.azp !== tx.clientId) ||
      !equal(opaque.parse(claims.nonce), tx.nonce)
    )
      throw new Error("Invalid upstream ID token binding");
    const sub = boundedClaim(256).parse(claims.sub);
    const userinfo = await request(info.userinfo, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (userinfo.sub !== sub) throw new Error("Userinfo subject mismatch");
    const org = boundedClaim(256).parse(claims[ORG_CLAIM]);
    if (
      (userinfo[ORG_CLAIM] !== undefined && userinfo[ORG_CLAIM] !== org) ||
      (userinfo.org_id !== undefined && userinfo.org_id !== org)
    )
      throw new Error("Userinfo organization mismatch");
    const identity = realIdentitySchema.parse({
      identityMode: "openwork",
      sub,
      name: claims.name ?? userinfo.name,
      email: claims.email ?? userinfo.email,
      org_id: org,
    });
    return { downstream: tx.downstream, identity };
  }
  return { begin, complete };
}
