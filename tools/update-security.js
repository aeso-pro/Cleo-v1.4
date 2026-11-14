#!/usr/bin/env node
/* =====================================================================
   Cleo security sync. No packages needed.

     node tools/update-security.js           bring .htaccess and sw.js up to date
     node tools/update-security.js --check   change nothing; exit 1 if anything is out of date

   Run it after ANY edit to index.html, landing.html or admin.html, and before
   every upload. It keeps three things true:

   1. The Content-Security-Policy in .htaccess lists the SHA-256 of every inline
      script the pages really contain, and nothing else. There is no
      'unsafe-inline' for scripts: markup an attacker manages to inject (an
      <img onerror>, a <script>, a javascript: link) does not run. The price is
      that an edited inline script must be re-fingerprinted, which is this tool.
   2. The service worker's cache name follows the files it caches, so a change
      reaches devices that already installed the app.
   3. The pinned Supabase SDK still matches its recorded integrity value, and
      admin.html points at the same Supabase project as the app.

   A page whose scripts do not match the policy shows blank in the browser, with
   "Content Security Policy" errors in the console. That is the policy working:
   run this tool and reload.
   ===================================================================== */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '..');
const CHECK = process.argv.includes('--check');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const problems = [], changes = [];

/** every executable inline script of a page, as the browser sees it (comments and data blocks skipped) */
function inlineScripts(html) {
  const text = html.replace(/\r\n?/g, '\n');   // the HTML parser normalises newlines before it hashes
  const found = [];
  let at = 0;
  while (at < text.length) {
    const comment = text.indexOf('<!--', at), tag = text.slice(at).search(/<(script|style)\b/i);
    const open = tag < 0 ? -1 : at + tag;
    if (open < 0) break;
    if (comment >= 0 && comment < open) { const end = text.indexOf('-->', comment + 4); if (end < 0) break; at = end + 3; continue; }
    const head = text.indexOf('>', open);
    if (head < 0) break;
    const name = /^<style/i.test(text.slice(open, open + 6)) ? 'style' : 'script';
    const close = text.toLowerCase().indexOf(`</${name}`, head + 1);
    if (close < 0) break;
    if (name === 'script') {
      const attrs = text.slice(open + 7, head);
      const type = (attrs.match(/\btype\s*=\s*["']?([^"'\s>]+)/i) || [])[1] || '';
      const runs = !type || /^(text|application)\/(java|ecma)script$|^module$/i.test(type);
      if (runs && !/\bsrc\s*=/i.test(attrs)) found.push(text.slice(head + 1, close));
    }
    at = close + name.length + 3;
  }
  return found;
}
const fingerprint = (script) => `'sha256-${crypto.createHash('sha256').update(script, 'utf8').digest('base64')}'`;

/* ---------- 1. the Content-Security-Policy ---------- */
const pages = fs.readdirSync(ROOT).filter((f) => f.endsWith('.html')).sort();
const hashes = new Set();
for (const page of pages) {
  const html = read(page);
  for (const script of inlineScripts(html)) hashes.add(fingerprint(script));
  // An inline handler or a javascript: link would be silently dead under this policy: say so now.
  const handlers = html.match(/<[a-z][^<>]*\son[a-z]+\s*=\s*["'][^<>]*>/gi) || [];
  if (handlers.length) problems.push(`${page}: ${handlers.length} inline event handler(s) (onclick="…"). Use addEventListener instead: the policy blocks them.`);
  if (/\bhref\s*=\s*["']\s*javascript:/i.test(html)) problems.push(`${page}: a javascript: link. The policy blocks it.`);
}
let htaccess = read('.htaccess');
const policyLine = htaccess.match(/^(\s*Header always set Content-Security-Policy ")([^"]*)(".*)$/m);
if (!policyLine) problems.push('.htaccess: no Content-Security-Policy header line found.');
else {
  const wanted = `script-src 'self' ${[...hashes].sort().join(' ')}`.trim();
  const policy = policyLine[2].replace(/script-src [^;]*/, wanted);
  if (!/script-src /.test(policyLine[2])) problems.push('.htaccess: the policy has no script-src directive.');
  if (policy !== policyLine[2]) {
    changes.push(`.htaccess: script-src now lists ${hashes.size} inline script fingerprint(s)`);
    htaccess = htaccess.replace(policyLine[0], `${policyLine[1]}${policy}${policyLine[3]}`);
  }
  if (/script-src[^;]*'unsafe-inline'/.test(policy)) problems.push(".htaccess: script-src still allows 'unsafe-inline'.");
}

/* ---------- 2. the service worker's cache name ---------- */
let worker = read('sw.js');
const list = worker.match(/const FILES = (\[[\s\S]*?\]);/);
const cacheName = worker.match(/const CACHE = '([^']+)';/);
if (!list || !cacheName) problems.push('sw.js: could not find CACHE or FILES.');
else {
  const sum = crypto.createHash('sha256');
  for (const file of JSON.parse(list[1])) {
    if (!fs.existsSync(path.join(ROOT, file))) { problems.push(`sw.js caches ${file}, which does not exist. The worker would fail to install.`); continue; }
    sum.update(file).update(fs.readFileSync(path.join(ROOT, file)));
  }
  sum.update(worker.replace(cacheName[0], ''));   // the worker's own logic counts too
  const name = `cleo-${sum.digest('hex').slice(0, 10)}`;
  if (name !== cacheName[1]) { changes.push(`sw.js: cache name ${cacheName[1]} -> ${name}`); worker = worker.replace(cacheName[0], `const CACHE = '${name}';`); }
}

/* ---------- 3. things that must agree ---------- */
const envOf = (page) => { try { return JSON.parse(read(page).match(/<script[^>]*id="cleo-env"[^>]*>([\s\S]*?)<\/script>/)[1]); } catch { return null; } };
const app = envOf('index.html');
if (!app?.supabaseUrl) problems.push('index.html: no Supabase address in #cleo-env.');
for (const page of pages) {
  const html = read(page);
  for (const [, src, integrity] of html.matchAll(/<script[^>]*\bsrc="([^"]+)"[^>]*\bintegrity="([^"]+)"/g)) {
    const file = path.join(ROOT, src);
    if (!fs.existsSync(file)) { problems.push(`${page}: ${src} is missing.`); continue; }
    const actual = `sha384-${crypto.createHash('sha384').update(fs.readFileSync(file)).digest('base64')}`;
    if (actual !== integrity) problems.push(`${page}: ${src} does not match its integrity value. Was the file changed? The browser will refuse to load it.`);
  }
  for (const key of [app?.supabasePublishableKey, envOf(page)?.supabasePublishableKey]) {
    let role = '';
    try { role = JSON.parse(Buffer.from(String(key).split('.')[1], 'base64url').toString()).role; } catch { /* not a JWT */ }
    if (/^sb_secret_/i.test(String(key || '')) || role === 'service_role') problems.push(`${page}: a SECRET Supabase key is embedded. Remove it and rotate it in Supabase now.`);
  }
}
if (fs.existsSync(path.join(ROOT, 'admin.html')) && app?.supabaseUrl) {
  const admin = read('admin.html'), adminEnv = envOf('admin.html');
  if (adminEnv?.supabaseUrl !== app.supabaseUrl || adminEnv?.supabasePublishableKey !== app.supabasePublishableKey) problems.push('admin.html: #cleo-env differs from index.html. Both must name the same Supabase project and publishable key.');
  if (!admin.includes(`connect-src ${app.supabaseUrl}`)) problems.push(`admin.html: its Content-Security-Policy does not allow ${app.supabaseUrl}. Sign-in would be blocked.`);
  if (inlineScripts(admin).length) problems.push('admin.html: it has an inline script. Its own policy refuses every one; move it to assets/admin/.');
}
if (app?.supabaseUrl && policyLine && !policyLine[2].includes(app.supabaseUrl)) problems.push(`.htaccess: connect-src does not allow ${app.supabaseUrl}. Sign-in would be blocked.`);

/* ---------- report ---------- */
if (!CHECK && !problems.length) {
  if (htaccess !== read('.htaccess')) fs.writeFileSync(path.join(ROOT, '.htaccess'), htaccess);
  if (worker !== read('sw.js')) fs.writeFileSync(path.join(ROOT, 'sw.js'), worker);
}
for (const line of problems) console.error(`PROBLEM  ${line}`);
for (const line of changes) console.log(`${CHECK ? 'OUT OF DATE' : problems.length ? 'NOT WRITTEN' : 'UPDATED'}  ${line}`);
if (!problems.length && !changes.length) console.log(`Up to date: ${hashes.size} inline scripts in ${pages.length} pages match the policy, the cache name matches its files, and the SDK matches its integrity value.`);
process.exit(problems.length || (CHECK && changes.length) ? 1 : 0);
