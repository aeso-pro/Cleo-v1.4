# Cleo Overhaul — Progress
MODE: GATED          LAST UPDATED: 2026-11-19 07:10 Asia/Manila
PLATFORM: current stack · Supabase (prod: ntbkbvlsgymupjdpuvob, staging: none yet) · Hostinger (plan: see CURRENT_STATE.md)

The loop's instructions are in [`Docs/overhaul/SUPERPROMPT.md`](overhaul/SUPERPROMPT.md). To resume in a new session, paste that file into Claude Code at the repository root.

| # | Phase               | Branch                                   | Status      |
|---|---------------------|------------------------------------------|-------------|
| 1 | System Architecture | cleo-overhaul/phase-1-architecture       | IN_PROGRESS (paused: owner prioritised the frontend) |
| 2 | Frontend            | cleo-overhaul/phase-2-frontend           | IN_PROGRESS |
| 3 | Functions           | cleo-overhaul/phase-3-functions          | NOT_STARTED |
| 4 | Backend             | cleo-overhaul/phase-4-backend            | NOT_STARTED |
| 5 | Database            | cleo-overhaul/phase-5-database           | NOT_STARTED |
| 6 | Cybersecurity       | cleo-overhaul/phase-6-security           | NOT_STARTED |
Statuses: NOT_STARTED, IN_PROGRESS, WAITING (hard gate), BLOCKED, DONE

## CONFIG (resolved)
| Key | Value | Source |
|---|---|---|
| MODE | GATED | Owner, 2026-11-19 |
| PRODUCTION_URL | https://cleopos.online (Hostinger) | Owner, 2026-11-19. The app is live on GitHub Pages in the meantime (interim host). |
| STAGING_URL | none yet | Owner creates a Hostinger staging subdomain before Phase 2 |
| SUPABASE_PROD_REF | ntbkbvlsgymupjdpuvob | `supabase/config.toml:2` |
| SUPABASE_STAGING_REF | none yet | Owner creates a staging project or enables branching before Phase 2 |
| SUPABASE_PLAN | see `Docs/architecture/CURRENT_STATE.md` | Read from the dashboard in Phase 1 |
| HOSTINGER_PLAN | see `Docs/architecture/CURRENT_STATE.md` | Read from hPanel in Phase 1 |
| HOSTINGER_DEPLOY | see `Docs/architecture/CURRENT_STATE.md` | `Docs/DEPLOY_HOSTINGER.md` documents a File Manager ZIP upload |
| MAIL_DOMAIN | cleopos.online | |
| ARCHITECTURE | `Docs/architecture/Cleo-POS-System-Architecture-Design.pdf` | Copied from the owner's file, 2026-11-19 |
| BRANCH_PREFIX | cleo-overhaul | |

## REPOSITORY CONVENTIONS FOR THIS LOOP
- **`docs/` means `Docs/`.** The repository keeps its documents in `Docs/` (capital D). Windows treats both spellings as one folder and `.htaccess` blocks both, so every `docs/...` path in the superprompt is written to `Docs/...`.
- **The repository is public.** GitHub Pages serves the repository's files, including `Docs/`. Exploitable security detail (live settings, specific weaknesses with file and line) goes in the git-ignored `Docs/private/` folder. Committed documents refer to those items as `S-n` with a severity and an owning phase.
- **No build, lint or type-check exists yet.** `index.html` and `landing.html` are built files edited directly; after editing them, run `node tools/update-security.js`. Tests: `supabase/tests` (`npm test`).

