import { createHash, randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";

// Negative live probe only: never log OAuth URLs, cookies, codes or client IDs.
// Successful real-member consent must be completed separately in the browser.
const origin = process.argv[2];
function check(value, stage) {
  if (!value)
    throw new Error(`Live probe failed: ${stage}; sensitive material withheld`);
}
function request(url, method = "GET", body, headers = {}) {
  const config = [
    `url = ${JSON.stringify(url)}`,
    `request = ${JSON.stringify(method)}`,
    ...Object.entries(headers).map(
      ([name, value]) => `header = ${JSON.stringify(`${name}: ${value}`)}`,
    ),
    ...(body === undefined ? [] : [`data = ${JSON.stringify(body)}`]),
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
    { input: config, encoding: "utf8", maxBuffer: 1024 * 1024 },
  );
  check(result.status === 0, "curl");
  const boundary = result.stdout.indexOf("\r\n\r\n");
  check(boundary > 0, "HTTP headers");
  const lines = result.stdout.slice(0, boundary).split("\r\n");
  const status = Number(lines.shift()?.split(" ")[1]);
  const resultHeaders = new Map(
    lines.map((line) => [
      line.slice(0, line.indexOf(":")).toLowerCase(),
      line.slice(line.indexOf(":") + 1).trim(),
    ]),
  );
  return {
    status,
    headers: resultHeaders,
    body: result.stdout.slice(boundary + 4),
  };
}
try {
  check(
    new URL(origin).origin === origin && origin.startsWith("https://"),
    "origin",
  );
  const discovery = request(`${origin}/.well-known/oauth-authorization-server`);
  check(
    discovery.status === 200 && JSON.parse(discovery.body).issuer === origin,
    "stable issuer",
  );
  const anonymous = request(`${origin}/mcp`);
  check(
    anonymous.status === 401 &&
      anonymous.headers
        .get("www-authenticate")
        ?.includes(`${origin}/.well-known/oauth-protected-resource`),
    "anonymous challenge",
  );
  const callback = `${origin}/oauth/upstream/callback`;
  const upstreams = [];
  for (let index = 0; index < 2; index++) {
    const redirect = "http://127.0.0.1:49199/probe-callback";
    const registration = request(
      `${origin}/register`,
      "POST",
      JSON.stringify({
        redirect_uris: [redirect],
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code"],
        response_types: ["code"],
        scope: "home:read",
      }),
      { "content-type": "application/json" },
    );
    check(registration.status === 201, "downstream DCR");
    const client = JSON.parse(registration.body).client_id;
    const verifier = randomBytes(32).toString("base64url");
    const parameters = new URLSearchParams({
      response_type: "code",
      client_id: client,
      redirect_uri: redirect,
      resource: `${origin}/mcp`,
      scope: "home:read",
      state: randomBytes(32).toString("base64url"),
      code_challenge: createHash("sha256").update(verifier).digest("base64url"),
      code_challenge_method: "S256",
    });
    const authorization = request(`${origin}/authorize?${parameters}`);
    check(authorization.status === 302, "upstream authorization redirect");
    const upstream = new URL(authorization.headers.get("location"));
    check(
      upstream.origin === "https://app.openworklabs.com" &&
        upstream.pathname === "/api/auth/oauth2/authorize",
      "upstream endpoint",
    );
    check(
      upstream.searchParams.get("redirect_uri") === callback,
      "exact callback",
    );
    check(
      upstream.searchParams.get("state")?.split(".").length === 5,
      "encrypted state JWE",
    );
    const cookie = authorization.headers.get("set-cookie") ?? "";
    check(
      cookie.includes("SameSite=Lax") &&
        cookie.includes("Secure") &&
        cookie.includes("Path=/") &&
        !cookie.includes("Domain="),
      "cookie attributes",
    );
    check(
      cookie.split(";")[0].split("=")[1]?.length === 43,
      "nonce-only cookie size",
    );
    upstreams.push(upstream);
  }
  check(
    upstreams[0].searchParams.get("client_id") ===
      upstreams[1].searchParams.get("client_id"),
    "stable upstream registration",
  );
  // Deliberately invalid provider code: exercises the real callback without a cookie.
  // It must fail at token exchange, not accidentally authenticate a member.
  const state = upstreams[0].searchParams.get("state");
  const badCallback = request(
    `${callback}?${new URLSearchParams({ code: `intentionally-invalid-${randomBytes(16).toString("hex")}`, state, iss: "https://app.openworklabs.com/api/auth" })}`,
  );
  check(
    badCallback.status === 400 &&
      badCallback.body.includes("Sign-in expired, try again"),
    "safe invalid-code page",
  );
  console.log(
    JSON.stringify(
      {
        status: "PARTIAL",
        discovery: 200,
        anonymous: 401,
        authorizeRedirects: 2,
        stableClient: true,
        redirectUriEqual: true,
        encryptedState: true,
        nonceCookieBytes: 43,
        cookieSameSite: "Lax",
        invalidCodeCallback: 400,
        realMemberConsent: "NOT RUN — retry Connect in the browser",
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error(
    error instanceof Error && error.message.startsWith("Live probe failed:")
      ? error.message
      : "Live probe failed; sensitive material withheld",
  );
  process.exitCode = 1;
}
