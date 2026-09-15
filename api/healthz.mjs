// server/handler.ts
import { NodeStreamableHTTPServerTransport } from "@modelcontextprotocol/node";

// shared/contract.ts
import { z } from "zod";
var identityFields = {
  name: z.string(),
  firstName: z.string(),
  role: z.string(),
  avatar: z.string(),
  fingerprint: z.string(),
  subjectShort: z.string().optional()
};
var identitySchema = z.discriminatedUnion("identityMode", [
  z.object({
    ...identityFields,
    identityMode: z.literal("per_member"),
    synthetic: z.literal(true)
  }),
  z.object({
    ...identityFields,
    identityMode: z.literal("openwork"),
    synthetic: z.literal(false),
    subjectShort: z.string().min(1),
    email: z.string(),
    org_id: z.string().min(1)
  })
]);
var base = {
  whoami: identitySchema.optional(),
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

// server/oauth.ts
import { jwtVerify as jwtVerify2, SignJWT } from "jose";

// server/upstream.ts
import { createLocalJWKSet, EncryptJWT, jwtDecrypt, jwtVerify } from "jose";
import { z as z2 } from "zod";
var RESPONSE_LIMIT = 64 * 1024;
var opaque = z2.string().regex(/^[A-Za-z0-9_-]{43}$/);
var boundedClaim = (max) => z2.string().min(1).max(max).refine(
  (value) => value.trim().length > 0 && !/[\u0000-\u001f\u007f]/.test(value)
);
var realIdentitySchema = z2.object({
  identityMode: z2.literal("openwork"),
  sub: boundedClaim(256),
  name: boundedClaim(256),
  email: boundedClaim(320),
  org_id: boundedClaim(256)
});
var downstreamSchema = z2.object({
  client_id: boundedClaim(512),
  redirect_uri: boundedClaim(2048),
  resource: boundedClaim(2048),
  code_challenge: opaque,
  state: z2.string().max(1024).optional()
}).strict();
var transactionSchema = z2.object({
  purpose: z2.literal("oidc-transaction"),
  clientId: boundedClaim(512),
  state: opaque,
  nonce: opaque,
  verifier: opaque,
  downstream: downstreamSchema
});

// server/oauth.ts
var BODY_LIMIT = 16 * 1024;
var CLIENT_TTL = 30 * 24 * 3600;

// server/server.ts
import { McpServer } from "@modelcontextprotocol/server";

// server/register.ts
import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE
} from "@modelcontextprotocol/ext-apps/server";
import { z as z3 } from "zod";

// server/handler.ts
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
