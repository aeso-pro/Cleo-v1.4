# Frontend ↔ backend handoff

A running log between the two developers on Cleo v1.4: **Claude Code (frontend)** and **ChatGPT Codex (backend)**. Add a dated entry at the top of the log when you change something the other side depends on, and answer open questions in place. Never put passwords, service-role keys or other secrets in this file.

## Who owns what

| Area | Owner | Where it lives |
| --- | --- | --- |
| Landing page, app screens, CSS, motion, accessibility | Frontend | `landing.html`; the CSS sections and screen code in `index.html` (`core.css` … `launcher.css`, `core.js`, `owner.js`, `backoffice.js`, `terminal.js`, `launcher.js`) |
| Static files the pages load | Frontend | `assets/`, `legal/`, `content/plans.md`, `sw.js` |
| Supabase schema, RLS, RPCs, Edge Functions, email templates, tests | Backend | `supabase/` |
| The real data-source adapter | Backend | the `backend/supabase.js` section of `index.html` (banner `===== backend/supabase.js`) |
| The operation contract both data sources implement | Shared: agree before changing | the `backend/contract.js` and `backend/errors.js` sections of `index.html` |
| Supabase dashboard settings (Auth URLs, providers, SMTP) | Backend | Supabase project `ntbkbvlsgymupjdpuvob` |

`index.html` is one built file that both of us edit. To keep merges clean, stay inside your own sections (each starts with a `/* ===== file · … */` banner), and say here before editing a shared one.

## Important: the repository has no `source/`

The README describes building from `Frontend/source/` with `node source/build.js`, but this repository only holds the **built** files (`index.html`, `landing.html`, `sw.js`). All frontend fixes so far were made directly in the built files. If a copy of `source/` exists elsewhere, either commit it here or port the changes listed below before rebuilding. Otherwise a rebuild silently undoes them.

## Log

### 2026-11-18 (night) · Claude Code (owner's laptop session), `main`

**Plans enforced on the server, branches and clerks added from the app, Free kept per account, and Windows and Android installers.** Backend and frontend; migration 008 is new.

- **Migration `202611180008_plans_branches_staff.sql`** (tests: `supabase/tests/plans.test.mjs`, 86 database checks pass):
  - `cleo_features()` mirrors `Cleo.licensing`'s matrix; `cleo_entitlement(business)` is the plan in force (with the 3-day grace) and its limits. With no plan, a business reads but changes nothing.
  - Triggers on `cleo_records`, `cleo_stock_movements` and `cleo_transfers` apply the plan to every signed-in write: Free holds 100 products and no stock or customers; stock items and receiving from Basic; adjustments, counts and customers from Pro; transfers on Max. Aeso's maintenance (no signed-in account) isn't stopped.
  - `cleo_add_branch` (owner or head office): Free, Basic and Pro have one branch; Max as many as `cleo_subscriptions.branches` pays for.
  - `cleo_staff` (PIN staff, salted SHA-256, no browser grants) with `cleo_add_staff`, `cleo_set_staff_pin`, `cleo_remove_staff`, `cleo_check_pin` (3 wrong PINs lock for 5 minutes, counted on the server) and `cleo_clock` (`cleo_attendance`). Free: one cashier.
  - `cleo_terminals` with `cleo_register_terminal` / `cleo_unregister_terminal`: the subscription's terminal count (Free: one).
  - `cleo_sales` with `cleo_upload_sale`, once per (branch, terminal, invoice), from a registered terminal only.
  - `cleo_save_setting` now takes every Settings section (types and sizes checked; `roles` and unknown sections still refused); a NULL version saves without the version check.
  - `cleo_bootstrap` adds `businessId`, `entitlement`, real terminal counts, PIN staff (`data.cashiers` and `users`), registered terminals and the last 36 hours of attendance.
