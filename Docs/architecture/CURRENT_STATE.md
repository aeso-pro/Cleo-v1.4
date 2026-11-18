# Cleo — Current State (Phase 1 inventory)

**As of:** 19 Nov 2026, from `main` at `ffdef82`, the live Supabase project `ntbkbvlsgymupjdpuvob`, Hostinger, and public DNS.
**Method:** read-only. Repository facts cite `file:line`. Live facts cite the dashboard screen, a public `curl -I` / `nslookup`, or the public Auth settings endpoint. Nothing on production was changed.
**Public-repo rule:** this repository and its GitHub Pages site are public. Live settings that would help an attacker are recorded in the git-ignored `Docs/private/SECURITY_GAPS.md` and referenced here as `S-n`.

## 0. Summary

- **Frontend:** a vanilla HTML/CSS/JavaScript web app shipped as built single files (`index.html` 16,368 lines, `landing.html` 1,680 lines), plus an admin console (`admin/`). No framework, no build step in the repository, no package manager at the root. The same web app is wrapped for Windows (Electron) and Android (Capacitor).
- **Backend:** Supabase. 8 migrations define 23 tables in `public`, all with RLS, browser writes only through 80 `SECURITY DEFINER` RPC functions, and 2 Edge Functions for PayMongo billing. No cron jobs, queues, Storage buckets, Realtime or views.
- **Hosting:** the app is live on **GitHub Pages** (`aeso-pro.github.io/Cleo-v1.4`). The production domain **cleopos.online** is on Hostinger (DNS, mail, CDN) and still serves Hostinger's **parked page**. No staging environment exists.
- **Offline selling:** the Terminal sells offline, but its outbox is **in memory only**, so a reload or crash loses sales that have not uploaded. Fiscal counters and the e-journal live in `localStorage` on the device.

## 1. Frontend stack and versions

| Item | Value | Evidence |
|---|---|---|
| Language and structure | Plain HTML, CSS, JavaScript; no modules (`type="module"` absent), code under `window.Cleo` | `index.html:65-2829` (one `<style>`), `index.html:2963-` (one main `<script>`) |
| Build step | None in the repository. `index.html` and `landing.html` are built files edited directly; the former `source/build.js` and `Frontend/source/` no longer exist | `index.html:4`, `README.md:26`, `Docs/FRONTEND_BACKEND_HANDOFF.md:18-20` |
| Supabase SDK | `@supabase/supabase-js` **2.118.0**, vendored UMD build with SRI hash | `assets/vendor/supabase-js-2.118.0.js`, `assets/vendor/supabase-js-2.118.0.json:2-7`, loaded at `index.html:2962`, `admin/index.html:30` |
| Supabase client options | PKCE flow, session persisted through a custom store under key `cleo:supabase-auth`, auto refresh on | `index.html:7936`, custom store `index.html:7809-7830` |
| Fonts | **Cleo Sans** = licensed Helvetica Neue `.otf` (300/400/500/700), stack `"Cleo Sans","Helvetica Neue",Helvetica,Arial,sans-serif`; receipts use `'SFMono-Regular',Consolas,'Liberation Mono',Menlo,monospace` | `index.html:76-79,84,794`, `landing.html:46-48,70-73,82`, `assets/fonts/` |
| Icons | Phosphor **2.1.1** icon fonts (regular, fill, bold) | `assets/icons/phosphor/*/style.css` |
| Design documents | `DESIGN.md` (Apple-inspired, glass materials, Cleo red `#d40000`, box-grid "Grid Continuity Rule" on sign-in/loading and landing), `PRODUCT.md` | `DESIGN.md:7-21,34-53,156` |
| Desktop app | Electron **45.2.1**, electron-builder 26.18.0, electron-updater 6.8.11, app ID `online.cleopos.desktop`, serves the web files on `127.0.0.1:47823` | `apps/desktop/package.json:13-42`, `apps/desktop/main.js:18-21` |
| Android app | Capacitor **8.6.0** (`@capacitor/app` 8.1.2), app ID `online.cleopos.app`, auth deep link `online.cleopos.app://auth-callback` | `apps/android/package.json:12-18`, `apps/android/configure-android.js` |
| App version | 1.4.0 (both wrappers); first release v1.4.1 per Docs | `apps/*/package.json`, `Docs/APP_RELEASES.md` |
| PWA | `manifest.webmanifest` (`start_url ./index.html`, standalone); `sw.js` pre-caches 31 files (cache `cleo-f54c08b9c5`), network-first for pages, cache-first for assets, never caches Supabase or other origins, skips `/admin`; registered only on https (or `?offline` on localhost); `landing.html` does not register it | `manifest.webmanifest`, `sw.js:12-85`, `index.html:16352-16360` |
| Local tooling | `tools/serve.js` (preview on 127.0.0.1:5175, mirrors `.htaccess` headers), `tools/update-security.js` (CSP script hashes in `.htaccess`, `sw.js` cache name, SRI and key checks; `--check` mode), `tools/build-app-web.js` (copies the web app into `apps/`), `tools/capture-screens.js` (landing screenshots) | `tools/*.js`, `.claude/launch.json` |

