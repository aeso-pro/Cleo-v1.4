// Migration 006: plan payments and subscriptions.
// Runs against a disposable in-memory PostgreSQL (PGlite). Never touches the hosted project or a payment provider.
import test from 'node:test';
import assert from 'node:assert/strict';
import { database, ids, legalVersion } from './helpers.mjs';

const { db, as, asRole, asService, onboard } = await database();
const alpha = await onboard(ids.owner, 'Alpha Foods');
const beta = await onboard(ids.other, 'Beta Retail');
for (const [id, role] of [[ids.manager, 'manager'], [ids.cashier, 'cashier']]) {
  await db.query('INSERT INTO public.cleo_memberships(user_id,business_id,branch_id,role) VALUES($1,$2,$3,$4)', [id, alpha.business.id, alpha.branch.id, role]);
  await as(id, 'cleo_accept_legal', [legalVersion, 'email']);
}
const start = (plan, terminals = 1, branches = 1, cycle = 'monthly', method = 'gcash', who = ids.owner) => as(who, 'cleo_billing_start', [plan, terminals, branches, cycle, method]);
const count = async (sql, params = []) => (await db.query(`SELECT count(*)::int AS n FROM ${sql}`, params)).rows[0].n;
/** attach a checkout page and confirm it paid, as the Edge Functions do */
async function pay(payment, session = `cs_${payment.reference}`) {
  await asService('cleo_billing_attach', [payment.reference, session, false]);
  return asService('cleo_billing_confirm', [payment.reference, session, 'pay_test', payment.amountCentavos, false]);
}

await test('a new business has no plan, and the server prices every plan itself', async () => {
  const boot = await as(ids.owner, 'cleo_bootstrap');
  assert.deepEqual([boot.plan, boot.subscription, boot.billingMethod, boot.invoices], [null, null, null, []]);
  assert.equal(boot.data.biz.name, 'Alpha Foods');   // the rest of the bootstrap is unchanged
  // the same sums as Cleo.licensing.quote: first terminal per branch at the plan rate, the others at the extra rate
  for (const [plan, terminals, branches, cycle, pesos] of [['basic', 1, 1, 'monthly', 1499], ['basic', 3, 1, 'monthly', 2497], ['pro', 1, 1, 'annual', 29990],
    ['pro', 2, 1, 'annual', 41978], ['max', 2, 1, 'monthly', 6498], ['max', 2, 1, 'annual', 67978], ['max', 5, 2, 'monthly', 14495]]) {
    const p = await start(plan, terminals, branches, cycle);
    assert.equal(p.amountCentavos, pesos * 100, `${plan} ${terminals}/${branches} ${cycle}`);
    assert.match(p.reference, /^CLEO-[0-9A-F]{16}$/);
  }
  for (const bad of [['enterprise', 1, 1, 'monthly'], ['basic', 0, 1, 'monthly'], ['basic', 2, 3, 'monthly'], ['basic', 2, 2, 'monthly'], ['pro', 4, 2, 'annual'],
    ['max', 10000, 1, 'monthly'], ['pro', 1, 1, 'weekly'], ['free', 2, 1, 'monthly']]) {
    await assert.rejects(start(...bad), /Choose Free|at least one terminal|does not cover|monthly or annual/);
  }
  await assert.rejects(start('pro', 1, 1, 'monthly', 'bitcoin'), /Choose how to pay/);
  await db.query('DELETE FROM public.cleo_payments');
});

