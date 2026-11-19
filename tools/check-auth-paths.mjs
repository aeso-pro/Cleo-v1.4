// Auth return paths: runs the entry guard of index.html and landing.html (module.exports = destination) on
// the addresses Supabase and the apps send people back to, and checks redirectUrl(). Usage: node tools/check-auth-paths.mjs
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const load = (file) => {
  const html = readFileSync(file, 'utf8');
  const src = html.match(/<script>(\/\* Explicit index\.html is always the operational app[\s\S]*?)<\/script>/)[1];
  const sandbox = { module: { exports: {} }, URL, URLSearchParams };
  vm.runInNewContext(src, sandbox);
  return sandbox.module.exports;
};
const app = load('index.html'), landing = load('landing.html');
const cases = [
  // [page, address, expected next address (null = stays)]
  ['landing', 'https://cleopos.online/?code=abc', 'https://cleopos.online/app?code=abc'],
  ['landing', 'https://cleopos.online/#access_token=t&type=recovery', 'https://cleopos.online/app#access_token=t&type=recovery'],
  ['landing', 'https://cleopos.online/?error=access_denied&error_description=x', 'https://cleopos.online/app?error=access_denied&error_description=x'],
  ['landing', 'https://cleopos.online/#/owner/dashboard', 'https://cleopos.online/app#/owner/dashboard'],
  ['landing', 'https://cleopos.online/', null],
  ['landing', 'https://cleopos.online/landing.html?code=abc', 'https://cleopos.online/index.html?code=abc'],
  ['landing', 'https://aeso-pro.github.io/Cleo-v1.4/landing.html?code=abc', 'https://aeso-pro.github.io/Cleo-v1.4/index.html?code=abc'],
  ['operations', 'https://cleopos.online/app?code=abc', null],
  ['operations', 'https://cleopos.online/app?auth=recovery#access_token=t', null],
  ['operations', 'https://aeso-pro.github.io/Cleo-v1.4/index.html?code=abc', null],
  ['operations', 'http://127.0.0.1:47823/index.html?code=abc', null],
  ['operations', 'https://aeso-pro.github.io/Cleo-v1.4/', 'https://aeso-pro.github.io/Cleo-v1.4/landing.html'],
  ['operations', 'https://aeso-pro.github.io/Cleo-v1.4/?code=abc', 'https://aeso-pro.github.io/Cleo-v1.4/index.html?code=abc'],
];
let bad = 0;
for (const [page, from, want] of cases) {
  const got = (page === 'landing' ? landing : app)(page, from);
  const ok = got === want; if (!ok) bad++;
  console.log(`${ok ? 'pass' : 'FAIL'}  ${page.padEnd(10)} ${from}  ->  ${got}${ok ? '' : `   (expected ${want})`}`);
}
// redirectUrl(): the address sign-in and reset emails return to, per host
const redirect = (href, kind) => { const loc = new URL(href); const url = new URL(/\/(app|login|signup|plans)$/.test(loc.pathname) ? 'app' : 'index.html', loc.href); url.search = kind === 'recovery' ? '?auth=recovery' : ''; url.hash = ''; return url.href; };
const src = readFileSync('index.html', 'utf8');
if (!src.includes("const url = new URL(/\\/(app|login|signup|plans)$/.test(location.pathname) ? 'app' : 'index.html', location.href);")) { bad++; console.log('FAIL  redirectUrl() in index.html differs from the rule tested here'); }
for (const [href, kind, want] of [
  ['https://cleopos.online/app#/', '', 'https://cleopos.online/app'],
  ['https://cleopos.online/app#/setup', 'recovery', 'https://cleopos.online/app?auth=recovery'],
  ['https://aeso-pro.github.io/Cleo-v1.4/index.html#/', '', 'https://aeso-pro.github.io/Cleo-v1.4/index.html'],
  ['http://127.0.0.1:47823/index.html#/', '', 'http://127.0.0.1:47823/index.html'],
  ['https://localhost/index.html#/', 'recovery', 'https://localhost/index.html?auth=recovery'],
]) { const got = redirect(href, kind); const ok = got === want; if (!ok) bad++; console.log(`${ok ? 'pass' : 'FAIL'}  redirectUrl ${href} ${kind || 'sign-in'} -> ${got}`); }
console.log(bad ? `${bad} failing` : 'all auth return paths pass');
process.exit(bad ? 1 : 0);