## CURRENT PHASE CHECKLIST (Phase 2 — Frontend)
Skills: Impeccable (critique, audit; then distill, quieter, typeset, layout, animate, polish, harden), Taste Skill `design-taste-frontend`, Emil Kowalski `apple-design`, `animate`, `review-animations` — installed. **Not installed:** UI/UX Pro Max (`/ui-ux-pro-max`), Emil `choreograph` and `animation-performance`; continuing without them (superprompt Phase 2 allows this).
- [x] 1a. Inventory every gridbox pattern and the current fonts → `Docs/design/GRIDBOX_REMOVAL.md`
- [x] 1b. Before-screenshots at 375, 768, 1024, 1440 px, light and dark (landing, sign-in, Owner, Back Office, Terminal, setup/plans) → `Docs/design/BEFORE/` (44 images, demo data only)
- [x] 1c. Impeccable critique (dual-agent) and audit → `Docs/design/AUDIT_BEFORE.md` (app 26/40 + 12/20; landing 22/32 + 14/20; snapshots in `.impeccable/critique/`)
- [x] 2. `Docs/design/DESIGN_GUIDELINES.md` (sections A–F, page structure, route map, checklist; AA pairs computed)
- [x] 3. Token stylesheet; remove every gridbox pattern and its unused CSS/JS (remaining items moved into step 4)
  - [x] 3a. `styles/tokens.css` written from the guidelines (fonts, type, space, radii, light/dark/system colours, glass with all four fallbacks, motion, browser surfaces). **Not linked into any page yet.**
  - [x] 3b. `styles/tokens.css` linked from `index.html`, `landing.html`, `admin/index.html`; added to `sw.js` FILES and to `tools/build-app-web.js` (Electron/Android copies). The app's and admin's old `:root` token blocks are replaced by aliases of the new tokens (no new colours); `applyBrand` now sets `--accent-pressed`, `--accent-text`, `--accent-fill`. The landing aliases its tokens but stays dark until its rebuild.
  - [x] 3c (app). Removed from `index.html`: `Ripple`, `ambient` (lit grid), `gridMark`, `emblem3d` (WebGL), `LiquidGlass` (SVG refraction), the pointer sheen, grain, rim bevels, accent glows and every call site (~74 KB). Loading screen = static emblem + spinner (default wait 3.4 s → 1.2 s); sign-in art = static emblem on wide screens. `node --check` passes on all inline scripts; `update-security.js --check` passes; headless check: sign-in, Owner (charts render), Back Office, Terminal, landing load in light and dark.
  - [ ] 3c (rest) moves into step 4, where the components are rebuilt: lit-box selection rings (8), the Terminal device stage (`stage.framed`), plan tier looks (`tier-*`, `t-elite`), and all landing grid/trace/port code (removed by the landing rebuild). The §6 search currently finds 19 lines in `index.html`, 46 in `landing.html`, 0 in the admin CSS.
- **Resume point:** step 4. (Earlier checkpoint text, still valid for tooling:) Resume in a new session: paste `Docs/overhaul/SUPERPROMPT.md`; read `CLAUDE.md`, `Docs/design/DESIGN_GUIDELINES.md`, `GRIDBOX_REMOVAL.md`, `AUDIT_BEFORE.md`. Before-screenshots were made with a headless-Edge CDP script (sign in to the demo with any password and any 6-digit code except 000000, pick branch `.bcard`, register terminal `[data-reg]`, staff `[data-s="c1"]`, PIN typed as keys, `[data-open]`); recreate it for the AFTER shots. Run Git Bash commands that pass `#/…` routes with `MSYS_NO_PATHCONV=1`.
- [ ] 4. Rebuild `landing.html` and `index.html` (keep IDs, data attributes, form names and Supabase calls; selling screens never block on Supabase)
- [ ] 5. Clean URLs in `.htaccess` with 301s from every `.html`; internal links, canonical, sitemap, service worker; Auth redirect URL list (staging values; production values for the owner)
- [ ] 6. Verify DONE WHEN (search, AA pairs, 4 widths × light/dark × reduced transparency/motion, auth return paths, Impeccable re-audit); screenshots → `Docs/design/AFTER/`
- Blocked until the owner creates them: Hostinger staging subdomain (301 tests on Apache) and a Supabase staging project (Auth redirect URLs). Local checks run on `tools/serve.js` in the meantime.

