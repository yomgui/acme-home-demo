# Add Acme Home to OpenWork

## Per-user (OAuth) mode — real identity

Defaults: `AUTH_REQUIRED=true`, `IDENTITY_MODE=openwork`. Use a **NEW OAuth per-member DCR connection**, never the earlier shared `exp-…` experiment connector. Production stays unchanged as the revert path.

1. Use main's reachable real-mode Preview MCP: `https://acme-home-demo-loo267kwv-prologe.vercel.app/mcp`. Acme preview protection was disabled with **DIRECT Guillaume approval**. The earlier protection blocker is historical; do not change the original production/shared connector.
2. Add a new MCP connection with **OAuth**, **per-member ownership**, DCR and downstream scope **`home:read`**. The app's discovery supplies its endpoints/JWKS. Do not provide a preseeded client secret or reuse a Den MCP bearer token; the app accepts only its own signed app-audience token.
3. Choose **Connect** for each member. The app validates downstream client/redirect/resource/PKCE, then redirects to upstream OpenWork identity using **`openid profile email`**. Complete actual provider login/consent in the browser. This is not synthetic auto-approval; do not paste credentials, cookies or codes into chat.
4. Callback: `https://acme-home-demo-loo267kwv-prologe.vercel.app/oauth/upstream/callback`. A five-minute encrypted HttpOnly transaction cookie binds the browser and preserves upstream client/verifier/state/nonce plus downstream request across app instances. Finish one Connect at a time; another authorization start replaces the outstanding cookie.
5. Invoke `acme_home {}` through this new connection, save the rendered App if needed, then **Dashboard → Add**. Greeting should use the real first name, footer the real name/shortened subject, without synthetic suffixes. Meetings, incidents, approvals and goals remain synthetic work examples.
6. Refresh each panel separately; verify only that panel's content/generation changes. Main's proof must use two real signed-in subjects and verify organization isolation. Real people may share names, so compare subject/org identity and sets rather than requiring manufactured name uniqueness. Provider instance IDs explain counter resets.
7. **Connect to personalize** requires valid app OAuth credentials. Reconnect after the one-hour access token expires (no refresh tokens); upstream identity remains real and stable, not a new random persona. Return policy, quota, protection or configuration failures to main. Never quietly downgrade to demo/shared mode.

### Current deployment and proof status — supplied by main

- The current real-mode preview is reachable after the protection change made with **DIRECT Guillaume approval**; original production remains untouched. Promotion/merge is a separate decision.
- Keys were generated in memory and piped into the Vercel preview environment, with no secret files. Each deployment uses trusted `VERCEL_URL`, default real identity mode and the hosted upstream issuer.
- Main reports browser tests **5/5 passed**; previous Node run **49/49 passed**. Betterleaks reported **0 in source + bundles with the supplied configuration**; the full dependency-tree scan had **22 third-party fixture findings**, not whole-directory zero.
- Hosted verifier public metadata/static UI/anonymous 401 checks passed and exited **2 / INCOMPLETE**. No hosted consent flow or resolved real name is verified. There was no session browser tab for real hosted access; **user manual sign-in has been requested**. This is distinct from the earlier, now-resolved preview protection issue.

### Trust and limits

Default upstream issuer: `https://app.openworklabs.com/api/auth`; discovery: its `/.well-known/openid-configuration`. ID-token signature/JWKS, issuer, app's upstream client audience and nonce are verified before accepting userinfo, whose sub must match. Organization must be signed as `https://app.openworklabs.com/org_id` and maps to app JWT `org_id`. App `/mcp` rejects Den MCP and upstream ID/access tokens. Real subject strings are bounded but not UUID-only.

Upstream DCR is once per handler instance; cold starts may add registrations and consent prompts, and main owns policy/quota/cleanup. Each cold instance can add an upstream registry entry; this per-instance registration lifecycle is not production ready. Callback uses its encrypted original client ID, not a replacement registration. Downstream codes still permit replay for 60 seconds with the same verifier; there is no durable replay/revocation/logout registry or refresh token. This is a preview identity bridge, not complete production OAuth 2.1 compliance. Public downstream registration/consent and infrastructure log redaction need production review. Generation resets per instance. README documents bounds and test scope.

## Explicit demo fallback / original shared revert

`IDENTITY_MODE=demo` is only for the previous synthetic-identity protocol flow:

**demo authorization server: accepts every request; codes are short-lived, not single-use**

It does not authenticate real people. `AUTH_REQUIRED=false` explicitly selects shared/no-auth fixtures. Neither is an automatic fallback for real auth errors. Concrete revert MCP: `https://acme-home-demo.vercel.app/mcp`. Leave that original production alias and its shared connector intact; do not repoint an existing shared experiment connection to this preview. Main's preview deployment/environment work is complete as reported above, but hosted consent and resolved real names remain unverified.
