import type { IncomingMessage, ServerResponse } from "node:http";
import { NodeStreamableHTTPServerTransport } from "@modelcontextprotocol/node";
import type { McpServer } from "@modelcontextprotocol/server";

export const health = { ok: true, demo: true } as const;

export async function handleMcpPost(
  createServer: () => McpServer,
  req: IncomingMessage,
  res: ServerResponse,
  parsedBody?: unknown,
) {
  const server = createServer();
  const transport = new NodeStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
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
          error: { code: -32603, message: "MCP request failed" },
        }),
      );
    }
  }
}

export function rejectNonPost(res: ServerResponse) {
  res.statusCode = 405;
  res.setHeader("Allow", "POST");
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.end("Use stateless MCP POST");
}
