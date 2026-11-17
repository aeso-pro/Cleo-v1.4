# Admin console, sign-in and security: setup

What was added in November 2026, and the steps only the owner can do. Nothing here needs a secret key in a file, and none should ever be put in one.

## 1. Where things stand, and what is left for you

### 1.1 Database: done on 2026-11-17

Migrations 002 to 007 are applied to the hosted project (`ntbkbvlsgymupjdpuvob`), each checked byte for byte against the repository before it ran:

1. `202610170002_verified_profiles.sql`
2. `202610170003_operations.sql`
3. `202610170004_transfers.sql`
4. `202611140005_platform_admin.sql`
5. `202611150006_billing.sql` (plan payments; see [PAYMENTS.md](PAYMENTS.md))
6. `202611170007_admin_controls.sql` (the console's controls over accounts, businesses, plans and admins)

A read-only check afterwards found row-level security on all 19 Cleo tables, nothing open to visitors, nothing writable from a browser, and the existing 3 accounts, 2 businesses and memberships unchanged. Do not run any of them again: each refuses a second run. A future change is a new migration file.

### 1.2 Make yourself the first admin

**Done on 2026-11-17:** `main.code.aeso@gmail.com` is the first superadmin. Add more admins on the console's **Admins** page; the SQL below is only for recovering access if no superadmin is left.

Only the first admin is made in SQL; after that, superadmins add, change and remove admins on the console's **Admins** page. The account must exist and have a confirmed email first. Sign up in Cleo, or add the user in **Supabase › Authentication › Users** (you choose the password there; never put it in a file or a chat). Then, in the SQL Editor:

```sql
INSERT INTO public.cleo_platform_admins(user_id, role, note)
SELECT id, 'superadmin', 'First administrator' FROM auth.users
 WHERE lower(email) = lower('YOUR-EMAIL@example.com') AND email_confirmed_at IS NOT NULL;
```

It should say `INSERT 0 1`. `INSERT 0 0` means no confirmed account has that email yet.

- `superadmin` can change anything. `support` can only look.
- The admin page signs in with **email and password**. An account made with Google has no password: use **Forgot password?** on Cleo's sign-in page once to set one.
- Nobody can change their own admin access, and Cleo always keeps at least one superadmin with two-step verification.

### 1.3 Open the admin console

**Two ways in:** email and password, or **Continue with Google** (added 2026-11-17). Google only proves who you are: the account must still be an admin, and every admin still enters the authenticator code afterwards. A Google account with the same email as a Cleo account signs in as that account, so `main.code.aeso@gmail.com` can use either. Supabase allows Google to return to `https://cleopos.online/admin/**` and `http://localhost:5175/admin/**`; another address for the console needs adding in **Authentication › URL Configuration** first. Signing in with a Google account that has no Cleo account creates one (with no access), as on Cleo's own sign-in page.

Go to `https://your-domain/admin` (locally: `http://localhost:5175/admin`). The old `admin.html` address forwards there. The first time, it walks you through adding Cleo Admin to an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password). After that every sign-in asks for the 6-digit code. The database enforces this, not the page: no admin function answers a session that has not passed the second step.

### 1.4 Sign-in settings (changed on 2026-11-17)

- **Facebook sign-in is removed**, at your request. The button and the code that started a Facebook sign-in are gone from the app (commit 1b519f5), and the provider is **switched off** in the hosted project (it now answers "provider is not enabled"). Its App ID and secret are still saved in Supabase.
- Accounts already made with Facebook keep their data. They sign in with email instead: **Forgot password?** on Cleo's sign-in page sets a password for the same email address. The admin console can also send that reset email.
- **Redirect URLs** now include `https://cleopos.online/index.html**` next to the four local test addresses. Remove the local ones at launch.
- **Site URL** is still the local test address `http://127.0.0.1:5500`. Change it to `https://cleopos.online` when the site goes live; email links fall back to it.
- Google and email sign-in are unchanged.

### 1.5 Still blocking real customers

- **Email.** The project uses Supabase's built-in mailer, which sends a few emails an hour. Sign-up confirmations stop arriving. Set a custom SMTP sender in **Authentication › Emails**.
- **The domain.** `https://cleopos.online` still serves a Hostinger parked page. See `DEPLOY_HOSTINGER.md`.
- **Plans.** After sign-in a real business reaches "Choose your plan". Paying for one is built, but it works only after the PayMongo steps in [PAYMENTS.md](PAYMENTS.md): until then the page says payments aren't switched on.

## 2. What changed

### Facebook and Google sign-in (`index.html`; Facebook was removed later, see 1.4)

