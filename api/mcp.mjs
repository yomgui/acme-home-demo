// server/handler.ts
import { NodeStreamableHTTPServerTransport } from "@modelcontextprotocol/node";
import { randomUUID as randomUUID3 } from "node:crypto";

// shared/contract.ts
import { z } from "zod";
var widgetIds = ["today", "attention", "goals"];
var definitions = {
  today: { tool: "acme_today", title: "Today at a Glance" },
  attention: { tool: "acme_attention", title: "Needs Your Attention" },
  goals: { tool: "acme_goals", title: "My Goals" },
  home: { tool: "acme_home", title: "Acme Home" }
};
var resourceUri = (id) => `ui://acme-home/${id}.html`;
var identityFields = {
  name: z.string(),
  firstName: z.string(),
  role: z.string(),
  avatar: z.string(),
  fingerprint: z.string(),
  subjectShort: z.string().optional()
};
var identitySchema = z.discriminatedUnion("identityMode", [
  z.object({
    ...identityFields,
    identityMode: z.literal("per_member"),
    synthetic: z.literal(true)
  }),
  z.object({
    ...identityFields,
    identityMode: z.literal("openwork"),
    synthetic: z.literal(false),
    subjectShort: z.string().min(1),
    email: z.string(),
    org_id: z.string().min(1)
  })
]);
var base = {
  whoami: identitySchema.optional(),
  demo: z.literal(true),
  generatedAt: z.iso.datetime(),
  generation: z.number().int().positive(),
  providerInstance: z.string().min(1)
};
var todaySchema = z.object({
  ...base,
  kind: z.literal("today"),
  focusWindow: z.string(),
  focusNote: z.string(),
  meetings: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      time: z.string(),
      detail: z.string()
    })
  )
});
var attentionSchema = z.object({
  ...base,
  kind: z.literal("attention"),
  items: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      severity: z.enum(["critical", "due", "review"]),
      detail: z.string()
    })
  )
});
var goalsSchema = z.object({
  ...base,
  kind: z.literal("goals"),
  overall: z.number().min(0).max(100),
  period: z.string(),
  goals: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      progress: z.number().min(0).max(100),
      detail: z.string()
    })
  )
});
var payloadSchema = z.discriminatedUnion("kind", [
  todaySchema,
  attentionSchema,
  goalsSchema
]);
var homeInputSchema = z.union([
  z.object({ widget: z.never().optional() }).strict(),
  z.object({ widget: z.literal("today") }).strict(),
  z.object({ widget: z.literal("attention") }).strict(),
  z.object({ widget: z.literal("goals") }).strict()
]);
var homeOutputSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("shell"), demo: z.literal(true) }).strict(),
  todaySchema,
  attentionSchema,
  goalsSchema
]);
var schemas = {
  today: todaySchema,
  attention: attentionSchema,
  goals: goalsSchema
};

// server/oauth.ts
import {
  createHash as createHash3,
  createPrivateKey,
  createPublicKey,
  randomBytes as randomBytes2,
  randomUUID,
  timingSafeEqual as timingSafeEqual2
} from "node:crypto";
import { jwtVerify as jwtVerify2, SignJWT } from "jose";

// server/upstream.ts
import {
  createHash as createHash2,
  hkdfSync as hkdfSync2,
  randomBytes,
  timingSafeEqual
} from "node:crypto";
import { createLocalJWKSet, EncryptJWT as EncryptJWT2, jwtDecrypt as jwtDecrypt2, jwtVerify } from "jose";
import { z as z3 } from "zod";

// server/upstream-client.ts
import { BlobNotFoundError, get, put } from "@vercel/blob";
import { createHash, hkdfSync } from "node:crypto";
import { EncryptJWT, jwtDecrypt } from "jose";
import { z as z2 } from "zod";

// server/oidc-errors.ts
var stages = [
  "configuration",
  "discovery",
  "registration-read",
  "registration-create",
  "registration-write",
  "registration-binding",
  "authorization-start",
  "callback-parameters",
  "state-decrypt",
  "browser-binding",
  "upstream-authorization",
  "token-exchange",
  "id-token-response",
  "jwks",
  "id-token-verification",
  "nonce-validation",
  "subject-validation",
  "userinfo",
  "userinfo-subject",
  "missing-org-claim",
  "org-claim-validation",
  "profile-claims",
  "downstream-code",
  "callback-complete"
];
var codes = /* @__PURE__ */ new Set([
  "invalid_request",
  "invalid_client",
  "invalid_grant",
  "invalid_scope",
  "invalid_token",
  "unauthorized_client",
  "unsupported_grant_type",
  "access_denied",
  "login_required",
  "consent_required",
  "server_error",
  "temporarily_unavailable"
]);
var descriptions = /* @__PURE__ */ new Set([
  "invalid code verifier",
  "invalid authorization code",
  "authorization code expired",
  "authorization code already used",
  "code has expired",
  "invalid redirect uri",
  "invalid client credentials",
  "invalid grant",
  "invalid nonce"
]);
function callbackFields(context) {
  if (!context) return {};
  const fingerprint = (value) => typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
  return {
    cookiePresent: context.cookiePresent === true,
    stateMatch: context.stateMatch === true,
    redirectUriMatches: context.redirectUriMatches === true,
    ...context.cookiePresent === true && typeof context.cookieMatch === "boolean" ? { cookieMatch: context.cookieMatch } : {},
    ...fingerprint(context.clientIdUsed) ? { clientIdUsed: context.clientIdUsed } : {},
    ...fingerprint(context.redirectUriUsed) ? { redirectUriUsed: context.redirectUriUsed } : {}
  };
}
var SignInError = class extends Error {
  diagnostic;
  constructor(stage, code, description, status) {
    super("Sign-in failed");
    const normalized = typeof description === "string" && description.length <= 256 ? description.trim().toLowerCase() : "";
    this.diagnostic = {
      stage,
      error: typeof code === "string" && codes.has(code) ? code : "redacted",
      error_description: descriptions.has(normalized) && typeof description === "string" && !/[\r\n]/.test(description) ? normalized : "redacted",
      ...Number.isInteger(status) && status !== void 0 && status >= 100 && status <= 599 ? { status } : {}
    };
  }
};
function diagnosticFor(error, fallback) {
  if (!(error instanceof SignInError))
    return new SignInError(fallback).diagnostic;
  const data = error.diagnostic;
  return new SignInError(
    stages.includes(data.stage) ? data.stage : fallback,
    data.error,
    data.error_description,
    data.status
  ).diagnostic;
}
async function signInStep(stage, work) {
  try {
    return await work();
  } catch (error) {
    if (error instanceof SignInError) throw error;
    throw new SignInError(stage);
  }
}

