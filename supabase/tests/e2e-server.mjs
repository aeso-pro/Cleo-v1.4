// Cleo end-to-end test server: the real pages in front of a stand-in Supabase.
//
//   npm --prefix supabase/tests ci --ignore-scripts      (once)
//   node supabase/tests/e2e-server.mjs                    then open http://localhost:5180/index.html
//
// What is real: index.html, admin.html, the vendored Supabase SDK, and every database rule.
// All five migrations run in a disposable in-memory PostgreSQL (PGlite), and each RPC is
// executed as the signed-in role with that session's claims, exactly as PostgREST would.
// What is imitated: Supabase Auth (password sign-in, the PKCE code exchange, TOTP) and the
// provider itself. "Continue with Facebook" comes straight back with whatever outcome was
// chosen at POST /__test/scenario, including Facebook's "#_=_" on the return address.
// Plan payments run the real Edge Function logic (supabase/functions/_shared/billing-core.js)
// against a stand-in PayMongo at /__paymongo: its checkout page has a "Pay" and a "Cancel"
// link, and paying sends the signed webhook (scenario { webhook: 'lost' } drops it).
//
// It never contacts the hosted project, Facebook or Google, holds no real credentials, and
// answers on this machine only. The accounts and the password below exist only here.
import http from 'node:http';
import { randomUUID, randomBytes, createHmac } from 'node:crypto';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { database, ids, legalVersion } from './helpers.mjs';
import { Refusal, startCheckout, verifyReturn, webhook } from '../functions/_shared/billing-core.js';

const require = createRequire(import.meta.url);
const { ROOT, serveStatic, securityHeaders } = require('../../tools/serve.js');
const PORT = Number(process.env.PORT || 5180);
const ORIGIN = `http://localhost:${PORT}`;
export const TEST_PASSWORD = 'Cleo-test-2026!';   // test accounts only; nothing real uses it
export const TEST_TOTP = '123456';                // the one authenticator code this server accepts

// The pages are served unchanged except for where they look for their backend.
const project = (() => {
  const page = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  return JSON.parse(page.match(/<script[^>]*id="cleo-env"[^>]*>([\s\S]*?)<\/script>/)[1]).supabaseUrl;
})();
const localize = (text) => text.split(project).join(ORIGIN).split(project.replace(/^https:/, 'wss:')).join(ORIGIN.replace(/^http:/, 'ws:'));
const pageHeaders = () => {
  const csp = securityHeaders()['Content-Security-Policy'];
  return csp ? { 'Content-Security-Policy': localize(csp) } : {};
};

