import { createMcpExpressApp } from "@modelcontextprotocol/express";
import type { McpServer } from "@modelcontextprotocol/server";
import { createHandler, health, type HandlerOptions } from "./handler.ts";

export function resolvePort(raw: string = "4328") {
  if (!/^\d+$/.test(raw) || Number(raw) < 1 || Number(raw) > 65535)
    throw new Error("PORT must be an integer from 1 to 65535");
  return Number(raw);
}

export function createHttpApp(
  createServer: () => McpServer,
  options: HandlerOptions = {},
) {
  const handler = createHandler({ ...options, sharedServer: createServer });
  const app = createMcpExpressApp({ host: "127.0.0.1" });
  app.use((req, res, next) => {
    const host = req.headers.host;
    if (!host || !/^(127\.0\.0\.1|localhost):\d+$/.test(host)) {
      res.status(403).send("Invalid host");
      return;
    }
    if (req.headers.origin && req.headers.origin !== `http://${host}`) {
      res.status(403).send("Cross-origin requests are not allowed");
      return;
    }
    next();
  });
  app.get("/healthz", (_req, res) => {
    res.json(health);
  });
  app.all(
    [
      "/mcp",
      "/api/mcp",
      "/.well-known/oauth-authorization-server",
      "/.well-known/oauth-protected-resource",
      "/.well-known/oauth-protected-resource/mcp",
      "/.well-known/jwks.json",
      "/jwks.json",
      "/register",
      "/authorize",
      "/token",
      "/oauth/upstream/callback",
    ],
    (req, res) => handler(req, res),
  );
  return app;
}
