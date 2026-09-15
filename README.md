# Acme Home

Real OpenWork identity with synthetic work data. `acme_home {}` launches the layout; `{widget: "today" | "attention" | "goals"}` fetches one independent panel through the same resource-bound tool. Standalone tools: `acme_today`, `acme_attention`, `acme_goals`. Resources: `ui://acme-home/{home,today,attention,goals}.html`. No customer writes.

## Current stable Preview — main-reported handoff

- Connection URL: **`https://acme-home-demo-peruser-preview.vercel.app/mcp`**.
- App issuer (`DEMO_AS_ISSUER`): **`https://acme-home-demo-peruser-preview.vercel.app`**.
- Exact upstream callback (`UPSTREAM_CLIENT_REDIRECT_URI`): **`https://acme-home-demo-peruser-preview.vercel.app/oauth/upstream/callback`**.
- Underlying live **Preview** deployment: `https://acme-home-demo-ko19xur8p-prologe.vercel.app` (receipt only; use the stable alias for connection and issuer).
- Main provisioned **one public Den DCR client per project**, saving its client ID and exact bindings through Vercel subprocess stdin. `UPSTREAM_CLIENT_ISSUER=https://app.openworklabs.com/api/auth`; registered auth method is `none` (`UPSTREAM_CLIENT_AUTH_METHOD=none`). **No client secret was issued**; client ID values are omitted from these docs.
- Explicit `DEMO_AS_ISSUER` pins the stable alias. Vercel refused the old generated deployment URL as an alias (`chosen alias ... is a deployment URL`). The **per-user Preview test connection needs a one-time URL + issuer update and fresh Connect**. Original production and existing shared experiment connectors stay unchanged.

### Verification receipts and remaining user action

| Check                             | Result and scope                                                                                                                                                                                              |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Local Node suite                  | **64/64 passed**, previous implementation verification                                                                                                                                                        |
| Local browser suite               | **6/6 passed**, previous implementation verification                                                                                                                                                          |
| Main's stable-alias live probe    | Public discovery **200**, anonymous **401**, two authorize **302** responses with the same upstream client ID and exact stable callback; JWE state and **43-byte nonce cookie, Lax/Secure/Path=/, no Domain** |
| Intentional invalid-code callback | **400** with the clean **Sign-in expired, try again** page; synthetic-invalid-code negative test only                                                                                                         |

Main ran `scripts/verify-upstream-hosted.mjs` against both stable aliases. It reports **PARTIAL**. Main completed **no real-member consent** in these probes; **Guillaume must retry Connect** on the updated Preview test connection. These results are not a successful real-user callback or an RCA for the original valid-code failure. Unknown Den descriptions are redacted by the conservative whitelist, not interpreted as evidence of a particular cause; no Acme stage-log receipt beyond the probe is asserted here.

```sh
node scripts/verify-upstream-hosted.mjs https://acme-home-demo-peruser-preview.vercel.app
```

This active negative probe performs downstream DCR, follows no real login/consent, checks authorize redirects and submits an intentionally invalid code without a cookie. Sensitive OAuth URLs, IDs, codes and cookies are kept out of output. Main already ran it; this docs/script-only cleanup copies/formats it without executing it.

## Audited primary callback failure — optional organization fix

The audit identified **`missing-org-claim` after valid ID-token verification and subject-matched userinfo** as the primary failure. Requiring organization was incorrect: this local fix defines identity as verified upstream **issuer + subject** and makes org metadata optional. It resolves that required-org gate in code; main must still deploy/retest hosted acceptance. The original implementation already retained its verifier and client ID; this is not a verifier-loss or Strict-cookie diagnosis.

The later **19:59:58Z** `invalid_grant` with `cookiePresent=false` is likely consumed-code replay, but **same-code reuse is not proven**. It is distinct from the primary missing-org failure. The safe expired-code page remains unchanged. No additional scopes/resources, alias, stable env or deployment changes are included.

Verified baseline source `67b5a3bf` already emitted **SameSite=Lax**, Secure for HTTPS, Path=/ and no Domain. This matches the user's report of the old deployment; it was **not Strict**. That baseline check was source-only; main's newer negative live probe separately verified the current nonce-cookie attributes above without real-member consent.

## Configuration

