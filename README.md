# Acme Home

One codebase, synthetic work data, two public modes:

- **Shared production:** `https://acme-home-demo.vercel.app/mcp`. `IDENTITY_MODE=shared` is the default: no key/account/auth configuration; anonymous initialize, listings, resources and calls. “Good morning/afternoon/evening!” uses the viewer's timezone with no name.
- **Per-user production:** `https://acme-home-demo-peruser.vercel.app/mcp`, explicit `IDENTITY_MODE=openwork`, separate `prologe/acme-home-demo-peruser` project from the same source. Hosted protocol checks passed; real-member Connect remains the operator's acceptance step.

`acme_home {}` launches `ui://acme-home/home.html` without a provider call. Each panel calls that same tool with `{widget: "today" | "attention" | "goals"}`. Standalone `acme_today`, `acme_attention`, `acme_goals` use `{}` and matching resources. Cross-resource calls reject; independent home panels share one permission scope. Standard MCP Apps, not HTML imports or Cloud Artifacts.

In Den Dashboard → Add app, add **Acme Home** (Run automatically). **Today at a Glance**, **Needs Your Attention**, and **My Goals** are optional standalone cards, not internal helper tools; the combined demo needs only Home.

## Run and extend

Use operator-prepared Node 24.x, pnpm 11.4.0 and pinned dependencies:

```sh
pnpm build
pnpm serve
```

HTTP is loopback-only, port 4328 (`PORT` overrides). Alternatives: `pnpm serve:stdio` (shared-only) or `pnpm example` (`examples/extend-your-server.ts`: existing `ping` plus `registerWidget` adding only Today). Inject a matching provider/HTML loader to extend your own server; real data requires reviewed authorization and schemas. Rebuild, restart and relaunch after edits.

Refresh/errors/data retention are panel-local. Opt-in 60-second polling never overlaps calls and stops on error, denial, toggle-off or teardown; calls have a 20-second deadline, no automatic retry. Auth loss clears identity/data. Shared values stay fixed; generations/timestamps come from responses and counters are per widget/instance. Search, details, dialogs, composer and customization are local previews; auxiliary tiles are illustrations.

## Hosting and configuration

Vercel uses `vercel.json`: Node 24.x, frozen-lockfile installation, `pnpm build`, static `public/`, packaged `dist/**`, OAuth/MCP rewrites. Rebuild tracked `api/*.mjs` before shipping. Platform deployment protection is separate from application auth; changes require authorization. Use separate deployment environments for the two modes; an alias alone does not isolate environment variables.

`IDENTITY_MODE` alone selects policy; legacy `AUTH_REQUIRED` is ignored. Unknown/empty modes or invalid OpenWork signing configuration fail closed (hosted 503), never fall back to shared. Internal `demo` mode retains synthetic-UUID auto-approval for tests, not real identity.

OpenWork mode requires:

- `DEMO_AS_ISSUER`: exact HTTPS app origin, no trailing slash; `https://acme-home-demo-peruser.vercel.app`. Trusted `VERCEL_URL` is only a fallback; request headers never choose trust.
- `DEMO_AS_PRIVATE_KEY`: stable Ed25519 PKCS8 PEM; runtime never generates replacements. Separate HKDF contexts derive AES-GCM state/cache keys.
- `UPSTREAM_ISSUER`: defaults to `https://app.openworklabs.com/api/auth`.
- `UPSTREAM_CLIENT_ID`, `UPSTREAM_CLIENT_ISSUER`, `UPSTREAM_CLIENT_REDIRECT_URI`: registered client and exact issuer/callback bindings. `UPSTREAM_CLIENT_AUTH_METHOD=none` for the pinned public client, no secret. Explicit `client_secret_post`/`client_secret_basic` require matching registration and `UPSTREAM_CLIENT_SECRET`.

The per-user project's production public client is pinned to `https://acme-home-demo-peruser.vercel.app/oauth/upstream/callback`, with a new independent Ed25519 signing key stored as a sensitive env value. The operator alias `UPSTREAM_REDIRECT_URI` is also pinned, but runtime reads **`UPSTREAM_CLIENT_REDIRECT_URI`**. Existing `acme-home-demo` Preview registration/env/key and its `acme-home-demo-peruser-preview.vercel.app` alias remain untouched. A future callback change needs provider registration plus matching env and fresh Connect—not just an env rewrite.

