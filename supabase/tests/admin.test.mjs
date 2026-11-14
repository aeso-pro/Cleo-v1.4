// Migration 005: platform admin console, account suspension and hardening.
// Runs against a disposable in-memory PostgreSQL (PGlite). Never touches the hosted project.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { database, ids, legalVersion } from './helpers.mjs';

const { db, as, asRole, onboard } = await database();
const admin = randomUUID(), support = randomUUID();
for (const [id, email, name] of [[admin, 'root@example.test', 'Root Admin'], [support, 'support@example.test', 'Support Staff']]) {
  await db.query('INSERT INTO auth.users(id,email,email_confirmed_at,raw_user_meta_data) VALUES($1,$2,now(),$3)', [id, email, { name }]);
}
// Only the database owner can do this. No browser role has any privilege on the table.
await db.query("INSERT INTO public.cleo_platform_admins(user_id,role,note) VALUES($1,'superadmin','test'),($2,'support','test')", [admin, support]);
await db.query("INSERT INTO auth.mfa_factors(user_id,status) VALUES($1,'verified'),($2,'verified')", [admin, support]);

const alpha = await onboard(ids.owner, 'Alpha Foods');
const beta = await onboard(ids.other, 'Beta Retail');
for (const [id, role] of [[ids.manager, 'manager'], [ids.cashier, 'cashier'], [ids.clerk, 'clerk']]) {
  await db.query('INSERT INTO public.cleo_memberships(user_id,business_id,branch_id,role) VALUES($1,$2,$3,$4)', [id, alpha.business.id, alpha.branch.id, role]);
  await as(id, 'cleo_accept_legal', [legalVersion, 'email']);
}
/** an admin RPC as a fully verified (aal2) admin unless told otherwise */
const adm = (name, args = [], who = admin, aal = 'aal2') => as(who, name, args, aal);
const count = async (sql, params = []) => (await db.query(`SELECT count(*)::int AS n FROM ${sql}`, params)).rows[0].n;
const READS = [['cleo_admin_overview', []], ['cleo_admin_list_accounts', ['', 'all', 25, 0]], ['cleo_admin_list_businesses', ['', 25, 0]],
  ['cleo_admin_business', [alpha.business.id]], ['cleo_admin_audit_log', [50, 0]], ['cleo_admin_security_report', []], ['cleo_admin_session_start', []]];
const WRITES = [['cleo_admin_set_suspension', [ids.cashier, true, 'Not allowed']], ['cleo_admin_set_membership', [ids.cashier, alpha.business.id, true, 'Not allowed']]];

await test('visitors and ordinary accounts cannot use, read or join the admin console', async () => {
  for (const [name, args] of [...READS, ...WRITES, ['cleo_admin_context', []]]) {
    await assert.rejects(asRole(null, () => db.query(`SELECT public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')})`, args), 'anon'), /permission denied/);
    // an owner of a real business is still not a platform admin, with or without two-step verification
    for (const aal of ['aal1', 'aal2']) await assert.rejects(as(ids.owner, name, args, aal), /Admin access is required/);
  }
  for (const table of ['cleo_platform_admins', 'cleo_account_suspensions', 'cleo_admin_audit']) {
    await assert.rejects(asRole(ids.owner, () => db.query(`SELECT * FROM public.${table}`)), /permission denied/);
    await assert.rejects(asRole(null, () => db.query(`SELECT * FROM public.${table}`), 'anon'), /permission denied/);
  }
  await assert.rejects(asRole(ids.owner, () => db.query("INSERT INTO public.cleo_platform_admins(user_id,role) VALUES($1,'superadmin')", [ids.owner])), /permission denied/);
  await assert.rejects(asRole(ids.owner, () => db.query('DELETE FROM public.cleo_account_suspensions')), /permission denied/);
  for (const [name, args] of [['cleo_require_admin', [false]], ['cleo_admin_log', ['x', 'system', '', {}]], ['cleo_account_blocked', [ids.owner]]]) {
    await assert.rejects(as(ids.owner, name, args), /permission denied/);
    await assert.rejects(as(admin, name, args, 'aal2'), /permission denied/);
  }
});

