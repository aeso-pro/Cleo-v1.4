// Cleo billing: the logic behind the `billing` and `billing-webhook` Edge Functions.
//
// Plain JavaScript with no imports, so the same file runs in Supabase (Deno) and in the local
// test server (Node). Everything it needs from outside is handed in:
//   rpc(name, args, as)   call a database function AS the signed-in owner ('user') or with the
//                         service role ('service'); rejects with a Refusal
//   env                   PAYMONGO_SECRET_KEY, PAYMONGO_WEBHOOK_SECRET, CLEO_APP_URL
//                         (and, for tests only, PAYMONGO_API_URL and PAYMONGO_CHECKOUT_ORIGIN)
//
// Rules it keeps
//   - The amount always comes from the database (cleo_billing_start). Nothing a browser sends
//     about price is read.
//   - A payment counts only after PayMongo itself, asked directly with the secret key, says it
//     was paid. A webhook is a prompt to go and ask, never the proof.
//   - The owner is only ever sent to PayMongo's own checkout page, and only ever sent back to
//     Cleo's own address (CLEO_APP_URL). Neither address comes from the request.
//   - No key, card detail or provider response is put in an error message or a log line.

export class Refusal extends Error {
  constructor(code, message, status = 400) { super(message); this.name = 'Refusal'; this.code = code; this.status = status; }
}

// Cleo's four ways to pay, as PayMongo names them. GoTyme Bank customers pay by scanning QR Ph.
export const METHODS = { card: ['card'], gcash: ['gcash'], maya: ['paymaya'], gotyme: ['qrph'] };
const PLAN_NAMES = { basic: 'Basic', pro: 'Pro', max: 'Max' };

function settings(env) {
  const secret = String(env.PAYMONGO_SECRET_KEY || '');
  if (!/^sk_(test|live)_/.test(secret)) throw new Refusal('not_configured', 'Payments aren’t switched on yet. Nothing was charged.', 503);
  let app;
  try { app = new URL(String(env.CLEO_APP_URL || '')); } catch { app = null; }
  const local = app && app.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(app.hostname);
  if (!app || (app.protocol !== 'https:' && !local) || app.username || app.search || app.hash) {
    throw new Refusal('not_configured', 'Payments aren’t switched on yet. Nothing was charged.', 503);
  }
  return {
    secret,
    live: secret.startsWith('sk_live_'),
    api: String(env.PAYMONGO_API_URL || 'https://api.paymongo.com').replace(/\/$/, ''),
    checkoutOrigin: String(env.PAYMONGO_CHECKOUT_ORIGIN || 'https://checkout.paymongo.com'),
    // the folder Cleo is served from, without a trailing slash
    app: `${app.origin}${app.pathname.replace(/\/(index\.html)?$/, '')}`,
  };
}
const basic = (secret) => `Basic ${btoa(`${secret}:`)}`;

async function provider(cfg, fetchImpl, path, init = {}) {
  let response, body = null;
  try {
    response = await fetchImpl(`${cfg.api}${path}`, { ...init, headers: { Authorization: basic(cfg.secret), Accept: 'application/json', ...(init.body ? { 'Content-Type': 'application/json' } : {}) } });
    body = await response.json();
  } catch { throw new Refusal('unavailable', 'The payment provider didn’t answer. Nothing was charged. Try again in a moment.', 502); }
  if (!response.ok || !body?.data?.id) throw new Refusal('unavailable', 'The payment provider refused the request. Nothing was charged.', 502);
  return body.data;
}

/** Start a plan: Free starts at once; a paid plan gets a checkout page at the provider. */
export async function startCheckout({ input, rpc, env, fetchImpl = fetch }) {
  const plan = String(input?.plan || ''), cycle = String(input?.cycle || 'monthly'), method = String(input?.method || '');
  const terminals = Number(input?.terminals), branches = Number(input?.branches);
  if (!Number.isSafeInteger(terminals) || !Number.isSafeInteger(branches)) throw new Refusal('validation', 'Choose how many terminals and branches the plan covers.');
  // the database decides whether this person may do this, and what it costs
  const started = await rpc('cleo_billing_start', { p_plan: plan, p_terminals: terminals, p_branches: branches, p_cycle: cycle, p_method: method || null }, 'user');
  if (started?.free) return { ok: true, free: true, subscription: started.subscription };
  if (!started?.reference || !Number.isSafeInteger(started.amountCentavos) || started.amountCentavos <= 0 || !METHODS[started.method]) {
    throw new Refusal('unavailable', 'The payment couldn’t be prepared. Nothing was charged.', 500);
  }
  let cfg;
  try { cfg = settings(env); }
  catch (failure) { await rpc('cleo_billing_close', { p_reference: started.reference, p_status: 'failed' }, 'service').catch(() => {}); throw failure; }
  const name = `Cleo ${PLAN_NAMES[started.plan] || started.plan} · ${started.terminals} terminal${started.terminals === 1 ? '' : 's'}${started.branches > 1 ? ` in ${started.branches} branches` : ''} · ${started.cycle === 'annual' ? '1 year' : '1 month'}`;
  let session;
  try {
    session = await provider(cfg, fetchImpl, '/v1/checkout_sessions', { method: 'POST', body: JSON.stringify({ data: { attributes: {
      line_items: [{ amount: started.amountCentavos, currency: 'PHP', name, quantity: 1 }],
      payment_method_types: METHODS[started.method],
      success_url: `${cfg.app}/index.html?billing=paid&ref=${started.reference}#/`,
      cancel_url: `${cfg.app}/index.html?billing=cancelled&ref=${started.reference}#/plans/${started.plan}`,
      reference_number: started.reference,
      description: `${name} for ${String(started.business || 'your business').slice(0, 120)}`,
      send_email_receipt: true,
      ...(started.email ? { billing: { email: started.email } } : {}),
      metadata: { reference: started.reference, plan: String(started.plan), cycle: String(started.cycle) },
    } } }) });
  } catch (failure) { await rpc('cleo_billing_close', { p_reference: started.reference, p_status: 'failed' }, 'service').catch(() => {}); throw failure; }
  const checkoutUrl = String(session.attributes?.checkout_url || '');
  let sameProvider = false;
  try { sameProvider = new URL(checkoutUrl).origin === cfg.checkoutOrigin; } catch { /* not a URL */ }
  if (!sameProvider || session.attributes?.reference_number !== started.reference) {
    await rpc('cleo_billing_close', { p_reference: started.reference, p_status: 'failed' }, 'service').catch(() => {});
    throw new Refusal('unavailable', 'The payment page couldn’t be opened. Nothing was charged.', 502);
  }
  await rpc('cleo_billing_attach', { p_reference: started.reference, p_session: String(session.id), p_livemode: session.attributes.livemode === true }, 'service');
  return { ok: true, free: false, reference: started.reference, checkoutUrl };
}

