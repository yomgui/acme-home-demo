import assert from "node:assert/strict";
import { createHash, generateKeyPairSync } from "node:crypto";
import { createServer } from "node:http";
import { test, type TestContext } from "node:test";
import { registerClient } from "@modelcontextprotocol/client";
import { OAuthClientInformationFullSchema } from "@modelcontextprotocol/core";
import {
  decodeJwt,
  decodeProtectedHeader,
  jwtVerify,
  createLocalJWKSet,
  SignJWT,
  type JWTPayload,
} from "jose";
import { createOAuth } from "../server/oauth.ts";
import { createHandler, type HandlerOptions } from "../server/handler.ts";
import { createHttpApp } from "../server/http.ts";
import { createServer as createMcpServer } from "../server/server.ts";
import {
  definitions,
  resourceUri,
  widgetIds,
  payloadSchema,
  type Payload,
  type ViewId,
} from "../shared/contract.ts";
import {
  createPersonalProvider,
  profileForSubject,
} from "../server/provider.ts";
import { WidgetController } from "../src/controller.ts";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { Dashboard } from "../src/ui.tsx";

const home = "home";
const issuer = "https://home.example.test";
const resource = `${issuer}/mcp`;
const redirect = "http://127.0.0.1:4321/callback?keep=yes";
const verifier = "v".repeat(43);
const challenge = createHash("sha256").update(verifier).digest("base64url");
const { privateKey } = generateKeyPairSync("ed25519");
const privateKeyPem = privateKey
  .export({ format: "pem", type: "pkcs8" })
  .toString();
