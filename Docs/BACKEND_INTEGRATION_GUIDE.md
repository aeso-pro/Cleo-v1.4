# Cleo backend integration guide

For the developer maintaining Cleo's implemented Supabase authentication/onboarding and extending the remaining operational backend. The earlier frontend cleanup remains recorded in `FRONTEND_CLEANUP_REPORT.md`.

> **Read this first: what is confirmed and what is proposed.**
>
> - **Implemented:** real Supabase Auth, PKCE callbacks, server-verified account restoration, enrolled TOTP challenges, email verification, password recovery/change, atomic business onboarding, legal acceptance, and empty business bootstrap. The `public.cleo_*` migration has been applied to project `ntbkbvlsgymupjdpuvob`.
> - **Still proposed:** operational POS tables/RPCs, terminal credentials, product/settings writes, sales, stock, reports, Realtime, payment providers, subscriptions and integrations described below. Pending operations explicitly report unavailable integration.
> - **Verification has limits:** frontend fixture tests and isolated PostgreSQL tests cover the implementation and security rules. Schema deployment does not by itself establish a complete hosted Google/Facebook or email round trip, or a production-ready POS. The final live verification report records the actual hosted checks/settings.

Use [`AUTH_INTEGRATION.md`](AUTH_INTEGRATION.md) for deployment/callback/email settings and [`../supabase/README.md`](../supabase/README.md) for the implemented database contract. Do not rerun `202610170001_auth_onboarding.sql` against the configured project: its collision guard correctly rejects an existing integration. Future changes require a new migration.

The earlier audit, `Docs/Frontend Audit and Supabase Readiness.md` (sections 6.1 to 6.4), holds a draft schema and the row-level security needs per operation. Use it with this guide. Where the two differ, this guide follows the current code.

---

## A. Project overview

### Technology

- **No framework or frontend package installation.** Plain JavaScript modules, each an IIFE that adds to one global, `Cleo`. Plain CSS with design tokens. Official `@supabase/supabase-js` **2.118.0** is vendored locally with its licence and integrity metadata.
- **One built page.** `node source/build.js` concatenates the sources into `Frontend/index.html`. It also builds the landing page, the legal pages and the service worker.
- **Node 18 or later** for the build and the preview server; Node 22 or later for the browser tests. There is no package manager, linter or type checker in the project.
- **Static hosting.** The root serves `landing.html`; explicit `index.html` runs the authenticated app and consumes callbacks. `.htaccess` covers Apache, `serve.js` covers local preview, and an early entry guard handles hosts still defaulting to index. Static assets can work offline through the service worker over HTTPS; Auth and server APIs still need a connection.

### Structure

```
Frontend/
  .env.example              build settings (copy to .env; never committed, never served)
  index.html                the built app (do not edit by hand)
  landing.html, sw.js, legal/   built pages and the offline worker
  content/plans.md          plan names, prices and limits (display only; the server decides entitlements)
  data/                     generated JSON reference copies (settings defaults, terminal defaults, plans)
  source/
    env.js                  which data source the page runs on; the public Supabase settings
    core.js                 runtime, design system, settings document (Cleo.config), sign-in screens
    data.js                 Cleo.data: the business's reference data, filled by the data source
    api.js                  the data layer the screens use; forwards to the active adapter
    backend/
      errors.js             CleoError, error codes, Cleo.attempt, the page-wide failure handler
      contract.js           Cleo.contract: every operation an adapter implements (the integration checklist)
      supabase.js           real Auth/onboarding adapter; remaining POS/payment operations pending
    demo/                   the sample business and its stand-in server (demo only; left out of CLEO_DEMO=off builds)
    owner.js, backoffice.js, terminal.js, bir.js, launcher.js   the three modes, BIR compliance, start-up
  tests/                    unit tests, browser tests, and fixtures/ (test-only stand-ins)
```

### Install and run

```bash
cd Frontend
cp .env.example .env
node source/build.js
node source/serve.js
```

Fill in `.env` before running `node source/build.js` (see below). The configured project origin is `https://ntbkbvlsgymupjdpuvob.supabase.co`; only its publishable key belongs in the build. Open `http://localhost:5175/` for the landing, `http://localhost:5175/index.html` for the real app, or `http://localhost:5175/?demo` for the sample business. Exact callback URLs for each host/port must be in the Supabase redirect allowlist; see `AUTH_INTEGRATION.md`.

Tests (from `Frontend/`):

```bash
node --test tests/unit.test.js tests/entry-routing.test.js tests/data-source.test.js tests/supabase-auth.test.js tests/auth-flow.test.js tests/sdk-build.test.js source/licensing.test.js
```

```bash
node tests/e2e.js
```

The browser tests need `node source/serve.js` running and a local Edge or Chrome (`CLEO_BROWSER` sets its path).

### Environment variables

Read by `source/build.js` from `Frontend/.env` or the process environment. They are embedded in `index.html` as `<script type="application/json" id="cleo-env">`, so **every visitor can read them**.

| Variable | Values | Purpose |
| --- | --- | --- |
| `CLEO_DATA_SOURCE` | `supabase` (default), `demo` | What the page runs on |
| `CLEO_DEMO` | `on` (default), `off` | Whether the demo ships in the build at all. Use `off` for production |
| `CLEO_SUPABASE_URL` | `https://<ref>.supabase.co` | The project URL (`http://localhost` or `http://127.0.0.1` only for a local Supabase) |
| `CLEO_SUPABASE_PUBLISHABLE_KEY` | `sb_publishable_...` or the legacy anon key | The public client key |

The build fails, before writing anything, on any of these:

- a `sb_secret_` key or a JWT whose role is `service_role`;
- a non-https URL that isn't localhost;
- an unknown data source;
- `CLEO_DATA_SOURCE=demo` with `CLEO_DEMO=off`.