// server/upstream-client.ts
var field = (max) => z2.string().min(1).max(max).refine(
  (value) => value.trim().length > 0 && !/[\u0000-\u001f\u007f]/.test(value)
);
var authMethodSchema = z2.enum([
  "none",
  "client_secret_post",
  "client_secret_basic"
]);
var registrationSchema = z2.object({
  clientId: field(512),
  clientSecret: field(4096).optional(),
  authMethod: authMethodSchema,
  issuer: field(2048),
  redirectUri: field(2048)
});
var LIMIT = 16384;
function registrationPath(issuer, callback) {
  return `oauth/registrations/v1/${createHash("sha256").update(JSON.stringify([issuer, callback])).digest("hex")}.jwe`;
}
function privateRegistrationCache(token, sdk = { get, put }) {
  function validPath(path) {
    if (!/^oauth\/registrations\/v1\/[0-9a-f]{64}\.jwe$/.test(path))
      throw new SignInError("registration-binding");
  }
  return {
    async read(path) {
      validPath(path);
      try {
        const result = await sdk.get(path, {
          access: "private",
          token,
          useCache: false,
          abortSignal: AbortSignal.timeout(1e4)
        });
        if (!result) return null;
        if (result.statusCode !== 200)
          throw new SignInError("registration-read");
        if (result.blob.size > LIMIT) {
          await result.stream.cancel();
          throw new SignInError("registration-read");
        }
        const reader = result.stream.getReader();
        const chunks = [];
        let size = 0;
        try {
          for (; ; ) {
            const chunk = await reader.read();
            if (chunk.done) break;
            size += chunk.value.byteLength;
            if (size > LIMIT) {
              await reader.cancel();
              throw new SignInError("registration-read");
            }
            chunks.push(chunk.value);
          }
        } finally {
          reader.releaseLock();
        }
        return Buffer.concat(chunks).toString("utf8");
      } catch (error) {
        if (error instanceof BlobNotFoundError) return null;
        throw new SignInError("registration-read");
      }
    },
    async create(path, encrypted) {
      validPath(path);
      if (Buffer.byteLength(encrypted) > LIMIT)
        throw new SignInError("registration-write");
      await sdk.put(path, encrypted, {
        token,
        access: "private",
        allowOverwrite: false,
        addRandomSuffix: false,
        contentType: "application/jose",
        cacheControlMaxAge: 60,
        abortSignal: AbortSignal.timeout(1e4)
      });
    }
  };
}
function createClientResolver(issuer, callback, privateKey, options = {}) {
  const env = options.env ?? process.env;
  const path = registrationPath(issuer, callback);
  const key = new Uint8Array(
    hkdfSync(
      "sha256",
      privateKey.export({ type: "pkcs8", format: "der" }),
      Buffer.from(issuer),
      Buffer.from(`employee-home-upstream-registration-v1\0${callback}`),
      32
    )
  );
  function validated(value) {
    const client = registrationSchema.parse(value);
    if (client.issuer !== issuer || client.redirectUri !== callback || (client.authMethod === "none" ? client.clientSecret !== void 0 : client.clientSecret === void 0))
      throw new SignInError("registration-binding");
    return client;
  }
  function configured2() {
    if (env.UPSTREAM_CLIENT_ID === void 0) {
      if ([
        env.UPSTREAM_CLIENT_SECRET,
        env.UPSTREAM_CLIENT_ISSUER,
        env.UPSTREAM_CLIENT_REDIRECT_URI,
        env.UPSTREAM_CLIENT_AUTH_METHOD
      ].some((value) => value !== void 0))
        throw new SignInError("configuration");
      return void 0;
    }
    try {
      return validated({
        clientId: env.UPSTREAM_CLIENT_ID,
        clientSecret: env.UPSTREAM_CLIENT_SECRET,
        issuer: env.UPSTREAM_CLIENT_ISSUER,
        redirectUri: env.UPSTREAM_CLIENT_REDIRECT_URI,
        authMethod: env.UPSTREAM_CLIENT_AUTH_METHOD ?? "none"
      });
    } catch {
      throw new SignInError("configuration");
    }
  }
  async function decode(encrypted) {
    return signInStep("registration-binding", async () => {
      if (Buffer.byteLength(encrypted) > LIMIT)
        throw new SignInError("registration-binding");
      const { payload } = await jwtDecrypt(encrypted, key, {
        issuer,
        audience: callback,
        keyManagementAlgorithms: ["dir"],
        contentEncryptionAlgorithms: ["A256GCM"],
        typ: "upstream-registration+jwt",
        requiredClaims: ["iat"]
      });
      if (payload.purpose !== "upstream-registration-v1")
        throw new SignInError("registration-binding");
      return validated(payload.client);
    });
  }
  async function resolve(allowCreate, register) {
    const explicit = configured2();
    if (explicit) return explicit;
    const cache = options.registrationCache ?? (env.BLOB_READ_WRITE_TOKEN ? privateRegistrationCache(env.BLOB_READ_WRITE_TOKEN) : void 0);
    if (!cache) throw new SignInError("configuration");
    const existing = await signInStep(
      "registration-read",
      () => cache.read(path)
    );
    if (existing !== null) return decode(existing);
    if (!allowCreate) throw new SignInError("registration-read");
    const candidate = await signInStep(
      "registration-create",
      async () => validated(await register())
    );
    const encrypted = await new EncryptJWT({
      purpose: "upstream-registration-v1",
      client: candidate
    }).setProtectedHeader({
      alg: "dir",
      enc: "A256GCM",
      typ: "upstream-registration+jwt"
    }).setIssuer(issuer).setAudience(callback).setIssuedAt().encrypt(key);
    try {
      await cache.create(path, encrypted);
    } catch {
    }
    const winner = await signInStep(
      "registration-write",
      () => cache.read(path)
    );
    if (winner === null) throw new SignInError("registration-write");
    return decode(winner);
  }
  return { resolve };
}
function clientAuthentication(client) {
  if (client.authMethod === "none")
    return { headers: {}, fields: { client_id: client.clientId } };
  if (!client.clientSecret) throw new SignInError("configuration");
  if (client.authMethod === "client_secret_post")
    return {
      headers: {},
      fields: {
        client_id: client.clientId,
        client_secret: client.clientSecret
      }
    };
  const encode = (value) => new URLSearchParams({ value }).toString().slice(6);
  return {
    headers: {
      Authorization: `Basic ${Buffer.from(`${encode(client.clientId)}:${encode(client.clientSecret)}`).toString("base64")}`
    },
    fields: {}
  };
}

