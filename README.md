# Acme Home

Employee-home MCP App with real OpenWork identity and synthetic work data. `acme_home {}` launches a layout; `acme_home {widget: "today" | "attention" | "goals"}` fetches exactly one independent panel. Standalone tools: `acme_today`, `acme_attention`, `acme_goals`. Resources: `ui://acme-home/{home,today,attention,goals}.html`.

## Current preview and verification — main-reported handoff

- Reachable real-mode preview: `https://acme-home-demo-loo267kwv-prologe.vercel.app`; MCP: `https://acme-home-demo-loo267kwv-prologe.vercel.app/mcp`.
- Main disabled Acme preview protection with **DIRECT Guillaume approval**. The earlier protected-preview blocker is historical, not the current reachability status.
- Main generated keys in memory and piped them into the Vercel **preview** environment, with no secret files. Each deployment trusts its own `VERCEL_URL` as app issuer; default real identity mode and the hosted upstream issuer are used.
- Original production remains untouched: `https://acme-home-demo.vercel.app/mcp` is the concrete shared-demo revert URL. Keep the existing production/shared experiment connector unchanged; use a new per-member OAuth connection for this preview. Promotion/merge is a separate decision.

| Check           | Reported result and scope                                                                                                                                                                 |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Node tests      | Previous implementation run: **49/49 passed**                                                                                                                                             |
| Browser suite   | Main's later run: **5/5 passed**; earlier missing-Chromium blocker is superseded                                                                                                          |
| Betterleaks     | **0 findings in source + bundles with the supplied configuration**; the full dependency-tree scan reported **22 third-party fixture findings**, not a whole-directory zero finding result |
| Hosted verifier | Public metadata, static UI and anonymous data **401** checks passed; **exit 2 / INCOMPLETE**, with no consent flows or resolved real names verified                                       |

Real hosted browser acceptance remains blocked by the absence of a session browser tab, not by preview protection or endpoint reachability. User manual sign-in has been requested. Login/consent, resolved names and two-member hosted isolation remain unverified. These are main's supplied results; this documentation cleanup does not rerun deployments or those tests.

## Per-user mode: OpenWork identity (default)

Defaults: `AUTH_REQUIRED=true`, `IDENTITY_MODE=openwork`. Identity comes from the upstream signed-in person, not a synthetic persona. `IDENTITY_MODE=demo` explicitly enables the older auto-approve fixture identity; `AUTH_REQUIRED=false` explicitly selects shared/no-auth fixtures. A failed real sign-in never falls back to either mode.

### Configuration contract

- Current app origin: `https://acme-home-demo-loo267kwv-prologe.vercel.app`; app resource/audience: `https://acme-home-demo-loo267kwv-prologe.vercel.app/mcp`. Main reports this real-mode preview reachable after the approved protection change. The earlier protected, pre-design-change deployment is historical. Keep `https://acme-home-demo.vercel.app/mcp` as the unchanged production revert path.
- Explicit `DEMO_AS_ISSUER` sets the app origin; otherwise trusted deployment `VERCEL_URL` supplies `https://${VERCEL_URL}`. Request Host, Origin and forwarded headers never select issuer/audience. An explicit canonical `http://127.0.0.1:<port>` app origin is supported for local tests; remote HTTP and localhost aliases are rejected.
- `DEMO_AS_PRIVATE_KEY`: existing Ed25519 PKCS8 PEM, used for app JWT signatures and HKDF-SHA256 transaction encryption-key derivation bound to app/upstream issuers. No new secret or durable store is required by the code.
- `UPSTREAM_ISSUER` defaults to `https://app.openworklabs.com/api/auth`. Discovery: `https://app.openworklabs.com/api/auth/.well-known/openid-configuration`. Explicit custom issuers must be canonical HTTPS or literal `http://127.0.0.1[:port]` for a local stub. All discovered endpoints must match the configured origin and remain inside its issuer path prefix. Redirects are rejected, fetch timeout is 10 seconds, and JSON responses are bounded to 64 KiB.

### Two OAuth legs