await test('only the owner starts a payment; nobody but the service role can settle one', async () => {
  for (const who of [ids.manager, ids.cashier]) await assert.rejects(start('pro', 1, 1, 'monthly', 'card', who), /role or business access/);
  await assert.rejects(asRole(null, () => db.query("SELECT public.cleo_billing_start('pro',1,1,'monthly','card')"), 'anon'), /permission denied/);
  const payment = await start('pro', 1, 1, 'monthly', 'card');
  for (const [name, args] of [['cleo_billing_attach', [payment.reference, 'cs_forged', false]], ['cleo_billing_confirm', [payment.reference, 'cs_forged', 'pay_x', payment.amountCentavos, false]],
    ['cleo_billing_close', [payment.reference, 'failed']], ['cleo_billing_price', ['pro', 1, 1, 'monthly']], ['cleo_require_service', []], ['cleo_subscription_view', [alpha.business.id]], ['cleo_operations_bootstrap', []]]) {
    await assert.rejects(as(ids.owner, name, args), /permission denied/, name);
  }
  for (const sql of ["UPDATE public.cleo_payments SET status='paid'", "INSERT INTO public.cleo_subscriptions(business_id,plan,terminals,branches,cycle,total_centavos) SELECT id,'max',1,1,'annual',0 FROM public.cleo_businesses",
    'UPDATE public.cleo_plan_prices SET monthly=1', 'SELECT * FROM public.cleo_plan_prices']) {
    await assert.rejects(asRole(ids.owner, () => db.query(sql)), /permission denied/, sql);
  }
  // a service call without the service claim is refused as well
  await db.exec('BEGIN; SET LOCAL ROLE service_role;');
  await assert.rejects(db.query('SELECT public.cleo_billing_close($1,$2)', [payment.reference, 'failed']), /not available/);
  await db.exec('ROLLBACK');
  assert.equal((await as(ids.owner, 'cleo_bootstrap')).plan, null);
});

await test('a payment settles once, for the session and amount this database issued', async () => {
  const payment = await start('pro', 2, 1, 'monthly', 'gcash');
  assert.equal(payment.amountCentavos, 399800);
  await asService('cleo_billing_attach', [payment.reference, 'cs_real', false]);
  await assert.rejects(asService('cleo_billing_attach', [payment.reference, 'cs_second', false]), /not waiting for a checkout page/);
  await assert.rejects(asService('cleo_billing_confirm', [payment.reference, 'cs_other', 'pay_1', 399800, false]), /does not belong to this payment/);
  await assert.rejects(asService('cleo_billing_confirm', [payment.reference, 'cs_real', 'pay_1', 100, false]), /does not match the amount due/);
  await assert.rejects(asService('cleo_billing_confirm', [payment.reference, 'cs_real', 'pay_1', 399800, true]), /test payment cannot settle a live one/);
  await assert.rejects(asService('cleo_billing_confirm', ['CLEO-0000000000000000', 'cs_real', 'pay_1', 399800, false]), /No payment has that reference/);
  assert.equal((await as(ids.owner, 'cleo_billing_status', [payment.reference])).status, 'pending');
  const done = await asService('cleo_billing_confirm', [payment.reference, 'cs_real', 'pay_1', 399800, false]);
  assert.deepEqual([done.ok, done.already, done.subscription.plan, done.subscription.terminals, done.subscription.total], [true, false, 'pro', 2, 3998]);
  // the provider delivers webhooks more than once: the second changes nothing
  const again = await asService('cleo_billing_confirm', [payment.reference, 'cs_real', 'pay_1', 399800, false]);
  assert.equal(again.already, true);
  assert.equal(again.subscription.periodEnd, done.subscription.periodEnd);
  assert.equal(await count("public.cleo_audit_log WHERE action='billing.paid'"), 1);
  const boot = await as(ids.owner, 'cleo_bootstrap');
  assert.deepEqual([boot.plan, boot.subscription.cycle, boot.billingMethod.label, boot.billingMethod.kind], ['pro', 'monthly', 'GCash', 'card']);
  const days = (new Date(boot.subscription.periodEnd) - Date.now()) / 86400000;
  assert.ok(days > 27 && days < 32, `period of ${days} days`);
  // staff get the plan, so the right modes open, but not how it is paid for
  const staff = await as(ids.cashier, 'cleo_bootstrap');
  assert.deepEqual([staff.plan, staff.billingMethod], ['pro', null]);
  assert.equal((await asRole(ids.cashier, () => db.query('SELECT * FROM public.cleo_payments'))).rows.length, 0);
  assert.equal((await asRole(ids.owner, () => db.query("SELECT * FROM public.cleo_payments WHERE status='paid'"))).rows.length, 1);
});

