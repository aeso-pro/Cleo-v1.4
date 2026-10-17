# Frontend cleanup report

**Date:** 15 October 2026. **Scope:** `Frontend/`, the Terminal, Owner Dashboard and Back Office app, plus its build, tests and documentation.

**Checkpoint:** Git commit `f6adb71`, "Baseline before backend-readiness cleanup". It was made before any change, so every removed or rewritten file can be recovered from it.

**Decisions taken with the product owner before starting:**
- The demo is kept, but isolated behind a demo adapter that runs only on request.
- The real backend is Supabase.
- Every backend contract stays proposed.

**In one paragraph.** The app used to run on a built-in sample business, with a simulated server, everywhere. It now runs on one of two data sources:

- **The real backend.** This is the default. It talks only through `source/backend/supabase.js`, which is an integration skeleton until the backend exists.
- **The demo.** It runs only with `?demo`, its records are stored apart from real ones, and a production build can leave it out entirely.

On the real data source nothing is simulated. Screens show empty, loading, error and "not connected" states, and every write the server hasn't confirmed is refused rather than shown as done. The approved UI is unchanged: real-mode states reuse the existing components, and the demo looks and behaves as before (both verified in the browser).

---

## 1. Files removed, and why

| Removed | Why | Dependencies checked |
| --- | --- | --- |
| `Frontend/data/demo-data.json` | The whole sample dataset, published in a public folder | Nothing reads `data/*.json` at run time; the exporter no longer writes it |
| `design-review/original-source/` (9 files) | Copies of source files kept "because this workspace has no Git history". Git now holds them (baseline commit) | Referenced only in `design-review/README.md`, updated |
| `design-review/licensing-before/` (8 files) | Pre-edit snapshots from the licensing work; now in Git history | Referenced only in `licensing-integration.md`, updated |
| `design-review/landing-before-motion/` (2 files) | Pre-edit landing snapshots; now in Git history | No references |

The sample business itself was **moved, not deleted**: it now lives in `source/demo/` (see section 2).

## 2. Files retained and refactored

**New files**

| File | Role |
| --- | --- |
| `source/env.js` | Chooses the data source: real by default, demo with `?demo` for one tab, or by build setting. Reads the public Supabase settings the build embedded, and refuses secret and service-role keys |
| `source/backend/errors.js` | One error shape, `CleoError`, with eleven codes; `Cleo.attempt` for button requests; a page-wide handler so an unguarded failure resets spinners and says what happened |
| `source/backend/contract.js` | `Cleo.contract`: the 70 operations a data source implements (58 API, 7 catalog, 3 items, 2 reports), each marked *proposed* |
| `source/backend/supabase.js` | The Supabase adapter skeleton: client set-up, suggested calls in comments, and every operation reporting `not_configured` or `integration_pending` |
| `source/demo/config.js`, `fixtures.js`, `owner-model.js`, `server.js`, `journal.js` | The sample business's settings, its data, its synthetic analytics, its stand-in server and its BIR samples. All of it moved out of the shared files |
| `Frontend/.env.example` | Safe placeholders for the four build settings |
| `tests/data-source.test.js`, `tests/fixtures/empty-business.js` | New tests, and a test-only stand-in backend (section 6) |
| `Docs/BACKEND_INTEGRATION_GUIDE.md`, this report | Handoff documentation |

**Refactored files** (targeted changes; no screen was rewritten)

- **`api.js`** was the mock server. It is now the data layer: it binds every contract operation to the active adapter and normalises failures.
  - Shared records are kept in memory for the real backend; the device's BIR journal is the one exception.
  - Realtime runs on a separate channel per data source.
- **`data.js`** was the sample business. It is now `Cleo.data`, which starts empty and is filled in place by the data source.
- **`core.js`**:
  - Storage is namespaced (`cleo:demo:*` for the demo), with a one-time move of older records.
  - The default business settings are blank instead of the sample café's.
  - Business settings are saved through the adapter, and **rolled back with a message when refused**.
  - The connection status line on sign-in tells the truth.
  - The loading screen can run real start-up tasks.
- **`launcher.js`**:
  - Real start-up runs connect, check session, then load the business, all with real steps on one loading screen.
  - A failed load shows "We couldn't load your business", with Try again and Sign out.
  - Demo-only items (Reset demo data, the `/app` shortcut) are hidden in real use.
- **`owner.js`, `backoffice.js`, `terminal.js`, `bir.js`**: every sample seed and simulation now comes from the demo, or appears only in it (section 3). Every write goes through an adapter operation.
- **`build.js`**:
  - Uses the new file order, and embeds the public environment.
  - Refuses secret keys and invalid settings.
  - `CLEO_DEMO=off` builds without the demo.
- **Other files**:
  - `entry-route.js` and `build-landing.js` now handle `?demo`.
  - The landing's "Try the Terminal demo" link opens the demo explicitly; it is one of only two changed lines in `landing.html`.
  - `.htaccess` and `serve.js` never serve dotfiles.
  - `export-data.js` no longer exports the sample data.
  - `content/plans.md`: "Payment is simulated in this preview" moved to a `Demo notice:` line, shown only in the demo.
