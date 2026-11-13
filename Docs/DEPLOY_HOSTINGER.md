# Putting Cleo on Hostinger

Cleo is a static site: two pages, a service worker and an `assets` folder. Sign-in and data live in the Supabase project, so nothing is installed on the host.

## What to upload

Upload only these, into `public_html` (the site's root folder):

- `landing.html`, `index.html`, `sw.js`, `manifest.webmanifest`
- `.htaccess` (a hidden file: turn on "show hidden files" in the file manager)
- the folders `assets`, `content` and `legal`

Leave everything else off the server: `Docs`, `backend`, `supabase`, the root `.md` files and any `.env` file. `.htaccess` refuses them anyway if they are uploaded by mistake.

The deploy ZIP built from this repository holds exactly the files above.

## Steps in hPanel

1. Websites → your domain → **File Manager** → open `public_html`.
2. Delete the placeholder `default.php` or `index.php` if one is there.
3. Upload the deploy ZIP, right-click it → **Extract** into `public_html`, then delete the ZIP.
4. Check that `.htaccess` is in `public_html` next to `landing.html`.
5. Websites → your domain → **Security → SSL**: make sure the certificate is active.
6. Open `https://<your domain>/`. The landing page should load; **Sign in** opens `index.html`.

## Supabase settings for the live address

In the Supabase dashboard → Authentication → URL Configuration:

- **Site URL:** `https://<your domain>`
- **Redirect URLs:** add `https://<your domain>/index.html**`

Without these, Google, Facebook and email links send people to the wrong address after signing in.

Also set up a custom SMTP sender (Authentication → Emails → SMTP Settings). The built-in mailer sends only a few emails an hour, so sign-up confirmations stop arriving.

## What `.htaccess` does

- sends `http` to `https`, and tells browsers to keep using `https`;
- sets the security headers, including a Content-Security-Policy that lets the pages talk only to their own files and the Supabase project;
- refuses dotfiles, notes, migrations and scripts;
- keeps the pages and the service worker fresh, and caches images and fonts for a week.

If the Supabase project ever changes, update its two addresses in the `Content-Security-Policy` line, or sign-in will be blocked.

## Checking a deploy

- `https://<your domain>/Docs/` and `https://<your domain>/.env` answer 403.
- The browser console on `index.html` shows no "Content Security Policy" errors.
- A header check (for example securityheaders.com) lists HSTS, CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy and Permissions-Policy.
