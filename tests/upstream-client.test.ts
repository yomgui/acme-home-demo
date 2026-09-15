import assert from "node:assert/strict";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import test from "node:test";
import type { get, put } from "@vercel/blob";
import {
  clientAuthentication,
  createClientResolver,
  privateRegistrationCache,
  registrationPath,
  type UpstreamClient,
} from "../server/upstream-client.ts";
import {
  callbackFields,
  diagnosticFor,
  SignInError,
} from "../server/oidc-errors.ts";
import { MemoryRegistrationCache } from "./registration-fixture.ts";

const issuer = "https://idp.example.test/auth";
const callback = "https://app.example.test/oauth/upstream/callback";
const key = generateKeyPairSync("ed25519").privateKey;
const client = (
  id: string = randomUUID(),
  redirectUri = callback,
  upstream = issuer,
): UpstreamClient => ({
  clientId: id,
  authMethod: "none",
  issuer: upstream,
  redirectUri,
});
const isStage = (stage: string) => (error: unknown) =>
  error instanceof SignInError && error.diagnostic.stage === stage;

test("encrypted private registration persists before use and survives fresh resolver instances", async () => {
  const cache = new MemoryRegistrationCache();
  let registrations = 0;
  const register = async () => {
    registrations++;
    return client();
  };
  const options = { env: {}, registrationCache: cache };
  const one = await createClientResolver(
    issuer,
    callback,
    key,
    options,
  ).resolve(true, register);
  const two = await createClientResolver(
    issuer,
    callback,
    key,
    options,
  ).resolve(true, register);
  const callbackClient = await createClientResolver(
    issuer,
    callback,
    key,
    options,
  ).resolve(false, register);
  assert.deepEqual(one, two);
  assert.deepEqual(one, callbackClient);
  assert.equal(registrations, 1);
  assert.equal(cache.creates, 1);
  assert.ok(cache.reads >= 4);
  const encrypted = cache.entries.get(registrationPath(issuer, callback));
  assert.ok(encrypted);
  assert.equal(encrypted.split(".").length, 5);
  assert.ok(
    !encrypted.includes(one.clientId) &&
      !encrypted.includes(issuer) &&
      !encrypted.includes(callback),
  );
});

test("concurrent create races use only the durable winner without overwriting or returning loser clients", async () => {
  const cache = new MemoryRegistrationCache();
  const created: string[] = [];
  const register = async () => {
    const value = client();
    created.push(value.clientId);
    return value;
  };
  const options = { env: {}, registrationCache: cache };
  const [one, two] = await Promise.all([
    createClientResolver(issuer, callback, key, options).resolve(
      true,
      register,
    ),
    createClientResolver(issuer, callback, key, options).resolve(
      true,
      register,
    ),
  ]);
  assert.equal(created.length, 2);
  assert.equal(cache.creates, 2);
  assert.equal(cache.entries.size, 1);
  assert.deepEqual(one, two);
  assert.ok(created.includes(one.clientId));
  const after = await createClientResolver(
    issuer,
    callback,
    key,
    options,
  ).resolve(true, register);
  assert.deepEqual(after, one);
  assert.equal(created.length, 2);
});

test("cache paths are exact issuer+callback bindings; callback-only resolution never creates a registration", async () => {
  const cache = new MemoryRegistrationCache();
  let registrations = 0;
  const create = async (upstream: string, redirectUri: string) =>
    createClientResolver(upstream, redirectUri, key, {
      env: {},
      registrationCache: cache,
    }).resolve(true, async () => {
      registrations++;
      return client(randomUUID(), redirectUri, upstream);
    });
  await create(issuer, callback);
  await create(issuer, `${callback}/other`);
  await create(`${issuer}/other`, callback);
  assert.equal(cache.entries.size, 3);
  assert.equal(registrations, 3);
  assert.notEqual(
    registrationPath(issuer, callback),
    registrationPath(issuer, `${callback}/`),
  );
  assert.notEqual(
    registrationPath(issuer, callback),
    registrationPath(`${issuer}/`, callback),
  );
  await assert.rejects(
    createClientResolver(issuer, `${callback}/missing`, key, {
      env: {},
      registrationCache: cache,
    }).resolve(false, async () => {
      registrations++;
      return client();
    }),
    isStage("registration-read"),
  );
  assert.equal(registrations, 3);
});

