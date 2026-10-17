# Cleo POS — Feature Specification (Developer Draft)

Oct 5, 2026 · @Haku · updated Oct 6, 2026 to match the front-end build in `Frontend/`

## Overview

Cleo is a cloud POS for Philippine small and mid-sized businesses that need to sell, track stock and report from one system, across one or many branches. It has three jobs: make bookkeeping and BIR reporting easier, show owners revenue and profit in one dashboard, and connect branches under one catalog, stock pool and customer base.

| Part | Runs on | Used by | Purpose |
| --- | --- | --- | --- |
| Cleo Terminal | Android phones, tablets and Android POS devices | Cashiers, servers, kitchen staff | Selling, payments, receipts, shifts; works offline |
| Cleo Back Office | Web browser | Owners, managers, accountants, inventory clerks | Catalog, inventory, expenses, accounting reports, settings |
| Cleo Owner Dashboard | Web and the Android app | Owners, HQ managers | Revenue, profit, branch comparison, live monitoring |
| Cleo Cloud | Hosted backend | (no direct users) | Sync, multi-tenant data, APIs, notifications |

&#91;embedded content: Cleo architecture · terminals, cloud, web apps\]

Terminals keep a local copy and sell without internet; Cleo Cloud syncs them, feeds the Back Office and Owner Dashboard, and confirms QR Ph and card payments with the gateway.

**Business types.** One shared core, plus modules switched on per business: Food & beverage, Retail and Services. A business can run more than one module, such as a café that also sells retail coffee packs.

**How to read the feature tables.** Each feature has an ID for tickets and commits, a priority, the lowest plan that includes it, and its state in the current front end.

- Priority: **MVP** = needed for the first paying client · **v1.1** = first update after launch · **Later** = roadmap
- Plan: **Basic**, **Pro** or **Enterprise**; each higher plan includes everything below it (see Plan tiers)
- Front end:
  - **Built**: works in the front end. Data goes through the mock server in `source/api.js` until Cleo Cloud replaces it.
  - **Built · simulated**: the screens are complete, but an outside party is simulated: a payment gateway, card terminal, delivery platform, SMS or email, or printer, scanner, scale or drawer. Each place is marked `BACKEND:` in the code.
  - **Partial**: part of the note is built; the note says what is missing.
  - **Not built**: not in the front end yet.
  - **Server**: lives in Cleo Cloud only; there is nothing to show in the front end.

## Front-end build (October 2026)

The three web parts ship as one app, `Frontend/index.html`, for one domain and host. It is built from `Frontend/source/` with `node source/build.js`. `Frontend/README.md` covers running it, the storage keys and the code layout.

- **Sign in first, then pick a mode.**
  - After the loading screen comes one sign-in for every mode. People sign in with Google, Facebook, or email and password, or create an account (USR-07).
  - Every way in requires ticking the box that accepts the Terms and Conditions and the Privacy Policy (USR-08).
  - A new account then chooses a plan (Basic, Pro, Enterprise) and pays on a payment page (terminals and payment method). Enterprise is sold through Talk to sales.
  - A plan opens only its own modes. Basic is the Terminal alone: it opens straight into the Terminal, with staff, business rules, plan and billing in Terminal › Settings. On Pro and Enterprise a picker offers Terminal, Owner Dashboard and Back Office. "Use this mode on this device" remembers the choice, so after sign-in the device skips the picker.
  - A registered Terminal opens straight to its staff PIN screen, because cashiers sign in with a PIN.
  - Switch mode is available on plans with more than one mode: the account menu in the Owner Dashboard and Back Office, and the PIN screen and Settings in the Terminal.
- **Routes.**

  | Route | Shows |
  | --- | --- |
  | `#/` | Mode picker |
  | `#/terminal` | Terminal |
  | `#/terminal/display` | Customer-facing display |
  | `#/owner/<page>` | Owner Dashboard page |
  | `#/backoffice/<page>` | Back Office page |

  Adding `/app` to a route skips sign-in, for development.
- **One home per setting.**
  - Business rules live only in Back Office › Settings.
  - Account, security, alerts and notifications live in Owner Dashboard › Settings.
  - Terminal › Settings holds device settings, plus a read-only summary of the business rules.
  - Light or dark is chosen per device with the theme button. The first visit follows the device's setting.
- **Shared sign-in.** One session covers every mode on the device. "Keep me signed in on this device" keeps it after the browser closes. Sign out, from any mode or the picker, returns to the sign-in screen.
- **Legal documents.** The Terms and Conditions and Privacy Policy are written in `Frontend/source/legal/`. The app shows them in a built-in reader, and the build publishes them as public pages (`Frontend/legal/`), which Google and Facebook sign-in require. Review copies are in `Docs/`.
- **Edit, add and remove.**
  - Back Office › Catalog and Back Office › Inventory each have an Edit button that turns the table into a form. Many rows can be changed, added and removed, then saved at once.
  - Each row also has its own Edit button, which opens that record's full editor.
  - Unsaved edits block leaving the page.