// server/upstream.ts
var DEFAULT_UPSTREAM_ISSUER = "https://app.openworklabs.com/api/auth";
var ORG_CLAIM = "https://app.openworklabs.com/org_id";
var CALLBACK_PATH = "/oauth/upstream/callback";
var TTL = 300;
var RESPONSE_LIMIT = 64 * 1024;
var STATE_LIMIT = 8192;
var opaque = z3.string().regex(/^[A-Za-z0-9_-]{43}$/);
var boundedClaim = (max) => z3.string().min(1).max(max).refine(
  (value) => value.trim().length > 0 && !/[\u0000-\u001f\u007f]/.test(value)
);
var realIdentitySchema = z3.object({
  identityMode: z3.literal("openwork"),
  sub: boundedClaim(256),
  name: boundedClaim(256),
  email: boundedClaim(320),
  org_id: boundedClaim(256)
});
var downstreamSchema = z3.object({
  client_id: boundedClaim(512),
  redirect_uri: boundedClaim(2048),
  resource: boundedClaim(2048),
  code_challenge: opaque,
  state: z3.string().max(1024).optional()
}).strict();
var transactionSchema = z3.object({
  purpose: z3.literal("oidc-transaction-v2"),
  clientId: boundedClaim(512),
  authMethod: authMethodSchema,
  redirectUri: boundedClaim(2048),
  browserHash: z3.string().regex(/^[0-9a-f]{64}$/),
  nonce: opaque,
  verifier: opaque,
  downstream: downstreamSchema
});
function record(value) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid upstream response");
  return Object.fromEntries(Object.entries(value));
}
function equal(a, b) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
function upstreamIssuer(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new SignInError("configuration");
  }
  const local = /^http:\/\/127\.0\.0\.1(?::\d+)?(?:\/|$)/.test(value) && url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !local || url.username || url.password || url.search || url.hash || /[\s\\]/.test(value) || value.endsWith("/") || value !== url.origin + (url.pathname === "/" ? "" : url.pathname))
    throw new SignInError("configuration");
  return url;
}
function createUpstream(appIssuer, privateKey, configuredIssuer = DEFAULT_UPSTREAM_ISSUER, options = {}) {
  const upstream = upstreamIssuer(configuredIssuer);
  const callback = `${appIssuer}${CALLBACK_PATH}`;
  const secure = new URL(appIssuer).protocol === "https:";
  const cookieName = secure ? "__Host-openwork-binding" : "openwork-local-binding";
  const key = new Uint8Array(
    hkdfSync2(
      "sha256",
      privateKey.export({ type: "pkcs8", format: "der" }),
      Buffer.from(appIssuer),
      Buffer.from(`employee-home-oidc-state-v2\0${configuredIssuer}`),
      32
    )
  );
  const clients = createClientResolver(
    configuredIssuer,
    callback,
    privateKey,
    options
  );
  const digest = (value) => createHash2("sha256").update(value).digest("hex");
  function endpoint(value) {
    const raw = boundedClaim(2048).parse(value);
    const url = new URL(raw);
    if (url.origin !== upstream.origin || url.username || url.password || url.hash || /[\s\\]/.test(raw) || !url.pathname.startsWith(
      `${upstream.pathname === "/" ? "" : upstream.pathname}/`
    ))
      throw new Error("Untrusted upstream endpoint");
    return url.href;
  }
  async function request(stage, url, init = {}) {
    return signInStep(stage, async () => {
      const response = await fetch(endpoint(url), {
        ...init,
        redirect: "error",
        signal: AbortSignal.timeout(1e4),
        headers: { Accept: "application/json", ...init.headers }
      });
      if (!/^application\/(?:[a-z0-9.+-]*\+)?json\b/i.test(
        response.headers.get("content-type") ?? ""
      )) {
        await response.body?.cancel();
        throw new SignInError(stage, void 0, void 0, response.status);
      }
      const length = response.headers.get("content-length");
      if (length && (!/^\d+$/.test(length) || Number(length) > RESPONSE_LIMIT)) {
        await response.body?.cancel();
        throw new SignInError(stage, void 0, void 0, response.status);
      }
      if (!response.body)
        throw new SignInError(stage, void 0, void 0, response.status);
      const reader = response.body.getReader();
      const chunks = [];
      let size = 0;
      try {
        for (; ; ) {
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
      if (!response.ok || data.error !== void 0)
        throw new SignInError(
          stage,
          data.error,
          data.error_description,
          response.status
        );
      return data;
    });
  }
  async function discover() {
    return signInStep("discovery", async () => {
      const data = await request(
        "discovery",
        `${configuredIssuer}/.well-known/openid-configuration`
      );
      if (data.issuer !== configuredIssuer || !Array.isArray(data.code_challenge_methods_supported) || !data.code_challenge_methods_supported.includes("S256") || !Array.isArray(data.token_endpoint_auth_methods_supported))
        throw new SignInError("discovery");
      const authMethods = z3.array(authMethodSchema).min(1).parse(
        data.token_endpoint_auth_methods_supported.filter(
          (value) => authMethodSchema.safeParse(value).success
        )
      );
      const advertised = data.id_token_signing_alg_values_supported;
      const algorithms = ["EdDSA", "RS256", "ES256", "PS256"].filter(
        (alg) => Array.isArray(advertised) && advertised.includes(alg)
      );
      if (!algorithms.length) throw new SignInError("discovery");
      return {
        authorization: endpoint(data.authorization_endpoint),
        token: endpoint(data.token_endpoint),
        registration: data.registration_endpoint === void 0 ? void 0 : endpoint(data.registration_endpoint),
        jwks: endpoint(data.jwks_uri),
        userinfo: endpoint(data.userinfo_endpoint),
        algorithms,
        authMethods
      };
    });
  }
  let discovery;
  const metadata = () => discovery ??= discover();
  async function register() {
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
          application_type: "web"
        })
      });
      if (data.token_endpoint_auth_method !== "none" || !Array.isArray(data.redirect_uris) || data.redirect_uris.length !== 1 || data.redirect_uris[0] !== callback)
        throw new SignInError("registration-binding");
      return {
        clientId: boundedClaim(512).parse(data.client_id),
        authMethod: "none",
        issuer: configuredIssuer,
        redirectUri: callback
      };
    });
  }
  function cookie(res, value, age) {
    res.setHeader(
      "Set-Cookie",
      `${cookieName}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${secure ? "; Secure" : ""}`
    );
  }
  function bindingCookies(req) {
    return (req.headers.cookie ?? "").split(";").map((entry) => entry.trim()).filter((entry) => entry.split("=", 1)[0]?.trim() === cookieName);
  }
  function callbackContext(req) {
    const cookiePresent = bindingCookies(req).length > 0;
    return { cookiePresent, stateMatch: false, redirectUriMatches: false };
  }
  function emit(diagnostic, success2 = false) {
    try {
      if (options.diagnostics) options.diagnostics(diagnostic);
      else
        console.error(
          JSON.stringify({
            event: success2 ? "oidc-callback-complete" : "oidc-sign-in-failed",
            ...diagnostic
          })
        );
    } catch {
    }
  }
  function report(error, fallback, context) {
    emit({ ...diagnosticFor(error, fallback), ...callbackFields(context) });
  }
  function success(context) {
    if (options.logCallbackSuccess === false) return;
    emit(
      {
        stage: "callback-complete",
        error: "none",
        error_description: "none",
        ...callbackFields(context)
      },
      true
    );
  }
  function failure(res, error, fallback, context) {
    cookie(res, "", 0);
    report(error, fallback, context);
    res.statusCode = 400;
    res.removeHeader("Location");
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"
    );
    res.end(
      '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Sign-in expired</title></head><body><main><h1>Sign-in expired, try again</h1><p>Return to your app connection and choose Connect to start a new sign-in. This page will not retry automatically.</p></main></body></html>'
    );
  }
  async function begin(res, downstream) {
    const validated = await signInStep(
      "authorization-start",
      () => downstreamSchema.parse(downstream)
    );
    const client = await clients.resolve(true, register);
    const info = await metadata();
    if (!info.authMethods.includes(client.authMethod))
      throw new SignInError("configuration");
    const binding = randomBytes(32).toString("base64url");
    const nonce = randomBytes(32).toString("base64url");
    const verifier = randomBytes(32).toString("base64url");
    const state = await new EncryptJWT2({
      purpose: "oidc-transaction-v2",
      clientId: client.clientId,
      authMethod: client.authMethod,
      redirectUri: client.redirectUri,
      browserHash: digest(binding),
      nonce,
      verifier,
      downstream: validated
    }).setProtectedHeader({ alg: "dir", enc: "A256GCM", typ: "oidc-state+jwt" }).setIssuer(appIssuer).setAudience(callback).setIssuedAt().setExpirationTime(`${TTL}s`).encrypt(key);
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
      code_challenge: createHash2("sha256").update(verifier).digest("base64url"),
      code_challenge_method: "S256"
    }).toString();
    if (Buffer.byteLength(url.href) > 16384)
      throw new SignInError("authorization-start");
    cookie(res, binding, TTL);
    res.statusCode = 302;
    res.setHeader("Location", url.href);
    res.end();
  }
  async function complete(req, res, url, context = callbackContext(req)) {
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
      const { payload } = await jwtDecrypt2(encrypted, key, {
        issuer: appIssuer,
        audience: callback,
        keyManagementAlgorithms: ["dir"],
        contentEncryptionAlgorithms: ["A256GCM"],
        typ: "oidc-state+jwt",
        requiredClaims: ["iat", "exp"],
        maxTokenAge: TTL
      });
      if (typeof payload.exp !== "number" || typeof payload.iat !== "number" || !Number.isSafeInteger(payload.iat) || !Number.isSafeInteger(payload.exp) || payload.exp <= payload.iat || payload.exp - payload.iat > TTL || payload.aud !== callback)
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
        params.get("error_description")
      );
    const code = await signInStep(
      "callback-parameters",
      () => boundedClaim(8192).parse(params.get("code"))
    );
    const client = await clients.resolve(false, register);
    context.clientIdUsed = digest(client.clientId);
    context.redirectUriUsed = digest(client.redirectUri);
    context.redirectUriMatches = client.redirectUri === tx.redirectUri && tx.redirectUri === callback;
    if (!equal(client.clientId, tx.clientId) || client.redirectUri !== tx.redirectUri || tx.redirectUri !== callback || client.authMethod !== tx.authMethod)
      throw new SignInError("registration-binding");
    const info = await metadata();
    if (!info.authMethods.includes(client.authMethod))
      throw new SignInError("configuration");
    const auth = clientAuthentication(client);
    const tokens = await request("token-exchange", info.token, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        ...auth.headers
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: client.redirectUri,
        code_verifier: tx.verifier,
        ...auth.fields
      }).toString()
    });
    const tokenPair = await signInStep("id-token-response", () => {
      if (typeof tokens.token_type !== "string" || tokens.token_type.toLowerCase() !== "bearer")
        throw new SignInError("id-token-response");
      return {
        idToken: boundedClaim(16384).parse(tokens.id_token),
        accessToken: boundedClaim(16384).parse(tokens.access_token)
      };
    });
    const jwks = await request("jwks", info.jwks);
    const keySet = await signInStep("jwks", () => {
      if (!Array.isArray(jwks.keys) || jwks.keys.length === 0 || jwks.keys.length > 20)
        throw new SignInError("jwks");
      const keys = jwks.keys.map((value) => {
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
        clockTolerance: 5
      });
      if (verified.payload.aud !== client.clientId || verified.payload.azp !== void 0 && verified.payload.azp !== client.clientId)
        throw new SignInError("id-token-verification");
      return verified.payload;
    });
    await signInStep("nonce-validation", () => {
      if (!equal(opaque.parse(claims.nonce), tx.nonce))
        throw new SignInError("nonce-validation");
    });
    const sub = await signInStep(
      "subject-validation",
      () => boundedClaim(256).parse(claims.sub)
    );
    const userinfo = await request("userinfo", info.userinfo, {
      headers: { Authorization: `Bearer ${tokenPair.accessToken}` }
    });
    if (userinfo.sub !== sub) throw new SignInError("userinfo-subject");
    if (claims[ORG_CLAIM] === void 0 || claims[ORG_CLAIM] === null)
      throw new SignInError("missing-org-claim");
    const org = await signInStep(
      "org-claim-validation",
      () => boundedClaim(256).parse(claims[ORG_CLAIM])
    );
    if (userinfo[ORG_CLAIM] !== void 0 && userinfo[ORG_CLAIM] !== org || userinfo.org_id !== void 0 && userinfo.org_id !== org)
      throw new SignInError("org-claim-validation");
    const identity = await signInStep(
      "profile-claims",
      () => realIdentitySchema.parse({
        identityMode: "openwork",
        sub,
        name: claims.name ?? userinfo.name,
        email: claims.email ?? userinfo.email,
        org_id: org
      })
    );
    return { downstream: tx.downstream, identity };
  }
  return { begin, complete, report, failure, success, callbackContext };
}