await test('an admin signed in with a password alone gets the two-step prompt and nothing else', async () => {
  const context = await adm('cleo_admin_context', [], admin, 'aal1');
  assert.deepEqual({ admin: context.admin, role: context.role, canWrite: context.canWrite, enrolled: context.mfaEnrolled, verified: context.mfaVerified },
    { admin: true, role: 'superadmin', canWrite: true, enrolled: true, verified: false });
  assert.equal(context.email, 'root@example.test');
  for (const [name, args] of [...READS, ...WRITES]) await assert.rejects(adm(name, args, admin, 'aal1'), /authenticator code/);
  // An admin with no authenticator yet still cannot open the console on a password.
  await db.query('DELETE FROM auth.mfa_factors WHERE user_id=$1', [admin]);
  assert.equal((await adm('cleo_admin_context', [], admin, 'aal1')).mfaEnrolled, false);
  await assert.rejects(adm('cleo_admin_overview', [], admin, 'aal1'), /authenticator code/);
  await db.query("INSERT INTO auth.mfa_factors(user_id,status) VALUES($1,'verified')", [admin]);
  assert.equal((await adm('cleo_admin_context')).mfaVerified, true);
  assert.equal((await adm('cleo_admin_context', [], support)).canWrite, false);
});

await test('the overview counts accounts, sign-in providers and businesses from the real tables', async () => {
  const o = await adm('cleo_admin_overview');
  assert.equal(o.accounts.total, await count('auth.users'));
  assert.equal(o.accounts.confirmed, await count('auth.users WHERE email_confirmed_at IS NOT NULL'));
  assert.equal(o.accounts.withBusiness, 5);
  assert.equal(o.accounts.suspended, 0);
  assert.equal(o.accounts.twoStep, 2);
  assert.equal(o.providers.facebook, 1);
  assert.equal(o.businesses.total, 2);
  assert.equal(o.businesses.branches, 2);
  assert.equal(o.signups.length, 30);
  assert.equal(o.signups.at(-1).accounts, o.accounts.total);
  assert.equal(o.signups.at(-1).businesses, 2);
  assert.ok(o.signups.slice(0, -1).every((d) => d.accounts === 0 && /^\d{4}-\d\d-\d\d$/.test(d.day)));
});

await test('account search is literal, filtered and paged, and never returns credentials', async () => {
  const all = await adm('cleo_admin_list_accounts', ['', 'all', 100, 0]);
  assert.equal(all.total, await count('auth.users'));
  assert.equal(all.rows.length, all.total);
  const expected = ['adminRole', 'banned', 'business', 'businessId', 'confirmed', 'createdAt', 'email', 'id', 'lastSignInAt', 'membershipRevoked',
    'name', 'provider', 'providers', 'role', 'suspended', 'suspendedAt', 'suspendedReason', 'twoStep'];
  for (const row of all.rows) assert.deepEqual(Object.keys(row).sort(), expected);
  const first = await adm('cleo_admin_list_accounts', ['', 'all', 3, 0]), second = await adm('cleo_admin_list_accounts', ['', 'all', 3, 3]);
  assert.equal(first.rows.length, 3);
  assert.equal(new Set([...first.rows, ...second.rows].map((r) => r.id)).size, 6);
  const found = await adm('cleo_admin_list_accounts', ['OWNER@example', 'all', 25, 0]);
  assert.deepEqual(found.rows.map((r) => r.email), ['owner@example.test']);
  assert.equal(found.rows[0].business, 'Alpha Foods');
  assert.equal(found.rows[0].role, 'owner');
  assert.equal((await adm('cleo_admin_list_accounts', ['beta retail', 'all', 25, 0])).rows[0].email, 'other@example.test');
  // % and _ are text, not wildcards
  for (const wildcard of ['%', '_', '%@%', 'o_ner']) assert.equal((await adm('cleo_admin_list_accounts', [wildcard, 'all', 25, 0])).total, 0);
  assert.deepEqual((await adm('cleo_admin_list_accounts', ['', 'facebook', 25, 0])).rows.map((r) => r.id), [ids.facebook]);
  assert.ok((await adm('cleo_admin_list_accounts', ['', 'unconfirmed', 25, 0])).rows.some((r) => r.id === ids.unconfirmed));
  const noBusiness = (await adm('cleo_admin_list_accounts', ['', 'no_business', 100, 0])).rows.map((r) => r.id);
  assert.ok(noBusiness.includes(ids.facebook) && !noBusiness.includes(ids.owner));
  assert.deepEqual((await adm('cleo_admin_list_accounts', ['', 'no_two_step', 100, 0])).rows.filter((r) => r.adminRole).length, 0);
  assert.equal(all.rows.find((r) => r.id === admin).adminRole, 'superadmin');
  for (const bad of [['', 'everything', 25, 0], ['', 'all', 0, 0], ['', 'all', 101, 0], ['', 'all', 25, -1], ['x'.repeat(101), 'all', 25, 0]]) {
    await assert.rejects(adm('cleo_admin_list_accounts', bad), /Check the search/);
  }
  // support staff can read
  assert.equal((await adm('cleo_admin_list_accounts', ['', 'all', 100, 0], support)).total, all.total);
});