function record(value: unknown): Record<string, unknown> {
  assert.ok(
    value !== null && typeof value === "object" && !Array.isArray(value),
  );
  return Object.fromEntries(Object.entries(value));
}
function text(value: unknown): string {
  if (typeof value !== "string") throw new Error("Expected string");
  return value;
}
async function harness(
  t: TestContext,
  configuredIssuer = issuer,
  authRequired = true,
  express = false,
) {
  const oauth = createOAuth({
    identityMode: "demo",
    issuer: configuredIssuer,
    privateKeyPem,
  });
  const options: HandlerOptions = {
    issuer: configuredIssuer,
    privateKeyPem,
    authRequired,
    identityMode: "demo",
  };
  const handler = createHandler(options);
  const server = express
    ? createHttpApp(() => createMcpServer(), options).listen(0, "127.0.0.1")
    : createServer((req, res) => {
        void handler(req, res);
      }).listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return { oauth, base: `http://127.0.0.1:${address.port}` };
}
async function register(base: string, redirects = [redirect]) {
  const response = await fetch(`${base}/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      redirect_uris: redirects,
      token_endpoint_auth_method: "none",
    }),
  });
  assert.equal(response.status, 201);
  return text(record(await response.json()).client_id);
}
function authorization(clientId: string) {
  return new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirect,
    resource,
    code_challenge: challenge,
    code_challenge_method: "S256",
    scope: "home:read",
    state: "opaque state +/&?=",
  });
}
async function approve(base: string, clientId: string) {
  const response = await fetch(`${base}/authorize?${authorization(clientId)}`, {
    redirect: "manual",
  });
  assert.equal(response.status, 302);
  const destination = new URL(text(response.headers.get("location")));
  assert.equal(destination.searchParams.get("state"), "opaque state +/&?=");
  assert.equal(destination.searchParams.get("keep"), "yes");
  assert.equal(response.headers.get("set-cookie"), null);
  return text(destination.searchParams.get("code"));
}
function exchange(clientId: string, code: string) {
  return new URLSearchParams({
    grant_type: "authorization_code",
    client_id: clientId,
    redirect_uri: redirect,
    resource,
    code,
    code_verifier: verifier,
  });
}
async function redeem(base: string, params: URLSearchParams) {
  return fetch(`${base}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params,
  });
}
async function access(base: string) {
  const client = await register(base);
  const code = await approve(base, client);
  const response = await redeem(base, exchange(client, code));
  assert.equal(response.status, 200);
  return {
    token: text(record(await response.json()).access_token),
    client,
    code,
  };
}
async function resign(
  token: string,
  changes: Record<string, unknown>,
  remove?: string,
) {
  const claims: JWTPayload = { ...decodeJwt(token), ...changes };
  if (remove) delete claims[remove];
  return new SignJWT(claims)
    .setProtectedHeader({ ...decodeProtectedHeader(token), alg: "EdDSA" })
    .sign(privateKey);
}
async function invalid(response: Response, status: number, code?: string) {
  assert.equal(response.status, status);
  const body = record(await response.json());
  assert.deepEqual(Object.keys(body), ["error"]);
  if (code) assert.equal(body.error, code);
}
function rpc(
  base: string,
  method: string,
  params: Record<string, unknown> = {},
  token?: string,
) {
  return fetch(`${base}/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...(token === undefined ? {} : { Authorization: `Bearer ${token}` }),
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
}
async function data(
  base: string,
  token: string,
  widget: (typeof widgetIds)[number],
  standalone = false,
) {
  const response = await rpc(
    base,
    "tools/call",
    {
      name: definitions[standalone ? widget : home].tool,
      arguments: standalone ? {} : { widget },
    },
    token,
  );
  assert.equal(response.status, 200);
  return payloadSchema.parse(
    record(record(await response.json()).result).structuredContent,
  );
}

test("calendar reference: discovery, replay disclosure, issuer-bound compact DCR and public EdDSA JWKS", async (t) => {
  const { base, oauth } = await harness(t);
  const as = await fetch(`${base}/.well-known/oauth-authorization-server`, {
    headers: { Host: "attacker.test", "X-Forwarded-Host": "attacker.test" },
  });
  assert.deepEqual(await as.json(), oauth.metadata.authorizationServer);
  assert.equal(oauth.metadata.authorizationServer.issuer, issuer);
  assert.match(
    oauth.metadata.authorizationServer.description,
    /accepts every request; codes are short-lived, not single-use/,
  );
  assert.deepEqual(
    oauth.metadata.authorizationServer.code_challenge_methods_supported,
    ["S256"],
  );
  for (const path of [
    "/.well-known/oauth-protected-resource",
    "/.well-known/oauth-protected-resource/mcp",
  ])
    assert.deepEqual(
      await (await fetch(`${base}${path}`)).json(),
      oauth.metadata.protectedResource,
    );
  assert.deepEqual(
    await (await fetch(`${base}/.well-known/jwks.json`)).json(),
    oauth.metadata.jwks,
  );
  assert.ok(oauth.metadata.jwks.keys.every((key) => !("d" in key)));
  const client = await register(base);
  assert.ok(client.startsWith("c1.") && client.length <= 512);
  const verified = await jwtVerify(
    client.slice(3),
    createLocalJWKSet(oauth.metadata.jwks),
    { algorithms: ["EdDSA"] },
  );
  assert.deepEqual(verified.payload.r, [
    createHash("sha256")
      .update(`demo-dcr-v1\0${issuer}\0${redirect}`)
      .digest()
      .subarray(0, 16)
      .toString("base64url"),
  ]);
});

test("calendar reference: Den DCR shape negotiates code-only grants and passes installed SDK schema", async (t) => {
  const { base, oauth } = await harness(t);
  const client = await registerClient(issuer, {
    metadata: {
      ...oauth.metadata.authorizationServer,
      registration_endpoint: `${base}/register`,
    },
    clientMetadata: {
      redirect_uris: [redirect],
      client_name: "OpenWork",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      application_type: "web",
    },
  });
  assert.ok(OAuthClientInformationFullSchema.safeParse(client).success);
  assert.ok(client.client_id.length <= 512);
  assert.deepEqual(client.grant_types, ["authorization_code"]);
  assert.equal(
    (
      await redeem(
        base,
        exchange(client.client_id, await approve(base, client.client_id)),
      )
    ).status,
    200,
  );
  assert.ok(
    (
      await register(
        base,
        Array.from(
          { length: 10 },
          (_, index) =>
            `https://client.example.test/long-callback-${index}?path=${"x".repeat(100)}`,
        ),
      )
    ).length <= 512,
  );
});