1. The host registers a downstream public client with the app `/register`, using auth method `none`, scope `home:read` and its callback. Compact signed client IDs remain at most 512 characters and expire after 30 days. DCR can request authorization-code plus refresh-token grants, but the response negotiates authorization-code only.
2. `/authorize` validates downstream client ID, exact registered redirect, app `/mcp` resource, S256 challenge and bounded state **before** upstream activity. It discovers the upstream IdP and registers a public client for `openid profile email`, with callback `<app origin>/oauth/upstream/callback`.
3. A fresh independent S256 verifier, state and nonce are created. A five-minute authenticated-encrypted A256GCM JWE transaction cookie stores the validated downstream request, upstream client ID, verifier/state/nonce. It stores **no upstream access or ID token**. HTTPS cookie: `__Host-openwork-transaction`, Secure, HttpOnly, SameSite=Lax, Path=/. Ciphertext is capped at 3,800 bytes; oversized flows fail closed. Explicit local HTTP tests use a separate non-Secure cookie name.
4. Callback can run on another app instance with the same key/issuers. It decrypts the cookie, validates state/expiry and optional callback issuer, rejects duplicate parameters, and exchanges the upstream code using the saved client and verifier. It verifies the ID token signature with origin-checked JWKS, exact upstream issuer, scalar audience equal to its upstream client ID, expiry and nonce. Userinfo is requested with the upstream access token; its `sub` must equal the verified ID-token subject.
5. `sub`, `name`, `email` and `org_id` are bounded nonempty strings. Organization must be signed in the ID token as `https://app.openworklabs.com/org_id`; any userinfo organization claim must agree. Verified ID-token name/email take precedence, with same-sub userinfo fallback. Real subjects are not restricted to UUIDs. No upstream tokens are sent downstream, retained in the cookie, or logged.
6. The app issues its own downstream code, retaining exact host client/redirect/resource/PKCE/state bindings, then its own access JWT with upstream `sub`, `name`, `email`, `org_id`, `identity_mode: openwork`, **app issuer and app `/mcp` audience**. Den MCP tokens and upstream ID/access tokens cannot authenticate to app `/mcp`. Demo tokens are rejected in real mode even if an app key is reused.

### Display and data isolation

The greeting is `Good <time>, <first name>!` using the real name, with no fingerprint suffix. Initials derive from the name; the neutral role is `OpenWork member`, not a fabricated job. Footer shows real signed-in name, first 12 subject characters, generation, ISO server time and provider instance. `DEMO_VIEWER_NAME` cannot override verified real identity. Anonymous/401 states show **Connect to personalize**, not another identity or stale spinner.

Work fixtures and three independent per-panel counters are keyed by collision-safe encoding of **organization + subject** (`org_id|sub` conceptually). Same subject/different org has distinct data and counters. Refresh rotates meeting topics, incidents, approvals and goals/progress only in the selected panel. These are synthetic work scenarios, not employee records fetched from upstream. Real identity uses `whoami.identityMode: openwork`, `synthetic: false`; work payloads still carry `demo: true`.

All `/mcp` and `/api/mcp` tool calls, including `acme_home {}`, require verified app tokens. Missing credentials produce HTTP 401 with a `resource_metadata` challenge. Invalid supplied tokens are always 401. Anonymous bootstrap only allows initialize/initialized notification, tool/resource listings and exact static UI resources; those contain no member data. The iframe calls through the host, never through browser-held OAuth tokens or direct API fetches. Three controllers and resource-bound tool calls remain independent; auth loss clears personal state while ordinary panel errors retain that panel's prior result.

DOM IDs: `viewer-identity`, `viewer-greeting`, `{today,attention,goals}-set`, `-identity`, `-generation`, `-generated-at`, `-instance`; row IDs: `meeting-item`, `attention-item`, `goal-item`.

### Operational/security limitations