await test('businesses list and detail show members and activity, not tenant record values', async () => {
  await as(ids.owner, 'cleo_apply_records', ['products', [{ id: 'latte', name: 'Latte', price: 160, sku: 'LATTE' }], []]);
  const list = await adm('cleo_admin_list_businesses', ['', 25, 0]);
  assert.equal(list.total, 2);
  const row = list.rows.find((r) => r.id === alpha.business.id);
  assert.deepEqual({ name: row.name, owner: row.ownerEmail, hasOwner: row.hasOwner, members: row.members, branches: row.branches, products: row.products },
    { name: 'Alpha Foods', owner: 'owner@example.test', hasOwner: true, members: 4, branches: 1, products: 1 });
  assert.ok(row.lastActivityAt);
  assert.deepEqual((await adm('cleo_admin_list_businesses', ['ALPHA', 25, 0])).rows.map((r) => r.name), ['Alpha Foods']);
  assert.equal((await adm('cleo_admin_list_businesses', ['%', 25, 0])).total, 0);
  const detail = await adm('cleo_admin_business', [alpha.business.id]);
  assert.equal(detail.business.name, 'Alpha Foods');
  assert.deepEqual(detail.members.map((m) => m.role), ['owner', 'manager', 'cashier', 'clerk']);
  assert.equal(detail.members[0].email, 'owner@example.test');
  assert.deepEqual(detail.counts, { products: 1, stockItems: 0, customers: 0, stockMovements: 0, transfers: 0 });
  assert.ok(detail.activity.length >= 1);
  for (const entry of detail.activity) assert.deepEqual(Object.keys(entry).sort(), ['action', 'actor', 'at', 'entity']);
  await assert.rejects(adm('cleo_admin_business', [randomUUID()]), /no longer exists/);
});

await test('support staff can read but not change anything', async () => {
  for (const [name, args] of WRITES) await assert.rejects(adm(name, args, support), /Only a superadmin/);
  assert.equal(await count('public.cleo_account_suspensions'), 0);
  assert.equal(await count('public.cleo_memberships WHERE revoked_at IS NOT NULL'), 0);
});