## PHASE 1 CHECKLIST (paused — System Architecture)
- [x] 0. Create the branch from `origin/main` (ffdef82), copy the architecture PDF into `Docs/architecture/`, save the superprompt as `Docs/overhaul/SUPERPROMPT.md`, ignore `Docs/private/`, create this file
- [x] 1. Read the architecture end to end (pdftotext + pymupdf tables and page renders; all 28 pages)
- [x] 2. Write `Docs/architecture/CLEO_ARCHITECTURE.md` (faithful Markdown + "Platform mapping")
- [~] 3. Write `Docs/architecture/CURRENT_STATE.md` — repository inventory, public DNS/headers and public Auth settings done; live dashboard and hPanel passes deferred (list in CURRENT_STATE §9)
- [ ] 4. Write `Docs/architecture/GAP_ANALYSIS.md` (7 principles + 12 modules, ordered by risk)
- [ ] 5. Write ADR-011 to ADR-015 in `Docs/architecture/adr/`
- [x] 6. Write `CLAUDE.md` at the repository root
- [ ] 7. Verify DONE WHEN, write the phase report, push the branch

## DECISIONS AND CONFLICTS LOG
The nine conflict decisions from the owner's *Cleo Change Plan and Execution Prompts* (v2.0, section 5) are carried by the superprompt. Recorded here so every phase can cite them:
- 2026-11-19 · all · **Cloud POS vs offline-first** — back office and owner's dashboard stay cloud-first on Supabase; terminal screens keep selling offline through a local outbox that syncs through Edge Functions — Principle 1, ADR 001 — ADR-011.
- 2026-11-19 · all · **Architecture's NestJS, Redis, containers, Terraform and React Native vs the fixed platform** — current stack, Supabase and Hostinger are fixed; principles apply through the platform mapping; a real limitation is gate G6 — Section 11, ADR 008 (superseded) — ADR-012.
- 2026-11-19 · all · **"Never store sensitive data in the browser" vs offline sales and the login session** — only pending sale records in IndexedDB, cleared after cloud acknowledgement; the Supabase session follows a documented policy; never passwords, card data or ID numbers — Sections 5.2, 9.3 — ADR-013.
- 2026-11-19 · 2 · **Liquid Glass vs readable text** — glass on navigation and overlays only; content stays solid; solid fallbacks for reduced transparency, more contrast and browsers without backdrop-filter — Section 3.2.
- 2026-11-19 · 4 · **Removing unused code vs functions not yet built** — delete only items the Functions audit marks REMOVE or that are proven unused; database objects only through migrations; never drop financial or audit tables — ADR 002.
- 2026-11-19 · all · **Scanning the live server vs production safety** — Hostinger and Supabase production are read-only to Claude; Claude deploys to staging only; each phase ends with production steps for the owner — Section 10.2.
- 2026-11-19 · 6 · **"Never expose API keys" vs Supabase's browser key** — the frontend holds only the project URL and the publishable key; secret keys live in Edge Function secrets, Vault or a local `.env`; Phase 6 moves to the new key types — Section 9.4.
- 2026-11-19 · 5 · **Capacity targets vs the current Supabase plan** — load test on staging; if the plan or compute falls short, document it and stop at G8; PITR and read replicas are owner decisions — Sections 7.6, 14.1.
- 2026-11-19 · 6 · **Hostinger mail as the Supabase Auth sender** — a dedicated Hostinger mailbox as custom SMTP with SPF, DKIM and DMARC; check sending limits, G6 if too low — Section 9.3.

Phase 1 entries:
- 2026-11-19 · 1 · **`docs/` vs `Docs/`** — the superprompt names `docs/`; the repository uses `Docs/` and the filesystem is case-insensitive — all handoff documents go in `Docs/`.
- 2026-11-19 · 1 · **ADR folder** — the architecture (section 12) suggests `docs/adr/NNN-title.md`; the superprompt says `docs/architecture/adr/` — ADRs go in `Docs/architecture/adr/`, numbered from 011 to continue the architecture's 001–010.