`env.js` refuses the same keys again at run time. `.htaccess` and `source/serve.js` refuse to serve dotfiles. **Service-role keys, payment provider secrets, webhook secrets and SMTP credentials belong only in Supabase (Edge Function secrets or the database).**

### Data sources and storage

- **The two data sources.**
  - The **real backend** is the default.
  - The **demo** runs only with `?demo` (for that tab) or a demo build.
  - A tab's choice is kept in sessionStorage as `cleo:data-source`. `?demo=off` ends it.
- **Local storage.**
  - The demo stores its records under `cleo:demo:*`; the real backend uses `cleo:*`. Neither can read the other's records.
  - The theme and the landing page's preferences are shared by both.
  - `cleo:schema=2` marks that records from older builds were moved into the demo's keys once.
- **Shared records on the real backend** (`Cleo.db`) are **kept in memory only**, so customer data doesn't stay in localStorage on a shared computer.
  - The one exception is the electronic journal (`cleo:db:ejournal`). The BIR requires the terminal to keep its own copy.
  - The Supabase client keeps its session under `cleo:supabase-auth`, using sessionStorage unless the user selected persistent sign-in. PKCE verifier records belong to the same Auth namespace.
  - The real UI account is held in memory after `getUser()` plus `cleo_auth_context()` verification. A stored browser role or terminal label cannot manufacture a real sign-in.

---

## B. Backend integration map

### How the frontend reaches data

```
screens (owner.js, backoffice.js, terminal.js, launcher.js, core.js)
   │  Cleo.api.*  Cleo.db  Cleo.catalog  Cleo.items  Cleo.reports  Cleo.backend  Cleo.bus
   ▼
api.js  ── binds every operation in Cleo.contract to the active adapter, normalises failures
   ▼
backend/supabase.js  (real)          demo/server.js  (sample business)
```

- The screens never call a server or Supabase directly; only the adapter does.
- `api.js` binds exactly the operations listed in `backend/contract.js`. A unit test fails if either adapter is missing one or adds one that isn't listed.
- **The demo adapter is the executable reference for shapes.** For any operation, `source/demo/server.js` returns exactly what the screens are tested against. Match its return values, and replace its rules with server-side ones.

### Start-up sequence (real backend, `launcher.js`)

1. **`ready()`.** Is the adapter configured and the client library present? This drives the status line ("Connected to Cleo", "Not connected to Cleo's server") and the sign-in note.
2. **`restoreSession()`.** Validates the user with Supabase Auth, resolves `cleo_auth_context()`, and returns the account or `null`. `needsBusiness`, `needsLegal`, enrolled MFA, and password recovery determine which step resumes; roles come exclusively from database membership.
3. **`bootstrap()`.** Runs through `Cleo.backend.load()`, on the same loading screen for a returning user, or after sign-in.
   - It resolves `{ data, config, collections }` through `cleo_bootstrap()`. The current implementation loads real identity/modules/branches and an empty catalog; `plan` and `subscription` remain null.
   - A failure shows "We couldn't load your business", with Try again and Sign out.
4. **The mode opens.** It reads `Cleo.data`, `Cleo.config` and `Cleo.db` synchronously.

The `bootstrap` result, as `Cleo.backend.load()` reads it (`api.js`):

```
{
  data: {                       // Cleo.data.load(); every field optional (source/data.js lists the shapes)
    biz:         { name, legal, style, tin, vat },
    branches:    [{ id, bcode, name, short, area, city, addr, terminals, online, manager }],
    cashiers:    [{ id, name, initials, role, branch, color }],
    people:      { owner, hq, accountant, clerk },
    categories:  [{ id, name, icon }],
    products:    [{ id, sku, name, cat, price, cost, station, sizes, variants, barcode, branchPrice, branchOff, mods }],
    modifiers:   [{ id, name, pick, def, opts }],
    ingredients: [{ id, name, unit, grp, cost, rp, oh: { [branchId]: qty }, exp, archived }],
    peripherals: [{ b, kind, name, model, conn, status, on }]
  },
  config: { ... },              // the business settings; merged over CONFIG_DEFAULT (data/business-config.default.json)
  collections: { users: [...], customers: [...], terminals: [...], ... }   // rows for Cleo.db
}
```

The adapter also keeps the sync getters' data in its `state`: plan, subscription, billing method, invoices, transfers, audit trail and sales request.

### Collections (`Cleo.db`)

These are shared records, read synchronously. The screens write through `Cleo.api.save(name, record)` and `Cleo.api.remove(name, id)`. Only the adapter writes the cache: `Cleo.db.hydrate(name, rows)` replaces a collection, and listeners are told.

| Collection | Holds | Notes |
| --- | --- | --- |
| `users` | Web and terminal staff: `{ id, name, email, mobile, initials, color, role, roles, status, pin, twoFactor, last }` | `roles` is `{ [branchId]: roleKey }`. **Proposed:** `{ all: roleKey }` for a role in every branch, including branches added later (an owner). The screens accept both |
| `customers` | Profiles, points, visits, spend, consent date, statutory discount IDs, charge accounts | Personal data: memory only on the device |
| `promos` | Automatic discounts the terminal runs on every cart change | The server must re-run them on upload |
| `expenses` | Expenses with category and receipt | |
| `terminals` | Per terminal (`id` = `<branch>-t<n>`): `{ b, t, min, serial, ptu, registered, series, agt, z, reset, lastZAt, syncMin, unsynced, off }` | A record's existence marks the number as taken in registration. `min` and `ptu` are needed before invoices can print |
| `ejournal` | Every BIR document the terminal printed | Device-owned (kept locally). The server keeps the append-only copy |
| `approvals` | Void, refund, discount and exchange requests: `{ id, kind, amount, b, t, who, reason, status, by, at }` | Decided only through `decideApproval` |
| `tickets` | Kitchen tickets per station | |
| `attendance` | Clock in and out | |
| `appointments` | Services bookings | |
| `deliveries` | GrabFood and foodpanda orders | Inserted by platform webhooks, never by the client |