## 2. Pages and screens

| Page | Purpose | Evidence |
|---|---|---|
| `landing.html` | Public landing (default document): nav, hero, product, local, pricing, download, questions, closing, footer, comparison and screen dialogs | `landing.html:565-742`, `.htaccess:5` |
| `index.html` | The app: sign-in, setup, branch choice, mode picker, plans and payment, Owner, Back Office, Terminal, customer display — all drawn by JS from hash routes | `index.html:2831-2832` |
| `admin/index.html` (`/admin`), `admin.html` (forwarder) | Platform admin console (Google sign-in, MFA): overview, accounts, businesses, payments, admins, security, activity | `admin/index.html`, `assets/admin/admin.js:453-461`, `admin.html:7` |
| `legal/privacy.html`, `legal/terms.html` | Static legal pages | `legal/` |

Screens inside `index.html` (hash routes):

| Area | Route and views | Evidence |
|---|---|---|
| Entry | loading `boot()`, sign-in/sign-up `loginScreen()`, `#/setup`, branch choice, mode picker, `#/plans`, `#/plans/<id>` | `index.html:4278,5115,5647,15728,15812,16004` |
| Owner | `#/owner/<view>`: dashboard, branches, live, pnl, alerts, staff, inventory, billing, settings | `index.html:9289-9301,10300` |
| Back Office | `#/backoffice/<view>`: overview, catalog, inventory, transfers, bir, audit, expenses, customers, users, devices, settings | `index.html:10460-10473,12501` |
| Terminal | `#/terminal`: register device, PIN, open shift, main (rail: sell, orders, kitchen, jobs, appts, returns, shift, more/settings) | `index.html:12806,12876,12969,13007,13060` |
| Customer display | `#/terminal/display` | `index.html:15620` |

**Supabase calls from the browser** (all through RPC; no direct table reads, no `functions.invoke` except billing, no Realtime channel):
- App (`index.html`): `cleo_accept_legal`, `cleo_add_branch`, `cleo_add_staff`, `cleo_apply_records`, `cleo_auth_context`, `cleo_bootstrap`, `cleo_check_pin`, `cleo_clock`, `cleo_create_business`, `cleo_register_terminal`, `cleo_remove_staff`, `cleo_save_setting`, `cleo_set_staff_pin`, `cleo_unregister_terminal`, `cleo_upload_sale`; Edge Function `billing` (`index.html:8088`).
- Admin (`assets/admin/admin.js`): 22 `cleo_admin_*` RPCs.

**Fiscal logic in the browser** (`index.html:8783-` "bir.js"): per-terminal series for invoices (8 digits), voids `VD-`, refunds `RF-`, payment receipts `PR-`, bills `BL-`, **training receipts `TR-`**, X-readings `X-`, reprints `RP-`; accumulated grand total (`agt`), Z counter and reset counter, all stored in `localStorage` key `fiscal:<branch>-<terminal>` (`index.html:8870-8886`). A clock-back check refuses documents dated before the last (`index.html:8888`). The printed "validation seal" is a demo FNV hash, marked for replacement by a per-terminal HMAC (`index.html:8896-8901`). The Terminal has a **Training mode** setting (`index.html:13023,14945,15579-15586`).

## 3. Hosting, domains and mail

### 3.1 Hostinger (production target)