- Facebook ends its return address with `#_=_`. It is removed, and a sign-in started from a mode's address (`#/backoffice/…`) goes back to it.
- A refused sign-in says why on the sign-in card: no email shared, cancelled, expired, opened in another browser, provider turned off. Before, every case said "cancelled or could not finish."
- After "no email shared", the next try asks Facebook for the email permission again (`auth_type=rerequest`). Facebook does not re-ask on its own.
- The one-time PKCE verifier is kept where another tab can read it. A return in a new tab (the Facebook app, an email confirmation link) used to fail when "Keep me signed in" was off.
- Coming back from the provider no longer asks for the agreement tick and **Continue** a second time.
- An account the server refuses (suspended, email never confirmed, no email at all) is signed out with the reason, instead of looping or showing "Cleo isn't connected."
- **Keep me signed in** is off by default, so a shared computer signs out when the tab closes and after 30 idle minutes.

### Database (`202611140005_platform_admin.sql`)

- The sign-up trigger can no longer abort a sign-up. A failure there is what Supabase reports as "Database error saving new user."
- A suspended or banned account is locked out immediately in every table policy and RPC, not when its token expires an hour later.
- Audit history (the business's and the admins') cannot be updated, deleted or truncated by any role.
- Stored records have size, type and character limits.
- The admin console's tables and ten functions.

### Site hardening

- **No inline scripts by permission.** `.htaccess` used to allow any inline script (`'unsafe-inline'`). It now lists the SHA-256 of each inline script the pages contain. Injected markup (`<img onerror>`, `javascript:` links) does not run; this was tested in a browser.
- The admin console (`admin/index.html`, served at `/admin`) carries its own stricter policy: no inline script or style at all, connections only to the Supabase project.
- Both entry pages and the admin page refuse to run inside another site's frame, also on a host that drops the headers.
- `tools/`, the stray nested `Cleo-v1.4-main/` folder and the admin page's caching are covered in `.htaccess`; the service worker never caches the admin console.

## 3. The one rule to remember

**After any edit to `index.html`, `landing.html` or `admin/index.html`, and before every upload, run:**

```bash
node tools/update-security.js
```

It re-fingerprints the inline scripts into `.htaccess`, renames the service worker cache, and checks the SDK and the admin page's settings. If you skip it after editing an inline script, the page shows **blank** with "Content Security Policy" errors in the console. Run the tool and reload. `node tools/update-security.js --check` changes nothing and exits 1 when something is out of date.

## 4. Testing on your own machine

```bash
node tools/serve.js
```

Serves the site at `http://localhost:5175/` with the same headers and refusals as `.htaccess`, against the real Supabase project.

```bash
npm --prefix supabase/tests ci --ignore-scripts
```

```bash
npm --prefix supabase/tests test
```

71 database checks (46 earlier, 17 for migration 005, 8 for billing), in a disposable in-memory PostgreSQL. Nothing touches the hosted project.

```bash
node supabase/tests/e2e-server.mjs
```

The real pages at `http://localhost:5180/` in front of a stand-in Supabase that runs the real migrations. "Continue with Facebook" returns at once with the outcome set at `POST /__test/scenario` (`ok`, `no_email`, `cancel`, `broken`). The accounts and the password are printed when it starts and exist only there.

## 5. What the admin console does

| Section | Shows | Changes (superadmin only) |
| --- | --- | --- |
| Overview | Accounts, businesses, sign-ups per day, how people sign in, paid plans, businesses with no plan, money this month | — |
| Accounts | Everyone who signed up; search and filters. **Open** shows one person: businesses, role, terms accepted, recent changes, past suspensions | Rename; confirm an email that never arrived; send a password reset email; change role or add to a business; suspend or restore; make admin |
| Businesses | Every business with its plan; **Open** shows people, branches, plan, payments and recent changes | Rename; give, change, extend or end a plan without payment (trials, deals, after a refund); change a person's role and branch; revoke or restore access |
| Payments | Every PayMongo payment with its status, money paid this month and in all, plans running, plans ending soon | — |
| Admins | Everyone who can open the console (superadmins only) | Add an admin by email, change superadmin/support, remove |
| Security | Eight rules checked live in the database, who the admins are, settings to review by hand | — |
| Admin history | Every console sign-in and every change, with its reason. It cannot be edited | — |

Every change asks for a reason, which is kept in the admin history. A change to a business also appears in that business's own audit trail as made by "Cleo support". You never see or set anyone's password: a reset email lets them choose it.

Still in code, not on the console: **plan prices** (`content/plans.md` for what the app shows, and the `cleo_plan_prices` table for what PayMongo charges; change both together).

The session lives in the tab only, ends after 15 idle minutes, and nothing an admin sees is written to browser storage. Passwords, tokens and authenticator secrets are never returned by any admin function.

## 6. Known limits

- **CAPTCHA is not supported yet.** Do not turn on CAPTCHA protection in Supabase: the app sends no token, so every sign-in would fail.
- **Deleting a person's Auth user** is blocked once they appear in a business's audit trail or stock history (existing design: history is kept). A privacy erasure request needs a reviewed procedure.
- Hosted round trips (a real Facebook consent screen, real email delivery) were not exercised from here: they need the owner's Facebook and Supabase sign-ins.
