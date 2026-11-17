// Migration 007: the admin console's controls over accounts, businesses, plans and admins.
// Runs against a disposable in-memory PostgreSQL (PGlite). Never touches the hosted project.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { database, ids, legalVersion } from './helpers.mjs';

const { db, as, asRole, asService, onboard } = await database();
const root = randomUUID(), support = randomUUID(), helper = randomUUID();
for (const [id, email] of [[root, 'root@example.test'], [support, 'support@example.test'], [helper, 'helper@example.test']]) {
  await db.query('INSERT INTO auth.users(id,email,email_confirmed_at,raw_user_meta_data) VALUES($1,$2,now(),$3)', [id, email, { name: email.split('@')[0] }]);
}
await db.query("INSERT INTO public.cleo_platform_admins(user_id,role) VALUES($1,'superadmin'),($2,'support')", [root, support]);
await db.query("INSERT INTO auth.mfa_factors(user_id,status) VALUES($1,'verified'),($2,'verified')", [root, support]);
const alpha = await onboard(ids.owner, 'Alpha Foods');
const beta = await onboard(ids.other, 'Beta Retail');
const second = randomUUID();
await db.query("INSERT INTO public.cleo_branches(id,business_id,code,name) VALUES($1,$2,'NORTH','North branch')", [second, alpha.business.id]);
await db.query("INSERT INTO public.cleo_memberships(user_id,business_id,branch_id,role) VALUES($1,$2,$3,'cashier')", [ids.cashier, alpha.business.id, alpha.branch.id]);
await as(ids.cashier, 'cleo_accept_legal', [legalVersion, 'email']);

const nextYear = new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10);
const adm = (name, args = [], who = root, aal = 'aal2') => as(who, name, args, aal);
const history = async (action) => (await db.query('SELECT admin_email,target_id,detail FROM public.cleo_admin_audit WHERE action=$1 ORDER BY id', [action])).rows;
const WRITES = [
  ['cleo_admin_confirm_email', [ids.unconfirmed, 'Verified by phone']],
  ['cleo_admin_set_name', [ids.cashier, 'Cashier One', 'Typo in the name']],
  ['cleo_admin_set_member', [ids.cashier, alpha.business.id, 'manager', null, 'Promoted']],
  ['cleo_admin_rename_business', [alpha.business.id, 'Alpha Kitchen', 'Owner asked']],
  ['cleo_admin_set_plan', [alpha.business.id, 'pro', 1, 1, 'monthly', nextYear, 'Trial']],
  ['cleo_admin_set_admin', ['helper@example.test', 'support', 'New staff']],
];
const READS = [['cleo_admin_account', [ids.owner]], ['cleo_admin_business_billing', [alpha.business.id]], ['cleo_admin_payments', ['all', 25, 0]],
  ['cleo_admin_billing_overview', []], ['cleo_admin_business_plans', []]];

await test('nobody but an admin with two-step reaches the new controls; support only reads', async () => {
  for (const [name, args] of [...WRITES, ...READS, ['cleo_admin_admins', []]]) {
    await assert.rejects(asRole(null, () => db.query(`SELECT public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')})`, args), 'anon'), /permission denied/, name);
    await assert.rejects(as(ids.owner, name, args, 'aal2'), /Admin access is required/, name);
    await assert.rejects(adm(name, args, root, 'aal1'), /authenticator code/, name);
  }
  for (const [name, args] of [...WRITES, ['cleo_admin_admins', []]]) await assert.rejects(adm(name, args, support), /Only a superadmin/, name);
  for (const [name, args] of READS) await adm(name, args, support);
  await assert.rejects(as(root, 'cleo_admin_reason', ['abc'], 'aal2'), /permission denied/);
  for (const [name, args] of WRITES) await assert.rejects(adm(name, [...args.slice(0, -1), ' '], root), /short reason/, name);
});