- **Tests and documentation**: `tests/e2e.js`, `tests/browser.js`, `tests/entry-routing.test.js`, `README.md`, `design-review/licensing-browser-check.cjs` and its docs. The earlier audit gained a one-line note pointing here.

## 3. Mock data and simulated functionality removed from normal operation

None of these appear on the real data source any more. Where the demo still needs them, they live in `source/demo/` and load only with `?demo`.

- **Sample business:** the branches, staff, products, stock, customers, promos, expenses, invoices and settings (Kapé Lumen, its TIN, its email addresses).
- **Simulated server:** every operation's fake latency and fake success. Sign-in, sign-up, codes, password reset, plan changes, payments, approvals, stock and transfers now go through the adapter, and are refused until the backend exists.
- **False success, now fixed** (each previously reported success without checking the result):
  - acceptance of the Terms;
  - password-reset and verification emails;
  - delivery platform connections;
  - terminal registration;
  - sending a reading "to Grace Tan";
  - settings saves;
  - the "Cleo Cloud is running normally" status.
- **Synthetic analytics:** the Owner Dashboard's KPIs, trends, heatmaps, P&L, staff figures and live feed.
  - Real use says "Sales, profit and stock figures appear once Cleo is connected".
  - The feed generator runs in the demo only.
  - The top bar shows the time of the last load instead of a permanent "Live".
- **Back Office samples:**
  - the stock ledger, transfers, the audit trail, overview tasks and sample counts;
  - Z-reading lists, X-readings and sales book rows;
  - customer purchase history;
  - the demo's supplier list;
  - fixed waits on exports;
  - sample "server" exports (the sales journal and daily summary are disabled in real use, with the reason shown).
- **Terminal simulations:**
  - the delivery order generator and the scale, scanner and camera simulators;
  - card terminal search and test charges;
  - QR payments that confirmed themselves (now a payment intent, plus a webhook event that only the server can send);
  - "Simulate going offline" and the sample cash count;
  - sample tables, parked orders, job orders, past invoices, hardware and drawer log;
  - terminal numbers shown as "in use" (they now come from terminal records).
- **BIR:** made-up TIN, MIN and PTU numbers.
  - An invoice can no longer be issued without the business TIN, the registered name, and the terminal's MIN and PTU. The error names what is missing.
  - The sample fiscal history is demo-only.
- **Start-up:** the timed loading sequence ("Checking this device", "Checking your session") that ran after the real checks. Real use shows only work that happens.
- **Demo branch IDs** used as defaults. Dialogs opened from "All branches" used to post receipts, adjustments, expenses and customers to the demo's `bgc` branch.

## 4. Integration interfaces prepared

- **One boundary.**
  - Screens call `Cleo.api`, `Cleo.db`, `Cleo.catalog`, `Cleo.items`, `Cleo.reports`, `Cleo.backend` and `Cleo.bus`.
  - `api.js` forwards every call to the active adapter.
  - The backend developer implements one file, `source/backend/supabase.js`.
- **A checked contract.** `backend/contract.js` lists every operation with its kind (async, sync or handle) and what the screens need. A unit test fails if either adapter is missing one or adds an unlisted one.
- **The reference implementation.** `demo/server.js` returns exactly the shapes the screens are tested against.
- **Defined failure handling.** Result operations resolve `{ ok: false, code, message }`, and the others reject with a `CleoError`. An expired session (`unauthorized`, or the `cleo:auth` event) signs out.
- **Start-up hooks:** `ready()`, `restoreSession()`, then `bootstrap()`, which returns `{ data, config, collections }`. Realtime hooks: `Cleo.db.hydrate()`, `Cleo.data.load()` and `Cleo.bus.emit()`.
- **Environment:** `.env.example`. The public settings are embedded at build time; secret keys are refused at build and run time.
- **Documentation:** `Docs/BACKEND_INTEGRATION_GUIDE.md` has the module map, all 70 operations with proposed Supabase mechanisms, error mapping, server-side rules, integration steps, open decisions and implementation order.

## 5. Dependencies added, removed or updated

- **None.** The project has no package manager and no runtime dependencies, and that is unchanged.
- **The Supabase client library (`@supabase/supabase-js`) was not added.** Choosing and vendoring a pinned version is left to the backend developer: guide, section E, step 1. Until then the adapter reports that the library is missing. Nothing was downloaded.
- **Tests:** the browser tests still use only Node and a local Edge or Chrome. The test browser driver gained request interception for the test fixture, using no packages.

## 6. Validation commands and results

All commands were run from `Frontend/` on Windows, with Node 24.20.0 and headless Microsoft Edge.

