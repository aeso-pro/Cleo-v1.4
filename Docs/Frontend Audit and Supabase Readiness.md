# Cleo frontend audit and Supabase readiness

**Date:** 13 October 2026

> **Later change (15 October 2026):** the data layer has changed since this audit. The demo now runs only with `?demo`, and the screens reach data through adapters (`source/backend/supabase.js` for real, `source/demo/` for the demo). Where this audit describes `data.js` as demo data or `api.js` as the mock server, see `BACKEND_INTEGRATION_GUIDE.md` and `FRONTEND_CLEANUP_REPORT.md`. The findings and the draft schema below still apply.

**Scope:** `Frontend/`. This is the vanilla JavaScript and CSS app that `source/build.js` turns into `index.html`. It runs the Terminal, the Owner Dashboard and the Back Office on one page.

**Method:**
- Every script was read in full.
- The stylesheets were scanned for specific issues.
- Defects were reproduced in headless Microsoft Edge, driven over the DevTools protocol.
- Contrast was calculated from the stylesheet tokens.
- Unit tests ran in Node.
- Each fix was checked again with the same scenario that first showed the defect.

**How to read this report:**
- **Issue IDs.** The prefix gives the category: SEC (security), FUN (functional), DATA (data integrity), PERF (performance), A11Y (accessibility), MAINT (maintainability), TOOL (tooling), ARCH (architecture before production).
- **Severity.** Each issue is rated by its effect once real customers and a real backend are involved.
- **Status labels.** "Confirmed" means the defect was reproduced or follows directly from the code. "Risk" means it depends on how the backend is built.

---

## 1. Executive summary

**Frontend health: good, with specific fixes made.**

The app is well organised:
- One shared runtime, `core.js`, covers the theme, configuration, UI kit, routes, sign-in and settings.
- A single mock-backend boundary, `api.js`, has every integration point marked `BACKEND:`.
- BIR document logic is centralised in `bir.js`.
- The build is documented.
- Most output goes through `esc()`.
- Configuration paths block prototype pollution, and CSV exports defuse spreadsheet formulas.
- The design system is consistent across the three modes. It has focus rings, plus fallbacks for reduced motion, reduced transparency and high contrast.

**Issues found and fixed.** The audit confirmed 27 defects, and all 27 are fixed and re-verified. The most serious were:
- **Four stored cross-site scripting (XSS) sinks** (SEC-01 to SEC-04). Custom role names, custom menu categories, customer discount ID numbers and the business trade name were inserted into pages as HTML. Each one was shown to run script before the fix and not after it.
- **A PIN lockout that did not exist** (SEC-07). The PIN screen said "tries left before a 5-minute lock", but nothing locked.
- **An exchange that skipped the refund approval** (FUN-01).
- **Terminal registration jammed after a cancel** (FUN-02). Cancelling the terminal-number dialog left the branch cards unclickable.
- **Records with made-up data.** Consent dates were fixed at 5 October 2026, received deliveries got invented PO numbers, and duplicate SKUs in a CSV import were added twice.
- **Light-mode text and status colours below WCAG AA contrast.**

**Supabase readiness: not ready yet.** The UI and the single adapter boundary are a sound starting point, but these are missing:
- There is no Supabase client, environment configuration or data-access layer yet.
- Every permission is checked only in the browser.
- Much business data exists only in memory or `localStorage`: inventory movements, transfers, the audit trail and fiscal counters.
- Payments, sale sync and terminal hardware are simulated with timers.
- Several BIR screens and exports mix sample data with real journal entries.

**Verdict.** The frontend is **ready, with conditions, to begin Supabase integration**, and **not ready for production**. Section 12 sets out the conditions.

---

## 2. Audit coverage

| File or folder | Lines | Method | Notes |
| --- | ---: | --- | --- |
| `source/safety.js` | 38 | Read in full | Escaping, CSV and config-path helpers. No defects. Now unit tested. |
| `source/api.js` | 360 | Read in full | The mock backend. Its gaps are listed as ARCH items. |
| `source/core.js` | 2,089 | Read in full | Runtime, UI kit, sign-in, setup, plans and the settings UI. |
| `source/data.js` | 264 | Read in full | Synthetic demo data. Data-contract findings DATA-C1 to C5. |
| `source/charts.js` | 304 | Read in full | Charts, with guards and escaping throughout. |
| `source/bir.js` | 358 | Read in full | Invoices, fiscal memory and the electronic journal. |
| `source/launcher.js` | 417 | Read in full | Routing, the plan pages and payment. |
| `source/owner.js` | 1,313 | Read in full | Owner Dashboard. |
| `source/backoffice.js` | 2,162 | Read in full | Back Office. |
| `source/terminal.js` | 3,237 | Read in full | Terminal and the customer display. |
| `source/build.js`, `serve.js`, `sw.template.js`, `export-data.js` | 403 | Read in full | Build, dev server, offline cache and data export. |
| `source/*.css` (7 files) | 2,623 | Targeted scan | Searched for focus handling, outline removal, motion, transparency, contrast and `!important`. Contrast was calculated from the tokens and layouts were checked in screenshots. **Not read line by line.** |
| `content/plans.md` | | Read | Parsed by a unit test. |
| `manifest.webmanifest`, `data/*.json` | | Read or regenerated | `data/*.json` is regenerated by `export-data.js`. |
| `index.html`, `sw.js`, `legal/*.html` | | Excluded | Generated by the build. They were rebuilt and `sw.js` passes a syntax check. |
| `source/legal/*.md` | | Not reviewed | Legal text. The converter that renders it in `build.js` was reviewed. |
| `design-review/original-source/*` | | Excluded | Backup copies from before an earlier refinement. Not shipped. |
| `assets/` | | Excluded | Vendored Phosphor icons, fonts and images. |

All 14 scripts in `source/` (10,945 lines after the fixes), plus the generated `sw.js`, pass `node --check`. Both before and after the fixes, a scan found no hardcoded secrets, no `eval` or `new Function`, and no external network calls.

---

## 3. Architecture assessment

**Current structure:**
- The app is a set of IIFE modules on a global `Cleo` object.
- `build.js` concatenates them in a fixed order into one page. It inlines the CSS and JavaScript and embeds the plans and legal documents.
- Data flows through four pieces:
  - `Cleo.api` holds the actions.
  - `Cleo.db` is a collection store in `localStorage`.
  - `Cleo.bus` is a `BroadcastChannel` that carries events between tabs.
  - `Cleo.config` holds the business settings and blocks prototype keys.

**Strengths:**
- **One adapter boundary.** Every backend touchpoint is an `api.*` function or a `Cleo.db` collection, and each is marked `BACKEND:`.
- **Domain rules kept in one place.** Tax and statutory discounts live in `totals()`, BIR documents in `bir.js`, and permissions in `Cleo.config` roles.
- **A shared settings schema.** Business settings use one schema-driven UI, with validation hooks, across all three modes.
- **Async UI already in place.** Buttons have loading, done and error states (`btnState`), and many lists have empty states.
- **Cross-tab updates already wired.** Approvals, tickets, deliveries and the catalog all update across tabs, which maps directly onto Supabase Realtime.

