#!/usr/bin/env node
/* =====================================================================
   Cleo landing screen captures. No packages needed.

     node tools/capture-screens.js serve    serve the app for capturing (http://localhost:5176)
     node tools/capture-screens.js write    put the captures into landing.html (#screen-data)

   The landing shows the real Terminal, Owner Dashboard and Back Office as
   DOM captures: each screen's markup at 1440 x 960 in dark mode, with the
   app's own CSS, its fonts and images inlined, shown in a sandboxed iframe.
   Re-take them whenever the app's look changes:

   1. node tools/capture-screens.js serve
      It serves this folder with no Content-Security-Policy (so the capture
      script can run) and with the demo clock held at 3:45 PM Manila, so the
      afternoon promo shows and the times read the same on every capture.
   2. In a Chromium browser at a 1440 x 960 viewport, open each screen in demo
      mode and dark theme, for example
        http://localhost:5176/index.html?demo#/terminal/app   (add Café Latte and Ensaymada)
        http://localhost:5176/index.html?demo#/owner/app
        http://localhost:5176/index.html?demo#/backoffice/app (pick BGC High Street)
      wait until it has settled, then run in the console:
        await (await import('/__capture.js')).capture('terminal')   // or 'owner', 'backoffice'
      The capture is saved next to this machine's temp folder (cleo-captures).
   3. node tools/capture-screens.js write
      then node tools/update-security.js, and look at the landing page.

   Icons: the captures carry Phosphor as small subset fonts (CleoGlyph). An
   icon the subset lacks makes "write" embed that family's whole font instead
   and say so; nothing renders blank.
   ===================================================================== */
'use strict';
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT || 5176);
const OUT = path.join(os.tmpdir(), 'cleo-captures');
const MODES = ['terminal', 'owner', 'backoffice'];
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json', '.md': 'text/markdown; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.otf': 'font/otf', '.ttf': 'font/ttf',
};

/* Runs first in the served app: every "now" reads 3:45 PM in Manila today, and the clock keeps ticking from there. */
const CLOCK = `<script>(() => {
  const Real = Date, start = Real.now();
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Manila', hour12: false, hour: 'numeric', minute: 'numeric', second: 'numeric' }).formatToParts(new Real(start)).map((p) => [p.type, p.value]));
  const shift = ((15 * 60 + 45) * 60 - ((+parts.hour % 24) * 3600 + +parts.minute * 60 + +parts.second)) * 1000;
  class CaptureDate extends Real { constructor(...a) { if (a.length) super(...a); else super(Real.now() + shift); } static now() { return Real.now() + shift; } }
  globalThis.Date = CaptureDate;
})();</script>`;

/* The capture itself, run in the page: a copy of the body with canvases as images, form values as attributes,
   images inlined, and nothing that runs or refracts. */
const CAPTURE = `
const dataUrl = async (url) => { const blob = await (await fetch(url)).blob(); return new Promise((ok) => { const r = new FileReader(); r.onload = () => ok(r.result); r.readAsDataURL(blob); }); };
const attrs = (el) => Object.fromEntries([...el.attributes].map((a) => [a.name, a.value]));
export async function capture(mode) {
  const clone = document.body.cloneNode(true);
  const liveCanvas = [...document.body.querySelectorAll('canvas')], copyCanvas = [...clone.querySelectorAll('canvas')];
  liveCanvas.forEach((c, i) => {
    const img = document.createElement('img'); let src = '';
    try { src = c.toDataURL('image/png'); } catch {}
    img.src = src; img.alt = ''; img.className = c.className; img.style.cssText = c.style.cssText;
    if (!c.style.width) img.style.width = c.clientWidth + 'px'; if (!c.style.height) img.style.height = c.clientHeight + 'px';
    copyCanvas[i].replaceWith(img);
  });
  const liveField = [...document.body.querySelectorAll('input, textarea, select')], copyField = [...clone.querySelectorAll('input, textarea, select')];
  liveField.forEach((f, i) => {
    const c = copyField[i];
    if (f.type === 'checkbox' || f.type === 'radio') { if (f.checked) c.setAttribute('checked', ''); else c.removeAttribute('checked'); }
    else if (f.tagName === 'SELECT') [...c.options].forEach((o, k) => { if (f.options[k]?.selected) o.setAttribute('selected', ''); else o.removeAttribute('selected'); });
    else if (f.tagName === 'TEXTAREA') c.textContent = f.value;
    else c.setAttribute('value', f.value);
  });
  clone.querySelectorAll('script, noscript, template, .preview-bar, [data-pbar], .toaster').forEach((e) => e.remove());
  clone.querySelectorAll('svg').forEach((s) => { if (s.querySelector('feDisplacementMap') && [...s.children].every((ch) => ch.tagName.toLowerCase() === 'defs')) s.remove(); });
  clone.querySelectorAll('[style*="--refract"]').forEach((e) => e.style.removeProperty('--refract'));
  clone.querySelectorAll('*').forEach((e) => [...e.attributes].forEach((a) => { if (/^on/i.test(a.name)) e.removeAttribute(a.name); }));
  for (const img of clone.querySelectorAll('img[src]:not([src^="data:"])')) img.src = await dataUrl(img.src);
  for (const im of clone.querySelectorAll('image')) { const h = im.getAttribute('href') || im.getAttribute('xlink:href'); if (h && !h.startsWith('data:')) im.setAttribute('href', await dataUrl(new URL(h, location.href))); }
  for (const e of clone.querySelectorAll('[style*="url("]')) {
    let st = e.getAttribute('style');
    for (const m of [...st.matchAll(/url\\((["']?)([^"')]+)\\1\\)/g)]) if (!/^(data:|#)/.test(m[2])) st = st.replace(m[0], 'url("' + await dataUrl(new URL(m[2], location.href)) + '")');
    e.setAttribute('style', st);
  }
  const css = [...document.querySelectorAll('style')].map((s) => s.textContent).join('\\n');
  const html = attrs(document.documentElement), bodyAttrs = attrs(document.body);
  delete bodyAttrs.inert;
  const payload = { html, bodyAttrs, body: clone.innerHTML, width: innerWidth, height: innerHeight, css };
  const r = await fetch('/__capture/' + mode, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
  return r.ok ? 'Saved ' + mode + ' (' + Math.round(payload.body.length / 1024) + ' KB of markup at ' + innerWidth + ' x ' + innerHeight + ')' : 'Not saved: ' + r.status;
}`;