/** Ask the provider what really happened to one checkout page, and settle it if it was paid. */
export async function settle({ sessionId, rpc, env, fetchImpl = fetch }) {
  if (!/^[A-Za-z0-9_]{4,120}$/.test(String(sessionId || ''))) throw new Refusal('validation', 'That checkout page isn’t valid.');
  const cfg = settings(env);
  const session = await provider(cfg, fetchImpl, `/v1/checkout_sessions/${sessionId}`);
  const attrs = session.attributes || {};
  const paid = (Array.isArray(attrs.payments) ? attrs.payments : []).find((p) => p?.attributes?.status === 'paid');
  if (!paid) return { ok: true, status: 'pending' };
  const done = await rpc('cleo_billing_confirm', { p_reference: String(attrs.reference_number || ''), p_session: String(session.id),
    p_payment: String(paid.id || ''), p_amount_centavos: Number(paid.attributes.amount), p_livemode: attrs.livemode === true }, 'service');
  return { ok: true, status: 'paid', subscription: done?.subscription || null };
}

/** The owner is back from the provider's page: where does their payment stand? */
export async function verifyReturn({ input, rpc, env, fetchImpl = fetch }) {
  const reference = String(input?.reference || '');
  if (!/^CLEO-[0-9A-F]{16}$/.test(reference)) throw new Refusal('validation', 'That payment reference isn’t valid.');
  // owner or HQ of the business the payment belongs to, or the database refuses
  let standing = await rpc('cleo_billing_status', { p_reference: reference }, 'user');
  if (standing?.status === 'pending' && standing.session) {
    await settle({ sessionId: standing.session, rpc, env, fetchImpl });
    standing = await rpc('cleo_billing_status', { p_reference: reference }, 'user');
  }
  return { ok: true, reference, status: standing?.status || 'pending', subscription: standing?.subscription || null };
}

const hex = (buffer) => [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
async function hmac(secret, text) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(text)));
}
/** equal without telling an attacker how many leading characters matched */
function same(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length || !a.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
/** PayMongo signs "<t>.<raw body>" with the webhook secret: Paymongo-Signature: t=…,te=<test>,li=<live> */
export async function signedByProvider(rawBody, header, secret) {
  if (!secret || typeof rawBody !== 'string' || typeof header !== 'string' || header.length > 600) return false;
  const parts = Object.fromEntries(header.split(',').map((part) => { const at = part.indexOf('='); return [part.slice(0, at).trim(), part.slice(at + 1).trim()]; }));
  if (parts.t) {
    const expected = await hmac(secret, `${parts.t}.${rawBody}`);
    return same(expected, parts.te || '') || same(expected, parts.li || '');
  }
  // the older form some of PayMongo's pages describe: the signature of the body alone
  return same(await hmac(secret, rawBody), header.trim());
}

/** A message from the provider. Returns the HTTP status to answer with. */
export async function webhook({ rawBody, signature, rpc, env, fetchImpl = fetch }) {
  if (typeof rawBody !== 'string' || rawBody.length > 200000) return { status: 413 };
  if (!(await signedByProvider(rawBody, signature || '', String(env.PAYMONGO_WEBHOOK_SECRET || '')))) return { status: 401 };
  let event;
  try { event = JSON.parse(rawBody); } catch { return { status: 400 }; }
  const type = String(event?.data?.attributes?.type || ''), resource = event?.data?.attributes?.data;
  if (type !== 'checkout_session.payment.paid' || !resource?.id) return { status: 200, handled: false };
  try {
    const result = await settle({ sessionId: String(resource.id), rpc, env, fetchImpl });
    return { status: 200, handled: result.status === 'paid' };
  } catch (failure) {
    // 4xx: this message will never settle (not ours, wrong amount). 5xx: ask the provider to send it again.
    return { status: failure instanceof Refusal && failure.status < 500 ? 200 : 500, handled: false };
  }
}