**Weaknesses and integration gaps:**
- **Authorization lives only in the browser** (ARCH-01). Roles come from client-held configuration, and the Back Office "Preview as" switcher changes the role locally.
- **Records outside the adapter** (ARCH-05). Inventory adjustments, deliveries received, transfers, the audit trail, X and Z sign-offs and period locks change in-memory arrays (`Demo.ingredients`, `TRANSFERS`, `AUDIT`) instead of calling `Cleo.api`.
- **Analytics are synthetic** (ARCH-11). The owner analytics are generated from seeded random numbers (`kpis`, `trend`, `heat`) and need report endpoints.
- **Simulated integrations.** These run on timers: QR Ph, the card terminal, SMS and email receipts, wallet linking, printers and scanners.
- **The demo clock** (ARCH-08). `Cleo.now()` moves the clock into business hours for the demo, with no flag to turn it off.
- **Async calls have no error handling** (ARCH-10). About 30 awaited calls in the three modes don't catch errors, because the mock never fails. The Owner Dashboard's approvals already use the right pattern (`ownerRequest`).
- **No types, linter or package manager.** The data contracts exist only as object literals in `data.js`.

---

## 4. UI/UX and accessibility findings

| ID | Finding | Severity | Status |
| --- | --- | --- | --- |
| A11Y-01 | Light theme: caption text (`--ink-3`) measured 4.34:1 on the page background and 4.48:1 on white. Success green measured 3.98:1. Status badge text on its tinted fill measured about 3.9 to 4.3:1. All are below the 4.5:1 that WCAG AA requires. | Medium | Fixed: every text token now measures 4.5:1 or more (section 9). |
| A11Y-02 | Checkbox borders use `--ink-4`, at 2.3:1 in light and 2.9:1 in dark. Controls need 3:1. | Low | Fixed: the border now uses `--ink-3`. |
| A11Y-03 | In Owner › Plan and billing, the invoice download buttons have only an icon, so they have no accessible name. | Low | Fixed: each button has an `aria-label` that names its invoice. |
| FUN-02 | After the terminal-number dialog is cancelled, the branch cards ignore clicks until the page is reloaded. | Medium | Fixed and verified in the browser. |
| FUN-03 | Toast titles show HTML entities for names with apostrophes or ampersands, such as "Ma&amp;#39;am". | Low | Fixed and verified in the browser. |
| FUN-05 | The audit trail shows `&quot;` in entries for changed settings. | Low | Fixed and verified in the browser. |
| UX-01 | The popover menus (scope, account, role) use `role="menu"` but have no arrow-key navigation, and focus stays on the trigger. | Low | Open (section 10). |
| UX-02 | Keystrokes typed during the 0.5 s shake after a wrong PIN are dropped. | Low | Open. |
| UX-03 | The Back Office search box says "Search products, SKUs, invoices" but only searches the catalog. When a category filter is empty, the catalog says `No products match ""`. | Low | Open. |
| UX-04 | Demo content appears in production screens. Examples: "Fill a sample count", a prefilled sales phone number, a "Where you're signed in" device list, and "Renews Nov 1, 2026". | Medium (production) | Open (ARCH-09). |

**Verified as working:**
- **Focus.** `:focus-visible` gives a 2px ring everywhere. Dialogs trap focus and return it on close. Escape closes overlays.
- **Motion and transparency.** Reduced-motion and reduced-transparency fallbacks exist. They were checked in the source, not under the operating-system settings.
- **Phone layout.** In 390 × 844 phone emulation, the Owner Dashboard, Plan and billing, and the plan page have no horizontal overflow. The only elements past the edge are the decorative ambient lights, which are clipped.
- **Desktop layout.** Light-theme screenshots at 1440 × 960 of Owner › Alerts, Back Office › Customers and Owner › Plan and billing look consistent after the colour change.

---

## 5. Code review findings: issue register

### 5.1 Confirmed defects, all fixed and verified

The browser scenarios named below are in `Frontend/tests/e2e.js` and can be run again.

**SEC-01: Custom role names were rendered as HTML (stored XSS)**
- **Severity / category:** High / Security
- **Where:** `backoffice.js`, `rolesPane()` (role header and checkbox labels) and `userDrawer()` (role options)
- **Evidence:** Before the fix, a role named `<img src=x onerror=…>` ran script when the roles table was drawn (`BO-7 … {"executed":true}`).
- **Root cause:** `${l}` was interpolated without `esc()`.
- **Impact:** Role names are shared business configuration. Once synced, script typed by one admin would run in every admin's browser.
- **Fix:** Escape the role name in all three places.
- **Verification:** PASS. The script did not run, and the header shows the text literally.

**SEC-02: Custom menu category names were rendered as HTML (stored XSS)**
- **Severity / category:** High / Security
- **Where:** `terminal.js`. The category chips in `sellView()`, and in `paneMenu()` the start-tab option, category row labels and filter chips.
- **Evidence:** Before the fix, a category added in the item sheet ran script on the sell screen (`TERM-2 … {"executed":true}`).
- **Root cause:** Raw `${l}`.
- **Impact:** The category is saved in `cleo:t-menu`, and the design syncs it to the Back Office catalog.
- **Fix:** `esc()` on all four sinks.
- **Verification:** PASS.

**SEC-03: Customer discount ID numbers and mobiles were rendered raw on the Terminal (stored XSS across modes)**
- **Severity / category:** High / Security
- **Where:** `terminal.js`, the saved profiles in `scSheet()` and the customer lookup in `customerSheet()`.
- **Evidence:** The Back Office customer drawer accepts any text as a discount ID, and the Terminal inserted `${c.sc.id}` as HTML.
- **Root cause:** Missing `esc()`.
- **Impact:** Text typed in the Back Office could run script on every Terminal.
- **Fix:** Escape the ID, mobile, tier and type.
- **Verification:** PASS, scenario `TERM-3`. A customer seeded with an `<img onerror>` ID shows it as text, and the script does not run.

**SEC-04: The trade name was rendered as HTML on the customer display**
- **Severity / category:** Medium / Security
- **Where:** `terminal.js`, `customerDisplay()` headline
- **Evidence:** Before the fix: `TERM-4 … {"executed":true}`.
- **Root cause:** `Welcome to ${biz}` was not escaped.
- **Impact:** A script in the trade name ran on the screen customers face. Only someone with business-settings rights can set it.
- **Fix:** `esc(biz)`.
- **Verification:** PASS.

**SEC-05: Staff initials and colours were interpolated raw**
- **Severity / category:** Low / Security
- **Where:** `terminal.js`, the PIN screen, status bar, manager approval and bookings grid.
- **Root cause:** Initials come from names typed on the Terminal's Staff screen and were inserted without escaping.
- **Impact:** A name could break the markup. Two characters can't run script.
- **Fix:** `esc()` on the initials and colours.
- **Verification:** Code review. All Terminal browser scenarios pass.

**SEC-06: Invoice fields were not escaped in Owner › Plan and billing**
- **Severity / category:** Low / Security
- **Where:** `owner.js`, `billingView()` invoice table and invoice document
- **Root cause:** `inv.id`, `date`, `method`, `status` and the plan name were inserted raw. They are static today but will come from the billing provider.
- **Fix:** Escape each field. A11Y-03 was fixed in the same place.
- **Verification:** Code review. The Owner smoke run passes.

**SEC-07: The PIN lockout was promised but not enforced**
- **Severity / category:** High / Security
- **Where:** `terminal.js`, `pinScreen()`
- **Evidence:** After three wrong PINs, the message reads "Too many tries", but the next PIN is still checked and signs the person in. The baseline run showed `pinScreenStillOpen:false`.
- **Root cause:** `fails` was a local counter, the screen never checked it, and it reset on every redraw.
- **Impact:** The demo accepts any 4 digits except 0000 (`api.checkPin`), so guessing was unlimited.
- **Fix:**
  - Count failures per staff member on the device, in `cleo:t-pinlock`.
  - Lock that person for 5 minutes after three wrong PINs, and show the remaining time.
  - Keep the lock across reloads.
  - Clear it after a correct PIN.
- **Limitation:** This is a client-side measure only. Server enforcement remains ARCH-03.
- **Verification:** PASS, scenarios `TERM-1 PIN lockout` and `TERM-1 lock survives reload`.

