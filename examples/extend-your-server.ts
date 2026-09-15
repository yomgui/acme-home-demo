import { McpServer } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { z } from "zod";
import { registerWidget } from "../server/register.ts";
import { loadBuiltHtml } from "../server/server.ts";
import { createSyntheticProvider } from "../server/provider.ts";
import { resolveIdentityMode } from "../server/identity-mode.ts";

if (resolveIdentityMode() !== "shared")
  throw new Error("Stdio supports shared mode only; use HTTP for identity");
const existingServer = new McpServer({
  name: "extension-example",
  version: "0.1.0",
});
existingServer.registerTool(
  "ping",
  { inputSchema: z.object({}) },
  async () => ({
    content: [{ type: "text", text: "Existing tool still works" }],
  }),
);
registerWidget(existingServer, "today", {
  provider: createSyntheticProvider(),
  loadHtml: loadBuiltHtml,
});
await existingServer.connect(new StdioServerTransport());
