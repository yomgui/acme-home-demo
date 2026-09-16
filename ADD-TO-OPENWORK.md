# Add Acme Home

## Shared production

1. Add `https://acme-home-demo.vercel.app/mcp` as a remote Streamable HTTP MCP, **auth: none**. Default `IDENTITY_MODE=shared` needs no key or sign-in.
2. Invoke `acme_home {}`; the host renders `ui://acme-home/home.html`, not a standalone HTML import.
3. In Dashboard → Add app, add **Acme Home** (Run automatically). The other three cards—**Today at a Glance**, **Needs Your Attention**, **My Goals**—are optional standalone widgets; do not add them for the combined demo. Panels refresh independently; the greeting has no employee name.
4. Workspace-local MCPs may not appear in a shared dashboard picker; use a Cloud connection for sharing. Grant only intended people access, not org-wide by default.

## Per-user production

Target: `https://acme-home-demo-peruser.vercel.app/mcp`, explicit `IDENTITY_MODE=openwork`. Leave shared production unchanged.

Connection values: **OAuth DCR**, **Individual accounts / per_member**, scope **`home:read`**, issuer **`https://acme-home-demo-peruser.vercel.app`**. Authorization server metadata: `https://acme-home-demo-peruser.vercel.app/.well-known/oauth-authorization-server`. The separately pinned upstream public client uses **`https://acme-home-demo-peruser.vercel.app/oauth/upstream/callback`**, auth method `none`, scopes `openid profile email`. No client secret to enter. Never reuse an old callback or client registration.

The new project uses its own sensitive Ed25519 signing key; existing Preview registration/env/key remain unchanged. Fresh Connect:

1. Add a separate OAuth DCR connection, scope `home:read`. Den may request code + refresh grants; the app returns code-only, `client_id` ≤512, no refresh token.
2. Anonymous **initialize returns 401 before body parsing**, like every other MCP request; OAuth discovery stays public. Complete fresh Connect/login/consent before listing/calling tools. Never paste a Den MCP token. `AUTH_REQUIRED=false` cannot bypass this mode.
3. Invoke `acme_home {}`; verify real name/short subject and independent synthetic panels with two real members. Identity is verified issuer + subject; organization may be absent. Then Save/Add.
4. A stage-labelled “Sign-in expired, try again” page requires a fresh manual Connect, not callback replay. Diagnose safe stage/flags and hashed bindings, never raw protocol material. Negative probes are not real-member acceptance.

Encrypted five-minute state preserves PKCE. Absent cookies lose browser-continuity/CSRF binding; present invalid cookies reject. Upstream rejects reused codes; downstream host validates state. Downstream codes retain a 60-second same-verifier replay window; no durable replay registry or refresh/logout propagation. This remains a demo.

## Companion cards for an Acme dashboard

These are separate MCP connections, not servers bundled in this repository. Card names below reflect the demo registration sources at the September 2026 handoff, not a fresh hosted-picker verification.

Add each card with `{}` and **Run automatically / Auto-run**:

- **Acme Home** (`acme_home`): `https://acme-home-demo.vercel.app/mcp`, auth none (shared).
- **World Clocks** (`show_world_clocks`): `https://world-clocks-demo.vercel.app/mcp`, auth none (shared).
- **Personal Calendar (demo)** (`show_calendar`): `https://personal-calendar-demo-mcp-app.vercel.app/mcp`, OAuth, Individual accounts / per_member, scope `calendar:read`.

Use the shared Home endpoint for this shared dashboard; do not silently substitute the per-user endpoint. Home's exact titles are defined in [shared/contract.ts](shared/contract.ts) and registered via [server/server.ts](server/server.ts) and [server/register.ts](server/register.ts).

The World Clocks picker has been observed to expose four UI-bound entries: **World Clocks**, **Resolve locations** (`resolve_locations`), **Get my preferences** (`get_preferences`), and **Save my preferences** (`save_preferences`). **Choose only World Clocks. Never add Save my preferences as an auto-run tile: it is a write and would run on refresh.** The other three are internal helpers called by the tile, not dashboard entries. Keep their `ui://world-clocks/mcp-app.html` binding: the released host needs it for app calls. The observed picker leak of `visibility: ["app"]` helpers is not fixed by this guide. Leave launch arguments `{}`; explicit `cities` override saved preferences.

Personal Calendar uses `ui://personal-calendar/mcp-app.html`, issuer `https://personal-calendar-demo-mcp-app.vercel.app`, and public-client DCR (`token_endpoint_auth_method: none`). **Who am I (synthetic demo)** (`whoami`) has no UI binding and is not an App card. Its demo authorization server auto-approves synthetic identities; it is not real hosted-member identity proof or production-grade OAuth. Each viewer still needs their own Calendar Connect flow; registration alone is not consent. Do not copy another viewer's tokens or calendar payload into launch arguments.