**SEC-08: Customer and expense exports weren't limited to roles with Export**
- **Severity / category:** Medium / Security (privacy)
- **Where:** `backoffice.js`, `customersView()` and `expensesView()`
- **Root cause:** Every other export uses `lockedBtn('export', …)`, but these two used plain buttons.
- **Impact:** A role without Export, such as Inventory Clerk, could download customers' names, mobiles and emails.
- **Fix:** Use `lockedBtn('export')` for both.
- **Verification:** PASS. As Inventory Clerk, the customer Export button is disabled. This is a UI rule: the server still has to enforce it (ARCH-01).

**FUN-01: An exchange skipped the refund approval**
- **Severity / category:** Medium / Functional (business control)
- **Where:** `terminal.js`, `returnsView()`, the "Exchange instead" button
- **Evidence:** A return was issued and an exchange credit added with no manager approval. Any credit beyond the new sale is refunded to the original payment method (`refundDiff`). Baseline: `{"approvalAsked":false,"cartCredit":true}`.
- **Root cause:** Only the Refund button applied the `limits.refundApproval` rule.
- **Impact:** A cashier could get around the refund approval.
- **Fix:** Apply the same approval rule to exchanges, and record the approving manager on the return document.
- **Verification:** PASS. The manager approval sheet opens.

**FUN-02: Branch cards stayed locked after the terminal-number dialog was cancelled**
- **Severity / category:** Medium / Functional
- **Where:** `core.js`, `branchScreen()`
- **Evidence:** Baseline: `{"secondDialogAfterClose":false,"gridChoosing":true}`.
- **Root cause:** The `choosing` class was set on a pick and never cleared. The Terminal stays on the same screen while it asks for the terminal number.
- **Fix:** Wait for `onPick`. If the screen is still showing afterwards, clear `choosing` and `chosen`.
- **Verification:** PASS.

**FUN-03: Toast titles were escaped twice**
- **Severity / category:** Low / UI
- **Where:** `terminal.js`, six `toast({ title: esc(...) })` calls
- **Evidence:** Baseline showed `Ma&#39;am O&#39;Neil &amp; Co added`.
- **Root cause:** `toast()` already escapes its title.
- **Fix:** Pass the plain text.
- **Verification:** PASS. The toast reads "Ma'am O'Neil & Co added".

**FUN-04: An approval for an unknown branch broke the notifications drawer**
- **Severity / category:** Low / Functional
- **Where:** `owner.js`, the notifications drawer, the alert rows, the approval toast and the alerts view
- **Root cause:** `B.find(...).name` throws when no branch matches. Approvals come from other tabs and devices.
- **Fix:** Use the existing `branchName()` helper, which falls back to "Unavailable branch".
- **Verification:** PASS. With an approval for branch `zzz`, the drawer opens and no exception is thrown.

**FUN-05: Settings entries in the audit trail were escaped twice**
- **Severity / category:** Low / UI
- **Where:** `backoffice.js`, the `Cleo.config.onChange` audit entry
- **Root cause:** The value was escaped when stored and escaped again when shown.
- **Fix:** Store the value as plain text.
- **Verification:** PASS.

**DATA-01: The CSV import added duplicate SKUs**
- **Severity / category:** Medium / Data integrity
- **Where:** `backoffice.js`, `importDialog()`
- **Root cause:** Rows were only checked against the existing catalog, not against earlier rows in the same file.
- **Impact:** Two products with the same SKU.
- **Fix:** A repeated SKU is flagged as "SKU repeated in this file". Only the first row with that SKU is imported.
- **Verification:** PASS.

**DATA-02: CSV cost lost its thousands**
- **Severity / category:** Medium / Data integrity
- **Where:** `backoffice.js`, `importDialog()`
- **Root cause:** `parseFloat("1,250.00")` gives 1, and a negative cost was accepted.
- **Fix:** Strip the peso sign, commas and spaces. Reject a cost that isn't a number or is negative.
- **Verification:** PASS. `-5` is flagged as "Cost is not a number".

**DATA-03: Receiving a delivery invented a PO number**
- **Severity / category:** Medium / Data integrity (audit)
- **Where:** `backoffice.js`, `receiveDialog()`
- **Root cause:** An empty PO field defaulted to a random `PO-229x`, which was written to the stock ledger and the audit trail.
- **Fix:** Record "No PO number" instead.
- **Verification:** PASS. The audit trail shows "No PO number".

**DATA-04: Negative quantities and costs were accepted**
- **Severity / category:** Low to Medium / Data integrity
- **Where:** `backoffice.js`, `newTransferDialog()` and `receiveDialog()`
- **Root cause:** `+value || 1` accepted a quantity of -4, and a negative unit cost lowered the weighted average cost.
- **Fix:** Require a quantity above zero and a cost of zero or more, with an inline error and focus on the field.
- **Verification:** PASS. Both inputs are refused.

**DATA-05: Dates fixed at 5 October 2026**
- **Severity / category:** Medium / Data integrity (privacy compliance)
- **Where:**
  - `backoffice.js`: new-customer consent, the default and maximum expense date, and the account statement date.
  - `terminal.js`: new-customer consent.
- **Impact:** RA 10173 consent was recorded with the wrong date.
- **Fix:** Add a `fmt.iso()` helper in `core.js` that gives the Manila date as YYYY-MM-DD, and use it in each place. The statement shows today's date.
- **Verification:** PASS. Consent was recorded as 2026-10-13, the day of the test.

**DATA-06: The two modes checked mobile numbers differently**
- **Severity / category:** Low / Data integrity
- **Where:** `terminal.js`, new customer
- **Root cause:** The Terminal accepted any number with 10 or more digits. The Back Office requires `^09\d{9}$`.
- **Fix:** The Terminal now uses the Back Office rule.
- **Verification:** Code review.

**DATA-07: The business TIN accepted any text**
- **Severity / category:** Medium / Data integrity (BIR)
- **Where:** `core.js`, settings schema field `business.tin`
- **Root cause:** No validation. `bir.js tin()` strips non-digits and pads with zeros, so a typo printed a wrong TIN without any warning.
- **Fix:** Accept 9, 12 or 14 digits, with optional dashes or spaces. Otherwise show a warning and keep the stored value.
- **Verification:** PASS. "TIN 12" is refused and "123-456-789" is saved.

**PERF-01: Every dialog leaked a refraction filter and a ResizeObserver entry**
- **Severity / category:** Low to Medium / Performance
- **Where:** `core.js`, `LiquidGlass` and `overlay()`
- **Root cause:** `attach()` adds an SVG filter and observes the element, but nothing ever undid either.
- **Fix:** Add `LiquidGlass.detach()` and call it when an overlay closes.
- **Verification:** PASS. With refraction on, each open dialog adds exactly one filter and closing it removes that filter. Two runs measured 3 → 4 → 3 and 0 → 1 → 0, depending on whether the sidebar's own filters were already attached.

**PERF-02: Catalog listeners piled up**
- **Severity / category:** Low to Medium / Performance
- **Where:** `backoffice.js`, `productsPane()`
- **Root cause:** Each redraw registered another `Cleo.catalog.on` listener and kept the detached table alive.
- **Fix:** Keep one listener and replace it on each redraw.
- **Verification:** Code review. The Back Office smoke run passes.

**MAINT-01: An empty listener**
- **Severity / category:** Low / Maintainability
- **Where:** `core.js`
- **Root cause:** A `visibilitychange` listener with an empty body.
- **Fix:** Removed.

**A11Y-01 to A11Y-03:** see section 4.

