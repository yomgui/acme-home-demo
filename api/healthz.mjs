// server/handler.ts
import { NodeStreamableHTTPServerTransport } from "@modelcontextprotocol/node";
var health = { ok: true, demo: true };

// hosted/healthz.ts
function handler(_req, res) {
  res.statusCode = 200;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(health));
}
export {
  handler as default
};