test("failed persistence, corrupt cache and key mismatch fail closed without a fallback client", async () => {
  const cache = new MemoryRegistrationCache();
  cache.failWrites = true;
  let registrations = 0;
  const register = async () => {
    registrations++;
    return client();
  };
  await assert.rejects(
    createClientResolver(issuer, callback, key, {
      env: {},
      registrationCache: cache,
    }).resolve(true, register),
    isStage("registration-write"),
  );
  assert.equal(registrations, 1);
  assert.equal(cache.entries.size, 0);
  cache.failWrites = false;
  await createClientResolver(issuer, callback, key, {
    env: {},
    registrationCache: cache,
  }).resolve(true, register);
  const count = registrations;
  await assert.rejects(
    createClientResolver(
      issuer,
      callback,
      generateKeyPairSync("ed25519").privateKey,
      { env: {}, registrationCache: cache },
    ).resolve(true, register),
    isStage("registration-binding"),
  );
  cache.entries.set(registrationPath(issuer, callback), "corrupt fixture");
  await assert.rejects(
    createClientResolver(issuer, callback, key, {
      env: {},
      registrationCache: cache,
    }).resolve(true, register),
    isStage("registration-binding"),
  );
  assert.equal(registrations, count);
  await assert.rejects(
    createClientResolver(issuer, callback, key, { env: {} }).resolve(
      true,
      register,
    ),
    isStage("configuration"),
  );
  assert.equal(registrations, count);
});

test("env takes priority, requires exact issuer/redirect binding and rejects inconsistent authentication", async () => {
  const cache = new MemoryRegistrationCache();
  let registrations = 0;
  const register = async () => {
    registrations++;
    return client();
  };
  const env = {
    UPSTREAM_CLIENT_ID: "configured-fixture",
    UPSTREAM_CLIENT_ISSUER: issuer,
    UPSTREAM_CLIENT_REDIRECT_URI: callback,
  };
  const value = await createClientResolver(issuer, callback, key, {
    env,
    registrationCache: cache,
  }).resolve(true, register);
  assert.equal(value.clientId, env.UPSTREAM_CLIENT_ID);
  assert.equal(cache.reads, 0);
  assert.equal(registrations, 0);
  const patches: NodeJS.ProcessEnv[] = [
    { UPSTREAM_CLIENT_ID: "" },
    { UPSTREAM_CLIENT_ISSUER: `${issuer}/` },
    { UPSTREAM_CLIENT_REDIRECT_URI: `${callback}/` },
    { UPSTREAM_CLIENT_ISSUER: undefined },
    { UPSTREAM_CLIENT_REDIRECT_URI: undefined },
    {
      UPSTREAM_CLIENT_SECRET: "synthetic",
      UPSTREAM_CLIENT_AUTH_METHOD: "none",
    },
    { UPSTREAM_CLIENT_AUTH_METHOD: "client_secret_post" },
    { UPSTREAM_CLIENT_AUTH_METHOD: "client_secret_basic" },
    { UPSTREAM_CLIENT_AUTH_METHOD: "unsupported" },
  ];
  for (const patch of patches)
    await assert.rejects(
      createClientResolver(issuer, callback, key, {
        env: { ...env, ...patch },
        registrationCache: cache,
      }).resolve(true, register),
      isStage("configuration"),
    );
  await assert.rejects(
    createClientResolver(issuer, callback, key, {
      env: { UPSTREAM_CLIENT_SECRET: "orphan-fixture" },
      registrationCache: cache,
    }).resolve(true, register),
    isStage("configuration"),
  );
  assert.equal(registrations, 0);
  assert.equal(cache.reads, 0);
});