await test('suspension locks an account out of context, table reads and RPCs at once; restore lifts it', async () => {
  assert.equal((await as(ids.cashier, 'cleo_auth_context')).account.role, 'Cashier');
  assert.equal((await asRole(ids.cashier, () => db.query('SELECT * FROM public.cleo_businesses'))).rows.length, 1);
  await assert.rejects(adm('cleo_admin_set_suspension', [ids.cashier, true, ' x ']), /short reason/);
  await assert.rejects(adm('cleo_admin_set_suspension', [admin, true, 'Testing myself']), /own account/);
  await assert.rejects(adm('cleo_admin_set_suspension', [support, true, 'Another admin']), /admin access before/);
  await assert.rejects(adm('cleo_admin_set_suspension', [randomUUID(), true, 'Nobody here']), /no longer exists/);
  const done = await adm('cleo_admin_set_suspension', [ids.cashier, true, 'Chargeback fraud']);
  assert.deepEqual({ ok: done.ok, suspended: done.suspended, changed: done.changed }, { ok: true, suspended: true, changed: true });
  // the same access token is refused everywhere, immediately
  await assert.rejects(as(ids.cashier, 'cleo_auth_context'), /has been suspended/);
  await assert.rejects(as(ids.cashier, 'cleo_auth_context', [], 'aal2'), /has been suspended/);
  await assert.rejects(as(ids.cashier, 'cleo_bootstrap'), /has been suspended/);
  await assert.rejects(as(ids.cashier, 'cleo_accept_legal', [legalVersion, 'email']), /two-step verification/);
  await assert.rejects(as(ids.cashier, 'cleo_apply_records', ['customers', [{ id: 'c1', name: 'Customer', mobile: '+639123456789' }], []]), /has been suspended/);
  for (const table of ['cleo_businesses', 'cleo_profiles', 'cleo_memberships', 'cleo_records', 'cleo_branches']) {
    assert.equal((await asRole(ids.cashier, () => db.query(`SELECT * FROM public.${table}`))).rows.length, 0, table);
  }
  // other members of the same business are unaffected
  assert.equal((await as(ids.manager, 'cleo_bootstrap')).data.products.length, 1);
  assert.equal((await adm('cleo_admin_set_suspension', [ids.cashier, true, 'Chargeback fraud again'])).changed, false);
  assert.equal(await count('public.cleo_account_suspensions WHERE user_id=$1 AND lifted_at IS NULL', [ids.cashier]), 1);
  const listed = (await adm('cleo_admin_list_accounts', ['', 'suspended', 25, 0])).rows;
  assert.deepEqual(listed.map((r) => [r.id, r.suspended, r.suspendedReason]), [[ids.cashier, true, 'Chargeback fraud']]);
  assert.equal((await adm('cleo_admin_overview')).accounts.suspended, 1);
  assert.equal((await adm('cleo_admin_business', [alpha.business.id])).members.find((m) => m.userId === ids.cashier).suspended, true);

  assert.equal((await adm('cleo_admin_set_suspension', [ids.cashier, false])).changed, true);
  assert.equal((await adm('cleo_admin_set_suspension', [ids.cashier, false])).changed, false);
  assert.equal((await as(ids.cashier, 'cleo_auth_context')).account.role, 'Cashier');
  assert.equal((await as(ids.cashier, 'cleo_bootstrap')).data.products.length, 1);
  assert.equal(await count('public.cleo_account_suspensions WHERE user_id=$1 AND lifted_at IS NOT NULL AND lifted_by=$2', [ids.cashier, admin]), 1);
  const history = (await db.query("SELECT action,admin_email,target_id,detail FROM public.cleo_admin_audit WHERE target_type='account' ORDER BY id")).rows;
  assert.deepEqual(history.map((h) => h.action), ['account.suspend', 'account.restore']);
  assert.deepEqual([history[0].admin_email, history[0].target_id, history[0].detail.email, history[0].detail.reason],
    ['root@example.test', ids.cashier, 'cashier@example.test', 'Chargeback fraud']);
});

await test('an account banned in Supabase Auth is locked out the same way until the ban ends', async () => {
  await db.query("UPDATE auth.users SET banned_until=now()+interval '1 day' WHERE id=$1", [ids.clerk]);
  await assert.rejects(as(ids.clerk, 'cleo_auth_context'), /has been suspended/);
  assert.equal((await asRole(ids.clerk, () => db.query('SELECT * FROM public.cleo_businesses'))).rows.length, 0);
  assert.equal((await adm('cleo_admin_list_accounts', ['clerk@', 'suspended', 25, 0])).rows[0].banned, true);
  await db.query("UPDATE auth.users SET banned_until=now()-interval '1 minute' WHERE id=$1", [ids.clerk]);
  assert.equal((await as(ids.clerk, 'cleo_auth_context')).account.role, 'Stock Clerk');
  await db.query('UPDATE auth.users SET banned_until=NULL WHERE id=$1', [ids.clerk]);
});

