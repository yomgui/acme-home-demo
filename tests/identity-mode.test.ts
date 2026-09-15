import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { once } from "node:events";
import { createServer, request } from "node:http";
import { promisify } from "node:util";
import { test, type TestContext } from "node:test";
import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import handler, {
  createHandler,
  type HandlerOptions,
} from "../server/handler.ts";
import { createHttpApp } from "../server/http.ts";
import { resolveIdentityMode } from "../server/identity-mode.ts";
import { createServer as createMcpServer } from "../server/server.ts";
import { createSyntheticProvider } from "../server/provider.ts";
import {
  definitions,
  parseResult,
  resourceUri,
  widgetIds,
} from "../shared/contract.ts";

function cleanEnvironment(t: TestContext) {
  for (const key of [
    "IDENTITY_MODE",
    "AUTH_REQUIRED",
    "DEMO_AS_ISSUER",
    "DEMO_AS_PRIVATE_KEY",
    "VERCEL_URL",
    "UPSTREAM_ISSUER",
  ]) {
    const previous = process.env[key];
    delete process.env[key];
    t.after(() => {
      if (previous === undefined) delete process.env[key];
      else process.env[key] = previous;
    });
  }
}

async function fixture(
  t: TestContext,
  express: boolean,
  options: HandlerOptions = {},
) {
  const direct = createHandler(options);
  const provider = createSyntheticProvider();
  const listener = express
    ? createHttpApp(() => createMcpServer(provider), options).listen(
        0,
        "127.0.0.1",
      )
    : createServer((req, res) => {
        void direct(req, res);
      }).listen(0, "127.0.0.1");
  await once(listener, "listening");
  t.after(async () => {
    listener.closeAllConnections();
    await new Promise<void>((resolve) => listener.close(() => resolve()));
  });
  const address = listener.address();
  assert.ok(address && typeof address !== "string");
  return `http://127.0.0.1:${address.port}`;
}

for (const express of [false, true]) {
  test(`${express ? "Express" : "direct"}: default shared allows anonymous initialize, lists, resources and every tool without signing configuration`, async (t) => {
    cleanEnvironment(t);
    const base = await fixture(t, express);
    const client = new Client({ name: "shared-mode-test", version: "1" });
    t.after(() => client.close());
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`${base}/mcp`)),
    );
    assert.equal(client.getServerVersion()?.name, "acme-home-demo");
    assert.deepEqual(
      (await client.listTools()).tools.map((tool) => tool.name).sort(),
      ["acme_attention", "acme_goals", "acme_home", "acme_today"],
    );
    assert.equal((await client.listResources()).resources.length, 4);
    for (const view of [...widgetIds, "home"] as const) {
      const result = await client.readResource({ uri: resourceUri(view) });
      assert.equal(result.contents[0]?.uri, resourceUri(view));
    }
    assert.deepEqual(
      (await client.callTool({ name: "acme_home", arguments: {} }))
        .structuredContent,
      { kind: "shell", demo: true },
    );
    for (const widget of widgetIds) {
      const standalone = parseResult(
        widget,
        await client.callTool({
          name: definitions[widget].tool,
          arguments: {},
        }),
      );
      const selected = parseResult(
        widget,
        await client.callTool({
          name: "acme_home",
          arguments: { widget },
        }),
      );
      assert.equal(standalone.whoami, undefined);
      assert.equal(selected.whoami, undefined);
      assert.equal(selected.generation, standalone.generation + 1);
    }
    const discovery = await fetch(
      `${base}/.well-known/oauth-authorization-server`,
    );
    assert.equal(discovery.status, 404);
    assert.equal(discovery.headers.get("www-authenticate"), null);
  });

  test(`${express ? "Express" : "direct"}: explicit openwork ignores AUTH_REQUIRED=false and challenges before reading unfinished initialize`, async (t) => {
    cleanEnvironment(t);
    process.env.IDENTITY_MODE = "openwork";
    process.env.AUTH_REQUIRED = "false";
    const privateKeyPem = generateKeyPairSync("ed25519")
      .privateKey.export({ format: "pem", type: "pkcs8" })
      .toString();
    const base = await fixture(t, express, {
      issuer: "https://home.example.test",
      privateKeyPem,
      upstreamOptions: { env: {} },
    });
    for (const path of ["/mcp", "/api/mcp"]) {
      const response = await new Promise<{
        status: number | undefined;
        challenge: string | undefined;
      }>((resolve, reject) => {
        const req = request(
          `${base}${path}`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Content-Length": "65536",
            },
          },
          (res) => {
            const value = {
              status: res.statusCode,
              challenge: res.headers["www-authenticate"],
            };
            res.resume();
            res.on("end", () => {
              resolve(value);
              req.destroy();
            });
          },
        );
        req.on("error", reject);
        req.setTimeout(2_000, () =>
          req.destroy(new Error("Auth waited for body")),
        );
        req.write('{"jsonrpc":"2.0","method":"initialize",');
      });
      assert.equal(response.status, 401);
      assert.equal(
        response.challenge,
        'Bearer realm="OAuth", resource_metadata="https://home.example.test/.well-known/oauth-protected-resource", error="invalid_token", scope="home:read"',
      );
    }
    assert.equal(
      (await fetch(`${base}/.well-known/oauth-authorization-server`)).status,
      200,
    );
  });
}