test("private Blob SDK adapter disables read cache and creates deterministic non-overwriting private objects", async () => {
  let reads = 0;
  let writes = 0;
  const path = registrationPath(issuer, callback);
  const read: typeof get = async (received, options) => {
    reads++;
    assert.equal(received, path);
    assert.equal(options.access, "private");
    assert.equal(options.useCache, false);
    assert.equal(options.token, "synthetic-blob-fixture");
    return null;
  };
  const write: typeof put = async (received, value, options) => {
    writes++;
    assert.equal(received, path);
    assert.equal(value, "encrypted-fixture");
    assert.equal(options.access, "private");
    assert.equal(options.allowOverwrite, false);
    assert.equal(options.addRandomSuffix, false);
    assert.equal(options.contentType, "application/jose");
    return {
      url: "https://blob.example.test/fixture",
      downloadUrl: "https://blob.example.test/fixture",
      pathname: received,
      contentType: "application/jose",
      contentDisposition: "attachment",
      etag: "fixture",
    };
  };
  const cache = privateRegistrationCache("synthetic-blob-fixture", {
    get: read,
    put: write,
  });
  assert.equal(await cache.read(path), null);
  await cache.create(path, "encrypted-fixture");
  assert.equal(reads, 1);
  assert.equal(writes, 1);
  await assert.rejects(
    cache.read("https://untrusted.invalid/object"),
    isStage("registration-binding"),
  );
  await assert.rejects(
    cache.create(path, "x".repeat(16385)),
    isStage("registration-write"),
  );
  assert.equal(reads, 1);
  assert.equal(writes, 1);
});

test("client authentication sends only the configured public/post/basic credential placement", () => {
  const publicClient = client("public-fixture");
  assert.deepEqual(clientAuthentication(publicClient), {
    headers: {},
    fields: { client_id: "public-fixture" },
  });
  const secret = "synthetic:+ &/";
  const post = clientAuthentication({
    ...publicClient,
    clientSecret: secret,
    authMethod: "client_secret_post",
  });
  assert.deepEqual(post, {
    headers: {},
    fields: { client_id: publicClient.clientId, client_secret: secret },
  });
  const basic = clientAuthentication({
    ...publicClient,
    clientSecret: secret,
    authMethod: "client_secret_basic",
  });
  assert.deepEqual(basic.fields, {});
  const header = basic.headers.Authorization;
  assert.ok(header);
  assert.equal(
    Buffer.from(header.slice(6), "base64").toString("utf8"),
    "public-fixture:synthetic%3A%2B+%26%2F",
  );
});

test("callback diagnostic fields drop raw identifiers, URLs and unrelated context fields", () => {
  const unsafe = {
    cookiePresent: false,
    stateMatch: true,
    cookieMatch: true,
    redirectUriMatches: true,
    clientIdUsed: "raw-client-id",
    redirectUriUsed: "https://private.example.test/callback",
    email: "private@example.test",
    cookie: "raw-cookie",
  };
  assert.deepEqual(callbackFields(unsafe), {
    cookiePresent: false,
    stateMatch: true,
    redirectUriMatches: true,
  });
  const safe = callbackFields({
    ...unsafe,
    cookiePresent: true,
    clientIdUsed: "a".repeat(64),
    redirectUriUsed: "b".repeat(64),
  });
  assert.deepEqual(safe, {
    cookiePresent: true,
    stateMatch: true,
    cookieMatch: true,
    redirectUriMatches: true,
    clientIdUsed: "a".repeat(64),
    redirectUriUsed: "b".repeat(64),
  });
});

test("diagnostics only retain fixed safe provider descriptions, OAuth error codes and stage names", () => {
  const safe = diagnosticFor(
    new SignInError(
      "token-exchange",
      "invalid_grant",
      "Invalid code verifier",
      400,
    ),
    "configuration",
  );
  assert.deepEqual(safe, {
    stage: "token-exchange",
    error: "invalid_grant",
    error_description: "invalid code verifier",
    status: 400,
  });
  for (const value of [
    "https://private.example.test/code",
    "person@example.test",
    "org-sensitive",
    "client-sensitive",
    "eyJsecret.token.signature",
    "Invalid code verifier\n",
    "x".repeat(10000),
  ]) {
    const diagnostic = diagnosticFor(
      new SignInError("token-exchange", value, value, 400),
      "configuration",
    );
    assert.equal(diagnostic.error, "redacted");
    assert.equal(diagnostic.error_description, "redacted");
    assert.ok(JSON.stringify(diagnostic).length < 180);
    assert.ok(!JSON.stringify(diagnostic).includes(value));
  }
  assert.equal(
    diagnosticFor(
      new Error("https://secret.invalid/person@example.test"),
      "state-decrypt",
    ).stage,
    "state-decrypt",
  );
});