### Modules

Each module lists its files, operations, data, authorisation, validation and status. Section C distinguishes implemented Auth/onboarding mechanisms from proposed operational mechanisms. Frontend screens existing does not mean the corresponding business operation is implemented.

**1. Sign-in, sign-up and account**

- **Files:** `core.js` (`loginScreen`: sign-in, sign-up, email code, two-step code, backup code, password reset, social sign-in, legal acceptance), `launcher.js` (start-up), `owner.js` (account and security settings).
- **Operations:** `ready`, `restoreSession`, `signIn`, `signUp`, `verifyEmail`, `resendVerification`, `socialAuth`, `createBusiness`, `acceptLegal`, `verifyCode`, `verifyBackupCode`, `requestPasswordReset`, `resetPassword`, `signOut`, `changePassword`, `newBackupCodes`, `signOutDevice`.
- **Data:**
  - These operations resolve `{ ok: true, ... }` or `{ ok: false, code, message, field? }`. The screen shows `message` and marks `field`.
  - `signIn` resolves `{ ok, twoFactor, account: { name, email, role } }`.
  - In real mode, `socialAuth` resolves `{ ok, redirecting: true }` after initiating the provider redirect. The callback restores the account and decides whether onboarding is needed. The demo returns its simulated account directly.
- **Authorisation:** Supabase Auth.
  - The screens challenge already-enrolled TOTP factors; database reads and RPCs require `aal2` whenever a verified factor exists. Mandatory enrollment, enrollment management, phone/WebAuthn challenges, and backup-code support are not implemented.
  - `cleo_create_business` creates the business, first branch and caller's owner membership in one transaction. Repeat submissions return the existing business; revoked membership cannot be bypassed by re-onboarding.
- **Validation:** done by the server (email format, password policy, code expiry, rate limits).
  - Return `rate_limited` for throttling.
  - Return `validation` with a `field` for form errors.
- **Status:** Auth, confirmation, TOTP challenge, recovery/change, local sign-out, context restoration, onboarding and legal acceptance are implemented. The pinned local SDK and public project settings are built in.
  - Provider credentials, email delivery/templates and redirect allowlists remain deployment settings; see `AUTH_INTEGRATION.md`.
  - Backup-code operations and remote per-device sign-out remain unavailable (see F). Real login hides its backup-code option.

**2. Business data and settings**

- **Files:** `data.js`, `core.js` (`Cleo.config`, the settings UI), `backoffice.js` (Settings), `owner.js` (Settings).
- **Operations:** `bootstrap`, `saveSettings`, `save`, `remove`.
- **Data:**
  - `saveSettings({ path, value })` saves one setting, using dotted paths from `CONFIG_DEFAULT`, for example `business.tin` or `limits.voidApproval`.
  - The screen applies the change immediately and **rolls it back with a message if the call fails**. `device.*` settings stay on the device.
- **Authorisation:** business settings are owner and HQ only; the server decides who may change what, by role (`config.roles`).
- **Validation:** the server validates every path and value (types, ranges, the TIN format).
- **Status:** empty bootstrap is implemented for the authenticated business. Settings and generic collection writes remain pending; attempted changes are refused and rolled back.

**3. Terminal: registration, PINs, selling, payments, kitchen, loyalty**

- **Files:** `terminal.js`, `bir.js`.
- **Operations:**
  - Registration and staff: `device`, `registerTerminal`, `unregisterTerminal`, `checkPin`, `clock`.
  - Selling and payments: `uploadSale`, `createQrIntent`.
  - Kitchen: `createTickets`, `updateTicket`.
  - Customers and approvals: `recordLoyalty`, `requestApproval`, `decideApproval`.
  - Catalog: `catalog.list`, `catalog.on`.
- **Data:**
  - **`registerTerminal`** takes `{ branch, term }` and resolves `{ ok }`. The device keeps `{ branch, term, at }` as `t-device`.
    - **Proposed:** the server also issues a device credential and the terminal's BIR series.
  - **Sales** are queued in an outbox and uploaded in invoice order. A failed upload stays queued and is never shown as synced.
    - Today `uploadSale` sends a summary: `{ b, t, who, total, items, method, inv }`. The full invoice is the electronic journal entry (see F, open decision 1).
  - **`createQrIntent({ amount, ref })`** resolves `{ id, amount, ref, expiresIn }`.
    - The Terminal then waits for `Cleo.bus` `payment.confirmed` `{ ref, amount, provider, reference }`. That event must come from the gateway's webhook, through Realtime. **The client never confirms a payment itself.**
    - If the intent fails, the cashier is offered manual e-wallet entry.
  - **`requestApproval(record)`** returns at once with `{ id, decision, cancel }`. `decision` resolves `{ ok, by }` when a manager decides.
- **Authorisation:**
  - Staff sign in on a registered terminal with a PIN. The PIN must be checked on the server, or against a server-issued hash on the device.
  - Approvals: only roles allowed by `config.limits` and `config.roles` may decide.
- **Validation:**
  - The server recomputes every total, VAT and statutory discount, and re-runs the promos.
  - `uploadSale` must be idempotent per (terminal, series, number).
- **Status:**
  - The screens are complete.
  - A real business with no branches sees "No branches yet" on registration.
  - Terminal numbers in use come from `terminals` records.
  - A refused registration says so and stays on the dialog (tested with the empty-business fixture).
  - Demo-only aids are hidden in real mode: simulate offline, the sample count, the scale and scanner simulators.

**4. BIR compliance**

