import assert from "node:assert/strict";
import { once } from "node:events";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { request } from "node:http";
import { test, type TestContext } from "node:test";
import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { resourceBoundCall } from "./resource-gate.ts";
import { createHttpApp, resolvePort } from "../server/http.ts";
import { createServer } from "../server/server.ts";
import {
  createSyntheticProvider,
  type WidgetProvider,
} from "../server/provider.ts";
import {
  definitions,
  resourceUri,
  widgetIds,
  parseResult,
} from "../shared/contract.ts";

async function fixture(
  t: TestContext,
  provider: WidgetProvider = createSyntheticProvider(),
) {
  const listener = createHttpApp(() => createServer(provider), {
    authRequired: false,
  }).listen(0, "127.0.0.1");
  await once(listener, "listening");
  const address = listener.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  const client = new Client({ name: "acme-protocol-test", version: "1" });
  t.after(async () => {
    await client.close();
    listener.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      listener.close((error) => (error ? reject(error) : resolve())),
    );
  });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${base}/mcp`)),
  );
  return { client, base };
}

test("CLI refuses public binding before opening a listener", async () => {
  await assert.rejects(
    () =>
      promisify(execFile)(
        process.execPath,
        ["--import", "tsx", "server/main.ts"],
        { env: { ...process.env, HOST: "0.0.0.0" }, timeout: 5_000 },
      ),
    /public binds are forbidden/,
  );
});

test("MCP exposes four neutral tools with exact ui resource bindings and self-contained HTML", async (t) => {
  const { client } = await fixture(t);
  assert.equal(client.getServerVersion()?.name, "acme-home-demo");
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((tool) => tool.name).sort(), [
    "acme_attention",
    "acme_goals",
    "acme_home",
    "acme_today",
  ]);
  const { resources } = await client.listResources();
  assert.deepEqual(resources.map((resource) => resource.uri).sort(), [
    "ui://acme-home/attention.html",
    "ui://acme-home/goals.html",
    "ui://acme-home/home.html",
    "ui://acme-home/today.html",
  ]);
  for (const id of [...widgetIds, "home"] as const) {
    const tool = tools.find((tool) => tool.name === definitions[id].tool);
    assert.deepEqual(tool?._meta?.ui, {
      resourceUri: resourceUri(id),
      visibility: ["model", "app"],
    });
    assert.equal(tool?.annotations?.readOnlyHint, true);
    assert.equal(tool?.annotations?.destructiveHint, false);
    assert.equal(tool?.annotations?.openWorldHint, false);
    const result = await client.readResource({ uri: resourceUri(id) });
    assert.equal(result.contents.length, 1);
    const content = result.contents[0];
    assert.ok(content && "text" in content);
    assert.equal(content.mimeType, RESOURCE_MIME_TYPE);
    assert.equal(content.uri, resourceUri(id));
    assert.match(content.text, /<!doctype html>/);
    assert.ok(Buffer.byteLength(content.text) < 768 * 1024);
    assert.ok(!content.text.includes('<script src="'));
    assert.deepEqual(content._meta?.ui, {
      csp: { connectDomains: [], resourceDomains: [] },
    });
  }
});

test("acme_home {} returns only the shell and makes zero provider calls", async (t) => {
  let calls = 0;
  const { client } = await fixture(t, async (id) => {
    calls++;
    return createSyntheticProvider()(id);
  });
  const result = await client.callTool({ name: "acme_home", arguments: {} });
  assert.equal(result.isError, undefined);
  assert.deepEqual(result.structuredContent, { kind: "shell", demo: true });
  assert.match(JSON.stringify(result.content), /Acme Home/);
  assert.equal(calls, 0);
});

test("home has explicit launch and panel schemas, each selector calls only its provider", async (t) => {
  const provider = createSyntheticProvider();
  const calls: string[] = [];
  const { client } = await fixture(t, async (id) => {
    calls.push(id);
    return provider(id);
  });
  const tool = (await client.listTools()).tools.find(
    (tool) => tool.name === definitions.home.tool,
  );
  assert.ok(Array.isArray(tool?.inputSchema.anyOf));
  assert.ok(Array.isArray(tool?.outputSchema?.oneOf));
  assert.equal(tool.inputSchema.anyOf.length, 4);
  assert.equal(tool.outputSchema.oneOf.length, 4);
  for (const widget of [...widgetIds, "today"] as const) {
    const before = calls.length;
    const result = parseResult(
      widget,
      await client.callTool({
        name: definitions.home.tool,
        arguments: { widget },
      }),
    );
    assert.equal(result.kind, widget);
    assert.equal(calls.length, before + 1);
    assert.equal(calls.at(-1), widget);
  }
  assert.deepEqual(calls, ["today", "attention", "goals", "today"]);
});

test("home rejects unsupported inputs before execution and isolates panel failures", async (t) => {
  const provider = createSyntheticProvider();
  const calls: string[] = [];
  const { client } = await fixture(t, async (id) => {
    calls.push(id);
    if (id === "attention") throw new Error("private provider error");
    return provider(id);
  });
  const failure = await client.callTool({
    name: definitions.home.tool,
    arguments: { widget: "attention" },
  });
  assert.equal(failure.isError, true);
  assert.ok(!JSON.stringify(failure).includes("private provider"));
  assert.equal(
    parseResult(
      "goals",
      await client.callTool({
        name: definitions.home.tool,
        arguments: { widget: "goals" },
      }),
    ).kind,
    "goals",
  );
  for (const args of [
    { widget: "all" },
    { widget: null },
    { widget: ["today", "goals"] },
    { widget: "today", extra: true },
    { extra: true },
  ]) {
    assert.equal(
      (await client.callTool({ name: definitions.home.tool, arguments: args }))
        .isError,
      true,
    );
  }
  for (const id of widgetIds)
    assert.equal(
      (
        await client.callTool({
          name: definitions[id].tool,
          arguments: { widget: id },
        })
      ).isError,
      true,
    );
  assert.deepEqual(calls, ["attention", "goals"]);
});

test("host resource gate blocks all cross-bound calls before provider execution", async (t) => {
  const calls: string[] = [];
  const provider = createSyntheticProvider();
  const { client } = await fixture(t, async (id) => {
    calls.push(id);
    return provider(id);
  });
  const { tools } = await client.listTools();
  for (const mounted of [...widgetIds, "home"] as const) {
    for (const target of [...widgetIds, "home"] as const) {
      const params = {
        name: definitions[target].tool,
        arguments: target === "home" ? { widget: "today" } : {},
      };
      const before = calls.length;
      const result = await resourceBoundCall(
        tools,
        resourceUri(mounted),
        params,
        () => client.callTool(params),
      );
      if (mounted === target) {
        assert.equal(result.isError, undefined);
        assert.equal(calls.length, before + 1);
      } else {
        assert.equal(result.isError, true);
        assert.match(JSON.stringify(result.content), /tool_resource_mismatch/);
        assert.equal(calls.length, before);
      }
    }
  }
});

test("standalone widgets refresh independently with validated synthetic payloads", async (t) => {
  const calls: string[] = [];
  const provider = createSyntheticProvider();
  const { client } = await fixture(t, async (id) => {
    calls.push(id);
    return provider(id);
  });
  for (const id of widgetIds) {
    const result = parseResult(
      id,
      await client.callTool({ name: definitions[id].tool, arguments: {} }),
    );
    assert.equal(result.kind, id);
    assert.equal(result.generation, 1);
    assert.equal(result.demo, true);
  }
  assert.equal(
    parseResult(
      "today",
      await client.callTool({ name: definitions.today.tool, arguments: {} }),
    ).generation,
    2,
  );
  assert.deepEqual(calls, ["today", "attention", "goals", "today"]);
});

test("invalid provider output and provider exceptions do not leak details", async (t) => {
  const provider = createSyntheticProvider();
  const { client } = await fixture(t, async (id) => {
    if (id === "attention") throw new Error("private implementation");
    if (id === "today") return provider("goals");
    return provider(id);
  });
  for (const id of ["attention", "today"] as const) {
    const result = await client.callTool({
      name: definitions[id].tool,
      arguments: {},
    });
    assert.equal(result.isError, true);
    assert.ok(!JSON.stringify(result).includes("private implementation"));
  }
  assert.equal(
    parseResult(
      "goals",
      await client.callTool({ name: definitions.goals.tool, arguments: {} }),
    ).kind,
    "goals",
  );
});

test("unknown tools and resources are rejected", async (t) => {
  const { client } = await fixture(t);
  await assert.rejects(
    () => client.callTool({ name: "refresh_everything", arguments: {} }),
    /not found/,
  );
  await assert.rejects(() =>
    client.readResource({ uri: "ui://acme-home/private.html" }),
  );
});

test("loopback HTTP rejects foreign and opaque origins, rebinding and unsupported methods", async (t) => {
  const { base } = await fixture(t);
  assert.equal((await fetch(`${base}/healthz`)).status, 200);
  const hostStatus = await new Promise<number | undefined>(
    (resolve, reject) => {
      const req = request(
        `${base}/mcp`,
        {
          method: "POST",
          headers: {
            Host: "attacker.invalid",
            "Content-Type": "application/json",
          },
        },
        (res) => {
          res.resume();
          resolve(res.statusCode);
        },
      );
      req.on("error", reject);
      req.end("{}");
    },
  );
  assert.equal(hostStatus, 403);
  for (const Origin of ["https://foreign.invalid", "null"]) {
    const result = await fetch(`${base}/mcp`, {
      method: "POST",
      headers: { Origin, "Content-Type": "application/json" },
      body: "{}",
    });
    assert.equal(result.status, 403);
    assert.equal(result.headers.get("access-control-allow-origin"), null);
  }
  assert.equal(
    (await fetch(`${base}/healthz`, { headers: { Origin: base } })).status,
    200,
  );
  assert.equal((await fetch(`${base}/mcp`)).status, 405);
  for (const port of ["0", "65536", "abc", "4328x", "-1"])
    assert.throws(() => resolvePort(port));
  assert.equal(resolvePort(), 4328);
});

test("stdio exposes the same launch contract without depending on HTTP", async (t) => {
  const client = new Client({ name: "acme-stdio-test", version: "1" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--import", "tsx", "server/main.ts", "--stdio"],
    cwd: process.cwd(),
    stderr: "pipe",
  });
  t.after(() => client.close());
  await client.connect(transport);
  assert.equal((await client.listTools()).tools.length, 4);
  assert.deepEqual(
    (await client.callTool({ name: "acme_home", arguments: {} }))
      .structuredContent,
    { kind: "shell", demo: true },
  );
  assert.equal(
    parseResult(
      "today",
      await client.callTool({
        name: "acme_home",
        arguments: { widget: "today" },
      }),
    ).kind,
    "today",
  );
});