**TOOL-01: The dev server could crash and checked paths loosely**
- **Severity / category:** Low / Tooling (development only)
- **Where:** `source/serve.js`
- **Root cause:**
  - A malformed `%` escape made `decodeURIComponent` throw, which crashed the server.
  - The path check was a plain prefix test, so it also matched a sibling folder starting with "Frontend".
  - It listened on every network interface.
- **Fix:**
  - Answer 400 to a bad escape.
  - Check that the path is inside `Frontend/` itself.
  - Listen on 127.0.0.1 by default; `HOST=0.0.0.0` opens it to the network for tablet testing.
- **Verification:** curl returned 400 for the bad escape and 200 for the next request.

### 5.2 Confirmed findings left open, with a recommendation

| ID | Where | Severity | Category | Evidence and root cause | Recommendation |
| --- | --- | --- | --- | --- | --- |
| ARCH-10 | `owner.js`, `backoffice.js`, `terminal.js` | Medium | Functional | About 30 awaited `Cleo.api` and catalog calls have no `try` or `catch`. For example: `changePlan`, `requestSalesCall`, saving a profile, `linkWallet`, saving or removing in the catalog, the CSV import loop, promos, expenses, customers, users, terminals, appointments and staff. A rejected request leaves the button spinning with no message. | Add one shared helper in `core.js`, generalised from `ownerRequest`, that resets the button, shows the error and returns null. Apply it when each call is moved to Supabase. It wasn't applied now because the mock never fails, so the error paths can't be exercised yet. |
| UX-01 | `core.js` `popover()` | Low | Accessibility | Has `role="menu"` but no keyboard menu behaviour. | Add roving focus with arrow keys, Home and End, or change the role to a dialog with buttons. |
| CORE-6 | `core.js` notification settings | Low | Validation | The list of alert recipients is free text, and emails aren't validated. | Validate each address when it is saved. |
| CORE-8 | `core.js` ambient layer | Low | Performance | The ResizeObserver for removed `.ambient` elements is never cleared. | Unobserve them when they are removed. |
| CORE-9 | `core.js` `config.set` | Low | Reliability | A failed save, for example when storage is full, is silently ignored. | Return a status and warn. |
| OWN-6 | `owner.js` invoice document | Low | Data | Prints the current plan name, not the plan the invoice was for. | Read the plan from the invoice record. |
| BO-16 | `backoffice.js` `renderView` | Low | Functional | The first render waits 600 ms on the skeleton without checking whether the view changed meanwhile. `owner.js` does check. | Add the same check `owner.js` uses. |
| LAUNCH-1 | `launcher.js` | Low | Navigation | On `#/plans`, typing `#/plans/<id>` into the address bar is ignored. | Handle the hash change while the plan pages are open. |
| PWA-1 | `manifest.webmanifest` | Low | PWA | One PNG icon with `sizes: "any"`. Installing needs 192 px and 512 px PNGs. | Add both icon sizes. |
| BUILD-1 | `build.js` output | Medium (production) | Security | No Content Security Policy is set, and the app is one inline script. | Have the build compute script and style hashes and emit a CSP. Allow only the Supabase origin in `connect-src`. |

### 5.3 Data contract findings (`data.js`) to settle before writing the schema

| ID | Finding | Recommendation |
| --- | --- | --- |
| DATA-C1 | Abbreviated keys (`b`, `t`, `oh`, `rp`, `grp`, `pop`, `cust`, `at`) and mixed date forms (epoch milliseconds, `YYYY-MM-DD`, display strings such as "Oct 1, 2026", birthdays as "Mar 14", expiry dates as text). | Use full column names. Use `timestamptz` for instants and `date` for days. Format dates only in the UI. |
| DATA-C2 | Money is held in JavaScript floats and rounded with `R2()`. | Use `numeric(12,2)` in Postgres. Have the server recompute every total, and compare it with the client's in tests. |
| DATA-C3 | Per-branch maps are embedded in rows: stock on hand, branch prices, branches a product is off, roles per branch, and charge aging. | Split them into child tables: `stock_movements` for on-hand, `product_branch_overrides`, `user_branch_roles`. Compute charge aging in a view. |
| DATA-C4 | Inconsistent identities. Cashier IDs are `c1` while user IDs are `u-c1`, and several records store names instead of IDs (`expenses.by`, `approvals.who`, `journal.who`). IDs are made by `Date.now() + random`. | Use `uuid` keys made with `gen_random_uuid()` and foreign keys to users. Keep names only as snapshots on printed documents. |
| DATA-C5 | Sensitive personal data: discount ID numbers (senior citizen, PWD, NAAC, solo parent), mobiles and birthdays. | Put discount IDs in a separate table with tighter row-level security, and log every read. Don't cache them in web `localStorage` (SEC-R3). |

---

## 6. Supabase readiness matrix

| Requirement | Status | Evidence |
| --- | --- | --- |
| Supabase client initialisation | Not Ready | No Supabase package, script tag or client exists. There is no bundler, and `build.js` inlines the source files. |
| Environment variables for the URL and publishable key | Not Ready | There's no environment mechanism. The build has no inputs. |
| Data-access layer | Partially Ready | `api.js` and `Cleo.db`, `Cleo.catalog` and `Cleo.items` form one boundary, but these bypass it: Back Office inventory, transfers, audit, sign-offs (ARCH-05), and the owner analytics (ARCH-11). |
| Sign-up, email verification, sign-in, two-step sign-in, password reset, Google and Facebook sign-in | Partially Ready | The screens and flows are complete and call the `api.signUp`, `verifyEmail`, `signIn`, `verifyCode`, `requestPasswordReset`, `resetPassword` and `socialAuth` methods. All of them are mocks. |
| Session restore and expiry | Not Ready | The session is plain JSON `{email, name, role}` in session or local storage. It has no token, no expiry and no refresh (ARCH-04). |
| Authorization and RLS | Not Ready | Every permission check is client-side (ARCH-01). No schema or policies exist. |
| Mapping entities to tables | Partially Ready | The entities are clear (draft below), but DATA-C1 to C5 need settling first. |
| Loading, empty, error and duplicate-submit states | Partially Ready | Loading and empty states, and guards against double submits, are common. Error paths are missing in about 30 places (ARCH-10). |
| Realtime | Partially Ready | `Cleo.bus` events and `Cleo.db.on` already drive approvals, tickets, deliveries and the catalog. They map onto Supabase Realtime channels. |
| File storage (expense receipt photos) | Not Ready | Photos are kept as in-memory data URLs (`RECEIPTS`) for the current session only. |
| Generated types | Not Applicable / Not Ready | The project has no TypeScript. JSDoc typedefs are recommended, generated from `supabase gen types`. |
| Offline Terminal sales and sync | Not Ready | The outbox is in memory, uploads are fire-and-forget, and nothing is idempotent (ARCH-06). |
| BIR fiscal integrity | Not Ready | Counters are in `localStorage` (ARCH-12), MIN and PTU values are invented (ARCH-13), sample data appears in exports (ARCH-14), and the seal is a demo hash. See `Docs/Cleo BIR Compliance Review.md`. |
| Payments (customer and subscription) | Not Ready | Timers simulate QR Ph, card, wallet and the billing provider (ARCH-07). |
| No secrets in browser code | Ready | Grep found no keys, tokens, service-role strings or external endpoints. |
| Validated against a real Supabase project | Not Verified | No Supabase project or credentials were available. No policy has been tested. |

### 6.1 Entities the frontend expects (verified from the code)

