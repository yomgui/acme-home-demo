# Add Acme Home

## Shared production

1. Add `https://acme-home-demo.vercel.app/mcp` as a remote Streamable HTTP MCP, **auth: none**. Default `IDENTITY_MODE=shared` needs no key or sign-in.
2. Invoke `acme_home {}`; the host renders `ui://acme-home/home.html`, not a standalone HTML import.
3. In Dashboard → Add app, add **Acme Home** (Run automatically). The other three cards—**Today at a Glance**, **Needs Your Attention**, **My Goals**—are optional standalone widgets; do not add them for the combined demo. Panels refresh independently; the greeting has no employee name.
4. Workspace-local MCPs may not appear in a shared dashboard picker; use a Cloud connection for sharing. Grant only intended people access, not org-wide by default.

## Per-user — planned, not deployed here

Target: `https://acme-home-demo-peruser.vercel.app/mcp`, explicit `IDENTITY_MODE=openwork`. Leave shared production unchanged.

**Prerequisite:** the pinned upstream client is registered for the OLD callback `https://acme-home-demo-peruser-preview.vercel.app/oauth/upstream/callback`. Obtain authorization to update or replace that provider registration for `https://acme-home-demo-peruser.vercel.app/oauth/upstream/callback`. **An env rewrite alone cannot change the registered callback.** Then align app issuer, stable signing key and exact upstream client/issuer/callback/auth-method env bindings. Hosting/protection changes also require authorization; see [README.md](README.md).

After authorized deployment:

1. Add a separate OAuth DCR connection, scope `home:read`. Den may request code + refresh grants; the app returns code-only, `client_id` ≤512, no refresh token.
2. Anonymous **initialize returns 401 before body parsing**, like every other MCP request; OAuth discovery stays public. Complete fresh Connect/login/consent before listing/calling tools. Never paste a Den MCP token. `AUTH_REQUIRED=false` cannot bypass this mode.
3. Invoke `acme_home {}`; verify real name/short subject and independent synthetic panels with two real members. Identity is verified issuer + subject; organization may be absent. Then Save/Add.
4. A stage-labelled “Sign-in expired, try again” page requires a fresh manual Connect, not callback replay. Diagnose safe stage/flags and hashed bindings, never raw protocol material. Negative probes are not real-member acceptance.

Encrypted five-minute state preserves PKCE. Absent cookies lose browser-continuity/CSRF binding; present invalid cookies reject. Upstream rejects reused codes; downstream host validates state. Downstream codes retain a 60-second same-verifier replay window; no durable replay registry or refresh/logout propagation. This remains a demo.

## Checks and revert

Operator: `pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm test`, `pnpm test:ui` (or `pnpm check`), with prepared Node 24/pnpm dependencies. Rebuild tracked hosted adapters before shipping. Both `scripts/verify-hosted.ts` and `scripts/verify-upstream-hosted.mjs` are active OAuth probes requiring separate authorization.

Keep the shared production connector unchanged. Roll back only the separately authorized per-user deployment and its matching prior issuer/client/callback/key configuration; reconnect afterward. Intentional anonymous mode uses `IDENTITY_MODE=shared`. Hosted protocol checks do not establish real-member acceptance; complete fresh Connect after switching aliases.