await test('an account sheet gathers what an admin needs, and nothing secret', async () => {
  const a = await adm('cleo_admin_account', [ids.cashier]);
  assert.deepEqual([a.email, a.confirmed, a.twoStep, a.adminRole, a.suspension], ['cashier@example.test', true, false, null, null]);
  assert.deepEqual(a.memberships.map((m) => [m.business, m.role, m.branch, m.revoked]), [['Alpha Foods', 'cashier', 'Main branch', false]]);
  assert.equal(a.legal.version, legalVersion);
  assert.ok(!JSON.stringify(a).match(/encrypted_password|token|secret/i));
  await assert.rejects(adm('cleo_admin_account', [randomUUID()]), /no longer exists/);
});

await test('confirming an email lets a stuck account sign in, once, with a record', async () => {
  await assert.rejects(as(ids.unconfirmed, 'cleo_auth_context'), /verified email/);
  assert.deepEqual(await adm('cleo_admin_confirm_email', [ids.unconfirmed, 'Verified by phone call']), { ok: true, changed: true });
  assert.deepEqual(await adm('cleo_admin_confirm_email', [ids.unconfirmed, 'Verified by phone call']), { ok: true, changed: false });
  assert.equal((await as(ids.unconfirmed, 'cleo_auth_context')).account.needsBusiness, true);
  await assert.rejects(adm('cleo_admin_confirm_email', [ids.missingEmail, 'No email here']), /no email address/);
  assert.deepEqual((await history('account.confirm_email')).map((h) => [h.detail.email, h.detail.reason]), [['unconfirmed@example.test', 'Verified by phone call']]);
});

await test('names, roles and businesses change from the console, and each business sees it', async () => {
  assert.equal((await adm('cleo_admin_set_name', [ids.cashier, '  Carla Cruz ', 'Typo in the name'])).name, 'Carla Cruz');
  assert.equal((await as(ids.cashier, 'cleo_auth_context')).account.name, 'Carla Cruz');
  await assert.rejects(adm('cleo_admin_set_name', [ids.cashier, '', 'Empty']), /1 to 120/);

  const promoted = await adm('cleo_admin_set_member', [ids.cashier, alpha.business.id, 'manager', second, 'Runs the north branch now']);
  assert.deepEqual([promoted.added, promoted.role, promoted.branchId], [false, 'manager', second]);
  assert.equal((await as(ids.cashier, 'cleo_auth_context')).account.role, 'Branch Manager');
  // HQ sees every branch: the branch is cleared
  assert.equal((await adm('cleo_admin_set_member', [ids.cashier, alpha.business.id, 'hq', second, 'Now head office'])).branchId, null);
  await assert.rejects(adm('cleo_admin_set_member', [ids.cashier, alpha.business.id, 'cashier', beta.branch.id, 'Wrong branch']), /not part of this business/);
  await assert.rejects(adm('cleo_admin_set_member', [ids.cashier, alpha.business.id, 'janitor', null, 'No such role']), /Choose a role/);
  // the only owner cannot be demoted
  await assert.rejects(adm('cleo_admin_set_member', [ids.owner, alpha.business.id, 'manager', null, 'Demote']), /only owner/);
  // adding: an account with no business joins one, at its first branch by default
  const added = await adm('cleo_admin_set_member', [ids.unconfirmed, alpha.business.id, 'clerk', null, 'New stock clerk']);
  assert.deepEqual([added.added, added.branchId], [true, alpha.branch.id]);
  await assert.rejects(adm('cleo_admin_set_member', [ids.unconfirmed, beta.business.id, 'clerk', null, 'Two places']), /another business/);
  await assert.rejects(adm('cleo_admin_set_member', [ids.missingEmail, beta.business.id, 'clerk', null, 'No email']), /confirmed email/);
  // a second owner makes the first one movable
  await adm('cleo_admin_set_member', [ids.cashier, alpha.business.id, 'owner', null, 'Co-owner']);
  await adm('cleo_admin_set_member', [ids.owner, alpha.business.id, 'hq', null, 'Stepping back']);
  await adm('cleo_admin_set_member', [ids.owner, alpha.business.id, 'owner', null, 'Back as owner']);

  assert.equal((await adm('cleo_admin_rename_business', [alpha.business.id, ' Alpha Kitchen ', 'Owner asked by email'])).name, 'Alpha Kitchen');
  assert.equal((await as(ids.owner, 'cleo_auth_context')).business.name, 'Alpha Kitchen');
  await as(ids.owner, 'cleo_save_setting', ['business.legal', 'Alpha Kitchen Corp.', 0]);
  await adm('cleo_admin_rename_business', [alpha.business.id, 'Alpha Kitchen PH', 'Registered name']);
  assert.equal((await as(ids.owner, 'cleo_bootstrap')).config.business.name, 'Alpha Kitchen PH');
  const seen = (await db.query("SELECT action FROM public.cleo_audit_log WHERE business_id=$1 AND action LIKE 'admin.%' ORDER BY id", [alpha.business.id])).rows.map((r) => r.action);
  assert.ok(seen.includes('admin.membership.role') && seen.includes('admin.membership.add') && seen.includes('admin.business.rename'));
});