- **Real adapter** (`backend/supabase.js` section): `registerTerminal`, `device`, `checkPin`, `clock`, `uploadSale`, `saveSettings`, `catalog.*` and `items.apply` now call the server. New contract operations `addBranch`, `addStaff`, `setStaffPin`, `removeStaff` (both adapters). Still pending: customers and other `save`/`remove` collections, stock posting from the screens, reports.
- **Free plan:** sign-in was already required; now its data is the account's own on the server (products, terminal, clerk, sales), and device-held records (electronic journal, the Terminal's menu layout, this terminal's registration) are kept per business, so accounts sharing a device stay apart. `content/plans.md`, the landing page and the Terminal's Sync pane no longer say "everything stays on the device".
- **Buttons:** Add branch in the Owner Dashboard (Branches page and branch switcher) and the Back Office (branch switcher and Devices); Add clerk on the Terminal's PIN screen. Plan locks: Transfers (Max) in the Back Office, branch comparison (Max) in the Owner Dashboard, customer profiles (Pro) and stock counts (Basic) in the Terminal. The demo's sample business now runs on Max.
- **Installers:** `apps/desktop` (Electron, `Cleo-Setup.exe`, updates itself), `apps/android` (Capacitor, `Cleo.apk`, offers updates), built and released by `.github/workflows/release.yml` from a `v*` tag. The landing page's download buttons point at the latest release. See `Docs/APP_RELEASES.md`. CSP `connect-src` adds `https://api.github.com` (the version line and the Android update check); `apps/` and `.github/` are never served.
- [x] *Done 2026-11-18: applied in the SQL editor ("Success. No rows returned"); the new functions answer on the live API.* **Run migration 008 on the hosted project** (Supabase › SQL Editor, the whole file). Until then the hosted project has none of the functions above, so the apps can't register terminals, add clerks or upload sales.
- [ ] **Android signing secrets** (`ANDROID_KEYSTORE_*`): until they are set, each APK has a temporary key. Owner's step, `Docs/APP_RELEASES.md`.

### 2026-11-18 (night) · Claude Code (UI/UX refresh session), `main`

**Landing screen captures re-taken, and a tool to re-take them.** New `tools/capture-screens.js` (no packages): `serve` runs the app on port 5176 without a CSP and with the demo clock at 3:45 PM Manila, a console call in the page captures a screen, `write` rebuilds `#screen-data` in `landing.html`. The Terminal, Owner Dashboard and Back Office captures now show today's UI passes. The enlarged-screen dialog lost its own `backdrop-filter` (it kept the sandboxed screen from painting, so the enlarged view was empty); the blur moved to `::backdrop`. The captions under the screens are visually hidden (kept for screen readers). Front end only.

### 2026-11-18 (evening) · Claude Code (UI/UX refresh session), `main`

**Landing page top section.** `landing.html`: the real-screen device frames and the enlarged-screen dialog no longer take the liquid-glass refraction map (in Chromium it smeared the Terminal capture in the hero and the workspace frames); the hero lede now says what Cleo is; the hero's actions are "Get started" and "Try the demo" (`index.html?demo#/`, replacing "See the plans", which stays in the nav); nav reads "Product" and its Get started has no outward arrow; "Explore the demo" is "Try the demo" throughout. The screen captures (`#screen-data`) were not re-taken and still show the app as it was before today's UI passes. Front end only.

### 2026-11-18 (later) · Claude Code (UI/UX refresh session), `main`

**Second UI/UX pass: ease of use across iPadOS-, macOS- and iOS-like surfaces; front end only.** Terminal payment sheet: method buttons read "E-wallet" and "On account" (display only; tender keys such as `'Charge'` are unchanged). Back Office: Catalog's bulk edit is "Edit in table"; Inventory's toolbar gains "Receive delivery" (same `receiveDialog()` as the Overview) and says "Adjust stock" / "Edit in table"; a plainer Inventory subtitle; the global search placeholder fits its field. Owner and Back Office sidebar counts are grey (not red). Admin console (`assets/admin/admin.css` only): the current nav item is a quiet fill with a red icon, the overview's six stats fit one row, and "Suspend" in account rows is plain red text on one line (it still asks first). No routes, data shapes or `data-*` hooks changed beyond the new `data-rcv` button.

### 2026-11-18 · Claude Code (UI/UX refresh session), `main`

**Calmer, clearer app chrome; front end only, nothing for the backend to do.** In `index.html`: the plan tab at the foot of every sidebar and the Terminal rail no longer runs a light round its edge, sheens or glows (plans are told apart by tint and edge); primary buttons lost their red glow; completed setup steps are grey checks so the current step leads; the sign-in mark has no "Hover, press or tap the mark" caption; the Terminal's browser-preview bar stays on one line on phones; plain cart items no longer say "No options". Copy: Back Office header buttons now match the quick actions ("Receive delivery", "Adjust stock"); Owner's "Exceptions" panel is "Flagged activity · Over your approval limits"; the revenue chart legend reads "Columns add up to net sales"; the sign-in fine print explains two-step sign-in plainly. No data shapes, routes, `data-*` hooks or element IDs changed. `DESIGN.md` has a new "Design philosophy" section (form follows function, nothing moves on its own, one emphasis per view, one name for one thing, say it once).

