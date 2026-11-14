// What the two billing Edge Functions share on Supabase: calling the database as the owner or
// as the service role, and answering only Cleo's own pages.
import { Refusal } from './billing-core.js';

const env = (name) => Deno.env.get(name) || '';
export const environment = () => ({
  PAYMONGO_SECRET_KEY: env('PAYMONGO_SECRET_KEY'), PAYMONGO_WEBHOOK_SECRET: env('PAYMONGO_WEBHOOK_SECRET'), CLEO_APP_URL: env('CLEO_APP_URL'),
});

// Messages Cleo's own database functions raise are written to be read; anything else is not shown.
const readable = (code, message) => /^(P0002|22023|40001|42501|23505)$/.test(code) && message.length > 0 && message.length <= 180 &&
  !/[<>{}[\]`$\\]|permission denied|violates|relation |function |column |syntax|schema|constraint|null value|duplicate key|row-level|policy/i.test(message);

/** rpc(name, args, 'user' | 'service'): the owner's own token, or the service role for settling */
export function database(userAuthorization) {
  const url = env('SUPABASE_URL'), anon = env('SUPABASE_ANON_KEY'), service = env('SUPABASE_SERVICE_ROLE_KEY');
  return async (name, args, as) => {
    const key = as === 'service' ? service : anon;
    let response, body = null;
    try {
      response = await fetch(`${url}/rest/v1/rpc/${name}`, { method: 'POST', body: JSON.stringify(args || {}),
        headers: { apikey: key, Authorization: as === 'service' ? `Bearer ${service}` : userAuthorization, 'Content-Type': 'application/json' } });
      body = await response.json();
    } catch { throw new Refusal('unavailable', 'Cleo’s server didn’t respond. Nothing was charged.', 502); }
    if (response.ok) return body;
    const code = String(body?.code || ''), message = String(body?.message || '');
    if (/^PGRST202$|^42883$/.test(code)) throw new Refusal('not_configured', 'Payments aren’t switched on yet. Nothing was charged.', 503);
    if (response.status === 401) throw new Refusal('unauthorized', 'Your session ended. Sign in again to continue.', 401);
    const kind = code === '42501' ? 'forbidden' : code === 'P0002' ? 'not_found' : /^(23505|40001)$/.test(code) ? 'conflict' : 'validation';
    throw new Refusal(kind, readable(code, message) ? message : 'That couldn’t be done. Nothing was charged.', response.status >= 500 && !readable(code, message) ? 502 : 400);
  };
}

/** only Cleo's own address may call the function from a browser */
export function cors(request) {
  let allowed = '';
  try { allowed = new URL(env('CLEO_APP_URL')).origin; } catch { /* not configured: no browser origin is allowed */ }
  const origin = request.headers.get('Origin') || '';
  return {
    ...(origin && origin === allowed ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {}),
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '600',
  };
}
export const json = (body, status, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers } });
