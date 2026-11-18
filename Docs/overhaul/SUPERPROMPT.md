# CLEO OVERHAUL — SUPERPROMPT LOOP (v2: Supabase + Hostinger)

> **Repository note (added 2026-11-19).** This repository keeps its documents in `Docs/` (capital D). Every `docs/...` path below means `Docs/...` (for example `Docs/PROGRESS.md`). The repository and its GitHub Pages site are public: exploitable security detail goes in the git-ignored `Docs/private/` folder, never in committed files. See `CLAUDE.md` and `Docs/PROGRESS.md`.

Paste everything below this line into Claude Code at the root of the Cleo repository. Fill in the CONFIG block first. If a session ends before the loop finishes, start a new session and paste the same superprompt again: it resumes from `docs/PROGRESS.md`.

---

## 0. CONFIG (owner fills in)

```
MODE                 = GATED   # owner decision 2026-11-19: stop for approval after every phase
PRODUCTION_URL       = https://cleopos.online            # Hostinger. Interim live host: GitHub Pages (to retire)
STAGING_URL          = none yet — owner creates a Hostinger staging subdomain (e.g. staging.cleopos.online) before Phase 2
SUPABASE_PROD_REF    = ntbkbvlsgymupjdpuvob              # supabase/config.toml
SUPABASE_STAGING_REF = none yet — owner creates a staging project or enables branching before Phase 2 (G8 if it costs money)
SUPABASE_PLAN        = see Docs/architecture/CURRENT_STATE.md (read from the dashboard in Phase 1)
HOSTINGER_PLAN       = see Docs/architecture/CURRENT_STATE.md (read from hPanel in Phase 1)
HOSTINGER_DEPLOY     = see Docs/architecture/CURRENT_STATE.md (Docs/DEPLOY_HOSTINGER.md documents File Manager ZIP upload)
MAIL_DOMAIN          = cleopos.online
ARCHITECTURE         = Docs/architecture/Cleo-POS-System-Architecture-Design.pdf
BRANCH_PREFIX        = cleo-overhaul
```

## 1. MISSION

You are the engineering lead for Cleo, an agentic-coding-led cloud POS that combines the terminal, the back office and the owner's dashboard in one system. Run a six-phase overhaul, strictly in this order:

1. System Architecture → 2. Frontend → 3. Functions → 4. Backend → 5. Database → 6. Cybersecurity

The System Architecture Design (ARCHITECTURE in CONFIG) is the foundation and the basis for every phase. When any instruction conflicts with it, the architecture wins: record the conflict in PROGRESS.md and handle it as a HARD GATE. The one exception is the FIXED PLATFORM (section 1A): the owner has fixed it, and it overrides the architecture's infrastructure and technology recommendations.

## 1A. FIXED PLATFORM (owner decision — do not re-evaluate)

- **Database and backend:** the CURRENT Supabase setup — Postgres, Auth, Data API, Edge Functions, Storage, Realtime, Cron (pg_cron), Queues (pgmq) and Vault.
- **Deployment, domains and mail:** the CURRENT Hostinger account — hosting, domains and DNS, SSL, CDN, and email.
- **Tech stack:** the CURRENT stack. Do not introduce new frameworks, runtimes, hosting providers or paid services. Do not replace Supabase or Hostinger.

**Mapping.** Apply the architecture's PRINCIPLES on this platform. Wherever the architecture names a generic component, use the Supabase or Hostinger equivalent:

| Architecture names | Use instead |
|---|---|
| NestJS modular monolith (12 modules) | Supabase: one Postgres schema or folder per module, plus RLS, database functions (RPC) and Edge Functions grouped by module. Modules talk only through RPC or functions, never by reading each other's tables. |
| PostgreSQL | Supabase Postgres |
| Redis, BullMQ workers | Supabase Cron (pg_cron + pg_net) and Supabase Queues (pgmq), consumed by Edge Functions |
| Object storage | Supabase Storage (private buckets by default) |
| Sync gateway `/v1/sync` push and pull | Edge Functions (for example `sync-push` and `sync-pull`) or database RPC functions |
| WebSocket "new changes" notice | Supabase Realtime |
| Identity, OIDC, MFA | Supabase Auth (MFA, rate limits, CAPTCHA), with Hostinger mail as custom SMTP |
| Containers, Singapore region, Terraform | Existing Supabase project region and Hostinger hosting. Infrastructure-as-code means the Supabase CLI (`supabase/config.toml`, `supabase/migrations`) plus versioned Hostinger config (`.htaccess`, or the server config on a VPS) |
| CDN, WAF, DDoS protection | Hostinger CDN (including its "Under Attack" mode) or Cloudflare through Hostinger, whichever the plan has |
| Health endpoints | A `health` Edge Function (database and queue check) plus a static status check on Hostinger |
| Monitoring | Supabase logs, reports, Security Advisor and Performance Advisor; log drains only if the plan already includes them |
| Staging | A separate Supabase staging project (or Supabase branching), plus a Hostinger staging subdomain |

If the architecture needs something this platform cannot provide, do not add a new service. Record the gap and raise HARD GATE G6.

## 2. STANDING RULES (apply in every phase and every iteration)

1. **Source of truth:** `docs/architecture/CLEO_ARCHITECTURE.md` (created in Phase 1), the ADRs in `docs/architecture/adr/`, and section 1A. Before each phase, read them and every earlier phase's handoff document.
2. **Never break:**
   - offline selling on terminal screens
   - sequential per-terminal invoice numbers
   - the non-resettable grand total
   - append-only money and tax records (voids and refunds are new records)
   - idempotent writes
   - card data never entering Cleo
   - no training mode and no "no sale" mode (BIR)