### 2026-11-17 (night) · Claude Code (owner's laptop session), `main`

**Admin Google sign-in fixed for the addresses the owner actually uses.** The auth logs showed the owner works on VS Code Live Server (`http://127.0.0.1:5500`), whose `/admin/` was not on the Redirect URL list, so Supabase sent the Google return to the Site URL (the main app) and the admin sign-in could not finish. Added `http://127.0.0.1:5500/admin/**`, `http://localhost:5500/admin/**` and `http://127.0.0.1:5175/admin/**` (10 Redirect URLs now). `returnAddress()` in `assets/admin/admin.js` always asks for the folder's `/admin/` address, so `/admin` and `/admin/index.html` also match the `/admin/**` entries.

### 2026-11-17 (later) · Claude Code (owner's laptop session), `main`

**Google sign-in on the admin console.** `assets/admin/admin.js`: a **Continue with Google** button (PKCE, `prompt=select_account`, returns to `/admin/`); the return is consumed before the stored session is read and the code is taken out of the address. Admin standing and the `aal2` requirement are unchanged: the database still decides. Supabase Redirect URLs now also allow `https://cleopos.online/admin/**` and `http://localhost:5175/admin/**`. Tested against the stand-in server: admin via Google reaches the code step then the console; a non-admin Google account is refused and signed out; a cancelled sign-in says so.

### 2026-11-17 · Claude Code (owner's session on his laptop), `main`

**Live project changed, admin console at `/admin`, Facebook sign-in off.** All on the owner's instruction.

- **Hosted database**: migrations 002 to 007 applied through the SQL Editor (each verified against the repository first). Read-only checks before and after: existing accounts, businesses and memberships unchanged; RLS on all 19 Cleo tables; nothing open to `anon` or writable by `authenticated`.
- **Supabase Auth settings**: the Facebook provider is **disabled** (its credentials are kept). `https://cleopos.online/index.html**` added to Redirect URLs. Site URL left at `http://127.0.0.1:5500` until the site is live.
- **Frontend**: Facebook was removed from the code by the cloud session's entry below (commit 1b519f5); this session's one-flag hide was dropped in favour of it when merging.
- **Migration `202611170007_admin_controls.sql`**: `cleo_admin_account`, `_confirm_email` (writes `auth.users.email_confirmed_at`), `_set_name`, `_set_member` (role, branch, or add to a business; keeps one owner), `_rename_business` (also updates `cleo_settings`), `_business_billing`, `_set_plan` (a subscription without payment, `method = ''`), `_payments`, `_admins`, `_set_admin`, `_billing_overview`, `_business_plans`. **Admins can now be added from the console** by a superadmin (no self-change; one superadmin with two-step always remains). 19 new checks in `supabase/tests/admin-controls.test.mjs`; 79 in all pass.
- **The console moved** to `admin/index.html` (served at `/admin`, with `admin/.htaccess` for no-store and noindex). `admin.html` is a meta-refresh to it. `tools/serve.js` serves folders and redirects `/admin` to `/admin/`; `tools/update-security.js` checks `admin/index.html`; `sw.js` never caches `/admin`.
- [x] **First admin**: `main.code.aeso@gmail.com` was made superadmin on 2026-11-17 at the owner's request (SQL in ADMIN_AND_SECURITY.md §1.2). Further admins are added on the console's Admins page.

### 2026-11-17 · Claude Code (cloud session), `main`

**Facebook sign-in removed.** The owner asked for it to be taken out of the app and the backend.

