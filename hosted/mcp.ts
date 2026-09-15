import type { IncomingMessage, ServerResponse } from "node:http";
import { handleMcpPost, rejectNonPost } from "../server/handler.ts";
import { createSyntheticProvider } from "../server/provider.ts";
import { createServer } from "../server/server.ts";

const provider = createSyntheticProvider();

export default function handler(
  req: IncomingMessage & { body?: unknown },
  res: ServerResponse,
) {
  if (req.method !== "POST") {
    rejectNonPost(res);
    return;
  }
  return handleMcpPost(() => createServer(provider), req, res, req.body);
}