3. Money is integer centavos (`bigint`). Store timestamps as `timestamptz` in UTC, plus a `business_date` in Asia/Manila.
4. **Branches are stacked:** Phase 1 works on `BRANCH_PREFIX/phase-1-architecture` from `main`; each later phase branches from the previous phase's branch.
   - Never push to `main` or merge.
   - Never deploy to Hostinger production.
   - Never run `supabase db push` or deploy Edge Functions against SUPABASE_PROD_REF. Production deploys are done by the owner.
   - You MAY deploy to staging (SUPABASE_STAGING_REF and the Hostinger staging subdomain).
5. **Schema changes:** only through Supabase CLI migrations in `supabase/migrations`, committed to the repo. Never change the schema through the dashboard SQL editor. Regenerate types after each schema change (`supabase gen types`).
6. Make small commits with clear messages, one concern each. Run the build, type-check, lint and tests (including `deno check` and `deno lint` for Edge Functions) before every commit once they exist.
7. **Production is READ-ONLY:**
   - On Hostinger: pages, safe GET requests, response headers, file listings, logs.
   - On Supabase production: the dashboard, logs, advisors, and read-only SQL using a read-only role.
   - Never write data, never change settings, and never run load or attack tests against production.
8. **Secrets:**
   - Never print, log, commit or paste them.
   - The frontend may hold ONLY the Supabase project URL and the PUBLISHABLE key (`sb_publishable_…`, or the legacy `anon` key until it is migrated). Data in the browser is protected by RLS.
   - SECRET keys (`sb_secret_…`, or legacy `service_role`), database passwords, SMTP credentials and third-party keys live only in Edge Function secrets, Supabase Vault, or a git-ignored local `.env`.
   - Never put secrets in Hostinger `public_html`.
   - `.env.example` holds placeholders only.
9. **Evidence over assumption:** every claim in a report cites file paths, command output, dashboard screenshots or SQL results.
10. **Cost changes need approval:** any change that would cost money (Supabase plan, compute size, PITR, read replicas, Hostinger plan or add-ons) is HARD GATE G8.

## 3. THE LOOP

Run this loop until every phase is DONE.

```
LOOP:
  1. LOAD STATE
     Read docs/PROGRESS.md. If it does not exist, create it from the template in section 6.
  2. PICK
     Select the first phase whose status is not DONE.
     If it is BLOCKED or WAITING, report why and stop.
  3. PREPARE
     Check out (or create) that phase's branch.
     Read its spec in section 4, section 1A, CLAUDE.md, and the handoff documents of all earlier phases.
     Write the phase's step checklist into PROGRESS.md. Set status IN_PROGRESS.
  4. EXECUTE
     Work through the checklist one step at a time.
     After each step: commit, tick the step in PROGRESS.md, and log any decision or conflict.
  5. VERIFY
     Test the phase against its DONE WHEN criteria (on local or staging).
     If a criterion fails, fix and re-verify, up to 3 attempts per criterion.
     If it still fails: set status BLOCKED, write what failed and why, and go to REPORT.
  6. HANDOFF
     Write the phase's handoff document(s) and a phase report in PROGRESS.md:
     what changed, evidence, open issues, notes for later phases,
     and the exact production deploy steps for the owner (Supabase and Hostinger).
  7. GATE
     If a HARD GATE was hit: set status WAITING, report, and STOP.
     If MODE = GATED: set status DONE (pending owner merge and deploy), report, and STOP.
     If MODE = AUTO: set status DONE and continue the LOOP.
  8. CONTEXT CHECK
     If this session's context is getting long, save full state to PROGRESS.md
     and STOP with: "Context checkpoint — start a new session and paste the superprompt to resume."

WHEN ALL SIX PHASES ARE DONE:
  Run the FINAL ACCEPTANCE CHECKLIST (section 5) on staging, record the results in PROGRESS.md,
  and give the FINAL REPORT (section 7).
```

### HARD GATES (always stop and ask, in any MODE)

- **G1:** A task conflicts with the architecture or an ADR.
- **G2:** The Functions scope (ADD / REMOVE / QUARANTINE lists) is ready for owner approval. Do this before building anything in Phase 3.
- **G3:** A secret was found in the code, the frontend bundle, Hostinger `public_html`, or git history. The owner must rotate it.
- **G4:** Any action would touch production, delete data, or cannot be undone.
- **G5:** A security control would break offline selling or BIR compliance.
- **G6:** A need the fixed platform (Supabase, Hostinger, current stack) cannot meet without adding a new service, framework or provider.
- **G7:** A phase is BLOCKED after 3 fix attempts.
- **G8:** A change would cost money: a Supabase plan or compute change, PITR, read replicas, or a Hostinger plan or add-on.

When resuming after a gate, read the owner's answer from the chat (or from the `OWNER DECISIONS` section of PROGRESS.md), record it, and continue.

## 4. PHASE SPECS

### PHASE 1 — SYSTEM ARCHITECTURE

**Role:** Lead software architect. Do not change application code in this phase.

