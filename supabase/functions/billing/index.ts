// Cleo `billing` Edge Function: the signed-in owner starts a plan, or comes back from paying.
//   POST { action: 'checkout', plan, terminals, branches, cycle, method }  ->  { ok, free, checkoutUrl | subscription }
//   POST { action: 'verify', reference }                                    ->  { ok, status, subscription }
// Requires the caller's Supabase session (verify_jwt stays on). The database decides who may pay
// and how much; this function only opens the provider's page and reports back.
// Secrets (Supabase › Edge Functions › Secrets): PAYMONGO_SECRET_KEY, CLEO_APP_URL.
// A refusal is answered 200 with { ok: false, code, message }, so the app can read the reason.
import { Refusal, startCheckout, verifyReturn } from '../_shared/billing-core.js';
import { cors, database, environment, json } from '../_shared/edge.js';

Deno.serve(async (request: Request) => {
  const headers = cors(request);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (request.method !== 'POST') return json({ ok: false, code: 'validation', message: 'Use POST.' }, 405, headers);
  const authorization = request.headers.get('Authorization') || '';
  if (!/^Bearer\s+\S+/.test(authorization)) return json({ ok: false, code: 'unauthorized', message: 'Sign in to continue.' }, 401, headers);
  try {
    const text = await request.text();
    if (text.length > 4000) throw new Refusal('validation', 'That request is too large.');
    let input: Record<string, unknown> = {};
    try { input = JSON.parse(text || '{}'); } catch { throw new Refusal('validation', 'That request couldn’t be read.'); }
    const rpc = database(authorization), env = environment();
    if (input.action === 'checkout') return json(await startCheckout({ input, rpc, env }), 200, headers);
    if (input.action === 'verify') return json(await verifyReturn({ input, rpc, env }), 200, headers);
    throw new Refusal('validation', 'Unknown billing action.');
  } catch (failure) {
    if (failure instanceof Refusal) return json({ ok: false, code: failure.code, message: failure.message }, 200, headers);
    console.error('billing: unexpected failure');   // never the error itself: it can carry a provider response
    return json({ ok: false, code: 'unavailable', message: 'Payments are having trouble. Nothing was charged. Try again in a moment.' }, 200, headers);
  }
});