| Item | Value | Evidence |
|---|---|---|
| Plan type | Deferred — owner prioritised the frontend on 19 Nov 2026 (see §9) | hPanel |
| Web server | Hostinger edge in front (`Server: hcdn`); origin Apache/LiteSpeed assumed by `.htaccess` | `curl -I https://cleopos.online` (19 Nov 2026), `.htaccess:1` |
| Site state | **Parked page** ("Parked Domain name on Hostinger DNS system"); `http://` answers 200 without redirecting because the app is not deployed | `curl https://cleopos.online` title; `curl -I http://cleopos.online` |
| Deploy method | Documented as manual: ZIP uploaded through hPanel File Manager into `public_html`, after `node tools/update-security.js`; no ZIP build script exists | `Docs/DEPLOY_HOSTINGER.md:5-34` |
| Domains | `cleopos.online`, `www.cleopos.online` (CNAME to apex) | `nslookup` (19 Nov 2026) |
| Subdomains | No `staging.cleopos.online` (does not resolve) | `nslookup`, `curl` |
| Nameservers | Hostinger (`*.dns-parking.com`) | `nslookup -type=NS` |
| SSL | Valid certificate on `https://cleopos.online` (TLS handshake succeeds); forced-HTTPS rule exists in `.htaccess:11-17` but is not active until the app is deployed | `curl -I https://cleopos.online` |
| CDN | Hostinger CDN answering (`Server: hcdn`, `x-hcdn-request-id`) | `curl -I` |
| Mailboxes | Deferred — owner prioritised the frontend on 19 Nov 2026 (see §9) | hPanel › Emails |

### 3.2 GitHub Pages (interim live host — not on the fixed platform)

| Item | Value | Evidence |
|---|---|---|
| URL | `https://aeso-pro.github.io/Cleo-v1.4/` — the live app and the Supabase Auth Site URL | `Docs/ADMIN_AND_SECURITY.md:48-49`, `assets/admin/admin.js:241` |
| Server | `GitHub.com`; GitHub Pages does not read `.htaccess`, so the header, path and redirect rules in §3.3 apply only on Hostinger (consequences: S-1) | `curl -I` (19 Nov 2026) |
| Content | Serves the repository's files as published | `curl` (19 Nov 2026) |

### 3.3 Server configuration in the repository (`.htaccess`)

- `DirectoryIndex landing.html index.html`; `Options -Indexes -MultiViews` (`.htaccess:5,8`).
- HTTP → HTTPS 301 unless already HTTPS or localhost (`.htaccess:11-17`).
- 403 for dotfiles (except `.well-known`), the folders `Docs|docs|backend|supabase|source|node_modules|tests|tools|apps|.github|Cleo-v1.4-main`, the extensions `sql py sh env log bak zip toml lock map`, and `.md` except `content/plans.md` (`.htaccess:22-34`).
- Headers: HSTS 1 year (no `includeSubDomains`/`preload`), `nosniff`, `X-Frame-Options DENY`, `Referrer-Policy strict-origin-when-cross-origin`, Permissions-Policy, CORP, COOP, X-Powered-By removed, and a CSP with `script-src 'self'` plus 7 sha256 hashes, `connect-src` limited to the Supabase project and `api.github.com`, `frame-ancestors 'none'` (`.htaccess:37-62`).
- Caching: HTML, manifest and `sw.js` no-cache; images and `.woff2` one week (`.htaccess:66-73`); `admin.html` no-store, noindex (`.htaccess:77-82`); `admin/.htaccess` no-store, noindex.
- No clean-URL rewrites yet (pages are reached as `/index.html`, `/landing.html`); that is Phase 2.

### 3.4 DNS and mail for MAIL_DOMAIN (`cleopos.online`)

| Record | Present | Value (public DNS, 19 Nov 2026) |
|---|---|---|
| MX | Yes | `mx1.hostinger.com` (5), `mx2.hostinger.com` (10) |
| SPF | Yes | `v=spf1 include:_spf.mail.hostinger.com ~all` |
| DKIM | Yes | `hostingermail-a/b/c._domainkey` CNAMEs to Hostinger |
| DMARC | Yes, monitoring only | `v=DMARC1; p=none` (no report address) |
| Autodiscover | Yes | `autodiscover.cleopos.online` → Hostinger |
| A | Yes | apex → Hostinger edge |

### 3.5 Live Hostinger account (hPanel, read-only)

**Deferred.** The read-only hPanel pass was paused on 19 Nov 2026 when the owner prioritised the frontend. Still to read: plan type, websites on the account and their document roots, web server, Git deploy or SSH availability, CDN and "Under Attack" mode, SSL settings, mailboxes and sending limits, hPanel 2FA (recorded privately). See §9.

## 4. Supabase

### 4.1 Project and repository setup