await test('paying again for the same plan adds to it; another business is untouched', async () => {
  const before = (await as(ids.owner, 'cleo_bootstrap')).subscription.periodEnd;
  await pay(await start('pro', 2, 1, 'monthly', 'maya'));
  const after = (await as(ids.owner, 'cleo_bootstrap')).subscription;
  const added = (new Date(after.periodEnd) - new Date(before)) / 86400000;
  assert.ok(added > 27 && added < 32, `renewal added ${added} days`);
  assert.equal(after.method, 'maya');
  // switching plan starts the new period now
  const switched = (await pay(await start('max', 3, 2, 'annual', 'card'))).subscription;
  assert.deepEqual([switched.plan, switched.branches, switched.total], ['max', 2, 117968]);
  const year = (new Date(switched.periodEnd) - Date.now()) / 86400000;
  assert.ok(year > 364 && year < 367, `annual period of ${year} days`);
  assert.equal((await as(ids.other, 'cleo_bootstrap')).plan, null);
  assert.equal((await asRole(ids.other, () => db.query('SELECT * FROM public.cleo_subscriptions'))).rows.length, 0);
  await assert.rejects(as(ids.other, 'cleo_billing_status', [(await start('basic')).reference]), /not on this business/);
});

await test('Free starts without a payment, and cannot replace a paid plan that is still running', async () => {
  await assert.rejects(start('free'), /paid plan is still running/);
  const free = await start('free', 1, 1, 'monthly', null, ids.other);
  assert.deepEqual([free.ok, free.free, free.subscription.plan, free.subscription.total, free.subscription.periodEnd], [true, true, 'free', 0, null]);
  const boot = await as(ids.other, 'cleo_bootstrap');
  assert.deepEqual([boot.plan, boot.billingMethod], ['free', null]);
  assert.equal(await count('public.cleo_payments WHERE business_id=$1', [beta.business.id]), 0);
});

await test('a plan that ran out, with its three days of grace, stops opening the app', async () => {
  await db.query("UPDATE public.cleo_subscriptions SET current_period_end=now()-interval '2 days' WHERE business_id=$1", [alpha.business.id]);
  assert.equal((await as(ids.owner, 'cleo_bootstrap')).plan, 'max');
  await db.query("UPDATE public.cleo_subscriptions SET current_period_end=now()-interval '4 days' WHERE business_id=$1", [alpha.business.id]);
  const boot = await as(ids.owner, 'cleo_bootstrap');
  assert.deepEqual([boot.plan, boot.subscription], [null, null]);
  assert.equal(boot.data.products.length, 0);   // the business itself still loads
  await pay(await start('basic'));
  assert.equal((await as(ids.owner, 'cleo_bootstrap')).plan, 'basic');
});

await test('failed and abandoned checkouts close, and runaway retries are stopped', async () => {
  const failed = await start('basic');
  assert.deepEqual(await asService('cleo_billing_close', [failed.reference, 'failed']), { ok: true, changed: true });
  assert.deepEqual(await asService('cleo_billing_close', [failed.reference, 'failed']), { ok: true, changed: false });
  await assert.rejects(asService('cleo_billing_close', [failed.reference, 'paid']), /failed or expired/);
  await assert.rejects(asService('cleo_billing_attach', [failed.reference, 'cs_late', false]), /not waiting/);
  await db.query('DELETE FROM public.cleo_payments WHERE business_id=$1', [beta.business.id]);
  for (let i = 0; i < 12; i++) await start('basic', 1, 1, 'monthly', 'card', ids.other);
  await assert.rejects(start('basic', 1, 1, 'monthly', 'card', ids.other), /Too many payment attempts/);
});

await test('billing tables and functions pass the admin security report', async () => {
  const admin = '99999999-9999-4999-8999-999999999999';
  await db.query("INSERT INTO auth.users(id,email,email_confirmed_at) VALUES($1,'root@example.test',now())", [admin]);
  await db.query("INSERT INTO public.cleo_platform_admins(user_id,role) VALUES($1,'superadmin')", [admin]);
  await db.query("INSERT INTO auth.mfa_factors(user_id,status) VALUES($1,'verified')", [admin]);
  const report = await as(admin, 'cleo_admin_security_report', [], 'aal2');
  assert.deepEqual(report.checks.filter((c) => !c.ok), []);
  const rows = (await db.query(`SELECT p.proname,p.proconfig,has_function_privilege('anon',p.oid,'EXECUTE') AS anon_execute
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname LIKE 'cleo_%'`)).rows;
  for (const row of rows) { assert.deepEqual(row.proconfig, ['search_path=""'], row.proname); assert.equal(row.anon_execute, false, row.proname); }
});
await db.close();
