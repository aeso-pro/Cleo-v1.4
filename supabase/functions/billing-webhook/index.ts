// Cleo `billing-webhook` Edge Function: PayMongo tells Cleo that a checkout was paid.
// It has no Supabase session (verify_jwt is off in supabase/config.toml), so it trusts nothing
// in the message: the signature is checked with PAYMONGO_WEBHOOK_SECRET, then PayMongo is asked
// directly, with the secret key, what really happened. Only that answer can settle a payment.
// Register this function's URL in PayMongo for the event `checkout_session.payment.paid`.
// Secrets: PAYMONGO_SECRET_KEY, PAYMONGO_WEBHOOK_SECRET, CLEO_APP_URL.
import { webhook } from '../_shared/billing-core.js';
import { database, environment } from '../_shared/edge.js';

Deno.serve(async (request: Request) => {
  if (request.method !== 'POST') return new Response(null, { status: 405 });
  const rawBody = await request.text();   // the exact bytes that were signed; never re-serialised
  const result = await webhook({ rawBody, signature: request.headers.get('Paymongo-Signature') || '', rpc: database(''), env: environment() });
  return new Response(null, { status: result.status });
});