- [x] *Done 2026-11-17 by the owner's laptop session (entry above): the provider is off.* **Hosted project: Facebook is still switched on.** `/auth/v1/settings` reports `facebook: true`. The owner turns it off in Authentication › Sign In / Providers › Facebook. Until then, `backend/check-auth.py` fails (it now requires `facebook_disabled` and `google_enabled`).
- **`index.html`**: the "Continue with Facebook" button is gone from sign-in and sign-up. `socialAuth` in `backend/supabase.js` accepts only `google`; the Facebook-only email re-request (`auth_type=rerequest`, `auth-rerequest`) is removed; a pending provider sign-in can only be Google. Kept on purpose: the `#_=_` cleanup (old bookmarks), the no-email guard, and `'facebook'` as a recognised provider of an existing account.
- **Migrations unchanged.** `'facebook'` stays an accepted legal-acceptance method and an admin console filter: accounts already made with Facebook are real records. They sign in with email via **Forgot password?**.
- **`supabase/tests/e2e-server.mjs`**: the stand-in Auth refuses any provider but Google, as the hosted project will. All 19 + 52 backend tests pass.
- [ ] **Legal text still names Facebook.** The Privacy Policy and Terms (embedded `cleo-legal`, `legal/*.html`, `Docs/Cleo Privacy Policy.md`) describe Facebook sign-in. Removing it is a legal-text change for the owner, and needs a new document version (the auth tests read it).
- `node tools/update-security.js` re-fingerprinted the inline scripts and bumped the cache name.

### 2026-11-15 (later) · Claude Code (owner's session on his laptop), `main`

**Plan payments through PayMongo.** The owner asked for the payment methods to work. Setup and limits are in [PAYMENTS.md](PAYMENTS.md). Nothing is deployed: the migration, the two Edge Functions and their secrets are the owner's to apply.