test("calendar reference: expired/forged registrations and cross-issuer key reuse fail", async (t) => {
  const { base } = await harness(t);
  const client = await register(base);
  const claims = decodeJwt(client.slice(3));
  const expired = `c1.${await new SignJWT({ ...claims, e: Math.floor(Date.now() / 1000) - 1 }).setProtectedHeader({ alg: "EdDSA" }).sign(privateKey)}`;
  const forged = `c1.${await new SignJWT(claims).setProtectedHeader({ alg: "EdDSA" }).sign(generateKeyPairSync("ed25519").privateKey)}`;
  for (const value of [expired, forged])
    await invalid(
      await fetch(`${base}/authorize?${authorization(value)}`, {
        redirect: "manual",
      }),
      400,
      "invalid_client",
    );
  const other = await harness(t, "https://other.example.test");
  const params = authorization(client);
  params.set("resource", "https://other.example.test/mcp");
  await invalid(
    await fetch(`${other.base}/authorize?${params}`, { redirect: "manual" }),
    400,
    "invalid_redirect_uri",
  );
});

test("calendar reference: PKCE roundtrip, fresh subjects, 60-second codes and disclosed stateless replay", async (t) => {
  const first = await harness(t);
  const second = await harness(t);
  const one = await access(first.base);
  const two = await access(first.base);
  const a = decodeJwt(one.token);
  assert.notEqual(a.sub, decodeJwt(two.token).sub);
  assert.equal(a.iss, issuer);
  assert.equal(a.aud, resource);
  const code = decodeJwt(one.code);
  assert.equal(Number(code.exp) - Number(code.iat), 60);
  assert.deepEqual(await second.oauth.verifyAccessToken(one.token), {
    sub: a.sub,
  });
  const replay = await redeem(second.base, exchange(one.client, one.code));
  assert.equal(replay.status, 200);
  assert.equal(
    decodeJwt(text(record(await replay.json()).access_token)).sub,
    a.sub,
  );
});

test("calendar reference: wrong verifier, expiry, missing claims and client/redirect/resource bindings", async (t) => {
  const { base } = await harness(t);
  const { client, code } = await access(base);
  const other = await register(base);
  for (const [field, value] of [
    ["code_verifier", "w".repeat(43)],
    ["code_verifier", "v".repeat(42)],
    ["resource", "https://wrong.test/mcp"],
    ["redirect_uri", "http://127.0.0.1:4321/other"],
    ["client_id", other],
    ["grant_type", "refresh_token"],
    ["client_secret", "synthetic"],
  ]) {
    assert.ok(field && value);
    const params = exchange(client, code);
    params.set(field, value);
    await invalid(await redeem(base, params), 400);
  }
  await invalid(
    await redeem(
      base,
      exchange(
        client,
        await resign(code, { exp: Math.floor(Date.now() / 1000) - 1 }),
      ),
    ),
    400,
    "invalid_grant",
  );
  for (const claim of [
    "iss",
    "aud",
    "exp",
    "iat",
    "jti",
    "sub",
    "client_id",
    "redirect_uri",
    "code_challenge",
    "resource",
  ])
    await invalid(
      await redeem(base, exchange(client, await resign(code, {}, claim))),
      400,
      "invalid_grant",
    );
});