// server/oauth.ts
var SCOPE = "home:read";
var BODY_LIMIT = 16 * 1024;
var CODE_TTL = 60;
var ACCESS_TTL = 3600;
var CLIENT_TTL = 30 * 24 * 3600;
var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
var TYPES = { code: "oauth-authz-code+jwt", access: "at+jwt" };
var OAuthError = class extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
};
function invalid(code = "invalid_request") {
  throw new OAuthError(400, code);
}
function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function validIssuer(value) {
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || /^http:\/\/127\.0\.0\.1(?::\d+)?$/.test(value)) && url.origin === value;
  } catch {
    return false;
  }
}
function validRedirect(value) {
  try {
    const url = new URL(value);
    const authority = /^https?:\/\/([^/?#]+)/i.exec(value)?.[1];
    return authority !== void 0 && !/[\s\\]/.test(value) && !value.includes("#") && !url.username && !url.password && !authority.includes("@") && (url.protocol === "https:" || url.protocol === "http:" && /^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(authority));
  } catch {
    return false;
  }
}
function redirectUris(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 10)
    invalid("invalid_redirect_uri");
  const result = [];
  for (const item of value) {
    if (typeof item !== "string" || !validRedirect(item))
      invalid("invalid_redirect_uri");
    result.push(item);
  }
  if (Buffer.byteLength(JSON.stringify(result)) > 2048)
    invalid("invalid_redirect_uri");
  return result;
}
function parameters(value) {
  const result = /* @__PURE__ */ new Map();
  const entries = value instanceof URLSearchParams ? value.entries() : Object.entries(value);
  for (const [name, item] of entries) {
    if (typeof item !== "string" || result.has(name)) invalid();
    result.set(name, item);
  }
  return result;
}
function required(params, name) {
  const value = params.get(name);
  if (!value) invalid();
  return value;
}
async function readBody(req, format) {
  const mediaType = req.headers["content-type"]?.split(";")[0]?.trim().toLowerCase();
  if (mediaType !== (format === "json" ? "application/json" : "application/x-www-form-urlencoded"))
    throw new OAuthError(415, "invalid_request");
  const length = req.headers["content-length"];
  if (length !== void 0 && (!/^\d+$/.test(length) || Number(length) > BODY_LIMIT))
    throw new OAuthError(413, "invalid_request");
  let body = req.body;
  if (body === void 0) {
    const chunks = [];
    let size = 0;
    for await (const value of req.iterator({ destroyOnReturn: false })) {
      const chunk = value;
      if (!Buffer.isBuffer(chunk) && typeof chunk !== "string") invalid();
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += bytes.length;
      if (size > BODY_LIMIT) throw new OAuthError(413, "invalid_request");
      chunks.push(bytes);
    }
    body = Buffer.concat(chunks);
  }
  if (Buffer.isBuffer(body)) {
    if (body.length > BODY_LIMIT) throw new OAuthError(413, "invalid_request");
    body = body.toString("utf8");
  }
  if (typeof body === "string") {
    if (Buffer.byteLength(body) > BODY_LIMIT)
      throw new OAuthError(413, "invalid_request");
    try {
      return format === "json" ? JSON.parse(body) : new URLSearchParams(body);
    } catch {
      invalid();
    }
  }
  if (!isRecord(body)) invalid();
  let serialized;
  try {
    serialized = JSON.stringify(body);
  } catch {
    invalid();
  }
  if (Buffer.byteLength(serialized) > BODY_LIMIT)
    throw new OAuthError(413, "invalid_request");
  return body;
}
function json(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}
function createOAuth(options = {}) {
  const configuredIssuer = options.issuer ?? process.env.DEMO_AS_ISSUER ?? (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : void 0);
  const pem = options.privateKeyPem ?? process.env.DEMO_AS_PRIVATE_KEY;
  if (!configuredIssuer || !validIssuer(configuredIssuer))
    throw new Error(
      "DEMO_AS_ISSUER must be an HTTPS origin without a trailing slash"
    );
  const issuer = configuredIssuer;
  if (!pem?.trim().startsWith("-----BEGIN PRIVATE KEY-----"))
    throw new Error("DEMO_AS_PRIVATE_KEY must be an Ed25519 PKCS8 PEM");
  const privateKey = (() => {
    try {
      const key = createPrivateKey(pem);
      if (key.asymmetricKeyType !== "ed25519") throw new Error();
      return key;
    } catch {
      throw new Error("DEMO_AS_PRIVATE_KEY must be an Ed25519 PKCS8 PEM");
    }
  })();
  const identityMode = options.identityMode ?? process.env.IDENTITY_MODE ?? "openwork";
  if (identityMode !== "openwork" && identityMode !== "demo")
    throw new Error("IDENTITY_MODE must be openwork or demo");
  const upstream = identityMode === "openwork" ? createUpstream(
    issuer,
    privateKey,
    options.upstreamIssuer ?? process.env.UPSTREAM_ISSUER,
    options.upstreamOptions
  ) : void 0;
  const description = identityMode === "demo" ? "demo authorization server: accepts every request; codes are short-lived, not single-use" : "OpenWork OIDC identity; synthetic work data; downstream codes are short-lived, not single-use";
  const publicKey = createPublicKey(privateKey);
  const kid = createHash3("sha256").update(publicKey.export({ format: "der", type: "spki" })).digest("base64url");
  const resource = `${issuer}/mcp`;
  const audiences = { code: `${issuer}/token`, access: resource };
  const lifetimes = { code: CODE_TTL, access: ACCESS_TTL };
  const metadata = {
    authorizationServer: {
      issuer,
      description,
      identity_mode: identityMode,
      authorization_endpoint: `${issuer}/authorize`,
      token_endpoint: `${issuer}/token`,
      registration_endpoint: `${issuer}/register`,
      jwks_uri: `${issuer}/.well-known/jwks.json`,
      response_types_supported: ["code"],
      response_modes_supported: ["query"],
      grant_types_supported: ["authorization_code"],
      token_endpoint_auth_methods_supported: ["none"],
      code_challenge_methods_supported: ["S256"],
      scopes_supported: [SCOPE],
      client_id_metadata_document_supported: false
    },
    protectedResource: {
      resource,
      authorization_servers: [issuer],
      scopes_supported: [SCOPE],
      bearer_methods_supported: ["header"],
      resource_name: "Employee Home (demo)",
      description,
      identity_mode: identityMode
    },
    jwks: {
      keys: [
        {
          ...publicKey.export({ format: "jwk" }),
          kid,
          alg: "EdDSA",
          use: "sig"
        }
      ]
    }
  };
  async function sign(kind, claims) {
    const now = Math.floor(Date.now() / 1e3);
    return new SignJWT({
      ...claims,
      token_kind: kind,
      identity_mode: identityMode
    }).setProtectedHeader({ alg: "EdDSA", typ: TYPES[kind], kid }).setIssuer(issuer).setAudience(audiences[kind]).setIssuedAt(now).setExpirationTime(now + lifetimes[kind]).setJti(randomUUID()).sign(privateKey);
  }
  async function verify(token2, kind) {
    const { payload, protectedHeader } = await jwtVerify2(token2, publicKey, {
      algorithms: ["EdDSA"],
      issuer,
      audience: audiences[kind],
      typ: TYPES[kind],
      requiredClaims: ["iss", "aud", "iat", "exp", "jti", "token_kind"],
      maxTokenAge: lifetimes[kind]
    });
    const now = Math.floor(Date.now() / 1e3);
    if (payload.iss !== issuer || payload.aud !== audiences[kind] || payload.token_kind !== kind || payload.identity_mode !== identityMode || protectedHeader.kid !== kid || typeof payload.iat !== "number" || typeof payload.exp !== "number" || !Number.isSafeInteger(payload.iat) || !Number.isSafeInteger(payload.exp) || payload.iat > now || payload.exp <= payload.iat || payload.exp - payload.iat > lifetimes[kind] || typeof payload.jti !== "string" || !UUID.test(payload.jti))
      throw new Error("Invalid token");
    return payload;
  }
  const redirectHash = (redirect) => createHash3("sha256").update(`demo-dcr-v1\0${issuer}\0${redirect}`).digest().subarray(0, 16).toString("base64url");
  async function registerClientId(redirects) {
    const payload = {
      r: redirects.map(redirectHash),
      e: Math.floor(Date.now() / 1e3) + CLIENT_TTL,
      n: randomBytes2(12).toString("base64url")
    };
    const token2 = `c1.${await new SignJWT(payload).setProtectedHeader({ alg: "EdDSA" }).sign(privateKey)}`;
    if (token2.length > 512) invalid("invalid_client_metadata");
    return token2;
  }
  async function verifyClient(token2) {
    try {
      if (!token2.startsWith("c1.") || token2.length > 512) invalid();
      const { payload } = await jwtVerify2(token2.slice(3), publicKey, {
        algorithms: ["EdDSA"]
      });
      const now = Math.floor(Date.now() / 1e3);
      if (!Number.isSafeInteger(payload.e) || typeof payload.e !== "number" || payload.e <= now || payload.e > now + CLIENT_TTL || typeof payload.n !== "string" || !/^[A-Za-z0-9_-]{16}$/.test(payload.n) || !Array.isArray(payload.r) || payload.r.length === 0 || payload.r.length > 10)
        invalid();
      const hashes = [];
      for (const value of payload.r) {
        if (typeof value !== "string" || !/^[A-Za-z0-9_-]{22}$/.test(value) || Buffer.from(value, "base64url").toString("base64url") !== value)
          invalid();
        hashes.push(value);
      }
      return hashes;
    } catch {
      invalid("invalid_client");
    }
  }
  function identityClaims(payload) {
    if (identityMode === "openwork")
      return realIdentitySchema.parse({
        identityMode: "openwork",
        sub: payload.sub,
        name: payload.name,
        email: payload.email,
        org_id: payload.org_id
      });
    if (typeof payload.sub !== "string" || !UUID.test(payload.sub))
      throw new Error("Invalid demo subject");
    return { sub: payload.sub };
  }
  async function verifyAccessToken(token2) {
    try {
      const payload = await verify(token2, "access");
      if (payload.scope !== SCOPE || payload.resource !== resource)
        throw new Error();
      return identityClaims(payload);
    } catch {
      throw new Error("Invalid access token");
    }
  }
  async function issueCode(res, downstream, identity) {
    const code = await sign("code", {
      ...downstream,
      ...identity,
      code_challenge_method: "S256",
      scope: SCOPE
    });
    const destination = new URL(downstream.redirect_uri);
    destination.searchParams.set("code", code);
    destination.searchParams.delete("state");
    if (downstream.state !== void 0)
      destination.searchParams.set("state", downstream.state);
    res.statusCode = 302;
    res.setHeader("Location", destination.href);
    res.end();
  }
  async function register(req, res) {
    const body = await readBody(req, "json");
    if (!isRecord(body)) invalid();
    const redirects = redirectUris(body.redirect_uris);
    if (body.token_endpoint_auth_method !== void 0 && body.token_endpoint_auth_method !== "none")
      invalid("invalid_client_metadata");
    const grants = body.grant_types;
    if (grants !== void 0 && (!Array.isArray(grants) || !grants.includes("authorization_code") || grants.some(
      (grant) => grant !== "authorization_code" && grant !== "refresh_token"
    )))
      invalid("invalid_client_metadata");
    const responses = body.response_types;
    if (responses !== void 0 && (!Array.isArray(responses) || responses.length !== 1 || responses[0] !== "code"))
      invalid("invalid_client_metadata");
    if (body.scope !== void 0 && body.scope !== SCOPE)
      invalid("invalid_scope");
    const clientId = await registerClientId(redirects);
    json(res, 201, {
      client_id: clientId,
      client_id_issued_at: Math.floor(Date.now() / 1e3),
      redirect_uris: redirects,
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code"],
      response_types: ["code"],
      scope: SCOPE
    });
  }
  async function authorize(url, res) {
    const params = parameters(url.searchParams);
    const clientId = required(params, "client_id");
    const redirectHashes = await verifyClient(clientId);
    const redirect = required(params, "redirect_uri");
    if (!validRedirect(redirect) || !redirectHashes.includes(redirectHash(redirect)))
      invalid("invalid_redirect_uri");
    if (required(params, "response_type") !== "code")
      invalid("unsupported_response_type");
    if (required(params, "resource") !== resource) invalid("invalid_target");
    if (params.has("scope") && params.get("scope") !== SCOPE)
      invalid("invalid_scope");
    if (params.has("response_mode") && params.get("response_mode") !== "query")
      invalid();
    const challenge = required(params, "code_challenge");
    if (params.get("code_challenge_method") !== "S256" || !/^[A-Za-z0-9_-]{43}$/.test(challenge) || Buffer.from(challenge, "base64url").toString("base64url") !== challenge)
      invalid();
    const state = params.get("state");
    if (state !== void 0 && state.length > 1024) invalid();
    const downstream = {
      client_id: clientId,
      redirect_uri: redirect,
      resource,
      code_challenge: challenge,
      state
    };
    if (upstream) {
      try {
        await upstream.begin(res, downstream);
      } catch (error) {
        upstream.report(error, "authorization-start");
        throw new OAuthError(502, "upstream_unavailable");
      }
    } else await issueCode(res, downstream, { sub: randomUUID() });
  }
  async function token(req, res) {
    const body = await readBody(req, "form");
    if (!(body instanceof URLSearchParams) && !isRecord(body)) invalid();
    const params = parameters(body);
    if (req.headers.authorization !== void 0 || params.has("client_secret") || params.has("client_assertion"))
      invalid("invalid_client");
    if (required(params, "grant_type") !== "authorization_code")
      invalid("unsupported_grant_type");
    const clientId = required(params, "client_id");
    const redirectHashes = await verifyClient(clientId);
    const redirect = required(params, "redirect_uri");
    if (!validRedirect(redirect) || !redirectHashes.includes(redirectHash(redirect)))
      invalid("invalid_grant");
    if (required(params, "resource") !== resource) invalid("invalid_target");
    if (params.has("scope") && params.get("scope") !== SCOPE)
      invalid("invalid_scope");
    const code = required(params, "code");
    const verifier = required(params, "code_verifier");
    let claims;
    try {
      claims = await verify(code, "code");
      identityClaims(claims);
      if (claims.client_id !== clientId || claims.redirect_uri !== redirect || claims.resource !== resource || claims.scope !== SCOPE || claims.code_challenge_method !== "S256" || typeof claims.code_challenge !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(claims.code_challenge) || !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier))
        throw new Error();
      const actual = createHash3("sha256").update(verifier).digest("base64url");
      if (!timingSafeEqual2(
        Buffer.from(actual),
        Buffer.from(claims.code_challenge)
      ))
        throw new Error();
    } catch {
      invalid("invalid_grant");
    }
    const accessToken = await sign("access", {
      ...identityClaims(claims),
      scope: SCOPE,
      resource
    });
    json(res, 200, {
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: ACCESS_TTL,
      scope: SCOPE
    });
  }
  async function handle(req, res) {
    const path = req.url?.split("?")[0];
    const routes = /* @__PURE__ */ new Map([
      ["/.well-known/oauth-authorization-server", "GET"],
      ["/.well-known/oauth-protected-resource", "GET"],
      ["/.well-known/oauth-protected-resource/mcp", "GET"],
      ["/jwks.json", "GET"],
      ["/.well-known/jwks.json", "GET"],
      ["/register", "POST"],
      ["/authorize", "GET"],
      ["/token", "POST"],
      [CALLBACK_PATH, "GET"]
    ]);
    if (!path || !routes.has(path)) return false;
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    const callbackTrace = path === CALLBACK_PATH && upstream ? upstream.callbackContext(req) : void 0;
    try {
      if (req.method !== routes.get(path)) {
        res.setHeader("Allow", routes.get(path) ?? "GET");
        throw new OAuthError(405, "invalid_request");
      }
      if (Buffer.byteLength(req.url ?? "") > BODY_LIMIT)
        throw new OAuthError(414, "invalid_request");
      if (path === "/register") await register(req, res);
      else if (path === "/authorize")
        await authorize(new URL(req.url ?? path, issuer), res);
      else if (path === CALLBACK_PATH) {
        if (!upstream) invalid();
        try {
          const result = await upstream.complete(
            req,
            res,
            new URL(req.url ?? path, issuer),
            callbackTrace
          );
          await issueCode(res, result.downstream, result.identity);
          upstream.success(callbackTrace);
        } catch (error) {
          upstream.failure(res, error, "downstream-code", callbackTrace);
        }
      } else if (path === "/token") await token(req, res);
      else if (path === "/jwks.json" || path === "/.well-known/jwks.json")
        json(res, 200, metadata.jwks);
      else if (path === "/.well-known/oauth-authorization-server")
        json(res, 200, metadata.authorizationServer);
      else json(res, 200, metadata.protectedResource);
    } catch (error) {
      if (!res.headersSent) {
        if (path === CALLBACK_PATH && upstream) {
          upstream.failure(res, error, "callback-parameters", callbackTrace);
          return true;
        }
        if (error instanceof OAuthError && error.status === 413)
          res.setHeader("Connection", "close");
        json(res, error instanceof OAuthError ? error.status : 500, {
          error: error instanceof OAuthError ? error.code : "server_error"
        });
      }
    }
    return true;
  }
  return { handle, verifyAccessToken, metadata };
}