await test('membership revoke and restore are audited on both sides and keep one active business per account', async () => {
  await assert.rejects(adm('cleo_admin_set_membership', [ids.manager, alpha.business.id, true, '']), /short reason/);
  await assert.rejects(adm('cleo_admin_set_membership', [ids.manager, randomUUID(), true, 'No such business']), /business no longer exists/);
  await assert.rejects(adm('cleo_admin_set_membership', [ids.facebook, alpha.business.id, true, 'Not a member']), /membership no longer exists/);
  assert.equal((await adm('cleo_admin_set_membership', [ids.manager, alpha.business.id, true, 'Left the company'])).changed, true);
  assert.equal((await adm('cleo_admin_set_membership', [ids.manager, alpha.business.id, true, 'Left the company'])).changed, false);
  await assert.rejects(as(ids.manager, 'cleo_bootstrap'), /role or business access/);
  assert.equal((await as(ids.manager, 'cleo_auth_context')).account.needsBusiness, true);
  await assert.rejects(as(ids.manager, 'cleo_create_business', [{ name: 'Fresh start' }, ['retail'], { name: 'Manager' }]), /access restored/);
  // the business sees that Cleo support changed its team, without the internal reason
  const seen = (await db.query("SELECT actor_id,entity_id,after_value FROM public.cleo_audit_log WHERE action='admin.membership.revoke'")).rows;
  assert.deepEqual(seen.map((r) => [r.actor_id, r.entity_id, r.after_value]), [[admin, ids.manager, { role: 'manager', by: 'Cleo support' }]]);
  assert.equal((await adm('cleo_admin_set_membership', [ids.manager, alpha.business.id, false, 'Rehired'])).changed, true);
  assert.equal((await as(ids.manager, 'cleo_bootstrap')).data.products.length, 1);
  // a revoked member who is now active elsewhere cannot be restored into two businesses
  await adm('cleo_admin_set_membership', [ids.manager, alpha.business.id, true, 'Moved to Beta']);
  await db.query("INSERT INTO public.cleo_memberships(user_id,business_id,branch_id,role) VALUES($1,$2,$3,'manager')", [ids.manager, beta.business.id, beta.branch.id]);
  await assert.rejects(adm('cleo_admin_set_membership', [ids.manager, alpha.business.id, false, 'Back to Alpha']), /already active in another business/);
  assert.equal(await count('public.cleo_memberships WHERE user_id=$1 AND revoked_at IS NULL', [ids.manager]), 1);
  const history = (await db.query("SELECT action,detail FROM public.cleo_admin_audit WHERE target_type='membership' ORDER BY id")).rows;
  assert.deepEqual(history.map((h) => [h.action, h.detail.reason]), [['membership.revoke', 'Left the company'], ['membership.restore', 'Rehired'], ['membership.revoke', 'Moved to Beta']]);
  // an owner's revocation leaves the business without an owner, and the list says so
  await adm('cleo_admin_set_membership', [ids.other, beta.business.id, true, 'Account takeover']);
  assert.equal((await adm('cleo_admin_list_businesses', ['beta', 25, 0])).rows[0].hasOwner, false);
  await db.query('DELETE FROM public.cleo_memberships WHERE user_id=$1 AND business_id=$2', [ids.manager, beta.business.id]);
  await adm('cleo_admin_set_membership', [ids.other, beta.business.id, false, 'Identity confirmed']);
});

await test('audit history cannot be rewritten or removed by any role, including the database owner', async () => {
  for (const table of ['cleo_audit_log', 'cleo_admin_audit']) {
    assert.ok(await count(`public.${table}`) > 0, table);
    for (const sql of [`UPDATE public.${table} SET action='rewritten'`, `DELETE FROM public.${table}`, `TRUNCATE public.${table}`]) {
      await assert.rejects(db.query(sql), /Audit history cannot be changed/, sql);
    }
    await assert.rejects(asRole(ids.owner, () => db.query(`DELETE FROM public.${table}`)), /permission denied/);
  }
});

await test('console sign-ins are recorded, and the admin history is paged newest first', async () => {
  const before = await count('public.cleo_admin_audit');
  assert.deepEqual(await adm('cleo_admin_session_start', [], support), { ok: true, role: 'support' });
  const log = await adm('cleo_admin_audit_log', [3, 0]);
  assert.equal(log.total, before + 1);
  assert.equal(log.rows.length, 3);
  assert.deepEqual([log.rows[0].action, log.rows[0].admin, log.rows[0].targetType], ['session.start', 'support@example.test', 'system']);
  assert.ok(log.rows[0].id > log.rows[1].id && log.rows[1].id > log.rows[2].id);
  assert.equal((await adm('cleo_admin_audit_log', [3, 3])).rows.every((r) => r.id < log.rows[2].id), true);
  await assert.rejects(adm('cleo_admin_audit_log', [1000, 0]), /page options/);
});