test("calendar reference: bad issuer/audience/signature and malformed bearer always return 401", async (t) => {
  const { base, oauth } = await harness(t);
  const { token, client, code } = await access(base);
  const now = Math.floor(Date.now() / 1000);
  const bad = await Promise.all(
    [
      { iss: "https://wrong.test" },
      { aud: "https://wrong.test/mcp" },
      { aud: [resource, "https://wrong.test/mcp"] },
      { resource: `${resource}/` },
      { scope: "home:write" },
      { sub: "arbitrary-person" },
      { exp: now - 1 },
      { iat: now + 60 },
      { token_kind: "code" },
      { exp: now + 7200 },
      { jti: "bad" },
    ].map((changes) => resign(token, changes)),
  );
  bad.push(
    await new SignJWT(decodeJwt(token))
      .setProtectedHeader({ ...decodeProtectedHeader(token), alg: "EdDSA" })
      .sign(generateKeyPairSync("ed25519").privateKey),
    client,
    code,
    "arbitrary-bearer",
  );
  for (const candidate of [undefined, ...bad]) {
    const response = await rpc(
      base,
      "tools/call",
      { name: definitions[home].tool, arguments: {} },
      candidate,
    );
    assert.equal(response.status, 401);
    assert.ok(
      response.headers
        .get("www-authenticate")
        ?.includes(
          `resource_metadata="${issuer}/.well-known/oauth-protected-resource"`,
        ),
    );
    if (candidate) {
      await assert.rejects(oauth.verifyAccessToken(candidate));
      assert.equal((await rpc(base, "tools/list", {}, candidate)).status, 401);
    }
  }
  for (const authorization of ["Basic synthetic", "Bearer", "Bearer a b", ""])
    assert.equal(
      (
        await fetch(`${base}/mcp`, {
          method: "POST",
          headers: { Authorization: authorization },
          body: "malformed",
        })
      ).status,
      401,
    );
});

test("calendar reference: DCR rejects unsafe redirects/metadata and authorization requires S256", async (t) => {
  const { base } = await harness(t);
  for (const uri of [
    "http://remote.test/cb",
    "ftp://localhost/cb",
    "https://client.test/cb#fragment",
    "/callback",
    "https://user:fixture@client.test/cb",
  ])
    await invalid(
      await fetch(`${base}/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ redirect_uris: [uri] }),
      }),
      400,
    );
  for (const body of [
    { redirect_uris: [] },
    {},
    {
      redirect_uris: [redirect],
      token_endpoint_auth_method: "client_secret_basic",
    },
    { redirect_uris: [redirect], scope: "home:write" },
  ])
    await invalid(
      await fetch(`${base}/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
      400,
    );
  const client = await register(base);
  for (const [field, value] of [
    ["resource", "https://wrong.test/mcp"],
    ["code_challenge_method", "plain"],
    ["code_challenge", "short"],
    ["client_id", "arbitrary"],
    ["redirect_uri", "https://evil.test/cb"],
  ]) {
    assert.ok(field && value);
    const params = authorization(client);
    params.set(field, value);
    await invalid(
      await fetch(`${base}/authorize?${params}`, { redirect: "manual" }),
      400,
    );
  }
  const params = authorization(client);
  params.delete("state");
  const response = await fetch(`${base}/authorize?${params}`, {
    redirect: "manual",
  });
  assert.equal(response.status, 302);
  assert.equal(
    new URL(text(response.headers.get("location"))).searchParams.get("state"),
    null,
  );
});

test("calendar reference: method/content type/size failures are sanitized", async (t) => {
  const { base } = await harness(t);
  await invalid(await fetch(`${base}/register`), 405);
  await invalid(
    await fetch(`${base}/register`, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: "{}",
    }),
    415,
  );
  await invalid(
    await fetch(`${base}/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "invalid json",
    }),
    400,
  );
  await invalid(
    await fetch(`${base}/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: "x".repeat(16384) }),
    }),
    413,
  );
});