// server/provider.ts
import { createHash as createHash4, randomUUID as randomUUID2 } from "node:crypto";
var people = [
  {
    name: "Maya Chen",
    role: "Platform engineer",
    avatar: "MC",
    project: "Atlas"
  },
  { name: "Noah Patel", role: "Product lead", avatar: "NP", project: "Beacon" },
  {
    name: "Amara Okafor",
    role: "Operations lead",
    avatar: "AO",
    project: "Cedar"
  },
  {
    name: "Leo Garcia",
    role: "Security analyst",
    avatar: "LG",
    project: "Drift"
  },
  { name: "Sofia Rossi", role: "Design lead", avatar: "SR", project: "Ember" },
  {
    name: "Ethan Kim",
    role: "Customer engineer",
    avatar: "EK",
    project: "Fjord"
  },
  {
    name: "Zara Ahmed",
    role: "Finance partner",
    avatar: "ZA",
    project: "Grove"
  },
  {
    name: "Oliver Reed",
    role: "Data scientist",
    avatar: "OR",
    project: "Harbor"
  }
];
function profileForSubject(sub) {
  const hash = createHash4("sha256").update(sub).digest("hex");
  const person = people[Number.parseInt(hash.slice(0, 8), 16) % people.length];
  if (!person) throw new Error("Missing fixture");
  const fingerprint = hash.slice(0, 12);
  const display = process.env.DEMO_VIEWER_NAME?.trim() || person.name;
  return {
    name: `${display} \xB7 ${fingerprint}`,
    firstName: display.split(/\s+/)[0] || display,
    role: person.role,
    avatar: person.avatar,
    fingerprint,
    identityMode: "per_member",
    synthetic: true
  };
}
function profileForIdentity(identity) {
  const parts = identity.name.trim().split(/\s+/);
  return {
    name: identity.name,
    firstName: parts[0] || identity.name,
    role: "OpenWork member",
    avatar: parts.slice(0, 2).map((part) => Array.from(part)[0]).join("").toUpperCase(),
    fingerprint: createHash4("sha256").update(JSON.stringify([identity.org_id, identity.sub])).digest("hex").slice(0, 12),
    subjectShort: identity.sub.slice(0, 12),
    identityMode: "openwork",
    synthetic: false,
    email: identity.email,
    org_id: identity.org_id
  };
}
function createPersonalProvider(subject, providerInstance = randomUUID2(), now = () => /* @__PURE__ */ new Date()) {
  const whoami = typeof subject === "string" ? profileForSubject(subject) : profileForIdentity(subject);
  const seed = Number.parseInt(whoami.fingerprint.slice(0, 8), 16);
  const person = people[seed % people.length];
  if (!person) throw new Error("Missing fixture");
  const generations = { today: 0, attention: 0, goals: 0 };
  return async (id, identity) => {
    const viewer = identity ? profileForIdentity(identity) : whoami;
    const generation = ++generations[id];
    const phase = (seed + generation) % 8;
    const topics = [
      "Discovery",
      "Design review",
      "Delivery planning",
      "Risk review",
      "Pilot feedback",
      "Readiness review",
      "Launch planning",
      "Retrospective"
    ];
    const topic = topics[phase];
    const project = `${person.project}-${whoami.fingerprint}`;
    const base2 = {
      demo: true,
      whoami: viewer,
      generation,
      generatedAt: now().toISOString(),
      providerInstance
    };
    const detail = `${viewer.name} \xB7 ${viewer.role} \xB7 ${project} \xB7 Synthetic scenario ${generation}; no customer service connected.`;
    if (id === "today")
      return {
        ...base2,
        kind: id,
        focusWindow: phase % 2 ? "2\u20133 pm" : "3\u20134 pm",
        focusNote: `${topic} preparation for ${project}`,
        meetings: [
          {
            id: `${project}-planning`,
            title: `${project}: ${topic}`,
            time: `${9 + phase % 3}:30 am`,
            detail
          },
          {
            id: `${project}-partner`,
            title: `${project}: ${phase % 2 ? "Customer workshop" : "Partner check-in"}`,
            time: "1:00 pm",
            detail
          },
          {
            id: `${project}-team`,
            title: `${project}: ${phase % 2 ? "Prototype review" : "Team decisions"}`,
            time: "4:00 pm",
            detail
          }
        ]
      };
    if (id === "attention")
      return {
        ...base2,
        kind: id,
        items: [
          {
            id: `${project}-incident`,
            title: `${project}: ${phase % 2 ? "Queue backlog" : "API latency"} incident`,
            severity: "critical",
            detail: `${detail} \xB7 Investigation ${generation}: ${topic}.`
          },
          {
            id: `${project}-approval`,
            title: `${project}: ${phase % 2 ? "Access" : "Budget"} approval`,
            severity: "review",
            detail: `${detail} \xB7 Review ${1e3 + seed % 900 + generation} synthetic units; cannot approve here.`
          },
          {
            id: `${project}-deadline`,
            title: `${project}: ${topic} due`,
            severity: "due",
            detail
          }
        ]
      };
    const progress = 35 + (seed + generation * 7) % 55;
    return {
      ...base2,
      kind: id,
      overall: progress,
      period: "Demo quarter",
      goals: [
        {
          id: `${project}-delivery`,
          title: `${project}: ${topic} milestone`,
          progress,
          detail
        },
        {
          id: `${project}-quality`,
          title: `${project}: ${phase % 2 ? "Improve response time" : "Reduce rework"}`,
          progress: Math.min(100, progress + 8),
          detail
        }
      ]
    };
  };
}
function createSyntheticProvider(now = () => /* @__PURE__ */ new Date()) {
  const generations = { today: 0, attention: 0, goals: 0 };
  const providerInstance = randomUUID2();
  return async (id) => {
    const base2 = {
      demo: true,
      generation: ++generations[id],
      generatedAt: now().toISOString(),
      providerInstance
    };
    switch (id) {
      case "today":
        return {
          ...base2,
          kind: id,
          focusWindow: "2\u20134:30 pm",
          focusNote: "Suggested demo block; pause for the 3 pm check-in.",
          meetings: [
            {
              id: "architecture",
              title: "Architecture Review",
              time: "9:30 am",
              detail: "30 min \xB7 Demo architecture team \xB7 Review the platform proposal."
            },
            {
              id: "product",
              title: "Product Sync",
              time: "11:00 am",
              detail: "45 min \xB7 Demo product team \xB7 Align on this week's priorities."
            },
            {
              id: "customer",
              title: "Customer Call",
              time: "1:30 pm",
              detail: "30 min \xB7 Fictional account \xB7 Walk through the prototype."
            },
            {
              id: "performance",
              title: "Performance check-in",
              time: "3:00 pm",
              detail: "20 min \xB7 Fictional manager \xB7 Discuss Q3 progress."
            }
          ]
        };
      case "attention":
        return {
          ...base2,
          kind: id,
          items: [
            {
              id: "incident",
              title: "P1 Incident Assigned",
              severity: "critical",
              detail: "Synthetic incident ACME-1042 \xB7 Checkout latency \xB7 Demo only, no incident system is connected."
            },
            {
              id: "payroll",
              title: "Payroll Declaration",
              severity: "due",
              detail: "Illustrative payroll declaration due Friday. This app cannot submit declarations."
            },
            {
              id: "training",
              title: "Security Training Due",
              severity: "due",
              detail: "Complete the fictional annual security course. No LMS is connected."
            },
            {
              id: "goal-update",
              title: "Goal Update Requested",
              severity: "review",
              detail: "Review your Q3 milestones. All progress in this app is synthetic."
            }
          ]
        };
      case "goals":
        return {
          ...base2,
          kind: id,
          overall: 72,
          period: "Q3",
          goals: [
            {
              id: "platform",
              title: "Deliver platform milestones",
              progress: 80,
              detail: "4 of 5 illustrative milestones complete. This is not a real performance record."
            },
            {
              id: "experience",
              title: "Improve employee experience",
              progress: 64,
              detail: "Synthetic progress: research complete, prototype in review."
            }
          ]
        };
    }
  };
}