await test('a revoked or suspended admin loses the console at once', async () => {
  await db.query('UPDATE public.cleo_platform_admins SET revoked_at=now() WHERE user_id=$1', [support]);
  for (const [name, args] of [...READS, ['cleo_admin_context', []]]) await assert.rejects(adm(name, args, support), /Admin access is required/);
  await db.query('UPDATE public.cleo_platform_admins SET revoked_at=NULL WHERE user_id=$1', [support]);
  assert.equal((await adm('cleo_admin_context', [], support)).role, 'support');
  await db.query("UPDATE auth.users SET banned_until=now()+interval '1 hour' WHERE id=$1", [support]);
  await assert.rejects(adm('cleo_admin_overview', [], support), /Admin access is required/);
  await db.query('UPDATE auth.users SET banned_until=NULL WHERE id=$1', [support]);
  // an admin whose email is no longer confirmed is not an admin
  await db.query('UPDATE auth.users SET email_confirmed_at=NULL WHERE id=$1', [support]);
  await assert.rejects(adm('cleo_admin_overview', [], support), /Admin access is required/);
  await db.query('UPDATE auth.users SET email_confirmed_at=now() WHERE id=$1', [support]);
});

await test('a failing profile insert no longer aborts a Facebook or email sign-up', async () => {
  await db.exec("ALTER TABLE public.cleo_profiles ADD CONSTRAINT test_failure CHECK (display_name <> 'Boom')");
  const id = randomUUID();
  await db.query("INSERT INTO auth.users(id,email,email_confirmed_at,raw_user_meta_data,raw_app_meta_data) VALUES($1,'boom@example.test',now(),'{\"full_name\":\"Boom\"}','{\"provider\":\"facebook\",\"providers\":[\"facebook\"]}')", [id]);
  assert.equal(await count('auth.users WHERE id=$1', [id]), 1);
  assert.equal(await count('public.cleo_profiles WHERE user_id=$1', [id]), 0);
  await db.exec('ALTER TABLE public.cleo_profiles DROP CONSTRAINT test_failure');
  // the first sign-in creates the profile the trigger could not
  const context = await as(id, 'cleo_auth_context');
  assert.deepEqual([context.account.name, context.account.needsBusiness], ['Boom', true]);
  assert.equal(await count('public.cleo_profiles WHERE user_id=$1', [id]), 1);
});

await test('records reject oversized, mistyped and control-character values, and still save valid ones', async () => {
  const apply = (kind, record) => as(ids.owner, 'cleo_apply_records', [kind, [record], []]);
  await assert.rejects(apply('products', { id: 'p1', name: 'Bad', price: 1, sku: 'S'.repeat(81) }), /product detail is too long/);
  await assert.rejects(apply('products', { id: 'p1', name: 'Bad', price: 1, barcode: 4800123 }), /product detail is too long or has the wrong type/);
  await assert.rejects(apply('products', { id: 'p1', name: 'Bad', price: 1, cost: -1 }), /Product cost/);
  await assert.rejects(apply('products', { id: 'p1', name: 'Bad', price: 1, cost: '12' }), /Product cost/);
  await assert.rejects(apply('products', { id: 'p1', name: 'Bad', price: 1, available: 'yes' }), /availability/);
  await assert.rejects(apply('products', { id: 'p1', name: 'Ring\u0007bell', price: 1 }), /characters that cannot be saved/);
  await assert.rejects(apply('products', { id: 'p1', name: 'Big', price: 1, sizes: Array.from({ length: 700 }, (_, i) => ({ name: `Size ${i} ${'x'.repeat(90)}`, price: i })) }), /too large to save/);
  await assert.rejects(apply('categories', { id: 'c1', name: 'Drinks', icon: 'i'.repeat(61) }), /category detail/);
  for (const email of ['not-an-email', 'two@@example.test', 'spa ce@example.test', `${'a'.repeat(250)}@example.test`]) {
    await assert.rejects(apply('customers', { id: 'cu1', name: 'Customer', mobile: '+639171234567', email }), /valid customer email/);
  }
  await assert.rejects(apply('customers', { id: 'cu1', name: 'Customer', mobile: '+639171234567', address: 'A'.repeat(301) }), /customer detail/);
  await assert.rejects(apply('customers', { id: 'cu1', name: 'Customer', mobile: '+639171234567', birthday: 19900101 }), /customer detail/);
  assert.equal(await count("public.cleo_records WHERE id IN ('p1','c1','cu1')"), 0);
  await apply('products', { id: 'p1', name: 'Americano', price: 130, cost: 42.5, sku: 'COFFEE-01', barcode: '4800123456789', cat: 'coffee', available: true, sizes: [{ name: 'Large', price: 150 }] });
  await apply('categories', { id: 'c1', name: 'Drinks', icon: 'coffee' });
  await apply('customers', { id: 'cu1', name: 'Juan dela Cruz', mobile: '+639171234567', email: 'juan@example.test', birthday: '1990-01-01', address: 'Unit 4,\nMakati City', tin: '123-456-789-000' });
  assert.equal(await count("public.cleo_records WHERE id IN ('p1','c1','cu1')"), 3);
});