- **Files:** `bir.js`, plus the BIR screens in `backoffice.js`.
- **Operations:** none on the device. Documents are numbered and printed offline (`Cleo.bir.issue`). `emailDocument` sends a reading as a PDF. The journal travels with the sales.
- **Data:** per terminal, its fiscal memory (series, accumulated grand total, Z counter). The terminal's starting `series` and its registration come from its `terminals` record.
- **Rules (confirmed in the frontend):**
  - An **invoice can't be issued** until the business TIN, the registered name, and the terminal's MIN and PTU are all present (`Cleo.bir.invoiceReady`).
  - In real mode, `issue('invoice')` throws a `validation` error that names what is missing. Nothing is made up. Training receipts and readings still work.
- **Server:**
  - Store the journal append-only for at least 5 years.
  - Check numbering for gaps and duplicates.
  - Replace the demo validation seal with an HMAC that the server can verify.
  - The checklist is in `Docs/Cleo BIR Compliance Review.md`.
- **Status:** device side complete. The server-side BIR checks, BIR exports (sales journal, daily summary) and seal verification are not built. In real mode those export buttons are disabled and say why.

**5. Back Office**

- **Files:** `backoffice.js`.
- **Operations:**
  - Catalog: `catalog.*`, `items.*`.
  - Inventory: `adjustStock`, `receiveStock`, `stockLedger`, `submitCount`.
  - Transfers: `transfers`, `createTransfer`, `advanceTransfer`.
  - Close-out and accounting: `signOffShift`, `lockPeriod`.
  - Audit: `auditTrail`, `logAudit`.
  - Users, customers, promos, expenses: `save` and `remove`, plus `resendInvite`.
  - Documents: `emailDocument`.
- **Data:**
  - `adjustStock` resolves `{ ok, approved, item }`; `approved` is false when the value exceeds `limits.adjustApproval`.
  - `receiveStock` resolves `{ ok, item }` and moves the cost to the weighted average.
  - `submitCount` resolves `{ ok, needsApproval }`.
  - `createTransfer` and `advanceTransfer` resolve `{ ok, transfer }`.
  - **After a stock change, update the matching object in `Cleo.data.ingredients` in place** (for example `Object.assign`), or call `Cleo.backend.refresh()`. The screens re-read those objects.
- **Authorisation:**
  - Every action is checked against the user's role for that branch (`users.roles`).
  - The frontend hides actions a role can't take, but the server must refuse them too.
- **Validation:**
  - The stock ledger is append-only: quantity and cost change only through movements.
  - Transfers move at weighted average cost.
  - A locked period refuses changes.
  - The audit trail is written by the server only.
- **Status:**
  - Complete against the contract. Every write goes through an adapter operation via `Cleo.attempt`, so a refusal shows a message and paints nothing.
  - On the real data source, KPIs show "—" with "Appears once reports are connected", and sample tasks, counts and BIR rows are demo-only.

**6. Owner Dashboard**

- **Files:** `owner.js`, `charts.js`.
- **Operations:**
  - Reports: `reports.owner`, `reports.prepare`.
  - Live: approvals (`decideApproval`), the live feed (`Cleo.bus` `sale.created`).
  - Billing: `plan`, `subscription`, `billingMethod`, `invoices`, `changePlan`, `addCard`, `linkWallet`, `subscribe`, `salesRequest`, `requestSalesCall`.
  - Account: `changePassword`, `newBackupCodes`, `signOutDevice`.
- **Data:**
  - **`reports.owner()`** returns the report model, or `null`. With `null`, every report view says "Sales, profit and stock figures appear once Cleo is connected", and the live feed and terminals panel are hidden.
  - The model's fields are those `demo/owner-model.js` returns, and the demo shows each one's shape: `RATES, EXP, hours, live, kpis, mix, productPerf, heat, activity, actStats, trend, feed, ALERTS, TERMS, staffPerf, todaySpark, branchExtras, pnl, staffDetail, terminalSplit, shrinkage, dailyUse`.
  - `makeEvent` is a demo generator. A real model should not provide it: the ticker that calls it runs only in the demo.
- **Authorisation:** owner, HQ and accountant views. Billing is owner only.
- **Validation:**
  - Report figures must come from the server's records: sales, the journal and stock movements. The frontend never estimates them.
  - Plan limits are enforced by the server and the billing provider; `content/plans.md` only sets what people read.
- **Status:**
  - Complete; the empty states were tested with the empty-business fixture.
  - Plan and billing shows "No plan on record" when the server returns no plan.
  - The top bar shows the time of the last load. It changes to "Live" only once real `sale.created` events arrive.

**7. Plans and checkout**

- **Files:** `launcher.js` (the plan page, the payment page), `licensing.js` (quotations), `content/plans.md`.
- **Operations:** `subscribe`, `addCard`, `linkWallet`, `changePlan`, `requestSalesCall`.
- **Data:**
  - `subscribe({ plan, terminals, cycle, branches, expectedTotal })` resolves `{ ok, subscription }`, or `{ ok: false, message }`.
  - When the server's total differs from `expectedTotal`, it must refuse with a message: the screen tells the buyer that pricing changed.
- **Authorisation:** owner only.
- **Status:** screens complete; the payment provider isn't chosen (see F). The demo's plan page notice "Payment is simulated in this preview" shows only in the demo (`Demo notice:` in `content/plans.md`).

### Realtime events (`Cleo.bus`)

The screens treat these as hints to refresh, never as the data itself. Today they travel between tabs on one device (BroadcastChannel; the demo uses a separate channel). **Proposed:** the adapter subscribes to Supabase Realtime channels per business and branch, and calls `Cleo.bus.emit(type, data)` and `Cleo.db.hydrate(name, rows)`.

| Event | Data | From |
| --- | --- | --- |
| `sale.created` | `{ b, t, who, amt, items, method, inv }` | Server, after `uploadSale` |
| `approval.requested`, `approval.decided` | `{ id }`, `{ id, ok, by }` | Server, on `approvals` changes |
| `ticket.created`, `ticket.bumped` | `{ id }` | Server, on `kitchen_tickets` changes |
| `payment.confirmed` | `{ ref, amount, provider, reference }` | Server, from the payment webhook only |
| `display.update`, `display.pay`, `display.done`, `display.hello` | Customer display | Stays local (same device); no server involvement |