// server/server.ts
import { McpServer } from "@modelcontextprotocol/server";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

// server/register.ts
import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE
} from "@modelcontextprotocol/ext-apps/server";
import { z as z4 } from "zod";
function registerView(server, id, loadHtml) {
  const uri = resourceUri(id);
  registerAppResource(
    server,
    definitions[id].title,
    uri,
    { mimeType: RESOURCE_MIME_TYPE },
    async () => ({
      contents: [
        {
          uri,
          mimeType: RESOURCE_MIME_TYPE,
          text: await loadHtml(id),
          _meta: { ui: { csp: { connectDomains: [], resourceDomains: [] } } }
        }
      ]
    })
  );
}
function registerWidget(server, id, options) {
  registerAppTool(
    server,
    definitions[id].tool,
    {
      title: definitions[id].title,
      description: `Open or refresh ${definitions[id].title}. Synthetic demo data; no customer services connected.`,
      inputSchema: z4.object({}).strict(),
      outputSchema: schemas[id],
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
        idempotentHint: false
      },
      _meta: {
        ui: { resourceUri: resourceUri(id), visibility: ["model", "app"] }
      }
    },
    async () => {
      try {
        const data = schemas[id].parse(await options.provider(id));
        return {
          content: [{ type: "text", text: JSON.stringify(data) }],
          structuredContent: data
        };
      } catch {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: "Widget provider failed. Retry manually; previous data can remain visible."
            }
          ]
        };
      }
    }
  );
  registerView(server, id, options.loadHtml);
}
function registerHome(server, loadHtml, provider) {
  registerAppTool(
    server,
    definitions.home.tool,
    {
      title: definitions.home.title,
      description: "Open the synthetic Acme Home with {} (layout only, no provider call), or fetch one panel with {widget: 'today' | 'attention' | 'goals'}. All panels share this home resource/security scope; no aggregate data is returned.",
      inputSchema: homeInputSchema,
      outputSchema: homeOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
        idempotentHint: false
      },
      _meta: {
        ui: { resourceUri: resourceUri("home"), visibility: ["model", "app"] }
      }
    },
    async ({ widget }) => {
      if (widget === void 0) {
        return {
          content: [
            {
              type: "text",
              text: "Synthetic Acme Home. Each panel fetches this same tool with its own widget selector. No provider was called for this layout-only launch."
            }
          ],
          structuredContent: { kind: "shell", demo: true }
        };
      }
      try {
        const data = schemas[widget].parse(await provider(widget));
        return {
          content: [{ type: "text", text: JSON.stringify(data) }],
          structuredContent: data
        };
      } catch {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: "Selected home provider failed. Retry this panel manually; previous data can remain visible."
            }
          ]
        };
      }
    }
  );
  registerView(server, "home", loadHtml);
}