Env configuration wins; partial/invalid bindings fail closed. Without an env client, `BLOB_READ_WRITE_TOKEN` enables private encrypted registration caching by exact issuer/callback: uncached reads, create without overwrite, then read the durable winner. First-use races may leave orphan registrations; no distributed lock. Callback never registers; corruption/read/write errors never silently rotate or fall back.

## OAuth/security caveats

- OpenWork requires verified app Bearer auth **before body parsing on every `/mcp` and `/api/mcp` request**, including initialize, listings, malformed/unfinished bodies and non-POST methods. Unauthorized: 401, `Bearer realm="OAuth"`, app protected-resource metadata, scope `home:read`. OAuth discovery stays public. Stateless transports emit no `Mcp-Session-Id`; session headers are not auth.
- Den DCR may request code + refresh grants; registration returns **authorization-code only**, `client_id` **≤512 characters**, no refresh token. Upstream scopes: `openid profile email`; downstream: `home:read`. Both legs require S256 PKCE and exact client/redirect/resource bindings.
- Five-minute encrypted JWE state retains verifier, nonce, client/method/callback and downstream request across instances. Upstream responses (64 KiB), state (8 KiB), callback URLs (16 KiB), cookies (8 KiB) and fetch timeouts (10s) are bounded; discovery stays on the configured origin/path without redirects. Verify ID-token signature/issuer/audience/nonce and userinfo subject equality. Identity/counters use full SHA256 of verified `[identity_issuer, sub]`, not app JWT issuer or organization. Org is optional nullable metadata; bounded present claims must agree. Den MCP tokens and baked-in names are not identity.
- Binding cookie: 43 ASCII bytes, HttpOnly, SameSite=Lax, Secure on HTTPS, Path=/, no Domain. Present invalid/duplicate/mismatched cookies reject. **Absent cookies lose browser-continuity/CSRF binding** despite valid state/nonce/PKCE. One cookie slot means overlapping sign-ins can conflict. No logged-in app session.
- Stage-labelled 400 “Sign-in expired, try again” pages use no-store/no-referrer/CSP and manual Connect, not retry. Logs allowlist stage/code, redact unknown descriptions and hash client/redirect bindings; infrastructure query logs also need redaction. Generic expiry text or `invalid_grant` alone proves neither expiry nor replay; historical missing-org rejection was separate.
- No durable replay registry: upstream rejects reused codes; host validates echoed state; app checks PKCE. Downstream codes retain a 60-second same-verifier replay window; cookie clearing is not replay protection. One-hour tokens have no refresh/revocation/logout propagation. Not production-ready OAuth or hosted acceptance.
- Local Host/Origin guards reject rebinding and foreign/opaque origins; no CORS. Self-contained UI resources enforce a 768 KiB budget and declare empty network CSP allowlists for host enforcement. Robots exclusion is not access control. Shared is public fixtures only; real data needs rate limits, lifecycle controls and per-request authorization.

## Checks and revert

`pnpm check` runs typecheck, Prettier lint, build, Node tests and Playwright. `pnpm preview` uses a test-only SDK bridge on port 4329 (must be free). Local OIDC/cache fixtures and failure-only traces are not real-member host proof. Consolidation source `3b335ed`: typecheck/lint/build, 78 Node and 13 browser tests passed locally. Betterleaks source/history: zero with the exact two invalid-credential-URI test fixtures allowlisted in `.betterleaks.toml`; built resources: zero unfiltered. Name/history audit found no customer references. Live verification scripts are active OAuth probes requiring separate authorization.

Keep shared production and its connector unchanged. Roll back only the separately authorized per-user deployment with its matching prior issuer/client/callback/key configuration, then reconnect; do not rotate keys casually. Deliberate anonymous mode is `IDENTITY_MODE=shared`, not `AUTH_REQUIRED=false`. See [ADD-TO-OPENWORK.md](ADD-TO-OPENWORK.md).
