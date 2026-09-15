import {
  createHash,
  createPrivateKey,
  createPublicKey,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { jwtVerify, SignJWT, type JWTPayload } from "jose";

export type OAuthRequest = IncomingMessage & { body?: unknown };
import {
  createUpstream,
  CALLBACK_PATH,
  realIdentitySchema,
  type DownstreamRequest,
  type OpenWorkIdentity,
} from "./upstream.ts";

export type OAuthOptions = {
  issuer?: string;
  privateKeyPem?: string;
  identityMode?: "openwork" | "demo";
  upstreamIssuer?: string;
};
export type AccessIdentity = { sub: string } | OpenWorkIdentity;
const SCOPE = "home:read";
const BODY_LIMIT = 16 * 1024;
const CODE_TTL = 60;
const ACCESS_TTL = 3600;
const CLIENT_TTL = 30 * 24 * 3600;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const TYPES = { code: "oauth-authz-code+jwt", access: "at+jwt" };
type TokenKind = keyof typeof TYPES;
class OAuthError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}
function invalid(code = "invalid_request"): never {
  throw new OAuthError(400, code);
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function validIssuer(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      (url.protocol === "https:" ||
        /^http:\/\/127\.0\.0\.1(?::\d+)?$/.test(value)) &&
      url.origin === value
    );
  } catch {
    return false;
  }
}
function validRedirect(value: string): boolean {
  try {
    const url = new URL(value);
    const authority = /^https?:\/\/([^/?#]+)/i.exec(value)?.[1];
    return (
      authority !== undefined &&
      !/[\s\\]/.test(value) &&
      !value.includes("#") &&
      !url.username &&
      !url.password &&
      !authority.includes("@") &&
      (url.protocol === "https:" ||
        (url.protocol === "http:" &&
          /^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(authority)))
    );
  } catch {
    return false;
  }
}
function redirectUris(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 10)
    invalid("invalid_redirect_uri");
  const result: string[] = [];
  for (const item of value) {
    if (typeof item !== "string" || !validRedirect(item))
      invalid("invalid_redirect_uri");
    result.push(item);
  }
  if (Buffer.byteLength(JSON.stringify(result)) > 2048)
    invalid("invalid_redirect_uri");
  return result;
}
function parameters(
  value: URLSearchParams | Record<string, unknown>,
): Map<string, string> {
  const result = new Map<string, string>();
  const entries =
    value instanceof URLSearchParams ? value.entries() : Object.entries(value);
  for (const [name, item] of entries) {
    if (typeof item !== "string" || result.has(name)) invalid();
    result.set(name, item);
  }
  return result;
}
function required(params: Map<string, string>, name: string): string {
  const value = params.get(name);
  if (!value) invalid();
  return value;
}
async function readBody(
  req: OAuthRequest,
  format: "json" | "form",
): Promise<unknown> {
  const mediaType = req.headers["content-type"]
    ?.split(";")[0]
    ?.trim()
    .toLowerCase();
  if (
    mediaType !==
    (format === "json"
      ? "application/json"
      : "application/x-www-form-urlencoded")
  )
    throw new OAuthError(415, "invalid_request");
  const length = req.headers["content-length"];
  if (
    length !== undefined &&
    (!/^\d+$/.test(length) || Number(length) > BODY_LIMIT)
  )
    throw new OAuthError(413, "invalid_request");
  let body: unknown = req.body;
  if (body === undefined) {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const value of req.iterator({ destroyOnReturn: false })) {
      const chunk: unknown = value;
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
  let serialized: string;
  try {
    serialized = JSON.stringify(body);
  } catch {
    invalid();
  }
  if (Buffer.byteLength(serialized) > BODY_LIMIT)
    throw new OAuthError(413, "invalid_request");
  return body;
}
function json(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}
export function createOAuth(options: OAuthOptions = {}) {
  const configuredIssuer =
    options.issuer ??
    process.env.DEMO_AS_ISSUER ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined);
  const pem = options.privateKeyPem ?? process.env.DEMO_AS_PRIVATE_KEY;
  if (!configuredIssuer || !validIssuer(configuredIssuer))
    throw new Error(
      "DEMO_AS_ISSUER must be an HTTPS origin without a trailing slash",
    );
  const issuer: string = configuredIssuer;
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
  const identityMode =
    options.identityMode ?? process.env.IDENTITY_MODE ?? "openwork";
  if (identityMode !== "openwork" && identityMode !== "demo")
    throw new Error("IDENTITY_MODE must be openwork or demo");
  const upstream =
    identityMode === "openwork"
      ? createUpstream(
          issuer,
          privateKey,
          options.upstreamIssuer ?? process.env.UPSTREAM_ISSUER,
        )
      : undefined;
  const description =
    identityMode === "demo"
      ? "demo authorization server: accepts every request; codes are short-lived, not single-use"
      : "OpenWork OIDC identity; synthetic work data; downstream codes are short-lived, not single-use";
  const publicKey = createPublicKey(privateKey);
  const kid = createHash("sha256")
    .update(publicKey.export({ format: "der", type: "spki" }))
    .digest("base64url");
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
      client_id_metadata_document_supported: false,
    },
    protectedResource: {
      resource,
      authorization_servers: [issuer],
      scopes_supported: [SCOPE],
      bearer_methods_supported: ["header"],
      resource_name: "Employee Home (demo)",
      description,
      identity_mode: identityMode,
    },
    jwks: {
      keys: [
        {
          ...publicKey.export({ format: "jwk" }),
          kid,
          alg: "EdDSA",
          use: "sig",
        },
      ],
    },
  };
  async function sign(kind: TokenKind, claims: JWTPayload): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    return new SignJWT({
      ...claims,
      token_kind: kind,
      identity_mode: identityMode,
    })
      .setProtectedHeader({ alg: "EdDSA", typ: TYPES[kind], kid })
      .setIssuer(issuer)
      .setAudience(audiences[kind])
      .setIssuedAt(now)
      .setExpirationTime(now + lifetimes[kind])
      .setJti(randomUUID())
      .sign(privateKey);
  }
  async function verify(token: string, kind: TokenKind): Promise<JWTPayload> {
    const { payload, protectedHeader } = await jwtVerify(token, publicKey, {
      algorithms: ["EdDSA"],
      issuer,
      audience: audiences[kind],
      typ: TYPES[kind],
      requiredClaims: ["iss", "aud", "iat", "exp", "jti", "token_kind"],
      maxTokenAge: lifetimes[kind],
    });
    const now = Math.floor(Date.now() / 1000);
    if (
      payload.iss !== issuer ||
      payload.aud !== audiences[kind] ||
      payload.token_kind !== kind ||
      payload.identity_mode !== identityMode ||
      protectedHeader.kid !== kid ||
      typeof payload.iat !== "number" ||
      typeof payload.exp !== "number" ||
      !Number.isSafeInteger(payload.iat) ||
      !Number.isSafeInteger(payload.exp) ||
      payload.iat > now ||
      payload.exp <= payload.iat ||
      payload.exp - payload.iat > lifetimes[kind] ||
      typeof payload.jti !== "string" ||
      !UUID.test(payload.jti)
    )
      throw new Error("Invalid token");
    return payload;
  }
  const redirectHash = (redirect: string) =>
    createHash("sha256")
      .update(`demo-dcr-v1\0${issuer}\0${redirect}`)
      .digest()
      .subarray(0, 16)
      .toString("base64url");
  async function registerClientId(redirects: string[]): Promise<string> {
    const payload = {
      r: redirects.map(redirectHash),
      e: Math.floor(Date.now() / 1000) + CLIENT_TTL,
      n: randomBytes(12).toString("base64url"),
    };
    const token = `c1.${await new SignJWT(payload).setProtectedHeader({ alg: "EdDSA" }).sign(privateKey)}`;
    if (token.length > 512) invalid("invalid_client_metadata");
    return token;
  }
  async function verifyClient(token: string): Promise<string[]> {
    try {
      if (!token.startsWith("c1.") || token.length > 512) invalid();
      const { payload } = await jwtVerify(token.slice(3), publicKey, {
        algorithms: ["EdDSA"],
      });
      const now = Math.floor(Date.now() / 1000);
      if (
        !Number.isSafeInteger(payload.e) ||
        typeof payload.e !== "number" ||
        payload.e <= now ||
        payload.e > now + CLIENT_TTL ||
        typeof payload.n !== "string" ||
        !/^[A-Za-z0-9_-]{16}$/.test(payload.n) ||
        !Array.isArray(payload.r) ||
        payload.r.length === 0 ||
        payload.r.length > 10
      )
        invalid();
      const hashes: string[] = [];
      for (const value of payload.r) {
        if (
          typeof value !== "string" ||
          !/^[A-Za-z0-9_-]{22}$/.test(value) ||
          Buffer.from(value, "base64url").toString("base64url") !== value
        )
          invalid();
        hashes.push(value);
      }
      return hashes;
    } catch {
      invalid("invalid_client");
    }
  }
  function identityClaims(payload: JWTPayload): AccessIdentity {
    if (identityMode === "openwork")
      return realIdentitySchema.parse({
        identityMode: "openwork",
        sub: payload.sub,
        name: payload.name,
        email: payload.email,
        org_id: payload.org_id,
      });
    if (typeof payload.sub !== "string" || !UUID.test(payload.sub))
      throw new Error("Invalid demo subject");
    return { sub: payload.sub };
  }
  async function verifyAccessToken(token: string): Promise<AccessIdentity> {
    try {
      const payload = await verify(token, "access");
      if (payload.scope !== SCOPE || payload.resource !== resource)
        throw new Error();
      return identityClaims(payload);
    } catch {
      throw new Error("Invalid access token");
    }
  }
  async function issueCode(
    res: ServerResponse,
    downstream: DownstreamRequest,
    identity: AccessIdentity,
  ) {
    const code = await sign("code", {
      ...downstream,
      ...identity,
      code_challenge_method: "S256",
      scope: SCOPE,
    });
    const destination = new URL(downstream.redirect_uri);
    destination.searchParams.set("code", code);
    destination.searchParams.delete("state");
    if (downstream.state !== undefined)
      destination.searchParams.set("state", downstream.state);
    res.statusCode = 302;
    res.setHeader("Location", destination.href);
    res.end();
  }
  async function register(req: OAuthRequest, res: ServerResponse) {
    const body = await readBody(req, "json");
    if (!isRecord(body)) invalid();
    const redirects = redirectUris(body.redirect_uris);
    if (
      body.token_endpoint_auth_method !== undefined &&
      body.token_endpoint_auth_method !== "none"
    )
      invalid("invalid_client_metadata");
    const grants = body.grant_types;
    if (
      grants !== undefined &&
      (!Array.isArray(grants) ||
        !grants.includes("authorization_code") ||
        grants.some(
          (grant) =>
            grant !== "authorization_code" && grant !== "refresh_token",
        ))
    )
      invalid("invalid_client_metadata");
    const responses = body.response_types;
    if (
      responses !== undefined &&
      (!Array.isArray(responses) ||
        responses.length !== 1 ||
        responses[0] !== "code")
    )
      invalid("invalid_client_metadata");
    if (body.scope !== undefined && body.scope !== SCOPE)
      invalid("invalid_scope");
    const clientId = await registerClientId(redirects);
    json(res, 201, {
      client_id: clientId,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      redirect_uris: redirects,
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code"],
      response_types: ["code"],
      scope: SCOPE,
    });
  }
  async function authorize(url: URL, res: ServerResponse) {
    const params = parameters(url.searchParams);
    const clientId = required(params, "client_id");
    const redirectHashes = await verifyClient(clientId);
    const redirect = required(params, "redirect_uri");
    if (
      !validRedirect(redirect) ||
      !redirectHashes.includes(redirectHash(redirect))
    )
      invalid("invalid_redirect_uri");
    if (required(params, "response_type") !== "code")
      invalid("unsupported_response_type");
    if (required(params, "resource") !== resource) invalid("invalid_target");
    if (params.has("scope") && params.get("scope") !== SCOPE)
      invalid("invalid_scope");
    if (params.has("response_mode") && params.get("response_mode") !== "query")
      invalid();
    const challenge = required(params, "code_challenge");
    if (
      params.get("code_challenge_method") !== "S256" ||
      !/^[A-Za-z0-9_-]{43}$/.test(challenge) ||
      Buffer.from(challenge, "base64url").toString("base64url") !== challenge
    )
      invalid();
    const state = params.get("state");
    if (state !== undefined && state.length > 1024) invalid();
    const downstream = {
      client_id: clientId,
      redirect_uri: redirect,
      resource,
      code_challenge: challenge,
      state,
    };
    if (upstream) {
      try {
        await upstream.begin(res, downstream);
      } catch {
        throw new OAuthError(502, "upstream_unavailable");
      }
    } else await issueCode(res, downstream, { sub: randomUUID() });
  }
  async function token(req: OAuthRequest, res: ServerResponse) {
    const body = await readBody(req, "form");
    if (!(body instanceof URLSearchParams) && !isRecord(body)) invalid();
    const params = parameters(body);
    if (
      req.headers.authorization !== undefined ||
      params.has("client_secret") ||
      params.has("client_assertion")
    )
      invalid("invalid_client");
    if (required(params, "grant_type") !== "authorization_code")
      invalid("unsupported_grant_type");
    const clientId = required(params, "client_id");
    const redirectHashes = await verifyClient(clientId);
    const redirect = required(params, "redirect_uri");
    if (
      !validRedirect(redirect) ||
      !redirectHashes.includes(redirectHash(redirect))
    )
      invalid("invalid_grant");
    if (required(params, "resource") !== resource) invalid("invalid_target");
    if (params.has("scope") && params.get("scope") !== SCOPE)
      invalid("invalid_scope");
    const code = required(params, "code");
    const verifier = required(params, "code_verifier");
    let claims: JWTPayload;
    try {
      claims = await verify(code, "code");
      identityClaims(claims);
      if (
        claims.client_id !== clientId ||
        claims.redirect_uri !== redirect ||
        claims.resource !== resource ||
        claims.scope !== SCOPE ||
        claims.code_challenge_method !== "S256" ||
        typeof claims.code_challenge !== "string" ||
        !/^[A-Za-z0-9_-]{43}$/.test(claims.code_challenge) ||
        !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)
      )
        throw new Error();
      const actual = createHash("sha256").update(verifier).digest("base64url");
      if (
        !timingSafeEqual(
          Buffer.from(actual),
          Buffer.from(claims.code_challenge),
        )
      )
        throw new Error();
    } catch {
      invalid("invalid_grant");
    }
    const accessToken = await sign("access", {
      ...identityClaims(claims),
      scope: SCOPE,
      resource,
    });
    json(res, 200, {
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: ACCESS_TTL,
      scope: SCOPE,
    });
  }
  async function handle(
    req: OAuthRequest,
    res: ServerResponse,
  ): Promise<boolean> {
    const path = req.url?.split("?")[0];
    const routes = new Map([
      ["/.well-known/oauth-authorization-server", "GET"],
      ["/.well-known/oauth-protected-resource", "GET"],
      ["/.well-known/oauth-protected-resource/mcp", "GET"],
      ["/jwks.json", "GET"],
      ["/.well-known/jwks.json", "GET"],
      ["/register", "POST"],
      ["/authorize", "GET"],
      ["/token", "POST"],
      [CALLBACK_PATH, "GET"],
    ]);
    if (!path || !routes.has(path)) return false;
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
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
          );
          await issueCode(res, result.downstream, result.identity);
        } catch {
          invalid("invalid_grant");
        }
      } else if (path === "/token") await token(req, res);
      else if (path === "/jwks.json" || path === "/.well-known/jwks.json")
        json(res, 200, metadata.jwks);
      else if (path === "/.well-known/oauth-authorization-server")
        json(res, 200, metadata.authorizationServer);
      else json(res, 200, metadata.protectedResource);
    } catch (error) {
      if (!res.headersSent) {
        if (error instanceof OAuthError && error.status === 413)
          res.setHeader("Connection", "close");
        json(res, error instanceof OAuthError ? error.status : 500, {
          error: error instanceof OAuthError ? error.code : "server_error",
        });
      }
    }
    return true;
  }
  return { handle, verifyAccessToken, metadata };
}
