# Auth deployment and remaining scope

Cleo now uses real Supabase Auth and the `public.cleo_*` onboarding functions. The migration `../supabase/migrations/202610170001_auth_onboarding.sql` has been applied to project **ntbkbvlsgymupjdpuvob**. Its guard intentionally rejects reruns against existing objects; use a new reviewed migration for changes. Existing `public.profiles` and Auth triggers are not modified. See [`../supabase/README.md`](../supabase/README.md) for the schema, RPC shapes, and reproducible SQL checks.

The frontend includes email/password sign-in, signup confirmation, Google/Facebook redirects, PKCE and allowed token-hash callbacks, server-verified account restoration, enrolled TOTP challenge, legal acceptance, business setup, password recovery/change, and local sign-out. Provider availability, successful email delivery, and full hosted sign-in round trips require separate deployment verification. The final live verification report records the settings actually saved; the table below is the required configuration for the listed launch URLs.

## Public build settings and entry pages

Build from `Frontend/` with `node source/build.js`. The configured origin is `https://ntbkbvlsgymupjdpuvob.supabase.co`. Use only that project's publishable key in `CLEO_SUPABASE_PUBLISHABLE_KEY`; a legacy anon key is also accepted. The build and runtime reject service-role/secret keys. Public keys are readable by visitors; RLS and the RPCs enforce access.

`/` opens the public `landing.html`. Landing Sign in, Get started, demo and plan links lead to explicit `index.html` app routes. The manifest launches `index.html`. The built entry guard preserves legacy hash links and forwards callback payloads to the app. Apache uses `.htaccess`; another static host needs the equivalent default-document rule. Deploy the complete `Frontend/` folder, including `assets/vendor/`, and use HTTPS outside localhost.

The official [`@supabase/supabase-js` 2.118.0 browser distribution](../Frontend/assets/vendor/supabase-js-2.118.0.js), its [integrity/source metadata](../Frontend/assets/vendor/supabase-js-2.118.0.json), and [MIT licence](../Frontend/assets/vendor/supabase-js-LICENSE.txt) are local. `build.js` checks the recorded digest and loads it before the app. No SDK CDN is needed.

## Redirect URLs

In Supabase Authentication → URL Configuration, enter plain URL text. A Markdown link such as `[http://127.0.0.1:5500](...)` is invalid as a Site URL. Choose the actual landing origin for Site URL; explicit app callback URLs belong in Redirect URLs.

| Local launch | Landing / Site URL candidate | Redirect URL for OAuth and confirmation | Redirect URL for recovery |
| --- | --- | --- | --- |
| Current 5500 launch | `http://127.0.0.1:5500/` | `http://127.0.0.1:5500/index.html` | `http://127.0.0.1:5500/index.html?auth=recovery` |
| Bundled preview server | `http://localhost:5175/` | `http://localhost:5175/index.html` | `http://localhost:5175/index.html?auth=recovery` |

Only one Site URL is saved at a time. The live project now allows `http://127.0.0.1:5500/index.html**`, `http://localhost:5500/index.html**`, `http://127.0.0.1:5175/index.html**`, and `http://localhost:5175/index.html**`. The suffix accommodates Supabase's generated `sb_flow_id` and the recovery query while keeping each destination limited to the explicit local app path. `localhost` and `127.0.0.1`, and ports 5500 and 5175, are different origins with separate browser session/PKCE storage. Start a flow and open its email link on the same origin/browser. The adapter requests an explicit index.html URL without a fragment, then sets `#/` after consuming the callback. A subdirectory deployment needs that same subdirectory in both app callback URLs. Production must add the verified HTTPS host and remove unused development rules before launch. See the official [Redirect URLs guide](https://supabase.com/docs/guides/auth/redirect-urls).

The Google/Facebook provider's authorized callback URI is **`https://ntbkbvlsgymupjdpuvob.supabase.co/auth/v1/callback`**. This is the provider-to-Supabase callback; the local `index.html` URLs are Supabase-to-app redirects. Enable only providers whose OAuth application credentials and consent settings have been configured. Browser code contains no provider secret.

