# CLAUDE.md — Cleo POS

Cleo is a Philippine cloud POS (Terminal, Back Office, Owner dashboard, admin console) on a fixed platform: the current stack, Supabase for the database and backend, and Hostinger for hosting, domains and mail. A six-phase overhaul is running; its state is in [`Docs/PROGRESS.md`](Docs/PROGRESS.md) and its instructions in [`Docs/overhaul/SUPERPROMPT.md`](Docs/overhaul/SUPERPROMPT.md).

## Read first, every session

1. [`Docs/PROGRESS.md`](Docs/PROGRESS.md) — phase status, owner decisions, decisions log.
2. [`Docs/architecture/CLEO_ARCHITECTURE.md`](Docs/architecture/CLEO_ARCHITECTURE.md) — the architecture contract (principles win over any task; the fixed platform wins over its technology choices).
3. [`Docs/architecture/CURRENT_STATE.md`](Docs/architecture/CURRENT_STATE.md) and the ADRs in [`Docs/architecture/adr/`](Docs/architecture/adr/).
4. The handoff documents of every earlier phase (table below).

## Repository facts

- **No build step.** `index.html` (the app) and `landing.html` are built single files edited directly; `source/` and `Frontend/` no longer exist. `admin/index.html` + `assets/admin/` is the admin console.
- **After any edit to `index.html`, `landing.html` or `admin/index.html`, run `node tools/update-security.js`** before committing. It rewrites the CSP script hashes in `.htaccess` and the cache name in `sw.js`; without it the page loads blank on Hostinger. `node tools/update-security.js --check` verifies without writing.
- **`docs/` means `Docs/`.** Documents live in `Docs/` (capital D). Windows treats both spellings as one folder and `.htaccess` blocks both; write every `docs/...` path from the superprompt to `Docs/...`.
- **The repository and its GitHub Pages site are public.** Exploitable security detail (live settings, specific weaknesses with file and line) goes only in the git-ignored `Docs/private/`. Committed documents refer to those items as `S-n`.
- **Shared ownership.** Another Claude Code session works on the frontend and ChatGPT Codex on `supabase/`; log changes the other side depends on at the top of `Docs/FRONTEND_BACKEND_HANDOFF.md`.
- A nested `Cleo-v1.4-main/` copy may exist in the main checkout (ZIP leftover, excluded via `.git/info/exclude`). Never commit or delete it.

## Standing rules (from the superprompt, section 2)

1. **Source of truth:** `Docs/architecture/CLEO_ARCHITECTURE.md`, the ADRs in `Docs/architecture/adr/`, and the fixed platform below. Read them and every earlier phase's handoff before each phase.
2. **Never break:** offline selling on terminal screens; sequential per-terminal invoice numbers; the non-resettable grand total; append-only money and tax records (voids and refunds are new records); idempotent writes; card data never entering Cleo; no training mode and no "no sale" mode (BIR).
3. Money is integer centavos (`bigint`). Timestamps are `timestamptz` in UTC, plus a `business_date` in Asia/Manila.
4. **Branches are stacked:** `cleo-overhaul/phase-1-architecture` from `main`; each later phase branches from the previous phase's branch. Push the phase branches to GitHub. **Never push to `main` or merge.** Never deploy to Hostinger production. Never run `supabase db push` or deploy Edge Functions against the production project (`ntbkbvlsgymupjdpuvob`). Staging deploys are allowed.
5. **Schema changes** only through Supabase CLI migrations in `supabase/migrations`, committed. Never change the schema in the dashboard SQL editor. Regenerate types after each schema change.
6. Small commits, one concern each. Run the checks that exist before every commit.
7. **Production is read-only:** Hostinger pages, safe GET requests, headers, file listings, logs; Supabase dashboard, logs, advisors, read-only SQL with a read-only role. Never write data, change settings, or load- or attack-test production.
8. **Secrets:** never print, log, commit or paste them. The frontend holds only the Supabase project URL and the publishable key (`sb_publishable_…`). Secret keys, database passwords, SMTP credentials and third-party keys live only in Edge Function secrets, Supabase Vault or a git-ignored `.env`. Never in Hostinger `public_html`. `.env.example` holds placeholders only.
9. **Evidence over assumption:** every claim in a report cites file paths, command output, dashboard screenshots or SQL results.
10. **Cost changes need owner approval** (gate G8).

## Fixed platform (owner decision — do not re-evaluate)