test("mode selection is explicit, shared by default and independent of legacy auth flags", (t) => {
  cleanEnvironment(t);
  assert.equal(resolveIdentityMode(), "shared");
  assert.equal(createHandler().identityMode, "shared");
  for (const legacy of ["true", "false", "invalid"]) {
    process.env.AUTH_REQUIRED = legacy;
    assert.equal(createHandler().identityMode, "shared");
  }
  process.env.IDENTITY_MODE = "openwork";
  assert.equal(resolveIdentityMode(), "openwork");
  assert.throws(() => createHandler(), /DEMO_AS_ISSUER/);
  assert.equal(
    createHandler({ identityMode: "shared" }).identityMode,
    "shared",
  );
  assert.doesNotThrow(() =>
    createHandler({ identityMode: "shared", privateKeyPem: "invalid" }),
  );
  for (const mode of ["", "unknown", "Shared", "false", " openwork "]) {
    process.env.IDENTITY_MODE = mode;
    assert.throws(() => createHandler(), /IDENTITY_MODE/);
    assert.throws(() => resolveIdentityMode(mode), /IDENTITY_MODE/);
  }
  process.env.IDENTITY_MODE = "openwork";
  assert.throws(
    () => createHandler({ issuer: "https://home.example.test" }),
    /DEMO_AS_PRIVATE_KEY/,
  );
  assert.throws(
    () =>
      createHandler({
        issuer: "https://home.example.test",
        privateKeyPem: "invalid",
      }),
    /DEMO_AS_PRIVATE_KEY/,
  );
  assert.equal(resolveIdentityMode("demo"), "demo");
});

test("hosted configuration failures return safe 503 rather than falling back to shared", async (t) => {
  cleanEnvironment(t);
  process.env.IDENTITY_MODE = "openwork";
  process.env.AUTH_REQUIRED = "false";
  const listener = createServer((req, res) => {
    void handler(req, res);
  }).listen(0, "127.0.0.1");
  await once(listener, "listening");
  t.after(async () => {
    listener.closeAllConnections();
    await new Promise<void>((resolve) => listener.close(() => resolve()));
  });
  const address = listener.address();
  assert.ok(address && typeof address !== "string");
  for (const mode of ["openwork", "invalid", ""]) {
    process.env.IDENTITY_MODE = mode;
    const response: Response = await fetch(
      `http://127.0.0.1:${address.port}/mcp`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not-json",
      },
    );
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), {
      error: "Demo configuration unavailable",
    });
  }
});

test("stdio entry points refuse non-shared identity modes instead of bypassing auth", async () => {
  for (const entry of ["server/main.ts", "examples/extend-your-server.ts"]) {
    for (const mode of ["openwork", "demo", "invalid"]) {
      await assert.rejects(
        () =>
          promisify(execFile)(
            process.execPath,
            ["--import", "tsx", entry, "--stdio"],
            {
              env: {
                ...process.env,
                IDENTITY_MODE: mode,
                AUTH_REQUIRED: "false",
              },
              timeout: 5_000,
            },
          ),
        mode === "invalid"
          ? /IDENTITY_MODE/
          : /Stdio supports shared mode only/,
      );
    }
  }
});
