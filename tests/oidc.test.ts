import assert from "node:assert/strict";
import {
  createHash,
  generateKeyPairSync,
  hkdfSync,
  randomUUID,
} from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { test, type TestContext } from "node:test";
import { EncryptJWT, jwtDecrypt, decodeJwt, SignJWT } from "jose";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createHandler, type HandlerOptions } from "../server/handler.ts";
import { createOAuth } from "../server/oauth.ts";
import {
  CALLBACK_PATH,
  ORG_CLAIM,
  upstreamIssuer,
  type OpenWorkIdentity,
} from "../server/upstream.ts";
import {
  definitions,
  payloadSchema,
  widgetIds,
  type Payload,
} from "../shared/contract.ts";
import { WidgetController } from "../src/controller.ts";
import { Dashboard } from "../src/ui.tsx";
import { verifyHosted } from "../scripts/verify-hosted.ts";

const home = "home";
const appIssuer = "https://employee.example.test";
const resource = `${appIssuer}/mcp`;
const redirect = "http://127.0.0.1:5432/host-callback?keep=yes";
const verifier = "v".repeat(43);
const privateKey = generateKeyPairSync("ed25519").privateKey;
const privateKeyPem = privateKey
  .export({ format: "pem", type: "pkcs8" })
  .toString();
