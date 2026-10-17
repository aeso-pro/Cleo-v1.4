# Cleo POS front end

One web app with three modes: **Terminal**, **Owner Dashboard** and **Back Office**. It is built from the feature specification in `Docs/`, and the spec's "Front end" column says what is built.

Supabase authentication and account/business onboarding are implemented. The app runs on one of two data sources (`source/env.js`):

- **The real backend** (Supabase), the default. Email/password, email confirmation, Google/Facebook redirects, session restoration, enrolled TOTP verification, password recovery/change, business creation, legal acceptance, and a safe empty business bootstrap use real server operations. The current build targets `https://ntbkbvlsgymupjdpuvob.supabase.co` with its public publishable key. Provider availability still depends on that project's provider configuration.
- **The demo**, a sample business (Kapé Lumen) that runs only when switched on with `?demo`. Its records are stored apart from real ones.

The auth/onboarding migration has been applied to the target project. Its guard deliberately rejects a second application; use a new reviewed migration for future changes. See [`../supabase/README.md`](../supabase/README.md) for the schema and [`../Docs/AUTH_INTEGRATION.md`](../Docs/AUTH_INTEGRATION.md) for deployment, redirects, email templates, and tests. [`../Docs/BACKEND_INTEGRATION_GUIDE.md`](../Docs/BACKEND_INTEGRATION_GUIDE.md) maps the remaining integration work.

This is not a complete production POS backend. Catalog/settings writes, terminal registration and PIN credentials, sales uploads, stock, reports, billing, subscriptions, and payment APIs still return an unavailable-integration error. A new real business reaches plan selection, but cannot activate a paid plan through the unfinished payment APIs. The demo continues to simulate those flows.

## Folder

```
Frontend/
  .env.example            build settings: data source, demo on or off, Supabase URL and publishable key (copy to .env)
  landing.html            public landing page at the root URL (built)
  index.html              the whole app (built from source/, don't edit by hand)
  sw.js                   service worker for offline use (built)
  manifest.webmanifest    lets the app be installed
  legal/                  Privacy Policy and Terms and Conditions as public pages (built)
  content/plans.md        the plans (names, prices, limits, features); edit by hand, see "Plans" below
  assets/                 fonts, brand images and icon fonts; all local, see assets/README.md
  source/                 the code index.html is built from; edit here, then build
  data/                   JSON copies of the data the screens use, regenerated from source/
  tests/                  unit tests (node --test) and browser regression tests (headless Edge or Chrome)
```

## Run it

```bash
node source/serve.js
```