**Steps:**
1. Read ARCHITECTURE end to end. If you cannot read the PDF, set the phase to WAITING and ask for a text export.
2. Write `docs/architecture/CLEO_ARCHITECTURE.md`, a faithful Markdown version that keeps the section numbers, the 7 principles, all tables, the 12 modules, ADRs 001–010 and the section 14 fixes. Add a final section, "Platform mapping", reproducing section 1A of this superprompt.
3. Write `docs/architecture/CURRENT_STATE.md`, citing file paths:
   - **Frontend stack** and versions; every page and screen (including `index.html` and `landing.html`).
   - **Hostinger:** plan type; web server (Apache / LiteSpeed via `.htaccess`, or Nginx / Apache on a VPS); deploy method; domains, subdomains and DNS records (names only); SSL status; CDN or Cloudflare status; mailboxes and mail DNS (SPF, DKIM, DMARC present or not).
   - **Supabase:** plan; region; Postgres version; schemas, tables and row counts; RLS status per table; database functions and triggers; Edge Functions; Storage buckets and their policies; Auth providers and settings; Realtime usage; enabled extensions; cron jobs; queues; key type in use (legacy `anon`/`service_role` or publishable/secret); whether `supabase/` (CLI config and migrations) exists in the repo.
   - Browser storage in use; environment variable NAMES only; existing tests, CI, linting and monitoring.
4. Write `docs/architecture/GAP_ANALYSIS.md`. For each principle and each module, give:
   - status: met / partly / not met / n/a yet
   - evidence
   - the gap
   - the owning phase
   Order the gaps by risk: lost sales, BIR numbering, double charges and data leaks first.
5. Write ADRs in `docs/architecture/adr/`, each with context, decision, consequences and revisit when:
   - **ADR-011 Cloud POS and offline selling:** the back office and dashboard stay cloud-first on Supabase; terminal screens keep selling offline using the current stack (for example, a service worker plus an IndexedDB outbox that syncs to Supabase through the sync Edge Functions).
   - **ADR-012 Fixed platform:** the owner has fixed the current stack, Supabase for the database and backend, and Hostinger for deployment, domains and mail. Record the section 1A mapping. This supersedes the architecture's ADR 008 and its NestJS, Redis, container and Terraform recommendations. Not to be re-evaluated.
   - **ADR-013 Browser storage:** only pending sale records may be stored, in IndexedDB, with minimal fields, cleared after cloud acknowledgement. Never store tokens beyond what the Supabase client needs for the session, never passwords, card data or ID numbers. Prefer the Supabase PKCE flow, with the session handled by the Supabase client; document where the session is stored and why.
   - **ADR-014 Environments:** production and staging Supabase projects and Hostinger sites; how migrations and Edge Functions move from staging to production; who runs production deploys (the owner).
   - Any other decision the gap analysis forces.
6. Create or merge `CLAUDE.md` at the root, keeping existing rules. Add the STANDING RULES (section 2), section 1A, the HARD GATES list (G1–G8), the handoff document locations, and the exact commands for build, test, lint, Supabase CLI (link, migration new, db diff, db push to staging, functions serve and deploy to staging, gen types) and Hostinger staging deploy.

**Handoff:** CLAUDE.md, CLEO_ARCHITECTURE.md, CURRENT_STATE.md, GAP_ANALYSIS.md, the ADRs.

**DONE WHEN:**
- Every principle and module has a status backed by evidence.
- The Supabase and Hostinger inventories are complete.
- CLAUDE.md exists.
- `git diff` shows no application code changes.

### PHASE 2 — FRONTEND

**Role:** Senior frontend developer and product designer.

**Problem:** the current gridbox design (visible grids, boxed panels, techy chrome) reads as futuristic and tech-driven, not professional. Replace it entirely with an Apple-based design system built on ease of use, minimalism and professionalism, mostly based on iOS, iPadOS and macOS. Liquid Glass is the core material. **Keep the current fonts exactly. Keep the current frontend stack** (no new UI framework).

**Skills (the owner installs these before the loop):**
- **Impeccable:** `/impeccable critique` and `/impeccable audit` first, then distill, quieter, typeset, layout, animate, polish and harden.
- **Taste Skill** (`taste-skill:design-taste-frontend`): its redesign flow and multi-width headless Chrome checks.
- **UI/UX Pro Max** (`/ui-ux-pro-max`): design-system generation and UX checks for a POS / business SaaS product.
- **Emil Kowalski skills:** apple-design, animate, choreograph, review-animations, animation-performance.

If a skill is missing, note it in PROGRESS.md and continue without it.

**References:** apple.com and claude.com. Learn from their restraint, spacing, type hierarchy, product-first imagery and calm motion. Never copy their assets, logos or copy.