const alice: OpenWorkIdentity = {
  identityMode: "openwork",
  sub: "usr-alice-opaque-123",
  name: "Alice Martin",
  email: "alice@example.test",
  org_id: "org-north",
};
const bob: OpenWorkIdentity = {
  identityMode: "openwork",
  sub: "usr-bob-opaque-456",
  name: "Bob Laurent",
  email: "bob@example.test",
  org_id: "org-north",
};
function text(value: unknown): string {
  assert.equal(typeof value, "string");
  if (typeof value !== "string") throw new Error("Expected string");
  return value;
}
function record(value: unknown): Record<string, unknown> {
  assert.ok(value && typeof value === "object" && !Array.isArray(value));
  return Object.fromEntries(Object.entries(value));
}
async function body(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const value of req) chunks.push(Buffer.from(value));
  return Buffer.concat(chunks).toString("utf8");
}
function json(res: ServerResponse, status: number, value: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(value));
}
async function listen(
  t: TestContext,
  handler: (req: IncomingMessage, res: ServerResponse) => void,
) {
  const server = createServer(handler).listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return `http://127.0.0.1:${address.port}`;
}
async function stub(t: TestContext) {
  const pair = generateKeyPairSync("ed25519");
  const clients = new Map<string, string>();
  const codes = new Map<
    string,
    {
      client: string;
      redirect: string;
      challenge: string;
      nonce: string;
      user: OpenWorkIdentity;
    }
  >();
  const accesses = new Map<string, OpenWorkIdentity>();
  const patches: {
    patch: Record<string, unknown>;
    omit: string[];
    metadataPatch: Record<string, unknown>;
    userinfoPatch: Record<string, unknown>;
  } = { patch: {}, omit: [], metadataPatch: {}, userinfoPatch: {} };
  const state = {
    user: alice,
    registrations: 0,
    discoveryCalls: 0,
    tokenCalls: 0,
    userinfoCalls: 0,
    pkceFailures: 0,
    rejectPkce: false,
    wrongSignature: false,
    redirectDiscovery: false,
    largeDiscovery: false,
    largeToken: false,
    ...patches,
    lastIdToken: "",
  };
  let issuer = "";
  const base = await listen(t, (req, res) => {
    void (async () => {
      const url = new URL(req.url ?? "/", issuer);
      if (url.pathname === "/oidc/.well-known/openid-configuration") {
        state.discoveryCalls++;
        if (state.redirectDiscovery) {
          res.statusCode = 302;
          res.setHeader("Location", "https://untrusted.invalid/metadata");
          res.end();
          return;
        }
        if (state.largeDiscovery) {
          json(res, 200, { padding: "x".repeat(65536) });
          return;
        }
        json(res, 200, {
          issuer,
          authorization_endpoint: `${issuer}/authorize`,
          token_endpoint: `${issuer}/token`,
          registration_endpoint: `${issuer}/register`,
          jwks_uri: `${issuer}/jwks`,
          userinfo_endpoint: `${issuer}/userinfo`,
          code_challenge_methods_supported: ["S256"],
          token_endpoint_auth_methods_supported: ["none"],
          id_token_signing_alg_values_supported: ["EdDSA"],
          ...state.metadataPatch,
        });
        return;
      }
      if (url.pathname === "/oidc/register") {
        const registration = record(JSON.parse(await body(req)));
        assert.equal(registration.scope, "openid profile email");
        assert.equal(registration.token_endpoint_auth_method, "none");
        assert.deepEqual(registration.grant_types, ["authorization_code"]);
        assert.ok(Array.isArray(registration.redirect_uris));
        const callback = text(registration.redirect_uris[0]);
        assert.equal(callback, `${appIssuer}${CALLBACK_PATH}`);
        const client = randomUUID();
        clients.set(client, callback);
        state.registrations++;
        json(res, 201, {
          client_id: client,
          redirect_uris: [callback],
          token_endpoint_auth_method: "none",
        });
        return;
      }
      if (url.pathname === "/oidc/authorize") {
        const client = text(url.searchParams.get("client_id"));
        const callback = text(url.searchParams.get("redirect_uri"));
        assert.equal(clients.get(client), callback);
        assert.equal(url.searchParams.get("code_challenge_method"), "S256");
        assert.equal(url.searchParams.get("scope"), "openid profile email");
        const code = randomUUID();
        codes.set(code, {
          client,
          redirect: callback,
          challenge: text(url.searchParams.get("code_challenge")),
          nonce: text(url.searchParams.get("nonce")),
          user: { ...state.user },
        });
        const destination = new URL(callback);
        destination.searchParams.set("code", code);
        destination.searchParams.set(
          "state",
          text(url.searchParams.get("state")),
        );
        res.statusCode = 302;
        res.setHeader("Location", destination.href);
        res.end();
        return;
      }
      if (url.pathname === "/oidc/token") {
        state.tokenCalls++;
        const params = new URLSearchParams(await body(req));
        const code = text(params.get("code"));
        const saved = codes.get(code);
        codes.delete(code);
        if (
          !saved ||
          saved.client !== params.get("client_id") ||
          saved.redirect !== params.get("redirect_uri") ||
          params.get("grant_type") !== "authorization_code"
        ) {
          json(res, 400, { error: "invalid_grant" });
          return;
        }
        if (
          state.rejectPkce ||
          createHash("sha256")
            .update(text(params.get("code_verifier")))
            .digest("base64url") !== saved.challenge
        ) {
          state.pkceFailures++;
          json(res, 400, { error: "invalid_grant" });
          return;
        }
        if (state.largeToken) {
          json(res, 200, { padding: "x".repeat(65536) });
          return;
        }
        const claims: Record<string, unknown> = {
          iss: issuer,
          aud: saved.client,
          sub: saved.user.sub,
          name: saved.user.name,
          email: saved.user.email,
          [ORG_CLAIM]: saved.user.org_id,
          nonce: saved.nonce,
          iat: Math.floor(Date.now() / 1000),
          exp: Math.floor(Date.now() / 1000) + 300,
          ...state.patch,
        };
        for (const key of state.omit) delete claims[key];
        const idToken = await new SignJWT(claims)
          .setProtectedHeader({ alg: "EdDSA", kid: "stub-key" })
          .sign(
            state.wrongSignature
              ? generateKeyPairSync("ed25519").privateKey
              : pair.privateKey,
          );
        state.lastIdToken = idToken;
        const access = randomUUID();
        accesses.set(access, saved.user);
        json(res, 200, {
          id_token: idToken,
          access_token: access,
          token_type: "Bearer",
        });
        return;
      }
      if (url.pathname === "/oidc/jwks") {
        json(res, 200, {
          keys: [
            {
              ...pair.publicKey.export({ format: "jwk" }),
              kid: "stub-key",
              alg: "EdDSA",
              use: "sig",
            },
          ],
        });
        return;
      }
      if (url.pathname === "/oidc/userinfo") {
        state.userinfoCalls++;
        const user = accesses.get(
          (req.headers.authorization ?? "").replace(/^Bearer /, ""),
        );
        if (!user) {
          json(res, 401, { error: "invalid_token" });
          return;
        }
        json(res, 200, {
          sub: user.sub,
          name: user.name,
          email: user.email,
          [ORG_CLAIM]: user.org_id,
          ...state.userinfoPatch,
        });
        return;
      }
      json(res, 404, { error: "not_found" });
    })().catch(() => json(res, 500, { error: "stub_failed" }));
  });
  issuer = `${base}/oidc`;
  return { issuer, state, privateKey: pair.privateKey };
}
async function app(t: TestContext, issuer: string, extra: HandlerOptions = {}) {
  const handler = createHandler({
    issuer: appIssuer,
    privateKeyPem,
    upstreamIssuer: issuer,
    identityMode: "openwork",
    ...extra,
  });
  return listen(t, (req, res) => {
    void handler(req, res);
  });
}
async function begin(base: string) {
  const registered = await fetch(`${base}/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      redirect_uris: [redirect],
      token_endpoint_auth_method: "none",
    }),
  });
  assert.equal(registered.status, 201);
  const client = text(record(await registered.json()).client_id);
  const params = new URLSearchParams({
    client_id: client,
    redirect_uri: redirect,
    resource,
    response_type: "code",
    code_challenge_method: "S256",
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    state: "downstream-state",
  });
  const response = await fetch(`${base}/authorize?${params}`, {
    redirect: "manual",
  });
  return { client, params, response };
}
async function upstreamApproval(start: Awaited<ReturnType<typeof begin>>) {
  assert.equal(start.response.status, 302);
  const location = text(start.response.headers.get("location"));
  const response = await fetch(location, { redirect: "manual" });
  assert.equal(response.status, 302);
  const cookie = text(start.response.headers.get("set-cookie")).split(";")[0];
  assert.ok(cookie);
  return {
    ...start,
    callback: new URL(text(response.headers.get("location"))),
    cookie,
    upstreamUrl: new URL(location),
  };
}
async function callback(
  base: string,
  flow: Awaited<ReturnType<typeof upstreamApproval>>,
  cookie = flow.cookie,
  url = flow.callback,
) {
  return fetch(`${base}${url.pathname}${url.search}`, {
    headers: cookie ? { Cookie: cookie } : {},
    redirect: "manual",
  });
}
function exchange(
  base: string,
  client: string,
  code: string,
  changes: Record<string, string> = {},
) {
  return fetch(`${base}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: client,
      code,
      grant_type: "authorization_code",
      redirect_uri: redirect,
      resource,
      code_verifier: verifier,
      ...changes,
    }),
  });
}
async function flow(base: string, callbackBase = base) {
  const started = await upstreamApproval(await begin(base));
  const completed = await callback(callbackBase, started);
  assert.equal(completed.status, 302);
  assert.match(text(completed.headers.get("set-cookie")), /Max-Age=0/);
  const destination = new URL(text(completed.headers.get("location")));
  assert.equal(
    destination.origin + destination.pathname,
    new URL(redirect).origin + new URL(redirect).pathname,
  );
  assert.equal(destination.searchParams.get("state"), "downstream-state");
  assert.equal(destination.searchParams.get("keep"), "yes");
  const code = text(destination.searchParams.get("code"));
  const response = await exchange(base, started.client, code);
  assert.equal(response.status, 200);
  return {
    token: text(record(await response.json()).access_token),
    code,
    client: started.client,
    started,
  };
}
async function rpc(
  base: string,
  token: string | undefined,
  name: string,
  args: Record<string, unknown> = {},
) {
  return fetch(`${base}/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name, arguments: args },
    }),
  });
}
async function data(
  base: string,
  token: string,
  widget: (typeof widgetIds)[number],
) {
  const response = await rpc(base, token, definitions[home].tool, { widget });
  assert.equal(response.status, 200);
  return payloadSchema.parse(
    record(record(await response.json()).result).structuredContent,
  );
}
const rows = (value: Payload) =>
  value.kind === "today"
    ? value.meetings
    : value.kind === "attention"
      ? value.items
      : value.goals;
async function rejected(response: Response) {
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "invalid_grant" });
  assert.equal(response.headers.get("location"), null);
  assert.match(text(response.headers.get("set-cookie")), /Max-Age=0/);
}

test("hosted verifier reports real identity proof incomplete without attempting DCR or sign-in", () => {
  const oauth = createOAuth({
    issuer: appIssuer,
    privateKeyPem,
    identityMode: "openwork",
  });
  const called: string[] = [];
  const response = (status: number, value: unknown) => ({
    status,
    headers: new Map([
      ["www-authenticate", "Bearer resource_metadata=fixture"],
    ]),
    json: () => value,
  });
  const result = verifyHosted(appIssuer, (url, options) => {
    const path = new URL(url).pathname;
    called.push(path);
    if (path === "/.well-known/oauth-authorization-server")
      return response(200, oauth.metadata.authorizationServer);
    if (path === "/.well-known/oauth-protected-resource")
      return response(200, oauth.metadata.protectedResource);
    if (path === "/.well-known/jwks.json")
      return response(200, oauth.metadata.jwks);
    assert.equal(path, "/mcp");
    const request = record(JSON.parse(options?.body ?? "{}"));
    if (request.method === "tools/call") return response(401, {});
    if (request.method === "tools/list")
      return response(200, { result: { tools: Object.values(definitions) } });
    assert.equal(request.method, "resources/read");
    return response(200, {
      result: {
        contents: [
          { text: "viewer-identity -generation Connect to personalize" },
        ],
      },
    });
  });
  assert.equal(result.status, "INCOMPLETE");
  assert.equal(result.flows, 0);
  assert.ok(!called.includes("/register") && !called.includes("/authorize"));
});

test("real OIDC maps verified name/email/org/sub and survives callback on another app instance", async (t) => {
  const upstream = await stub(t);
  const base = await app(t, upstream.issuer);
  const other = await app(t, upstream.issuer);
  const result = await flow(base, other);
  const claims = decodeJwt(result.token);
  assert.equal(claims.iss, appIssuer);
  assert.equal(claims.aud, resource);
  assert.equal(claims.identity_mode, "openwork");
  for (const field of ["sub", "name", "email", "org_id"] as const)
    assert.equal(claims[field], alice[field]);
  assert.equal(decodeJwt(result.code).sub, alice.sub);
  assert.equal(upstream.state.registrations, 1);
  await flow(base);
  assert.equal(upstream.state.registrations, 1);
  await flow(other);
  assert.equal(
    upstream.state.registrations,
    2,
    "Cold instance registers once when starting its own authorization",
  );
  const cookie = text(result.started.response.headers.get("set-cookie"));
  for (const flag of [
    "__Host-openwork-transaction=",
    "HttpOnly",
    "SameSite=Lax",
    "Secure",
    "Path=/",
    "Max-Age=300",
  ])
    assert.ok(cookie.includes(flag));
  assert.ok(
    !cookie.includes(result.client) &&
      !cookie.includes("downstream-state") &&
      !cookie.includes(alice.email),
  );
  assert.notEqual(
    result.started.upstreamUrl.searchParams.get("state"),
    "downstream-state",
  );
  assert.notEqual(
    result.started.upstreamUrl.searchParams.get("code_challenge"),
    result.started.params.get("code_challenge"),
  );
  assert.deepEqual(
    await createOAuth({
      issuer: appIssuer,
      privateKeyPem,
      upstreamIssuer: upstream.issuer,
      identityMode: "openwork",
    }).verifyAccessToken(result.token),
    alice,
  );
});

test("two real names and org|sub keys isolate every set and generation without synthetic identity suffixes", async (t) => {
  const upstream = await stub(t);
  const base = await app(t, upstream.issuer);
  const a = await flow(base);
  upstream.state.user = bob;
  const b = await flow(base);
  upstream.state.user = { ...alice, org_id: "org-south" };
  const c = await flow(base);
  for (const widget of widgetIds) {
    const one = await data(base, a.token, widget);
    const two = await data(base, b.token, widget);
    const three = await data(base, c.token, widget);
    assert.equal(one.whoami?.name, alice.name);
    assert.equal(two.whoami?.name, bob.name);
    assert.equal(one.whoami?.synthetic, false);
    assert.equal(one.whoami?.subjectShort, alice.sub.slice(0, 12));
    assert.notDeepEqual(rows(one), rows(two));
    assert.notDeepEqual(rows(one), rows(three));
    assert.equal(one.generation, 1);
    assert.equal(two.generation, 1);
    assert.equal(three.generation, 1);
    const refreshed = await data(base, a.token, widget);
    assert.equal(refreshed.generation, 2);
    assert.notDeepEqual(rows(refreshed), rows(one));
    assert.equal(refreshed.whoami?.name, alice.name);
  }
  upstream.state.user = { ...alice, name: "Alice Updated" };
  const renamed = await flow(base);
  const updated = await data(base, renamed.token, "today");
  assert.equal(updated.whoami?.name, "Alice Updated");
  assert.equal(updated.generation, 3);
});

test("bad ID token issuer/audience/signature/nonce/expiry and unbounded/missing identity claims fail closed", async (t) => {
  const upstream = await stub(t);
  const base = await app(t, upstream.issuer);
  for (const patch of [
    { iss: "https://wrong.invalid" },
    { aud: "other-client" },
    { aud: ["other-client"] },
    { nonce: "x".repeat(43) },
    { exp: 1 },
    { sub: "" },
    { sub: "x".repeat(257) },
    { name: "x".repeat(257) },
    { email: "" },
    { [ORG_CLAIM]: "" },
  ]) {
    upstream.state.patch = patch;
    const started = await upstreamApproval(await begin(base));
    await rejected(await callback(base, started));
  }
  upstream.state.patch = {};
  upstream.state.wrongSignature = true;
  await rejected(
    await callback(base, await upstreamApproval(await begin(base))),
  );
  upstream.state.wrongSignature = false;
  for (const claim of ["nonce", "sub", "iss", "aud", "exp", ORG_CLAIM]) {
    upstream.state.omit = [claim];
    await rejected(
      await callback(base, await upstreamApproval(await begin(base))),
    );
  }
});

test("userinfo must match verified sub and org; profile fallback only follows verified ID token", async (t) => {
  const upstream = await stub(t);
  const base = await app(t, upstream.issuer);
  for (const userinfoPatch of [
    { sub: bob.sub },
    { [ORG_CLAIM]: "other-org" },
    { org_id: "other-org" },
  ]) {
    upstream.state.userinfoPatch = userinfoPatch;
    await rejected(
      await callback(base, await upstreamApproval(await begin(base))),
    );
  }
  upstream.state.userinfoPatch = {};
  upstream.state.omit = ["name", "email"];
  const valid = await flow(base);
  assert.equal(decodeJwt(valid.token).name, alice.name);
  assert.equal(decodeJwt(valid.token).email, alice.email);
});

test("state, browser cookie, duplicate parameters and swapped transactions fail before unsafe exchange", async (t) => {
  const upstream = await stub(t);
  const base = await app(t, upstream.issuer);
  const a = await upstreamApproval(await begin(base));
  const b = await upstreamApproval(await begin(base));
  const before = upstream.state.tokenCalls;
  const wrong = new URL(a.callback);
  wrong.searchParams.set("state", "x".repeat(43));
  await rejected(await callback(base, a, a.cookie, wrong));
  await rejected(await callback(base, a, ""));
  await rejected(await callback(base, a, b.cookie));
  await rejected(await callback(base, a, `${a.cookie}; ${a.cookie}`));
  const damaged = a.cookie.replace(/=./, "=X");
  await rejected(await callback(base, a, damaged));
  const duplicate = new URL(a.callback);
  duplicate.searchParams.append(
    "state",
    text(duplicate.searchParams.get("state")),
  );
  await rejected(await callback(base, a, a.cookie, duplicate));
  const wrongIssuer = new URL(a.callback);
  wrongIssuer.searchParams.set("iss", "https://wrong.invalid");
  await rejected(await callback(base, a, a.cookie, wrongIssuer));
  assert.equal(upstream.state.tokenCalls, before);
  const swapped = new URL(a.callback);
  swapped.searchParams.set("code", text(b.callback.searchParams.get("code")));
  await rejected(await callback(base, a, a.cookie, swapped));
  assert.equal(upstream.state.pkceFailures, 1);
});

test("upstream and downstream PKCE plus return redirect/client/resource bindings remain enforced", async (t) => {
  const upstream = await stub(t);
  const base = await app(t, upstream.issuer);
  upstream.state.rejectPkce = true;
  await rejected(
    await callback(base, await upstreamApproval(await begin(base))),
  );
  assert.equal(upstream.state.pkceFailures, 1);
  upstream.state.rejectPkce = false;
  const valid = await flow(base);
  const changes: Record<string, string>[] = [
    { code_verifier: "w".repeat(43) },
    { redirect_uri: "http://127.0.0.1:5432/other" },
    { client_id: "wrong" },
    { resource: "https://wrong.invalid/mcp" },
  ];
  for (const change of changes)
    assert.equal(
      (await exchange(base, valid.client, valid.code, change)).status,
      400,
    );
  const start = await begin(base);
  const bad = new URLSearchParams(start.params);
  bad.set("redirect_uri", "https://wrong.invalid/callback");
  const count = upstream.state.registrations;
  const rejectedStart = await fetch(`${base}/authorize?${bad}`, {
    redirect: "manual",
  });
  assert.equal(rejectedStart.status, 400);
  assert.equal(rejectedStart.headers.get("location"), null);
  assert.equal(upstream.state.registrations, count);
});

test("encrypted transaction expiry, key/issuer binding and callback size limits survive cold starts", async (t) => {
  const upstream = await stub(t);
  const base = await app(t, upstream.issuer);
  const start = await upstreamApproval(await begin(base));
  const key = new Uint8Array(
    hkdfSync(
      "sha256",
      privateKey.export({ type: "pkcs8", format: "der" }),
      Buffer.from(appIssuer),
      Buffer.from(`employee-home-oidc-transaction-v1\0${upstream.issuer}`),
      32,
    ),
  );
  const cookieValue = start.cookie.slice(start.cookie.indexOf("=") + 1);
  const { payload } = await jwtDecrypt(cookieValue, key);
  const expired = await new EncryptJWT({ ...payload, iat: 1, exp: 2 })
    .setProtectedHeader({
      alg: "dir",
      enc: "A256GCM",
      typ: "oidc-transaction+jwt",
    })
    .encrypt(key);
  await rejected(
    await callback(base, start, `__Host-openwork-transaction=${expired}`),
  );
  const otherKey = generateKeyPairSync("ed25519")
    .privateKey.export({ type: "pkcs8", format: "pem" })
    .toString();
  const other = await app(t, upstream.issuer, { privateKeyPem: otherKey });
  await rejected(await callback(other, start));
  const otherOrigin = await app(t, upstream.issuer, {
    issuer: "https://other-app.example.test",
  });
  await rejected(await callback(otherOrigin, start));
  await rejected(await callback(base, start, `padding=${"x".repeat(8200)}`));
  const hugeCode = new URL(start.callback);
  hugeCode.searchParams.set("code", "x".repeat(8193));
  await rejected(await callback(base, start, start.cookie, hugeCode));
});

test("SSRF discovery controls reject foreign origins, path escapes, redirects and insecure non-loopback issuers", async (t) => {
  for (const value of [
    "http://localhost:4321",
    "http://remote.invalid/oidc",
    "http://2130706433:4321",
    "https://user:pass@example.test/oidc",
    "https://example.test/oidc?x=1",
    "https://example.test/oidc/",
  ])
    assert.throws(() => upstreamIssuer(value));
  assert.equal(
    upstreamIssuer("http://127.0.0.1:4321/oidc").hostname,
    "127.0.0.1",
  );
  const upstream = await stub(t);
  for (const field of [
    "authorization_endpoint",
    "token_endpoint",
    "registration_endpoint",
    "jwks_uri",
    "userinfo_endpoint",
  ]) {
    upstream.state.metadataPatch = {
      [field]: "https://untrusted.invalid/oidc/endpoint",
    };
    const base = await app(t, upstream.issuer);
    const start = await begin(base);
    assert.equal(start.response.status, 502);
    assert.equal(upstream.state.registrations, 0);
  }
  upstream.state.metadataPatch = {
    userinfo_endpoint: `${new URL(upstream.issuer).origin}/outside-prefix`,
  };
  assert.equal(
    (await begin(await app(t, upstream.issuer))).response.status,
    502,
  );
  upstream.state.metadataPatch = { issuer: "https://untrusted.invalid" };
  assert.equal(
    (await begin(await app(t, upstream.issuer))).response.status,
    502,
  );
  upstream.state.metadataPatch = {};
  upstream.state.redirectDiscovery = true;
  assert.equal(
    (await begin(await app(t, upstream.issuer))).response.status,
    502,
  );
});

test("upstream JSON responses are bounded and failures disclose no protocol material", async (t) => {
  const upstream = await stub(t);
  upstream.state.largeDiscovery = true;
  const start = await begin(await app(t, upstream.issuer));
  assert.equal(start.response.status, 502);
  assert.deepEqual(await start.response.json(), {
    error: "upstream_unavailable",
  });
  upstream.state.largeDiscovery = false;
  upstream.state.largeToken = true;
  const base = await app(t, upstream.issuer);
  await rejected(
    await callback(base, await upstreamApproval(await begin(base))),
  );
});

test("app MCP rejects upstream ID/access/MCP tokens and demo identities even with matching app signing key", async (t) => {
  const upstream = await stub(t);
  const base = await app(t, upstream.issuer);
  const valid = await flow(base);
  const den = await new SignJWT({
    sub: alice.sub,
    org_id: alice.org_id,
    scope: "mcp:read",
  })
    .setProtectedHeader({ alg: "EdDSA" })
    .setIssuer(upstream.issuer)
    .setAudience(`${upstream.issuer}/mcp`)
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(upstream.privateKey);
  const demoClaims = {
    ...decodeJwt(valid.token),
    identity_mode: "demo",
    sub: randomUUID(),
  };
  const { decodeProtectedHeader } = await import("jose");
  const demo = await new SignJWT(demoClaims)
    .setProtectedHeader({ ...decodeProtectedHeader(valid.token), alg: "EdDSA" })
    .sign(privateKey);
  for (const token of [
    undefined,
    den,
    upstream.state.lastIdToken,
    demo,
    "arbitrary-upstream-access",
  ]) {
    const response = await rpc(base, token, definitions[home].tool);
    assert.equal(response.status, 401);
    assert.ok(
      response.headers.get("www-authenticate")?.includes("resource_metadata"),
    );
  }
});

test("default identity mode is openwork; real DOM shows name/subshort and auth loss removes identity", async (t) => {
  const originalName = process.env.DEMO_VIEWER_NAME;
  process.env.DEMO_VIEWER_NAME = "Wrong Demo Name";
  t.after(() => {
    if (originalName === undefined) delete process.env.DEMO_VIEWER_NAME;
    else process.env.DEMO_VIEWER_NAME = originalName;
  });
  const before = process.env.IDENTITY_MODE;
  delete process.env.IDENTITY_MODE;
  t.after(() => {
    if (before === undefined) delete process.env.IDENTITY_MODE;
    else process.env.IDENTITY_MODE = before;
  });
  assert.equal(
    createOAuth({ issuer: appIssuer, privateKeyPem }).metadata
      .authorizationServer.identity_mode,
    "openwork",
  );
  assert.throws(() =>
    createOAuth({
      issuer: appIssuer,
      privateKeyPem,
      upstreamIssuer: "http://wrong.invalid",
    }),
  );
  assert.doesNotThrow(() =>
    createOAuth({
      issuer: "http://127.0.0.1:5432",
      privateKeyPem,
      identityMode: "demo",
    }),
  );
  const upstream = await stub(t);
  const base = await app(t, upstream.issuer);
  const valid = await flow(base);
  const controllers = {
    today: new WidgetController("today", async () => ({ isError: true })),
    attention: new WidgetController("attention", async () => ({
      isError: true,
    })),
    goals: new WidgetController("goals", async () => ({ isError: true })),
  };
  for (const widget of widgetIds)
    controllers[widget].receive({
      structuredContent: await data(base, valid.token, widget),
    });
  const html = renderToStaticMarkup(
    createElement(Dashboard, { controllers, view: home }),
  );
  assert.ok(html.includes(alice.name) && html.includes(alice.sub.slice(0, 12)));
  assert.match(html, /Good (morning|afternoon|evening), Alice!/);
  assert.ok(html.includes('data-testid="viewer-identity">Alice Martin</span>'));
  for (const widget of widgetIds) controllers[widget].requireConnection();
  const blocked = renderToStaticMarkup(
    createElement(Dashboard, { controllers, view: home }),
  );
  assert.ok(!blocked.includes(alice.name));
  assert.ok(blocked.includes("Connect to personalize"));
});