## Email templates and recovery

- Keep a secure `{{ .ConfirmationURL }}` link in the signup-confirmation template. The built callback consumes the exchanged session and resumes business setup.
- The live signup screen accepts the project's **eight-digit** email code through `verifyOtp({ type: 'signup' })`. The saved signup email now includes both `{{ .ConfirmationURL }}` and `{{ .Token }}`; its source and previous body are in `supabase/templates/`. The live project's OTP length remains eight digits. Demo email codes and TOTP authenticator codes remain six digits.
- Password recovery uses a secure email link. Keep `{{ .ConfirmationURL }}` in the recovery template; a token-only recovery email is incompatible with the real UI's link-first recovery flow. After the link verifies, the new-password form opens without asking for another email code, and any enrolled TOTP challenge happens first.
- Custom links containing `token_hash` are accepted only with the supported OTP type. Build their query before `#/`; do not append `?token_hash=...` after a URL fragment. Prefer Supabase's generated confirmation link rather than manually concatenating token URLs.
- The live project currently uses Supabase's built-in email service, confirmed in Authentication → Emails. Configure custom SMTP, a verified sender, rate limits, and delivery before public production use. Backend deployment alone does not prove email delivery.

Recovery completes with a server-authenticated session, updates the password, and signs that local session out. Expired, cancelled, implicit-token or otherwise unsupported callback payloads fail visibly and are removed from the address bar. The service worker bypasses authentication query URLs so callback credentials are not stored in cache keys.

## Session and MFA requirements

Auth uses PKCE. The SDK stores credentials in sessionStorage by default, or localStorage when Keep me signed in is selected. Business collections and the UI account are kept in memory; a browser-held role or terminal label never grants membership. Roles are resolved through `cleo_auth_context()` from `auth.uid()`. Legal acceptance uses the exact bundled version `privacy 1.0, terms 1.0` and a server timestamp.

The current challenge UI supports already-enrolled **TOTP authenticator** factors. Database reads and onboarding/bootstrap functions require `aal2` whenever a verified factor exists. Enrollment management, mandatory owner enrollment, phone/WebAuthn challenge flows, and backup codes remain unfinished. Do not introduce phone-only/WebAuthn-only enrollment without adding its challenge UI. Recovery of an enrolled account also requires its TOTP challenge.

Supabase's **Require current password when changing password** setting is enabled, and its minimum password length is eight characters, matching the app. The account-change adapter verifies the old password using a separate memory-only client and passes `current_password` to the main session's update. The server setting supplies the authoritative restriction; a browser flag must not replace it. Supabase distinguishes genuine recovery sessions, which remain eligible for password reset without the forgotten old password. See the official [password security documentation](https://supabase.com/docs/guides/auth/password-security) and the Auth server's [recovery-session check](https://github.com/supabase/auth/blob/master/internal/api/user.go).

## Checks and unfinished APIs

From `Frontend/`, run:

```sh
node --test tests/unit.test.js tests/entry-routing.test.js tests/data-source.test.js tests/supabase-auth.test.js tests/auth-flow.test.js tests/sdk-build.test.js source/licensing.test.js
```

From the project root, run the isolated PostgreSQL checks:

```sh
npm --prefix supabase/tests install --ignore-scripts
npm --prefix supabase/tests test
```

The SQL harness uses a disposable local PGlite database; it does not contact the hosted project. `supabase/tests/live-rollback-verification.sql` is an optional whole-transaction check against the real database; its synthetic fixture accounts and business rows end with `ROLLBACK`. It verifies RPCs/RLS, not a browser provider/email round trip.

Catalog/settings and staff writes, registered-terminal credentials/PINs, sales, stock, reports, Realtime, payment intents, wallet/card linking, subscriptions, backup codes, remote-device session management, and external integrations remain unavailable in the real adapter. New business bootstrap returns no products and no paid subscription; the app reaches plan selection but cannot complete payment until authoritative billing APIs are implemented. The separate demo remains usable for simulated POS flows. This release does not claim a complete production POS backend.