| Item | Value | Evidence |
|---|---|---|
| Production project ref | `ntbkbvlsgymupjdpuvob` | `supabase/config.toml:2` |
| Staging project | None | — |
| `supabase/` in repo | Yes: `config.toml` (project_id and two function settings only; no auth, storage or API sections), 8 migrations, 2 Edge Functions plus `_shared`, email template `templates/confirm-signup.html` (not referenced by `config.toml`), tests | `supabase/` |
| Supabase CLI / Deno on this machine | Not installed | `which supabase deno` |
| Plan, region, Postgres version, compute | Deferred — owner prioritised the frontend on 19 Nov 2026 (see §9) | Dashboard › Settings |

### 4.2 Schemas and tables (as defined by the migrations)

All objects are in `public`. Every table has RLS enabled and every policy is `FOR SELECT TO authenticated`; there are no INSERT, UPDATE or DELETE policies, so browsers write only through RPC functions.

| Table | Migration | Tenant column | Money / quantity types | Browser SELECT |
|---|---|---|---|---|
| cleo_profiles | 001 | `user_id` | – | yes |
| cleo_businesses | 001 | `id` | – | yes |
| cleo_branches | 001 | `business_id` | – | yes |
| cleo_memberships | 001 | `business_id` | – | yes |
| cleo_legal_acceptances | 001 | – | – | yes |
| cleo_records (products, ingredients, categories, modifiers, customers as JSON) | 003 | `business_id` | price and cost inside `jsonb`, ≤ 2 dp | yes |
| cleo_settings | 003 | `business_id` | – | yes |
| cleo_period_locks | 003 | `business_id` | – | yes |
| cleo_stock_balances | 003 | `business_id` | `numeric(20,6)` | yes |
| cleo_stock_movements | 003 | `business_id` | `numeric(20,6)` | yes |
| cleo_audit_log | 003 | `business_id` | – | yes (owner, hq, manager, accountant) |
| cleo_transfers | 004 | `business_id` | `numeric(20,6)` | yes |
| cleo_transfer_requests | 004 | `business_id` | – | no |
| cleo_platform_admins, cleo_account_suspensions, cleo_admin_audit | 005 | – | – | no |
| cleo_plan_prices | 006 | – | `integer` whole pesos | no |
| cleo_payments | 006 | `business_id` | `amount_centavos bigint` | yes (owner, hq) |
| cleo_subscriptions | 006 | `business_id` | `total_centavos bigint` | yes |
| cleo_staff, cleo_attendance | 008 | `business_id` | – | no |
| cleo_terminals | 008 | `business_id` | – | yes |
| cleo_sales | 008 | `business_id` | `total numeric(14,2)` | yes (owner, hq, manager, accountant) |

Timestamps are `timestamptz` throughout; the only `date` column is `cleo_period_locks.month`. Asia/Manila is used in period locks and admin reports (`202610170003_operations.sql:392`, `202611140005_platform_admin.sql:387`). No table has a `business_date` column.

### 4.3 Database functions, triggers and other objects

- **80 functions**, every one `SECURITY DEFINER SET search_path = ''`. All are revoked from `PUBLIC`, `anon` and `authenticated`, then `EXECUTE` is granted to `authenticated` for the public RPCs and to `service_role` for `cleo_billing_attach`, `cleo_billing_confirm`, `cleo_billing_close` (`202611150006_billing.sql:345-346`).
- **Triggers:** profile registration on `auth.users` (`202610170002_verified_profiles.sql:22-24`); append-only guards on `cleo_audit_log` and `cleo_admin_audit` for UPDATE, DELETE and TRUNCATE (`202611140005_platform_admin.sql:218-224`); record validation on `cleo_records` (`…005:279`); transfer archive guard (`202610170004_transfers.sql:183`); plan guards on `cleo_records`, `cleo_stock_movements`, `cleo_transfers` (`202611180008_plans_branches_staff.sql:123,138,152`).
- **Idempotency in the database:** `request_id` unique per business on stock movements and transfer requests, with a reused key and a different payload rejected (`…003:52,61,384-390`; `…004:61-65,101-105`); billing settles by payment reference under a row lock (`…006:235-241`); `cleo_upload_sale` keys on (business, branch, terminal, invoice) with `ON CONFLICT DO NOTHING` (`…008:501-528`).
- **Not present in the migrations:** extensions, views, pg_cron jobs, pgmq queues, Storage buckets or policies, Realtime publications, Vault use.