| Entity | Used by | Fields seen in the code |
| --- | --- | --- |
| Business and settings | `core.js` `CONFIG_DEFAULT`, `bizSections` | name, legal, tin, style, receipt texts, brand, tax, order types, payments, limits, features, roles, custom roles, alerts, notify, integrations, loyalty, statutory, invoice |
| Branches | `Demo.branches` | id, name, short, area, bcode, terminals, manager |
| Users and branch roles | `Cleo.db('users')` | id, name, email, mobile, initials, color, role, roles {branch: role}, status, last, pin (flag), twoFactor |
| Terminals | `Cleo.db('terminals')`, `cleo:t-device` | id, b, t, label, model, ver, min, serial, ptu, registered, syncMin, unsynced, off |
| Products and overrides | `Cleo.catalog` (`product-patches`) | id, sku, name, cat, price, cost, taxType, station, barcode, sizes, available, branchPrice, branchOff, recipe, mods, variants |
| Stock items and movements | `Cleo.items` (`item-patches`), `ledgerOf` | id, name, grp, unit, rp, sup, oh{branch}, cost, exp{branch}, archived |
| Transfers | `TRANSFERS` (in memory) | id, from, to, step, by, at, note, items[{i, req, sent, got}], rejected, short |
| Promos | `Cleo.db('promos')` | name, type, pct, amount, buy, get, price, cats, items, days, from, to, branches, on |
| Customers, loyalty, charge accounts | `Cleo.db('customers')` | name, mobile, email, birthday, home, tier, points, visits, spend, last, consent, sc{type, id, name}, company, tin, charge{limit, balance, aging[4]} |
| Sales and the electronic journal | `bir.js` (`ejournal`), `S.sales` | kind, no, b, t, at, who, lines, adj, sum, tenders, change, tip, buyer, stat, seal, ref and refId (void and refund), training |
| Fiscal counters | `bir.js` fiscal memory | invoice, void, refund, reprint, payment, bill, z, reset, agt, lastZAt |
| Expenses | `Cleo.db('expenses')` | date, b, cat, what, amount, paid, receipt, by |
| Approvals | `Cleo.db('approvals')` | kind, amount, b, t, who, reason, status, by, at |
| Kitchen tickets | `Cleo.db('tickets')` | order, where, station, items[{n, q, m, x}], done, bumpedAt |
| Appointments | `Cleo.db('appointments')` | cust, mobile, svc, staff, at, mins, note, status |
| Platform deliveries | `Cleo.db('deliveries')` | platform, cust, items[{pid, q}], status, prep, at |
| Attendance | `Cleo.db('attendance')` | who, name, b, kind, at |
| Audit trail | `AUDIT` (in memory) | t, who, role, type, act, ent, before, after, dev |
| Subscription and billing | `cleo:subscription`, `cleo:plan`, `cleo:billing-method` | plan, terminals, method kind and label |
| Legal acceptance | `cleo:legal-accepted` | email, version, method, at |

**UI-only state that stays local:** theme, dashboard layout (`owner-dash`), table columns (`bo-cols`), menu layout preferences (`t-menu` layout fields), hardware settings (`t-hw`), preview frame and bar, and device mode.

### 6.2 Draft schema (a draft only, based on the verified frontend requirements)

Every business table carries `business_id uuid not null` and `created_at` / `updated_at timestamptz default now()`. Keys are `uuid default gen_random_uuid()`. Money is `numeric(12,2)` and quantities are `numeric(12,3)`.

```text
businesses(id, name, legal_name, tin, style, settings jsonb, settings_version int)
branches(id, business_id, name, short, area, bir_branch_code char(5))
memberships(user_id → auth.users, business_id, is_owner bool)             unique(user_id, business_id)
user_branch_roles(user_id, business_id, branch_id, role_key)              unique(user_id, branch_id)
roles(business_id, key, label, permissions text[], is_custom bool)        primary key(business_id, key)
staff_pins(user_id, business_id, pin_hash, failed_count, locked_until)    no client select
terminals(id, business_id, branch_id, number int, label, model, min, serial, ptu, ptu_date, app_version, registered_at, last_sync_at)  unique(branch_id, number)
categories(id, business_id, name, icon, sort)
products(id, business_id, sku, name, category_id, price, tax_type, station, barcode, asks_options bool, available bool, archived_at)  unique(business_id, sku), unique(business_id, barcode)
product_branch_overrides(product_id, branch_id, price, available)
product_recipe_lines(product_id, item_id, qty)
modifier_groups(id, product_id null, name, pick, default_index) ; modifier_options(group_id, name, price)
stock_items(id, business_id, name, grp, unit, reorder_point, supplier, archived_at)
stock_movements(id, business_id, branch_id, item_id, qty, kind, unit_cost, ref, note, created_by, created_at)   append-only
transfers(id, business_id, number, from_branch_id, to_branch_id, status, requested_by, note) ; transfer_lines(transfer_id, item_id, requested, dispatched, received)
promos(id, business_id, name, type, pct, amount, buy, get, bundle_price, days smallint[], from_time, to_time, active) ; promo_targets(promo_id, category_id|product_id) ; promo_branches(promo_id, branch_id)
customers(id, business_id, name, mobile, email, birthday date, home_branch_id, tier, company bool, tin, address, consent_at timestamptz, consent_version)  unique(business_id, mobile)
customer_discount_ids(customer_id, type, id_number, name_on_id)          stricter RLS
loyalty_ledger(id, customer_id, points int, sale_id, reason, created_by)  append-only
charge_accounts(customer_id, credit_limit) ; charge_ledger(id, customer_id, amount, sale_id, payment_ref)  append-only
documents(id, business_id, branch_id, terminal_id, kind, series, number bigint, issued_at, cashier_id, payload jsonb, seal, ref_document_id, training bool)  unique(terminal_id, series, number); insert by RPC only; append-only
sale_lines(document_id, product_id, name, qty, unit_price, amount, statutory bool) ; sale_tenders(document_id, method, amount, reference, flagged bool)
expenses(id, business_id, branch_id, spent_on date, category, description, amount, paid_from, receipt_path, created_by)
approvals(id, business_id, branch_id, terminal_id, kind, amount, reason, requested_by, status, decided_by, decided_at)
kitchen_tickets(id, business_id, branch_id, order_ref, station, items jsonb, done bool, bumped_at)
appointments(id, business_id, branch_id, customer_name, mobile, service_id, staff_id, starts_at, minutes, note, status)
deliveries(id, business_id, branch_id, platform, external_ref, customer_name, items jsonb, status, prep_minutes)   inserted by webhook
attendance(id, business_id, branch_id, user_id, kind, at)
audit_log(id, business_id, actor_id, actor_role, device, kind, action, entity, before jsonb, after jsonb, at)   written by triggers; append-only
subscriptions(business_id, plan, terminals, status, current_period_end, provider_ref) ; billing_methods(business_id, kind, label, provider_token_ref)
legal_acceptances(user_id, version, method, accepted_at)
sales_requests(id, business_id, plan, mobile, note, created_by)
```

Indexes to add:
- `(business_id, branch_id, issued_at)` on `documents`
- `(business_id, item_id, branch_id, created_at)` on `stock_movements`
- `(business_id, mobile)` on `customers`
- `(branch_id, done)` on `kitchen_tickets`
- `(business_id, status)` on `approvals`

### 6.3 RLS requirements per operation

Helper functions, `security definer`, `stable`, with a fixed `search_path`:
- `is_member(business_id)`
- `branch_role(business_id, branch_id)`
- `has_perm(business_id, branch_id, perm)`, which reads `user_branch_roles` and `roles`

RLS is enabled on every table, with no `using (true)` policies.

