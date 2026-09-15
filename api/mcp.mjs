// server/handler.ts
import { NodeStreamableHTTPServerTransport } from "@modelcontextprotocol/node";
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

// server/provider.ts
import { randomUUID } from "node:crypto";
function createSyntheticProvider(now = () => /* @__PURE__ */ new Date()) {
  const generations = { today: 0, attention: 0, goals: 0 };
  const providerInstance = randomUUID();
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
var base = {
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

// server/register.ts
import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE
} from "@modelcontextprotocol/ext-apps/server";
import { z as z2 } from "zod";
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
      inputSchema: z2.object({}).strict(),
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
function registerHome(server, loadHtml, provider2) {
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
        const data = schemas[widget].parse(await provider2(widget));
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
function createServer(provider2 = createSyntheticProvider(), loadHtml = loadBuiltHtml) {
  const server = new McpServer({ name: "acme-home-demo", version: "0.1.0" });
  for (const id of widgetIds)
    registerWidget(server, id, { provider: provider2, loadHtml });
  registerHome(server, loadHtml, provider2);
  return server;
}

// hosted/mcp.ts
var provider = createSyntheticProvider();
function handler(req, res) {
  if (req.method !== "POST") {
    rejectNonPost(res);
    return;
  }
  return handleMcpPost(() => createServer(provider), req, res, req.body);
}
export {
  handler as default
};