/* ---------- database: the real migrations, a few people and businesses ---------- */
const { db, as, onboard } = await database();
const people = new Map();   // email -> { id }
const sql = (text, params = []) => db.query(text, params);
async function addUser(email, name, { provider = 'email', confirmed = true, daysAgo = 0, id = randomUUID() } = {}) {
  await sql(`INSERT INTO auth.users(id,email,email_confirmed_at,raw_user_meta_data,raw_app_meta_data,created_at,last_sign_in_at)
    VALUES($1,$2,$3,$4,$5,now()-make_interval(days=>$6),now()-make_interval(hours=>$6)) ON CONFLICT (id) DO UPDATE SET email=EXCLUDED.email`,
    [id, email, confirmed ? new Date().toISOString() : null, { full_name: name, name }, { provider, providers: [provider] }, daysAgo]);
  people.set(email, { id });
  return id;
}
for (const [key, id] of Object.entries(ids)) if (key !== 'missingEmail') people.set(`${key}@example.test`, { id });
const alpha = await onboard(ids.owner, 'Alpha Foods');
const beta = await onboard(ids.other, 'Beta Retail');
for (const [id, role] of [[ids.manager, 'manager'], [ids.cashier, 'cashier'], [ids.clerk, 'clerk']]) {
  await sql('INSERT INTO public.cleo_memberships(user_id,business_id,branch_id,role) VALUES($1,$2,$3,$4)', [id, alpha.business.id, alpha.branch.id, role]);
  await as(id, 'cleo_accept_legal', [legalVersion, 'email']);
}
await as(ids.owner, 'cleo_apply_records', ['products', [{ id: 'latte', name: 'Latte', price: 160, sku: 'LATTE' }, { id: 'americano', name: 'Americano', price: 130, sku: 'AMER' }], []]);
await as(ids.owner, 'cleo_apply_records', ['ingredients', [{ id: 'beans', name: 'Coffee beans', unit: 'kg', rp: 3 }], []]);
await as(ids.owner, 'cleo_post_stock', [alpha.branch.id, 'beans', 'receive', 12, 480, 'Opening stock', randomUUID()]);
await as(ids.owner, 'cleo_save_setting', ['business.tin', '123-456-789-000', 0]);
// a returning Facebook account with its own business, a few sign-ups spread over the month, and platform staff
const fbOwner = await addUser('fb.returning@example.test', 'Faye Bautista', { provider: 'facebook', daysAgo: 9 });
await as(fbOwner, 'cleo_accept_legal', [legalVersion, 'facebook']);
await as(fbOwner, 'cleo_create_business', [{ name: 'Faye’s Salon' }, ['svc'], { name: 'Faye Bautista' }]);
for (const [i, [email, name, provider]] of [['ana@example.test', 'Ana Reyes', 'email'], ['ben@example.test', 'Ben Cruz', 'google'], ['carla@example.test', 'Carla Santos', 'facebook'],
  ['dino@example.test', 'Dino Ramos', 'email'], ['ella@example.test', 'Ella Lim', 'google'], ['fred@example.test', 'Fred Tan', 'email']].entries()) {
  await addUser(email, name, { provider, daysAgo: [2, 2, 5, 11, 17, 24][i], confirmed: i !== 3 });
}
const root = await addUser('root@example.test', 'Root Admin', { daysAgo: 28 });
const support = await addUser('support@example.test', 'Sam Support', { daysAgo: 20 });
await sql("INSERT INTO public.cleo_platform_admins(user_id,role,note) VALUES($1,'superadmin','test'),($2,'support','test')", [root, support]);
await sql("INSERT INTO auth.mfa_factors(id,user_id,status) VALUES($1,$2,'verified')", [randomUUID(), root]);
await sql("UPDATE auth.users SET created_at=now()-interval '26 days' WHERE id=ANY($1)", [[ids.owner, ids.other]]);
await sql("UPDATE auth.users SET last_sign_in_at=now()-interval '3 hours' WHERE id=$1", [ids.owner]);
await sql("UPDATE public.cleo_businesses SET created_at=now()-interval '25 days' WHERE id=$1", [alpha.business.id]);
await sql("UPDATE public.cleo_businesses SET created_at=now()-interval '13 days' WHERE id=$1", [beta.business.id]);

