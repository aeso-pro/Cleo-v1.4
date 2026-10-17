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
2. Does `source/` exist anywhere? If so, who will commit it?
