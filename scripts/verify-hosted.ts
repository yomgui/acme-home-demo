import { createHash, randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { OAuthClientInformationFullSchema } from "@modelcontextprotocol/core";
import {
  definitions,
  payloadSchema,
  resourceUri,
  widgetIds,
  type Payload,
} from "../shared/contract.ts";

export type RequestOptions = {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
};
export function curlRequest(url: string, options: RequestOptions = {}) {
  const config = [
    `url = ${JSON.stringify(url)}`,
    `request = ${JSON.stringify(options.method ?? "GET")}`,
    ...Object.entries(options.headers ?? {}).map(
      ([key, value]) => `header = ${JSON.stringify(`${key}: ${value}`)}`,
    ),
    ...(options.body === undefined
      ? []
      : [`data = ${JSON.stringify(options.body)}`]),
  ].join("\n");
  const result = spawnSync(
    "curl",
    [
      "--disable",
      "--silent",
      "--include",
      "--suppress-connect-headers",
      "--proto",
      "=https",
      "--max-time",
      "30",
      "--config",
      "-",
    ],
    { input: config, encoding: "utf8", maxBuffer: 4 * 1024 * 1024 },
  );
  check(result.status === 0);
  const boundary = result.stdout.indexOf("\r\n\r\n");
  check(boundary >= 0);
  const lines = result.stdout.slice(0, boundary).split("\r\n");
  const status = Number(lines.shift()?.split(" ")[1]);
  const headers = new Map<string, string>();
  for (const line of lines) {
    const colon = line.indexOf(":");
    if (colon >= 0)
      headers.set(
        line.slice(0, colon).toLowerCase(),
        line.slice(colon + 1).trim(),
      );
  }
  const raw = result.stdout.slice(boundary + 4);
  return { status, headers, json: (): unknown => JSON.parse(raw) };
}
function check(value: unknown): asserts value {
  if (!value)
    throw new Error("Verification failed; sensitive details withheld");
}
function record(value: unknown): Record<string, unknown> {
  check(value !== null && typeof value === "object" && !Array.isArray(value));
  return Object.fromEntries(Object.entries(value));
}
function text(value: unknown): string {
  check(typeof value === "string");
  return value;
}
const rows = (value: Payload) =>
  value.kind === "today"
    ? value.meetings
    : value.kind === "attention"
      ? value.items
      : value.goals;

export function verifyHosted(
  base: string,
  http: typeof curlRequest = curlRequest,
) {
  const origin = new URL(base);
  check(origin.origin === base && origin.protocol === "https:");
  const resource = `${base}/mcp`;
  const discovery = http(`${base}/.well-known/oauth-authorization-server`);
  check(discovery.status === 200);
  const metadata = record(discovery.json());
  check(metadata.issuer === base);
  check(
    metadata.authorization_endpoint === `${base}/authorize` &&
      metadata.token_endpoint === `${base}/token` &&
      metadata.registration_endpoint === `${base}/register` &&
      metadata.jwks_uri === `${base}/.well-known/jwks.json`,
  );
  check(
    metadata.identity_mode === "openwork" || metadata.identity_mode === "demo",
  );
  check(
    text(metadata.description).includes(
      "codes are short-lived, not single-use",
    ),
  );
  const protectedResource = http(
    `${base}/.well-known/oauth-protected-resource`,
  );
  check(
    protectedResource.status === 200 &&
      record(protectedResource.json()).resource === resource,
  );
  const jwks = http(`${base}/.well-known/jwks.json`);
  check(jwks.status === 200);
  const keys = record(jwks.json()).keys;
  check(
    Array.isArray(keys) &&
      keys.length > 0 &&
      keys.every((key: unknown) => !("d" in record(key))),
  );
  let id = 0;
  function request(
    token: string | undefined,
    method: string,
    params: Record<string, unknown> = {},
  ) {
    return http(resource, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        ...(token === undefined ? {} : { Authorization: `Bearer ${token}` }),
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
    });
  }
  function rpc(
    token: string | undefined,
    method: string,
    params: Record<string, unknown> = {},
  ) {
    const response = request(token, method, params);
    check(response.status === 200);
    const envelope = record(response.json());
    check(!envelope.error);
    const result = record(envelope.result);
    check(!result.isError);
    return result;
  }
  if (metadata.identity_mode === "openwork") {
    const challenge = `Bearer realm="OAuth", resource_metadata="${base}/.well-known/oauth-protected-resource", error="invalid_token"`;
    const blocked = (response: ReturnType<typeof http>) => {
      check(response.status === 401);
      check(response.headers.get("www-authenticate")?.startsWith(challenge));
      check(typeof record(response.json()).error === "string");
    };
    for (const method of [
      "initialize",
      "tools/list",
      "resources/list",
      "resources/templates/list",
      "resources/read",
      "tools/call",
    ])
      blocked(
        request(
          undefined,
          method,
          method === "resources/read" ? { uri: resourceUri("home") } : {},
        ),
      );
    for (const path of ["/mcp", "/api/mcp"]) {
      for (const method of ["GET", "DELETE", "OPTIONS"])
        blocked(http(`${base}${path}`, { method }));
      blocked(
        http(`${base}${path}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "malformed",
        }),
      );
    }
    return {
      status: "INCOMPLETE",
      flows: 0,
      checks:
        "Public OAuth discovery passed; every tested anonymous MCP request rejected with 401 before body parsing. Authenticated sign-in and host proof remain unproved; no registration or authorization attempted.",
    };
  }
  const publicTools = rpc(undefined, "tools/list").tools;
  check(Array.isArray(publicTools) && publicTools.length === 4);
  for (const view of [...widgetIds, "home"] as const) {
    const blocked = request(undefined, "tools/call", {
      name: definitions[view].tool,
      arguments: {},
    });
    check(
      blocked.status === 401 &&
        blocked.headers.get("www-authenticate")?.includes("resource_metadata"),
    );
    const contents = rpc(undefined, "resources/read", {
      uri: resourceUri(view),
    }).contents;
    check(Array.isArray(contents));
    const html = text(record(contents[0]).text);
    check(
      html.includes("viewer-identity") &&
        html.includes("-generation") &&
        html.includes("Connect to personalize"),
    );
  }
  function authorize() {
    const redirect = "http://127.0.0.1:4321/home-demo-proof";
    const verifier = randomBytes(32).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const registration = http(`${base}/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        redirect_uris: [redirect],
        client_name: "OpenWork",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
        application_type: "web",
        scope: "home:read",
      }),
    });
    check(registration.status === 201);
    const parsed = OAuthClientInformationFullSchema.safeParse(
      registration.json(),
    );
    check(parsed.success);
    const client = parsed.data.client_id;
    check(
      client.length <= 512 &&
        JSON.stringify(parsed.data.grant_types) === '["authorization_code"]',
    );
    const state = randomBytes(16).toString("base64url");
    const params = new URLSearchParams({
      client_id: client,
      redirect_uri: redirect,
      response_type: "code",
      resource,
      scope: "home:read",
      code_challenge: challenge,
      code_challenge_method: "S256",
      state,
    });
    const approval = http(`${base}/authorize?${params}`);
    check(approval.status === 302);
    const destination = new URL(text(approval.headers.get("location")));
    check(
      destination.origin + destination.pathname === redirect &&
        destination.searchParams.get("state") === state,
    );
    const code = text(destination.searchParams.get("code"));
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      client_id: client,
      redirect_uri: redirect,
      resource,
      code,
      code_verifier: "w".repeat(43),
    });
    const exchange = () =>
      http(`${base}/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      });
    check(exchange().status === 400);
    body.set("code_verifier", verifier);
    const exchanged = exchange();
    check(exchanged.status === 200);
    const token = text(record(exchanged.json()).access_token);
    const parts = token.split(".");
    check(parts.length === 3 && parts[1]);
    const claims = record(
      JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")),
    );
    check(claims.iss === base && claims.aud === resource);
    for (const changes of [
      { aud: "https://wrong.example.test/mcp" },
      { iss: "https://wrong.example.test" },
      { sub: "forged" },
    ]) {
      const forged = [...parts];
      forged[1] = Buffer.from(
        JSON.stringify({ ...claims, ...changes }),
      ).toString("base64url");
      check(request(forged.join("."), "tools/list").status === 401);
    }
    return token;
  }
  const first = authorize();
  const second = authorize();
  const names = new Set<string>();
  const counts: Record<string, number[]> = {};
  const generations: Record<string, number[]> = {};
  let instanceChanges = 0;
  for (const widget of widgetIds) {
    const call = (token: string) =>
      payloadSchema.parse(
        rpc(token, "tools/call", {
          name: definitions.home.tool,
          arguments: { widget },
        }).structuredContent,
      );
    const a = call(first);
    const b = call(second);
    const refreshed = call(first);
    check(a.whoami && b.whoami && refreshed.whoami);
    check(
      a.whoami.name !== b.whoami.name &&
        a.whoami.fingerprint !== b.whoami.fingerprint,
    );
    for (const name of [a.whoami.name, b.whoami.name]) {
      check(/^[A-Za-z][A-Za-z .'-]{0,60} · [a-f0-9]{12}$/.test(name));
      names.add(name);
    }
    check(JSON.stringify(rows(a)) !== JSON.stringify(rows(b)));
    check(JSON.stringify(a.whoami) === JSON.stringify(refreshed.whoami));
    if (refreshed.providerInstance === a.providerInstance) {
      check(refreshed.generation > a.generation);
      check(JSON.stringify(rows(refreshed)) !== JSON.stringify(rows(a)));
    } else instanceChanges++;
    counts[widget] = [rows(a).length, rows(b).length];
    generations[widget] = [a.generation, refreshed.generation];
  }
  check(names.size === 2);
  return {
    status: instanceChanges === 0 ? "PASS" : "INCOMPLETE",
    flows: 2,
    names: [...names],
    counts,
    generations,
    instanceChanges,
    checks:
      "metadata/static UI 200; anonymous/invalid token 401; DCR 201; authorize 302; wrong PKCE 400; token/data 200",
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const base = process.argv[2];
    check(base);
    const result = verifyHosted(base);
    console.log(JSON.stringify(result, null, 2));
    if (result.status === "INCOMPLETE") process.exitCode = 2;
  } catch {
    console.error(
      "FAIL hosted verification; sensitive request/response material withheld. Check preview origin, configuration and hosting logs privately.",
    );
    process.exitCode = 1;
  }
}