| Frontend operation | Table and fields | Operation | Auth state | Access rule (RLS) | Success / failure |
| --- | --- | --- | --- | --- | --- |
| Owner and Back Office: read the catalog; Terminal: menu | `products`, `product_branch_overrides`, `categories` | select | Signed in | `is_member(business_id)` | Rows / empty list |
| Catalog edit, CSV import, product drawer | `products` and its child tables | insert, update | Signed in | `has_perm(business_id, null, 'catalog')`, with `check` repeating the same rule | Row / 403 with a message |
| Branch price override | `product_branch_overrides` | upsert | Signed in | `has_perm(business_id, branch_id, 'catalog')` | |
| Promos | `promos` and its targets | select / write | Signed in | Select: member. Write: `catalog` permission. | |
| Stock adjustment, receive, count | `stock_movements` | insert only | Signed in | `has_perm(…, branch_id, 'stock')`. Adjustments above `limits.adjustApproval` go to `approvals` through an RPC. No update or delete policy. | |
| Transfers | `transfers`, `transfer_lines` | insert, update `status` | Signed in | Request: `stock` permission at the sending or receiving branch. Approve: `approve` permission at the sending branch. Each step goes through an RPC that posts the stock movements. | |
| Sale and invoice | `documents`, `sale_lines`, `sale_tenders` | insert by RPC `issue_document()` | Terminal device session plus staff PIN | The RPC checks that the terminal belongs to the branch, the staff member has `sell`, the series follows on, the seal is valid, and totals are recomputed on the server. No direct insert, update or delete. | Document / conflict on a duplicate number |
| Void, return, reprint | `documents` (kinds `VD`, `RF`, `RP`) | RPC | Device plus manager approval | `approve` permission. A void only before that terminal's last Z-reading. | |
| X and Z readings | `documents` | RPC | Device plus manager | `approve` / `close` permission | |
| Electronic journal and reports | `documents` | select | Signed in | `has_perm(…, branch_id, 'reports')` | |
| Customers | `customers` | select, insert, update | Signed in | Select and insert: member at any branch. Update: `users` or `sell` permission. Delete: owner only, through an RPC that anonymises their sales. | |
| Discount ID numbers | `customer_discount_ids` | select, insert | Signed in | `sell` permission, scoped to the business. Every select logged by a trigger. | |
| Points and charge balances | `loyalty_ledger`, `charge_ledger` | insert by RPC | Device / signed in | The RPC checks the balance and limit atomically. No client updates. | |
| Expenses and receipt photos | `expenses`; storage bucket `receipts/{business_id}/…` | CRUD | Signed in | `close` permission. A locked period refuses edits (trigger). Storage policy: same business and permission. | |
| Approvals | `approvals` | insert (Terminal), update `status` (owner) | Device / signed in | Insert: staff at the branch. Decide: `approve` permission, and only while `status = 'pending'`. | |
| Kitchen tickets | `kitchen_tickets` | insert, update `done` and items | Device | Member at the branch | |
| Users and roles | `user_branch_roles`, `roles`, invites | write | Signed in | `users` permission. Nobody can remove their own `users` permission. Billing stays with the owner. | |
| Business settings | `businesses.settings` | update | Signed in | `users` permission. A trigger writes `audit_log`. | |
| Plan and billing | `subscriptions`, `billing_methods` | select | Signed in | Owner only. Writes come only from the billing provider's webhook (Edge Function using the service role). | |
| Audit trail | `audit_log` | select | Signed in | `reports` permission. Inserted by triggers. No update or delete. | |
| PIN check | `staff_pins` | RPC `verify_pin()` | Device | The RPC counts failures and sets `locked_until`. No select policy on the table. | ok / locked until |
| Legal acceptance | `legal_acceptances` | insert | Signed in | `user_id = auth.uid()` | |

### 6.4 Recommended client structure, within the existing conventions

1. **`source/supabase.js` (new, built before `api.js`):**
   - Pin `@supabase/supabase-js` to an exact version and vendor its UMD build into `assets/vendor/`. That keeps the app working offline with no bundler.
   - Create a single client from `Cleo.env.supabaseUrl` and `Cleo.env.supabaseKey`, using the publishable or anon key only.
   - Export small helpers:
     - `q(table)`
     - `rpc(name, args)`
     - `run(promise)`, which returns `{ ok, data, error }`, maps HTTP and Postgres errors to user-facing messages, applies a timeout and retries idempotent reads.
2. **Environment.**
   - `build.js` reads `CLEO_SUPABASE_URL` and `CLEO_SUPABASE_PUBLISHABLE_KEY` from `process.env`, or from a git-ignored `Frontend/.env`.
   - It embeds them as `<script type="application/json" id="cleo-env">`.
   - The build fails if a key looks like a secret or service-role key (`sb_secret_`, or a JWT with `role: service_role`).
3. **`api.js` stays the only module that talks to the backend.** Replace each mock body with a Supabase call that keeps the same signature and return shape. Then:
   - move ARCH-05 (direct `Demo` and in-memory changes) behind `api.*`;
   - make `Cleo.db` a cache that Realtime fills, not the source of truth;
   - replace the owner analytics with report RPCs or views that take `{ scope, period }` (marked `BACKEND:` in `owner.js`).
4. **Auth.**

   | Frontend function | Supabase call |
   | --- | --- |
   | `signIn` | `auth.signInWithPassword` |
   | `signUp` and `verifyEmail` | `auth.signUp`, then `auth.verifyOtp({ type: 'signup' })` |
   | `verifyCode` | `auth.mfa.challenge` and `auth.mfa.verify` (TOTP) |
   | `requestPasswordReset` and `resetPassword` | `resetPasswordForEmail` and `updateUser` |
   | `socialAuth` | `signInWithOAuth('google' \| 'facebook')` |

   - `Cleo.session` becomes a view over `auth.getSession()` plus `onAuthStateChange`. A `SIGNED_OUT` or failed refresh returns the user to sign-in.
   - Backup codes and the per-device "Where you're signed in" list have no built-in Supabase equivalent. Either build them (a table plus an Edge Function, or `signOut({ scope: 'others' })`) or remove them from the UI.
5. **Terminals.**
   - Registration creates the terminal record and a device credential through an Edge Function.
   - Staff PINs are checked by `verify_pin()`.
   - For offline selling, the Android shell keeps a hashed copy of the PINs and the fiscal counters in encrypted storage.
   - The outbox moves to IndexedDB or SQLite. Each sale uploads through `issue_document()`, keyed by (terminal, series, number), so a retry is idempotent. A sale leaves the outbox only after the server confirms it.
6. **Realtime.** Use `postgres_changes` on `approvals`, `kitchen_tickets`, `deliveries` and `products`, filtered by `business_id` and branch. `BroadcastChannel` stays for the same-device customer display.
7. **Types.** Run `supabase gen types typescript > Frontend/types/db.d.ts`, then reference it from JSDoc `@typedef`s in `api.js`. Optionally add `// @ts-check`.

---

## 7. Security assessment

### Confirmed and fixed

These are SEC-01 to SEC-08 (section 5.1):
- four stored-XSS sinks;
- two unescaped fields;
- the lockout that wasn't enforced;
- the export that wasn't permission-gated.

FUN-01 (the exchange that bypassed approval) also counts, as a broken business control.

### Confirmed, open, and needing a backend

