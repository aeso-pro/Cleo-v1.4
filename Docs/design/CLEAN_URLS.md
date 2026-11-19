# Clean URLs, redirects and Auth redirect URLs

Phase 2, step 5. The design is in [`DESIGN_GUIDELINES.md` §H](DESIGN_GUIDELINES.md#h-clean-urls-and-route-map-hostinger). This page records what was built, how it was checked, and the Supabase Auth settings that go with it.

## Route map (as built)

| Clean URL | Serves | What the visitor sees |
|---|---|---|
| `/` | `landing.html` | The landing page (`DirectoryIndex`) |
| `/app` | `index.html` | The app. Hash routes stay: `/app#/owner/dashboard` |
| `/login` | `index.html` | The app on sign-in. The address becomes `/app#/` |
| `/signup` | `index.html` | The app on "Create an account". The address becomes `/app#/setup` |
| `/plans` | `index.html` | The app on the plans page. The address becomes `/app#/plans` |
| `/admin/` | `admin/index.html` | The admin console (unchanged) |
| `/privacy` | `legal/privacy.html` | Privacy Policy |
| `/terms` | `legal/terms.html` | Terms and Conditions |
| anything else | `404.html` (status 404) | A short "page isn't here" note |

**301 redirects.** The query string carries over, and the browser keeps the `#fragment`:

- `/landing.html` → `/`
- `/index.html` → `/app`
- `/admin.html` → `/admin/`
- `/legal/privacy.html` → `/privacy`
- `/legal/terms.html` → `/terms`
- `/app/`, `/login/` and the other clean URLs with a trailing slash → the same URL without it

The rules test `THE_REQUEST`, which is what the browser asked for, not the rewritten path, so they cannot loop.

## Where it lives

- **`.htaccess`, "Clean addresses" block:** the rewrites, the 301s and `ErrorDocument 404 /404.html`.
- **`index.html`:**
  - The entry guard turns `/login`, `/signup` and `/plans` into `/app` plus the screen's route, using `history.replaceState`, so there is no reload.
  - On the website, sign-in, sign-up and password-reset emails return to `/app` (`redirectUrl()`).
  - The legal links use `/privacy` and `/terms` (`legalHref()`).
  - Both follow the address the app was opened at:
    - opened as `/app`, `/login`, `/signup` or `/plans`: the clean URLs;
    - opened as `…/index.html` (the Windows and Android apps, GitHub Pages): the file names.
- **`landing.html` and `legal/*.html`:**
  - Relative clean links (`login`, `signup`, `app?demo#/…`, `app#/plans/…`, `privacy`, `terms`).
  - Canonical tags pointing to `https://cleopos.online/…`.
- **`manifest.webmanifest`:** `start_url` is `./app`.
- **`sw.js`:**
  - Every address of a page shares the page's one cache entry. For example, `/app`, `/login`, `/signup`, `/plans` and `/index.html` all map to `index.html`.
  - At install, a 301-redirected copy is stored as a plain response, because a browser refuses a redirected response for a page.
- **`sitemap.xml`, `robots.txt`:** the public pages are `/`, `/privacy` and `/terms`. The app and admin addresses are disallowed.
- **`404.html`:** on a host without `.htaccess`, it forwards the clean URLs to their files and keeps the query and the route.
- **`tools/serve.js`:** the preview server (`node tools/serve.js`) serves the same rewrites and 301s.
  - `serveStatic(…, { cleanUrls: true })` turns them on; it is off by default.
  - So the Windows app (`apps/desktop/main.js`, which serves `/index.html` at `http://127.0.0.1:47823`) and `supabase/tests/e2e-server.mjs` keep their file URLs.

**Not changed:**

- The Windows app keeps loading `/index.html`, and its sign-in return check still looks for `/index.html`.
- The Android app keeps `https://localhost/index.html` and `online.cleopos.app://auth-callback`.

## GitHub Pages (interim host)

GitHub Pages has no `.htaccess`:

- **Old file-name links keep working there.**
- **Clean links on the landing page** (`signup`, `app?…`, `privacy`) reach `404.html`, which forwards them to the files: one extra hop.
- **The legal pages' links to each other** (`terms`, `privacy`) resolve directly, because GitHub Pages serves `terms.html` for `/legal/terms`.

The landing page's `#/…` forward goes to `app` and then through the same fallback. This is meant to last only until Hostinger serves the site and Pages is retired.

## Checks run (local, `tools/serve.js`)

| Request | Result |
|---|---|
| `/` · `/app` · `/login` · `/signup` · `/plans` · `/privacy` · `/terms` · `/admin/` · `/sitemap.xml` · `/robots.txt` | 200 |
| `/landing.html` | 301 → `/` |
| `/index.html?demo&x=1` | 301 → `/app?demo&x=1` (query kept) |
| `/app/` | 301 → `/app` |
| `/legal/privacy.html` | 301 → `/privacy` |
| `/admin.html` · `/admin` | 301 → `/admin/` |
| `/nope` | 404 with `404.html` |
| `/Docs/PROGRESS.md` | 403 (unchanged) |

In the browser:

- `/login` became `/app#/` and showed Sign in, with legal links `terms` and `privacy`.
- `/signup` became `/app#/setup`.
- `/plans` became `/app#/plans`.
- `/index.html?demo#/owner/dashboard` arrived at `/app…#/owner/dashboard`.

For the service worker, `/app?offline` installed all 32 files. The `index.html` and `legal/*.html` entries (fetched through the 301) were stored with `redirected: false`.

The database tests pass (`npm test`, 67 of 67), and `node tools/update-security.js --check` is clean.

**Still to check on Apache.** This needs a Hostinger staging subdomain, which doesn't exist yet. Run `curl -sI` against each row of the table above, and test a password-reset email end to end.

## Supabase Auth: URL configuration

Supabase › Authentication › URL Configuration is a dashboard setting owned by the backend side. Production is read-only for this overhaul, so **nothing has been changed**. The values below are what each project needs once this branch is deployed.

**Staging** (when the staging project and `staging.cleopos.online` exist):

- Site URL: `https://staging.cleopos.online/`
- Redirect URLs:
  - `https://staging.cleopos.online/app**`
  - `https://staging.cleopos.online/index.html**` (links in emails sent before the change)
  - `http://127.0.0.1:5175/**` and `http://localhost:5175/**` (local preview)
  - `http://127.0.0.1:47823/index.html**` (the Windows app)
  - `online.cleopos.app://auth-callback` (the Android app)

**Production** (the owner applies these when the site moves to Hostinger):

- Site URL: `https://cleopos.online/`
- Redirect URLs:
  - **Add** `https://cleopos.online/app**`.
  - **Keep** `https://cleopos.online/index.html**` until emails sent before the move have expired.
  - **Keep** the Windows and Android entries as they are.
  - **Keep** the GitHub Pages entries (`https://aeso-pro.github.io/Cleo-v1.4/**`) until Pages is retired.

The current production list was not read for this step. Compare it in the dashboard before changing anything.