### 4.4 Edge Functions

| Function | Auth | Purpose | Secret NAMES read |
|---|---|---|---|
| `billing` | `verify_jwt = true` plus bearer check; DB calls run as the caller | Start a PayMongo checkout; verify the return | `PAYMONGO_SECRET_KEY`, `CLEO_APP_URL`, `SUPABASE_URL`, `SUPABASE_ANON_KEY` |
| `billing-webhook` | `verify_jwt = false`; PayMongo HMAC signature checked | Settle a paid checkout through `cleo_billing_confirm` as `service_role` | `PAYMONGO_SECRET_KEY`, `PAYMONGO_WEBHOOK_SECRET`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` |

Evidence: `supabase/config.toml:5-11`, `supabase/functions/billing/index.ts`, `supabase/functions/billing-webhook/index.ts`, `supabase/functions/_shared/edge.js:7,16`, `supabase/functions/_shared/billing-core.js`.

### 4.5 Auth (public settings endpoint, 19 Nov 2026)

| Setting | Value | Evidence |
|---|---|---|
| Providers enabled | Email, Google (Facebook removed) | `GET /auth/v1/settings` |
| Sign-ups | Allowed | same |
| Email auto-confirm | Off (confirmation required) | same |
| Phone auto-confirm | Off | same |
| SAML | Off | same |
| MFA | TOTP used for admins and enforced through `cleo_session_is_strong` (aal2 when enrolled) | `202610170001_auth_onboarding.sql:100`, `…005:103,289` |
| Site URL and redirect URLs | Site URL = the GitHub Pages address; redirect URLs include GitHub Pages and local preview addresses | `Docs/ADMIN_AND_SECURITY.md:48-49`, `Docs/FRONTEND_BACKEND_HANDOFF.md:26` |
| Custom SMTP, rate limits, CAPTCHA, leaked-password protection, session lifetime | Deferred — owner prioritised the frontend on 19 Nov 2026 (see §9) | Dashboard › Authentication |

### 4.6 Live project (dashboard, read-only)

**Deferred.** The read-only dashboard pass was paused on 19 Nov 2026 when the owner prioritised the frontend. Still to read: plan, region, Postgres version, compute size, tables and row estimates, RLS per table (to compare with §4.2), deployed Edge Functions, Storage buckets, extensions, cron jobs, queues, Realtime, API key types and whether legacy keys are enabled, Security and Performance Advisor counts, Auth SMTP, rate limits and CAPTCHA. See §9.

### 4.7 Key types

- **Browser:** the publishable key (`sb_publishable_…`) and the project URL, embedded in `#cleo-env` (`index.html:2835`, `admin/index.html:28`). The app refuses `sb_secret_` keys and `service_role` JWTs at start-up (`index.html:3008-3019`, `assets/admin/admin.js:93-94`) and `tools/update-security.js:118` refuses them at build time.
- **Edge Functions:** the legacy names `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` (`supabase/functions/_shared/edge.js:16`); `cleo_require_service` checks the JWT `role` claim (`202611150006_billing.sql:134`), which depends on the legacy JWT-format service key.
- No secret values were found in the repository outside the vendored SDK (repo scan, 19 Nov 2026). The full-history scan is Phase 6.

## 5. Browser storage

| Store | Keys (prefix `cleo:`; demo uses `cleo:demo:`) | Evidence |
|---|---|---|
| localStorage | device and settings: `theme`, `config`, `device-mode`, `legal-accepted`, `plan`, `billing-method`, `subscription`, `onboarding`, `sales-request`, `quote-draft`, `bus`, `dev-offline`, `demo-clock`, `schema`, `auth-keep`, `auth-pending`, `session` (only with "Keep me signed in"); dashboards: `owner-dash`, `bo-cols`; Terminal: `t-device`, `t-hw`, `t-menu:<business>`, `t-pinlock`, `t-training`, `t-frame`, `t-pbar-hidden`, `fiscal:<branch>-<terminal>`; records: `db:<scope>:ejournal` (only the e-journal persists with the real backend); Supabase session: `supabase-auth` | `index.html:3135-3150,8538-8546,8885-8886,7809-7830,7936,13116` |
| sessionStorage | `session`, `pick`, `idle-out`, `auth-keep`, `auth-intent`, `auth-recovery`, `data-source`; admin: `cleo:admin-auth`, `cleo:admin-started` | `index.html:2996`, `assets/admin/admin.js:99-111,442-444` |
| IndexedDB | **Not used** (mentioned only in comments) | `index.html:12542`, `sw.js:9-10` |
| Cookies | None | repo search |
| Offline outbox | **In memory** (`S.outbox: []`); offline sales are pushed there and uploaded one at a time, in invoice order, on reconnect | `index.html:12628-12644,13081-13104,14194,14262` |

