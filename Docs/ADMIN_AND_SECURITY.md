# Admin console, Facebook sign-in and security: setup

What was added in November 2026, and the steps only the owner can do. Nothing here needs a secret key in a file, and none should ever be put in one.

## 1. What you have to do (in order)

Until these are done, the fixes are in the code but the live project behaves as before.

### 1.1 Apply the database migrations

The hosted project (`ntbkbvlsgymupjdpuvob`) has only migration 001. In **Supabase › SQL Editor**, run these files from `supabase/migrations/`, one at a time, in this order. Each is a single transaction: it applies completely or not at all.

1. `202610170002_verified_profiles.sql`
2. `202610170003_operations.sql`
3. `202610170004_transfers.sql`
4. `202611140005_platform_admin.sql`
5. `202611150006_billing.sql` (plan payments; see [PAYMENTS.md](PAYMENTS.md))

Do not run 001 again; it refuses. 005 and 006 also refuse a second run.

### 1.2 Make yourself the first admin

Admins are never created from a browser. In the SQL Editor, with your own sign-in email:

```sql
INSERT INTO public.cleo_platform_admins(user_id, role, note)
SELECT id, 'superadmin', 'First administrator' FROM auth.users
 WHERE lower(email) = lower('YOUR-EMAIL@example.com');
```

It should say `INSERT 0 1`. `INSERT 0 0` means no account has that email yet: sign up in Cleo first, or add the user in **Authentication › Users**.

- `superadmin` can suspend accounts and revoke access. `support` can only read.
- The admin page signs in with **email and password**. An account made with Facebook or Google has no password: use **Forgot password?** on Cleo's sign-in page once to set one.
- To remove an admin: `UPDATE public.cleo_platform_admins SET revoked_at = now() WHERE user_id = '…';`

### 1.3 Open the admin console

Go to `https://your-domain/admin.html` (locally: `http://localhost:5175/admin.html`). The first time, it walks you through adding Cleo Admin to an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password). After that every sign-in asks for the 6-digit code. This is enforced by the database, not the page: no admin function answers a session that has not passed the second step.

### 1.4 Check the Facebook app (Meta for Developers)

The code was not the only problem. The handoff log recorded that the Facebook provider in Supabase had an **email address as its Client ID**; it now shows a 16-digit app ID, which is the right shape. Confirm the rest:

| Where | Setting | Value |
| --- | --- | --- |
| Supabase › Authentication › Sign In / Providers › Facebook | Client ID, Client Secret | The Meta app's **App ID** and **App Secret** |
| Meta › Facebook Login › Settings | Valid OAuth Redirect URIs | Only `https://ntbkbvlsgymupjdpuvob.supabase.co/auth/v1/callback` |
| Meta › App settings › Basic | Privacy Policy URL | `https://your-domain/legal/privacy.html` |
| Meta › App settings › Basic | App mode | **Live**. In Development mode only people listed under App roles can sign in |
| Meta › App Review › Permissions | `email` | **Advanced Access**. Without it, people outside your team sign in with no email and Cleo has to turn them away |
| Supabase › Authentication › URL Configuration | Site URL | `https://your-domain` |
| Supabase › Authentication › URL Configuration | Redirect URLs | `https://your-domain/index.html**` (remove the `localhost` entries at launch) |

A sign-in made by someone who is not in the app's roles is the only real test of the last two Meta rows.

### 1.5 Still blocking real customers

- **Email.** The project uses Supabase's built-in mailer, which sends a few emails an hour. Sign-up confirmations stop arriving. Set a custom SMTP sender in **Authentication › Emails**.
- **The domain.** `https://cleopos.online` still serves a Hostinger parked page. See `DEPLOY_HOSTINGER.md`.
- **Plans.** After sign-in a real business reaches "Choose your plan". Paying for one is built, but it works only after the PayMongo steps in [PAYMENTS.md](PAYMENTS.md): until then the page says payments aren't switched on.

## 2. What changed

### Facebook and Google sign-in (`index.html`)

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
- `admin.html` carries its own stricter policy: no inline script or style at all, connections only to the Supabase project.
- Both entry pages and the admin page refuse to run inside another site's frame, also on a host that drops the headers.
- `tools/`, the stray nested `Cleo-v1.4-main/` folder and the admin page's caching are covered in `.htaccess`; the service worker never caches the admin console.

## 3. The one rule to remember

**After any edit to `index.html`, `landing.html` or `admin.html`, and before every upload, run:**

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
| Overview | Accounts, businesses, sign-ups per day, how people sign in | — |
| Accounts | Everyone who signed up; search and filters | Suspend, restore (a reason is required and kept) |
| Businesses | Every business; open one for its people, branches and recent changes | Revoke or restore one person's access |
| Security | Eight rules checked live in the database, who the admins are, settings to review by hand | — |
| Admin history | Every console sign-in and every change. It cannot be edited | — |

The session lives in the tab only, ends after 15 idle minutes, and nothing an admin sees is written to browser storage. Passwords, tokens and authenticator secrets are never returned by any admin function.

## 6. Known limits

- **CAPTCHA is not supported yet.** Do not turn on CAPTCHA protection in Supabase: the app sends no token, so every sign-in would fail.
- **Deleting a person's Auth user** is blocked once they appear in a business's audit trail or stock history (existing design: history is kept). A privacy erasure request needs a reviewed procedure.
- Hosted round trips (a real Facebook consent screen, real email delivery) were not exercised from here: they need the owner's Facebook and Supabase sign-ins.