| ID | Severity for production | Issue | Required protection |
| --- | --- | --- | --- |
| ARCH-01 | Critical | All authorization is in the browser: `can()`, `lockedBtn`, the read-only banner, "Managed by HQ" and the role switcher. The session role is client-controlled JSON. | RLS and RPC checks for every operation (6.3). Treat the frontend checks as UX only. |
| ARCH-02 | High | The audit trail is an in-memory array, lost on reload. Every entry is stamped with a fixed device "Back Office · 112.198.84.20". | A server-written, append-only `audit_log`, filled by triggers, with the real user and device. |
| ARCH-03 | High | `api.checkPin` accepts any 4 digits except 0000. This covers staff sign-in and every manager approval: voids, refunds, Z-reading, opening the drawer without a sale, and training mode. | Salted PIN hashes. Server or secure-device verification with failure counting. |
| ARCH-04 | Medium | The session has no expiry, refresh or revocation. | Supabase Auth sessions. |
| ARCH-07 | Critical | Payments are simulated. QR Ph auto-confirms after 7 seconds with a fixed reference. The card terminal auto-approves after 5.2 seconds with a random brand, last 4 digits and authorisation code. Wallet linking, billing and subscriptions are timers. | Gateway SDKs and webhooks. A sale may complete only after a confirmed payment event. Remove the simulation buttons from production builds. |
| ARCH-08 | High | The demo clock (`DEMO_OFFSET` in `core.js`) moves `Cleo.now()` into business hours with no flag. It would falsify invoice and journal timestamps. | Gate it behind an explicit demo setting, off by default. |

### Risks to address while integrating

| ID | Risk | Protection |
| --- | --- | --- |
| SEC-R1 | Client-provided IDs and ownership. Records carry `by` and `who` names, and branch IDs, set by the client. | Take identity from `auth.uid()` in RPCs and defaults. Never trust `by`, `who` or `b` from the client. |
| SEC-R2 | Client-side validation only: prices, quantities, TIN and mobiles. | Repeat the rules as `check` constraints and RPC validation. Recompute totals on the server. |
| SEC-R3 | Personal data in web `localStorage`: `cleo:db:customers` holds mobiles, emails and discount IDs. It persists on shared browsers after sign-out. | Don't persist personal data in the web modes. Clear caches on sign-out. Use encrypted storage on the Terminal. |
| SEC-R4 | No Content Security Policy (BUILD-1). | A hash-based CSP, with `connect-src` limited to the Supabase project. |
| SEC-R5 | Cross-tab `BroadcastChannel` messages are trusted (`Cleo.bus`). Same-origin only, so acceptable. | Keep it to UI hints. Never accept state changes from it without a server round trip. |
| SEC-R6 | Simulated success messages, such as "Sent to Grace Tan … received the Z-reading", "Invite sent again" and SMS or email receipts "Sent". | Show success only after the server confirms. |

**Checked and clean:**
- No hardcoded secrets.
- No `eval`.
- No outside URLs, apart from the SVG namespace.
- The service worker caches only same-origin GET requests, so Supabase responses won't be cached.
- Legal markdown is escaped before formatting.
- CSV export defuses formulas (unit tested).

**Not done:** no dependency audit, because the project has no dependencies. No penetration test against a live backend was run or appropriate.

---

## 8. Testing results

All commands ran on Windows 11 with Node v24.20.0 and Microsoft Edge (headless). The preview server is `node source/serve.js` on port 5175.

| Check | Command | Result |
| --- | --- | --- |
| Syntax, all 14 scripts | `node --check source/<file>.js` for each script | PASS, baseline and final |
| Generated service worker | `node --check sw.js` | PASS |
| Production build | `node source/build.js` | PASS: `built index.html 1212 KB`, `no class clashes between stylesheets` |
| Data export | `node source/export-data.js` | PASS (4 files written) |
| Unit tests (new) | `node --test tests/unit.test.js` | **5 of 5 pass**: CSV formula guard, inline-HTML allow-list, config-path guards, number parsing, and parsing of `plans.md` |
| Browser baseline, before the fixes | an early version of `tests/e2e.js` | **1 pass, 8 fail**: CORE-4, TERM-1, CORE-2, BO-7, TERM-2, TERM-4, BO-14 and TERM-9 all failed as predicted. In this run, a timing problem in the harness also dropped a PIN digit; the code itself shows no lock check. |
| Browser regression, final | `node tests/e2e.js` | **21 of 21 pass** (results below) |
| Contrast | a Node script that reads the tokens from `core.css` | Light theme after the fix: `--ink-3` 4.95:1 on the page background and 5.17:1 on white. Status inks 5.2 to 5.9:1 on the background, and 4.55 to 5.11:1 on their tinted fills. Dark theme unchanged and passing. |
| Responsive | CDP device emulation at 390 × 844 (mobile) | No horizontal overflow on the Owner Dashboard, Plan and billing, or the plan page |
| Dev server | `curl` against the running server | Bad escape → 400 (the server stays up). Normal request → 200. |
| Console | captured over every browser run | No errors or exceptions. Two kinds of message appeared: the payloads' own `GET /x 404`, and Chrome's "Blocked call to navigator.vibrate" intervention, because synthetic clicks don't count as user activation. |

**Browser scenarios in the final run:**
- Sign-in renders.
- CORE-4: the terminal grid works after a cancel.
- TERM-1: PIN lockout, and the lockout surviving a reload.
- CORE-2: toast text.
- BO-7, TERM-2, TERM-3, TERM-4: XSS payloads stay inert.
- BO-14: audit text.
- TERM-9: exchange approval.
- CORE-3: dialog filters released.
- OWN-1: an unknown branch.
- BO-5 and BO-6: CSV import.
- BO-9 and BO-11: receiving and quantities.
- BO-12 and BO-13: consent date and the export gate.
- BIR-6: TIN validation.
- Smoke runs: all 9 Owner views; all 11 Back Office views and the BIR tabs; a Terminal cash sale that issues invoice `00012874`; the plan page.

**Not configured, so not run:**
- linter;
- type checking;
- package or dependency audit;
- coverage measurement.

**Blocked, because no environment was available:**
- tests against a Supabase project, RLS, and auth email and OAuth flows;
- payment gateway, card terminal, printers, scanner and Android shell;
- SMS and email delivery.

**Not run:**
- screen-reader testing;
- Firefox and Safari (the refraction code is Chromium-only and has a fallback);
- the operating system's reduced-motion and reduced-transparency settings (checked in source only);
- offline mode with the service worker on (`?offline`);
- performance profiling;
- physical touch devices.

---

## 9. Fixes implemented

| File | Changes |
| --- | --- |
| `Frontend/source/core.js` | `LiquidGlass.detach()`, called when an overlay closes (PERF-01). `branchScreen` clears its lock when the pick stays on the screen (FUN-02). Removed the empty `visibilitychange` listener (MAINT-01). New `fmt.iso()` helper (DATA-05). TIN validation (DATA-07). |
| `Frontend/source/core.css` | Light theme: `--ink-3` changed from .58 to .62 alpha. `--good` changed from `#0f8a4a` to `#0a6e3a`, `--warn` from `#9a6200` to `#855400`, `--serious` from `#b4531f` to `#9c4519`, and `--bad` from `#c62a22` to `#b3241d`. Checkbox border now uses `--ink-3` (A11Y-01, A11Y-02). |
| `Frontend/source/terminal.js` | SEC-02 to SEC-05 escaping. PIN lockout stored in `cleo:t-pinlock` (SEC-07). Exchange approval (FUN-01). Six toast titles (FUN-03). Consent date and mobile rule (DATA-05, DATA-06). The header lists the new storage key. |
| `Frontend/source/backoffice.js` | Role name escaping (SEC-01). Export gates (SEC-08). Audit text (FUN-05). CSV duplicate SKU and cost parsing (DATA-01, DATA-02). No invented PO number (DATA-03). Quantity and cost validation, with inline errors (DATA-04). Today's dates for consent, expenses and statements (DATA-05). A single catalog listener (PERF-02). |
| `Frontend/source/owner.js` | `branchName()` guards (FUN-04). Invoice fields escaped and labelled (SEC-06, A11Y-03). |
| `Frontend/source/serve.js` | Bad-escape handling, path containment, and listening on localhost by default (TOOL-01). |
| `Frontend/tests/unit.test.js` (new) | Unit tests for `safety.js` and `parsePlans`. |
| `Frontend/tests/browser.js` (new) | A small DevTools-protocol driver. It finds Edge or Chrome, or uses `CLEO_BROWSER`. |
| `Frontend/tests/e2e.js` (new) | 21 regression and smoke scenarios. `CLEO_URL` sets the address, and the exit code is non-zero on any failure. |
| `Frontend/README.md` | New Tests section. The PIN lockout described as it now works. `cleo:t-pinlock` added to the storage table. The `HOST` setting for the dev server. |
| Generated | `index.html`, `sw.js`, `legal/*.html` (from `node source/build.js`) and `data/*.json` (from `node source/export-data.js`). |