| Command | Result |
| --- | --- |
| `node source/build.js` | Passed. Built `index.html` (1,337 KB), the landing page, the legal pages and `sw.js`; no CSS class clashes; the landing's link and brand audits passed |
| `CLEO_DEMO=off node source/build.js` | Passed (1,258 KB, demo left out). A sweep of the built page for all 83 sample names, emails and IDs from the demo files found no sample branches, emails, TIN or suppliers. Some sample names remain in code that runs only in the demo, so they are never shown in real use: the shift-close task and its dialog, the sample shift rows, and the sample sales-book names (all in `backoffice.js`). The remaining "Kapé Lumen" strings are input placeholders ("Example: …") and demo-only copy. The default build was restored afterwards |
| Build refusals (in `data-source.test.js`) | A `sb_secret_` key, a `service_role` JWT, `CLEO_DATA_SOURCE=demo` with `CLEO_DEMO=off`, and an unknown source are each refused before anything is written |
| `node source/export-data.js` | Passed; three reference files written |
| `node --check` on every source, test and fixture file | 40 files, no syntax errors |
| `node --test tests/unit.test.js tests/entry-routing.test.js tests/data-source.test.js source/licensing.test.js` | **25 of 25 passed** |
| `node tests/e2e.js` (with `node source/serve.js` running) | **33 of 33 passed** on the final run |
| Lint and type checks | **Not run: the project has neither.** No linter or type checker was added, since adding tooling was out of scope |
| `design-review/licensing-browser-check.cjs` | **Not run:** it needs Playwright, which isn't installed here. Its URLs were updated for `?demo`. The plan page e2e tests cover similar ground |

**The 33 browser tests cover:**
- the sign-in screen, 16 audit regression tests and 2 plan page tests (demo);
- 3 smoke tests: Owner views, Back Office views, a Terminal sale that issues an invoice;
- the plans page;
- 4 real data source tests: honest "not connected" sign-in, sign-in refused, no sample data with writes refused, demo records kept apart;
- 6 empty-business tests, using a test-only stand-in backend inserted in the test browser:
  - every Owner and Back Office view opens without errors or sample data;
  - "No branches yet" on Terminal registration;
  - terminal numbers come from records, and a refused registration says so;
  - a failed business load shows Try again and Sign out;
  - a refused setting is changed back with a message.

**Other notes:**
- **One earlier full run** had two intermittent failures, `exchange` and "Plan page tabs and comparison". Both passed when run alone (twice), and in the three later full runs. Both use fixed waits, so a busy machine can make them flaky. The README now says so.
- **Visual check:** screenshots at 1440 × 960 and 390 × 844.
  - Real-mode sign-in with the "not connected" note.
  - The demo Terminal and Owner billing, unchanged.
  - Empty-business screens and the real loading step.
  - No console errors.
- **Start-up time,** to the first app screen: the demo took 4.0 s; a returning real user took 3.2 s (one loading screen). A first visit, where the session is restored by the server, took 5.1 s.
- **Nothing was run against a Supabase project.** No backend exists, so the end-to-end behaviour of any operation is untested.

## 7. Remaining limitations

- **No backend.** Every real operation fails with `not_configured` until `backend/supabase.js` is implemented and the client library is added.
- **Sale uploads send a summary.** The full invoice (lines, VAT, tenders, seal) is in the device's electronic journal but isn't uploaded. The payload is an open decision (guide, F1); `terminal.js` says so at the upload.
- **Plan with no record.** Plan and billing shows "No plan on record". Other screens' plan-limit labels still fall back to the first plan (guide, F9).
- **No pagination.** Collections load whole; the journal, audit trail, stock movements and customers need paging before large businesses use Cleo (guide, C).
- **Auth gaps.** Backup codes and per-device sign-out have no Supabase Auth equivalent (guide, F2). There is no screen for adding branches (guide, F8).
- **Client-side checks are not security.** Roles, limits and plan gates in the frontend guide the user only. The server rules in guide section D must be built and tested with RLS.
- **Tests.**
  - Real-mode tests cover the screens' empty and refusal states, not real data.
  - The Playwright licensing check wasn't run.
  - Several e2e tests rely on fixed waits.
- **Demo data, if shipped.** A default build still contains the demo, reachable with `?demo`. Production builds should use `CLEO_DEMO=off`.
- **Demo strings in a no-demo build.** Three demo-only code paths in `backoffice.js` still hold sample names inline: the shift-close task and dialog, the sample shift rows, and the sales-book names. They never run outside the demo. Moving them into `source/demo/` would remove them from a `CLEO_DEMO=off` build.

## 8. Backend integration readiness

| Readiness | Status |
| --- | --- |
| **Build readiness** | **Ready.** The frontend builds, its unit and browser tests pass, it runs on the real data source by default without simulating anything, and its integration boundary is defined, documented and enforced by tests |
| **Integration readiness** | **Ready to start.** One adapter file to implement against a 70-operation contract, with a reference implementation (the demo adapter), an environment template, and a guide with an implementation order. Ten decisions need answers first or along the way (guide, F) |
| **End-to-end functional readiness** | **Not ready, and not tested.** It depends on the Supabase backend, the server-side rules in guide section D, the payment provider, and tests against a staging project |