/* ---------- a stand-in for Supabase Auth ---------- */
const sessions = new Map();   // access token -> { userId, aal, refresh, sessionId }
const refreshes = new Map();  // refresh token -> access token
const flows = new Map();      // one-time auth code -> { userId }
const scenario = { provider: 'ok', email: 'fb.returning@example.test', name: 'Faye Bautista' };
const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
async function userRow(id) {
  const row = (await sql('SELECT id,email,email_confirmed_at,raw_user_meta_data,raw_app_meta_data,created_at,banned_until FROM auth.users WHERE id=$1', [id])).rows[0];
  if (!row) return null;
  const factors = (await sql('SELECT id,status FROM auth.mfa_factors WHERE user_id=$1 ORDER BY status DESC', [id])).rows
    .map((f) => ({ id: f.id, factor_type: 'totp', status: f.status, friendly_name: 'Authenticator', created_at: row.created_at, updated_at: row.created_at }));
  return { id: row.id, aud: 'authenticated', role: 'authenticated', email: row.email || '', email_confirmed_at: row.email_confirmed_at, phone: '',
    app_metadata: row.raw_app_meta_data || {}, user_metadata: row.raw_user_meta_data || {}, identities: [], factors, created_at: row.created_at, updated_at: row.created_at };
}
async function issue(userId, aal = 'aal1', sessionId = randomUUID()) {
  const user = await userRow(userId), now = Math.floor(Date.now() / 1000);
  const access = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ aud: 'authenticated', iss: `${ORIGIN}/auth/v1`, sub: userId, email: user.email, role: 'authenticated', aal,
    amr: [{ method: 'password', timestamp: now }, ...(aal === 'aal2' ? [{ method: 'totp', timestamp: now }] : [])], session_id: sessionId, iat: now, exp: now + 3600 })}.${randomBytes(16).toString('base64url')}`;
  const refresh = randomBytes(12).toString('base64url');
  sessions.set(access, { userId, aal, refresh, sessionId }); refreshes.set(refresh, access);
  await sql('UPDATE auth.users SET last_sign_in_at=now() WHERE id=$1', [userId]);
  return { access_token: access, token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, refresh_token: refresh, user };
}
const bearer = (req) => sessions.get(String(req.headers.authorization || '').replace(/^Bearer\s+/i, '')) || null;

/* ---------- a stand-in for PostgREST: run one RPC as the caller ---------- */
let queue = Promise.resolve();
const exclusive = (work) => { const run = queue.then(work, work); queue = run.catch(() => {}); return run; };
async function callRpc(name, args, session, headers) {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(name)) return [404, { code: 'PGRST202', message: `Could not find the function public.${name} in the schema cache`, details: null, hint: null }];
  const known = (await sql("SELECT p.pronargs FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname=$1", [name])).rows;
  const keys = Object.keys(args || {});
  if (!known.length || keys.some((k) => !/^[a-z_][a-z0-9_]{0,62}$/.test(k))) return [404, { code: 'PGRST202', message: `Could not find the function public.${name} in the schema cache`, details: null, hint: null }];
  const values = keys.map((k) => (args[k] !== null && typeof args[k] === 'object' ? JSON.stringify(args[k]) : args[k]));
  const list = keys.map((k, i) => `${k} => $${i + 1}${args[k] !== null && typeof args[k] === 'object' ? '::jsonb' : ''}`).join(', ');
  const role = session?.service ? 'service_role' : session ? 'authenticated' : 'anon';
  const claims = session && !session.service ? { sub: session.userId, role, aal: session.aal, session_id: session.sessionId } : { role };
  return exclusive(async () => {
    await db.exec(`BEGIN; SET LOCAL ROLE ${role};`);
    try {
      await sql("SELECT set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claims',$2,true),set_config('request.headers',$3,true)",
        [session?.userId || '', JSON.stringify(claims), JSON.stringify({ 'user-agent': String(headers['user-agent'] || ''), 'x-forwarded-for': '127.0.0.1' })]);
      const result = (await sql(`SELECT public.${name}(${list}) AS result`, values)).rows[0].result;
      await db.exec('COMMIT');
      return [200, result];
    } catch (error) {
      await db.exec('ROLLBACK');
      const code = String(error.code || 'XX000');
      // the statuses PostgREST gives these SQLSTATEs
      const status = code === '42501' ? (session && !session.service ? 403 : 401) : /^(23503|23505)$/.test(code) ? 409 : /^(42883|42P01)$/.test(code) ? 404 : /^(P0001|22023|22P02)$/.test(code) ? 400 : /^(P0|40|XX)/.test(code) ? 500 : 400;
      return [status, { code, message: String(error.message || ''), details: error.detail || null, hint: error.hint || null }];
    }
  });
}

/* ---------- plan payments: the real function logic, a stand-in provider ---------- */
const billingEnv = { PAYMONGO_SECRET_KEY: 'sk_test_local_stand_in', PAYMONGO_WEBHOOK_SECRET: 'whsk_local_stand_in', CLEO_APP_URL: ORIGIN,
  PAYMONGO_API_URL: `${ORIGIN}/__paymongo`, PAYMONGO_CHECKOUT_ORIGIN: ORIGIN };
const checkouts = new Map();   // checkout session id -> attributes
/** what supabase/functions/_shared/edge.js does on Supabase: call the database as the owner or the service role */
const billingRpc = (session) => async (name, args, as) => {
  const [status, body] = await callRpc(name, args, as === 'service' ? { service: true } : session, {});
  if (status === 200) return body;
  const code = String(body?.code || '');
  throw new Refusal(code === '42501' ? 'forbidden' : code === 'P0002' ? 'not_found' : 'validation', String(body?.message || 'That couldn’t be done.'), status >= 500 && !/^(P0|40)/.test(code) ? 502 : 400);
};
const peso = (centavos) => `PHP ${(centavos / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`;
const escapeHtml = (text) => String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const readText = (req) => new Promise((resolve) => { let text = ''; req.on('data', (c) => { text += c; if (text.length > 2e6) req.destroy(); }); req.on('end', () => resolve(text)); });

/* ---------- HTTP ---------- */
const json = (res, status, body) => { const text = body === undefined ? '' : JSON.stringify(body); res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(text) }); res.end(text); };
const authError = (res, status, code, message) => json(res, status, { code: status, error_code: code, msg: message });
const readBody = (req) => new Promise((resolve) => { let text = ''; req.on('data', (c) => { text += c; if (text.length > 2e6) req.destroy(); }); req.on('end', () => { try { resolve(text ? JSON.parse(text) : {}); } catch { resolve({}); } }); });

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, ORIGIN), route = url.pathname;
  try {
    /* test controls */
    if (route === '/__test/scenario' && req.method === 'POST') { Object.assign(scenario, await readBody(req)); return json(res, 200, scenario); }
    if (route === '/__test/state') {
      return json(res, 200, { scenario, sessions: sessions.size,
        legal: (await sql('SELECT u.email,a.method FROM public.cleo_legal_acceptances a JOIN auth.users u ON u.id=a.user_id ORDER BY a.accepted_at')).rows,
        businesses: (await sql('SELECT name FROM public.cleo_businesses ORDER BY created_at')).rows.map((r) => r.name),
        suspended: (await sql('SELECT u.email FROM public.cleo_account_suspensions s JOIN auth.users u ON u.id=s.user_id WHERE s.lifted_at IS NULL')).rows.map((r) => r.email),
        payments: (await sql('SELECT b.name AS business,p.plan,p.method,p.status,p.amount_centavos::int AS centavos FROM public.cleo_payments p JOIN public.cleo_businesses b ON b.id=p.business_id ORDER BY p.created_at')).rows,
        subscriptions: (await sql('SELECT b.name AS business,s.plan,s.terminals,s.cycle,s.method FROM public.cleo_subscriptions s JOIN public.cleo_businesses b ON b.id=s.business_id ORDER BY s.since')).rows });
    }

    /* Auth */
    if (route === '/auth/v1/token' && req.method === 'POST') {
      const body = await readBody(req), grant = url.searchParams.get('grant_type');
      if (grant === 'password') {
        const person = people.get(String(body.email || '').toLowerCase());
        if (!person || body.password !== TEST_PASSWORD) return authError(res, 400, 'invalid_credentials', 'Invalid login credentials');
        const user = await userRow(person.id);
        if (!user.email_confirmed_at) return authError(res, 400, 'email_not_confirmed', 'Email not confirmed');
        return json(res, 200, await issue(person.id));
      }
      if (grant === 'pkce') {
        const flow = flows.get(body.auth_code); flows.delete(body.auth_code);
        if (!flow || !body.code_verifier) return authError(res, 404, 'flow_state_not_found', 'invalid flow state, no valid flow state found');
        return json(res, 200, await issue(flow.userId));
      }
      if (grant === 'refresh_token') {
        const old = sessions.get(refreshes.get(body.refresh_token));
        if (!old) return authError(res, 400, 'refresh_token_not_found', 'Invalid Refresh Token: Refresh Token Not Found');
        return json(res, 200, await issue(old.userId, old.aal, old.sessionId));
      }
      return authError(res, 400, 'validation_failed', 'unsupported grant type');
    }
    if (route === '/auth/v1/authorize') {
      // The provider's whole sign-in, collapsed into one redirect. Facebook's "#_=_" rides along,
      // as it does when a browser carries the fragment through Supabase's redirect.
      const back = new URL(url.searchParams.get('redirect_to') || `${ORIGIN}/index.html`);
      if (back.origin !== ORIGIN) return authError(res, 400, 'validation_failed', 'redirect_to is not allowed');
      const provider = url.searchParams.get('provider') || 'facebook';
      // what the app asked the provider for, kept so a test can read it back (never the PKCE challenge)
      scenario.lastAuthorize = Object.fromEntries([...url.searchParams].filter(([k]) => !k.startsWith('code_challenge')));
      const refuse = (error, code, description) => {
        const q = new URLSearchParams({ error, error_code: code, error_description: description });
        for (const [k, v] of q) back.searchParams.set(k, v);
        back.hash = q.toString();
        res.writeHead(303, { Location: back.href }); res.end();
      };
      if (scenario.provider === 'no_email') return refuse('server_error', 'unexpected_failure', 'Error getting user email from external provider');
      if (scenario.provider === 'cancel') return refuse('access_denied', 'access_denied', 'Permissions error');
      if (scenario.provider === 'broken') return refuse('server_error', 'unexpected_failure', 'Unable to exchange external code: invalid_client');
      let person = people.get(scenario.email);
      if (!person) { await addUser(scenario.email, scenario.name || 'New Person', { provider }); person = people.get(scenario.email); }
      const code = randomUUID(); flows.set(code, { userId: person.id });
      back.searchParams.set('code', code);
      res.writeHead(302, { Location: `${back.href.replace(/#.*$/, '')}${provider === 'facebook' ? '#_=_' : ''}` });
      return res.end();
    }
    if (route === '/auth/v1/user' && req.method === 'GET') {
      const session = bearer(req);
      if (!session) return authError(res, 401, 'bad_jwt', 'invalid JWT');
      return json(res, 200, await userRow(session.userId));
    }
    if (route === '/auth/v1/logout') {
      const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, ''), session = sessions.get(token);
      if (session) { refreshes.delete(session.refresh); sessions.delete(token); }
      res.writeHead(204); return res.end();
    }
    const factor = route.match(/^\/auth\/v1\/factors(?:\/([0-9a-f-]{36})(?:\/(challenge|verify))?)?$/);
    if (factor) {
      const session = bearer(req);
      if (!session) return authError(res, 401, 'bad_jwt', 'invalid JWT');
      const [, id, step] = factor;
      if (!id && req.method === 'POST') {
        const created = randomUUID(), secret = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
        await sql("INSERT INTO auth.mfa_factors(id,user_id,status) VALUES($1,$2,'unverified')", [created, session.userId]);
        // a drawing in place of a real QR code: this server accepts one fixed code, so nothing is scanned
        const qr = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 29 29" shape-rendering="crispEdges"><rect width="29" height="29" fill="#fff"/><path fill="#000" d="M2 2h7v7H2zm2 2v3h3V4zM20 2h7v7h-7zm2 2v3h3V4zM2 20h7v7H2zm2 2v3h3v-3zM11 2h2v2h-2zm4 2h2v3h-2zm-4 5h3v2h-3zm5 1h2v4h-2zm-5 4h2v3h-2zm8 0h3v2h-3zm-4 4h3v2h-3zm5 2h2v3h-2zm-8 2h2v3h-2zm5 1h2v2h-2zm6 1h2v2h-2zM2 12h3v2H2zm5 2h2v3H7zm17-3h3v2h-3z"/></svg>`;
        return json(res, 200, { id: created, type: 'totp', friendly_name: 'Cleo Admin', totp: { qr_code: qr, secret, uri: `otpauth://totp/Cleo%20Admin?secret=${secret}` } });
      }
      if (id && !step && req.method === 'DELETE') { await sql('DELETE FROM auth.mfa_factors WHERE id=$1 AND user_id=$2', [id, session.userId]); return json(res, 200, { id }); }
      if (step === 'challenge') return json(res, 200, { id: randomUUID(), type: 'totp', expires_at: Math.floor(Date.now() / 1000) + 300 });
      if (step === 'verify') {
        const body = await readBody(req);
        if (body.code !== TEST_TOTP) return authError(res, 422, 'mfa_verification_failed', 'Invalid TOTP code entered');
        await sql("UPDATE auth.mfa_factors SET status='verified' WHERE id=$1 AND user_id=$2", [id, session.userId]);
        return json(res, 200, await issue(session.userId, 'aal2', session.sessionId));
      }
    }

    /* Edge Functions */
    if (route === '/functions/v1/billing' && req.method === 'POST') {
      const session = bearer(req);
      if (!session) return json(res, 401, { code: 401, message: 'Invalid JWT' });
      try {
        const input = await readBody(req), rpc = billingRpc(session);
        if (input.action === 'checkout') return json(res, 200, await startCheckout({ input, rpc, env: billingEnv }));
        if (input.action === 'verify') return json(res, 200, await verifyReturn({ input, rpc, env: billingEnv }));
        throw new Refusal('validation', 'Unknown billing action.');
      } catch (failure) {
        if (failure instanceof Refusal) return json(res, 200, { ok: false, code: failure.code, message: failure.message });
        throw failure;
      }
    }
    if (route === '/functions/v1/billing-webhook' && req.method === 'POST') {
      const result = await webhook({ rawBody: await readText(req), signature: String(req.headers['paymongo-signature'] || ''), rpc: billingRpc(null), env: billingEnv });
      res.writeHead(result.status); return res.end();
    }

    /* a stand-in PayMongo */
    const paymongo = route.match(/^\/__paymongo\/(v1\/checkout_sessions|checkout)(?:\/(cs_test_[0-9a-f]+))?(\/pay)?$/);
    if (paymongo) {
      const [, kind, id, payNow] = paymongo;
      if (kind === 'v1/checkout_sessions') {
        if (req.headers.authorization !== `Basic ${Buffer.from(`${billingEnv.PAYMONGO_SECRET_KEY}:`).toString('base64')}`) return json(res, 401, { errors: [{ code: 'authentication_invalid' }] });
        if (req.method === 'POST' && !id) {
          const attributes = (await readBody(req))?.data?.attributes || {}, created = `cs_test_${randomBytes(12).toString('hex')}`;
          checkouts.set(created, { ...attributes, checkout_url: `${ORIGIN}/__paymongo/checkout/${created}`, livemode: false, status: 'active', payments: [] });
          return json(res, 200, { data: { id: created, type: 'checkout_session', attributes: checkouts.get(created) } });
        }
        if (req.method === 'GET' && checkouts.has(id)) return json(res, 200, { data: { id, type: 'checkout_session', attributes: checkouts.get(id) } });
        return json(res, 404, { errors: [{ code: 'resource_not_found' }] });
      }
      const checkout = checkouts.get(id);
      if (!checkout) { res.writeHead(404); return res.end('No such checkout'); }
      const amount = checkout.line_items.reduce((sum, item) => sum + item.amount * item.quantity, 0);
      if (!payNow) {
        const page = `<!doctype html><meta charset="utf-8"><title>Stand-in checkout</title><body style="font:16px/1.5 system-ui;max-width:32rem;margin:12vh auto;padding:0 1.5rem">
          <p style="color:#666">Stand-in for PayMongo's checkout page. Test server only: no money moves.</p>
          <h1 style="margin:0">${escapeHtml(peso(amount))}</h1>
          <p>${escapeHtml(checkout.line_items[0].name)}<br>Pay with: <b data-methods>${escapeHtml(checkout.payment_method_types.join(', '))}</b><br>Reference: <span data-reference>${escapeHtml(checkout.reference_number)}</span></p>
          <p><a data-pay href="/__paymongo/checkout/${id}/pay">Pay ${escapeHtml(peso(amount))}</a> &nbsp; <a data-cancel href="${escapeHtml(checkout.cancel_url)}">Cancel</a></p>`;
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); return res.end(page);
      }
      if (!checkout.payments.length) checkout.payments.push({ id: `pay_test_${randomBytes(8).toString('hex')}`, type: 'payment', attributes: { status: 'paid', amount, currency: 'PHP', paid_at: Math.floor(Date.now() / 1000) } });
      if (scenario.webhook !== 'lost') {
        // the provider's signed message, delivered to the webhook function
        const rawBody = JSON.stringify({ data: { id: `evt_${randomBytes(8).toString('hex')}`, type: 'event', attributes: { type: 'checkout_session.payment.paid', livemode: false, data: { id, type: 'checkout_session', attributes: checkout } } } });
        const t = Math.floor(Date.now() / 1000), te = createHmac('sha256', billingEnv.PAYMONGO_WEBHOOK_SECRET).update(`${t}.${rawBody}`).digest('hex');
        await webhook({ rawBody, signature: `t=${t},te=${te},li=`, rpc: billingRpc(null), env: billingEnv });
      }
      res.writeHead(302, { Location: checkout.success_url }); return res.end();
    }

    /* PostgREST */
    const call = route.match(/^\/rest\/v1\/rpc\/([^/]+)$/);
    if (call && req.method === 'POST') {
      const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
      const session = sessions.get(token) || null;
      const [status, body] = await callRpc(call[1], await readBody(req), session, req.headers);
      return json(res, status, body);
    }
    if (route.startsWith('/rest/v1/') || route.startsWith('/auth/v1/')) return json(res, 404, { code: 'PGRST205', message: 'Not part of the test server', details: null, hint: null });

    /* the site itself */
    return serveStatic(req, res, { rewrite: (html) => localize(html), headers: pageHeaders() });
  } catch (error) {
    console.error(`${req.method} ${route}:`, error?.message || error);
    if (!res.headersSent) json(res, 500, { code: 'XX000', message: 'test server error', details: null, hint: null });
  }
});
server.listen(PORT, '127.0.0.1', () => {
  console.log(`Cleo test server: ${ORIGIN}/index.html · ${ORIGIN}/admin.html`);
  console.log(`Accounts (password ${TEST_PASSWORD}): owner@example.test · fb.returning@example.test · root@example.test (admin, code ${TEST_TOTP}) · support@example.test (admin, no authenticator yet)`);
});