On the dashboard host, use **Manage → Dashboards → New dashboard**, then **Add app → MCP** and the exact cards above. Grant only the two intended named viewers; leave **Everyone in the organization** off. Both members should see the same dashboard and App references on their own desktops. For Calendar, each independently uses **Your Connections → Personal Calendar → Connect**, then reopens the dashboard. A connected status alone does not prove either calendar rendered or that their meeting sets differ.

## Two-member per-user handoff

This checklist is a manual acceptance guide, not an automated test runner. It uses the per-user connection settings above and the app in this repository; no OpenWork source checkout, old local ports, or private world manifest is needed to follow it. Local build/security caveats are in [README.md](README.md).

1. Use two owner-controlled desktop sessions and separate browser profiles. Privately record the actual desktop versions/source provenance and hosted sign-ins. The upstream is `https://app.openworklabs.com/api/auth`; local seeded accounts or cookies do not establish hosted identity or consent, and the hosted provider cannot reach an operator's `127.0.0.1`.
2. Keep the dashboard host organization distinct from upstream identity metadata. Both desktops must belong to the dashboard host organization. Real names come from verified hosted members; all three business-content sets remain synthetic, derived from verified upstream **issuer + subject**. Organization is optional metadata, never part of the identity key. Labels A/B are observation aliases, not provider identities.
3. Use a separate **Acme Home (per-user)** connection and a new dashboard with only **Acme Home** (`acme_home`, `ui://acme-home/home.html`), arguments `{}`, and named grants for those two host members. Leave existing shared Home and Calendar connections unchanged. Do not put names, subjects, tokens, or copied payloads in launch arguments.
4. Before Connect, observe each member separately. If an anonymous shell actually mounts, it should show **Connect to personalize**, no personal name, and no widget items. A host `409 connection_not_ready` is a separate earlier gate, not provider `401` or proof a shell rendered; never infer a status from a missing iframe. If catalog access is gated before consent, record the blocker, not an API-authored tile or borrowed grant. Do not revoke grants to manufacture a before-state; disclose an already-connected account.
5. Each member independently completes fresh hosted **Connect/login/consent**, then returns to the same tile. If either flow is blocked, stop and record Incomplete. No copied grants, callback replay, or synthetic-mode substitution. Verify each rendered full name and short subject against private hosted observations; the two identities must differ.
6. Compare Today, Attention, and Goals: each should contain nonempty visible item-title sets, with all three sets different between the two members. Confirm the same dashboard and tile entry on both desktops. Keep one Home tile per desktop and polling off during comparison.
7. Refresh one member's Home tile once using the host's tile Refresh control. Check all three generations increase on the same provider instances, identity stays stable, and at least one visible content element changes, while the other desktop stays unchanged; repeat independently for the second member. Instance resets are not proof of durable monotonic counters. Record missing controls or contract mismatches rather than repeatedly refreshing until a favorable result appears.
8. Keep a private, credential-free receipt of actual host/dashboard/tile IDs, member observations, consent outcomes, versions, times, and per-step results. Publish only anonymous summaries. Missing identity, consent, rendering, isolation, or refresh evidence remains Incomplete. An automated runner must separately assert these claims and retain its exact command, exit code and counts; this repository does not ship `pnpm evals:e2e per-user-home-demo` or the OpenWork film assembler.

### Evidence boundary

Historical operator-reported protocol checks for source `3b335ed` found shared initialize/call **200**; per-user unauthenticated initialize **401**; discovery/protected-resource metadata and public Ed25519 JWKS **200**; public-client DCR **201** with client ID ≤512; and authorize **302** to hosted Den with the stable callback, JWE state and S256 PKCE. These were not rerun for this documentation update. They establish neither fresh real-member Connect nor consent, desktop rendering, two-member isolation, or a completed film. Fresh real-member Connect against the stable per-user alias was still unperformed at the source handoff; full desktop/film validation remains unproven here.

The original shared film used source `aa0f1b7`; neither it nor older synthetic Calendar footage is recertified by newer docs or protocol statuses. Preserve historical red runs and media. Any new capture needs authorized current sessions, completed observations and reviewed/redacted media; never capture authentication screens or expose real names, emails, organization IDs, subjects, OAuth material or private receipts. Label incomplete footage **PARTIAL**. Films illustrate test assertions, not decide pass/fail, and no new capture or assembly is supplied by this guide.

## Checks and revert

Operator: `pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm test`, `pnpm test:ui` (or `pnpm check`), with prepared Node 24/pnpm dependencies. Rebuild tracked hosted adapters before shipping. Both `scripts/verify-hosted.ts` and `scripts/verify-upstream-hosted.mjs` are active OAuth probes requiring separate authorization.

Keep the shared production connector unchanged. Roll back only the separately authorized per-user deployment and its matching prior issuer/client/callback/key configuration; reconnect afterward. Intentional anonymous mode uses `IDENTITY_MODE=shared`. Hosted protocol checks do not establish real-member acceptance; complete fresh Connect after switching aliases.
