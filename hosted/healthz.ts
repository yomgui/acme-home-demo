import type { IncomingMessage, ServerResponse } from "node:http";
import { health } from "../server/handler.ts";

export default function handler(_req: IncomingMessage, res: ServerResponse) {
  res.statusCode = 200;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(health));
}