- **Same name and icon everywhere.** Shared actions (Switch mode, Sign out, Edit, Remove, Recall, the theme button and others) take their label and icon from one table, `ACTIONS` in `source/core.js`.
- **Offline.**
  - Icons (Phosphor 2.1.1), fonts and images are stored in `Frontend/assets/`, so nothing loads from the internet.
  - A service worker caches the app on the first visit, over https or localhost.
  - A web manifest lets the app be installed.
- **Hand-off to the backend.**
  - `source/api.js` is the only stand-in for Cleo Cloud:
    - `Cleo.api`: server actions;
    - `Cleo.db`: shared records;
    - `Cleo.bus`: realtime events;
    - `Cleo.session`: who is signed in;
    - `Cleo.catalog`: the product catalog;
    - `Cleo.items`: stock items;
    - `Cleo.promos`: the promo engine.
  - In the demo, tabs of one browser talk through a BroadcastChannel, standing in for realtime sync between devices.
  - Comments are tagged so they can be listed with `grep`:
    - `BACKEND:` where server code takes over;
    - `ASSET:` for images, icons and fonts;
    - `NOTE:` for important rules.
- **Simulated today:**
  - payment gateway, card terminal and QR Ph confirmation;
  - delivery platforms;
  - SMS and email;
  - printers, scanners, scale and cash drawer;
  - sync, and the analytics history behind the dashboards.

## Roles and permissions

Access is role-based and branch-scoped: a user holds one role per branch they are assigned to, and the Cloud API enforces the same rules as the Terminal.

| Role | Scope | Main permissions |
| --- | --- | --- |
| Owner | All branches | Everything, including billing, plan changes and data deletion |
| HQ Manager | All or assigned branches | Catalog, pricing, promos, stock transfers, reports; no billing |
| Branch Manager | One branch | Approves voids, refunds and discounts; stock counts; shift reports |
| Cashier | One branch, Terminal only | Sells, takes payments, opens and closes own shift |
| Kitchen / Service Staff | One branch, Terminal or KDS only | Views and updates orders or job orders; no payments |
| Inventory Clerk | Assigned branches or warehouse | Receiving, counts, adjustments, transfers |
| Accountant | All or assigned branches, read-only | Financial and BIR reports, exports; cannot edit sales |

In the front end each role is a set of 11 permissions, edited in Back Office › Users and roles › Roles and permissions:

- sell and take payments
- give discounts
- approve voids, refunds and overrides
- see and bump kitchen orders
- edit products and prices
- receive, adjust and count stock
- view reports
- export data
- close shifts and lock periods
- manage staff and settings
- plan and billing (always the owner's)

| ID | Feature | Notes | Priority | Plan | Front end |
| --- | --- | --- | --- | --- | --- |
| USR-01 | Role-based access | Default roles above; permissions checked on Terminal and in the Cloud API | MVP | Basic | Built. Screens hide or lock what a role can't do; the Cloud API must enforce the same rules |
| USR-02 | PIN login on Terminal | 4–6 digit PIN per staff member for fast switching on a shared device | MVP | Basic | Built. 4-digit PIN; three wrong tries lock the terminal until a manager unlocks it |
| USR-03 | Manager override | Manager PIN on the spot, or remote approval from the Owner app, for voids, refunds and discounts above a set limit | MVP | Basic | Built. A remote request appears in Owner Dashboard › Live monitor, and the decision returns to the terminal |
| USR-04 | Multi-branch users | One user assigned to several branches, with a different role in each | MVP | Pro | Built. Role per branch in Back Office › Users and roles |
| USR-05 | Two-factor login | Required for Owner and HQ Manager on the web | v1.1 | Basic | Built. Authenticator code or backup code at sign-in; backup codes can be viewed, downloaded and renewed; forgot-password flow |
| USR-06 | Custom roles | Build roles from individual permissions | Later | Enterprise | Built. Add and remove custom roles; a role someone still holds can't be removed |
| USR-07 | Sign-up and social sign-in | Owners create an account with email (verified with a 6-digit code), Google or Facebook, then set up their business: name, what they sell, number of branches. Staff join by invitation, not sign-up | MVP | Basic | Built · simulated. Google and Facebook are simulated until the OAuth apps are registered |
| USR-08 | Terms and privacy consent | Sign-in and sign-up require ticking a box that accepts the Terms and Conditions and the Privacy Policy. Each acceptance records who, which version, when and how they signed in. A new version asks again | MVP | Basic | Built. Owner Dashboard › Account and security shows the versions and the date you agreed |

## Point of sale

Every business gets the core checkout; the Food & beverage, Retail and Services modules add the screens that business type needs, on the same Terminal app.

### Core checkout

| ID | Feature | Notes | Priority | Plan | Front end |
| --- | --- | --- | --- | --- | --- |
| POS-01 | Product grid and search | Category tabs, favorites, search by name or SKU, barcode scan by camera or scanner | MVP | Basic | Built · simulated. Scanner pairing and camera scans are simulated |
| POS-02 | Cart editing | Quantity, line notes, line discounts, item removal before payment | MVP | Basic | Built |
| POS-03 | Promos and automatic discounts | Percent, fixed amount, buy X get Y, bundles, scheduled happy hours; applied without cashier input | v1.1 | Basic | Built. Set in Back Office › Catalog › Promos; applied after line discounts and never on SC/PWD lines |
| POS-04 | Statutory discounts | Senior citizen and PWD: 20% discount plus VAT exemption, capturing name and ID number per sale; other statutory discounts configurable | MVP | Basic | Built |
| POS-05 | Park and recall orders | Hold an order and resume it on the same or another terminal | MVP | Basic | Partial. Park and recall on the same terminal; sharing parked orders across terminals needs the server |
| POS-06 | Voids and refunds | Void before payment; refund or return after. Reason codes and manager approval (USR-03) | MVP | Basic | Built |
| POS-07 | Invoices and receipts | 58 mm or 80 mm thermal printing; e-receipt by SMS, email or QR code | MVP | Basic | Built · simulated. Sending SMS and email is simulated |
| POS-08 | Shift management | Opening float, cash in and cash out, closing count, X-reading at shift end (ACC-02) | MVP | Basic | Built |
| POS-09 | Tax handling | VAT-inclusive prices, VAT-exempt and zero-rated items, non-VAT business mode | MVP | Basic | Built |
| POS-10 | Customer on sale | Attach a customer for loyalty, charge accounts and buyer details on the invoice (CRM-01) | MVP | Basic | Built |
| POS-11 | Customer-facing display | Second screen showing cart, total and payment QR code | Later | Pro | Built. Opens at `#/terminal/display` on a second screen; shows the cart, promos, total, the QR Ph code and a thank-you |

### Food & beverage module

| ID | Feature | Notes | Priority | Plan | Front end |
| --- | --- | --- | --- | --- | --- |
| FNB-01 | Order types | Dine-in, takeout and delivery, each with its own prices or charges | MVP | Basic | Built |
| FNB-02 | Table management | Floor plan, table status, transfer, merge and split tables | MVP | Basic | Built |
| FNB-03 | Modifiers and add-ons | Sizes, sugar and ice levels, add-ons with their own price and stock | MVP | Basic | Partial. Option groups and options per product, each with its own price, added and removed in the product editor; add-on stock is not tracked |
| FNB-04 | Kitchen ticket printing | Orders routed to kitchen or bar printers by station | MVP | Basic | Built · simulated. The station is set per product; each terminal maps stations to its printers |
| FNB-05 | Kitchen Display System | Android tablet screen per station; bump orders when done; prep-time tracking | v1.1 | Basic | Built. Kitchen view on the Terminal: tickets by station with age timers, bump and recall, all-day counts |
| FNB-06 | Split bill | By item, by seat or equal split | v1.1 | Basic | Partial. By item or into equal parts, each paid separately; by seat is not built |
| FNB-07 | Service charge | Configurable percentage, shown as its own line on the invoice | MVP | Basic | Built |
| FNB-08 | Recipe deduction | Selling a menu item deducts its ingredients from stock (INV-02) | MVP | Basic | Partial. Recipes are edited per product; the deduction itself runs on the server from synced sales |
| FNB-09 | Delivery platform orders | Pull GrabFood and foodpanda orders into Cleo | Later | Enterprise | Built · simulated. Connect in Back Office › Settings › Delivery platforms; orders arrive in Terminal › Orders to accept with a prep time, reject, mark ready and picked up, and reach the kitchen |

### Retail module

| ID | Feature | Notes | Priority | Plan | Front end |
| --- | --- | --- | --- | --- | --- |
| RTL-01 | Variants | Size, color and other options, each with its own SKU, barcode and stock | MVP | Basic | Built. Variants added and removed in the product editor |
| RTL-02 | Barcode labels | Print shelf and product labels from the catalog | v1.1 | Basic | Partial. One label from the Terminal's item editor; shelf labels from the catalog are not built |
| RTL-03 | Weighed items | Price by weight from a connected scale or manual entry | v1.1 | Basic | Built · simulated. Scale reading is simulated |
| RTL-04 | Price tiers | Retail, wholesale and member prices; quantity breaks | v1.1 | Pro | Not built |
| RTL-05 | Returns and exchanges | Return to sellable or damaged stock; exchange in one transaction | MVP | Basic | Built. Invoice lookup, refund to the original method, exchange credit |
| RTL-06 | Batch and expiry at sale | Lot and expiry captured at sale for pharmacies and groceries (INV-08) | v1.1 | Pro | Not built |

### Services module

| ID | Feature | Notes | Priority | Plan | Front end |
| --- | --- | --- | --- | --- | --- |
| SVC-01 | Appointments | Calendar per staff member and resource; walk-in queue | v1.1 | Basic | Partial. Day and week calendar per staff member; book, reschedule, cancel, no-show, and check in to a job order. Resources and a walk-in queue are not built |
| SVC-02 | Job orders | Claim-stub workflow for laundries and repair shops: Received, In progress, Ready, Claimed | MVP | Basic | Built · simulated. The "ready" SMS is simulated |
| SVC-03 | Staff assignment and commissions | Assign staff per service line; commission by percent or fixed amount | v1.1 | Pro | Partial. Staff picked per appointment; commissions are not built |
| SVC-04 | Packages and prepaid sessions | Sell bundles such as 10 sessions and track the remaining balance | Later | Pro | Not built |
| SVC-05 | Deposits | Down payments on job orders and appointments; balance due on claim | MVP | Basic | Built |

## Payments

Cleo takes cash, e-wallets through QR Ph, cards and charge accounts, and records each method separately so shift counts and gateway payouts reconcile by method.

| ID | Feature | Notes | Priority | Plan | Front end |
| --- | --- | --- | --- | --- | --- |
| PAY-01 | Cash | Quick-tender buttons (₱100, ₱500, ₱1,000), automatic change, cash drawer kick | MVP | Basic | Built · simulated. The drawer kick is simulated |
| PAY-02 | Cash in, cash out and float | Each movement logged with a reason (change fund, petty cash, payout) and counted in shift reconciliation (ACC-09) | MVP | Basic | Built |
| PAY-03 | E-wallets via QR Ph | Dynamic QR Ph code per sale through a payment gateway, so GCash, Maya and bank apps can pay; confirmed automatically by webhook | MVP | Basic | Built · simulated. The QR is drawn on the device; the gateway confirmation is simulated |
| PAY-04 | Manual e-wallet entry | Fallback when offline or the gateway is down: static QR, cashier enters the reference number, sale flagged for matching later | MVP | Basic | Built |
| PAY-05 | Card payments | Integrated terminal where the bank or gateway supports it; otherwise cashier records the approval code and last four digits | v1.1 | Basic | Built · simulated. The card tap is simulated; manual approval code and last four digits work |
| PAY-06 | Split tender | One sale paid with several methods, such as part cash and part GCash | MVP | Basic | Built. Payment also takes tips, loyalty points and charge accounts |
| PAY-07 | Charge accounts | Customer or corporate accounts (utang) with credit limit, statements, partial payments and aging: current, 30, 60, 90+ days | v1.1 | Pro | Built. Back Office › Customers › Charge accounts: limit, balance, aging, record payment, print statement; the Terminal checks the limit |
| PAY-08 | Refund to original method | Refunds follow the original method; e-wallet refunds through the gateway where supported | v1.1 | Basic | Built · simulated |
| PAY-09 | Settlement reconciliation | Matches gateway payouts and card settlements against recorded sales and flags gaps | v1.1 | Pro | Not built |
| PAY-10 | Store credit and gift cards | Issue and redeem at any branch | Later | Pro | Partial. Exchange credit on returns only; gift cards are not built |

## Inventory

Stock is tracked per branch and per storage location as a ledger of movements: every sale, receipt, transfer and adjustment is an event, and stock on hand is their sum.

| ID | Feature | Notes | Priority | Plan | Front end |
| --- | --- | --- | --- | --- | --- |
| INV-01 | Real-time stock per branch | Deducted on sale, including offline sales once synced; every movement kept in the stock ledger | MVP | Basic | Built. Stock on hand per branch and a movement ledger per item; stock that goes negative after an offline sync is flagged |
| INV-02 | Recipes and bill of materials | Ingredients per menu item or service with unit conversion (kg to g, L to mL); modifiers can deduct extra ingredients | MVP | Basic | Partial. Recipe editor per product with cost per serving; modifiers deducting extra ingredients is not built |
| INV-03 | Stock receiving | Record deliveries with quantity, cost and supplier; updates item cost (INV-08) | MVP | Basic | Built. Shows the new weighted average cost before posting |
| INV-04 | Suppliers and purchase orders | Supplier list, POs, partial receiving against a PO, supplier price history | v1.1 | Basic | Partial. Supplier per item, suggested at receiving, with a PO or receipt number; purchase orders and price history are not built |
| INV-05 | Stock adjustments | Spoilage, damage, theft, own use; reason codes and approval above a peso limit | MVP | Basic | Built |
| INV-06 | Stock counts | Full and cycle counts on Terminal or web; variance report in units and pesos | MVP | Basic | Partial. Cycle count on the web with live variance and approval above the limit; counts on the Terminal are not built |
| INV-07 | Low stock alerts | Reorder point per item per branch; alerts to manager and owner (MON-04) | MVP | Basic | Partial. One reorder point per item for every branch, not per branch; low-stock badges, filter and owner alerts work |
| INV-08 | Costing | Weighted average cost per branch; feeds cost of goods sold and gross profit (ACC-10) | MVP | Basic | Built |
| INV-09 | Batch and expiry | Lot numbers and expiry dates; first-expiry-first-out; near-expiry alerts | v1.1 | Pro | Partial. Near-expiry flags and alerts; lots and first-expiry-first-out are not built |
| INV-10 | Production | Turn raw ingredients into prepared items, such as syrups or dough, with yield tracking | Later | Pro | Not built |
| INV-11 | Bulk import and export | CSV or Excel import of catalog and opening stock; export of stock on hand | MVP | Basic | Partial. CSV import of the catalog with a preview; export of the catalog and stock on hand; opening-stock import is not built |
| INV-12 | Stock item management | Add, edit and remove stock items: name, group, stock unit, reorder point and supplier. One at a time in the item editor, or many at once in Inventory › Edit. Removing archives the item, so history stays; it is blocked while a recipe or an open transfer uses the item | MVP | Basic | Built |

## Accounting and BIR compliance

Cleo produces the BIR-required records as a by-product of selling, and gives owners expenses, cash reconciliation and profit without a separate bookkeeping tool. Full general-ledger bookkeeping stays with the accountant; exports cover the hand-off.

| ID | Feature | Notes | Priority | Plan | Front end |
| --- | --- | --- | --- | --- | --- |
| ACC-01 | Invoice series | Sequential, non-resettable invoice number per terminal (6+ digits); void, refund and return documents get their own series and reference the original invoice | MVP | Basic | Built. 8-digit invoices; VD (void), RF (return), RP (reprint), PR (payment receipt), BL (bill), TR (training) and X series. A number is taken only when the sale completes |
| ACC-02 | X-reading and Z-reading | X-reading per cashier shift; Z-reading per business day with invoice range, accumulated totals and sales breakdown | MVP | Basic | Built. X-reading at shift close; Z-reading on the terminal at end of day (manager approval). Both follow the RMO 24-2023 layout and land in Back Office › BIR and reports |
| ACC-03 | Accumulated grand total | Non-resettable running total per terminal, printed on every Z-reading | MVP | Basic | Built |
| ACC-04 | Electronic journal | Copy of every invoice and adjustment document, exportable in a readable format | MVP | Basic | Built. Every document the terminal prints is journaled; Back Office filters by terminal and type, views, prints and exports as TXT |
| ACC-05 | Invoice fields | Seller name, business style, address, TIN and VAT status; machine identification number and serial number; PTU number; supplier accreditation details; VATable, VAT-exempt and zero-rated sales and VAT amount; buyer details when required | MVP | Basic | Built. Layout per RR 7-2024 and the RMC 77-2024 samples; buyer prompt at ₱1,000 or more (configurable) |
| ACC-06 | Statutory sales books | Senior Citizen, PWD, National Athletes and Coaches, Solo Parent and Medal of Valor sales books with buyer ID and discount details | MVP | Basic | Built. From the journal; each book uses its own rate and VAT treatment |
| ACC-07 | Sales summary and exports | Daily sales summary and sales journal export in the format the accountant files from | MVP | Basic | Built. Plus the backend reports (ACC-18) |
| ACC-08 | Expense tracking | Expenses by category and branch with receipt photo; paid from the cash drawer (PAY-02) or bank | MVP | Basic | Built. Add, edit and delete; locked periods can't be changed |
| ACC-09 | Cash reconciliation | Expected vs counted cash per shift and per day; over or short per cashier | MVP | Basic | Built |
| ACC-10 | Profit computation | Net sales minus cost of goods sold (INV-08) minus expenses, per branch and period; gross margin per item | MVP | Basic | Built |
| ACC-11 | Period lock | A closed period's sales, expenses and stock can no longer be edited; reopening is logged (MON-08) | v1.1 | Basic | Built |
| ACC-12 | Excel and CSV exports | Every report exportable; the Accountant role gets read-only access | MVP | Basic | Built |
| ACC-13 | Accounting software sync | Push daily sales, expenses and cost of goods sold as journal entries to QuickBooks Online or Xero | Later | Enterprise | Not built |
| ACC-14 | BIR activity log | User ID, timestamp, activity and data values for every change, as accreditation requires (MON-08) | MVP | Basic | Built. Back Office › Audit trail |
| ACC-15 | Void, return and reprint | Void only before the Z-reading, with a reason and a manager; returns issue a return document that references the invoice and refunds what was paid; reprints print REPRINT and are logged | MVP | Basic | Built. Terminal › Shift and Returns |
| ACC-16 | Training mode | Practice sales print TRAINING RECEIPT under their own series and never reach the grand total, readings or reports | MVP | Basic | Built. Terminal › Settings, manager approval |
| ACC-17 | Tamper checks | Sales stop if the device clock runs behind the last document; a Z-reading missing from an earlier day is flagged at sign-in; a terminal can't be unregistered before its Z-reading | MVP | Basic | Built |
| ACC-18 | Backend reports and eSales | BIR sales summary, void, return, reprint and discount reports per month; the monthly eSales figures per machine (template to confirm with the BIR) | MVP | Basic | Built. Back Office › BIR and reports › Backend reports |
| ACC-19 | Business buyers and zero-rated sales | Buyer's registered name, TIN, address and business style on the invoice; zero-rated sales to PEZA or BOI enterprises and other qualified buyers | MVP | Basic | Built. Payment › Add buyer; Customers with a TIN fill it in |

**Compliance notes**

- Software developers apply for accreditation under RMO No. 24-2023, and invoices must follow RR No. 7-2024; certificates under the older RMC 107-2019 rules expired on 31 July 2025 ([PwC Tax Alert on RMC 72-2025](https://www.pwc.com/ph/en/tax/tax-publications/tax-alerts/2025/tax-alert-22.html)).
- Each client still registers its own terminals and holds a Permit to Use (PTU); PTUs stay valid when a developer's certificate expires (same source).
- The report and field list above comes from secondary summaries ([BIR compliance checklist](https://hashmato.atlassian.net/wiki/spaces/DINEPLAN/pages/425132042/BIR+Compliance+Checklist), [POS audit trail requirements](https://www.respicio.ph/commentaries/audit-trail-requirements-for-pos-accreditation-in-the-philippines)).
- `Docs/Cleo BIR Compliance Review.md` checks the front end against RMO 24-2023, RR 7-2024 and RMC 77-2024, lists what was added for launch, and lists what the backend, Aeso and each client still have to do.

## Owner dashboard and analytics

The dashboard answers three questions at a glance: how much did we sell, how much did we keep, and which branch, product or hour drove it. Figures update within seconds of a synced sale.

| ID | Feature | Notes | Priority | Plan | Front end |
| --- | --- | --- | --- | --- | --- |
| DASH-01 | KPI tiles | Gross sales, net sales, gross profit, margin %, transactions, average ticket; each against the same period last week | MVP | Basic | Built |
| DASH-02 | Revenue and profit trends | Day, week, month or custom range; revenue, cost of goods sold, expenses and net profit together | MVP | Basic | Partial. Day, week and month; a custom range is not built |
| DASH-03 | Product performance | Top and bottom sellers by quantity, revenue and margin; slow movers | MVP | Basic | Built |
| DASH-04 | Sales by hour and weekday | Heatmap of peak hours for staffing and prep | v1.1 | Basic | Built |
| DASH-05 | Payment mix | Share of cash, e-wallet, card and charge sales per period | MVP | Basic | Built |
| DASH-06 | Profit and loss summary | Net sales, cost of goods sold, gross profit, expenses by category, net profit (ACC-10) | MVP | Basic | Built |
| DASH-07 | Branch comparison | Branches side by side on every KPI, with ranking (BR-05) | MVP | Pro | Built |
| DASH-08 | Staff performance | Sales, transactions, voids and discounts per staff member (MON-06) | v1.1 | Pro | Built. Also over or short and hours from the time clock, with a detail drawer per person |
| DASH-09 | Inventory insights | Stock value, shrinkage from adjustments and count variances, days of stock left | v1.1 | Pro | Built |
| DASH-10 | Targets | Sales targets per branch and period, with progress | Later | Pro | Not built |
| DASH-11 | Daily summary | End-of-day push notification and email with sales, profit and open alerts | v1.1 | Basic | Partial. Turned on and timed in Owner Dashboard › Settings › Notifications; sending is server side |
| DASH-12 | Mobile owner view | Full dashboard in the Android app and on mobile web | MVP | Basic | Built. Phone layout with a bottom tab bar; installable as an app |
| DASH-13 | Product mix analysis | Items grouped by popularity and margin to guide pricing and menu changes | Later | Pro | Not built |
| DASH-14 | Activity | A calendar of daily net sales for the last 26 weeks, with sales, items sold, net sales, active days, peak hour and top seller for all time, 30 days or 7 days, and a breakdown by branch (or by terminal for one branch) | v1.1 | Basic | Built. Needs a daily sales report endpoint (BACKEND note in owner.js) |

## Multi-branch interconnectivity

Branches share one catalog, one customer base and one stock network under HQ control, while each branch keeps its own prices, stock, invoices and BIR records.

| ID | Feature | Notes | Priority | Plan | Front end |
| --- | --- | --- | --- | --- | --- |
| BR-01 | Central catalog | HQ keeps the master list of products, recipes and modifiers; changes push to all or selected branches | MVP | Pro | Built. Catalog › Edit adds, changes and removes many products in one save; each product also has its own editor. Removing archives the product so past sales keep it |
| BR-02 | Branch overrides | Per-branch price, availability and tax settings without duplicating the product | MVP | Pro | Partial. Price and availability per branch; tax per branch is not built |
| BR-03 | Central promos | Promos targeted by branch, date and time | v1.1 | Pro | Built |
| BR-04 | Inter-branch stock transfers | Request, approve, dispatch, receive; stock shows as in transit; short or damaged quantities flagged on receipt | MVP | Pro | Built |
| BR-05 | Consolidated reporting | Every report shows all branches combined, side by side, or one at a time | MVP | Pro | Built |
| BR-06 | Shared customers and loyalty | One customer profile, points balance and charge account across branches (CRM-01) | MVP | Pro | Built |
| BR-07 | Branch setup templates | Copy catalog, settings, roles and printer setup from an existing branch to open a new one | v1.1 | Pro | Not built |
| BR-08 | Central warehouse or commissary | Non-selling location that holds stock and supplies branches on request | v1.1 | Enterprise | Not built |
| BR-09 | Transfer costing | Stock moves at weighted average cost, so each branch's profit stays correct | MVP | Pro | Built |

&#91;embedded content: Inter-branch stock transfer (BR-04) · 6 steps, 1 check\]

A rejected request goes back to the requester. A shortfall found at receiving is posted as a stock adjustment with a reason (INV-05), so both branches' counts stay true.

## Monitoring and audit trail

Monitoring tells the owner what is happening now and flags what looks wrong; the audit trail records who changed what, so every flag can be traced to a person and a time.

| ID | Feature | Notes | Priority | Plan | Front end |
| --- | --- | --- | --- | --- | --- |
| MON-01 | Live sales feed | Real-time stream of sales, voids and refunds across branches, filterable by branch and terminal | MVP | Basic | Built. Sales made on a Terminal in another tab appear live |
| MON-02 | Terminal status | Online or offline, last sync time, unsynced transaction count, app version per terminal | MVP | Basic | Built. Owner Dashboard › Live monitor and Back Office › Devices |
| MON-03 | Exception alerts | Push alerts for voids, refunds and discounts above a threshold, drawer opens without a sale, price overrides, terminals offline too long | MVP | Pro | Built. Each threshold is one number in Back Office › Settings › Approvals and limits; push delivery is server side |
| MON-04 | Inventory alerts | Low stock, near-expiry items and count variances above a set peso value | MVP | Basic | Built |
| MON-05 | Time clock | Clock in and out by PIN on the Terminal, optional selfie; attendance and hours report | v1.1 | Pro | Partial. Clock in and out on the PIN screen; attendance in Shift and hours in Staff performance; the selfie is not built |
| MON-06 | Cashier metrics | Sales, transactions, void rate, discount rate and over or short per cashier and shift | v1.1 | Pro | Built |
| MON-07 | Shift close review | Each closed shift shows counted vs expected cash, approvals given and exceptions, for manager sign-off | MVP | Basic | Built |
| MON-08 | Audit trail | Who, what, when, and before and after values for prices, stock, settings, users and voided or refunded sales; append-only | MVP | Basic | Built |
| MON-09 | Login and device log | Sign-ins, failed PIN attempts, new devices and permission changes | v1.1 | Basic | Partial. Signed-in devices in Owner Dashboard › Account and security, and sign-ins and failed PINs in the audit trail; there is no separate log screen |
| MON-10 | Extended audit retention | Audit trail searchable online beyond the standard window; standard retention per plan is an open question | Later | Enterprise | Not built |

## Customers and loyalty

A customer is one profile across every branch, found by mobile number, with points, purchase history and any charge account attached.

| ID | Feature | Notes | Priority | Plan | Front end |
| --- | --- | --- | --- | --- | --- |
| CRM-01 | Customer profiles | Name, mobile number, email, birthday, TIN and address for invoices; consent captured under the Data Privacy Act (RA 10173) | MVP | Basic | Built. Add, edit and remove. Removing erases the profile and is blocked while a charge balance is owed |
| CRM-02 | Quick lookup | Find a customer by mobile number or scanned member QR at any branch | MVP | Basic | Built · simulated. The member QR scan is simulated |
| CRM-03 | Points program | Earn points per peso spent, redeem as a discount; points kept as a ledger of earn and redeem events | MVP | Pro | Built. Earn rate and point value are in settings; manual adjustments need a reason |
| CRM-04 | Membership tiers | Tiers by spend, with their own earn rate and perks | v1.1 | Pro | Partial. Tiers are shown (Member, Gold, Corporate); tier rules can't be configured |
| CRM-05 | Purchase history | Every sale per customer across branches; favorite items | MVP | Basic | Built |
| CRM-06 | SMS and email promos | Send promos to customer segments, such as birthdays or lapsed customers, with opt-out | Later | Pro | Not built |
| CRM-07 | Statutory discount profiles | Saved senior citizen or PWD ID details to speed up repeat discounted sales (POS-04) | MVP | Basic | Built |

## Offline-first sync and platform

Every Terminal keeps selling with no internet and syncs when the connection returns. Conflicts are avoided by design: sales are append-only, stock moves as deltas, and HQ owns the catalog.

### Sync rules

| Data | Written on | Sync rule |
| --- | --- | --- |
| Sales, invoices, payments | Terminal | Append-only, uploaded in order with idempotency keys; corrected only by void or refund documents, never edited |
| Invoice numbers | Terminal | Each Terminal owns its own series, as BIR registers each machine, so offline numbering never collides |
| Stock movements | Terminal and Back Office | Sent as deltas and summed in the Cloud; stock may go negative while offline and is flagged on sync |
| Loyalty points | Terminal | Earn and redeem events; offline redemption capped at the last-synced balance |
| Catalog, prices, promos | Back Office (HQ) | Cloud wins; Terminals pull changes and apply them between sales |
| Customers | Terminal and Back Office | Merged by mobile number; last write wins per field |
| Settings and users | Back Office | Cloud wins |

In the front end, products and stock items are never deleted: removing them archives them, because invoices, transfers and the ledger still reference them.

### Platform features

| ID | Feature | Notes | Priority | Plan | Front end |
| --- | --- | --- | --- | --- | --- |
| SYS-01 | Offline selling | Local database on each Terminal; selling, invoicing, printing, cash handling and shift close work without internet | MVP | Basic | Built · simulated. Tap the connection pill to go offline; sales wait in an outbox and upload when the connection returns |
| SYS-02 | Sync engine | Background queue with retries; sync status visible to cashier and owner (MON-02) | MVP | Basic | Built · simulated |
| SYS-03 | Offline limits | Need internet: QR Ph auto-confirmation (PAY-04 is the fallback), live cross-branch points, stock transfers, remote approvals. Manager PIN works offline | MVP | Basic | Built |
| SYS-04 | Hardware support | ESC/POS thermal printers over Bluetooth, USB and LAN; cash drawers; barcode scanners; Android POS devices with built-in printers | MVP | Basic | Built · simulated. Device settings and test flows exist; the hardware itself is simulated |
| SYS-05 | Multi-tenant cloud | Each business's data isolated; branch and role checks on every API call | MVP | Basic | Server |
| SYS-06 | Security | Encryption in transit and at rest, hashed PINs, each Terminal registered to a branch | MVP | Basic | Partial. Terminal registration and unregistering are built; encryption and PIN hashing are server side |
| SYS-07 | Backups and data export | Daily backups; owner can export all business data at any time | MVP | Basic | Partial. Each report and list exports; a one-click export of all business data is not built; backups are server side |
| SYS-08 | Locale | Peso currency, Asia/Manila time, English interface | MVP | Basic | Built |
| SYS-09 | Filipino interface | Full Filipino translation of the Terminal app | v1.1 | Basic | Not built. Listed as coming in Back Office › Settings › Regional |
| SYS-10 | Remote updates | App updates and settings pushed to Terminals; minimum version enforced | v1.1 | Basic | Partial. Back Office › Devices shows each terminal's version and updates it; minimum-version enforcement is server side |
| SYS-11 | Open API and webhooks | For e-commerce, delivery platform and accounting integrations | Later | Enterprise | Not built |
| SYS-12 | Installable offline web app | One app for all three modes; icons, fonts and images bundled with it; a service worker caches it so it opens with no connection; installable from the browser | MVP | Basic | Built |

**Performance targets to confirm:** adding an item to the cart in under 200 ms on a mid-range Android device; a sale reaching the dashboard within 10 seconds when online; at least 7 days of offline selling without data loss.

## Plan tiers

Three plans priced per terminal, with no limit on branches. Prices are samples until pricing is set; the front end reads them from Frontend/content/plans.md.

| Plan | Terminals | Access | Price shown in the front end |
| --- | --- | --- | --- |
| Basic | Up to 5 | Terminal only | ₱3,000 per terminal a month (sample) |
| Pro | Up to 20 | Full access to the Owner Dashboard, Back Office and Terminal | ₱4,500 per terminal a month (sample) |
| Enterprise | Unlimited | A custom POS powered by Cleo POS | Custom price |

NOTE: the Plan column in the feature tables above was set when plans were split by branch count. Under per-terminal pricing, Basic covers the Terminal only, so features of the Owner Dashboard and Back Office marked Basic need Pro (see Open questions).

Owner Dashboard › Plan and billing shows terminals in use against the plan's limit, the monthly total (price times terminals), compares plans and lists invoices. The plans' names, prices, limits and feature lists are written in Frontend/content/plans.md, which the app reads, so they can be changed without touching code. The subscription is paid by card (handled on the payment provider's page, so the app never collects card details) or from a GCash, Maya or GoTyme Bank account linked for automatic payment, approved in the wallet's own app. The Owner Dashboard, Back Office and Terminal show the plan's name in a tab at the foot of their navigation; Pro's is animated and Enterprise's is a step up from Pro's.

## Open questions

- [ ] Per-terminal plans: Basic is Terminal only. Which features in the tables above move from Basic to Pro, and does a Basic business get any owner reporting (for example the daily summary) without the Owner Dashboard? The front end does not lock modes by plan yet.
- [ ] Which module launches first: Food & beverage, Retail or Services? The priorities above assume core features of all three ship at MVP.
- [ ] Will Aeso apply for BIR accreditation as the software developer under RMO No. 24-2023, and how long before a first client can get a PTU?
- [ ] Does BIR accept the Terminal plus Cloud as one accredited system, or must each Terminal hold the full electronic journal locally?
- [ ] Should Cleo transmit invoices to BIR's Electronic Invoicing System for clients required to use it?
- [ ] Which payment gateway handles QR Ph and cards: PayMongo, Xendit, Maya Business or a bank partner?
- [ ] Which Android phones, tablets and POS devices with built-in printers will be certified?
- [ ] Final plan pricing and branch and terminal limits. The front end shows sample prices.
- [ ] Audit trail retention per plan (MON-10) and the data hosting region.
- [ ] Reorder points (INV-07): keep one per item, as built, or set one per item per branch?
- [ ] Parked orders across terminals (POS-05): confirm the server endpoint that shares them within a branch.
- [ ] Removing a customer (CRM-01): which buyer details must stay on past invoices under RA 10173 and BIR rules?
- [ ] Features built ahead of their priority (POS-11, FNB-09, SVC-01, USR-06): do they keep their plan gates (Pro, Enterprise) at launch?
- [ ] Legal review of the Terms and Conditions and Privacy Policy (`Docs/`): company details, Data Protection Officer, NPC registration, and the commitments each document lists at the top.
- [ ] Register Cleo with Google and Meta for sign-in (OAuth client IDs, consent screens, the public privacy policy URL).
