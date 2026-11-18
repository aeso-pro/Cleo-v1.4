#!/usr/bin/env node
/* Copies the files the installed apps carry into one folder: the Cleo app (index.html) and what it loads.
   Used by the Windows app (apps/desktop, with --with-server) and the Android app (apps/android).

     node tools/build-app-web.js <destination> [--with-server]

   The landing page, the admin console, the database and the docs stay on the website: an installed app
   only needs the point of sale. --with-server adds tools/serve.js and .htaccess, so the Windows app serves
   these files to its own window with the same security headers as the website. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const dest = args.find((a) => !a.startsWith('--'));
const withServer = args.includes('--with-server');
if (!dest) { console.error('Usage: node tools/build-app-web.js <destination> [--with-server]'); process.exit(1); }
const out = path.resolve(process.cwd(), dest);
if (out === ROOT || !path.relative(ROOT, out).startsWith('apps')) {
  console.error('The destination must be a folder inside apps/ (for example apps/desktop/web).'); process.exit(1);
}

// what the app loads; assets/admin belongs to the admin console, which stays on the web
const FILES = ['index.html', 'manifest.webmanifest', 'content/plans.md', 'legal/privacy.html', 'legal/terms.html'];
const FOLDERS = ['assets', 'styles'];
const SKIP = new Set([path.join('assets', 'admin')]);

fs.rmSync(out, { recursive: true, force: true });
const copy = (rel) => {
  const from = path.join(ROOT, rel), to = path.join(out, rel);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
};
const walk = (rel) => {
  if (SKIP.has(rel)) return;
  for (const entry of fs.readdirSync(path.join(ROOT, rel), { withFileTypes: true })) {
    const child = path.join(rel, entry.name);
    if (entry.isDirectory()) walk(child); else copy(child);
  }
};
FILES.forEach(copy);
FOLDERS.forEach(walk);
if (withServer) { copy('.htaccess'); copy(path.join('tools', 'serve.js')); }

let count = 0;
const countFiles = (dir) => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { if (e.isDirectory()) countFiles(path.join(dir, e.name)); else count++; } };
countFiles(out);
console.log(`Copied ${count} files into ${path.relative(ROOT, out)}${withServer ? ' (with the local server)' : ''}.`);
