/* =====================================================================
   Cleo Admin: the platform console (admin.html).

   What decides access is the database, never this file. Every figure and
   every action is an RPC from supabase/migrations/202611140005_platform_admin.sql,
   and each one checks, on the server, that the caller is an active platform
   admin with a confirmed email and a completed second factor (aal2).
   This page only asks and draws.

   Rules this file keeps
     - Data reaches the page as text (textContent / text nodes), never as markup.
     - No inline styles or scripts: the page's Content-Security-Policy refuses them.
       Sizes are set through the style object (bars, meters), which the policy allows.
     - The session lives in this tab only (sessionStorage) and ends after
       15 minutes without activity. Nothing an admin sees is written to storage.
     - Never log tokens, passwords, codes or the people the lists show.
   ===================================================================== */
(() => {
  'use strict';
  const root = document.getElementById('admin');
  if (!root) return;
  // boot.js blanks the page inside another site's frame; do no work there either
  if (window.top !== window.self) {
    try { if (window.top.location.origin !== location.origin) return; } catch { return; }
  }

  /* ---------- a small DOM kit ---------- */
  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    for (const [key, value] of Object.entries(props || {})) {
      if (value == null || value === false) continue;
      if (key === 'class') el.className = value;
      else if (key === 'text') el.textContent = value;
      else if (key === 'dataset') Object.assign(el.dataset, value);
      else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2), value);
      else if (value === true) el.setAttribute(key, '');
      else el.setAttribute(key, String(value));
    }
    for (const kid of kids.flat(Infinity)) {
      if (kid == null || kid === false) continue;
      el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    }
    return el;
  }
  const icon = (name, fill = false) => h('i', { class: `${fill ? 'ph-fill' : 'ph'} ph-${name}`, 'aria-hidden': 'true' });
  const mount = (node) => { root.replaceChildren(node); };
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  /* ---------- formatting (Asia/Manila, like the rest of Cleo) ---------- */
  const NUM = new Intl.NumberFormat('en-PH');
  const n = (v) => NUM.format(Number(v) || 0);
  const DATE = new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', year: 'numeric', month: 'short', day: 'numeric' });
  const DATETIME = new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const DAY = new Intl.DateTimeFormat('en-PH', { timeZone: 'UTC', month: 'short', day: 'numeric' });
  const DAY_LONG = new Intl.DateTimeFormat('en-PH', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' });
  function when(value, format = DATE) {
    if (!value) return '—';
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? '—' : format.format(d);
  }
  /** a server day ("2026-11-14", already a Manila date) as "Nov 14" */
  const dayLabel = (day, long = false) => { const d = new Date(`${day}T00:00:00Z`); return Number.isNaN(d.getTime()) ? String(day) : (long ? DAY_LONG : DAY).format(d); };
  function ago(value) {
    if (!value) return 'Never';
    const t = new Date(value).getTime();
    if (Number.isNaN(t)) return '—';
    const minutes = Math.round((Date.now() - t) / 60000);
    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours} hr ago`;
    const days = Math.round(hours / 24);
    if (days === 1) return 'Yesterday';
    if (days < 30) return `${days} days ago`;
    return when(value);
  }
  const share = (part, whole) => (Number(whole) > 0 ? `${Math.round((Number(part) / Number(whole)) * 100)}%` : '0%');
  const plural = (count, one, many) => `${n(count)} ${Number(count) === 1 ? one : many}`;

  /* ---------- the Supabase client: public settings only, this tab only ---------- */
  const env = (() => { try { return JSON.parse(document.getElementById('cleo-env')?.textContent || '{}') || {}; } catch { return {}; } })();
  const claim = (key) => { try { return JSON.parse(atob(key.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).role; } catch { return ''; } };
  function publicSettings() {
    const url = typeof env.supabaseUrl === 'string' ? env.supabaseUrl.trim().replace(/\/$/, '') : '';
    const key = typeof env.supabasePublishableKey === 'string' ? env.supabasePublishableKey.trim() : '';
    let goodUrl = false;
    try {
      const u = new URL(url);
      goodUrl = !u.username && !u.password && !u.search && !u.hash && u.pathname === '/' &&
        (u.protocol === 'https:' || (u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)));
    } catch { /* not a URL */ }
    // A secret or service-role key must never be used from a browser. Refuse it rather than run with it.
    const secret = /^sb_secret_/i.test(key) || claim(key) === 'service_role';
    const publishable = /^sb_publishable_[A-Za-z0-9_-]+$/.test(key) || (key.split('.').length === 3 && claim(key) === 'anon');
    return goodUrl && !secret && publishable ? { url, key } : null;
  }
  const memory = new Map();
  const tabStorage = {
    getItem(key) { try { return sessionStorage.getItem(key); } catch { return memory.get(key) ?? null; } },
    setItem(key, value) { try { sessionStorage.setItem(key, value); } catch { memory.set(key, value); } },
    removeItem(key) { try { sessionStorage.removeItem(key); } catch { /* blocked storage */ } memory.delete(key); },
  };
  const state = { stage: 'loading', admin: null, userId: null, view: '' };
  let sb = null;
  function client() {
    if (sb) return sb;
    const settings = publicSettings();
    if (!settings || typeof window.supabase?.createClient !== 'function') return null;
    sb = window.supabase.createClient(settings.url, settings.key, { auth: {
      flowType: 'pkce', detectSessionInUrl: false, persistSession: true, autoRefreshToken: true,
      storageKey: 'cleo:admin-auth', storage: tabStorage,
    } });
    // Never await an Auth call inside this callback: Auth holds a lock while it notifies listeners.
    sb.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT' && state.stage === 'console') setTimeout(() => leave('Your session ended. Sign in again.'), 0);
    });
    return sb;
  }

  /* ---------- errors, in words for the person at the keyboard ---------- */
  class Refusal extends Error {
    constructor(kind, message) { super(message); this.name = 'Refusal'; this.kind = kind; }
  }
  function explain(error) {
    if (error instanceof Refusal) return error;
    const code = String(error?.code || ''), status = Number(error?.status || 0);
    const said = String(error?.message || ''), hint = String(error?.hint || '');
    // Cleo's own database functions raise short messages meant to be read. Anything else stays out.
    const ours = /^(P0002|22023|40001|42501|23505)$/.test(code) && said.length > 0 && said.length <= 180 &&
      !/[<>{}[\]`$\\]|permission denied|violates|relation |function |column |syntax|schema|constraint|null value|duplicate key|row-level|policy/i.test(said);
    if (/cleo_admin_mfa_required/.test(hint)) return new Refusal('mfa', 'Confirm your authenticator code to continue.');
    if (/^(PGRST202|PGRST205|42883|42P01)$/.test(code)) return new Refusal('setup', 'The admin tools aren’t installed on the server yet.');
    if (/invalid_credentials/.test(code)) return new Refusal('input', 'That email and password do not match.');
    if (/email_not_confirmed/.test(code)) return new Refusal('input', 'Confirm this email address before signing in.');
    if (/mfa_verification_failed|mfa_verification_rejected|mfa_challenge_expired|otp_expired/.test(code)) return new Refusal('input', 'That code didn’t match. Use the newest code in your authenticator app.');
    if (/over_.*rate_limit|rate_limit/.test(code) || status === 429) return new Refusal('wait', 'Too many tries. Wait a minute, then try again.');
    if (/user_banned/.test(code)) return new Refusal('denied', 'This account has been turned off.');
    if (code === '42501' && /Admin access is required/.test(said)) return new Refusal('denied', said);
    if (ours) return new Refusal(code === '42501' ? 'forbidden' : 'input', said);
    if (/session_not_found|session_expired|refresh_token|bad_jwt|not_authenticated|^PGRST30[123]$/.test(code) || status === 401) return new Refusal('session', 'Your session ended. Sign in again.');
    if (code === '42501' || status === 403) return new Refusal('forbidden', 'This account isn’t allowed to do that.');
    if (error instanceof TypeError || /fetch|network/i.test(`${error?.name || ''} ${said}`)) return new Refusal('network', 'Couldn’t reach Cleo’s server. Check the connection and try again.');
    if (status >= 500) return new Refusal('server', 'Cleo’s server didn’t respond. Try again in a moment.');
    if (status === 400 || status === 422) return new Refusal('input', 'Check the details and try again.');
    return new Refusal('unknown', 'Something went wrong. Try again.');
  }
  async function ask(promise) {
    let result;
    try { result = await promise; } catch (error) { throw explain(error); }
    if (result?.error) throw explain(result.error);
    return result?.data;
  }
  const rpc = (name, params = {}) => ask(client().rpc(name, params));

  /* ---------- toasts and dialogs ---------- */
  const toasts = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' });
  function toast(title, body = '', tone = 'good') {
    // an open dialog sits above the page, so a toast shown then goes inside it to be seen and read out
    const host = [...document.querySelectorAll('dialog[open]')].at(-1) || document.body;
    if (toasts.parentNode !== host) host.append(toasts);
    const node = h('div', { class: `toast ${tone}` }, icon(tone === 'bad' ? 'warning-circle' : 'check-circle', true), h('div', null, h('b', { text: title }), body ? h('span', { text: body }) : null));
    toasts.append(node);
    setTimeout(() => node.remove(), tone === 'bad' ? 9000 : 5000);
  }
  /** a modal dialog; returns { el, close }. The browser traps focus and restores it on close. */
  function dialog({ title, lede, body = [], foot = [], sheet = false, closable = true }) {
    const el = h('dialog', { class: sheet ? 'sheet' : null, 'aria-label': title });
    const close = () => { if (el.open) el.close(); };
    el.append(h('div', { class: 'dlg' },
      h('div', { class: 'dlg-head' },
        h('div', null, h('h2', { text: title }), lede ? h('p', { text: lede }) : null),
        closable ? h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Close', onclick: close }, icon('x')) : null),
      body, foot.length ? h('div', { class: 'dlg-foot' }, foot) : null));
    el.addEventListener('cancel', (e) => { if (!closable) e.preventDefault(); });
    el.addEventListener('close', () => el.remove());
    document.body.append(el);
    el.showModal();
    return { el, close };
  }
  /** a button that shows it is working, and can't be pressed twice */
  function busy(button, on) {
    if (on) { button.dataset.label = button.textContent; button.disabled = true; button.replaceChildren(h('span', { class: 'spin', 'aria-hidden': 'true' }), 'Working…'); }
    else { button.disabled = false; button.replaceChildren(button.dataset.label || ''); }
  }

  /* ---------- session: start, two-step, leave ---------- */
  const lockup = () => h('div', { class: 'lockup' }, h('img', { src: '../assets/brand/cleo-emblem.svg', alt: '', width: '22', height: '30' }), h('b', { text: 'Cleo' }), h('span', { class: 'badge', text: 'Admin' }));
  const loadingPage = (label) => h('div', { class: 'spinner-page', role: 'status' }, h('span', { class: 'spin', 'aria-hidden': 'true' }), h('span', { text: label }));
  function gateCard({ title, lede, wide = false, body = [], foot = [] }) {
    const heading = h('h1', { text: title, tabindex: '-1' });
    const card = h('main', { class: 'gate' }, h('div', { class: `gate-card${wide ? ' wide' : ''}` }, lockup(), heading, lede ? h('p', { class: 'lede', text: lede }) : null, body,
      foot.length ? h('div', { class: 'gate-foot' }, foot) : null));
    mount(card);
    return { card, heading };
  }
  const appLink = () => h('a', { href: '../index.html', text: 'Back to Cleo' });
  const signOutButton = (label = 'Sign out') => h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => leave() }, icon('sign-out'), label);

  async function forget() {
    try { await client()?.auth.signOut({ scope: 'local' }); } catch { /* the tab forgets it either way */ }
    try { sessionStorage.removeItem('cleo:admin-started'); } catch { /* blocked storage */ }
    state.admin = null; state.userId = null;
  }
  async function leave(notice = '') {
    state.stage = 'leaving';
    document.querySelectorAll('dialog[open]').forEach((d) => d.close());
    await forget();
    signInScreen(notice);
  }
  /** a refusal that changes where the admin is, rather than one a view can show in place */
  function reroute(refusal) {
    if (refusal.kind === 'session') { leave(refusal.message); return true; }
    if (refusal.kind === 'mfa') { twoStep().catch((e) => signInScreen(explain(e).message, 'bad')); return true; }
    if (refusal.kind === 'denied') { deniedScreen(); return true; }
    if (refusal.kind === 'setup') { setupScreen(); return true; }
    return false;
  }

  function signInScreen(notice = '', tone = 'info') {
    state.stage = 'signin';
    const email = h('input', { class: 'input', id: 'ad-email', type: 'email', autocomplete: 'username', inputmode: 'email', required: true, spellcheck: 'false', autocapitalize: 'none' });
    const password = h('input', { class: 'input', id: 'ad-password', type: 'password', autocomplete: 'current-password', required: true });
    const error = h('p', { class: 'note bad', role: 'alert', hidden: true });
    const submit = h('button', { class: 'btn btn-primary btn-block', type: 'submit', text: 'Sign in' });
    const form = h('form', { novalidate: true },
      h('div', { class: 'field' }, h('label', { for: 'ad-email', text: 'Admin email' }), email),
      h('div', { class: 'field' }, h('label', { for: 'ad-password', text: 'Password' }), password),
      error, submit);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (submit.disabled) return;
      const address = email.value.trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(address) || !password.value) {
        error.replaceChildren(icon('warning-circle', true), 'Enter your admin email and password.'); error.hidden = false;
        (address ? password : email).focus(); return;
      }
      error.hidden = true; busy(submit, true);
      try {
        const data = await ask(client().auth.signInWithPassword({ email: address, password: password.value }));
        password.value = '';
        if (!data?.session || !data?.user) throw new Refusal('session', 'Sign-in didn’t finish. Try again.');
        state.userId = data.user.id;
        await enter();
      } catch (failure) {
        const refusal = explain(failure);
        password.value = '';
        if (refusal.kind === 'denied' || refusal.kind === 'setup') { reroute(refusal); return; }
        busy(submit, false);
        error.replaceChildren(icon('warning-circle', true), refusal.message); error.hidden = false;
        password.focus();
      }
    });
    const { heading } = gateCard({
      title: 'Admin sign-in',
      lede: 'For Cleo platform staff. Business owners and their teams sign in to Cleo itself.',
      body: [notice ? h('p', { class: `note ${tone === 'bad' ? 'bad' : ''}`, role: 'status' }, icon(tone === 'bad' ? 'warning-circle' : 'info'), notice) : null, form,
        h('p', { class: 'note' }, icon('shield-check'), 'Admin accounts always need a code from an authenticator app after the password.')],
      foot: [appLink()],
    });
    if (matchMedia('(pointer: coarse)').matches) heading.focus({ preventScroll: true }); else email.focus({ preventScroll: true });
  }

  /** after a password sign-in or a restored session: what the server says this account is */
  async function enter() {
    let context;
    try { context = await rpc('cleo_admin_context'); }
    catch (failure) {
      const refusal = explain(failure);
      if (reroute(refusal)) return;
      throw refusal;
    }
    state.admin = context;
    if (!context.mfaVerified) { await twoStep(); return; }
    await openConsole();
  }

  /** the second factor: the authenticator prompt, or first-time set-up when the account has none */
  async function twoStep() {
    mount(loadingPage('Checking two-step verification'));
    const factors = await ask(client().auth.mfa.listFactors());
    const verified = (factors?.all || factors?.totp || []).find((f) => f.factor_type === 'totp' && f.status === 'verified');
    if (verified) { codeScreen({ factorId: verified.id }); return; }
    // a set-up that was started and abandoned is cleared, then a new one begins
    for (const stale of (factors?.all || []).filter((f) => f.factor_type === 'totp' && f.status !== 'verified')) {
      try { await ask(client().auth.mfa.unenroll({ factorId: stale.id })); } catch { /* a new name below avoids the clash */ }
    }
    const enrolled = await ask(client().auth.mfa.enroll({ factorType: 'totp', friendlyName: `Cleo Admin ${new Date().toISOString().slice(0, 19)}` }));
    if (!enrolled?.id || !enrolled?.totp?.secret) throw new Refusal('server', 'Two-step set-up couldn’t start. Try again.');
    // The SDK hands the QR code over as raw SVG behind a data: prefix. Unescaped, a '#' in it (a colour)
    // ends the address early and the picture breaks, so the SVG is encoded properly here.
    const raw = String(enrolled.totp.qr_code || '');
    const svg = raw.startsWith('data:') ? raw.slice(raw.indexOf(',') + 1) : raw;
    const qr = /^\s*<svg[\s>]/i.test(svg) ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}` : '';
    codeScreen({ factorId: enrolled.id, qr, secret: enrolled.totp.secret });
  }
  function codeScreen({ factorId, qr = '', secret = '' }) {
    state.stage = 'two-step';
    const setup = !!secret;
    const code = h('input', { class: 'input code-input', id: 'ad-code', inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: '6', pattern: '[0-9]{6}', 'aria-describedby': 'ad-code-help', required: true });
    const error = h('p', { class: 'note bad', role: 'alert', hidden: true });
    const submit = h('button', { class: 'btn btn-primary btn-block', type: 'submit', text: setup ? 'Turn on and continue' : 'Verify and continue', disabled: true });
    code.addEventListener('input', () => { code.value = code.value.replace(/\D/g, '').slice(0, 6); submit.disabled = code.value.length !== 6; error.hidden = true; });
    const form = h('form', { novalidate: true },
      h('div', { class: 'field' }, h('label', { for: 'ad-code', text: '6-digit code' }), code,
        h('p', { class: 'help', id: 'ad-code-help', text: 'The code changes every 30 seconds. Type the one showing now.' })),
      error, submit);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (submit.disabled || code.value.length !== 6) return;
      busy(submit, true);
      try {
        await ask(client().auth.mfa.challengeAndVerify({ factorId, code: code.value }));
        code.value = '';
        await enter();
      } catch (failure) {
        const refusal = explain(failure);
        if (reroute(refusal)) return;
        busy(submit, false); submit.disabled = true; code.value = '';
        error.replaceChildren(icon('warning-circle', true), refusal.message); error.hidden = false;
        code.focus();
      }
    });
    const secretBox = h('code', { class: 'secret', text: secret.replace(/(.{4})/g, '$1 ').trim() });
    const steps = setup ? h('ol', { class: 'steps-list' },
      h('li', null, h('div', null, h('b', { text: 'Install an authenticator app' }), h('p', { text: 'Google Authenticator, Microsoft Authenticator, 1Password and Authy all work.' }))),
      h('li', null, h('div', null, h('b', { text: 'Add Cleo Admin to it' }), h('p', { text: 'Scan the code with the app, or type the key in by hand.' }),
        h('div', { class: 'qr' }, qr ? h('img', { src: qr, alt: 'QR code for your authenticator app', width: '148', height: '148' }) : null,
          h('div', null, h('span', { class: 'label', text: 'Set-up key' }), secretBox)))),
      h('li', null, h('div', null, h('b', { text: 'Type the code it shows' }), form))) : null;
    const { heading } = gateCard({
      title: setup ? 'Set up two-step verification' : 'Enter your code',
      lede: setup ? 'The admin console can’t be opened with a password alone. This takes about a minute, once.'
        : `Open your authenticator app and type the 6-digit code for ${state.admin?.email || 'Cleo Admin'}.`,
      wide: setup,
      body: setup ? [steps] : [form],
      foot: [signOutButton(), setup ? h('span', { text: 'Keep the app: you need it every time you sign in.' }) : appLink()],
    });
    if (setup) heading.focus({ preventScroll: true }); else code.focus({ preventScroll: true });
  }

  function deniedScreen() {
    state.stage = 'denied';
    const { heading } = gateCard({
      title: 'This account isn’t an admin',
      lede: 'The password was right, but this account has no access to the admin console. Nothing was shown or changed, and it has been signed out here.',
      body: [h('p', { class: 'note' }, icon('info'), 'Admin access is granted by the database owner, never from this page. If you should have it, ask whoever runs Cleo’s Supabase project.')],
      foot: [h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => signInScreen() }, icon('arrow-left'), 'Use another account'), appLink()],
    });
    forget(); heading.focus({ preventScroll: true });
  }
  function setupScreen() {
    state.stage = 'setup';
    const { heading } = gateCard({
      title: 'Admin tools aren’t installed yet', wide: true,
      lede: 'Your sign-in worked. The server is missing the admin functions, so there is nothing to open yet.',
      body: [h('ol', { class: 'steps-list' },
        h('li', null, h('div', null, h('b', { text: 'Apply the database migrations' }), h('p', { text: 'In the Supabase SQL Editor, run the files in supabase/migrations in order, up to 202611140005_platform_admin.sql.' }))),
        h('li', null, h('div', null, h('b', { text: 'Make yourself an admin' }), h('p', { text: 'Run the one INSERT at the top of that last file, with your own email address.' }))),
        h('li', null, h('div', null, h('b', { text: 'Reload this page' }), h('p', { text: 'Each step is written out in Docs/ADMIN_AND_SECURITY.md.' }))))],
      foot: [signOutButton(), appLink()],
    });
    heading.focus({ preventScroll: true });
  }
  function unconfiguredScreen() {
    state.stage = 'unconfigured';
    gateCard({
      title: 'Cleo Admin isn’t connected',
      lede: 'This copy of the page has no usable server settings, so nobody can sign in here.',
      body: [h('p', { class: 'note bad' }, icon('plugs'), 'admin.html needs the Supabase project address and its publishable key in #cleo-env, and the sign-in library in assets/vendor. A secret or service-role key is refused.')],
      foot: [appLink()],
    });
  }

  async function openConsole() {
    let started = null;
    try { started = sessionStorage.getItem('cleo:admin-started'); } catch { /* blocked storage: recorded each load */ }
    if (started !== state.userId) {
      try { await rpc('cleo_admin_session_start'); sessionStorage.setItem('cleo:admin-started', state.userId || '1'); }
      catch (failure) { const refusal = explain(failure); if (reroute(refusal)) return; /* the console still opens; the next action reports a real fault */ }
    }
    state.stage = 'console';
    lastActive = Date.now();
    shell();
  }

  /* ---------- the console ---------- */
  const VIEWS = [
    ['overview', 'Overview', 'squares-four'],
    ['accounts', 'Accounts', 'users'],
    ['businesses', 'Businesses', 'storefront'],
    ['payments', 'Payments', 'receipt'],
    ['admins', 'Admins', 'user-gear'],
    ['security', 'Security', 'shield-check'],
    ['activity', 'Admin history', 'clock-counter-clockwise'],
  ];
  // Admins is for superadmins only: the server refuses everyone else anyway
  const visibleViews = () => VIEWS.filter(([id]) => id !== 'admins' || state.admin?.role === 'superadmin');
  let main = null, nav = null;
  function shell() {
    const admin = state.admin || {};
    nav = h('nav', { class: 'nav', 'aria-label': 'Admin sections' }, visibleViews().map(([id, label, glyph]) =>
      h('button', { type: 'button', dataset: { view: id }, onclick: () => { location.hash = `#${id}`; } }, icon(glyph), label)));
    main = h('main', { class: 'main', id: 'view', tabindex: '-1' });
    mount(h('div', { class: 'shell' },
      h('aside', { class: 'side' }, lockup(), nav,
        h('div', { class: 'side-foot' },
          h('div', { class: 'who' }, h('b', { text: admin.name || 'Admin' }), h('span', { text: admin.email || '' })),
          h('div', { class: 'badges' }, h('span', { class: `badge ${admin.canWrite ? 'info' : ''}`, text: admin.canWrite ? 'Superadmin' : 'Support · read only' })),
          signOutButton())),
      main));
    route();
  }
  function route() {
    if (state.stage !== 'console' || !main) return;
    const wanted = location.hash.replace(/^#/, '');
    const id = visibleViews().some(([v]) => v === wanted) ? wanted : 'overview';
    state.view = id;
    nav.querySelectorAll('button').forEach((b) => { if (b.dataset.view === id) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
    const host = h('div', { class: 'view' });
    main.replaceChildren(host);
    ({ overview: overviewView, accounts: accountsView, businesses: businessesView, payments: paymentsView, admins: adminsView, security: securityView, activity: activityView })[id](host);
    document.title = `${VIEWS.find(([v]) => v === id)[1]} · Cleo Admin`;
    main.scrollTo?.(0, 0); window.scrollTo(0, 0);
  }
  addEventListener('hashchange', route);

  const head = (title, sub, ...tools) => h('header', { class: 'view-head' }, h('div', null, h('h1', { text: title }), sub ? h('p', { text: sub }) : null), tools.length ? h('div', { class: 'filters' }, tools) : null);
  const empty = (glyph, title, body) => h('div', { class: 'empty' }, icon(glyph), h('b', { text: title }), body ? h('span', { text: body }) : null);
  /** a view's own failure: said in place, with a way to try again */
  function failed(host, failure, retry) {
    const refusal = explain(failure);
    if (reroute(refusal)) return;
    host.replaceChildren(h('div', { class: 'empty', role: 'alert' }, icon('warning-circle'), h('b', { text: 'This couldn’t be loaded' }), h('span', { text: refusal.message }),
      h('div', null, h('button', { class: 'btn btn-sm', type: 'button', onclick: retry }, icon('arrow-clockwise'), 'Try again'))));
  }
  /** load into `host`; while a reload runs, the last render stays up at reduced opacity (no flash, no jump) */
  async function fill(host, request, draw) {
    const stillHere = () => host.isConnected;
    if (!host.childElementCount) host.replaceChildren(h('div', { class: 'empty', role: 'status' }, h('span', { class: 'spin', 'aria-hidden': 'true' }), h('span', { text: 'Loading' })));
    host.classList.add('is-loading');
    try { const data = await request(); if (stillHere()) draw(data); }
    catch (failure) { if (stillHere()) failed(host, failure, () => fill(host, request, draw)); }
    finally { host.classList.remove('is-loading'); }
  }

  /* ---------- figures and charts ----------
     Stat tiles for single numbers. One hue for magnitude (Cleo's first series colour, checked for
     contrast on both themes). Thin columns with a 4px rounded top on one baseline, three hairlines,
     a tooltip on hover and on the arrow keys, and a table view for every chart. */
  const tile = (label, value, delta, attention = false) => h('div', { class: `tile${attention ? ' attn' : ''}` }, h('span', { class: 'label', text: label }), h('span', { class: 'value', text: value }), delta ? h('span', { class: 'delta', text: delta }) : null);
  function niceMax(value) {
    if (value <= 2) return 2;
    const power = 10 ** Math.floor(Math.log10(value));
    for (const m of [1, 2, 4, 5, 6, 8, 10]) { const candidate = m * power; if (candidate >= value && Number.isInteger(candidate / 2)) return candidate; }
    return 10 * power;
  }
  function columnChart({ title, unit, days, field }) {
    const values = days.map((d) => Number(d[field]) || 0);
    const total = values.reduce((sum, v) => sum + v, 0), top = niceMax(Math.max(0, ...values));
    const said = (i) => `${plural(values[i], unit[0], unit[1])}, ${dayLabel(days[i].day, true)}`;
    const tip = h('div', { class: 'tip', hidden: true });
    const live = h('span', { class: 'sr-only', 'aria-live': 'polite' });
    const cols = days.map((d, i) => { const bar = h('i'); bar.style.height = `${(values[i] / top) * 100}%`; return h('div', { class: 'col', dataset: { i: String(i) } }, bar); });
    const plot = h('div', { class: 'plot', tabindex: '0', role: 'group', 'aria-roledescription': 'chart',
      'aria-label': `${title} per day, last ${days.length} days: ${n(total)} in total. Arrow keys read each day.` },
      h('span', { class: 'gl g0' }), h('span', { class: 'gl g1' }), h('span', { class: 'gl g2' }), h('div', { class: 'cols' }, cols), tip);
    let active = -1;
    function show(i, announce = false) {
      active = i;
      cols.forEach((c, k) => c.classList.toggle('on', k === i));
      if (i < 0) { tip.hidden = true; return; }
      // the value leads, the day follows
      tip.replaceChildren(h('b', { text: plural(values[i], unit[0], unit[1]) }), h('span', { text: dayLabel(days[i].day, true) }));
      tip.hidden = false;
      const col = cols[i], x = col.offsetLeft + col.offsetWidth / 2;
      tip.style.left = `${clamp(x - tip.offsetWidth / 2, 0, Math.max(0, plot.clientWidth - tip.offsetWidth))}px`;
      tip.style.top = `${Math.max(0, plot.clientHeight * (1 - values[i] / top) - tip.offsetHeight - 8)}px`;
      if (announce) live.textContent = said(i);
    }
    plot.addEventListener('pointermove', (e) => { const col = e.target.closest?.('.col'); if (col) show(Number(col.dataset.i)); });
    plot.addEventListener('pointerleave', () => { if (document.activeElement !== plot) show(-1); });
    plot.addEventListener('focus', () => show(active >= 0 ? active : days.length - 1, true));
    plot.addEventListener('blur', () => show(-1));
    plot.addEventListener('keydown', (e) => {
      const step = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
      if (step) { e.preventDefault(); show(clamp((active < 0 ? days.length - 1 : active) + step, 0, days.length - 1), true); }
      else if (e.key === 'Home') { e.preventDefault(); show(0, true); }
      else if (e.key === 'End') { e.preventDefault(); show(days.length - 1, true); }
      else if (e.key === 'Escape') show(-1);
    });
    const marks = [0, Math.floor((days.length - 1) / 4), Math.floor((days.length - 1) / 2), Math.floor(((days.length - 1) * 3) / 4), days.length - 1];
    const chart = h('div', { class: 'chart-body' },
      h('div', { class: 'chart-y', 'aria-hidden': 'true' }, h('span', { text: n(top) }), h('span', { text: n(top / 2) }), h('span', { text: '0' })),
      plot,
      h('div', { class: 'chart-x', 'aria-hidden': 'true' }, [...new Set(marks)].map((i) => h('span', { text: dayLabel(days[i].day) }))));
    const table = h('div', { class: 'chart-table', hidden: true, tabindex: '0', role: 'region', 'aria-label': `${title} per day, as a table` },
      h('table', null, h('thead', null, h('tr', null, h('th', { scope: 'col', text: 'Day' }), h('th', { scope: 'col', class: 'r', text: title }))),
        h('tbody', null, days.map((d, i) => h('tr', null, h('td', { text: dayLabel(d.day, true) }), h('td', { class: 'r num', text: n(values[i]) }))).reverse())));
    const toggle = h('button', { class: 'btn btn-sm btn-ghost', type: 'button', 'aria-pressed': 'false', onclick: () => {
      const asTable = table.hidden; table.hidden = !asTable; chart.hidden = asTable;
      toggle.setAttribute('aria-pressed', String(asTable)); toggle.replaceChildren(icon(asTable ? 'chart-bar' : 'table'), asTable ? 'Chart' : 'Table');
    } }, icon('table'), 'Table');
    return h('section', { class: 'card' },
      h('div', { class: 'chart-head' }, h('div', null, h('h2', { text: title }), h('p', { text: `${n(total)} in the last ${days.length} days` })), toggle),
      chart, table, live);
  }
  /** several counts against one whole: a name, a bar and a figure per row */
  function meterCard({ title, note, rows, whole }) {
    return h('section', { class: 'card' },
      h('div', { class: 'card-head' }, h('h2', { text: title }), note ? h('p', { text: note }) : null),
      h('ul', { class: 'meters' }, rows.map(([glyph, name, value]) => {
        const bar = h('i'); bar.style.width = `${Number(whole) > 0 ? clamp((Number(value) / Number(whole)) * 100, 0, 100) : 0}%`;
        return h('li', { class: 'meter-row' }, h('span', { class: 'name' }, icon(glyph), name), h('span', { class: 'meter', 'aria-hidden': 'true' }, bar),
          h('span', { class: 'fig' }, h('b', { text: n(value) }), ` · ${share(value, whole)}`));
      })));
  }

  /* ---------- Overview ---------- */
  function overviewView(host) {
    const load = () => fill(host, () => Promise.all([rpc('cleo_admin_overview'), rpc('cleo_admin_billing_overview')]).then(([o, money]) => ({ ...o, money })), (o) => {
      const a = o.accounts || {}, b = o.businesses || {}, p = o.providers || {}, days = Array.isArray(o.signups) ? o.signups : [], m = o.money || {};
      host.replaceChildren(
        head('Overview', `Updated ${when(o.generatedAt, DATETIME)}, Manila time`, h('button', { class: 'btn btn-sm', type: 'button', onclick: load }, icon('arrow-clockwise'), 'Refresh')),
        h('section', { class: 'tiles', 'aria-label': 'Key figures' },
          tile('Accounts', n(a.total), `${n(a.new7)} new in 7 days`),
          tile('Businesses', n(b.total), `${n(b.new7)} new in 7 days`),
          tile('Signed in this week', n(a.active7), `of ${plural(a.confirmed, 'confirmed account', 'confirmed accounts')}`),
          tile('Waiting to set up', n(a.pendingSetup), 'Confirmed, no business yet'),
          tile('Two-step sign-in on', n(a.twoStep), `${share(a.twoStep, a.total)} of accounts`),
          tile('Suspended', n(a.suspended), Number(a.suspended) > 0 ? 'See Accounts, filter Suspended' : 'None', Number(a.suspended) > 0)),
        h('section', { class: 'tiles', 'aria-label': 'Plans and money' },
          tile('Paid plans running', n(m.activePaid), `${n(m.activeFree)} on Free`),
          tile('Businesses with no plan', n(m.noPlan), 'They stop at the plan page', Number(m.noPlan) > 0),
          tile('Ending within 7 days', n(m.endingSoon), 'Owners pay again to continue', Number(m.endingSoon) > 0),
          tile('Paid this month', peso(m.paidThisMonth), `${plural(m.pendingPayments, 'payment', 'payments')} waiting`)),
        days.length ? h('div', { class: 'grid-2' },
          columnChart({ title: 'New accounts', unit: ['account', 'accounts'], days, field: 'accounts' }),
          columnChart({ title: 'New businesses', unit: ['business', 'businesses'], days, field: 'businesses' })) : null,
        h('div', { class: 'grid-2' },
          meterCard({ title: 'How people sign in', note: 'An account can use more than one', whole: a.total,
            rows: [['envelope-simple', 'Email', p.email], ['google-logo', 'Google', p.google], ...(Number(p.facebook) > 0 ? [['facebook-logo', 'Facebook (switched off)', p.facebook]] : [])] }),
          meterCard({ title: 'What businesses sell', note: `${plural(b.branches, 'branch', 'branches')} in all`, whole: b.total,
            rows: [['coffee', 'Food and drinks', b.fnb], ['bag', 'Retail goods', b.retail], ['scissors', 'Services', b.svc]] })));
    });
    load();
  }

  /* ---------- tables: search, filter, page ---------- */
  const PAGE = 25;
  function pager(result, onMove) {
    const from = result.total ? result.offset + 1 : 0, to = Math.min(result.offset + result.rows.length, result.total);
    return h('div', { class: 'pager' }, h('span', { class: 'num', text: `${n(from)}–${n(to)} of ${n(result.total)}` }),
      h('div', null,
        h('button', { class: 'btn btn-sm', type: 'button', disabled: result.offset <= 0, onclick: () => onMove(Math.max(0, result.offset - PAGE)) }, icon('caret-left'), 'Previous'),
        h('button', { class: 'btn btn-sm', type: 'button', disabled: to >= result.total, onclick: () => onMove(result.offset + PAGE) }, 'Next', icon('caret-right'))));
  }
  const searchBox = (label, onInput) => {
    const input = h('input', { class: 'input', type: 'search', placeholder: label, 'aria-label': label, maxlength: '100', autocomplete: 'off', spellcheck: 'false' });
    let timer = 0;
    input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => onInput(input.value.trim()), 280); });
    return h('div', { class: 'search' }, icon('magnifying-glass'), input);
  };
  // one wrapper per cell, so a folded table lays out a label beside the whole value
  const cell = (label, ...kids) => h('td', { 'data-label': label }, h('div', null, kids));
  const PROVIDERS = { email: ['envelope-simple', 'Email'], google: ['google-logo', 'Google'], facebook: ['facebook-logo', 'Facebook'] };
  const ROLES = { owner: 'Owner', hq: 'HQ Manager', manager: 'Branch Manager', cashier: 'Cashier', kitchen: 'Kitchen', clerk: 'Stock Clerk', accountant: 'Accountant' };
  // a status is always an icon and a word, never a colour alone
  const onOff = (on, yes, no) => h('span', { class: `badge ${on ? 'good' : ''}` }, icon(on ? 'check-circle' : 'minus-circle'), on ? yes : no);

  /* ---------- Accounts ---------- */
  function accountsView(host) {
    const query = { search: '', filter: 'all', offset: 0 };
    const list = h('div', { class: 'card flush' });
    const filter = h('select', { class: 'select', 'aria-label': 'Show' },
      [['all', 'All accounts'], ['facebook', 'Signed up with Facebook'], ['google', 'Signed up with Google'], ['email', 'Email and password only'],
        ['unconfirmed', 'Email not confirmed'], ['no_business', 'No business yet'], ['no_two_step', 'Two-step sign-in off'], ['suspended', 'Suspended']]
        .map(([value, label]) => h('option', { value, text: label })));
    filter.addEventListener('change', () => { query.filter = filter.value; query.offset = 0; load(); });
    let turn = 0;
    const load = () => {
      const mine = ++turn;
      return fill(list, () => rpc('cleo_admin_list_accounts', { p_search: query.search, p_filter: query.filter, p_limit: PAGE, p_offset: query.offset }), (result) => {
        if (mine !== turn) return;
        if (!result.rows.length) { list.replaceChildren(empty('users', 'No accounts match', query.search || query.filter !== 'all' ? 'Try another search or filter.' : 'Nobody has signed up yet.')); return; }
        list.replaceChildren(h('div', { class: 'table-wrap' }, h('table', { class: 'stack' },
          h('thead', null, h('tr', null, ['Account', 'Signs in with', 'Business', 'Joined', 'Status'].map((t) => h('th', { scope: 'col', text: t })), h('th', { scope: 'col' }, h('span', { class: 'sr-only', text: 'Actions' })))),
          h('tbody', null, result.rows.map(accountRow)))), pager(result, (offset) => { query.offset = offset; load(); }));
      });
    };
    function accountRow(row) {
      const methods = [...new Set([row.provider, ...(Array.isArray(row.providers) ? row.providers : [])])].filter((m) => PROVIDERS[m]);
      const status = row.suspended ? h('span', { class: 'badge bad', title: row.suspendedReason || null }, icon('prohibit'), 'Suspended')
        : row.banned ? h('span', { class: 'badge bad' }, icon('prohibit'), 'Banned in Auth')
        : !row.confirmed ? h('span', { class: 'badge warn' }, icon('envelope-simple'), 'Not confirmed')
        : h('span', { class: 'badge good' }, icon('check-circle'), 'Active');
      const mine = row.id === state.userId;
      const action = !state.admin?.canWrite || mine || row.adminRole || row.banned ? null
        : row.suspended ? h('button', { class: 'btn btn-sm', type: 'button', onclick: () => suspension(row, false, load) }, 'Restore')
        : h('button', { class: 'btn btn-sm btn-danger', type: 'button', onclick: () => suspension(row, true, load) }, 'Suspend');
      return h('tr', null,
        cell('Account', h('span', { class: 'strong clip', text: row.name || '—' }), h('span', { class: 'sub clip', text: row.email || 'No email address' })),
        cell('Signs in with', h('span', { class: 'badges' }, methods.map((m) => h('span', { class: 'badge' }, icon(PROVIDERS[m][0]), PROVIDERS[m][1])))),
        cell('Business', row.business ? [h('span', { class: 'clip', text: row.business }), h('span', { class: 'sub', text: `${ROLES[row.role] || row.role || ''}${row.membershipRevoked ? ' · access revoked' : ''}` })] : h('span', { class: 'muted', text: 'None yet' })),
        cell('Joined', h('span', { class: 'num', text: when(row.createdAt) }), h('span', { class: 'sub num', text: row.lastSignInAt ? `Last sign-in ${ago(row.lastSignInAt).toLowerCase()}` : 'Never signed in' })),
        cell('Status', h('span', { class: 'badges' }, status, onOff(row.twoStep, 'Two-step on', 'No two-step'), row.adminRole ? h('span', { class: 'badge info' }, icon('shield-check'), row.adminRole === 'superadmin' ? 'Superadmin' : 'Support') : null, mine ? h('span', { class: 'badge', text: 'You' }) : null)),
        h('td', { class: 'actions' }, h('div', { class: 'row-actions' }, smallButton('Open', null, () => accountSheet(row.id, load)), action)));
    }
    host.replaceChildren(head('Accounts', 'Everyone who has signed up, newest first.'),
      h('div', { class: 'filters' }, searchBox('Search name, email or business', (text) => { query.search = text; query.offset = 0; load(); }), filter), list);
    load();
  }
  /** suspend (with a reason) or restore one account */
  function suspension(row, suspend, done) {
    const who = row.email || row.name || 'this account';
    const reason = h('textarea', { class: 'textarea', id: 'ad-reason', maxlength: '500', required: true, placeholder: 'Example: reported as a stolen account' });
    const field = h('div', { class: 'field' }, h('label', { for: 'ad-reason', text: 'Reason (kept in the admin history)' }), reason,
      h('p', { class: 'err', role: 'alert' }, icon('warning-circle', true), 'Give a reason of at least 3 characters.'));
    const error = h('p', { class: 'note bad', role: 'alert', hidden: true });
    const confirm = h('button', { class: `btn ${suspend ? 'btn-danger' : 'btn-primary'}`, type: 'button', text: suspend ? 'Suspend account' : 'Restore account' });
    const box = dialog({
      title: suspend ? `Suspend ${who}?` : `Restore ${who}?`,
      lede: suspend ? 'They lose access to Cleo everywhere at once, and can’t sign back in until you restore the account. Their business and its records are kept.'
        : `They can sign in again straight away.${row.suspendedReason ? ` Suspended for: ${row.suspendedReason}` : ''}`,
      body: [suspend ? field : null, error],
      foot: [h('button', { class: 'btn', type: 'button', text: 'Cancel', onclick: () => box.close() }), confirm],
    });
    reason.addEventListener('input', () => field.classList.remove('invalid'));
    confirm.addEventListener('click', async () => {
      const text = reason.value.trim();
      if (suspend && text.length < 3) { field.classList.add('invalid'); reason.focus(); return; }
      busy(confirm, true); error.hidden = true;
      try {
        await rpc('cleo_admin_set_suspension', { p_user_id: row.id, p_suspended: suspend, p_reason: suspend ? text : '' });
        box.close();
        toast(suspend ? 'Account suspended' : 'Account restored', who);
        done();
      } catch (failure) {
        const refusal = explain(failure);
        if (reroute(refusal)) { box.close(); return; }
        busy(confirm, false); error.replaceChildren(icon('warning-circle', true), refusal.message); error.hidden = false;
      }
    });
    (suspend ? reason : confirm).focus();
  }

  /* ---------- Businesses ---------- */
  const MODULES = { fnb: 'Food and drinks', retail: 'Retail', svc: 'Services' };
  function businessesView(host) {
    const query = { search: '', offset: 0 };
    const list = h('div', { class: 'card flush' });
    let turn = 0;
    const load = () => {
      const mine = ++turn;
      return fill(list, () => Promise.all([rpc('cleo_admin_list_businesses', { p_search: query.search, p_limit: PAGE, p_offset: query.offset }), rpc('cleo_admin_business_plans')])
        .then(([page, plans]) => ({ ...page, plans: plans || {} })), (result) => {
        if (mine !== turn) return;
        if (!result.rows.length) { list.replaceChildren(empty('storefront', 'No businesses match', query.search ? 'Try another search.' : 'No business has been set up yet.')); return; }
        list.replaceChildren(h('div', { class: 'table-wrap' }, h('table', { class: 'stack' },
          h('thead', null, h('tr', null, h('th', { scope: 'col', text: 'Business' }), h('th', { scope: 'col', text: 'Owner' }), h('th', { scope: 'col', text: 'Plan' }), h('th', { scope: 'col', class: 'r', text: 'People' }),
            h('th', { scope: 'col', class: 'r', text: 'Branches' }), h('th', { scope: 'col', class: 'r', text: 'Products' }), h('th', { scope: 'col', text: 'Created' }),
            h('th', { scope: 'col' }, h('span', { class: 'sr-only', text: 'Actions' })))),
          h('tbody', null, result.rows.map((row) => h('tr', null,
            cell('Business', h('span', { class: 'strong clip', text: row.name }), h('span', { class: 'sub', text: (row.modules || []).map((m) => MODULES[m] || m).join(' · ') })),
            cell('Owner', row.hasOwner ? [h('span', { class: 'clip', text: row.ownerName || '—' }), h('span', { class: 'sub clip', text: row.ownerEmail })] : h('span', { class: 'badge warn' }, icon('warning'), 'No active owner')),
            cell('Plan', (() => { const p = result.plans[row.id]; return !p ? h('span', { class: 'badge warn', text: 'No plan' })
              : h('span', { class: `badge ${p.active ? (p.plan === 'free' ? '' : 'info') : 'warn'}`, text: `${PLAN_NAMES[p.plan] || p.plan}${p.active ? '' : ' · ended'}` }); })(),
              result.plans[row.id]?.periodEnd ? h('span', { class: 'sub num', text: `to ${when(result.plans[row.id].periodEnd)}` }) : null),
            h('td', { class: 'r num', 'data-label': 'People' }, h('div', { text: n(row.members) })),
            h('td', { class: 'r num', 'data-label': 'Branches' }, h('div', { text: n(row.branches) })),
            h('td', { class: 'r num', 'data-label': 'Products' }, h('div', { text: n(row.products) })),
            cell('Created', h('span', { class: 'num', text: when(row.createdAt) }), h('span', { class: 'sub num', text: row.lastActivityAt ? `Last change ${ago(row.lastActivityAt).toLowerCase()}` : 'No changes yet' })),
            h('td', { class: 'actions' }, h('button', { class: 'btn btn-sm', type: 'button', onclick: () => businessSheet(row.id, load) }, 'Open'))))))),
          pager(result, (offset) => { query.offset = offset; load(); }));
      });
    };
    host.replaceChildren(head('Businesses', 'Every business set up on Cleo, newest first.'),
      h('div', { class: 'filters' }, searchBox('Search business or owner', (text) => { query.search = text; query.offset = 0; load(); })), list);
    load();
  }
  const ACTIONS = {
    'products.save': 'Product saved', 'products.archive': 'Product archived', 'ingredients.save': 'Stock item saved', 'ingredients.archive': 'Stock item archived',
    'categories.save': 'Category saved', 'categories.archive': 'Category archived', 'modifiers.save': 'Modifier saved', 'modifiers.archive': 'Modifier archived',
    'customers.save': 'Customer saved', 'customers.erase': 'Customer erased', 'settings.save': 'Setting changed', 'period.lock': 'Month locked', 'period.reopen': 'Month reopened',
    'stock.receive': 'Delivery received', 'stock.adjust': 'Stock adjusted', 'stock.count': 'Stock counted',
    'transfer.request': 'Transfer requested', 'transfer.approve': 'Transfer approved', 'transfer.dispatch': 'Transfer dispatched', 'transfer.receive': 'Transfer received', 'transfer.reject': 'Transfer rejected',
    'admin.membership.revoke': 'Access revoked by Cleo support', 'admin.membership.restore': 'Access restored by Cleo support',
    'admin.membership.role': 'Role changed by Cleo support', 'admin.membership.add': 'Added by Cleo support', 'admin.business.rename': 'Renamed by Cleo support',
    'admin.plan.set': 'Plan set by Cleo support', 'admin.plan.end': 'Plan ended by Cleo support', 'billing.paid': 'Plan paid', 'billing.plan': 'Plan started',
  };
  function businessSheet(id, changed) {
    const content = h('div', null);
    const box = dialog({ title: 'Business', sheet: true, body: [content] });
    const heading = box.el.querySelector('h2');
    const load = () => fill(content, () => rpc('cleo_admin_business', { p_business_id: id }), (d) => {
      heading.textContent = d.business.name;
      box.el.setAttribute('aria-label', d.business.name);
      const c = d.counts || {};
      // a change made to a person is listed under their id: show who that is
      const known = new Map(d.members.map((m) => [m.userId, m.email || m.name]));
      content.replaceChildren(h('div', { class: 'sheet-body' },
        h('div', { class: 'chips' }, (d.business.modules || []).map((m) => h('span', { class: 'badge', text: MODULES[m] || m })), h('span', { class: 'badge', text: `Created ${when(d.business.createdAt)}` })),
        h('div', { class: 'tiles' }, tile('Products', n(c.products)), tile('Stock items', n(c.stockItems)), tile('Customers', n(c.customers)), tile('Stock movements', n(c.stockMovements)), tile('Transfers', n(c.transfers))),
        state.admin?.canWrite ? actionsBar(smallButton('Rename business', 'pencil-simple', () => formDialog({ title: `Rename ${d.business.name}`, fields: [{ id: 'name', label: 'Business name', value: d.business.name }],
          run: (v) => rpc('cleo_admin_rename_business', { p_business_id: id, p_name: v.name, p_reason: v.reason }), done: () => { toast('Business renamed'); businessChoices = null; load(); changed(); } }))) : null,
        planSection(id, changed),
        h('section', null, h('h3', { text: `People (${n(d.members.length)})` }), h('div', { class: 'card' }, h('div', { class: 'table-wrap' }, h('table', { class: 'stack' },
          h('thead', null, h('tr', null, ['Person', 'Role', 'Last sign-in', 'Access'].map((t) => h('th', { scope: 'col', text: t })), h('th', { scope: 'col' }, h('span', { class: 'sr-only', text: 'Actions' })))),
          h('tbody', null, d.members.map((m) => h('tr', null,
            cell('Person', h('span', { class: 'strong clip', text: m.name || '—' }), h('span', { class: 'sub clip', text: m.email })),
            cell('Role', h('span', { text: ROLES[m.role] || m.role }), m.branch ? h('span', { class: 'sub', text: m.branch }) : null),
            cell('Last sign-in', h('span', { class: 'num', text: ago(m.lastSignInAt) })),
            cell('Access', h('span', { class: 'badges' }, m.revoked ? h('span', { class: 'badge warn' }, icon('prohibit'), 'Revoked') : h('span', { class: 'badge good' }, icon('check-circle'), 'Active'), onOff(m.twoStep, 'Two-step on', 'No two-step'),
              m.suspended ? h('span', { class: 'badge bad' }, icon('prohibit'), 'Account suspended') : null)),
            h('td', { class: 'actions' }, h('div', { class: 'row-actions' }, smallButton('Open', null, () => accountSheet(m.userId, () => { load(); changed(); })),
              state.admin?.canWrite && !m.revoked ? smallButton('Role', null, () => formDialog({ title: `Change ${m.email}’s role`, lede: `Now: ${ROLES[m.role] || m.role}${m.branch ? ` at ${m.branch}` : ''}.`,
                fields: [{ id: 'role', label: 'Role', type: 'select', value: m.role, options: Object.entries(ROLES) },
                  { id: 'branch', label: 'Branch', type: 'select', value: d.branches.find((b) => b.name === m.branch)?.id || d.branches[0]?.id, options: d.branches.map((b) => [b.id, b.name]), showIf: (v) => !['owner', 'hq'].includes(v.role) }],
                run: (v) => rpc('cleo_admin_set_member', { p_user_id: m.userId, p_business_id: id, p_role: v.role, p_branch_id: ['owner', 'hq'].includes(v.role) ? null : v.branch, p_reason: v.reason }),
                done: () => { toast('Role changed'); load(); changed(); } })) : null,
              state.admin?.canWrite ? h('button', { class: `btn btn-sm${m.revoked ? '' : ' btn-danger'}`, type: 'button',
              onclick: () => membership(d.business, m, () => { load(); changed(); }) }, m.revoked ? 'Restore' : 'Revoke') : null))))))))),
        h('section', null, h('h3', { text: `Branches (${n(d.branches.length)})` }), h('div', { class: 'chips' }, d.branches.map((b) => h('span', { class: 'badge', text: `${b.name}${b.city ? `, ${b.city}` : ''} · ${b.code}` })))),
        h('section', null, h('h3', { text: 'Recent changes' }), d.activity.length
          ? h('div', { class: 'card' }, h('ul', { class: 'activity' }, d.activity.map((a) => h('li', null, h('b', { text: ACTIONS[a.action] || a.action }), h('time', { text: when(a.at, DATETIME) }), h('span', { text: `${a.actor || 'Unknown'} · ${known.get(a.entity) || a.entity}` })))))
          : h('p', { class: 'muted', text: 'Nothing has been changed in this business yet.' }),
          h('p', { class: 'help', text: 'What changed and who changed it. The values themselves stay in the business’s own audit trail.' }))));
    });
    load();
  }
  function membership(business, member, done) {
    const revoke = !member.revoked, who = member.email || member.name || 'this person';
    const reason = h('textarea', { class: 'textarea', id: 'ad-m-reason', maxlength: '500', required: true, placeholder: revoke ? 'Example: the owner asked for this person to be removed' : 'Example: identity confirmed with the owner' });
    const field = h('div', { class: 'field' }, h('label', { for: 'ad-m-reason', text: 'Reason (kept in the admin history)' }), reason,
      h('p', { class: 'err', role: 'alert' }, icon('warning-circle', true), 'Give a reason of at least 3 characters.'));
    const error = h('p', { class: 'note bad', role: 'alert', hidden: true });
    const confirm = h('button', { class: `btn ${revoke ? 'btn-danger' : 'btn-primary'}`, type: 'button', text: revoke ? 'Revoke access' : 'Restore access' });
    const box = dialog({
      title: revoke ? `Revoke ${who}’s access?` : `Restore ${who}’s access?`,
      lede: revoke ? `They can no longer open ${business.name}. ${member.role === 'owner' ? 'This is the owner: the business is left with nobody who can manage it. ' : ''}The business sees in its audit trail that Cleo support made this change.`
        : `They can open ${business.name} again as ${ROLES[member.role] || member.role}.`,
      body: [field, error],
      foot: [h('button', { class: 'btn', type: 'button', text: 'Cancel', onclick: () => box.close() }), confirm],
    });
    reason.addEventListener('input', () => field.classList.remove('invalid'));
    confirm.addEventListener('click', async () => {
      const text = reason.value.trim();
      if (text.length < 3) { field.classList.add('invalid'); reason.focus(); return; }
      busy(confirm, true); error.hidden = true;
      try {
        await rpc('cleo_admin_set_membership', { p_user_id: member.userId, p_business_id: business.id, p_revoked: revoke, p_reason: text });
        box.close();
        toast(revoke ? 'Access revoked' : 'Access restored', `${who} · ${business.name}`);
        done();
      } catch (failure) {
        const refusal = explain(failure);
        if (reroute(refusal)) { box.close(); return; }
        busy(confirm, false); error.replaceChildren(icon('warning-circle', true), refusal.message); error.hidden = false;
      }
    });
    reason.focus();
  }

  /* ---------- Security ---------- */
  // What the server cannot see for itself. Each line says where the setting lives.
  const REVIEW = [
    ['globe', 'Only your real site may receive sign-ins', 'Supabase › Authentication › URL Configuration. Site URL is your live address; Redirect URLs lists only https://your-domain/index.html**. Remove the localhost entries before launch.'],
    ['facebook-logo', 'The Facebook app is live and locked to Supabase', 'Meta for Developers › your app. Mode: Live. Facebook Login › Settings › Valid OAuth Redirect URIs holds only the Supabase callback address. The email permission has Advanced Access, or people outside your team sign in without an email and are turned away.'],
    ['password', 'Passwords are checked against known leaks', 'Supabase › Authentication › Sign In / Providers › Email. Turn on leaked-password protection, keep the minimum length at 8 or more, and keep "require current password" on.'],
    ['envelope-simple', 'Email comes from your own sender', 'Supabase › Authentication › Emails › SMTP Settings. The built-in mailer sends only a few emails an hour, so confirmations stop arriving on a busy day.'],
    ['key', 'The secret keys have never left Supabase', 'The service_role and sb_secret keys bypass every rule on this page. They belong in no file, no chat and no browser. Rotate them in Project Settings › API Keys if they were ever pasted anywhere.'],
    ['lock-key', 'The site is served over HTTPS with its headers', 'Your host’s SSL certificate is active and .htaccess was uploaded next to landing.html. A header check (securityheaders.com) should list a Content-Security-Policy, HSTS and X-Frame-Options.'],
  ];
  function securityView(host) {
    const load = () => fill(host, () => rpc('cleo_admin_security_report'), (r) => {
      const checks = Array.isArray(r.checks) ? r.checks : [], failing = checks.filter((c) => !c.ok), advice = r.advice || {};
      host.replaceChildren(
        head('Security', `Checked ${when(r.generatedAt, DATETIME)}, Manila time`, h('button', { class: 'btn btn-sm', type: 'button', onclick: load }, icon('arrow-clockwise'), 'Check again')),
        h('p', { class: `note ${failing.length ? 'bad' : 'good'}`, role: 'status' }, icon(failing.length ? 'warning-circle' : 'shield-check', true),
          failing.length ? `${plural(failing.length, 'check needs', 'checks need')} attention. Each failing line below says what is wrong.`
            : `All ${n(checks.length)} checks pass. Nothing is readable or writable that shouldn’t be.`),
        h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', { text: 'Rules the server enforces' }), h('p', { text: 'Checked live, in the database' })),
          h('ul', { class: 'checks' }, checks.map((c) => h('li', { class: `check ${c.ok ? 'ok' : 'no'}` }, icon(c.ok ? 'check-circle' : 'warning-circle', true),
            h('div', null, h('b', { text: c.label }), h('p', { text: c.ok ? 'Holds' : c.detail || 'Does not hold' })))))),
        h('section', { class: 'tiles', 'aria-label': 'Worth a look' },
          tile('Owners without two-step', n(advice.ownersWithoutTwoStep), `of ${plural(advice.owners, 'owner', 'owners')}`, Number(advice.ownersWithoutTwoStep) > 0),
          tile('Unconfirmed for a week', n(advice.staleUnconfirmed), 'Sign-ups that never confirmed'),
          tile('Suspended now', n(advice.suspended), 'Accounts locked out')),
        h('section', { class: 'card flush' }, h('div', { class: 'card-head' }, h('h2', { text: 'Who can open this console' })),
          h('div', { class: 'table-wrap' }, h('table', { class: 'stack' },
            h('thead', null, h('tr', null, ['Admin', 'Level', 'Two-step', 'Since'].map((t) => h('th', { scope: 'col', text: t })))),
            h('tbody', null, (r.admins || []).map((a) => h('tr', null, cell('Admin', h('span', { class: 'clip', text: a.email })),
              cell('Level', h('span', { text: a.role === 'superadmin' ? 'Superadmin' : 'Support, read only' })), cell('Two-step', onOff(a.twoStep, 'On', 'Not set up')), cell('Since', h('span', { class: 'num', text: when(a.since) }))))))),
          h('p', { class: 'pager', text: 'Admins are added and removed in the Supabase SQL Editor (table cleo_platform_admins), never from a browser.' })),
        h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', { text: 'Settings only you can check' }), h('p', { text: 'Outside the database, so not checked above' })),
          h('ul', { class: 'todo' }, REVIEW.map(([glyph, title, body]) => h('li', null, icon(glyph), h('div', null, h('b', { text: title }), h('p', { text: body })))))));
    });
    load();
  }

  /* ---------- Admin history ---------- */
  const DEEDS = { 'session.start': 'Opened the admin console', 'account.suspend': 'Suspended an account', 'account.restore': 'Restored an account', 'membership.revoke': 'Revoked business access', 'membership.restore': 'Restored business access',
    'account.confirm_email': 'Confirmed an email', 'account.rename': 'Renamed an account', 'membership.role': 'Changed a role', 'membership.add': 'Added someone to a business',
    'business.rename': 'Renamed a business', 'plan.set': 'Set a plan', 'plan.end': 'Ended a plan', 'admin.add': 'Added an admin', 'admin.change': 'Changed admin access', 'admin.remove': 'Removed an admin' };
  function activityView(host) {
    const list = h('div', { class: 'card flush' });
    let offset = 0;
    const load = () => fill(list, () => rpc('cleo_admin_audit_log', { p_limit: PAGE, p_offset: offset }), (result) => {
      if (!result.rows.length) { list.replaceChildren(empty('clock-counter-clockwise', 'Nothing yet', 'Sign-ins to this console and every change made here are listed.')); return; }
      list.replaceChildren(h('div', { class: 'table-wrap' }, h('table', { class: 'stack' },
        h('thead', null, h('tr', null, ['When', 'Admin', 'What', 'Details'].map((t) => h('th', { scope: 'col', text: t })))),
        h('tbody', null, result.rows.map((row) => {
          const d = row.detail || {};
          const details = row.action === 'session.start' ? [d.ip, d.userAgent].filter(Boolean).join(' · ') || 'No device details'
            : [d.email, d.business, d.plan ? `${PLAN_NAMES[d.plan] || d.plan}${d.until ? ` until ${d.until}` : ''}` : '', d.after ? `“${d.before || ''}” → “${d.after}”` : '',
              d.role ? ROLES[d.role] || ({ superadmin: 'Superadmin', support: 'Support', none: 'Removed' })[d.role] || d.role : '', d.reason ? `Reason: ${d.reason}` : ''].filter(Boolean).join(' · ') || row.targetId;
          return h('tr', null, cell('When', h('span', { class: 'num', text: when(row.at, DATETIME) })), cell('Admin', h('span', { class: 'clip', text: row.admin })),
            cell('What', h('span', { class: 'strong', text: DEEDS[row.action] || row.action })), cell('Details', h('span', { class: 'sub', text: details })));
        })))), pager(result, (next) => { offset = next; load(); }));
    });
    host.replaceChildren(head('Admin history', 'Sign-ins to this console and every change made from it. It cannot be edited or deleted.'), list);
    load();
  }

  /* ---------- controls (migration 007): every change asks for a reason, which is kept ---------- */
  const PESO = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' });
  const peso = (v) => PESO.format(Number(v) || 0);
  const PLAN_NAMES = { free: 'Free', basic: 'Basic', pro: 'Pro', max: 'Max' };
  const METHOD_NAMES = { card: 'Card', gcash: 'GCash', maya: 'Maya', gotyme: 'GoTyme Bank', '': 'Set by an admin' };
  const STATUS_TONE = { paid: 'good', pending: 'warn', failed: 'bad', expired: '' };
  const isoDay = (date) => new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10);

  /** a form in a dialog: fields, an optional reason, and one action that runs on the server */
  function formDialog({ title, lede, fields = [], reason = true, confirm = 'Save', danger = false, run, done }) {
    const inputs = {};
    const row = (f) => {
      const id = `ad-f-${f.id}`;
      let control;
      if (f.type === 'select') control = h('select', { class: 'select', id }, f.options.map(([value, label]) => h('option', { value, text: label, selected: String(value) === String(f.value ?? '') || null })));
      else if (f.type === 'textarea') control = h('textarea', { class: 'textarea', id, maxlength: f.max || 500, placeholder: f.placeholder || '' });
      else control = h('input', { class: 'input', id, type: f.type || 'text', value: f.value ?? '', min: f.min ?? null, max: f.max ?? null, placeholder: f.placeholder || '', autocomplete: 'off', spellcheck: 'false' });
      if (f.type === 'textarea' && f.value) control.value = f.value;
      inputs[f.id] = control;
      const field = h('div', { class: 'field', dataset: { field: f.id } }, h('label', { for: id, text: f.label }), control, f.help ? h('p', { class: 'help', text: f.help }) : null);
      if (f.showIf) { field.hidden = !f.showIf(values()); }
      return field;
    };
    const values = () => Object.fromEntries(Object.entries(inputs).map(([k, el]) => [k, el.value.trim()]));
    const all = [...fields, ...(reason ? [{ id: 'reason', label: 'Reason (kept in the admin history)', type: 'textarea', placeholder: 'Example: the owner asked by email' }] : [])];
    const rows = all.map(row);
    const refresh = () => all.forEach((f, i) => { if (f.showIf) rows[i].hidden = !f.showIf(values()); });
    const error = h('p', { class: 'note bad', role: 'alert', hidden: true });
    const go = h('button', { class: `btn ${danger ? 'btn-danger' : 'btn-primary'}`, type: 'button', text: confirm });
    const box = dialog({ title, lede, body: [h('div', { class: 'form-stack' }, rows), error], foot: [h('button', { class: 'btn', type: 'button', text: 'Cancel', onclick: () => box.close() }), go] });
    Object.values(inputs).forEach((el) => el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'input', refresh));
    go.addEventListener('click', async () => {
      const v = values();
      if (reason && v.reason.length < 3) { error.replaceChildren(icon('warning-circle', true), 'Give a reason of at least 3 characters.'); error.hidden = false; inputs.reason.focus(); return; }
      busy(go, true); error.hidden = true;
      try {
        const result = await run(v);
        box.close();
        done?.(result, v);
      } catch (failure) {
        const refusal = explain(failure);
        if (reroute(refusal)) { box.close(); return; }
        busy(go, false); error.replaceChildren(icon('warning-circle', true), refusal.message); error.hidden = false;
      }
    });
    (Object.values(inputs)[0] || go).focus();
    return box;
  }
  const actionsBar = (...buttons) => h('div', { class: 'action-bar' }, buttons.filter(Boolean));
  const smallButton = (label, glyph, onclick, tone = '') => h('button', { class: `btn btn-sm${tone ? ` btn-${tone}` : ''}`, type: 'button', onclick }, glyph ? icon(glyph) : null, label);
  let businessChoices = null;
  async function businessOptions() {
    if (!businessChoices) businessChoices = (await rpc('cleo_admin_list_businesses', { p_search: '', p_limit: 100, p_offset: 0 })).rows;
    return businessChoices.map((b) => [b.id, `${b.name}${b.ownerEmail ? ` · ${b.ownerEmail}` : ''}`]);
  }

  /** one person: who they are, where they work, and everything an admin can do for them */
  function accountSheet(id, changed = () => {}) {
    const content = h('div', null);
    const box = dialog({ title: 'Account', sheet: true, body: [content] });
    const heading = box.el.querySelector('h2');
    const write = !!state.admin?.canWrite;
    const after = (message) => () => { toast(message); load(); changed(); };
    const load = () => fill(content, () => rpc('cleo_admin_account', { p_user_id: id }), (a) => {
      heading.textContent = a.name || a.email || 'Account';
      const mine = a.id === state.userId;
      const row = { id: a.id, email: a.email, name: a.name, suspendedReason: a.suspension?.reason || '' };
      const methods = [...new Set([a.provider, ...(Array.isArray(a.providers) ? a.providers : [])])].filter((m) => PROVIDERS[m]);
      content.replaceChildren(h('div', { class: 'sheet-body' },
        h('div', { class: 'chips' },
          h('span', { class: 'badge', text: a.email || 'No email address' }),
          methods.map((m) => h('span', { class: 'badge' }, icon(PROVIDERS[m][0]), PROVIDERS[m][1])),
          a.suspension ? h('span', { class: 'badge bad' }, icon('prohibit'), 'Suspended') : a.banned ? h('span', { class: 'badge bad' }, icon('prohibit'), 'Banned in Auth') : h('span', { class: 'badge good' }, icon('check-circle'), 'Active'),
          a.confirmed ? h('span', { class: 'badge good' }, icon('envelope-simple'), 'Email confirmed') : h('span', { class: 'badge warn' }, icon('envelope-simple'), 'Email not confirmed'),
          onOff(a.twoStep, 'Two-step on', 'No two-step'),
          a.adminRole ? h('span', { class: 'badge info' }, icon('shield-check'), a.adminRole === 'superadmin' ? 'Superadmin' : 'Support admin') : null),
        a.suspension ? h('p', { class: 'note bad' }, icon('prohibit'), `Suspended ${when(a.suspension.at, DATETIME)}: ${a.suspension.reason}`) : null,
        h('div', { class: 'tiles' }, tile('Joined', when(a.createdAt)), tile('Last sign-in', ago(a.lastSignInAt)),
          tile('Agreed to terms', a.legal ? when(a.legal.at) : 'Not yet', a.legal ? `via ${a.legal.method}` : '')),
        write && !mine ? actionsBar(
          smallButton('Rename', 'pencil-simple', () => formDialog({ title: `Rename ${a.email || 'this account'}`, fields: [{ id: 'name', label: 'Name', value: a.name }],
            run: (v) => rpc('cleo_admin_set_name', { p_user_id: a.id, p_name: v.name, p_reason: v.reason }), done: after('Name changed') })),
          !a.confirmed && a.email ? smallButton('Confirm email', 'envelope-simple-open', () => formDialog({ title: `Confirm ${a.email}?`,
            lede: 'Do this only when you are sure the address belongs to this person, for example after they wrote to you from it.', confirm: 'Confirm email',
            run: (v) => rpc('cleo_admin_confirm_email', { p_user_id: a.id, p_reason: v.reason }), done: after('Email confirmed') })) : null,
          a.email ? smallButton('Send password reset', 'key', () => resetPassword(a.email)) : null,
          smallButton(a.memberships.some((m) => !m.revoked) ? 'Change role' : 'Add to a business', 'briefcase', async () => {
            const current = a.memberships.find((m) => !m.revoked);
            let options;
            try { options = await businessOptions(); } catch (failure) { toast('Businesses couldn’t be loaded', explain(failure).message, 'bad'); return; }
            formDialog({ title: current ? `Change ${a.email}’s role` : `Add ${a.email} to a business`,
              lede: current ? `Now: ${ROLES[current.role] || current.role} at ${current.business}.` : 'An account belongs to one business at a time.',
              fields: [
                { id: 'business', label: 'Business', type: 'select', options: current ? [[current.businessId, current.business]] : options, value: current?.businessId },
                { id: 'role', label: 'Role', type: 'select', options: Object.entries(ROLES), value: current?.role || 'cashier', help: 'Owner and HQ see every branch. Other roles work in the business’s first branch unless changed in the app.' }],
              run: (v) => rpc('cleo_admin_set_member', { p_user_id: a.id, p_business_id: v.business, p_role: v.role, p_branch_id: null, p_reason: v.reason }),
              done: after(current ? 'Role changed' : 'Added to the business') });
          }),
          a.adminRole ? null : (a.suspension
            ? smallButton('Restore account', 'arrow-counter-clockwise', () => suspension(row, false, () => { load(); changed(); }))
            : smallButton('Suspend account', 'prohibit', () => suspension(row, true, () => { load(); changed(); }), 'danger')),
          state.admin?.role === 'superadmin' && a.email && a.confirmed && !a.suspension ? smallButton(a.adminRole ? 'Change admin access' : 'Make admin', 'shield-check', () => adminDialog(a.email, a.adminRole, () => { load(); changed(); })) : null)
          : mine ? h('p', { class: 'help', text: 'This is your own account. Another superadmin changes it.' }) : null,
        h('section', null, h('h3', { text: 'Businesses' }), a.memberships.length
          ? h('div', { class: 'card' }, h('ul', { class: 'activity' }, a.memberships.map((m) => h('li', null,
            h('b', { text: m.business }), h('time', { text: m.revoked ? 'Access revoked' : `Since ${when(m.since)}` }),
            h('span', { text: `${ROLES[m.role] || m.role}${m.branch ? ` · ${m.branch}` : ''}` })))))
          : h('p', { class: 'muted', text: 'Not part of any business yet.' })),
        h('section', null, h('h3', { text: 'What they changed recently' }), a.activity.length
          ? h('div', { class: 'card' }, h('ul', { class: 'activity' }, a.activity.map((x) => h('li', null, h('b', { text: ACTIONS[x.action] || x.action }), h('time', { text: when(x.at, DATETIME) }), h('span', { text: `${x.business} · ${x.entity}` })))))
          : h('p', { class: 'muted', text: 'Nothing yet.' })),
        a.suspensions.length > 1 || (a.suspensions.length === 1 && !a.suspension) ? h('section', null, h('h3', { text: 'Past suspensions' }),
          h('div', { class: 'card' }, h('ul', { class: 'activity' }, a.suspensions.filter((s) => s.liftedAt).map((s) => h('li', null, h('b', { text: s.reason }), h('time', { text: when(s.at) }), h('span', { text: `Lifted ${when(s.liftedAt)}` })))))) : null));
    });
    load();
  }

  /** the person receives Supabase's own reset email and chooses a new password themselves */
  function resetPassword(email) {
    formDialog({ title: `Send a password reset to ${email}?`, reason: false, confirm: 'Send email',
      lede: 'They get an email with a link to choose a new password. You never see or set it. Supabase limits how many emails it sends an hour.',
      run: async () => {
        const result = await client().auth.resetPasswordForEmail(email, { redirectTo: new URL('../index.html?auth=recovery', location.href).href });
        if (result?.error) throw result.error;
        return { ok: true };
      },
      done: () => toast('Password reset sent', email) });
  }

  /** add, change or remove one admin */
  function adminDialog(email = '', current = null, done = () => {}) {
    formDialog({ title: current ? `Admin access for ${email}` : email ? `Make ${email} an admin?` : 'Add an admin',
      lede: 'Superadmins can change anything here. Support admins can look but not change. Every admin must set up an authenticator app the first time.',
      fields: [
        ...(email ? [] : [{ id: 'email', label: 'Email of their Cleo account', type: 'email', placeholder: 'name@example.com', help: 'The person signs up for Cleo and confirms their email first.' }]),
        { id: 'role', label: 'Access', type: 'select', value: current || 'support', options: [['support', 'Support: read only'], ['superadmin', 'Superadmin: can change anything'], ...(current ? [['none', 'Remove admin access']] : [])] }],
      confirm: 'Save',
      run: (v) => rpc('cleo_admin_set_admin', { p_email: email || v.email, p_role: v.role, p_reason: v.reason }),
      done: (r) => { toast(r.role === 'none' ? 'Admin access removed' : 'Admin access saved', r.email); done(); } });
  }

  /** the plan section of a business sheet */
  function planSection(businessId, changed) {
    const host = h('section', null, h('h3', { text: 'Plan and payments' }));
    const body = h('div', null);
    host.append(body);
    const load = () => fill(body, () => rpc('cleo_admin_business_billing', { p_business_id: businessId }), (b) => {
      const s = b.subscription;
      const write = !!state.admin?.canWrite;
      const summary = s ? `${PLAN_NAMES[s.plan] || s.plan} · ${plural(s.terminals, 'terminal', 'terminals')}${s.branches > 1 ? ` in ${s.branches} branches` : ''}` : 'No plan';
      const period = !s ? 'The business can’t open Cleo until it has a plan.' : s.periodEnd ? `${s.active ? 'Runs until' : 'Ended'} ${when(s.periodEnd)} · ${s.cycle === 'annual' ? 'yearly' : 'monthly'} · ${METHOD_NAMES[s.method] ?? s.method}` : 'Free: no end date';
      body.replaceChildren(
        h('div', { class: 'tiles' }, tile('Plan', summary, period, !s || !s.active), tile('Price per period', s ? peso(s.total) : '—', s?.method === '' ? 'Set by an admin, no payment' : '')),
        write ? actionsBar(
          smallButton(s ? 'Change plan' : 'Give a plan', 'seal-check', () => {
            const today = new Date(), next = new Date(today.getTime() + 30 * 86400000);
            formDialog({ title: s ? 'Change the plan' : 'Give a plan',
              lede: 'No payment is taken. Use this for a trial, a correction, a plan agreed with sales, or after a refund in PayMongo.',
              fields: [
                { id: 'plan', label: 'Plan', type: 'select', value: s?.plan || 'pro', options: [['free', 'Free'], ['basic', 'Basic'], ['pro', 'Pro'], ['max', 'Max'], ...(s ? [['none', 'End the plan now']] : [])] },
                { id: 'terminals', label: 'Terminals', type: 'number', min: 1, max: 9999, value: s?.terminals || 1, showIf: (v) => v.plan && v.plan !== 'none' && v.plan !== 'free' },
                { id: 'branches', label: 'Branches', type: 'number', min: 1, max: 9999, value: s?.branches || 1, showIf: (v) => v.plan === 'max', help: 'Only Max covers more than one branch.' },
                { id: 'cycle', label: 'Billing cycle', type: 'select', value: s?.cycle || 'monthly', options: [['monthly', 'Monthly'], ['annual', 'Annual']], showIf: (v) => v.plan && v.plan !== 'none' && v.plan !== 'free' },
                { id: 'until', label: 'Last day of the plan', type: 'date', min: isoDay(today), value: s?.periodEnd && s.active ? isoDay(new Date(new Date(s.periodEnd).getTime() - 1000)) : isoDay(next), showIf: (v) => v.plan && v.plan !== 'none' && v.plan !== 'free' }],
              danger: false, confirm: 'Save plan',
              run: (v) => {
                const paid = !['free', 'none'].includes(v.plan);
                return rpc('cleo_admin_set_plan', { p_business_id: businessId, p_plan: v.plan, p_terminals: v.plan === 'none' ? null : paid ? Number(v.terminals) : 1,
                  p_branches: v.plan === 'none' ? null : v.plan === 'max' ? Number(v.branches) : 1, p_cycle: paid ? v.cycle : v.plan === 'none' ? null : 'monthly',
                  p_until: paid ? v.until : null, p_reason: v.reason });
              },
              done: () => { toast('Plan saved'); load(); changed(); } });
          })) : null,
        b.payments.length ? h('div', { class: 'card' }, h('div', { class: 'table-wrap' }, h('table', { class: 'stack' },
          h('thead', null, h('tr', null, ['When', 'Plan', 'Amount', 'Paid with', 'Status'].map((t) => h('th', { scope: 'col', text: t })))),
          h('tbody', null, b.payments.map((p) => h('tr', null,
            cell('When', h('span', { class: 'num', text: when(p.createdAt, DATETIME) }), h('span', { class: 'sub', text: p.reference })),
            cell('Plan', h('span', { text: `${PLAN_NAMES[p.plan] || p.plan} · ${p.cycle === 'annual' ? 'year' : 'month'}` }), h('span', { class: 'sub', text: plural(p.terminals, 'terminal', 'terminals') })),
            cell('Amount', h('span', { class: 'num', text: peso(p.amount) }), p.live === false ? h('span', { class: 'sub', text: 'Test payment' }) : null),
            cell('Paid with', h('span', { text: METHOD_NAMES[p.method] ?? p.method })),
            cell('Status', h('span', { class: `badge ${STATUS_TONE[p.status] ?? ''}`, text: p.status[0].toUpperCase() + p.status.slice(1) }))))))))
          : h('p', { class: 'muted', text: 'No payments yet.' }));
    });
    load();
    return host;
  }

  /* ---------- Payments ---------- */
  function paymentsView(host) {
    const query = { status: 'all', offset: 0 };
    const top = h('div', null), list = h('div', { class: 'card flush' });
    const filter = h('select', { class: 'select', 'aria-label': 'Show' }, [['all', 'All payments'], ['paid', 'Paid'], ['pending', 'Waiting'], ['failed', 'Failed'], ['expired', 'Abandoned']].map(([value, label]) => h('option', { value, text: label })));
    filter.addEventListener('change', () => { query.status = filter.value; query.offset = 0; load(); });
    const load = () => fill(list, () => rpc('cleo_admin_payments', { p_status: query.status, p_limit: PAGE, p_offset: query.offset }), (r) => {
      const s = r.summary || {}, plans = s.activePlans || {};
      top.replaceChildren(h('section', { class: 'tiles', 'aria-label': 'Money' },
        tile('Paid this month', peso(s.paidThisMonth), 'Live payments, Manila time'),
        tile('Paid in all', peso(s.paidTotal), s.testPaid ? `${plural(s.testPaid, 'test payment', 'test payments')} not counted` : 'Live payments'),
        tile('Plans running', n(Object.values(plans).reduce((a, b) => a + Number(b), 0)), Object.entries(plans).map(([p, c]) => `${PLAN_NAMES[p] || p} ${c}`).join(' · ') || 'None'),
        tile('Ending within 7 days', n(s.endingSoon), 'Owners pay again to continue', Number(s.endingSoon) > 0)));
      if (!r.rows.length) { list.replaceChildren(empty('receipt', 'No payments', query.status === 'all' ? 'Payments appear here once owners start paying for plans.' : 'None with that status.')); return; }
      list.replaceChildren(h('div', { class: 'table-wrap' }, h('table', { class: 'stack' },
        h('thead', null, h('tr', null, ['When', 'Business', 'Plan', 'Amount', 'Paid with', 'Status'].map((t) => h('th', { scope: 'col', text: t })), h('th', { scope: 'col' }, h('span', { class: 'sr-only', text: 'Actions' })))),
        h('tbody', null, r.rows.map((p) => h('tr', null,
          cell('When', h('span', { class: 'num', text: when(p.createdAt, DATETIME) }), h('span', { class: 'sub', text: p.reference })),
          cell('Business', h('span', { class: 'strong clip', text: p.business }), h('span', { class: 'sub clip', text: p.by })),
          cell('Plan', h('span', { text: `${PLAN_NAMES[p.plan] || p.plan} · ${p.cycle === 'annual' ? 'year' : 'month'}` }), h('span', { class: 'sub', text: plural(p.terminals, 'terminal', 'terminals') })),
          cell('Amount', h('span', { class: 'num strong', text: peso(p.amount) }), p.live === false ? h('span', { class: 'sub', text: 'Test payment' }) : null),
          cell('Paid with', h('span', { text: METHOD_NAMES[p.method] ?? p.method })),
          cell('Status', h('span', { class: `badge ${STATUS_TONE[p.status] ?? ''}`, text: p.status[0].toUpperCase() + p.status.slice(1) }), p.paidAt ? h('span', { class: 'sub', text: `Runs to ${when(p.periodEnd)}` }) : null),
          h('td', { class: 'actions' }, smallButton('Business', null, () => businessSheet(p.businessId, load))))))),
        pager(r, (offset) => { query.offset = offset; load(); })));
    });
    host.replaceChildren(head('Payments', 'Plan payments through PayMongo, newest first.'), top, h('div', { class: 'filters' }, filter), list);
    load();
  }

  /* ---------- Admins ---------- */
  function adminsView(host) {
    const list = h('div', { class: 'card flush' });
    const load = () => fill(list, () => rpc('cleo_admin_admins'), (rows) => {
      list.replaceChildren(h('div', { class: 'table-wrap' }, h('table', { class: 'stack' },
        h('thead', null, h('tr', null, ['Admin', 'Access', 'Two-step', 'Last sign-in'].map((t) => h('th', { scope: 'col', text: t })), h('th', { scope: 'col' }, h('span', { class: 'sr-only', text: 'Actions' })))),
        h('tbody', null, rows.map((a) => h('tr', null,
          cell('Admin', h('span', { class: 'strong clip', text: a.name || a.email }), h('span', { class: 'sub clip', text: a.email })),
          cell('Access', a.revoked ? h('span', { class: 'badge', text: `Removed ${when(a.revokedAt)}` }) : h('span', { class: `badge ${a.role === 'superadmin' ? 'info' : ''}`, text: a.role === 'superadmin' ? 'Superadmin' : 'Support, read only' }), a.you ? h('span', { class: 'badge', text: 'You' }) : null),
          cell('Two-step', onOff(a.twoStep, 'On', 'Not set up')),
          cell('Last sign-in', h('span', { class: 'num', text: ago(a.lastSignInAt) })),
          h('td', { class: 'actions' }, a.you ? null : smallButton(a.revoked ? 'Restore' : 'Change', null, () => adminDialog(a.email, a.revoked ? null : a.role, load)))))))));
    });
    host.replaceChildren(head('Admins', 'Who can open this console. Only superadmins see this page.', h('button', { class: 'btn btn-primary btn-sm', type: 'button', onclick: () => adminDialog('', null, load) }, icon('plus'), 'Add an admin')), list,
      h('p', { class: 'help', text: 'Nobody can change their own access, and Cleo always keeps at least one superadmin with two-step verification.' }));
    load();
  }

  /* ---------- an unattended console signs out ---------- */
  const IDLE_LIMIT = 15 * 60000, IDLE_WARN = 60000;
  let lastActive = Date.now(), idleBox = null;
  ['pointerdown', 'keydown', 'wheel', 'touchstart'].forEach((type) => addEventListener(type, () => { if (!idleBox) lastActive = Date.now(); }, { passive: true, capture: true }));
  setInterval(() => {
    if (state.stage !== 'console') { lastActive = Date.now(); return; }
    const idle = Date.now() - lastActive, left = Math.ceil((IDLE_LIMIT + IDLE_WARN - idle) / 1000);
    if (left <= 0) { idleBox = null; leave('You were signed out after 15 minutes without activity.'); return; }
    if (idle < IDLE_LIMIT) return;
    if (!idleBox) {
      const count = h('b', { class: 'num' });
      idleBox = dialog({ title: 'Still there?', closable: false, body: [h('p', null, 'For security, the admin console signs out after 15 minutes without activity. Signing out in ', count, '.')],
        foot: [h('button', { class: 'btn', type: 'button', text: 'Sign out now', onclick: () => { idleBox = null; leave(); } }),
          h('button', { class: 'btn btn-primary', type: 'button', text: 'Stay signed in', onclick: () => { lastActive = Date.now(); const box = idleBox; idleBox = null; box.close(); } })] });
      idleBox.count = count;
    }
    idleBox.count.textContent = `${left} second${left === 1 ? '' : 's'}`;
  }, 1000);

  /* ---------- start ---------- */
  async function start() {
    if (!publicSettings() || typeof window.supabase?.createClient !== 'function') { unconfiguredScreen(); return; }
    mount(loadingPage('Checking your session'));
    try {
      const session = (await ask(client().auth.getSession()))?.session;
      if (!session) { signInScreen(); return; }
      // a stored session is only a hint; the server says who this is
      const user = (await ask(client().auth.getUser()))?.user;
      if (!user?.id) { await forget(); signInScreen(); return; }
      state.userId = user.id;
      await enter();
    } catch (failure) {
      const refusal = explain(failure);
      if (reroute(refusal)) return;
      await forget();
      signInScreen(refusal.message, 'bad');
    }
  }
  start();
})();