**Steps:**
1. Inventory every gridbox pattern (classes, CSS, components, background grids, decorative borders, scanlines, glows) in `docs/design/GRIDBOX_REMOVAL.md`. Record the current font families. Run the Impeccable critique and audit, and save them with screenshots at 375, 768, 1024 and 1440 px to `docs/design/AUDIT_BEFORE.md`.
2. Write `docs/design/DESIGN_GUIDELINES.md`, specific enough to build any new screen from. It must contain:
   - **A. Foundations**
     - Apple-style type scale from the EXISTING fonts (Large Title through Caption: sizes, weights, line heights, tracking).
     - `tabular-nums` for all prices, totals, quantities, times and table columns.
     - Neutral greys for light and dark mode, plus ONE accent colour (derived from the existing brand if there is one) and semantic success, warning and destructive colours. WCAG AA contrast: 4.5:1 for body text, 3:1 for large text.
     - A 4/8 pt spacing scale. Group with spacing, not boxes.
     - Concentric radii: inner = outer − padding.
     - One light source from above.
     - One icon set with one stroke weight.
   - **B. Liquid Glass**
     - Tokens as CSS custom properties: tint, blur, saturation, border highlight, specular edge, shadow.
     - Glass ONLY on navigation and overlays: tab bars, toolbars, sidebars, sheets, popovers, menus, the floating cart summary.
     - Content surfaces stay solid: tables, receipts, forms, reports, product lists.
     - Required fallbacks: `prefers-reduced-transparency: reduce` and `prefers-contrast: more` switch to solid; `@supports not (backdrop-filter: blur(1px))` uses solid; `prefers-reduced-motion: reduce` removes non-essential motion.
     - At most two blurred layers in view; never blur large scrolling areas.
   - **C. Motion**: each principle as a Cleo rule with duration, easing and an example.
     - Squash and stretch: press scale about 0.97, then spring back.
     - Anticipation wind-up: sheets make a small counter-move; handles respond on touch-down.
     - Staging the focus: dim the background behind sheets and dialogs.
     - Pose to pose: defined start and end states.
     - Follow through: a light spring settle.
     - Slow in and slow out: ease-in-out to move, ease-out to enter, ease-in to exit.
     - Moving in arcs: an item flies to the cart on a curve.
     - Secondary action: the cart badge bumps.
     - Snappy timing: micro 120–180 ms, transitions 200–300 ms, never over 400 ms.
     - Exaggerated feedback: a short shake on invalid input, a clear brief success state.
     - Solid drawing in 3D: consistent light, shadow and highlight.
     - Overall appeal: calm and premium; remove motion that does not aid understanding.
   - **D. UX laws**: each as a measurable rule.
     - Fitts's law and bigger hit areas: at least 44×44 pt; primary POS actions (Charge, Add, Pay) at least 56 px tall, within easy reach.
     - Hick's law: one primary action per view; 5–7 top-level navigation items at most; progressive disclosure.
     - Doherty threshold: acknowledge input within 100 ms; show a loading state if anything takes over 400 ms. Show Supabase calls optimistically where safe.
     - Postel's law: accept "₱1,000", "1000" and "1,000.00" and normalise them; strict output formatting.
     - Jakob's law: Apple and mainstream POS conventions; no novel controls for standard tasks.
     - Frequency of use: the most frequent actions are biggest and closest; rare ones go into menus.
   - **E. Refinement rules**, each with a do / don't example: Delete filler badges. Drop redundant labels. Unitalicize random words. Mono only where needed (codes, IDs, receipts). Use a design system based on Apple. Show the actual product. Enlarge the main feature. Group with spacing. Make headlines specific. Emphasize the CTA. Add an accent color. Keep icons consistent. Remove embellishments. Inner radius = outer − padding. Improve text contrast. Wrap headlines properly. Align by eye, not by pixels. Use tabular numbers. Add the loading states. Animate useful feedback.
   - **F. Components:** buttons (primary, secondary, plain, destructive), inputs, segmented control, tab bar, sidebar, toolbar, sheet, popover, alert, toast, table, list rows, empty states, skeletons. For each: anatomy; states (default, hover, pressed, focus-visible, disabled, loading); sizes; tokens.
3. Implement the tokens in one stylesheet (for example `styles/tokens.css`). Use tokens only: no hard-coded colours, radii or durations. Remove every gridbox pattern and its unused CSS and assets.
4. Rebuild `landing.html` and `index.html`:
   - `landing.html`: a specific headline, the real product shown large, one emphasised CTA, sections grouped by spacing.
   - `index.html`: the app shell with a glass navigation layer and solid content.
   - Keep the IDs, data attributes, form names and Supabase client calls that scripts depend on, or update every reference.
   - Selling screens render from local data and never block on a Supabase call.
5. **Clean URLs on Hostinger:**
   - Write a route map in the guideline (for example landing → `/`, app → `/app`, login → `/login`).
   - Shared or Cloud hosting: implement with `.htaccess` rewrite rules (Apache / LiteSpeed). On a VPS: use the server config already in use.
   - Add 301 redirects from every old `.html` URL to its clean URL, without redirect loops, and preserve query strings.
   - Update internal links, canonical tags, the sitemap and service worker caches.
   - Update the Supabase Auth Site URL and Redirect URLs list so auth emails and OAuth return to the new clean URLs (on staging; give the production values to the owner).
   - No visible URL ends in `.html`.
   - Test on the Hostinger staging subdomain.

**Rules:**
- No new UI framework.
- Semantic HTML, visible focus, keyboard navigation, aria labels on icon-only buttons.
- Animate only transform and opacity; no layout shift.

**Handoff:** DESIGN_GUIDELINES.md, GRIDBOX_REMOVAL.md, AUDIT_BEFORE.md, screenshots in `docs/design/AFTER/`, the token stylesheet, the rebuilt pages, `.htaccess` (or server config), and the Auth redirect URL list.

**DONE WHEN:**
- A search finds no gridbox code and no visible `.html` links.
- Every old `.html` URL returns 301 on Hostinger staging.
- Every token text and background pair passes AA.
- Both pages render correctly at 375, 768, 1024 and 1440 px, in light and dark mode, and with reduced transparency and reduced motion on.
- Auth flows still return to the right pages.
- The Impeccable re-audit findings are fixed or justified.

### PHASE 3 — FUNCTIONS