await test('an admin gives, extends and ends a plan; the app sees it at once', async () => {
  assert.equal((await as(ids.other, 'cleo_bootstrap')).plan, null);
  const given = await adm('cleo_admin_set_plan', [beta.business.id, 'max', 3, 2, 'annual', nextYear, 'Agreed with sales']);
  assert.deepEqual([given.subscription.plan, given.subscription.terminals, given.subscription.branches], ['max', 3, 2]);
  const boot = await as(ids.other, 'cleo_bootstrap');
  assert.deepEqual([boot.plan, boot.billingMethod], ['max', null]);
  for (const bad of [['pro', 3, 2, 'monthly', nextYear], ['enterprise', 1, 1, 'monthly', nextYear], ['pro', 1, 1, 'monthly', '2000-01-01'], ['pro', 1, 1, 'monthly', null]]) {
    await assert.rejects(adm('cleo_admin_set_plan', [beta.business.id, ...bad, 'Bad plan']), /does not cover|Choose Free|last day/);
  }
  const free = await adm('cleo_admin_set_plan', [beta.business.id, 'free', 1, 1, 'monthly', null, 'Moved to Free']);
  assert.deepEqual([free.subscription.plan, free.subscription.periodEnd], ['free', null]);
  const ended = await adm('cleo_admin_set_plan', [beta.business.id, 'none', null, null, null, null, 'Refunded in PayMongo']);
  assert.equal(ended.subscription, null);
  assert.equal((await as(ids.other, 'cleo_bootstrap')).plan, null);
  assert.deepEqual((await history('plan.set')).map((h) => h.detail.plan), ['max', 'free']);
  assert.equal((await history('plan.end'))[0].detail.reason, 'Refunded in PayMongo');
});

await test('payments, billing figures and business plans read back what happened', async () => {
  const p = await as(ids.owner, 'cleo_billing_start', ['pro', 1, 1, 'monthly', 'gcash']);
  await asService('cleo_billing_attach', [p.reference, 'cs_admin_test', true]);
  await asService('cleo_billing_confirm', [p.reference, 'cs_admin_test', 'pay_1', p.amountCentavos, true]);
  await as(ids.owner, 'cleo_billing_start', ['basic', 1, 1, 'monthly', 'card']);
  const all = await adm('cleo_admin_payments', ['all', 25, 0]);
  assert.equal(all.total, 2);
  assert.deepEqual(all.rows.map((r) => r.status).sort(), ['paid', 'pending']);
  assert.equal(all.rows.find((r) => r.status === 'paid').business, 'Alpha Kitchen PH');
  assert.equal(all.summary.paidThisMonth, 2999);
  assert.equal((await adm('cleo_admin_payments', ['paid', 25, 0])).total, 1);
  await assert.rejects(adm('cleo_admin_payments', ['refunded', 25, 0]), /filter/);
  const billing = await adm('cleo_admin_business_billing', [alpha.business.id]);
  assert.deepEqual([billing.subscription.plan, billing.payments.length, billing.branches.length, billing.prices.max.monthly], ['pro', 2, 2, 4999]);
  const overview = await adm('cleo_admin_billing_overview');
  assert.deepEqual([overview.activePaid, overview.noPlan, overview.paidThisMonth, overview.pendingPayments], [1, 1, 2999, 1]);
  const plans = await adm('cleo_admin_business_plans');
  assert.equal(plans[alpha.business.id].plan, 'pro');
  assert.equal(plans[beta.business.id], undefined);
});