test("calendar reference: anonymous bootstrap/static UI allowed, every personal tool and private resource blocked", async (t) => {
  const { base } = await harness(t);
  assert.equal(
    (
      await rpc(base, "initialize", {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name: "public-discovery", version: "1" },
      })
    ).status,
    200,
  );
  for (const method of [
    "tools/list",
    "resources/list",
    "resources/templates/list",
  ])
    assert.equal((await rpc(base, method)).status, 200);
  const views: ViewId[] = [...widgetIds, home];
  for (const view of views) {
    const response = await rpc(base, "resources/read", {
      uri: resourceUri(view),
    });
    assert.equal(response.status, 200);
    assert.ok(
      JSON.stringify(await response.json()).includes("viewer-identity"),
    );
    assert.equal(
      (
        await rpc(base, "tools/call", {
          name: definitions[view].tool,
          arguments: {},
        })
      ).status,
      401,
    );
  }
  assert.equal(
    (await rpc(base, "resources/read", { uri: "ui://private" })).status,
    401,
  );
  const notification = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "notifications/initialized",
    }),
  });
  assert.equal(notification.status, 202);
});

test("two verified subjects have different names and all three sets; Refresh changes content independently", async (t) => {
  const { base } = await harness(t);
  const one = await access(base);
  const two = await access(base);
  const snapshots: Payload[] = [];
  for (const widget of widgetIds) {
    const a = await data(base, one.token, widget);
    const b = await data(base, two.token, widget, true);
    assert.ok(a.whoami && b.whoami);
    assert.notEqual(a.whoami.name, b.whoami.name);
    assert.notEqual(a.whoami.fingerprint, b.whoami.fingerprint);
    assert.equal(a.generation, 1);
    assert.equal(b.generation, 1);
    assert.equal(a.providerInstance, b.providerInstance);
    const rows = (value: typeof a) =>
      value.kind === "today"
        ? value.meetings
        : value.kind === "attention"
          ? value.items
          : value.goals;
    assert.notDeepEqual(rows(a), rows(b));
    const refreshed = await data(base, one.token, widget);
    assert.equal(refreshed.generation, 2);
    assert.deepEqual(refreshed.whoami, a.whoami);
    assert.notDeepEqual(rows(refreshed), rows(a));
    snapshots.push(a);
  }
  assert.ok(
    snapshots.every(
      (snapshot) => snapshot.whoami?.name === snapshots[0]?.whoami?.name,
    ),
  );
  const anotherInstance = await harness(t);
  const reset = await data(anotherInstance.base, one.token, "today");
  assert.equal(reset.generation, 1);
  assert.notEqual(reset.providerInstance, snapshots[0]?.providerInstance);
  assert.deepEqual(reset.whoami, snapshots[0]?.whoami);
});