- Discovery and upstream DCR are cached once **per handler instance**, sharing the pending promise across concurrent authorization starts. Cold starts may create additional upstream registrations/consent prompts. A callback uses its encrypted original client ID without re-registering. Cached failures do not silently retry or downgrade identity mode. Each cold instance may add an upstream client registry entry; this additional per-instance registration lifecycle is not production ready. Main owns upstream registration policy, quotas and cleanup.
- One outstanding transaction cookie per browser/app origin: finish one Connect at a time. Starting another replaces the old transaction. Cookies clear on callback success/failure; key or issuer changes invalidate in-flight flows. Upstream owns its code single-use enforcement.
- **Downstream codes are still short-lived, not single-use in both modes**: inherited stateless 60-second codes can be redeemed again with the same verifier. App tokens last one hour; no refresh, revocation registry or upstream logout propagation. This is a preview identity bridge, **not complete production OAuth 2.1 compliance**. Public DCR and no separate downstream-client consent controls require trusted preview hosts; production needs a durable replay/revocation design and security review.
- Counters are per org/subject/panel/instance and reset after cold starts. No database, Redis, durable business store or replay registry. Real identity does not make synthetic work content real.
- Code sanitizes OAuth errors and never logs upstream tokens, codes, client IDs or transaction cookies. Main must separately ensure infrastructure access logs do not record sensitive query strings.

## Explicit demo and shared modes

`IDENTITY_MODE=demo` retains the calendar reference's UUID subjects, synthetic names/roles/avatars and 12-hex subject fingerprint suffix. `DEMO_VIEWER_NAME` only overrides demo names. Reauthorization creates a fresh synthetic subject, not an employee identity. Demo OAuth discovery describes:

**demo authorization server: accepts every request; codes are short-lived, not single-use**

This auto-approves valid protocol requests; it does not authenticate real people. Codes are EdDSA-signed, expire after 60 seconds, and bind subject, client, redirect URI, resource and PKCE challenge. Replay with the same verifier within that lifetime is intentionally possible. Access tokens expire after one hour. No refresh tokens. DCR client IDs are signed metadata and expire after 30 days. This is **not production OAuth 2.1 authentication**; notably, OAuth's single-use-code requirement is deliberately not implemented. Protocol validation still rejects malformed requests, wrong audiences/issuers/signatures, wrong PKCE verifiers and unregistered redirects.

`AUTH_REQUIRED=false pnpm serve` runs original shared local fixtures (loopback port 4328). `AUTH_REQUIRED=false pnpm serve:stdio` is also local shared-fixture transport, not the real HTTP identity boundary. Neither is a workaround for failed real sign-in.

## Verification and handoff

Use the already-installed Node 24.20.0 / pnpm 11.4.0:

```sh
pnpm typecheck
pnpm lint
pnpm build
pnpm test
```

`tests/oidc.test.ts` runs local stub discovery, DCR, authorize, token, JWKS and userinfo with ephemeral in-memory keys. It tests claim mapping, invalid signature/issuer/audience/nonce/state/PKCE, userinfo mismatches, cross-instance/expired/tampered cookies, SSRF controls, size bounds, real names and all three org-isolated sets. The earlier OAuth tests explicitly select `identityMode: demo` and retain the calendar contract. SDK registration validation uses installed SDK 2.0, not an added dependency. No authenticated live provider calls are made.

```sh
pnpm exec tsx scripts/verify-hosted.ts 'https://acme-home-demo-loo267kwv-prologe.vercel.app'
```

The curl verifier passes sensitive configuration through stdin only. In real mode it verifies public metadata/static UI and anonymous data rejection, then reports **INCOMPLETE / exit 2** without DCR/sign-in; browser-based real login and two-member host proof belong to main. Only explicit demo mode runs its two full synthetic flows. Errors suppress raw responses and stack traces. The earlier missing-Chromium blocker was superseded by main's green 5/5 browser run. Both previews passed the hosted verifier's public checks and exited 2 / INCOMPLETE; no hosted consent flows or real names have been verified. Manual user sign-in is requested because no session browser tab was available.

See [Per-user (OAuth) mode](ADD-TO-OPENWORK.md). Production remains untouched at `https://acme-home-demo.vercel.app/mcp`; preview deployment/environment work is complete as reported above. Hosted user sign-in and acceptance remain separate, incomplete steps.