**Role:** Senior full-stack engineer. Goal: every client-facing function is complete, simple and professional, built on the current stack and Supabase.

**Steps:**
1. Audit every function in the codebase AND on production (read-only): UI actions, pages, Supabase tables used directly from the client, database functions (RPC), triggers, Edge Functions, cron jobs, queues, Storage buckets, Auth flows and webhooks. Compare the repository with what is deployed on Hostinger and on SUPABASE_PROD_REF. Write `docs/functions/FUNCTIONS_AUDIT.md` with one row per function:
   - location (file path, RPC name, Edge Function name, route)
   - architecture module (section 6.1)
   - deployed? (repo only / production only / both / neither)
   - works end to end? (evidence from staging)
   - used? (reachable from the UI / called by other code / seen in Supabase or Hostinger logs)
   - verdict: KEEP, FIX, ADD, REMOVE or QUARANTINE
   - reason, judged on simplicity, ease of use and professionalism
2. Add ADD rows for missing Phase 0–1 roadmap functions:
   - cash sale with change
   - receipt and invoice printing with sequential per-terminal numbers (assigned on the terminal, validated in Postgres)
   - X-reading and Z-reading
   - shifts and cash in/out
   - QR Ph payment intent (gateway webhook into an Edge Function)
   - basic catalog and stock
   - users and roles in the back office (Supabase Auth plus a roles table and RLS)
   - the owner's dashboard summary
   - sync push and pull Edge Functions for the offline outbox
3. **HARD GATE G2:** post the counts per verdict, the ADD list by priority, and the REMOVE and QUARANTINE lists. Wait for approval.
4. After approval:
   - **FIX:** make each broken function work end to end on staging, with tests.
   - **ADD:** build each one inside its module (schema or folder), with integer centavos, idempotency keys, append-only financial tables (no UPDATE or DELETE policies), RLS on every new table, local-first terminal screens and DESIGN_GUIDELINES.md for the UI. Business rules that must not be bypassed (invoice numbering checks, grand total, approvals) live in database functions or Edge Functions, never only in the browser.
   - **REMOVE:** hide or remove only the client entry points, and mark the backend items (Edge Functions, RPC, tables, buckets) for Phase 4.
   - Every client-facing function gets empty, loading, error and success states, plain-language messages, and a role-based permission check enforced by RLS or the function.
5. Write `docs/functions/USABILITY_FRAMEWORK.md`: fewest steps, one primary action per screen, undo or confirm for destructive actions, consistent naming, errors that say what happened and what to do. Score every KEEP and ADD function against it.

**Rules:**
- Merge overlapping functions. Propose removing rarely used, complex ones.
- No editing or deleting of issued invoices.
- No new services: use Supabase features only (G6 if impossible).

**Handoff:** FUNCTIONS_AUDIT.md (final statuses), USABILITY_FRAMEWORK.md, migrations, Edge Functions, frontend code and tests; production deploy steps for the owner.

**DONE WHEN:**
- Every client-reachable function works end to end on staging (Hostinger staging plus SUPABASE_STAGING_REF), with tests.
- The audit is complete, with evidence.

### PHASE 4 — BACKEND

**Role:** Senior backend engineer doing a full quality pass on Cleo's Supabase backend: database functions, triggers, RLS policies, Edge Functions, Storage, Auth configuration and the client data layer.

**Steps:**
1. Baseline: install, build, type-check, lint, the full test suite, `deno check` and `deno lint` on all Edge Functions, `supabase db lint`, and the Security and Performance Advisor results for staging. Save the exact output to `docs/backend/BASELINE.md`.
2. Sweep for errors, including ones earlier phases missed:
   - build, type and lint errors; failing or skipped tests
   - Edge Function runtime errors (Supabase function logs) and Postgres errors (Supabase Postgres logs), read-only on production
   - unhandled rejections, missing awaits, swallowed errors, missing input validation in Edge Functions and RPC
   - money as `numeric`, `float` or JS floating point; timestamps without a time zone; missing `business_date`
   - writes without idempotency keys
   - financial rows that are updated or deleted instead of appended
   - modules reading each other's tables directly (violates section 6.1)
   - N+1 queries from the client, multi-step writes without a transaction (move them into one RPC), missing constraints
   - drift between the repo migrations and the actual schema (`supabase db diff`); create migrations to capture any dashboard-made changes
   - duplicated logic, inconsistent error formats
   Log each in `docs/backend/BACKEND_REPORT.md` with severity, location and fix.
3. Fix all critical and high issues, plus small, safe medium ones, each with a test.
4. Delete an item (file, Edge Function, RPC, trigger, table, bucket) only if (a) the Functions audit marks it REMOVE, or (b) it is proven unused:
   - no imports or client calls
   - no references from other functions, triggers or cron jobs (search for its name as a string too)
   - no hits in the Supabase or Hostinger logs
   - not used by build or deploy scripts
   Anything uncertain goes to the QUARANTINE list. Database objects are removed through migrations, never in the dashboard. Never drop a table that holds financial or audit data: mark it deprecated instead. Delete in separate commits and list every item with its reason.
5. Engineering standards:
   - one error format from Edge Functions and RPC, with no stack traces or SQL errors in responses
   - structured JSON logs with request, tenant and terminal IDs, and no secrets or personal data
   - an `idempotency_keys` table plus helper: store the key and response, replay on repeat, reject the same key with a different payload; used by every write RPC and Edge Function
   - a `health` Edge Function (database round trip and queue depth)
   - Edge Function secrets validated at startup, failing fast if any are missing
   - generated TypeScript types from the schema, used by the client
   - an up-to-date `.env.example` (placeholders only)