test("trusted preview issuer fallback, explicit override, secure default and explicit shared mode", async (t) => {
  const original = {
    issuer: process.env.DEMO_AS_ISSUER,
    preview: process.env.VERCEL_URL,
    required: process.env.AUTH_REQUIRED,
  };
  t.after(() => {
    for (const [key, value] of [
      ["DEMO_AS_ISSUER", original.issuer],
      ["VERCEL_URL", original.preview],
      ["AUTH_REQUIRED", original.required],
    ]) {
      if (key) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });
  delete process.env.DEMO_AS_ISSUER;
  delete process.env.AUTH_REQUIRED;
  process.env.VERCEL_URL = "preview.example.test";
  assert.equal(
    createOAuth({ identityMode: "demo", privateKeyPem }).metadata
      .authorizationServer.issuer,
    "https://preview.example.test",
  );
  assert.equal(
    createOAuth({ identityMode: "demo", privateKeyPem, issuer }).metadata
      .authorizationServer.issuer,
    issuer,
  );
  assert.throws(() => createHandler({ privateKeyPem: "invalid" }));
  process.env.DEMO_AS_ISSUER = "https://explicit.example.test";
  assert.equal(
    createOAuth({ identityMode: "demo", privateKeyPem }).metadata
      .authorizationServer.issuer,
    "https://explicit.example.test",
  );
  for (const value of [
    "",
    "http://localhost:3000",
    `${issuer}/`,
    `${issuer}/path`,
    `${issuer}?query=yes`,
  ])
    assert.throws(
      () => createOAuth({ identityMode: "demo", issuer: value, privateKeyPem }),
      {
        message:
          "DEMO_AS_ISSUER must be an HTTPS origin without a trailing slash",
      },
    );
  for (const pem of ["", "invalid-key"])
    assert.throws(
      () => createOAuth({ identityMode: "demo", issuer, privateKeyPem: pem }),
      {
        message: "DEMO_AS_PRIVATE_KEY must be an Ed25519 PKCS8 PEM",
      },
    );
  const { base } = await harness(t, issuer, false);
  const response = await rpc(base, "tools/call", {
    name: definitions.today.tool,
    arguments: {},
  });
  assert.equal(response.status, 200);
  assert.equal(
    payloadSchema.parse(
      record(record(await response.json()).result).structuredContent,
    ).whoami,
    undefined,
  );
  assert.equal((await rpc(base, "tools/list", {}, "arbitrary")).status, 401);
  process.env.AUTH_REQUIRED = "false";
  assert.doesNotThrow(() => createHandler({ privateKeyPem: "invalid" }));
});

test("local Express adapter executes the same OAuth form exchange and verified MCP boundary", async (t) => {
  const { base } = await harness(t, issuer, true, true);
  const { token } = await access(base);
  assert.ok((await data(base, token, "today")).whoami);
  assert.equal(
    (
      await rpc(base, "tools/call", {
        name: definitions.today.tool,
        arguments: {},
      })
    ).status,
    401,
  );
});

test("identity fixtures and DOM receipts are deterministic; 401 clears stale identity/data without spinner", async () => {
  const first = "11111111-1111-4111-8111-111111111111";
  assert.deepEqual(profileForSubject(first), profileForSubject(first));
  const names = new Set(
    Array.from(
      { length: 40 },
      (_, index) => profileForSubject(`fixture-${index}`).name,
    ),
  );
  assert.equal(names.size, 40);
  const provider = createPersonalProvider(first);
  const controllers = {
    today: new WidgetController("today", async () => {
      throw { status: 401 };
    }),
    attention: new WidgetController("attention", async () => {
      throw new Error("HTTP 401 unauthorized");
    }),
    goals: new WidgetController("goals", async () => ({
      isError: true,
      content: [{ type: "text", text: "Connect to personalize" }],
    })),
  };
  for (const widget of widgetIds) {
    controllers[widget].setAvailable(true);
    controllers[widget].receive({ structuredContent: await provider(widget) });
  }
  const html = renderToStaticMarkup(
    createElement(Dashboard, {
      controllers,
      view: home,
      timeZone: "America/New_York",
    }),
  );
  assert.ok(html.includes(profileForSubject(first).firstName));
  for (const id of [
    "viewer-identity",
    "viewer-greeting",
    ...widgetIds.flatMap((widget) => [
      `${widget}-identity`,
      `${widget}-set`,
      `${widget}-generation`,
      `${widget}-generated-at`,
      `${widget}-instance`,
    ]),
  ])
    assert.ok(html.includes(`data-testid="${id}"`));
  for (const widget of widgetIds) {
    await controllers[widget].refresh();
    assert.equal(controllers[widget].getSnapshot().data, null);
    assert.equal(controllers[widget].getSnapshot().busy, false);
    assert.equal(
      controllers[widget].getSnapshot().error,
      "Connect to personalize",
    );
  }
  const blocked = renderToStaticMarkup(
    createElement(Dashboard, { controllers, view: home }),
  );
  assert.ok(blocked.includes("Connect to personalize"));
  assert.ok(!blocked.includes(profileForSubject(first).name));
  assert.ok(!blocked.includes("Fetching synthetic data"));
  for (const widget of widgetIds) controllers[widget].stop();
});