---

## C. API contract requirements and implementation status

### Conventions the frontend already applies (confirmed)

- **Two failure styles**, chosen per operation by `api.js` (`RESULT_OPS`):
  - **Result operations** (sign-in and account flows, registration, plan and payment, platform connection, approval decisions) resolve `{ ok: false, code, message, field? }`.
  - **Every other operation** rejects with a `CleoError`.
  - Either way, nothing on screen looks like success.
- **Error codes** (`backend/errors.js`), each with a user-facing default message. A server message replaces the default when it is safe to show. Map server failures as follows:

| Code | Use for |
| --- | --- |
| `not_configured` | No Supabase settings or client library (the adapter does this) |
| `integration_pending` | Configured, but this operation isn't implemented yet |
| `unauthorized` | HTTP 401, an expired or revoked session. The frontend signs the user out |
| `forbidden` | HTTP 403, or a row-level security refusal |
| `not_found` | HTTP 404, or no row |
| `conflict` | HTTP 409, a unique violation (Postgres 23505), or a stale update |
| `validation` | HTTP 400 or 422, a check violation (23514), or a business rule; include `field` when one input is at fault |
| `rate_limited` | HTTP 429 |
| `network` | A failed fetch, or the device is offline |
| `unavailable` | HTTP 5xx, or a timeout |
| `unknown` | Anything else; the message says nothing was saved |

- **Sync operations never wait on the network.** They return what the adapter already holds: `bootstrap`, Realtime, or a `reports.prepare` call made before the view renders.
- **Logging:** the frontend logs no customer, payment or authentication data. Keep Edge Function logs free of it too.

### Implemented and proposed mechanisms

Supabase exposes four kinds of route:

- **Auth:** `/auth/v1/*`, through the client's `auth` methods.
- **Tables:** `/rest/v1/<table>`. GET reads, POST inserts, PATCH updates, DELETE deletes, and every request is filtered by row-level security.
- **RPC functions:** `POST /rest/v1/rpc/<name>`, for multi-row transactions and server-side rules.
- **Edge Functions:** `POST /functions/v1/<name>`, for anything needing a secret: payment providers, platforms, email, the Auth admin API.

Auth methods and RPCs beginning `cleo_` below are implemented. Other table, RPC and Edge Function names remain proposals. The complete implemented shapes and RLS rules are in `../supabase/README.md`.

