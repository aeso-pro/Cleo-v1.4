#!/usr/bin/env node
/* =====================================================================
   Cleo local preview server. No packages needed:  node tools/serve.js
   Then open http://localhost:5175/  (landing)  ·  /index.html (the app)
   ·  /admin.html (the platform admin console).

   It serves the site the way the production .htaccess does, so a local
   check is a real check:
     - the same security headers and the same Content-Security-Policy
       (read from .htaccess, so there is one copy to maintain);
     - the same refusals: dotfiles, Docs/, backend/, supabase/, tools/,
       SQL / Python / env files and Markdown other than content/plans.md.
   It answers on this machine only. HOST=0.0.0.0 allows the local network;
   anything public needs HTTPS and its own redirect allowlist in Supabase.
   ===================================================================== */
'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT || 5175);
const HOST = process.env.HOST || '127.0.0.1';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.otf': 'font/otf', '.ttf': 'font/ttf',
};
// Folders and file types that are never public (the same list .htaccess refuses).
const PRIVATE_DIRS = new Set(['docs', 'backend', 'supabase', 'source', 'node_modules', 'tests', 'tools', 'cleo-v1.4-main']);
const PRIVATE_EXT = new Set(['.sql', '.py', '.sh', '.env', '.log', '.bak', '.zip', '.toml', '.lock', '.map']);

/** The security headers of .htaccess, so a local preview enforces what production enforces. */
function securityHeaders() {
  const headers = {};
  let text = '';
  try { text = fs.readFileSync(path.join(ROOT, '.htaccess'), 'utf8'); } catch { /* served without them */ }
  for (const m of text.matchAll(/^\s*Header always set ([\w-]+) "([^"]*)"\s*$/gm)) headers[m[1]] = m[2];
  // Plain http on localhost: no HSTS, and no forced upgrade of this server's own http addresses.
  delete headers['Strict-Transport-Security'];
  if (headers['Content-Security-Policy']) {
    headers['Content-Security-Policy'] = headers['Content-Security-Policy'].replace(/;\s*upgrade-insecure-requests/, '');
  }
  return headers;
}

function refused(pathname) {
  const parts = pathname.split('/').filter(Boolean);
  if (parts.some((p) => p.startsWith('.') && p !== '.well-known')) return true;
  if (parts.length && PRIVATE_DIRS.has(parts[0].toLowerCase())) return true;
  const ext = path.extname(pathname).toLowerCase();
  if (PRIVATE_EXT.has(ext)) return true;
  if (ext === '.md' && pathname !== '/content/plans.md') return true;
  return false;
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, { ...securityHeaders(), 'Content-Type': 'text/plain; charset=utf-8', ...headers });
  res.end(body);
}

const server = http.createServer((req, res) => {
  if (!['GET', 'HEAD'].includes(req.method)) return send(res, 405, 'Method not allowed', { Allow: 'GET, HEAD' });
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); }
  catch { return send(res, 400, 'Bad request'); }
  if (pathname.includes('\0') || pathname.includes('\\')) return send(res, 400, 'Bad request');
  if (refused(pathname)) return send(res, 403, 'Forbidden');
  // The public landing answers the bare address; index.html is the app itself.
  if (pathname.endsWith('/')) pathname += 'landing.html';
  const file = path.resolve(ROOT, '.' + pathname);
  if (file !== ROOT && !file.startsWith(ROOT + path.sep)) return send(res, 403, 'Forbidden');
  fs.stat(file, (error, stat) => {
    if (error || !stat.isFile()) return send(res, 404, 'Not found');
    const ext = path.extname(file).toLowerCase();
    const fresh = ext === '.html' || ext === '.webmanifest' || ext === '.md' || path.basename(file) === 'sw.js';
    res.writeHead(200, {
      ...securityHeaders(),
      'Content-Type': TYPES[ext] || 'application/octet-stream',
      'Content-Length': stat.size,
      // Local previews always show the saved file.
      'Cache-Control': fresh ? 'no-cache' : 'no-cache, max-age=0',
    });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
  });
});

server.on('error', (error) => {
  console.error(error.code === 'EADDRINUSE' ? `Port ${PORT} is already in use. Close the other server, or run with PORT=5176.` : error.message);
  process.exit(1);
});
server.listen(PORT, HOST, () => {
  const shown = HOST === '127.0.0.1' || HOST === '0.0.0.0' ? 'localhost' : HOST;
  console.log(`Cleo preview: http://${shown}:${PORT}/  (app: /index.html · admin: /admin.html)`);
});