Open [http://localhost:5175/](http://localhost:5175/) for the landing page, or [http://localhost:5175/index.html](http://localhost:5175/index.html) for operations. Sign in, Get started and plan choices on the landing page open the operational app. Node 18 or later; no frontend package installation is required. The official Supabase SDK is already vendored locally. The server answers on this machine only; `HOST=0.0.0.0` permits local-network access, but authenticated deployments outside localhost require HTTPS and their own exact callback allowlist. It never serves dotfiles such as `.env`.

### Data sources

| Open | Runs on |
| --- | --- |
| http://localhost:5175/index.html | Real Supabase Auth and onboarding when public project settings and exact redirect URLs are configured; remaining POS/payment operations report unavailable integration |
| http://localhost:5175/?demo | The demo, for this browser tab (the landing page's "Try the Terminal demo" link opens it). `?demo=off` returns to the real backend |

Build settings come from `Frontend/.env` (copy `.env.example`) or the environment, then `node source/build.js`:

- `CLEO_DATA_SOURCE`: `supabase` (default) or `demo`.
- `CLEO_DEMO`: `on` (default) or `off`. `off` leaves the sample business out of `index.html` entirely; use it for production.
- `CLEO_SUPABASE_URL`, `CLEO_SUPABASE_PUBLISHABLE_KEY`: the project origin and its publishable (or legacy anon) key. Both are public by design; the build refuses a secret or service-role key. A newly copied `.env.example` is deliberately blank; obtain a publishable key from the intended project, never a secret.

The production host should serve `landing.html` as the directory's default document and retain explicit `index.html` for operations. `.htaccess` provides this on Apache. For other hosts, configure the equivalent root-document rule. An early guard in the generated index also redirects bare directory URLs to the landing on static hosts that still default to index. Old `/#/...` app bookmarks, subdirectory deployments and `?offline` / `?online` preview links retain their route and query. The install manifest continues to launch `index.html`. This does not deploy or configure an external host.

Run `node source/build.js` to rebuild the app, landing, legal pages and offline cache together. `node source/build-landing.js` rebuilds only the standalone landing plus the offline cache. Both entry pages have separate cache keys, so a visit to the public homepage cannot overwrite the cached app.

- Serve the app from a web server: the production host, or this local one.
  - The service worker that keeps the app working offline only runs over https. On localhost it is off, so a rebuild or a saved edit always shows; a worker left from an earlier visit is removed. To test offline use locally, open `http://localhost:5175/?offline` once (`?online` turns it off again).
  - While it runs, `serve.js` rebuilds both entry pages whenever `content/plans.md` is saved.
  - Some browsers also block fonts and icons when `index.html` is opened straight from disk.
- Demo sign-in (open with `?demo`; every way in needs the Terms and Privacy Policy box ticked):
  - Any email and password work. The demo team's owner and HQ manager emails, such as `maricel@kapelumen.ph`, ask for a 6-digit code. Any code passes except `000000`, which shows the error.
  - Backup code `AAAAA-AAAAA` shows the "already used" error.
  - **Continue with Google** and **Continue with Facebook** are simulated: sign-in returns the demo owner, and sign-up goes on to the business details.
  - **Create an account** takes a name, email and password, then a 6-digit email code (again, `000000` is the error example), then the business, then **Choose your plan** and the payment page. Signing up with one of the demo team's emails shows the "already has an account" error.
  - **Plans and payment** (simulated): Basic, Pro or Max goes to a payment page with terminal count, branch count (Max), monthly or annual billing and a card (the provider's page, simulated) or GCash, Maya or GoTyme Bank (any 11-digit 09 number; approval is simulated). After paying, Basic opens the Terminal straight away with no mode picker; Pro and Max open the picker with all three modes. Enterprise has **Talk to sales**: it sends a call request and stays on the plan page.
  - Terminal PINs accept any 4 digits except `0000`. Three wrong PINs in a row lock that person out for 5 minutes on this device, even after a reload.
  - Demo only: add `/app` to a route to skip sign-in, for example `?demo#/backoffice/app` or `?demo#/terminal/app`.
- **Reset demo data** at the bottom of the demo's mode picker clears the demo's records in this browser (`cleo:demo:*`); real records and the theme stay.

## Tests

From `Frontend/`, with Node 22 or later and no packages:

```bash
node --test tests/unit.test.js tests/entry-routing.test.js tests/data-source.test.js tests/supabase-auth.test.js tests/auth-flow.test.js tests/sdk-build.test.js source/licensing.test.js
```

- `unit.test.js`: `safety.js` (escaping, CSV formula guard, configuration paths) and the parsing of `content/plans.md`.
- `entry-routing.test.js`: which page a URL opens (landing or app, `?demo`, offline links) and the service worker's caching.
- `data-source.test.js`: the data-source switch, refusal of secret keys (at run time and in the build), storage namespacing and the one-time move of older demo records, both adapters implementing every operation in `backend/contract.js`, and unconnected operations failing rather than succeeding.
- `supabase-auth.test.js`, `auth-flow.test.js`: Auth calls, callback cleanup, session storage, authoritative role/context handling, MFA, recovery, legal acceptance, onboarding, and routing using test fixtures without real credentials or email.
- `sdk-build.test.js`: the pinned SDK, load order, offline assets, and build-time rejection of invalid settings or an altered SDK.
- `source/licensing.test.js`: plan quotations.

The PostgreSQL migration/RLS tests have a separate pinned development dependency; run the two commands in [`../supabase/README.md`](../supabase/README.md). Frontend fixture tests do not prove a complete hosted provider/email round trip. The demo browser suite's historical `real*` cases assume an unconfigured build; use a deliberately unconfigured test build for those cases.

```bash
node tests/e2e.js
```

Browser regression tests: start `node source/serve.js` first. They drive a headless Edge or Chrome (set `CLEO_BROWSER` to its path if it is not found) through sign-in, the three modes and a sale, and through each defect fixed in the audit (`../Docs/Frontend Audit and Supabase Readiness.md`), all in the demo. The historical `real*` tests target a deliberately unconfigured test build: no connection, no sample data, writes refused, and demo records kept apart. They are not a hosted Auth verification suite. The `empty*` tests open the three modes for a connected but empty business: `tests/fixtures/empty-business.js` stands in for the backend, inserted into the page in the test browser only. Name tests to run only those, for example `node tests/e2e.js sale pinlock`. `CLEO_URL` changes the address. A few tests wait fixed times, so a heavily loaded machine can make one fail; run it again on its own before investigating.

## Modes and routes

The intended route is loading, **sign-in**, business setup when needed, **choose a plan**, **pay**, and then a permitted mode. Plan/payment completion currently works in the demo; the real adapter does not invent a subscription or accept a simulated payment. A plan opens only its own modes (`Modes` in `content/plans.md`): on **Basic** every way in opens the Terminal, which never shows Switch mode.

- **Sign-in.** One verified sign-in covers every mode (`Cleo.session`). Restoration validates the Auth user and fetches the caller's server context; missing MFA, legal acceptance, or business setup returns to the appropriate step. "Keep me signed in on this device" selects persistent Auth storage; otherwise tokens use tab storage. People can also create an account here (`loginScreen` in `core.js`).
- **Picker.** Shows who is signed in, with Sign out. "Use this mode on this device" remembers the choice, so after sign-in the device skips the picker.
- **Registered Terminal.** The demo supports the PIN-only flow. The real adapter returns no registered device until a server-issued credential implementation exists, so a browser-held terminal label cannot bypass account authentication.
- **Links.** A link to a mode, such as `#/backoffice`, asks for sign-in first, then opens that mode.
- **Switch mode** is in each mode's account menu (Terminal: PIN screen and Settings). It reloads the page into the picker, so one mode's timers never run inside another.
- **Sign out**, from the picker or any mode, ends the session for every mode on the device and returns to sign-in.

| Route | Shows | Started by |
| --- | --- | --- |
| `#/` | Sign-in (when needed), then the mode picker (the Terminal on Basic) | `launcher.js` |
| `#/setup` | Create an account: account, email code, business | `Cleo.loginScreen()` |
| `#/plans`, `#/plans/<id>` | Choose a plan; the payment page for one plan (also used to switch plans or update how you pay) | `launcher.js` |
| `#/terminal` | Terminal: registration, PIN, sell screen and the rest | `Cleo.apps.terminal.start()` |
| `#/terminal/display` | Customer-facing display for a second screen | `Cleo.apps.terminal.display()` |
| `#/owner/<page>` | Owner Dashboard: `dashboard`, `branches`, `live`, `pnl`, `alerts`, `staff`, `inventory`, `billing`, `settings` | `Cleo.apps.owner.start()` |
| `#/backoffice/<page>` | Back Office: `overview`, `catalog`, `inventory`, `transfers`, `bir`, `audit`, `expenses`, `customers`, `users`, `devices`, `settings` | `Cleo.apps.backoffice.start()` |

Each setting has one home:

- business rules in Back Office › Settings;
- account, security, alerts and notifications in Owner Dashboard › Settings;
- device settings in Terminal › Settings, which also shows a read-only summary of the business rules.

On **Basic** there is no Owner Dashboard or Back Office, so Terminal › Settings holds the business rules (the same sections as Back Office › Settings), **Staff** (names, roles and PINs) and **Plan and billing**. Manager approvals use the manager PIN only.

## Build

```bash
node source/build.js
```

This writes `index.html`, `landing.html`, `sw.js`, and the public pages `legal/privacy.html` and `legal/terms.html`. Each app stylesheet and script is inlined under a banner comment such as `<!-- ===== Back Office: backoffice.js ===== -->`, so you can find any file inside the built page. The build also lists any CSS class defined in more than one stylesheet, which catches styles leaking between modes.

| File | What it holds |
| --- | --- |
| `core.js`, `core.css` | Shared runtime and design system: `Cleo` object, theme, settings document (`Cleo.config`), brand colour, routes, shared actions (`ACTIONS`), toasts, dialogs, drawers, sign-in, branch picker, settings UI |
| `env.js` | Which data source this page runs on (`Cleo.env`) and the public Supabase settings the build embedded; refuses secret keys |
| `data.js` | `Cleo.data`: the business's reference data (branches, staff, catalog, stock items, devices), empty until the data source loads it |
| `backend/errors.js` | `CleoError` and its codes, `Cleo.attempt` (a request run against a button), the page-wide handler for unguarded failures |
| `backend/contract.js` | `Cleo.contract`: every adapter operation, its kind, and the frontend requirements; implementations beyond auth/onboarding remain pending |
| `backend/supabase.js` | Real Auth, PKCE callback handling, server-verified account context, onboarding, legal acceptance and empty bootstrap; explicit unavailable errors for remaining business APIs |
| `demo/` | The demo only: `config.js` (sample settings), `fixtures.js` (the sample business), `owner-model.js` (synthetic analytics), `server.js` (the stand-in server), `journal.js` (sample BIR numbers and journal). Left out of a `CLEO_DEMO=off` build |
| `charts.js` | Charts in one style (solid marks, rounded data ends, a quiet grid): `columns` (trends and stacked parts), `donut` (part-to-whole), `bars` (ranked rows), `heatmap`, `waterfall` (the P&L bridge), `calendar` (daily activity) |
| `api.js` | The data layer: picks the data source and exposes `Cleo.api`, `db`, `bus`, `session`, `catalog`, `items`, `reports` and `backend` to the screens (see below) |
| `bir.js` | BIR compliance (`Cleo.bir`): invoice and document layouts (RR 7-2024, RMC 77-2024), statutory discount rules, each terminal's fiscal memory (document series, accumulated grand total, Z counter), the electronic journal and the X- and Z-reading figures. See `Docs/Cleo BIR Compliance Review.md` |
| `web-shell.css` | Sidebar and top bar shared by the Owner Dashboard and Back Office |
| `owner.js`, `owner.css` | Owner Dashboard |
| `backoffice.js`, `backoffice.css` | Back Office |
| `terminal.js`, `terminal.css` | Terminal and the customer-facing display |
| `setup.css` | Account setup: the sign-up steps beside their progress, the plan page and the payment page |
| `launcher.js`, `launcher.css` | Loading screen hand-off, choose a plan and pay, mode picker, routing by plan, service worker registration |
| `legal/privacy.md`, `legal/terms.md` | Privacy Policy and Terms and Conditions: the only copies to edit |
| `build.js`, `sw.template.js` | Build script and service worker template |
| `serve.js` | Local development server |
| `export-data.js` | Regenerates `data/` from the source |

Order in `index.html`:

- CSS: core, setup, web-shell, owner, backoffice, terminal, launcher.
- The local `assets/vendor/supabase-js-2.118.0.js` loads before the application script; the build verifies its recorded integrity digest.
- App JS: env, safety, demo/config, core, licensing, backend/errors, backend/contract, data, charts, demo/fixtures, demo/owner-model, demo/server, backend/supabase, api, bir, demo/journal, owner, backoffice, terminal, launcher (the `demo/` files only when the demo is included).

## Where the backend plugs in

Screens reach data through `source/api.js`, which forwards calls to the active adapter: `source/demo/server.js` in the demo, `source/backend/supabase.js` for real. The operations are listed in `source/backend/contract.js`. Auth/onboarding is implemented; use `../Docs/BACKEND_INTEGRATION_GUIDE.md` to extend the remaining APIs while preserving their result/error contracts and server-side authorization.

| Piece | What it does today | What replaces it |
| --- | --- | --- |
| `Cleo.api` | Auth, TOTP verification, password recovery/change, onboarding, legal acceptance and empty bootstrap are real. Remaining operational, billing/payment, backup-code, remote-device and report actions return explicit unavailable-integration errors or empty read models; the demo simulates them | Extend the existing adapter with authoritative RPC/Edge Functions and tenant-scoped reads; never replace a pending operation with client-side success |
| `Cleo.db` | Shared records, a synchronous cache. Demo: `localStorage` (`cleo:demo:db:<name>`), seeded from `demo/fixtures.js`. Real: memory only, filled by `Cleo.backend.load()`; only the device's electronic journal is kept (`cleo:db:ejournal`). Collections: `customers`, `promos`, `expenses`, `users`, `terminals`, `product-patches`, `item-patches`, `ejournal` (the electronic journal), plus daily-seeded `approvals`, `tickets`, `attendance`, `appointments`, `deliveries`. `on(name, fn)` fires when another tab changes one | GET/POST/PATCH/DELETE, plus your realtime channel calling the same callbacks |
| `Cleo.bus` | Realtime events between tabs (BroadcastChannel; the demo uses its own channel): `sale.created`, `approval.requested`, `approval.decided`, `ticket.created`, `ticket.bumped`, `display.update`, `display.pay`, `display.done`, `display.hello` | WebSocket or server-sent events, per business and branch |
| `Cleo.session` | Real UI account state is verified in memory from Auth plus the account-context RPC. Supabase owns the refresh/access token session in tab storage, or localStorage when remembered. Demo account state remains separate. `signOut()` forgets this device's credential and returns to sign-in | Preserve server verification and RLS when adding permissions; browser display roles never grant data access |
| `Cleo.catalog` | Products with Back Office changes applied: `products()`, `save()`, `add()`, `saveMany()`, `remove()`, `apply({ add, change, remove })` | `/products`; removing archives, because invoices reference products |
| `Cleo.items` | Stock items with Back Office changes applied: `list()`, `apply({ add, change, remove })`, `saveMany()` | `/items`; removing archives, and quantity and cost come only from the stock ledger |
| `Cleo.promos` | The promo engine the Terminal runs on every cart change | Keep it on the device, and re-run the same rules on the server when a sale uploads |
| `Cleo.bir` | Numbers and prints every BIR document on the terminal (invoice, void, return, reprint, payment receipt, bill, training receipt, X- and Z-reading), keeps each terminal's fiscal memory in `cleo:fiscal:<branch>-<terminal>` and writes every document to the `ejournal` collection | Keep numbering and the fiscal memory on the device, in non-volatile storage, so it works offline. Upload each journal entry with its sale; store the journal append-only for at least 5 years; build the Back Office readings, sales books and backend reports from it; replace the demo validation seal with one the server can verify (an HMAC). The checklist is in `Docs/Cleo BIR Compliance Review.md` |

The demo's generated data lives in `source/demo/` and loads only in the demo: the Owner Dashboard's KPIs, trends and live feed (`owner-model.js`); the stock ledger, transfers and audit trail (`server.js`); sample BIR readings and journal (`journal.js`); past invoices, tables and parked orders (`fixtures.js`). On the real data source those screens show empty states, or say that figures appear once reports are connected, until the backend supplies them.

### Comment tags

Every place that needs the backend, an asset, or care is tagged so it can be listed:

```bash
grep -n "BACKEND:" source/*.js
```

```bash
grep -n "ASSET:" source/*
```

```bash
grep -n "NOTE:" source/*.js
```

- `BACKEND:` server data or a call replaces a mock here; the comment says what goes in and out.
- `ASSET:` an image, icon or font, and where its file lives.
- `NOTE:` an important rule: VAT and statutory discount maths, invoice numbering, offline limits, permissions, removal rules.

Each source file starts with a header saying what it owns, its entry point, its storage keys and its integration points.

## Data

`data/` holds JSON copies of what the screens use. Regenerate them after changing the source:

```bash
node source/export-data.js
```

| File | What it is |
| --- | --- |
| `business-config.default.json` | The shared settings document: brand, business profile, modules, features, loyalty, order types and charges, tax, statutory discounts, payment methods, limits, alerts, notifications, inventory rules, regional, delivery platforms, roles. From `CONFIG_DEFAULT` in `core.js` |
| `plans.json` | The plans from `content/plans.md`, as the app reads them (`parsePlans` in `core.js`). A generated reference copy: the app never reads it, so edit `content/plans.md` instead |
| `terminal-device-settings.json` | Terminal hardware and layout defaults as a new terminal starts, with nothing connected yet (`HW_DEFAULT` in `terminal.js`): card terminal, cash drawer, printers, station routing, receipt, scanner, layout |
| `terminal-menu.json` | Hand-written example of the Terminal's menu layer (`cleo:t-menu`) |

## State saved in the browser

All keys start with `cleo:`. The demo keeps its records under `cleo:demo:` instead (for example `cleo:demo:plan`), so sample data never appears in real use. The theme, `dev-offline`, `landing-theme`, `landing-motion`, `quote-draft` and `data-source` keys belong to the device and are shared by both. `cleo:schema` records that records saved by builds before the data sources were moved into `cleo:demo:` once.

| Key | Holds | Written by |
| --- | --- | --- |
| `cleo:config` | The shared settings document | Back Office and Owner settings (`Cleo.config` in `core.js`); other tabs update live |
| `cleo:db:<name>` | Shared records (see `Cleo.db`) | `api.js` |
| `cleo:theme` | Light or dark for this device (first visit follows the system) | Theme button |
| `cleo:device-mode` | The mode this device opens in after sign-in | Mode picker ("Use this mode on this device") |
| `cleo:legal-accepted` | Who accepted which version of the Terms and Privacy Policy, when, and how they signed in | Sign-in and sign-up (`Cleo.api.acceptLegal`) |
| `cleo:t-device` | This tablet's terminal registration | Terminal registration (`Cleo.api.registerTerminal`) |
| `cleo:fiscal:<branch>-<terminal>` | The terminal's fiscal memory: last number of each document series, accumulated grand total, Z and reset counters, last Z-reading and last document time (for the clock check) | `Cleo.bir.issue` |
| `cleo:t-pinlock` | Wrong-PIN counts and 5-minute lockouts per staff member on this terminal | Terminal PIN screen |
| `cleo:t-training` | Training mode on this terminal | Terminal › Settings › Training mode (manager approval) |
| `cleo:t-hw` | Terminal hardware and layout settings | Terminal › Settings |
| `cleo:t-menu` | Terminal menu layout and counter edits | Terminal › Edit menu |
| `cleo:owner-dash` | Dashboard widget order, sizes and visibility | Owner Dashboard › Customize |
| `cleo:bo-cols` | Visible table columns and row density | Back Office › Columns |
| `cleo:plan` | The plan ID the business is on, shown in the plan tab of every mode (`basic`, `pro`, `max`, `enterprise`; older `starter` and `growth` read as `basic` and `pro`) | Owner Dashboard › Plan and billing |
| `cleo:billing-method` | How the subscription is paid: the card on file, or a linked GCash, Maya or GoTyme Bank account (masked) | The payment page, or Plan and billing › Change payment method |
| `cleo:subscription` | The plan, terminals, branches, billing cycle, total and quotation saved on the payment page | `Cleo.api.subscribe` |
| `cleo:onboarding` | A new account that hasn't paid yet: it goes back to the plan page until it does | `launcher.js` |
| `cleo:sales-request` | The last Talk to sales request (plan, number, note) | `Cleo.api.requestSalesCall` |
| `cleo:bus` | Fallback for `Cleo.bus` where BroadcastChannel is missing | `api.js` |
| `cleo:dev-offline` | Local preview only: run the service worker on localhost to test offline use (`?offline` sets it, `?online` clears it) | `launcher.js` |
| `cleo:demo-clock` | Demo only: the clock shift used outside café hours, kept so a reload never turns the clock back | `core.js` |
| `cleo:t-frame`, `cleo:t-pbar-hidden` | Browser preview frame around the Terminal; not part of the product | `terminal.js` |
| `cleo:session` | The signed-in account, in sessionStorage, or in localStorage with "Keep me signed in" | `Cleo.session` |
| `cleo:pick` (sessionStorage) | Open the picker once after Switch mode | `Cleo.route.switchTo` |
| `cleo:data-source` (sessionStorage) | This tab's data source after `?demo` or `?demo=off` | `env.js` |
| `cleo:supabase-auth` | The Supabase client's session, once the backend is connected | `backend/supabase.js` |

## Plans

The plans (Basic, Pro, Max and custom Enterprise) are editable in `content/plans.md`. The original proposal is preserved in `content/licensing-proposal.md`.

- **First terminal in each branch:** Basic PHP 1,499 monthly / 14,990 annually; Pro PHP 2,999 / 29,990; Max PHP 4,999 / 49,990.
- **Additional terminals in the same branch:** PHP 499 / 999 / 1,499 monthly respectively. As confirmed by the user, annual extra-terminal licenses cost twelve monthly fees, paid upfront together with the first-terminal annual price. Max with two terminals in one branch costs PHP 6,498 monthly or PHP 67,978 annually.
- **Branch scope:** Basic and Pro quotations cover one branch; Max supports multiple branches. Each branch pays its own first-terminal rate. Basic terminals operate independently; shared multi-terminal operation is a proposed Pro inclusion. Previous 5/20 terminal caps are removed because the new proposal does not specify them. The calculator accepts up to 9,999 devices as an input bound, not a commercial limit.
- **Data fields:** Price, Annual, Additional, Annual additional, Terminals, Branches, Modes, Tagline, Tab and Badge. `Cleo.licensing.quote` is shared by the calculator, checkout, API mock and billing summaries; do not multiply the first-terminal price by device count.
- **Quotation and comparison:** `#/plans` includes copyable quotations, all 36 proposed inclusions and licensing exclusions. Enterprise remains Talk to sales and stays on the plan page after a simulated request. Annual discounts apply to each branch's first terminal only.
- **Implementation status:** the matrix records proposed commercial entitlements; it does not implement missing forecasting, cloud backup, external integrations or support services. Existing mode routing remains enforced in the front end; full feature authorization must be implemented server-side. Payment is simulated. Existing VAT-inclusive preview totals remain; validate final tax treatment and BIR requirements before sale. Cloud retention, storage, backup frequency and reactivation rules remain undecided.
- **Tests:** `node --test tests/unit.test.js source/licensing.test.js`. Browser checks are in `design-review/licensing-browser-check.cjs` (needs Playwright; it opens the demo with `?demo`) and use an isolated context plus temporary local HTTP server.
- **Modes.** `Modes: Terminal` makes a plan Terminal only (Basic): it opens straight into the Terminal, hides Switch mode and moves staff, business rules, plan and billing into Terminal › Settings. Leave it out for all three modes.
- **Plan page and logos.** `#/plans` shows every plan with its logo (`Cleo.planLogo()`: a tree drawn like a circuit trace, as a plain ink line drawing with no colour, frame or motion: each trunk starting at its first branch: a two-branch sapling for `Tab: plain`, a four-branch tree for `animated`, and for `premium` a fuller tree whose trunk splits into two short forked limbs, with two more branches high on the trunk). The plan cards here and in Owner Dashboard › Plan and billing carry no plan colours or effects; the current plan has a neutral outline, what it opens and what it includes. Each card (`Cleo.planCard()`, shared with Owner Dashboard › Plan and billing) shows the logo, name and tagline (`Tagline` in `content/plans.md`), price, a status box when needed, the action, then "Everything in <plan below>, plus:" and the plan's Includes list. A plan without a price shows **Talk to sales**. Choosing a plan opens its payment page (`#/plans/<id>`).
- **What it changes.** The plan and payment pages, Owner Dashboard › Plan and billing (plan cards, prices, the monthly total, the notice at the top), the plan tab in every mode, the plan suggested at sign-up, and plan names elsewhere (Back Office custom roles and devices, Terminal registration).
- **How the app reads it.** The build embeds a copy in `index.html` (`#cleo-plans`), so the plans are there offline and when the file is opened from disk. When the app is served, it also reads `content/plans.md` at start, whenever the page comes back into view, and every 2 seconds on localhost, so a saved edit shows without a reload (screens redraw through `Cleo.plans.onChange`). `serve.js` rebuilds `index.html` on save so the built-in copy matches; with another host, run the build. The service worker fetches `.md` files network first.
- **IDs.** Each plan has an ID that stays the same when it is renamed; it is what `cleo:plan` and the server store. What a plan unlocks is the server's decision; the file only sets what people read.
- **Plan tab.** `Cleo.planTab()` in `core.js`, at the foot of the Owner Dashboard and Back Office sidebars and the Terminal rail (there, the Cleo mark alone, with the plan name in its label). In the Owner Dashboard it opens Plan and billing; in the Back Office it switches to it; on the Terminal it only shows the plan. `Tab: plain` shows the name and the Cleo mark (Basic). `Tab: animated` adds a light around the edge, a sheen and a floating mark (Pro). `Tab: premium` is a step up from that with a hint of gold: a second light, in gold, and a gold-tinted edge (Enterprise). The tab is built like the other sidebar cards; glows show in dark mode only. Reduced motion stills them all.
- **Payment method.** The payment page and Plan and billing › Change payment method offer a card (on the payment provider's own page) or GCash, Maya or GoTyme Bank, linked for automatic payment by approving in the wallet's app (`Cleo.api.linkWallet`, BACKEND note in `api.js`). Only a masked label is kept. The wallet marks are text placeholders (ASSET) until the official logos are added.

## Terms and Conditions, Privacy Policy

Aeso wrote both for Cleo: plain-language documents based on the Data Privacy Act of 2012 and the way Cleo actually handles data.

- **Source.** `source/legal/terms.md` and `source/legal/privacy.md` are the only copies to edit.
- **Build.** The build embeds them in `index.html` for the in-app reader (`Cleo.legalDoc()`, links with `data-legal`). It also writes `legal/terms.html` and `legal/privacy.html`, which are public pages that work without the app. Google and Facebook sign-in need that public privacy policy URL.
- **Where they appear.** The agreement checkbox on sign-in and sign-up, the mode picker footer, Owner Dashboard › Account and security (with the version and the date you agreed), and Terminal › Settings › About.
- **Versions.** Each document carries a version on its "Effective … · Version …" line. Raising it should ask everyone to accept again; the server must store each acceptance (`acceptLegal`).
- **Review copies.** `Docs/` has copies with a checklist of what to confirm before publishing.

## Offline

- **Local assets.** Phosphor icons 2.1.1 (regular, fill, bold), Helvetica Neue and the brand images are in `assets/`; nothing loads from the internet. QR codes, barcodes, charts and avatars are drawn in code.
- **Service worker.** Over https, `sw.js` caches `landing.html`, `index.html`, `content/plans.md`, the legal pages and every file in `assets/` on the first visit, then serves them with no connection. Root responses cannot overwrite either explicit page. Both builders give the cache a new name when its files or worker template change.
- **Install.** `manifest.webmanifest` lets the app be installed, for example on the Android tablet.

## Design notes for the next developer

- **Same name and icon everywhere.** Shared actions (Switch mode, Sign out, Edit, Remove, Recall, the theme button…) take their label and icon from `ACTIONS` in `core.js` via `Cleo.actIcon()` and `Cleo.actLabel()`. Add new shared actions there.
- **Themes.** Colours are tokens on `:root` in `core.css`. Both themes use glass: translucent surfaces with a bright top edge, a fine rim and soft shadows, frosting what is behind them. In light mode a few faint, still lights sit behind the glass (`.ambient b`) so it has something to frost; there are no glows, grain or moving light. Reduced transparency and increased contrast turn the glass solid. The client's brand colour from Back Office › Brand replaces the accent at runtime (`applyBrand` in `core.js`).
- **Charts and progress.** Charts share one look: solid marks with 4px rounded data ends, a 2px gap where marks touch, three hairline gridlines, one tooltip, and a table view on the dashboards (`charts.js`). Sparklines (`sparkSVG`) are thin bars. Progress bars use `.meter` (set `--r` from 0 to 1 and optionally `--c`); the fill is clipped, not resized, so it glides without relayout. Marks grow in once per draw; redraws after a resize are instant. Sequential colour (heatmap, activity calendar) is `--seq`.
- **Background.** `ambient` in `core.js` draws a grid of rounded boxes lit by drifting light on a canvas, in dark mode only (light mode keeps its still, faint lights), and only behind the loading screen (`boot`, with ripples from the Cleo mark at every step) and the sign-in screens (the web sign-in and the Terminal PIN screen; a screen opts in with `data-amb="login"`, which `show()` reads). Everywhere else the grid fades out and dark mode keeps soft drifting colour (`.ambient b` in `core.css`). It runs at the display frame rate only while visible, pauses in hidden tabs and draws one still frame when motion is reduced. The levels are in `LEVEL`.
- **Motion.** Screens and dialogs move with opacity and transform only (no blur on large surfaces), with `--ease-out` for entrances. Keep new animations to transform, opacity or clip-path.
- **Edit modes.** Back Office › Catalog and Back Office › Inventory have an Edit button that turns the table into a form. Rows can be changed, added and removed, then saved at once. The `edits` helpers are near the top of the catalog section in `backoffice.js`.
- **Activity (Owner dashboard).** A dashboard section modelled on a usage summary: All, 30d and 7d periods, six stat tiles, a 26-week calendar of daily net sales, a Branches (or Terminals) tab, and a light comparison line. Data comes from `Cleo.reports.owner().activity` (the demo builds it in `demo/owner-model.js`; the real backend's report model is described in the integration guide). New dashboard sections join saved layouts after the section they follow by default.

## Requirements and notes

- **Browser:** a Chromium-based browser, which matches the Android WebView a Terminal app would use. The liquid-glass refraction is Chromium-only; other browsers get frosted glass.
- **Fonts:** Helvetica Neue is a commercial font. Shipping it in a web app or APK needs a web or app embedding licence.
- **Time:** times and currency follow Asia/Manila and PHP. Outside 9 AM to 9 PM Manila time, the demo clock shows 3:42 PM so the sales screens have data.

## Not built yet

The "Front end" column in `Docs/Cleo POS — Feature Specification (Developer Draft).md` marks each feature Built, Built · simulated, Partial, Not built or Server. Not built yet:

- **Retail:** price tiers and lot numbers at sale.
- **Services:** prepaid packages and commissions.
- **Payments:** settlement reconciliation and gift cards.
- **Inventory:** production, purchase orders, counts on the Terminal.
- **Owner Dashboard:** sales targets, product mix analysis, a custom date range.
- **Multi-branch:** branch setup templates and a central warehouse.
- **Accounting and customers:** accounting software sync and SMS or email promos.
- **Platform:** a one-click export of all data, the open API, and the Filipino interface.

