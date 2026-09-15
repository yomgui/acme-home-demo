# Add Acme Home with per-user identity

## Current stable Preview — one-time test connection update

- **MCP URL:** `https://acme-home-demo-peruser-preview.vercel.app/mcp`
- **Issuer / `DEMO_AS_ISSUER`:** `https://acme-home-demo-peruser-preview.vercel.app`
- **Exact upstream callback / `UPSTREAM_CLIENT_REDIRECT_URI`:** `https://acme-home-demo-peruser-preview.vercel.app/oauth/upstream/callback`
- **Underlying live Preview receipt:** `https://acme-home-demo-ko19xur8p-prologe.vercel.app`; use the stable alias, not this generated hostname, for connection and issuer.

Vercel refused the old generated URL as an alias (`chosen alias ... is a deployment URL`). `https://acme-home-demo-loo267kwv-prologe.vercel.app/mcp` is now historical. **Update only the per-user Preview test connection's URL and issuer once**, then start fresh Connect (or recreate only that test connection if issuer cannot be changed). Old callback URLs and cached authorization bindings must not be reused. Original production and existing shared experiment connectors remain unchanged.

## Main's completed public-client provisioning

Main provisioned **one public Den DCR client per project**, saving exact values through Vercel subprocess stdin. The private client ID is not reproduced here.

| Runtime variable               | Current binding                                                             |
| ------------------------------ | --------------------------------------------------------------------------- |
| `UPSTREAM_CLIENT_ID`           | Main's single public registered client, saved privately                     |
| `UPSTREAM_CLIENT_ISSUER`       | `https://app.openworklabs.com/api/auth`                                     |
| `UPSTREAM_CLIENT_REDIRECT_URI` | `https://acme-home-demo-peruser-preview.vercel.app/oauth/upstream/callback` |
| `UPSTREAM_CLIENT_AUTH_METHOD`  | `none`                                                                      |
| `UPSTREAM_CLIENT_SECRET`       | **Not issued; not needed**                                                  |
| `DEMO_AS_ISSUER`               | `https://acme-home-demo-peruser-preview.vercel.app`                         |

Env values win over the encrypted private Blob fallback. Exact issuer and callback bindings apply to authorize and token exchange; normal fresh instances reuse the same client. Upstream scopes are `openid profile email`, downstream scope `home:read`. This docs/script cleanup does not provision clients, read credentials, set env values or deploy.

## Main-reported results — still no real-member acceptance

Main ran `scripts/verify-upstream-hosted.mjs` against both stable aliases; the same script is copied here. Public discovery returned **200**, anonymous access **401**, two authorize responses **302** with the same upstream client ID and exact callback. State was five-part JWE; nonce cookie **43 bytes, SameSite=Lax, Secure, Path=/, no Domain**. A **synthetic-invalid-code** callback returned **400** with the safe **Sign-in expired, try again** page. The result is **PARTIAL**, not a successful real-user flow.

Implementation checks: **64/64 Node**, **6/6 browser**. Older 49/5 and exit-2 public-only verifier receipts are historical. No Acme stage-log receipt beyond this probe is asserted. Arbitrary/unknown Den `error_description` phrases are redacted by the conservative whitelist; do not infer a root cause from redaction or from an intentional invalid-code rejection. The original user's valid-code failure remains unconfirmed.

**Main completed no real-member consent in the new probe. Guillaume must retry Connect with the updated test connection.** This finalization only copies/formats the script and updates docs; it does not run the probe again.

## Retry and acceptance

1. Use the updated per-member OAuth DCR Preview test connection with scope `home:read`; do not alter original shared connections or paste a Den MCP bearer token.
2. Complete login/consent directly in the browser within five minutes. This step has not been validated for a real member on the new alias; do not reuse the probe's synthetic-invalid-code callback.
3. Authenticated state contains the transaction. The optional cookie is binding-only, 43 ASCII bytes, Lax/Secure/HttpOnly/Path=/ without Domain. Old baseline `67b5a3bf` was already Lax, not Strict. Missing cookie is accepted with valid state and remaining nonce/PKCE/state checks; present malformed/mismatched cookie rejects. No logged-in app session is stored.
4. On a successful callback, invoke `acme_home {}`, save the App if needed, then Dashboard → Add. Verify real identity and independently refreshed synthetic sets with two real subjects/orgs.
5. A real-code failure still needs request-scoped safe stage/flags and SHA-256 client/redirect fingerprints. Generic error text and unknown-description redaction do not establish a diagnosis; no raw IDs, URLs, tokens or cookies should be logged.

Absent-cookie acceptance drops browser continuity binding, not other OAuth checks; it is not full CSRF/replay protection. Upstream rejects reused authorization codes, downstream hosts validate echoed state, and app redemption checks PKCE. No durable replay registry; downstream codes retain the inherited 60-second replay window with the same verifier. No automatic retry or production-ready claim.

## Original production revert and history

Keep `https://acme-home-demo.vercel.app/mcp` and its shared connector intact. Main's earlier preview-protection change had DIRECT Guillaume approval; prior memory-only key generation/preview env provisioning is historical. Current stable alias deployment/provisioning was performed by main, not this cleanup. Promote/merge is a separate decision.