function serve() {
  fs.mkdirSync(OUT, { recursive: true });
  http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (req.method === 'POST' && url.pathname.startsWith('/__capture/')) {
      const mode = url.pathname.slice(11);
      if (!MODES.includes(mode)) { res.writeHead(400).end('unknown screen'); return; }
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        try { JSON.parse(body); } catch { res.writeHead(400).end('not JSON'); return; }
        fs.writeFileSync(path.join(OUT, `${mode}.json`), body);
        console.log(`saved ${mode} (${Math.round(body.length / 1024)} KB)`);
        res.writeHead(200).end('ok');
      });
      return;
    }
    if (url.pathname === '/__capture.js') { res.writeHead(200, { 'content-type': TYPES['.js'], 'cache-control': 'no-store' }).end(CAPTURE); return; }
    let file = path.normalize(path.join(ROOT, decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)));
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404).end('not found'); return; }
    let data = fs.readFileSync(file);
    if (path.relative(ROOT, file) === 'index.html') data = Buffer.from(data.toString('utf8').replace(/<head([^>]*)>/i, (m) => m + CLOCK));
    res.writeHead(200, { 'content-type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', 'cache-control': 'no-store' }).end(data);
  }).listen(PORT, '127.0.0.1', () => console.log(`Capture server: http://localhost:${PORT}/index.html?demo · captures go to ${OUT}`));
}

/* ---------- write: build #screen-data from the captures ---------- */
const MIME = { '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2', '.woff': 'font/woff', '.otf': 'font/otf', '.ttf': 'font/ttf', '.gif': 'image/gif' };
const asData = (file) => `data:${MIME[path.extname(file).toLowerCase()] || 'application/octet-stream'};base64,${fs.readFileSync(file).toString('base64')}`;
const MIRRORS = [
  ['arrow-up-right', 'arrow-down-right', 'scaleY(-1)'], ['arrow-down-right', 'arrow-up-right', 'scaleY(-1)'],
  ['arrow-up-left', 'arrow-down-left', 'scaleY(-1)'], ['arrow-down-left', 'arrow-up-left', 'scaleY(-1)'],
  ['arrow-up', 'arrow-down', 'scaleY(-1)'], ['arrow-down', 'arrow-up', 'scaleY(-1)'],
  ['arrow-left', 'arrow-right', 'scaleX(-1)'], ['arrow-right', 'arrow-left', 'scaleX(-1)'],
  ['caret-up', 'caret-down', 'scaleY(-1)'], ['caret-down', 'caret-up', 'scaleY(-1)'],
  ['caret-left', 'caret-right', 'scaleX(-1)'], ['caret-right', 'caret-left', 'scaleX(-1)'],
];
const ICON_FAMILIES = { ph: ['CleoGlyph', 'regular', 'Phosphor'], 'ph-fill': ['CleoGlyph-Fill', 'fill', 'Phosphor-Fill'], 'ph-bold': ['CleoGlyph-Bold', 'bold', 'Phosphor-Bold'] };