await test('the security report passes on a clean schema and names a grant that opens something', async () => {
  const report = await adm('cleo_admin_security_report');
  assert.deepEqual(report.checks.map((c) => c.id), ['rls', 'anon_tables', 'browser_writes', 'private_tables', 'anon_functions', 'search_path', 'internal_functions', 'admin_two_step']);
  assert.deepEqual(report.checks.filter((c) => !c.ok), []);
  assert.deepEqual(report.admins.map((a) => [a.email, a.role, a.twoStep]), [['root@example.test', 'superadmin', true], ['support@example.test', 'support', true]]);
  assert.equal(report.advice.owners, 2);
  assert.equal(report.advice.ownersWithoutTwoStep, 2);
  const failing = async (id) => (await adm('cleo_admin_security_report')).checks.find((c) => c.id === id);
  for (const [grant, revoke, id, named] of [
    ['GRANT SELECT ON public.cleo_profiles TO anon', 'REVOKE SELECT ON public.cleo_profiles FROM anon', 'anon_tables', 'cleo_profiles'],
    ['GRANT INSERT ON public.cleo_records TO authenticated', 'REVOKE INSERT ON public.cleo_records FROM authenticated', 'browser_writes', 'cleo_records'],
    ['GRANT SELECT ON public.cleo_platform_admins TO authenticated', 'REVOKE SELECT ON public.cleo_platform_admins FROM authenticated', 'private_tables', 'cleo_platform_admins'],
    ['GRANT EXECUTE ON FUNCTION public.cleo_auth_context() TO anon', 'REVOKE EXECUTE ON FUNCTION public.cleo_auth_context() FROM anon', 'anon_functions', 'cleo_auth_context'],
    ['GRANT EXECUTE ON FUNCTION public.cleo_write_audit(uuid,uuid,text,text,jsonb,jsonb) TO authenticated', 'REVOKE EXECUTE ON FUNCTION public.cleo_write_audit(uuid,uuid,text,text,jsonb,jsonb) FROM authenticated', 'internal_functions', 'cleo_write_audit'],
    ['ALTER TABLE public.cleo_settings DISABLE ROW LEVEL SECURITY', 'ALTER TABLE public.cleo_settings ENABLE ROW LEVEL SECURITY', 'rls', 'cleo_settings'],
    ['ALTER FUNCTION public.cleo_lock_period(date,boolean) RESET search_path', "ALTER FUNCTION public.cleo_lock_period(date,boolean) SET search_path = ''", 'search_path', 'cleo_lock_period'],
  ]) {
    await db.exec(grant);
    const check = await failing(id);
    assert.equal(check.ok, false, grant);
    assert.match(check.detail, new RegExp(named), grant);
    await db.exec(revoke);
    assert.equal((await failing(id)).ok, true, revoke);
  }
  await db.query('DELETE FROM auth.mfa_factors WHERE user_id=$1', [support]);
  assert.match((await failing('admin_two_step')).detail, /support@example\.test/);
  await db.query("INSERT INTO auth.mfa_factors(user_id,status) VALUES($1,'verified')", [support]);
});

await test('reapplying the migration stops before changing anything', async () => {
  const sql = await (await import('node:fs/promises')).readFile(new URL('../migrations/202611140005_platform_admin.sql', import.meta.url), 'utf8');
  await assert.rejects(db.exec(sql), /already been applied/);
  await db.exec('ROLLBACK');
  assert.equal(await count('public.cleo_platform_admins'), 2);
});

await test('every Cleo function still pins search_path and denies anonymous execution', async () => {
  const rows = (await db.query(`SELECT p.proname,p.prosecdef,p.proconfig,has_function_privilege('anon',p.oid,'EXECUTE') AS anon_execute
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname LIKE 'cleo_%'`)).rows;
  assert.ok(rows.length >= 30);
  for (const row of rows) {
    assert.equal(row.prosecdef, true, row.proname);
    assert.deepEqual(row.proconfig, ['search_path=""'], row.proname);
    assert.equal(row.anon_execute, false, row.proname);
  }
});
await db.close();