Defaults remain `AUTH_REQUIRED=true`, `IDENTITY_MODE=openwork`, `UPSTREAM_ISSUER=https://app.openworklabs.com/api/auth`. Discovery appends `/.well-known/openid-configuration`. App issuer is explicit `DEMO_AS_ISSUER` or trusted `https://${VERCEL_URL}`; it determines the exact callback and app `/mcp` audience. Request Host/Origin/forwarded headers never establish trust. Existing Ed25519 PKCS8 `DEMO_AS_PRIVATE_KEY` signs downstream JWTs and derives separate state/cache AES-GCM keys through HKDF; runtime never generates a replacement key.

### Real-mode MCP authentication and stateless transport

With `AUTH_REQUIRED=true` and `IDENTITY_MODE=openwork`, **all `/mcp` and `/api/mcp` requests require verified app Bearer authorization before body reading/parsing**, including initialization, tool/resource listings, static UI reads, malformed/unfinished bodies and GET/HEAD/PUT/PATCH/DELETE/OPTIONS. The local HTTP ingress checks before the SDK Express JSON parser. Missing or invalid credentials return 401 and a JSON error; HEAD correctly omits a response body.

```text
WWW-Authenticate: Bearer realm="OAuth", resource_metadata="https://acme-home-demo-peruser-preview.vercel.app/.well-known/oauth-protected-resource", error="invalid_token", scope="home:read"
```

OAuth discovery/protected-resource metadata/JWKS remain public. **Real-mode MCP metadata/static resources are not anonymous bootstrap endpoints**: Connect first. Valid app tokens permit initialize/list/read across separate requests. Explicit demo mode retains anonymous MCP metadata bootstrap, and `AUTH_REQUIRED=false` shared behavior is unchanged.

**No `Mcp-Session-Id`:** the installed SDK's stateless mode (`sessionIdGenerator: undefined`) emits no session ID and performs no session validation. A fresh transport handles each request. A fake header or per-instance map cannot provide meaningful serverless cross-request sessions; Bearer auth remains the authority.

The real-mode `scripts/verify-hosted.ts` now requires 401 for anonymous MCP metadata, malformed bodies and non-POST requests, while checking public OAuth discovery 200. INCOMPLETE means authenticated sign-in/host proof is still unperformed. `scripts/verify-upstream-hosted.mjs` is unchanged and compatible. Prior anonymous-bootstrap receipts are historical; this local auth change does not alter aliases/issuer/stable env or perform deployment.

### Stable upstream client: env first

| Variable                       | Contract                                                                                                    |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| `UPSTREAM_CLIENT_ID`           | Registered client; takes precedence over Blob and DCR                                                       |
| `UPSTREAM_CLIENT_ISSUER`       | Required with env client, exactly matching `UPSTREAM_ISSUER`                                                |
| `UPSTREAM_CLIENT_REDIRECT_URI` | Required with env client, exactly `<app issuer>/oauth/upstream/callback`                                    |
| `UPSTREAM_CLIENT_AUTH_METHOD`  | Defaults to `none`; explicit `client_secret_post` or `client_secret_basic` must match the registered method |
| `UPSTREAM_CLIENT_SECRET`       | Absent for `none`, required for either secret method; never used to guess auth method                       |
| `BLOB_READ_WRITE_TOKEN`        | Needed only if no env client is configured and private registration storage is used                         |

Invalid/partial env configuration fails closed and does not fall through to Blob. Absent env client plus absent Blob configuration fails authorization before discovery/DCR, while public OAuth discovery stays accessible; real-mode MCP metadata/static UI remains Bearer-protected. Public clients use no secret; post puts the secret in the form only; Basic uses form-encoded credentials in the authorization header. Main completed the public-client provisioning and exact stable bindings reported above. No provisioning script was added; the copied negative verifier does not set env values or register new upstream clients.

### Private encrypted cache

`server/upstream-client.ts` follows the read-only/private Blob access pattern studied in World Clocks, not its overwrite or memory fallback semantics. SDK `get` uses `access: private`, `useCache: false`. The path `oauth/registrations/v1/<sha256(exact issuer, exact callback)>.jwe` is deterministic. The registration is AES-GCM encrypted, then checked against exact issuer/callback on read. No public object or plaintext credential file.

