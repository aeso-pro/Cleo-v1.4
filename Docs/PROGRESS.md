# Cleo Overhaul — Progress
MODE: GATED          LAST UPDATED: 2026-11-19 05:30 Asia/Manila
PLATFORM: current stack · Supabase (prod: ntbkbvlsgymupjdpuvob, staging: none yet) · Hostinger (plan: see CURRENT_STATE.md)

The loop's instructions are in [`Docs/overhaul/SUPERPROMPT.md`](overhaul/SUPERPROMPT.md). To resume in a new session, paste that file into Claude Code at the repository root.

| # | Phase               | Branch                                   | Status      |
|---|---------------------|------------------------------------------|-------------|
| 1 | System Architecture | cleo-overhaul/phase-1-architecture       | IN_PROGRESS |
| 2 | Frontend            | cleo-overhaul/phase-2-frontend           | NOT_STARTED |
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

## CURRENT PHASE CHECKLIST (Phase 1 — System Architecture)
- [x] 0. Create the branch from `origin/main` (ffdef82), copy the architecture PDF into `Docs/architecture/`, save the superprompt as `Docs/overhaul/SUPERPROMPT.md`, ignore `Docs/private/`, create this file
- [ ] 1. Read the architecture end to end
- [ ] 2. Write `Docs/architecture/CLEO_ARCHITECTURE.md` (faithful Markdown + "Platform mapping")
- [ ] 3. Write `Docs/architecture/CURRENT_STATE.md` (repo, Supabase and Hostinger inventories)
- [ ] 4. Write `Docs/architecture/GAP_ANALYSIS.md` (7 principles + 12 modules, ordered by risk)
- [ ] 5. Write ADR-011 to ADR-015 in `Docs/architecture/adr/`
- [ ] 6. Write `CLAUDE.md` at the repository root
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
- 2026-11-19 · **Loop mode:** GATED — stop after every phase for review and merge.
- 2026-11-19 · **Git:** commit on stacked `cleo-overhaul/phase-N-*` branches and push those branches to GitHub; never push to `main` or merge. This replaces the earlier "push every change to main" rule for overhaul work.
- 2026-11-19 · **Public repository:** push the branches, but keep live security findings out of committed files (git-ignored `Docs/private/`).
- 2026-11-19 · **Production:** https://cleopos.online on Hostinger. GitHub Pages (the current live site) is an interim host to retire.
- 2026-11-19 · **Live inventory:** read the Supabase dashboard and hPanel in the built-in browser, read-only (no settings changed, no keys revealed).

## OWNER PRODUCTION DEPLOY STEPS (per phase)
- Phase 1: none. Documentation only; review and merge the branch when ready.

## PHASE REPORTS
(written at the end of each phase)

## FINAL ACCEPTANCE RESULTS
(after Phase 6)