// server/server.ts
var loadBuiltHtml = async (id) => {
  try {
    return await readFile(
      new URL(`../dist/${id}.html`, import.meta.url),
      "utf8"
    );
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT")
      throw error;
    return readFile(join(process.cwd(), "dist", `${id}.html`), "utf8");
  }
};
function createServer(provider = createSyntheticProvider(), loadHtml = loadBuiltHtml) {
  const server = new McpServer({ name: "acme-home-demo", version: "0.1.0" });
  for (const id of widgetIds)
    registerWidget(server, id, { provider, loadHtml });
  registerHome(server, loadHtml, provider);
  return server;
}

// server/handler.ts
var health = { ok: true, demo: true };
function isRecord2(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
async function mcpBody(req) {
  if (req.method !== "POST") return void 0;
  let body = req.body;
  if (body === void 0) {
    const chunks = [];
    let size = 0;
    for await (const value of req.iterator({ destroyOnReturn: false })) {
      const chunk = value;
      if (!Buffer.isBuffer(chunk)) throw new Error("Invalid body");
      size += chunk.length;
      if (size > 64 * 1024) throw new Error("Body too large");
      chunks.push(chunk);
    }
    body = Buffer.concat(chunks);
  }
  if (Buffer.isBuffer(body)) body = body.toString("utf8");
  if (typeof body === "string") {
    if (Buffer.byteLength(body) > 64 * 1024) throw new Error("Body too large");
    return body.length ? JSON.parse(body) : void 0;
  }
  if (Buffer.byteLength(JSON.stringify(body)) > 64 * 1024)
    throw new Error("Body too large");
  return body;
}
function publicMetadata(body) {
  if (!isRecord2(body) || body.jsonrpc !== "2.0") return false;
  if ([
    "initialize",
    "notifications/initialized",
    "tools/list",
    "resources/list",
    "resources/templates/list"
  ].includes(String(body.method)))
    return true;
  const views = ["today", "attention", "goals", "home"];
  return body.method === "resources/read" && isRecord2(body.params) && views.some(
    (id) => isRecord2(body.params) && body.params.uri === resourceUri(id)
  );
}
function createHandler(options = {}) {
  const required2 = options.authRequired ?? process.env.AUTH_REQUIRED !== "false";
  const oauth = required2 ? createOAuth(options) : void 0;
  const shared = createSyntheticProvider();
  const sharedServer = options.sharedServer ?? (() => createServer(shared));
  const providers = /* @__PURE__ */ new Map();
  const instance = randomUUID3();
  return async (req, res) => {
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    if (oauth && await oauth.handle(req, res)) return;
    const path = req.url?.split("?")[0];
    if (path === "/healthz") {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(health));
      return;
    }
    if (path !== "/mcp" && path !== "/api/mcp") {
      res.statusCode = 404;
      res.end("Not found");
      return;
    }
    const unauthorized = () => {
      res.statusCode = 401;
      res.setHeader(
        "WWW-Authenticate",
        oauth ? `Bearer resource_metadata="${oauth.metadata.authorizationServer.issuer}/.well-known/oauth-protected-resource", scope="home:read", error="invalid_token"` : 'Bearer error="invalid_token"'
      );
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: "Connect to personalize" }));
    };
    let identity;
    if (req.headers.authorization !== void 0) {
      try {
        const token = /^Bearer ([A-Za-z0-9._~-]+)$/i.exec(
          req.headers.authorization
        )?.[1];
        if (!token || !oauth) throw new Error("Invalid bearer");
        identity = await oauth.verifyAccessToken(token);
      } catch {
        unauthorized();
        return;
      }
    }
    try {
      req.body = await mcpBody(req);
    } catch {
      res.statusCode = 400;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: "Invalid MCP request body" }));
      return;
    }
    if (required2 && !identity && !publicMetadata(req.body)) {
      unauthorized();
      return;
    }
    if (required2 && req.headers.origin !== void 0) {
      res.statusCode = 403;
      res.end("Use a host-mediated MCP connection");
      return;
    }
    if (req.method !== "POST") {
      rejectNonPost(res);
      return;
    }
    let factory = sharedServer;
    if (identity) {
      const subject = "org_id" in identity ? identity : identity.sub;
      const key = typeof subject === "string" ? subject : JSON.stringify([subject.org_id, subject.sub]);
      let provider = providers.get(key);
      if (!provider) {
        provider = createPersonalProvider(subject, instance);
        providers.set(key, provider);
      }
      const selected = provider;
      const verifiedIdentity = typeof subject === "string" ? void 0 : subject;
      factory = () => createServer((id) => selected(id, verifiedIdentity));
    }
    await handleMcpPost(factory, req, res, req.body);
  };
}
var configured;
async function handler(req, res) {
  try {
    configured ??= createHandler();
    await configured(req, res);
  } catch {
    if (!res.headersSent) {
      res.statusCode = 503;
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: "Demo configuration unavailable" }));
    }
  }
}
async function handleMcpPost(createServer2, req, res, parsedBody) {
  const server = createServer2();
  const transport = new NodeStreamableHTTPServerTransport({
    sessionIdGenerator: void 0,
    enableJsonResponse: true
  });
  res.on("close", () => {
    void transport.close();
    void server.close();
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, parsedBody);
  } catch {
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: null,
          error: { code: -32603, message: "MCP request failed" }
        })
      );
    }
  }
}
function rejectNonPost(res) {
  res.statusCode = 405;
  res.setHeader("Allow", "POST");
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.end("Use stateless MCP POST");
}
export {
  handler as default
};