- **Database and backend:** the current Supabase setup — Postgres, Auth, Data API, Edge Functions, Storage, Realtime, Cron (pg_cron), Queues (pgmq), Vault.
- **Deployment, domains and mail:** the current Hostinger account — hosting, domains and DNS, SSL, CDN, email. Production domain: `cleopos.online`. (GitHub Pages serves the app in the meantime; it is an interim host to retire.)
- **Tech stack:** the current stack — vanilla HTML/CSS/JS, vendored `@supabase/supabase-js`, Electron and Capacitor wrappers. No new frameworks, runtimes, hosting providers or paid services.

Mapping of the architecture's generic components: see [Platform mapping](Docs/architecture/CLEO_ARCHITECTURE.md#platform-mapping). If the architecture needs something this platform cannot provide, record the gap and raise G6.

## Hard gates (always stop and ask)

- **G1** A task conflicts with the architecture or an ADR.
- **G2** The Functions scope (ADD / REMOVE / QUARANTINE) is ready for owner approval — before building anything in Phase 3.
- **G3** A secret was found in code, the frontend bundle, Hostinger `public_html` or git history — the owner rotates it.
- **G4** An action would touch production, delete data, or cannot be undone.
- **G5** A security control would break offline selling or BIR compliance.
- **G6** A need the fixed platform cannot meet without a new service, framework or provider.
- **G7** A phase is BLOCKED after 3 fix attempts.
- **G8** A change would cost money (Supabase plan or compute, PITR, read replicas, Hostinger plan or add-on).

## Handoff documents

| Phase | Branch | Handoff |
|---|---|---|
| 1 Architecture | `cleo-overhaul/phase-1-architecture` | `CLAUDE.md`, `Docs/architecture/CLEO_ARCHITECTURE.md`, `CURRENT_STATE.md`, `GAP_ANALYSIS.md`, `adr/` |
| 2 Frontend | `cleo-overhaul/phase-2-frontend` | `Docs/design/DESIGN_GUIDELINES.md`, `GRIDBOX_REMOVAL.md`, `AUDIT_BEFORE.md`, `Docs/design/AFTER/`, the token stylesheet, `.htaccess`, Auth redirect URL list |
| 3 Functions | `cleo-overhaul/phase-3-functions` | `Docs/functions/FUNCTIONS_AUDIT.md`, `USABILITY_FRAMEWORK.md` |
| 4 Backend | `cleo-overhaul/phase-4-backend` | `Docs/backend/BASELINE.md`, `BACKEND_REPORT.md` |
| 5 Database | `cleo-overhaul/phase-5-database` | `Docs/database/DB_RESILIENCE.md` |
| 6 Security | `cleo-overhaul/phase-6-security` | `Docs/security/THREAT_MODEL.md`, `SECURITY_REPORT.md` |

## Commands

```sh
# Local preview (mirrors the .htaccess headers; / serves landing.html)
node tools/serve.js                         # http://127.0.0.1:5175  (launch.json: cleo-preview)

# After editing index.html, landing.html or admin/index.html
node tools/update-security.js               # write CSP hashes + sw.js cache name
node tools/update-security.js --check       # verify only (exit 1 if stale)

# Database tests (in-memory Postgres, all migrations)
cd supabase/tests && npm ci && npm test

# Manual end-to-end stand-in for Supabase and PayMongo
node supabase/tests/e2e-server.mjs          # http://127.0.0.1:5180  (launch.json: cleo-e2e)

# Desktop and Android wrappers
node tools/build-app-web.js <target> [--with-server]
cd apps/desktop && npm ci && npm run dist
```

Not yet available (added by later phases): build, lint and type-check for the web app; `deno check` / `deno lint`; CI test jobs.

**Supabase CLI** (not installed on the owner's machine yet; use `npx supabase@<pinned version>` or install it, Phase 3/4 prerequisite). Staging only:

```sh
npx supabase login
npx supabase link --project-ref <SUPABASE_STAGING_REF>
npx supabase migration new <name>
npx supabase db diff --linked
npx supabase db push --linked               # staging only — never production
npx supabase db lint --linked
npx supabase functions serve
npx supabase functions deploy <name> --project-ref <SUPABASE_STAGING_REF>
npx supabase gen types typescript --project-id <SUPABASE_STAGING_REF> > supabase/types/database.ts
deno check supabase/functions/**/*.ts && deno lint supabase/functions
```

**Hostinger staging deploy** (no staging site exists yet; the owner creates e.g. `staging.cleopos.online`): run `node tools/update-security.js`, upload the web files (not `Docs/`, `supabase/`, `backend/`, `tools/`, `apps/`) to the staging site's document root through hPanel File Manager, or Git deploy if the plan offers it. Production deploys are the owner's.
