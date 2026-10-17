# CleoPOS 1.2 — landing and Supabase auth integration

Completed 17 October 2026 (Asia/Manila). The updated source and rebuilt pages are in `CleoPOS-1.2-auth-integrated.zip`. Supabase changes below were saved directly to project `ntbkbvlsgymupjdpuvob` through the existing Chrome dashboard session.

## Problems found and changes made

| Before | After |
| --- | --- |
| Supabase Site URL contained a Markdown link, causing an invalid redirect URL during the Google callback. | Saved plain `http://127.0.0.1:5500`. This was the confirmed cause in the Auth logs. |
| Frontend's real Supabase adapter was an unimplemented integration boundary. | Added real email/password, Google/Facebook OAuth redirects, PKCE callback exchange, signup confirmation, resend, verified session restoration, enrolled TOTP challenges, password recovery/change and local sign-out. |
| Landing and app routes could collide with OAuth callbacks, legacy hash routes and offline caching. | `/` opens `landing.html`; Sign in/Get started/plan actions open explicit `index.html` routes. Callback credentials reach the app intact, are consumed once and removed from the address bar. The service worker bypasses callback URLs. |
| Email code screen expected six digits while Supabase issues eight. | Real signup accepts eight digits with paste/autofill/manual entry. Demo codes and authenticator TOTP remain six digits. Mobile email fields use two rows of four. |
| Signup email offered only a confirmation link. | Saved a Cleo signup template containing both the secure confirmation link and `{{ .Token }}`. Source and previous body are included in `supabase/templates/`. |
| No Cleo server-owned business/membership/legal onboarding contract. | Applied a migration with five `cleo_*` tables and five functions for authoritative account context, atomic business/branch/owner creation, legal acceptance and safe empty bootstrap. |
| UI role/session state could be mistaken for real authorization. | Restored users are verified by Supabase Auth; membership roles come from the database. Browser metadata and local records cannot assign a role or bypass MFA. |
| Backend minimum password length was six. | Saved eight characters to match the app; enabled the requirement to supply the current password during an ordinary password change. |

Existing Auth users, existing `public.profiles`, the existing `handle_new_user` function and Auth triggers were preserved. The migration adds no `auth.users` trigger. Source plans, established styling and demo POS behavior remain in place.

## Live Supabase configuration

The public website has no confirmed deployed domain, so the working local development origins were selected. No hosting deployment or new public domain was created.

- **Site URL:** `http://127.0.0.1:5500`
- **Allowed app callback destinations:**
  - `http://127.0.0.1:5500/index.html**`
  - `http://localhost:5500/index.html**`
  - `http://127.0.0.1:5175/index.html**`
  - `http://localhost:5175/index.html**`
- The restricted path suffix supports the SDK's generated `sb_flow_id` and `auth=recovery` query parameters.
- Email, Google and Facebook are enabled; email confirmation remains required.
- Email OTP length remains **8**, expiry remains **3,600 seconds**.
- Minimum password length is **8**; current-password requirement is enabled.
- Existing TOTP MFA is enabled; SMS MFA is disabled. The app supports verification of already-enrolled TOTP factors.
- Only the project's **public publishable key** is embedded in the frontend. No service-role/provider secret is included.

Each new Cleo table has RLS and a SELECT policy. Anonymous roles have no table/RPC access; authenticated clients cannot write these tables directly. The five exposed functions pin an empty search path, derive the caller from `auth.uid()`, and enforce confirmed email and enrolled MFA as applicable. Onboarding and legal-acceptance retries are idempotent. Legal acceptance records the current bundled version and a server timestamp.

## Verification results

| Check | Result |
| --- | --- |
| Frontend/auth/routing/SDK/build/licensing regression suite | **70/70 passed** |
| Isolated PostgreSQL/PGlite migration, RLS, MFA, legal and tenant tests | **19/19 passed** |
| Transactional checks against actual Supabase database | **9/9 passed**, fixture changes rolled back |
| Public Auth settings request | HTTP **200**; email/Google/Facebook enabled; confirmation required |
| Anonymous `cleo_profiles` read | HTTP **401**, PostgreSQL `42501` |
| Anonymous `cleo_auth_context` call | HTTP **401**, PostgreSQL `42501` |
| Final source build | Passed: inline JavaScript, IDs, links, anchors, branding and stylesheet class checks |
| Browser checks | Landing → sign-in/signup, cancelled callback handling, desktop/mobile layouts; no captured JS warnings/errors |
| Mobile signup | 390px viewport, 390px document width, 16px form inputs, email OTP8 and TOTP6 |

The live SQL checks exercised schema privileges, new account context, atomic onboarding, retry behavior, current legal acceptance, safe bootstrap, metadata-role denial, direct-write denial and cross-tenant RLS. Two synthetic `example.invalid` accounts existed only within the verification transaction, which ended with `ROLLBACK`.

Screenshots alongside this report show the landing, auth screens, saved redirect configuration, password policy, signup email template and all nine passing SQL checks. The package includes reproducible frontend tests, the pinned PGlite harness and the live rollback SQL. `change-manifest.json` records per-file changes against the supplied ZIP and the final package SHA-256.

## Run the updated app

1. Extract the updated ZIP.
2. Open a terminal in `CleoPOS 1.2/Frontend`.
3. Run `node source/serve.js`.
4. Open **http://localhost:5175/** for the landing page.

The bundled `.env` contains public project configuration only. The generated pages are already rebuilt; no frontend dependency install is required. After source edits, run `node source/build.js`. Use the same origin and browser throughout signup/recovery, because PKCE storage is origin-specific. Opening HTML directly from disk does not provide a supported live-auth origin.

The default server binds only to this machine. Serve the entire `Frontend/` directory, including `assets/vendor/`. Apache's included `.htaccess` selects the landing; other hosts need the equivalent default-document rule.

## Remaining deployment and product limits

- **Email delivery:** Supabase currently reports that the built-in email service is active and is unsuitable for production. Public email signup/recovery requires custom SMTP credentials, a verified sender and delivery verification. No SMTP credentials or sender domain were supplied.
- **Public website:** select/verify an HTTPS deployment host, deploy the full frontend, set its plain landing origin as Site URL and replace unused development redirect rules with that app callback path.
- **Human sign-in round trip:** this release has not completed a fresh Google/Facebook/email-confirmation/recovery round trip through the updated app using a person's account. Automated adapter, SDK and database tests do not establish provider consent or inbox delivery. Start a fresh flow; do not reuse the expired callback from the screenshot.
- **MFA:** verification of enrolled TOTP is implemented. Enrollment management, backup codes, mandatory owner enrollment and phone/WebAuthn challenge flows are not implemented.
- **POS and billing:** real catalog/staff/settings writes, terminal registration/PIN credentials, sales/stock/report APIs, payments, subscriptions and external integrations remain separate backend work. New real businesses reach plan selection; unfinished billing cannot activate a paid subscription. Demo POS/payment screens continue to use simulated records.

The installed database migration is intentionally guarded against rerunning. It has already been applied to this project; use a new reviewed migration for future changes. Do not run a broad trigger removal or delete existing users to retry authentication.