- **Migration `202611150006_billing.sql`**: `cleo_plan_prices` (the same figures as `content/plans.md`), `cleo_payments`, `cleo_subscriptions`; `cleo_billing_start` (owner only, prices the plan itself) and `cleo_billing_status` for browsers; `cleo_billing_attach`, `_confirm` and `_close` for the service role only. **`cleo_bootstrap()` now returns `plan`, `subscription`, `billingMethod` and `invoices`** (it wraps the 003 version, renamed `cleo_operations_bootstrap`). `plan` is null when nothing is in force, as before.
- **Edge Functions** `billing` (`{ action: 'checkout' | 'verify' }`, needs the owner's session) and `billing-webhook` (PayMongo; `verify_jwt` off, signature checked, then PayMongo is asked directly). Logic is in `supabase/functions/_shared/billing-core.js` so the test server runs the same code.
- **`backend/supabase.js`**: `subscribe`, `addCard` and `linkWallet` are no longer pending. `subscribe({ plan, terminals, cycle, branches, method })` leaves for the provider's checkout page and does not resolve; Free resolves `{ ok: true }`. `bootstrap()` first handles a return from the provider (`?billing=paid|cancelled&ref=…`). `changePlan`, `invoices` and the rest of billing are unchanged.
- **`launcher.js`**: the payment page passes `method` to `subscribe`; outside the demo a wallet needs no mobile number (it is paid on the provider's page); `start()` clears the onboarding flag once a subscription exists and shows the outcome of a return.
- **A prices change now has two homes**: `content/plans.md` and `cleo_plan_prices`. Change both, the second with a new migration.
- [x] *Plan activation* (below) is built. [ ] It is not live until the owner follows PAYMENTS.md.

### 2026-11-15 · Claude Code (owner's session on his laptop), `main`

**Facebook sign-in return handling, account suspension, a platform admin console, and scripts by fingerprint.** The owner asked for the Facebook login and the backend to be fixed, an admin page, and hardening. This round crosses the ownership table, on his instruction: it edits `backend/supabase.js` and adds a migration. Setup steps are in [ADMIN_AND_SECURITY.md](ADMIN_AND_SECURITY.md).

For the frontend:

- **Run `node tools/update-security.js` after every edit to `index.html` or `landing.html`.** `.htaccess` no longer allows `'unsafe-inline'` scripts: `script-src` lists the SHA-256 of each inline script. An edited inline script that is not re-fingerprinted leaves the page blank. The tool rewrites the header line and the service worker's cache name, so do not hand-edit `CACHE` in `sw.js`.
- **No inline event handlers or `javascript:` links.** The policy blocks them, and the tool refuses to run if it finds one. The one that existed (the brand preview's sample link in `core.js`) is now a listener.
- `loginScreen()` in `core.js`: takes `agreedVersion`, shows `authError` on the card (`[data-auth-error]`) as well as in a toast, revives the social buttons on `pageshow`, and **Keep me signed in** starts unticked.
- `start()` in `launcher.js` parses the route again after `connect()`, because a provider return can restore the mode it started from.
- Both entry-page guards (the first inline script of `index.html` and `landing.html`) refuse to run inside another site's frame. Keep the two copies identical: they share one fingerprint.
- New files: `admin.html`, `assets/admin/` (no inline script or style; it has its own stricter policy), `tools/serve.js`, `tools/update-security.js`.

For the backend:

- **`backend/supabase.js` changed** (merged with the 2026-11-14 entry's `initialize()` mapping, which now lives in `callbackFailure()` with every case it had):
  - `authStorage` keeps keys ending `-code-verifier` in localStorage whatever "Keep me signed in" says, so a return in another tab finishes;
  - `socialAuth` records `cleo:auth-pending` (provider, intent, the agreed legal version, the route) for 20 minutes, and sends `auth_type=rerequest` to Facebook after a "no email" refusal;
  - `initialize()` removes Facebook's `#_=_`, and restores a mode route only when it matches `#/(terminal|owner|backoffice)[/view]`;
  - `fail()` shows the short messages Cleo's own functions raise (SQLSTATE 42501, 22023, 40001, 23505, P0002), never PostgreSQL's own text, and `23505` no longer reads "That account already exists";
  - `signedIn()` signs out locally when `cleo_auth_context` refuses the account, and `currentUser()` does the same for a user with no email.
- **Migration `202611140005_platform_admin.sql`** (apply after 001 to 004; the 46 earlier checks still pass, with 17 new ones in `supabase/tests/admin.test.mjs`):
  - replaces `cleo_session_is_strong()`, `cleo_auth_context()` and `cleo_register_verified_profile()`. Contracts are unchanged except: a suspended or banned account gets `42501` with hint `cleo_account_suspended` from `cleo_auth_context()`, and the trigger no longer aborts a sign-up;
  - `cleo_audit_log` is append-only for every role (`UPDATE`, `DELETE` and `TRUNCATE` raise). Keep that in mind for any future retention job;
  - a `BEFORE INSERT OR UPDATE OF data` trigger on `cleo_records` bounds record size (64 KiB), text length (2,000) and the types of `sku`, `barcode`, `cat`, `station`, `taxType`, `cost`, `available`, `icon` and the customer fields. New record fields must fit, or the limits move in a new migration;
  - three private tables and ten `cleo_admin_*` RPCs. `auth.users.banned_until`, `last_sign_in_at` and `raw_app_meta_data` are read; nothing in `auth` is written.
- `supabase/tests/helpers.mjs` gives the fixture `auth.users` those columns. `supabase/tests/e2e-server.mjs` serves the real pages in front of the real migrations with a stand-in Auth, for browser tests of sign-in and the admin console.
- [x] *Facebook sign-in is misconfigured in the dashboard* (2026-11-14 entry): the authorize redirect now carries a 16-digit Client ID, not an email address. The Meta-side checks (Live mode, Advanced Access for the `email` permission) are still the owner's to confirm.
- [ ] **Migrations 002 to 005 are not applied to the hosted project.** Until they are, the admin console answers "Admin tools aren't installed yet" and suspension does nothing.

### 2026-11-14 · Frontend (Claude Code), `main`

**Sign-up error messages, an idle sign-out, security headers and a Hostinger guide.** The owner asked for bug fixes and hardening across the code, so this round touches one function in `backend/supabase.js`.

What touches the backend:

- **`fail()` in `backend/supabase.js` names the field and says more.** Tested against the hosted project, a refused sign-up showed "Check the details and try again." under the password. Now:
  - `email_address_invalid`, `email_address_not_authorized`, `over_email_send_rate_limit`, `signup_disabled`, `provider_disabled`, `user_banned` and the existing-account conflict each have their own message and carry `field: 'email'`;
  - `weak_password` carries `field: 'password'`;
  - the sign-up form puts a password problem under the password and everything else under the email.

- **`initialize()` in `backend/supabase.js` explains a refused Google or Facebook return.** It reads `error`, `error_code` and `error_description` from the callback address before cleaning it, and maps them to a message (cancelled, no email shared, address not on the redirect allow list, provider turned off, sign-ups closed, provider couldn't finish). The raw provider text is never shown.
  No other lines of the adapter changed, and the 19 auth checks pass.
- [ ] **The hosted project still uses the built-in mailer.** Two sign-up attempts in a row answered `over_email_send_rate_limit`. Sign-up can't work for real customers until a custom SMTP sender is set in the dashboard.
- [ ] **Facebook sign-in is misconfigured in the dashboard.** The provider's Client ID was an email address, so Facebook refuses it. The owner is replacing it with the Meta app's ID and secret.
- **Content-Security-Policy.** `.htaccess` now sends one that allows connections only to the site and to `ntbkbvlsgymupjdpuvob.supabase.co` (https and wss). A new backend host (another project, an Edge Function on another domain, a payment provider) must be added to `connect-src` there, or the browser blocks it.
- **Idle sign-out (launcher.js).** Without "Keep me signed in", the Owner Dashboard, Back Office, mode picker and plan pages call `Cleo.session.signOut()` after 30 minutes with no input, with a one-minute warning. The Terminal is left out. This is a convenience for shared computers; session lifetime is still the server's to enforce (Auth → Sessions: time-box and inactivity timeout).

Frontend and hosting only:

- `.htaccess` also forces https, sets HSTS, X-Frame-Options, nosniff, Referrer-Policy and Permissions-Policy, refuses dotfiles, `Docs`, `backend`, `supabase` and stray `.md`, `.sql`, `.py` files, and turns off directory listings.
- `Docs/DEPLOY_HOSTINGER.md` lists what to upload and the Supabase URL settings the live address needs.

### 2026-11-13 (later) · Frontend (Claude Code), `main`

**A Free plan, plans that feel different, a new loading screen, and a Terminal without tables.** These changes went straight to `main`, as the owner asked.

What touches the backend:

- [ ] **Free plan: activation and limits.** `content/plans.md` has a new first plan with the ID `free` and a price of 0:
  - one terminal in one branch, Terminal only;
  - up to 100 products and one cashier;
  - data kept on the device, with no cloud sync, backup or remote support, so it costs nothing to run.

  Start free calls `Cleo.api.subscribe({ plan: 'free', terminals: 1, cycle: 'monthly', branches: 1, expectedTotal: 0 })` with no payment step, and `Cleo.licensing.quote` returns a zero quotation for it. The real adapter still answers `subscribe` with the unavailable-integration error, so Free can't start in real use yet. It needs:
  - a server path that activates Free without payment;
  - its limits enforced on the server;
  - no sync or backup jobs for Free businesses.
- **Feature tiers.** In `licensing.js` the tiers now run 0 Free, 1 Basic, 2 Pro and 3 Max; Enterprise has everything. Free includes checkout, the catalog, discounts and tax, refunds, receipts, shifts, daily and monthly sales reports, data export and updates. Server entitlements should match when they're enforced.
- **No tables in the Terminal.** The floor plan, table checks and the table chip are gone. The `features.tables` setting is no longer offered or read; old saved configs may still hold it and it is ignored. Dine-in orders are paid at the counter like takeout, and their kitchen tickets read "Dine-in".
- **The connection line is gone** from the foot of the sign-in and setup screens. When the server can't be reached, the sign-in card still says so.
- **Aeso's address is now Batangas City** in the legal pages, the embedded legal text and the receipt's software-supplier block. The Terms' disputes clause still names the courts of Makati City. Changing that is a decision for the owner and would need a new Terms version. The legal versions (privacy 1.0, terms 1.0) are unchanged, and the auth checks pass.
- **App downloads.** The landing page's new Windows and Android buttons link to `downloads/Cleo-Setup.exe` and `downloads/Cleo.apk`. The installers aren't in the repository yet.

Frontend only:

- The apps sit on plain light or dark backgrounds.
- The theme switch moved into each app's Settings.
- The sign-in mark has no shine, and hovering dims it.
- The loading screen is only the emblem lighting up in the background grid, as at the foot of the landing page, with no logo image or wordmark.
- The plan logos now grow from a seed (Free) to a bonsai (Enterprise), and each plan has its own look.
- The landing page is dark only, with no pause or theme button.

Nothing changed in `backend/*`, `api.js`, `env.js` or `supabase/`.

### 2026-11-13 · Frontend (Claude Code), `main`

**Everything is on `main` now.** At the owner's request, `codex/backend-auth-operations` (draft PR #2) and `claude/quirky-einstein-00lir7` were merged into `main`. Both branches are still on GitHub: deleting them from here was refused, so the owner will delete them there. Start new work from `main`.

- Merging deployed nothing. Migrations 002–004 are in `supabase/migrations/` but are still not applied to the hosted project. The caution in PR #2 still holds: try the new Auth trigger on a staging copy of the hosted schema first.
- All 46 backend checks in `supabase/tests` pass on the merged `main`, including the one that reads the legal contract from `index.html`.
- Codex's notes are in `Docs/BACKEND_FRONTEND_HANDOFF.md` and `backend/README.md`, and coordination issue #1 is still open. This log stays here. Until now, each of us had only seen our own file, because they were on separate branches.
- `.env` is no longer tracked. `.gitignore` ignores `.env` and `.env.*` but keeps `.env.example`.

### 2026-10-28 (night) · Frontend (Claude Code), branch `claude/quirky-einstein-00lir7`

**New emblem (commit `956b58b`).** The design team's newest emblem replaces the V everywhere. It is the same three nodes turned a quarter turn clockwise, so it stands like a "<". The wordmark is unchanged.

- `assets/brand/cleo-emblem.svg` is now portrait, with a viewBox of 980.27 × 1330.77. Every PNG in `assets/brand/` was rendered again from it under the same name, so `manifest.webmanifest` and the icon links didn't change. `sw.js` caches the new files under a new cache name.
- The logo with the wordmark follows the new artwork: the wordmark is 0.45 of the emblem's height and sits closer to it.
- The loading screen, both sign-in marks, the plan tabs, the customer display, the landing page and the legal pages all show the new shape. The landing page's app screenshots were captured again.

Nothing on the backend side changed. If you add the logo to the sign-up email (the optional item under the rebrand entry below), `cleo-icon-192.png` already shows the new emblem.

### 2026-10-28 (evening) · Frontend (Claude Code), branch `claude/quirky-einstein-00lir7`

**Flat 3D mark and the earlier charts (commit `66ee9e6`).**

- The sign-in emblem now lies flat and holds still, seen from above at a fixed angle with no perspective.
- Each box of the emblem is a pillar whose height keeps changing. Hovering raises the pillars, pressing sinks them, and tapping sends a ripple through them.
- The charts are back to their earlier designs, except two. The payment-mix ring keeps its round ends, and the revenue and profit columns are joined stacks with a round top.

These are frontend-only changes. Nothing on the backend side changed.

### 2026-10-28 (later) · Frontend (Claude Code), branch `claude/quirky-einstein-00lir7`

**3D sign-in mark, loading screen, ripples and charts (commit `a576076`).**

- The sign-in screen's emblem is now 3D. It is drawn with WebGL2 and turned onto its side, and people can drag or tap it. Narrow screens, reduced motion and computers without WebGL2 or graphics acceleration fall back to the 2D mark.
- The loading screen shows only the logo, with ripples in the background. The progress bar is gone. Progress is still announced to screen readers.
- Ripples everywhere are now irregular instead of perfect circles.
- Charts use round shapes: capsule columns, round-capped donut arcs, and dots for the heatmap and the calendar.
- The landing page's app screenshots were captured again.

Nothing on the backend side changed, and nothing in `supabase/`. One thing to know: `boot()` keeps its `work` option. Real start-up tasks still run one per step, and a failed task still ends the loading screen with `{ node, error }`. The steps just aren't shown on screen any more.

### 2026-10-28 · Frontend (Claude Code), branch `claude/quirky-einstein-00lir7`

**Rebrand (commit `2ed4396`).** The design team's new emblem and wordmark replace every Cleo logo: the app, the landing page, the legal pages, the favicons and the install icons.

- New files in `assets/brand/`: `cleo-emblem.svg`, `cleo-wordmark.svg`, `cleo-icon-32.png`, `cleo-icon-192.png`, `cleo-icon-512.png`, `cleo-maskable-512.png` and `cleo-touch-icon.png`. `cleo-emblem.png` is redrawn from the new emblem. `assets/README.md` has the details.
- `manifest.webmanifest` lists the new icons. `sw.js` caches the new files under a new cache name, so installed copies pick them up on their next online visit.
- Every glass surface now refracts its backdrop at the edge and has an embossed rim. The sheen gradients are gone. Chromium shows the refraction; other browsers keep the plain blur.
- The red backdrop light in the app is about half as strong. The landing page keeps its own.
- Controls follow Apple's conventions: the iOS switch, segmented controls, filled fields, bold titles, back chevrons, and bottom sheets on phones.
- The sign-in screen's right panel is now the emblem drawn in the lit box grid. People can drag across it or tap it.
- The landing page's embedded app screenshots were captured again from the rebranded app. The embedded fonts are now subsets, so `landing.html` went from 4.2 MB to 0.87 MB.

All 23 demo routes still fit at 320, 360, 390 and 1440 px, with no console errors. The key screens were checked in both themes. The service worker installs and the app opens offline.

Nothing on the backend side changed: no edits to the `backend/*`, `api.js` or `env.js` sections of `index.html`, and none to `supabase/`. The line endings in `backend/supabase.js` are kept as they were.

- [ ] **Optional: logo in the sign-up email.** `supabase/templates/confirm-signup.html` is text only. To add the emblem, use the PNG `https://<production-host>/assets/brand/cleo-icon-192.png`, shown at 48 px. Many mail clients block SVG images.

### 2026-10-17 · Frontend (Claude Code), branch `claude/quirky-einstein-00lir7`

**Restored the files the pages load (commit `334937b`).** Everything under `assets/`, plus `legal/` and `content/plans.md`, was missing from the repo, so on the host:

- real sign-in could not work, because `assets/vendor/supabase-js-2.118.0.js` returned 404 and the app said "This build doesn't include the Supabase client library yet";
- the app had no icons and no Cleo Sans, and its logos were broken;
- the Privacy and Terms links returned 404;
- the service worker never installed, so the Terminal had no offline mode.

The SDK is the official `@supabase/supabase-js@2.118.0` UMD build. Its sha384 matches the `integrity` attribute in `index.html`. The provenance of every file is in `assets/README.md`. With the restored files, the sign-in screen reports "Connected to Cleo". A sign-in attempt with the network blocked shows "Couldn't reach Cleo…", as designed. No request reached the live project during testing.

**Landing page (commit `8355b3b`).**

- The headline now reads "One Phase / Ahead.", and the page title follows.
- The light wave that ran under the footer now runs through the footer panel itself, and the extra strip at the bottom is gone.
- The opening paints in about 0.4 s instead of 3.7–4.1 s, measured on a throttled 4G-like connection with a 4× slower CPU.
- The opening no longer gets cut off on slow loads.
- The screen captures load while the page is idle, and the grid redraws less often when nothing moves.

DESIGN.md is updated to match.

**App layout on phones (commit `7258b6e`).** Every Owner Dashboard and Back Office page was 8 px wider than the screen, so the page panned sideways under a finger. Owner › Branches overflowed by 157 px, and Plan and billing and BIR also overflowed. All 23 demo routes now fit at 320, 360, 390 and 1440 px, with no console errors. These are CSS-only changes in `web-shell.css`, `owner.css` and `backoffice.css`. No backend sections were touched.

### Requests for the backend (Codex)

- [ ] **Auth URL configuration.** In Supabase › Authentication › URL Configuration:
  - set the Site URL to the production landing origin on Hostinger (plain `https://…/`);
  - allow the app callback, `https://<production-host>/index.html**`, as a redirect URL;
  - remove `localhost` entries from production.

  `Docs/AUTH_INTEGRATION.md` has the details.
- [ ] **Google and Facebook sign-in.** Both providers need public policy URLs, which now exist: `https://<production-host>/legal/privacy.html` and `https://<production-host>/legal/terms.html`. Enter them in the Google Cloud OAuth consent screen and the Facebook app settings, then confirm both buttons complete a round trip.
- [ ] **Pending operations.** These still return the unavailable-integration error from the real adapter:
  - catalog and settings writes;
  - terminal registration and staff PIN credentials;
  - sales upload and the electronic journal;
  - stock;
  - reports;
  - billing, subscriptions and payments.

  The screens already handle that error, so each can be switched on independently. Keep the `CleoError` codes and result shapes in `backend/contract.js` and `backend/errors.js`. Tell us here when one goes live, and the frontend will check its screens against real data.
- [ ] **Plan activation.** A new real business reaches the plan page but cannot activate a plan, because no subscription or payment API exists yet. This is the first blocker for a real owner after sign-up.
- [ ] **Demo in production.** The committed `.env` has `CLEO_DEMO=on`, and the built `index.html` includes the sample café (`?demo`). Decide whether production should be built with `CLEO_DEMO=off`. That needs `source/`, see above.

### Open questions for the backend

1. Which HTTPS host and path does Hostinger serve this repository from (root or a subfolder)? The redirect allowlist and the service worker scope both depend on it.
   *Partly answered in Codex's notes (issue #1):* the owner confirmed `https://cleopos.online`. Codex checked the root paths (`/index.html` and the SDK file), and on October 17 both still served a Hostinger parked-domain page, not Cleo. Whether the app will sit at the root is still open.
2. Does `source/` exist anywhere? If so, who will commit it?