## OWNER DECISIONS
- 2026-11-19 · **Priority:** "Prioritize the frontend for now." Phase 1 is paused with the live inventory, the gap analysis and the ADRs still open; Phase 2 (Frontend) starts on `cleo-overhaul/phase-2-frontend`, stacked on the Phase 1 branch. Phase 1 resumes afterwards.
- 2026-11-19 · **Loop mode:** GATED — stop after every phase for review and merge.
- 2026-11-19 · **Git:** commit on stacked `cleo-overhaul/phase-N-*` branches and push those branches to GitHub; never push to `main` or merge. This replaces the earlier "push every change to main" rule for overhaul work.
- 2026-11-19 · **Public repository:** push the branches, but keep live security findings out of committed files (git-ignored `Docs/private/`).
- 2026-11-19 · **Production:** https://cleopos.online on Hostinger. GitHub Pages (the current live site) is an interim host to retire.
- 2026-11-19 · **Live inventory:** read the Supabase dashboard and hPanel in the built-in browser, read-only (no settings changed, no keys revealed).
- 2026-11-19 · **Phase 2 design direction** (after the before-audit): (1) Cleo's signature is **the real product** — actual Terminal and dashboard screens shown large; the emblem stays a small static mark. (2) **Plans differ by content only** — identical solid cards, the recommended plan gets the one filled button and a "Recommended" label; the plan tab leaves the working sidebar. (3) **Keep both** Owner Dashboard extras (26-week Activity heatmap and the receipt trivia), restyled to the new system. (4) The **Terminal follows the device** appearance (light/dark from the system), switchable in Settings.

## OWNER PRODUCTION DEPLOY STEPS (per phase)
- Phase 1: none. Documentation only; review and merge the branch when ready.

## PHASE REPORTS
### Phase 1 — paused 2026-11-19 (resume notes)
- Done: architecture PDF in the repo and converted to `Docs/architecture/CLEO_ARCHITECTURE.md`; `CURRENT_STATE.md` (repository, public DNS, headers and Auth settings); `CLAUDE.md`; this file; superprompt saved with CONFIG.
- Open: live Supabase dashboard and hPanel read-only passes (CURRENT_STATE §9 lists each screen); `GAP_ANALYSIS.md`; ADR-011 to ADR-015.
- Draft findings to carry into the gap analysis (evidence in CURRENT_STATE.md):
  - Lost sales: the Terminal outbox is in memory only (`index.html:12628-12644`); invoices, e-journal and fiscal counters live only in device `localStorage`; the server keeps a sale summary with `sold_at` = upload time and no `business_date` (`202611180008_plans_branches_staff.sql:485-528`); no store hub (architecture ADR 007, fix 1).
  - BIR: no server-side numbering continuity, grand total, Z-readings or e-journal copy; the Terminal has a **Training mode** (`TR-` series, `index.html:8870-8910,13023,15579-15586`) and an **"Open drawer without a sale"** action behind a manager PIN (`index.html:5917,15092`) — both conflict with the standing rule "no training mode and no 'no sale' mode" and architecture fix 7. Removal goes on the Phase 3 REMOVE list (gate G2).
  - Double counting: sale upload ignores a repeat without comparing payloads; most write RPCs take no idempotency key; money is stored as `numeric(14,2)`, whole-peso `integer`, JSON numbers and JS floats rounded to 2 dp (`index.html:8813`).
  - Data protection: security items S-1 to S-8 in the git-ignored `Docs/private/SECURITY_GAPS.md`.
  - Platform: everything in `public` (no module schemas); no partitions, cron, queues, health function, monitoring or CI tests; no staging; production domain still parked.
  - Card data: met — the card tender records brand, approval code and last 4 digits only (`index.html:14110-14138`).
- Questions for the owner when Phase 1 resumes: the in-store hub (ADR 007) cannot run in a browser tab — defer it, or build hub mode into the Electron desktop app later?; at-rest encryption equivalent to SQLCipher for IndexedDB on terminals.

## FINAL ACCEPTANCE RESULTS
(after Phase 6)