| Operation | Area | Kind | What the screens need | Supabase mechanism/status |
| --- | --- | --- | --- | --- |
| `ready` | start-up | async | Whether this data source can be used at all: { ok } or { ok: false, code: not_configured }. | No request: checks the settings and the client library |
| `restoreSession` | auth | async | Verified account, or null; also onboarding/legal/MFA/recovery state. | Implemented: `getSession()`, `getUser()`, assurance check and `cleo_auth_context()` |
| `bootstrap` | start-up | async | Identity, allowed branches, settings and collections. | Implemented: `cleo_bootstrap()`; catalog/operational collections empty; subscription null |
| `signOut` | auth | async | Revoke the current device session and forget local credentials. | Implemented: Supabase Auth `signOut({ scope: 'local' })` and local cleanup |
| `signIn` | auth | async | Email and password. Resolves { ok, twoFactor, account } or { ok: false, message }. | Supabase Auth `signInWithPassword`; `twoFactor` from the MFA assurance level |
| `signUp` | auth | async | Create an account and send an email verification code. | Supabase Auth `signUp` (email OTP) |
| `verifyEmail` | auth | async | Confirm the sign-up code. | Supabase Auth `verifyOtp` (type signup) |
| `resendVerification` | auth | async | Send a new sign-up code. | Supabase Auth `resend` |
| `socialAuth` | auth | async | Start Google/Facebook navigation: `{ ok, redirecting: true }`; restore account after callback. | Implemented: `signInWithOAuth`; availability depends on enabled provider configuration |
| `createBusiness` | onboarding | async | Create the business, its first branch and the owner role for the authenticated account. | Implemented: `cleo_create_business(jsonb,jsonb,jsonb)` |
| `acceptLegal` | auth | async | Record the current bundled Terms/Privacy version with the server timestamp. | Implemented: `cleo_accept_legal(text,text)`; browser has no direct insert permission |
| `verifyCode` | auth | async | The two-step sign-in code (TOTP). | Supabase Auth MFA `challenge` + `verify` (TOTP) |
| `verifyBackupCode` | auth | async | A one-time backup code instead of the TOTP code. | Edge Function `verify-backup-code` (Supabase Auth has no backup codes: open decision) |
| `requestPasswordReset` | auth | async | Email a secure password reset link. | Implemented: `resetPasswordForEmail` with `index.html?auth=recovery` redirect |
| `resetPassword` | auth | async | Change password after a verified recovery callback and any enrolled MFA. | Implemented: PKCE/allowed token-hash callback, `updateUser`, then local sign-out |
| `changePassword` | account | async | Change the signed-in account's password after current-password confirmation. | Implemented: temporary memory-only password check, main-session `updateUser({ current_password, password })`; require current password server setting |
| `newBackupCodes` | account | async | Issue a new set of backup codes (the old set stops working). | Edge Function `backup-codes` (open decision, as above) |
| `signOutDevice` | account | async | End the account’s session on another device. | Edge Function `sign-out-device` (per-session sign-out needs the admin API: server only) |
| `device` | terminal | sync | Verified terminal registration, or null. | Real adapter returns null until server-issued credentials exist; browser labels cannot bypass account sign-in |
| `registerTerminal` | terminal | async | Register this device as a terminal of a branch; issues its BIR series and a device credential. | Edge Function `register-terminal` |
| `unregisterTerminal` | terminal | sync | Forget this device’s registration (the server frees the slot through an authenticated call). | Local; the slot is freed by Edge Function `unregister-terminal` |
| `checkPin` | terminal | async | Verify a staff PIN for this terminal: { ok } with failures counted by the server or the device’s secure store. | RPC `check_pin` (hash compared on the server; offline behaviour is an open decision) |
| `clock` | terminal | async | Clock a staff member in or out; returns the attendance record. | `attendance` table (insert) |
| `uploadSale` | sales | async | Upload one issued sale document. Must be idempotent per (terminal, series, number); the server recomputes totals. | RPC `upload_sale` |
| `createQrIntent` | payments | async | A dynamic QR Ph payment intent from the gateway; confirmation arrives by webhook, never by the client. | Edge Function `create-qr-intent`; confirmation by the gateway's webhook (Edge Function `payment-webhook`) and Realtime |
| `createTickets` | kitchen | async | Send an order’s kitchen tickets (one per station); returns the saved tickets. | `kitchen_tickets` table (insert, several rows) |
| `updateTicket` | kitchen | async | Bump, recall or strike items on a kitchen ticket. | `kitchen_tickets` table (update) |
| `recordLoyalty` | customers | async | After a sale: points earned and used and the visit, applied atomically on the server. | RPC `record_loyalty` |
| `requestApproval` | approvals | handle | Ask an owner or manager to approve; returns { id, decision, cancel }. | `approvals` table (insert), then Realtime for the decision |
| `decideApproval` | approvals | async | Approve or decline a pending request. | RPC `decide_approval` |
| `connectPlatform` | integrations | async | Connect GrabFood or foodpanda (OAuth and webhooks live on the server). | Edge Function `connect-platform` |
| `acceptDelivery` | integrations | async | Accept a platform order with a preparation time. | Edge Function `accept-delivery` |
| `save` | records | async | Create or update one record in a collection; returns the saved record. | The collection's table (insert or update); see "Collections" |
| `saveSettings` | settings | async | Save one changed business setting ({ path, value }); the screen rolls back if this fails. | RPC `save_setting` |
| `resendInvite` | users | async | Send a staff member’s invitation again (email to set a password, or a text to set a PIN). | Edge Function `resend-invite` (uses the Auth admin API: server only) |
| `emailDocument` | bir | async | Email a reading or document as a PDF to the business’s accountant: { ok, to }. | Edge Function `email-document` |
| `remove` | records | async | Delete (or archive) one record in a collection. | The collection's table (archive, or delete where nothing refers to the row) |
| `adjustStock` | inventory | async | Post a stock adjustment (a signed quantity with a reason) as an append-only movement. | RPC `adjust_stock` |
| `receiveStock` | inventory | async | Post a received delivery (quantity and unit cost) against a purchase order or "No PO number". | RPC `receive_stock` |
| `createTransfer` | inventory | async | Request a stock transfer between branches. | RPC `create_transfer` |
| `advanceTransfer` | inventory | async | Move a transfer to its next step (approve, dispatch, receive) or reject it. | RPC `advance_transfer` |
| `stockLedger` | inventory | sync | The movements behind one item’s on-hand quantity at one branch, newest first: [label, detail, signed qty, icon, tone]. | Adapter state: movements fetched when Inventory opens (`stock_movements`), see open decisions |
| `submitCount` | inventory | async | Post a stock count; variances above the limit go to a manager first: { ok, needsApproval }. | RPC `submit_count` |
| `transfers` | inventory | sync | Stock transfers visible to this user, newest first. | Adapter state from bootstrap, kept current by Realtime (`transfers`) |
| `signOffShift` | shifts | async | A manager signs off a closed shift (counted cash, over or short, note). | RPC `sign_off_shift` |
| `lockPeriod` | accounting | async | Lock a month so its sales, expenses and stock can no longer change. | RPC `lock_period` |
| `auditTrail` | audit | sync | The audit trail (server-written, append-only), newest first. | Adapter state: `audit_log`, written only by database triggers and RPCs |
| `logAudit` | audit | sync | Note a change for the trail. The server writes the real entry; the demo keeps it locally. | No request with the real backend: the server writes the trail |
| `plan` | billing | sync | The business’s plan ID (content/plans.md), or null before the business has loaded. | Adapter state from bootstrap |
| `changePlan` | billing | async | Switch plans through the billing provider. | Edge Function `change-plan` |
| `billingMethod` | billing | sync | The masked payment method on file ({ kind, label, sub }), or null. | Adapter state from bootstrap (masked) |
| `invoices` | billing | sync | Subscription invoices from the billing provider, newest first. | Adapter state from bootstrap |
| `linkWallet` | billing | async | Link GCash, Maya or GoTyme for automatic payment (the provider returns a token). | Edge Function `link-wallet` |
| `addCard` | billing | async | Add a card on the provider’s hosted page; Cleo keeps only the token and the masked label. | Edge Function `add-card` (returns the provider's hosted page) |
| `subscription` | billing | sync | The current subscription ({ plan, terminals, branches, cycle, total, since }), or null. | Adapter state from bootstrap |
| `subscribe` | billing | async | Start or change the subscription; resolves after the first payment succeeds. | Edge Function `subscribe` |
| `salesRequest` | billing | sync | The pending "Talk to sales" request, or null. | Adapter state from bootstrap |
| `requestSalesCall` | billing | async | Ask the Aeso sales team to call about a quote-priced plan. | `sales_requests` table (insert) |
| `catalog.list` | catalog | sync | The products this business sells (archived ones left out of new sales). | Cleo.data.products (from bootstrap) |
| `catalog.on` | catalog | sync | Subscribe to catalog changes made elsewhere; returns an unsubscribe function. | Realtime on `products`, then `Cleo.data.load({ products })` |
| `catalog.save` | catalog | async | Change one product’s fields. | RPC `apply_catalog` |
| `catalog.add` | catalog | async | Add a product. | RPC `apply_catalog` |
| `catalog.saveMany` | catalog | async | Change several products at once. | RPC `apply_catalog` |
| `catalog.remove` | catalog | async | Archive products (invoices still name them). | RPC `apply_catalog` (archives) |
| `catalog.apply` | catalog | async | One Catalog › Edit session: new, changed and removed products in one call. | RPC `apply_catalog` (one transaction) |
| `items.list` | inventory | sync | Active stock items (archived ones left out). | Cleo.data.ingredients (from bootstrap) |
| `items.on` | inventory | sync | Subscribe to stock item changes made elsewhere; returns an unsubscribe function. | Realtime on `stock_items`, then `Cleo.data.load({ ingredients })` |
| `items.apply` | inventory | async | One Inventory › Edit session: new, changed and archived stock items in one call. | RPC `apply_items` (one transaction; quantities and cost only through the ledger) |
| `reports.owner` | reports | sync | The Owner Dashboard’s report model ({ kpis, trend, mix, ... }), or null while reports are not connected. | Adapter state: the report model, built from `reports.prepare` results |
| `reports.prepare` | reports | async | Load the figures a view needs ({ view, scope, period, gran }) before it renders. | RPCs or views per report (open decision) |

### Pagination and filtering

- **Today there is none.** Each collection loads whole in `bootstrap` (scoped by the user's branches), and the screens filter and search in memory.
- That holds for a small business. These collections grow without bound and need a decision before production:
  - `ejournal`, `audit_log` and `stock_movements` (`stockLedger`);
  - `attendance`, subscription `invoices` and `customers`.
- **Proposed:**
  - Use PostgREST ranges (`.range(from, to)`, the `Range` header with `Prefer: count=exact`) and filters (`?b=eq.<branch>&at=gte.<iso>`).
  - Load the recent window in `bootstrap` (for example, today's approvals and tickets, the last 30 days of audit entries), and older pages through `reports.prepare` or new paged operations.
  - **Adding paged operations changes the contract.** Add them to `contract.js` and both adapters, then update the screens. The screens have no paging controls today.

---

## D. Database and business logic that must live on the server

**The frontend's checks are for the person using it. Every rule below must be enforced by the server, with row-level security on every table. Never disable RLS.**

- **Identity and roles.**
  - Auth decides who someone is; a membership table decides their role in each branch.
  - Every read and write is scoped to the user's business and branches, and checked against `config.roles`.
- **Two-step sign-in.**
  - Owner and HQ accounts must reach MFA assurance level 2 before any business data is returned.
  - Backup codes must be stored hashed and used once.
- **Sales.**
  - Recompute line totals, VAT, statutory discounts (Senior Citizen, PWD, NAAC, solo parent, MOV) and promos from the uploaded document.
  - Reject mismatches.
  - Make uploads idempotent per (terminal, series, number).
- **BIR.**
  - The server issues each terminal's series at registration.
  - It detects gaps and duplicate numbers.
  - It stores the electronic journal append-only for at least 5 years.
  - It verifies the document seal (an HMAC instead of the demo's seal).
  - It builds readings, sales books and exports from the journal.
- **Payments.**
  - Intents are created server-side with the gateway's secret.
  - Payment confirmation comes only from a signed webhook.
  - The client never marks anything paid.
- **Subscriptions.**
  - Recompute the quotation (`licensing.js` is the reference).
  - Enforce plan limits: terminals per plan, and the modes a plan opens.
  - Cleo stores only provider tokens and masked labels.
- **Approvals.**
  - A decision is valid only from a role allowed by `config.limits`.
  - Voids, refunds, discounts above limits and exchanges must carry an approval ID that the server checks.
- **Stock.**
  - The ledger is append-only, with weighted average cost on receipt.
  - Counts above `limits.countVariance` and adjustments above `limits.adjustApproval` need approval.
  - On-hand quantity is derived from movements only.
- **Transfers.** Each step is checked by role, and stock moves at weighted average cost.
- **Locked periods.** Once a month is locked, its sales, expenses and stock can't change.
- **Audit trail.**
  - Database triggers and RPCs write it, append-only.
  - The client's `logAudit` is a no-op on the real backend.
- **Loyalty and charge accounts.** Points, visits and balances change atomically in `record_loyalty`, never by a client-side PATCH.
- **PINs and lockouts.**
  - PINs are hashed.
  - The lockout after 3 wrong PINs (5 minutes) is enforced server-side when online.
- **Invitations and staff.**
  - Invites use the Auth admin API, from an Edge Function only.
  - Deactivation revokes sessions.
- **Delivery platforms.**
  - OAuth and webhooks run on the server.
  - `deliveries` rows are inserted by webhooks.
- **Customer data.**
  - Consent dates are kept with the record.
  - Exports are allowed only for permitted roles (the frontend gates this; the server must too).
  - Follow the Data Privacy Act (Philippines).

---

## E. Integration instructions

1. **Preserve the implemented client integration.** The official SDK 2.118.0 is already in `Frontend/assets/vendor/` with its licence and version/integrity metadata.
   - `build.js` verifies the digest and loads the local SDK before application initialization. The SDK needs no CDN.
   - Do not replace it or change Auth storage/callback behavior without rerunning `sdk-build.test.js`, `supabase-auth.test.js`, and `auth-flow.test.js`.
2. **Configure.** Copy `.env.example` to `.env`, set the project URL and the publishable key, and run `node source/build.js`.
   - `ready()` confirms configuration and callback initialization; it is not proof that every POS operation or provider works.
   - For production, also set `CLEO_DEMO=off`.
3. **Extend `source/backend/supabase.js`.** Auth/onboarding is implemented; the remaining `pending('…')` operations are intentional.
   - Implement each remaining operation together with its authoritative server rule. Never remove a failure by returning local success.
   - Preserve the frontend contract; the demo remains an executable reference for business view shapes, while real OAuth is a redirect.
   - Report failures by throwing `new CleoError(code, message, { field, operation })`, or by resolving `{ ok: false, code, message }` for the result operations.
   - The adapter already maps Auth/PostgREST errors to section C codes; extend that mapper for new server mechanisms.
4. **`bootstrap`.**
   - `cleo_bootstrap()` already returns real tenant identity/branches/modules, own membership-derived user data, and empty operational collections.
   - Extend it with tenant-scoped catalog/settings/staff reads as those tables exist. Plan/subscription must stay null until authoritative billing records exist.
   - Populate the adapter's sync getters only from server-confirmed records.
5. **Realtime.**
   - After `bootstrap`, subscribe per business and branch.
   - On row changes, call `Cleo.db.hydrate(name, rows)` for collections, and `Cleo.data.load({ products })` or `({ ingredients })` for reference data (screens listen to `cleo:data`).
   - Emit the `Cleo.bus` events in section B.
6. **Session expiry.**
   - On a 401 or a failed refresh, dispatch `document.dispatchEvent(new CustomEvent('cleo:auth', { detail: { state: 'expired' } }))`.
   - The frontend signs out and returns to sign-in. `Cleo.attempt` already does this for `unauthorized`.
7. **Reports.**
   - Implement `reports.prepare({ view, scope, period, gran })` to fetch figures.
   - Implement `reports.owner()` to return the model (section B, module 6). Until it returns non-null, the dashboard keeps its "not connected" states.
8. **Test as you go.**
   - Run the full frontend test command in section A. `data-source.test.js` checks that each contract method exists; a method may intentionally remain pending.
   - Run the isolated PostgreSQL harness in `supabase/tests/` to verify migration behavior, tenant isolation, MFA rules and grants.
   - `supabase/tests/live-rollback-verification.sql` provides an optional database-owner check on the actual hosted PostgreSQL: synthetic fixtures roll back. Read its instructions and execute the entire transaction together.
   - Run the browser tests.
   - `tests/fixtures/empty-business.js` shows how a stand-in backend is inserted in the test browser only. Use the same approach to test screens against recorded responses before the server is complete.
   - Don't add test hooks to production code.
9. **Leave the demo alone.** It runs only with `?demo`, its storage is separate, and `CLEO_DEMO=off` removes it from the build.

---

## F. Outstanding work

### Open decisions (need the product owner or backend lead)

1. **The `uploadSale` payload.**
   - Today it sends a summary for the live feed. The full invoice (lines, VAT breakdown, discounts, tenders, seal) is the journal entry `Cleo.bir.issue` writes (`terminal.js`, `upload`/`saleBody`).
   - **Recommended:** upload the journal entry with the summary, so the server can recompute and verify it.
   - This changes what the Terminal sends, but not the screens.
2. **Backup codes and per-device sign-out.** Supabase Auth has neither; they need Edge Functions with hashed storage. The alternative is to remove those screens.
3. **The payment provider** for QR Ph, cards, GCash, Maya and GoTyme (intents, hosted card page, wallet linking, webhooks, subscription billing).
4. **Offline PIN checks.** Either keep server-issued PIN hashes on the device, or refuse PIN sign-in while offline.
5. **The device credential for registered terminals.** How a terminal authenticates without a person's session: scope, rotation, revocation.
6. **Pagination** for the growing collections (section C).
7. **Report computation.** Views, materialised summaries, or RPCs per view, and how fresh "Live" must be.
8. **Additional roles and branches.**
   - Current bootstrap emits the caller's membership role as `{ [branchId]: roleKey }`, or `{ all: roleKey }` for business-wide access. The onboarding RPC grants only the caller's owner membership.
   - Staff invitations/role assignment and additional branch creation need separately authorized server operations and UI. The current RPC creates only the first branch.
9. **Plan with no record.**
   - When the server returns no plan, Plan and billing says so.
   - Other screens still read the first plan's limits for their labels (`Cleo.plans.current()`). The server should always return a plan, or those labels need an empty state.
10. **Delivery platform** contracts (GrabFood, foodpanda) and their webhook formats.

### Recommended implementation order

1. Preserve and verify the implemented Auth/onboarding foundation; finish provider/email deployment checks and decide mandatory MFA enrollment policy.
2. Extend bootstrap with authoritative catalog/settings/staff data; implement `saveSettings`, scoped collection writes, and Realtime.
3. Catalog and stock items (`apply_catalog`, `apply_items`); the stock ledger operations; transfers; the audit trail triggers.
4. Terminal registration (device credential, BIR series); `checkPin`; `uploadSale` (after decision 1) with server recomputation; the journal store.
5. Approvals (`requestApproval` with Realtime, `decideApproval`); kitchen tickets; loyalty.
6. Payments and subscriptions (after decision 3); billing getters.
7. Reports (`reports.prepare`, `reports.owner`) and BIR exports.
8. Delivery platforms, document email, and invitations.

### Checklist

- [x] Vendor SDK 2.118.0 with licence/integrity metadata and load it before the app
- [x] Implement real Auth, account context, atomic onboarding, legal acceptance, and empty bootstrap
- [x] Apply the prefixed auth/onboarding migration to the configured project
- [x] Exercise local PostgreSQL owner-tenant isolation, anonymous denial, direct-write denial, revocation and enrolled-MFA rules
- [ ] `.env` for each environment; production built with `CLEO_DEMO=off`
- [ ] Remaining operational schema with RLS, tested with every supported staff role
- [ ] Every operation in `contract.js` implemented in `backend/supabase.js` (none left `pending`)
- [x] Auth/PostgREST error mapping to section C codes (extend for new operations)
- [ ] Realtime subscriptions and `Cleo.bus` events
- [ ] Server-side rules in section D, each with a test
- [ ] Decisions 1 to 10 settled and this guide updated
- [ ] End-to-end tests against a staging project (not production data)
