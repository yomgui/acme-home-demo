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
    identity_issuer: z.string().min(1).max(2048),
    org_id: z.string().min(1).nullable().default(null)
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
import { createLocalJWKSet, EncryptJWT as EncryptJWT2, jwtDecrypt as jwtDecrypt2, jwtVerify } from "jose";
import { z as z3 } from "zod";

// server/upstream-client.ts
import { BlobNotFoundError, get, put } from "@vercel/blob";
import { EncryptJWT, jwtDecrypt } from "jose";
import { z as z2 } from "zod";
var field = (max) => z2.string().min(1).max(max).refine(
  (value) => value.trim().length > 0 && !/[\u0000-\u001f\u007f]/.test(value)
);
var authMethodSchema = z2.enum([
  "none",
  "client_secret_post",
  "client_secret_basic"
]);
var registrationSchema = z2.object({
  clientId: field(512),
  clientSecret: field(4096).optional(),
  authMethod: authMethodSchema,
  issuer: field(2048),
  redirectUri: field(2048)
});

// server/upstream.ts
var RESPONSE_LIMIT = 64 * 1024;
var opaque = z3.string().regex(/^[A-Za-z0-9_-]{43}$/);
var boundedClaim = (max) => z3.string().min(1).max(max).refine(
  (value) => value.trim().length > 0 && !/[\u0000-\u001f\u007f]/.test(value)
);
var realIdentitySchema = z3.object({
  identityMode: z3.literal("openwork"),
  sub: boundedClaim(256),
  name: boundedClaim(256),
  email: boundedClaim(320),
  identity_issuer: boundedClaim(2048),
  org_id: boundedClaim(256).nullable().default(null)
});
var downstreamSchema = z3.object({
  client_id: boundedClaim(512),
  redirect_uri: boundedClaim(2048),
  resource: boundedClaim(2048),
  code_challenge: opaque,
  state: z3.string().max(1024).optional()
}).strict();
var transactionSchema = z3.object({
  purpose: z3.literal("oidc-transaction-v2"),
  clientId: boundedClaim(512),
  authMethod: authMethodSchema,
  redirectUri: boundedClaim(2048),
  browserHash: z3.string().regex(/^[0-9a-f]{64}$/),
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
import { z as z4 } from "zod";

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