**Handoff:** BASELINE.md, BACKEND_REPORT.md (issues, fixes, deleted items, quarantine list, final check output), migrations, production deploy steps for the owner.

**DONE WHEN:**
- A fresh clone passes install, build, type-check, lint, test, `deno check`, `deno lint` and `supabase db lint` with zero errors.
- `supabase db diff` against staging shows no drift.
- Every KEEP and ADD function works on staging.
- Every write is idempotent.

### PHASE 5 — DATABASE

**Role:** Senior database reliability engineer. Goal: the Supabase database and the Hostinger-served app stay alive and fast under major traffic, with an efficient schema and workflow.

**Targets** (architecture section 14.1):
- 3,000 terminals
- about 900,000 sales and 5.4 million sync events per day
- about 125 events per second average and 500 per second peak
- p95 API latency under 500 ms
- 99.9% monthly availability

If the current SUPABASE_PLAN or compute size cannot meet a target, measure how far off it is, estimate the plan or compute needed, and raise G8. Do not upgrade anything yourself.

**Steps:**
1. Document the database in `docs/database/DB_RESILIENCE.md`: plan, compute size, region, Postgres version, schemas, tables, indexes, row counts and growth, connection limits, pooler settings, backup type (daily or PITR), and Realtime and Auth rate limits. Use `pg_stat_statements` and the Performance Advisor on staging to record the top 20 queries by total time.
2. Stay alive:
   - The `health` Edge Function (from Phase 4) checks the database and queues; add a simple uptime check that calls it and the Hostinger site.
   - Server-side and serverless code (Edge Functions, any scripts) connects through the Supavisor pooler in transaction mode (port 6543) or the supabase-js client, never with direct connections per request.
   - Statement timeouts and idle-in-transaction timeouts set per role (for example shorter for `anon` and `authenticated`).
   - Retry with backoff in the sync client and Edge Functions; the terminal outbox absorbs Supabase downtime (architecture principle 1).
   - Alerts or a daily check for connection saturation, disk usage, slow queries, failed cron jobs and queue backlog.
3. Efficient schema:
   - add missing primary keys, foreign keys, NOT NULL and CHECK constraints
   - add indexes from evidence (Performance Advisor and index advisor); remove unused or duplicate indexes
   - every tenant table gets an index that leads with `tenant_id`, and the RLS policies use it
   - RLS performance: wrap `auth.uid()` and JWT lookups in `(select …)`, index the policy columns, avoid joins inside policies where a security-definer helper with a fixed `search_path` is faster
   - monthly partitions on the events, invoices and e-journal tables
   - heavy reports run from materialised views refreshed by pg_cron, or from a read replica if the plan has one (G8 if adding one); never on the checkout path
   - fix the N+1 queries in BACKEND_REPORT.md by moving them into RPC functions
4. Safe workflow:
   - Supabase CLI migrations only, using expand-then-contract and rollback notes; test every migration on staging first
   - seed data for local and staging only (`supabase/seed.sql`)
   - Backups: record the current setup. Daily backups can lose up to 24 hours of data; PITR narrows that to minutes. If PITR is not enabled, recommend it under G8 and state the data-loss window in the meantime.
   - A restore runbook, plus a real restore drill into the STAGING project, with the time it took
   - Retention of at least 5 years for e-journal and sales records: archive old partitions to a private Supabase Storage bucket as compressed exports
5. Load test on STAGING only (k6), covering the `sync-push` and `sync-pull` Edge Functions, checkout RPC, Data API reads and reports:
   - 500 events per second sustained for 10 minutes
   - a spike to 2× peak
   - a soak of at least 1 hour at average load
   Record throughput, p50 / p95 / p99 latency, error rate, database CPU and connections, and Edge Function errors. Fix bottlenecks and re-run until the targets pass, or until only a G8 compute decision remains.
   - If SUPABASE_PLAN is Team or Enterprise and the test is heavy, remind the owner that Supabase asks for at least 2 weeks' notice through a support ticket.
   - Never load test production or Hostinger production.

**Rules:**
- Never update or delete append-only financial records in a migration.
- Hand security findings to Phase 6.

**Handoff:** DB_RESILIENCE.md (before and after, decisions, load results, restore drill, cost decisions needed), migrations, cron jobs, load test scripts, production deploy steps for the owner.

**DONE WHEN:**
- The load test meets the targets on staging, or the exact compute or plan needed is documented under G8.
- The restore drill succeeded.
- Every schema change ships as a migration.

### PHASE 6 — CYBERSECURITY

**Role:** Senior application security engineer. Cleo is used at enterprise scale and holds sales, tax and personal data: apply the highest standard of security and integrity across the current stack, Supabase and Hostinger.

