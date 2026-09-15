import type { IncomingMessage, ServerResponse } from "node:http";
import { NodeStreamableHTTPServerTransport } from "@modelcontextprotocol/node";
import type { McpServer } from "@modelcontextprotocol/server";

import { randomUUID } from "node:crypto";
import { resourceUri, type ViewId } from "../shared/contract.ts";
import {
  createOAuth,
  type AccessIdentity,
  type OAuthOptions,
  type OAuthRequest,
} from "./oauth.ts";
import {
  createPersonalProvider,
  identityKey,
  createSyntheticProvider,
  type WidgetProvider,
} from "./provider.ts";
import { createServer } from "./server.ts";

export const health = { ok: true, demo: true } as const;
export type HandlerOptions = OAuthOptions & {
  authRequired?: boolean;
  sharedServer?: () => McpServer;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
async function mcpBody(req: OAuthRequest): Promise<unknown> {
  if (req.method !== "POST") return undefined;
  let body: unknown = req.body;
  if (body === undefined) {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const value of req.iterator({ destroyOnReturn: false })) {
      const chunk: unknown = value;
      if (!Buffer.isBuffer(chunk)) throw new Error("Invalid body");
      size += chunk.length;
      if (size > 64 * 1024) throw new Error("Body too large");
      chunks.push(chunk);
    }
    body = Buffer.concat(chunks);
  }
  if (Buffer.isBuffer(body)) body = body.toString("utf8");
  if (typeof body === "string") {
    if (Buffer.byteLength(body) > 64 * 1024) throw new Error("Body too large");
    return body.length ? JSON.parse(body) : undefined;
  }
  if (Buffer.byteLength(JSON.stringify(body)) > 64 * 1024)
    throw new Error("Body too large");
  return body;
}
function publicMetadata(body: unknown): boolean {
  if (!isRecord(body) || body.jsonrpc !== "2.0") return false;
  if (
    [
      "initialize",
      "notifications/initialized",
      "tools/list",
      "resources/list",
      "resources/templates/list",
    ].includes(String(body.method))
  )
    return true;
  const views: ViewId[] = ["today", "attention", "goals", "home"];
  return (
    body.method === "resources/read" &&
    isRecord(body.params) &&
    views.some(
      (id) => isRecord(body.params) && body.params.uri === resourceUri(id),
    )
  );
}
export function createHandler(options: HandlerOptions = {}) {
  const required =
    options.authRequired ?? process.env.AUTH_REQUIRED !== "false";
  const oauth = required ? createOAuth(options) : undefined;
  const shared = createSyntheticProvider();
  const sharedServer = options.sharedServer ?? (() => createServer(shared));
  const providers = new Map<string, WidgetProvider>();
  const instance = randomUUID();
  const realMode =
    oauth?.metadata.authorizationServer.identity_mode === "openwork";
  function unauthorized(res: ServerResponse) {
    res.statusCode = 401;
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader(
      "WWW-Authenticate",
      oauth
        ? `Bearer realm="OAuth", resource_metadata="${oauth.metadata.authorizationServer.issuer}/.well-known/oauth-protected-resource", error="invalid_token", scope="home:read"`
        : 'Bearer error="invalid_token"',
    );
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Connect to personalize" }));
  }
  async function authenticate(
    req: OAuthRequest,
    res: ServerResponse,
  ): Promise<AccessIdentity | undefined> {
    try {
      if (req.headers.authorization !== undefined) {
        const token = /^Bearer ([A-Za-z0-9._~-]+)$/i.exec(
          req.headers.authorization,
        )?.[1];
        if (!token || !oauth) throw new Error("Invalid bearer");
        return await oauth.verifyAccessToken(token);
      }
      if (realMode) throw new Error("Missing bearer");
    } catch {
      unauthorized(res);
    }
    return undefined;
  }
  const handler = async (req: OAuthRequest, res: ServerResponse) => {
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    if (oauth && (await oauth.handle(req, res))) return;
    const path = req.url?.split("?")[0];
    if (path === "/healthz") {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(health));
      return;
    }
    if (path !== "/mcp" && path !== "/api/mcp") {
      res.statusCode = 404;
      res.end("Not found");
      return;
    }
    const identity = await authenticate(req, res);
    if (res.writableEnded) return;
    try {
      req.body = await mcpBody(req);
    } catch {
      res.statusCode = 400;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: "Invalid MCP request body" }));
      return;
    }
    if (required && !identity && !publicMetadata(req.body)) {
      unauthorized(res);
      return;
    }
    if (required && req.headers.origin !== undefined) {
      res.statusCode = 403;
      res.end("Use a host-mediated MCP connection");
      return;
    }
    if (req.method !== "POST") {
      rejectNonPost(res);
      return;
    }
    let factory = sharedServer;
    if (identity) {
      const subject = "identity_issuer" in identity ? identity : identity.sub;
      const key = typeof subject === "string" ? subject : identityKey(subject);
      let provider = providers.get(key);
      if (!provider) {
        provider = createPersonalProvider(subject, instance);
        providers.set(key, provider);
      }
      const selected = provider;
      const verifiedIdentity =
        typeof subject === "string" ? undefined : subject;
      factory = () => createServer((id) => selected(id, verifiedIdentity));
    }
    await handleMcpPost(factory, req, res, req.body);
  };
  return Object.assign(handler, {
    async preflight(req: OAuthRequest, res: ServerResponse) {
      const path = req.url?.split("?")[0];
      if (realMode && (path === "/mcp" || path === "/api/mcp"))
        await authenticate(req, res);
      return !res.writableEnded;
    },
  });
}

let configured: ReturnType<typeof createHandler> | undefined;
export default async function handler(req: OAuthRequest, res: ServerResponse) {
  try {
    configured ??= createHandler();
    await configured(req, res);
  } catch {
    if (!res.headersSent) {
      res.statusCode = 503;
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: "Demo configuration unavailable" }));
    }
  }
}

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
