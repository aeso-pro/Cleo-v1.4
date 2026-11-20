/* Clean addresses (/app, /login, /signup, /plans, /privacy, /terms) need the website's rewrites: .htaccess on
   Hostinger, or `node tools/serve.js` locally. A server without them (GitHub Pages, an editor's live server, a
   file opened from disk) has only the files, so this asks once whether `app` exists and, when it doesn't, points
   every clean link at its file instead: links already on the page, links drawn later (the plan cards), and a
   click that lands before the answer. The page says where the site's root is with data-root on this script
   ("" for the landing, "../" for the legal pages). Docs/design/CLEAN_URLS.md. */
(() => {
  'use strict';
  const me = document.currentScript;
  const root = me?.dataset.root || '';
  const FILES = { app: ['index.html', ''], login: ['index.html', '#/'], signup: ['index.html', '#/setup'], plans: ['index.html', '#/plans'],
    privacy: ['legal/privacy.html', ''], terms: ['legal/terms.html', ''] };
  const CLEAN = /^(?:\.\.\/)*(app|login|signup|plans|privacy|terms)(\?[^#]*)?(#.*)?$/;
  const fileFor = (href) => {
    const m = CLEAN.exec(href || ''); if (!m) return null;
    const [file, hash] = FILES[m[1]];
    return root + file + (m[2] || '') + (m[3] || hash);
  };
  let clean = null;   // unknown until the server answers
  const fix = (scope) => {
    if (clean !== false) return;
    scope.querySelectorAll?.('a[href]').forEach((a) => { const to = fileFor(a.getAttribute('href')); if (to) a.setAttribute('href', to); });
  };
  // a click before the answer arrives still goes somewhere that exists
  document.addEventListener('click', (e) => {
    if (clean !== null || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = e.target.closest?.('a[href]'); const to = a && fileFor(a.getAttribute('href'));
    if (to) { e.preventDefault(); location.href = to; }
  });
  const decide = (yes) => {
    clean = yes;
    if (yes) return;
    fix(document);
    new MutationObserver((records) => records.forEach((r) => r.addedNodes.forEach((n) => { if (n.nodeType === 1) { if (n.matches('a[href]')) fix(n.parentNode || n); else fix(n); } }))).observe(document.documentElement, { childList: true, subtree: true });
  };
  if (!/^https?:$/.test(location.protocol)) { decide(false); return; }
  fetch(root + 'app', { method: 'HEAD', cache: 'no-store', redirect: 'manual' }).then((r) => decide(r.ok)).catch(() => decide(false));
})();