**Reviewed for side effects:**
- The main-flow smoke runs pass after the changes.
- The light theme was checked in screenshots.
- The PIN lock applies to one staff member at a time and clears after a correct PIN.
- The exchange now asks for approval under the same rule as a refund, so `limits.refundApproval` off and a small amount still need no manager.
- The dev server now listens on localhost only; set `HOST=0.0.0.0` to test from a tablet.

---

## 10. Remaining issues

| ID | Severity (production) | Summary | Blocker or dependency |
| --- | --- | --- | --- |
| ARCH-01 | Critical | Permissions are checked only in the browser | Schema plus RLS (6.3) |
| ARCH-07 | Critical | Payments and billing are simulated | Gateway, card SDK and billing provider |
| ARCH-06 | High | The Terminal's outbox is in memory and its uploads are fire-and-forget | IndexedDB or the Android shell, plus an idempotent `issue_document()` |
| ARCH-12 | High | Fiscal counters live in `localStorage`. Two tabs on one terminal can read the same counter and print duplicate invoice numbers. | Device secure storage, plus a server check of the series |
| ARCH-13 | High | `bir.js machine()` invents MIN, serial and PTU values for an unregistered terminal (for example, "Add a new terminal") and prints them on invoices | Block invoicing until the terminal's BIR record exists |
| ARCH-14 | High | The BIR screens and exports add sample Z-readings, sample discount buyers and their IDs, and "Sample day" rows. The sales-journal and daily-summary exports are entirely synthetic. | Remove them, or gate them behind a demo flag, before any filing use |
| ARCH-02 | High | The audit trail is in memory, with a fake device and IP | `audit_log` and triggers |
| ARCH-03 | High | PINs aren't verified | `staff_pins` and `verify_pin()` |
| ARCH-08 | High | The demo clock offset is always on | A demo flag |
| ARCH-05 | Medium | Inventory, transfers, sign-offs and period locks change memory directly | Move them behind `api.*` |
| ARCH-09 | Medium | Hardcoded demo content in production screens: billing dates and proration, the device list, "Fill a sample count", the prefilled sales phone, registration slots (T2 free), "Kapé Lumen logo", and the export periods September and August 2026 and Q3 2026 | Server data |
| ARCH-10 | Medium | About 30 async calls with no error handling | A shared helper, applied during integration |
| ARCH-11 | Medium | The owner analytics are synthetic | Report RPCs and views |
| ARCH-15 | Medium | Points, charge balances and KDS items are updated with a read-modify-write on the client, so concurrent updates are lost | Atomic RPCs |
| ARCH-04 | Medium | No session expiry | Supabase Auth |
| BUILD-1 | Medium | No CSP | Build step |
| DATA-C1 to C5 | Medium | Data-contract cleanup | Schema design |
| UX-01 to UX-03, CORE-6, CORE-8, CORE-9, OWN-6, BO-16, LAUNCH-1, PWA-1 | Low | See 5.2 | None. They can be fixed at any time. |

---

## 11. Prioritised action plan

**Immediate (done in this audit).** Sections 5.1 and 9. The UI-only issues still open are listed under Low in section 10, and none of them blocks integration.

**Before integration:**
1. Agree the schema from 6.2. Settle DATA-C1 to C5: keys, dates, money, child tables and identities.
2. Write the RLS policies and RPCs from 6.3, and test them with pgTAP or SQL tests as an owner, an HQ manager, a branch manager, a cashier, a clerk and an outsider.
3. Add `source/supabase.js` and the environment injection to `build.js`. Add the CSP.
4. Add the shared request helper, and the rule that only `api.js` talks to the backend.
5. Add a `demo` flag that turns off `DEMO_OFFSET`, the sample BIR data, the simulation buttons and the demo copy.

**Integration, in this order:**
1. Auth and session.
2. Business, branches, users and roles.
3. Catalog, promos and the stock ledger.
4. Customers, with discount IDs separated.
5. Documents and sales through `issue_document()`, with an idempotent outbox.
6. Approvals and tickets over Realtime.
7. Expenses and receipt storage.
8. Reports and owner analytics.
9. Billing webhooks.

**After integration:**
1. Run `node tests/e2e.js` against a staging project. Add scenarios for unauthorized access: each one must fail at the server, not just in the UI.
2. Run RLS tests in CI.
3. Run offline sync tests: kill the Terminal mid-sale and check that no number is duplicated or skipped.
4. Run payment webhook replay tests.
5. Test performance with realistic catalog and journal sizes. Paginate the electronic journal and reports.
6. Re-run the contrast and phone-layout checks.

---

## 12. Final readiness verdict

**Ready with conditions to start Supabase integration. Not ready for production.**

**Evidence that it's ready to start:**
- One clear adapter boundary.
- Complete UI flows for auth and every module.
- Loading and empty states.
- Realtime-shaped events.
- No secrets in browser code.
- A clean build.
- 21 of 21 browser scenarios and 5 of 5 unit tests pass after the fixes.

**Conditions before the first real tenant or real money:**
- Server-enforced authorization (ARCH-01).
- Real payments (ARCH-07).
- Durable, idempotent sale sync (ARCH-06).
- BIR fiscal integrity (ARCH-12 to ARCH-14).
- A real audit trail (ARCH-02).
- PIN verification (ARCH-03).
- Removal of the demo clock and sample data (ARCH-08, ARCH-09).

None of these can be verified until a Supabase project and its policies exist, so their status is **Not Verified**.

---

## Checklist for the next stage

- [ ] Create the Supabase project (staging first) and turn on email OTP and TOTP MFA. Add the Google and Facebook OAuth apps. The public legal pages already exist in `legal/*.html`.
- [ ] Add `CLEO_SUPABASE_URL` and `CLEO_SUPABASE_PUBLISHABLE_KEY` to the build environment. Never put a service-role or secret key in `Frontend/`.
- [ ] Write migrations for the schema in 6.2, after resolving DATA-C1 to C5.
- [ ] Enable RLS on every table and write the policies, helper functions and RPCs in 6.3. Test them for each role, including outsiders.
- [ ] Make `documents`, `stock_movements`, the ledgers and `audit_log` append-only, with triggers.
- [ ] Add `source/supabase.js`, the request helper and the CSP. Keep all backend calls in `api.js`.
- [ ] Map `Cleo.session` to Supabase Auth, including expiry and refresh handling.
- [ ] Build terminal registration, PIN verification and the idempotent `issue_document()`. Move the outbox to durable storage.
- [ ] Replace the simulated payments with the gateway, the card SDK and webhooks. Remove the simulation buttons from production.
- [ ] Gate or remove the demo clock, sample BIR rows and demo copy behind a demo flag.
- [ ] Move expense photos to a private storage bucket with storage RLS.
- [ ] Replace the owner analytics with report RPCs and views.
- [ ] Generate types (`supabase gen types`) and reference them from JSDoc.
- [ ] Extend `tests/e2e.js` with server-side denial tests, and run it in CI against staging.
- [ ] Re-check the BIR items in `Docs/Cleo BIR Compliance Review.md`: accreditation, PTU, seal and journal retention.