## 6. Environment variable names (names only)

- Frontend build template: `CLEO_DATA_SOURCE`, `CLEO_DEMO`, `CLEO_SUPABASE_URL`, `CLEO_SUPABASE_PUBLISHABLE_KEY` (`.env.example:6-18`).
- Edge Function secrets: `PAYMONGO_SECRET_KEY`, `PAYMONGO_WEBHOOK_SECRET`, `CLEO_APP_URL`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`; test-only overrides `PAYMONGO_API_URL`, `PAYMONGO_CHECKOUT_ORIGIN` (`supabase/functions/_shared/edge.js:7,16`, `billing-core.js:39-40`).
- Diagnostics: `SUPABASE_ACCESS_TOKEN` (`backend/check-auth.py:58`).
- CI secrets: `ANDROID_KEYSTORE_*` (`.github/workflows/release.yml:58-114`).

## 7. Tests, CI, linting and monitoring

| Area | State | Evidence |
|---|---|---|
| Database tests | 86 checks across 7 files on in-memory Postgres (PGlite 0.5.10), loading all 8 migrations; run with `npm test` in `supabase/tests` | `supabase/tests/package.json:6`, `helpers.mjs:10-27` |
| Manual e2e | `supabase/tests/e2e-server.mjs` stands in for Supabase and PayMongo on port 5180 | `.claude/launch.json` |
| Frontend tests | None (the `tests/` folder the README describes does not exist) | `README.md:70-91` |
| CI | `release.yml` builds the Windows and Android installers on tags and on `apps/**` changes to `main`; **runs no tests, lint or security scan** | `.github/workflows/release.yml:15-144` |
| Lint / format / type-check | None (no ESLint, Prettier, Stylelint, tsconfig) | repo search |
| Consistency check | `node tools/update-security.js --check` (not in CI) | `tools/update-security.js:5-6` |
| Monitoring | None (no Sentry, analytics or uptime check); an `unhandledrejection` toast only | `index.html:6356-6363` |
| Live diagnostics | `backend/check-auth.py` (read-only checks of Auth settings and the deployed page) | `backend/check-auth.py` |

## 8. Stale documents found

`supabase/README.md:3` and `backend/README.md:3` say later migrations are not applied (Docs say 002–008 are live); `PRODUCT.md:29` says there is no backend; `README.md`, `.env.example:1`, `sw.js:2` and `DESIGN.md:122` refer to `source/` and a build that no longer exist. Phase 4 cleans these up.

## 9. Owner to confirm

The live dashboard and hPanel passes are deferred (owner decision, 19 Nov 2026: prioritise the frontend). When Phase 1 resumes, read these read-only:

| Item | Where |
|---|---|
| Supabase plan, region, Postgres version, compute size | Supabase › Project Settings › General; › Compute and Disk; › Infrastructure |
| Tables, row estimates, RLS per table | Supabase › Table Editor; › Database › Tables |
| Functions, triggers, extensions | Supabase › Database › Functions / Triggers / Extensions |
| Edge Functions deployed | Supabase › Edge Functions |
| Storage buckets and policies | Supabase › Storage |
| Auth: URL configuration, SMTP, rate limits, CAPTCHA, password policy, MFA, sessions | Supabase › Authentication › URL Configuration / Emails (SMTP) / Rate Limits / Attack Protection / Sign In / Providers |
| Cron, queues, Realtime | Supabase › Integrations › Cron / Queues; › Realtime |
| API key types; legacy keys enabled | Supabase › Project Settings › API Keys (read the key *types* only) |
| Security and Performance Advisor | Supabase › Advisors |
| Backups and PITR | Supabase › Database › Backups |
| Hostinger plan, websites, document roots, deploy method (Git, SSH, File Manager) | hPanel › Websites; › Advanced › Git / SSH Access |
| SSL, CDN, "Under Attack" mode | hPanel › Security › SSL; › Performance › CDN |
| Mailboxes and sending limits | hPanel › Emails |
| hPanel 2FA, SSH/FTP users | hPanel › Account › Security; › Files › FTP Accounts |