Only a genuine miss at authorization start can perform public DCR for `openid profile email`. Persist with `allowOverwrite: false` and `addRandomSuffix: false`, then read back the durable winner before use. Initial concurrent misses may create unused upstream registrations, but every caller uses the persisted winner, never its losing/unpersisted candidate. There is no distributed DCR lock; main owns orphan review. Ordinary fresh instances read the same client, **not per-instance DCR**. Callback never registers. Corrupt cache, read/write failure or key mismatch fails closed without overwrite, fallback or automatic registration retry. Issuer/callback/key changes require deliberate operator handling.

## Encrypted state and browser binding

1. Validate host DCR client, exact downstream redirect/resource and S256 challenge first. Downstream scope is `home:read`, compact client IDs remain at most 512 characters.
2. Carry verifier, OIDC nonce, original downstream return request, selected upstream client ID/auth method/exact callback and a browser-binding hash inside URL **state JWE**, using A256GCM authenticated encryption. It has five-minute expiry, app issuer, callback audience and an issuer-bound key context; any matching app instance can decrypt it. AEAD supplies integrity without a second signature layer.
3. The binding-only cookie value is exactly **43 ASCII bytes**, encoding 32 random bytes. HTTPS uses `__Host-openwork-binding` with **SameSite=Lax; Secure; HttpOnly; Path=/**, Max-Age 300 and **no Domain**. No transaction, credentials or return request is stored in it. Local explicit HTTP uses `openwork-local-binding` without Secure. A present cookie must match authenticated state; malformed, duplicate or mismatched named cookies fail rather than being treated as absent.
4. Clear the cookie on success/failure, but accept its absence when authenticated, unexpired app-bound JWE state and upstream nonce/PKCE plus downstream PKCE/state checks pass. The bridge stores no logged-in app session. Duplicate parameters, wrong issuer, invalid state or saved/current client, method or exact callback mismatch still reject. Authorize/token redirect URI bytes must be identical; the consuming downstream host must validate the echoed state.
5. Exchange once without automatic retry; verify upstream ID-token issuer, client audience, signature/JWKS and nonce, then require userinfo sub equality. Store verified upstream `iss` explicitly as **`identity_issuer`**, never confuse it with app downstream JWT `iss`. Name/email retain subject-matched userinfo fallback. **`org_id` is optional metadata, null when absent**. Present non-null custom `https://app.openworklabs.com/org_id` and standard `org_id` values from both sources must be bounded and agree; conflicting present claims reject, absence alone does not.
6. Downstream app issuer, `/mcp` audience and signature invariants stay unchanged. Real `verifyAccessToken` validates bounded `identity_issuer` against the exact configured upstream issuer, rejecting spoofing and Den MCP access tokens. Provider/counter key is full **SHA256(JSON.stringify([identity_issuer, sub]))**, a collision-safe tuple rather than delimiter concatenation. Same issuer/sub keeps data/counters across optional-org changes; distinct issuers with the same sub remain distinct. Footer is real name/subshort with no org display. Older tokens missing `identity_issuer` need fresh Connect after deployment. Anonymous 401 behavior is unchanged.

Bounds: 64 KiB upstream JSON; 16 KiB encrypted registration; 8 KiB state; 16 KiB callback URL; 8 KiB total Cookie header; five-minute state/binding; ten-second fetch/Blob timeouts. Discovery endpoints must stay on exact configured origin and issuer path prefix, without redirects. Only explicit literal `http://127.0.0.1[:port]` is permitted for local test issuers; remote HTTP is rejected.

## Diagnostics, clean errors and replay limits

Callback failures return HTTP 400 HTML: **“Sign-in expired, try again”**, instructing manual Connect, with no transaction values, scripts, forms or automatic retry. No-store/no-referrer/CSP headers protect the response. The generic heading does not diagnose the hosted cause as expiry.

Failure logs include allowlisted stage/error code, exact known safe Den `error_description` or `redacted`, bounded HTTP status and the callback-local fields below. No raw exceptions/stacks, URLs, code/token/cookie/client ID/email/org values or multiline descriptions are logged. Main must separately redact infrastructure query logs.

| Callback diagnostic  | Meaning                                                                                                                                  |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `cookiePresent`      | Whether the named binding cookie was in this request                                                                                     |
| `stateMatch`         | False until JWE authentication/decryption, expiry and app/transaction binding validation succeed, then true regardless of cookie absence |
| `cookieMatch`        | Optional, omitted when absent or comparison not reached; true only after match, false for present invalid/mismatched cookie              |
| `clientIdUsed`       | SHA-256 hex fingerprint only of selected client ID, omitted until selection                                                              |
| `redirectUriUsed`    | SHA-256 hex fingerprint only of selected callback URI, omitted until selection                                                           |
| `redirectUriMatches` | True after exact selected/saved/app callback equality; false until checked or on mismatch, interpreted with stage                        |

Each callback gets its own explicit context; logs are sanitized snapshots, not shared per-instance mutable request data. Stages still distinguish token exchange, ID-token verification, nonce, userinfo, conflicting/invalid org and profile failures. Historical `missing-org-claim` no longer rejects absent metadata. Successful code issuance emits safe `callback-complete` by default; set source option `upstreamOptions.logCallbackSuccess=false` to suppress that summary. It does not prove downstream redemption, host acceptance or any logged-in app session.

**Absent-cookie tradeoff:** without the cookie, the bridge intentionally skips browser continuity/CSRF binding; a valid transaction can be transferred between browsers. Authenticated state and the upstream nonce/PKCE plus downstream PKCE/state bindings remain required, but do not substitute for that skipped continuity check. No logged-in app session is stored; this is not a claim of complete CSRF protection.

Captured state can be resubmitted even without its original cookie. Upstream enforces authorization-code replay rejection; the downstream host validates echoed state and the app enforces downstream PKCE. There is no durable transaction replay registry. Downstream codes retain the inherited 60-second replay window with the same verifier. Cookie clearing is cleanup, not replay prevention. App tokens last one hour with no refresh/revocation/logout propagation; this is not fully replay-proof, production-ready OAuth 2.1 or hosted proof.

## Local verification and demo fallback

Use main's already-installed Node 24.20.0, pnpm 11.4.0 and dependencies:

```sh
pnpm typecheck
pnpm lint
pnpm build
pnpm test
pnpm test:ui
```

Tests use local OIDC stubs, in-memory keys and injected fake cache/Blob SDK seams. Coverage includes cross-instance absent-cookie success, present-cookie mismatch rejection, exact attributes/43-byte cookie size, overlapping callback diagnostic isolation, hash-only/redacted fields, stable/racing cache selection, both PKCE legs, claims and reuse. No live Blob or authenticated provider calls. The older 49 Node / 5 browser passes and scoped source+bundle Betterleaks zero (22 third-party fixtures in the wider scan) are historical. Current local totals are 64/64 Node and 6/6 browser checks; main's new live probe is negative-only and does not establish real-member consent/callback success. This docs/script cleanup reruns neither those suites nor scans.

Explicit `IDENTITY_MODE=demo` retains the prior synthetic-UUID auto-approve flow: **demo authorization server: accepts every request; codes are short-lived, not single-use**. `AUTH_REQUIRED=false pnpm serve` runs shared fixtures on loopback port 4328; `AUTH_REQUIRED=false pnpm serve:stdio` is shared stdio. Neither is an automatic fallback for real auth errors. Work data remains synthetic in every mode.

## Preview history and revert

Historical, no longer the connection URL: `https://acme-home-demo-loo267kwv-prologe.vercel.app/mcp`. Main disabled preview protection with DIRECT Guillaume approval and generated keys in memory, piping them into preview environment without secret files. Earlier public metadata/static UI/anonymous 401 checks exited 2 / INCOMPLETE; the original user's later valid-code callback failed. Vercel refused aliasing the generated deployment URL. The current stable alias and underlying Preview are listed at the top; main's new verifier returned PARTIAL after an intentional invalid-code test, not a successful real-member flow.

Original production remains untouched: `https://acme-home-demo.vercel.app/mcp`. Do not repoint its shared experiment connector. Main has completed stable alias/public registration/env/deployment work. Guillaume must retry the updated Preview test connection for real-member acceptance; promote/merge remains a separate decision. See [ADD-TO-OPENWORK.md](ADD-TO-OPENWORK.md).