**Steps:**
1. **Threat model:** write `docs/security/THREAT_MODEL.md` covering assets, actors and entry points. Entry points include: Hostinger pages, the Supabase Data API, RPC functions, Edge Functions, Storage, Auth, Realtime, webhooks, the sync endpoints, hPanel and DNS, and mailboxes. List the top risks per entry point.
2. **Frontend security:**
   - **HTTPS everywhere:** Hostinger SSL active and forced; HTTP redirected in `.htaccess`; HSTS; no mixed content.
   - **Input validation and sanitisation:** on the client for usability, and in Postgres constraints, RPC and Edge Functions for security; output encoding; no `innerHTML` with user data; a strict Content-Security-Policy that allows only the Supabase project domain and required origins.
   - **Never store sensitive data in the browser:** enforce ADR-013.
   - **CSRF protection:** Supabase calls use bearer tokens rather than cookies; any cookie-based endpoint (on Hostinger or in Edge Functions) needs SameSite cookies plus CSRF tokens or origin checks.
   - **Never expose API keys in the frontend:** only the publishable (or legacy `anon`) key may appear.
     - Scan the frontend bundle, Hostinger `public_html` and the FULL git history (for example with gitleaks) for secret, `service_role`, SMTP, database or third-party keys.
     - Move every secret to Edge Function secrets or Vault, and keep local copies in a git-ignored `.env`.
     - Block dotfiles and `.env` from being served in `.htaccess`.
     - Add a pre-commit secret scan.
     - Any exposed key triggers G3 (the owner rotates it).
   - **Migrate Supabase keys:** move from legacy `anon` and `service_role` keys to publishable and secret keys (Supabase is deprecating the legacy keys by the end of 2026); then the owner disables the legacy keys.
3. **Backend security:**
   - **Authentication fundamentals:** Supabase Auth with email confirmation on, a strong password policy, leaked-password protection if the plan supports it, MFA (TOTP) required for owners and admins, sensible session and JWT expiry, CAPTCHA on sign-up, login and reset, and tuned Auth rate limits. Cashier PINs are hashed in Postgres (pgcrypto, crypt with bf) and checked by a rate-limited RPC.
   - **Authorization checks:**
     - RLS enabled on EVERY table in exposed schemas, with policies based on `tenant_id` and role.
     - Cross-tenant access must fail (tested).
     - Manager approval for voids, refunds, price overrides and cash movements is enforced in RPC.
     - Views use `security_invoker = true`.
     - Security-definer functions set a fixed `search_path` and check the caller's role.
     - Only the schemas the app needs are exposed through the Data API.
   - **API endpoint protection:**
     - Edge Functions verify the JWT by default (an explicit public allow-list for webhooks, which must verify signatures).
     - Request schema validation; payload size limits.
     - Signed terminal sync requests.
     - No secret-key client in any code path reachable by users.
   - **SQL injection prevention:** supabase-js query builder or parameterised RPC only; no string-built SQL in Edge Functions or database functions (`format()` with `%I`/`%L`, or EXECUTE … USING, where dynamic SQL is unavoidable).
   - **Basic security headers** in `.htaccess` (or the VPS config): CSP, Strict-Transport-Security, X-Content-Type-Options: nosniff, Referrer-Policy, Permissions-Policy, frame-ancestors 'none' (or X-Frame-Options: DENY); remove server and version banners where the plan allows. Edge Functions return the same headers.
   - **DDoS protection:** enable the Hostinger CDN or Cloudflare through Hostinger (whichever the plan has), with a documented "Under Attack" mode procedure; Supabase Auth rate limits; application-level rate limits in Edge Functions and RPC.
4. **Practical security:**
   - **Keep dependencies updated:** audit npm and Deno dependencies, fix high and critical issues, pin with lockfiles, automate update PRs; keep the Supabase CLI and supabase-js current; keep the Postgres version current (an upgrade is an owner decision).
   - **Proper error handling:** generic messages to clients, detailed logs on the server, no stack traces or SQL errors exposed, no secrets or personal data in logs.
   - **Secure cookies:** any cookies set by Hostinger or Edge Functions are HttpOnly, Secure, SameSite, with narrow Path and Domain and sensible expiry.
   - **File upload security** (Supabase Storage):
     - private buckets by default
     - bucket-level allowed MIME types and file size limits
     - Storage RLS policies scoped by `tenant_id`
     - random object names, with content checked server-side in an Edge Function before use
     - images re-encoded
     - signed URLs with short expiry for downloads
     - nothing executable served from Hostinger upload folders
   - **Rate limiting:** Supabase Auth rate limits for login and reset, plus per-account and per-IP limits in Edge Functions and the PIN RPC for login, PIN entry, sync and public endpoints, returning 429 with Retry-After.
5. **Database security and integrity:** evaluate the database and add whatever is missing.
   - Security Advisor shows zero errors and justified warnings only.
   - Least privilege: `anon` and `authenticated` cannot UPDATE or DELETE append-only financial tables (no such policies, plus revoked grants); migrations run as the owner role; no secret-key usage outside Edge Functions.
   - **Network restrictions** on direct database access (Hostinger and admin IPs only), with **SSL enforcement** on.
   - Field-level encryption for Senior Citizen / PWD ID numbers (pgsodium or Vault-managed keys, or encryption in an Edge Function), masked in views.
   - A hash-chained e-journal per terminal, with a pg_cron verification job that alerts on chain breaks or invoice-number gaps.
   - An audit log table for logins, role changes, voids, refunds, exports and admin actions, written by triggers or RPC, append-only.
   - Backups: confirm encryption and access; restrict Supabase dashboard access with org roles and MFA for every member.
   - Hostinger account: 2FA on hPanel, SSH keys only (no password SSH on a VPS), least-privilege FTP or SSH users, the malware scanner enabled, Git deploy keys read-only.
   - **Mail security:** SPF, DKIM and DMARC for MAIL_DOMAIN in Hostinger DNS. Start DMARC at `p=none`, then move to `quarantine` or `reject` once reports pass. Supabase Auth uses Hostinger mail as custom SMTP with a dedicated mailbox (not a personal one); check that Hostinger's sending limits cover auth email volume, and report under G6 if they do not.
   - A secrets-rotation procedure for Supabase keys, the database password, SMTP and third-party keys.
   - Any other risk found, with its control.