await test('superadmins add, change and remove admins, and can never lock Cleo out', async () => {
  const added = await adm('cleo_admin_set_admin', ['HELPER@example.test', 'support', 'New support hire']);
  assert.deepEqual([added.role, added.before], ['support', null]);
  assert.equal((await adm('cleo_admin_context', [], helper, 'aal1')).role, 'support');
  await adm('cleo_admin_set_admin', ['helper@example.test', 'superadmin', 'Promoted']);
  await assert.rejects(adm('cleo_admin_set_admin', ['root@example.test', 'support', 'Myself']), /your own admin access/);
  await assert.rejects(adm('cleo_admin_set_admin', ['nobody@example.test', 'support', 'Unknown']), /No confirmed Cleo account/);
  await assert.rejects(adm('cleo_admin_set_admin', ['helper@example.test', 'owner', 'Bad level']), /Choose superadmin/);
  // helper has no authenticator: root is the only superadmin with two-step, so helper may not remove root
  await db.query("INSERT INTO auth.mfa_factors(user_id,status) VALUES($1,'verified')", [helper]);
  await adm('cleo_admin_set_admin', ['root@example.test', 'support', 'Handing over'], helper);
  await assert.rejects(adm('cleo_admin_set_admin', ['helper@example.test', 'none', 'Leaving'], support), /Only a superadmin/);
  await db.query('DELETE FROM auth.mfa_factors WHERE user_id=$1', [helper]);
  await assert.rejects(adm('cleo_admin_set_admin', ['helper@example.test', 'none', 'Leaving'], root), /Only a superadmin/);
  await db.query("UPDATE public.cleo_platform_admins SET role='superadmin' WHERE user_id=$1", [root]);
  await assert.rejects(adm('cleo_admin_set_admin', ['root@example.test', 'none', 'Remove the last one'], helper), /authenticator code|at least one superadmin/);
  await db.query("INSERT INTO auth.mfa_factors(user_id,status) VALUES($1,'verified')", [helper]);
  await adm('cleo_admin_set_admin', ['helper@example.test', 'none', 'Contract ended'], root);
  await assert.rejects(adm('cleo_admin_context', [], helper), /Admin access is required/);
  const list = await adm('cleo_admin_admins');
  assert.deepEqual(list.map((a) => [a.email, a.role, a.revoked, a.you]), [['root@example.test', 'superadmin', false, true], ['support@example.test', 'support', false, false], ['helper@example.test', 'superadmin', true, false]]);
  assert.deepEqual((await history('admin.add')).map((h) => h.detail.email), ['helper@example.test']);
  // a suspended account cannot be made an admin
  await adm('cleo_admin_set_suspension', [ids.clerk, true, 'Under review']);
  await assert.rejects(adm('cleo_admin_set_admin', ['clerk@example.test', 'support', 'Hire'], root), /Restore this account/);
});

await test('the security report still passes with the new functions', async () => {
  const report = await adm('cleo_admin_security_report');
  assert.deepEqual(report.checks.filter((c) => !c.ok).map((c) => c.id), []);
  const rows = (await db.query(`SELECT p.proname,p.proconfig,has_function_privilege('anon',p.oid,'EXECUTE') AS anon_execute
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname LIKE 'cleo_%'`)).rows;
  for (const row of rows) { assert.deepEqual(row.proconfig, ['search_path=""'], row.proname); assert.equal(row.anon_execute, false, row.proname); }
});
await db.close();