function write() {
  const landingFile = path.join(ROOT, 'landing.html');
  const landing = fs.readFileSync(landingFile, 'utf8');
  const open = '<script id="screen-data" type="application/json">';
  const a = landing.indexOf(open), b = landing.indexOf('</script>', a);
  if (a < 0 || b < 0) throw new Error('landing.html has no #screen-data block');
  const old = JSON.parse(landing.slice(a + open.length, b));

  const shots = {};
  for (const m of MODES) {
    const f = path.join(OUT, `${m}.json`);
    if (!fs.existsSync(f)) { console.log(`missing ${m}: keeping the old capture`); shots[m] = null; continue; }
    shots[m] = JSON.parse(fs.readFileSync(f, 'utf8'));
  }
  const fresh = MODES.map((m) => shots[m]).filter(Boolean);
  if (!fresh.length) throw new Error(`no captures in ${OUT}`);

  // 1. icons: keep the old subset fonts and glyph rules; any icon they lack brings in its family's whole font
  const rootAt = old.css.indexOf(':root, :root[data-theme="dark"]');
  let prefix = old.css.slice(0, rootAt);
  const bodies = MODES.map((m) => (shots[m] || old.screens[m]).body).join('\n');
  for (const [cls, [family, dir, full]] of Object.entries(ICON_FAMILIES)) {
    const used = new Set();
    for (const tag of bodies.matchAll(/<i\b[^>]*class="([^"]*)"/g)) {
      const names = tag[1].split(/\s+/);
      if (!names.includes(cls)) continue;
      names.filter((n) => n.startsWith('ph-') && !ICON_FAMILIES[n]).forEach((n) => used.add(n));
    }
    let missing = [...used].filter((n) => !prefix.includes(`.${cls}.${n}::before`));
    // an arrow the subset lacks is often its own mirror image: draw it from that glyph instead of embedding a font
    missing = missing.filter((n) => {
      for (const [from, to, flip] of MIRRORS) {
        if (n !== `ph-${from}`) continue;
        const m = prefix.match(new RegExp(`\\.${cls.replace('-', '\\-')}\\.ph\\-${to.replace(/-/g, '\\-')}::before \\{ content: "([^"]+)"; \\}`));
        if (!m) continue;
        prefix += `.${cls}.${n}::before { content: "${m[1]}"; display: inline-block; transform: ${flip}; }\n`;
        console.log(`icons: ${cls} ${n} drawn as a mirrored ${to}`);
        return false;
      }
      return true;
    });
    if (!missing.length) continue;
    const sheet = fs.readFileSync(path.join(ROOT, 'assets/icons/phosphor', dir, 'style.css'), 'utf8');
    const rules = missing.map((n) => {
      const m = sheet.match(new RegExp(`\\.${cls.replace('-', '\\-')}\\.${n.replace(/-/g, '\\-')}:before\\s*\\{\\s*content:\\s*"([^"]+)"`));
      if (!m) { console.log(`  ${cls} ${n}: not in Phosphor, skipped`); return ''; }
      return `.${cls}.${n}::before { content: "${m[1]}"; }\n`;
    }).join('');
    const woff2 = path.join(ROOT, 'assets/icons/phosphor', dir, `${full}.woff2`);
    prefix = prefix.replace(new RegExp(`(@font-face \\{ font-family: ${family}; src: url\\(")data:[^"]+("\\))`), (_, x, y) => x + asData(woff2) + y);
    prefix += rules;
    console.log(`icons: ${family} lacked ${missing.join(', ')}; embedded the whole ${full} font`);
  }

  // 2. the app's own CSS as the captured page had it, minus its font files, with every asset inlined
  let css = fresh[0].css.replace(/@font-face\s*\{[^}]*\}\s*/g, '');
  css = css.replace(/url\((["']?)([^"')]+)\1\)/g, (all, q, u) => {
    if (/^(data:|#|%23)/.test(u)) return all;
    const file = path.join(ROOT, u.replace(/^\.?\//, '').split(/[?#]/)[0]);
    if (!file.startsWith(ROOT) || !fs.existsSync(file)) { console.log(`  css url not found, left as is: ${u}`); return all; }
    return `url("${asData(file)}")`;
  });

  const screens = {};
  for (const m of MODES) {
    const s = shots[m];
    screens[m] = s ? { body: s.body, html: s.html, bodyAttrs: s.bodyAttrs, width: s.width, height: s.height } : old.screens[m];
    if (s && (s.width !== 1440 || s.height !== 960)) console.log(`  note: ${m} was captured at ${s.width} x ${s.height}, not 1440 x 960`);
    if (s && s.html['data-theme'] !== 'dark') console.log(`  note: ${m} was captured in ${s.html['data-theme']} mode, not dark`);
  }
  const data = JSON.stringify({ css: prefix + '\n' + css, screens }).replace(/</g, '\\u003c');
  fs.writeFileSync(landingFile, landing.slice(0, a + open.length) + data + landing.slice(b));
  console.log(`landing.html: #screen-data is now ${Math.round(data.length / 1024)} KB (was ${Math.round((b - a - open.length) / 1024)} KB). Run node tools/update-security.js next.`);
}

const cmd = process.argv[2];
if (cmd === 'serve') serve();
else if (cmd === 'write') write();
else console.log('Usage: node tools/capture-screens.js serve | write');