6. **Verify:**
   - CI jobs: dependency audit, secret scan, static analysis, `supabase db lint`, RLS policy tests (for example pgTAP), and an OWASP ZAP baseline scan against the Hostinger STAGING site.
   - Tests for authorization (cross-tenant access, role escalation), CSRF where relevant, rate limits, input validation, Storage policies and security headers.
   - `docs/security/SECURITY_REPORT.md`: every control from steps 2–5, with its status, location (file path, migration, dashboard setting) and test evidence; plus residual risks by severity, including Data Privacy Act and PCI DSS items from architecture section 9.

**Rules:**
- No attack testing against production.
- Dashboard settings that cannot be set from the CLI are listed as exact owner steps for production (apply on staging yourself only if you have access).
- If a control would break offline selling or BIR compliance, stop at HARD GATE G5.

**Handoff:** THREAT_MODEL.md, SECURITY_REPORT.md, migrations, Edge Functions, `.htaccess` or server config, CI jobs, tests, and the owner's production checklist (Supabase settings, Hostinger settings, DNS records, key rotation).

**DONE WHEN:**
- Every listed control is implemented or documented as an owner step, with test evidence.
- The Security Advisor is clean.
- CI scans show no high or critical findings.
- The secret scan of the full history is clean, or every finding is rotated.
- SPF, DKIM and DMARC pass.

## 5. FINAL ACCEPTANCE CHECKLIST (run on staging after Phase 6)

1. **Offline selling still works:** disconnect, ring up cash sales, print, reconnect. Every sale reaches Supabase exactly once.
2. Invoice numbers are sequential per terminal with no gaps (run the e-journal verification job).
3. The `authenticated` role cannot update or delete financial records (SQL test).
4. Replaying a payment or sync request with the same idempotency key returns the same result; there is no double charge.
5. No gridbox code remains; AA contrast passes; reduced transparency and reduced motion work.
6. Every old `.html` link returns 301 to its clean URL on Hostinger, and auth emails land on clean URLs.
7. Every KEEP and ADD function in FUNCTIONS_AUDIT.md works on staging.
8. A fresh clone passes build, type-check, lint, test, `deno check`, `deno lint` and `supabase db lint`; `supabase db diff` shows no drift.
9. The load test meets the targets, or the G8 compute decision is documented.
10. The Security Advisor is clean, and CI dependency, secret and ZAP scans show no high or critical findings.
11. Only the publishable key appears in the frontend; the full-history secret scan is clean; every exposed key has been rotated; legacy Supabase keys are scheduled for disabling.
12. Cross-tenant access tests fail as expected (RLS).
13. SPF, DKIM and DMARC pass for MAIL_DOMAIN, and Supabase Auth emails send through Hostinger SMTP.

## 6. PROGRESS.md TEMPLATE

Create `docs/PROGRESS.md` on the first run:

```
# Cleo Overhaul — Progress
MODE: [GATED|AUTO]          LAST UPDATED: [timestamp]
PLATFORM: current stack · Supabase (prod: [ref], staging: [ref]) · Hostinger ([plan])

| # | Phase               | Branch                                   | Status      |
|---|---------------------|------------------------------------------|-------------|
| 1 | System Architecture | cleo-overhaul/phase-1-architecture       | NOT_STARTED |
| 2 | Frontend            | cleo-overhaul/phase-2-frontend           | NOT_STARTED |
| 3 | Functions           | cleo-overhaul/phase-3-functions          | NOT_STARTED |
| 4 | Backend             | cleo-overhaul/phase-4-backend            | NOT_STARTED |
| 5 | Database            | cleo-overhaul/phase-5-database           | NOT_STARTED |
| 6 | Cybersecurity       | cleo-overhaul/phase-6-security           | NOT_STARTED |
Statuses: NOT_STARTED, IN_PROGRESS, WAITING (hard gate), BLOCKED, DONE

## CURRENT PHASE CHECKLIST
- [ ] ...

## DECISIONS AND CONFLICTS LOG
- [date] [phase] decision / conflict — evidence — outcome

## OWNER DECISIONS
- (the owner writes answers to hard gates here)

## OWNER PRODUCTION DEPLOY STEPS (per phase)
- Supabase: migrations to push, Edge Functions to deploy, dashboard settings to change
- Hostinger: files to upload / Git deploy, .htaccess, DNS records, SSL/CDN settings

## PHASE REPORTS
### Phase N — summary, evidence, open issues, notes for later phases

## FINAL ACCEPTANCE RESULTS
```

## 7. REPORT FORMAT

**At every stop**, give a short report:
- phase and status
- what was done (with evidence links)
- what failed or is open
- the hard gate question, if any, written so the owner can answer in one line
- the production deploy steps for the owner
- the exact next step when resumed

**FINAL REPORT** (after the checklist):
- one line per phase on the outcome
- the checklist results
- keys to rotate
- cost decisions pending (G8)
- residual risks by severity
- the ordered production rollout for the owner: merge branches 1 → 6, push Supabase migrations, deploy Edge Functions, apply dashboard settings, deploy to Hostinger, update DNS and mail records, then verify

**BEGIN NOW:** read the CONFIG, then start the LOOP.
