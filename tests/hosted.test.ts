import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import {
  definitions,
  resourceUri,
  widgetIds,
  parseResult,
} from "../shared/contract.ts";

const mcpUrl = new URL("../api/mcp.mjs", import.meta.url);
const healthUrl = new URL("../api/healthz.mjs", import.meta.url);

test("generated hosted adapters serve health and the exact MCP launch/resource contract", async (t) => {
  const mcp = await import(mcpUrl.href);
  const health = await import(healthUrl.href);
  assert.equal(typeof mcp.default, "function");
  assert.equal(typeof health.default, "function");
  const listener = createServer((req, res) => {
    if (req.url === "/healthz") health.default(req, res);
    else void mcp.default(req, res);
  }).listen(0, "127.0.0.1");
  await once(listener, "listening");
  const address = listener.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  const client = new Client({ name: "acme-hosted-test", version: "1" });
  t.after(async () => {
    await client.close();
    listener.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      listener.close((error) => (error ? reject(error) : resolve())),
    );
  });
  const healthy = await fetch(`${base}/healthz`);
  assert.equal(healthy.status, 200);
  assert.equal(healthy.headers.get("cache-control"), "no-store");
  assert.deepEqual(await healthy.json(), { ok: true, demo: true });
  for (const method of ["GET", "DELETE"]) {
    const response = await fetch(`${base}/mcp`, { method });
    assert.equal(response.status, 405);
    assert.equal(response.headers.get("allow"), "POST");
  }
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${base}/mcp`)),
  );
  const { tools } = await client.listTools();
  assert.equal(tools.length, 4);
  assert.deepEqual(tools.find((tool) => tool.name === "acme_home")?._meta?.ui, {
    resourceUri: "ui://acme-home/home.html",
    visibility: ["model", "app"],
  });
  assert.deepEqual(
    (await client.callTool({ name: "acme_home", arguments: {} }))
      .structuredContent,
    { kind: "shell", demo: true },
  );
  for (const id of [...widgetIds, "home"] as const) {
    const result = await client.readResource({ uri: resourceUri(id) });
    const resource = result.contents[0];
    assert.ok(resource && "text" in resource);
    assert.equal(resource.mimeType, RESOURCE_MIME_TYPE);
    assert.match(resource.text, /Acme Home/);
    assert.equal(
      resource.text,
      await readFile(new URL(`../dist/${id}.html`, import.meta.url), "utf8"),
    );
  }
  for (const widget of widgetIds)
    assert.equal(
      parseResult(
        widget,
        await client.callTool({
          name: definitions.home.tool,
          arguments: { widget },
        }),
      ).generation,
      1,
    );
});

test("Vercel packaging includes resources, external dependencies and a neutral static landing page", async () => {
  const config = JSON.parse(
    await readFile(new URL("../vercel.json", import.meta.url), "utf8"),
  );
  assert.equal(config.outputDirectory, "public");
  assert.equal(config.buildCommand, "pnpm build");
  assert.equal(config.installCommand, "pnpm install --frozen-lockfile");
  assert.equal(config.functions["api/mcp.mjs"].includeFiles, "dist/**");
  assert.deepEqual(config.rewrites, [
    { source: "/mcp", destination: "/api/mcp" },
    { source: "/healthz", destination: "/api/healthz" },
  ]);
  const ignored = (
    await readFile(new URL("../.vercelignore", import.meta.url), "utf8")
  ).split("\n");
  for (const entry of [
    ".git/",
    ".vercel/",
    "tests/",
    "test-results/",
    "screenshots/",
    "artifacts/",
    "node_modules/",
    ".env",
    ".env.*",
  ])
    assert.ok(ignored.includes(entry));
  for (const file of [
    "hosted/",
    "server/",
    "shared/",
    "src/",
    "scripts/",
    "public/",
  ])
    assert.ok(!ignored.includes(file));
  const bundle = await readFile(mcpUrl, "utf8");
  assert.match(bundle, /from "@modelcontextprotocol\/server"/);
  assert.ok(!bundle.includes("node_modules/"));
  const landing = await readFile(
    new URL("../public/index.html", import.meta.url),
    "utf8",
  );
  assert.match(landing, /<title>Acme Home<\/title>/);
  assert.ok(landing.includes('{"name":"acme_home","arguments":{}}'));
  assert.ok(landing.includes("ui://acme-home/home.html"));
  assert.ok(!landing.includes("<script"));
});
