const { PGlite } = await import(process.env.CLEO_PGLITE_MODULE || '@electric-sql/pglite');
import fs from 'node:fs';
import assert from 'node:assert/strict';

const migrationPath = '../migrations/202610170001_auth_onboarding.sql';
const migration = fs.readFileSync(new URL(migrationPath, import.meta.url), 'utf8');
const db = new PGlite();
const alice = '11111111-1111-4111-8111-111111111111';
const bob = '22222222-2222-4222-8222-222222222222';
const unconfirmed = '33333333-3333-4333-8333-333333333333';
const legalVersion = 'privacy 1.0, terms 1.0';
const passed = [];
async function check(name, fn) {
  await fn();
  passed.push(name);
  console.log(`PASS ${name}`);
}
async function asRole(role, id, fn, aal = 'aal1') {
  await db.exec(`BEGIN; SET LOCAL ROLE ${role};`);
  try {
    await db.query(`SELECT set_config('request.jwt.claim.sub', $1, true),
      set_config('request.jwt.claims', $2, true)`, [id || '', JSON.stringify({ sub: id, aal })]);
    const result = await fn();
    await db.exec('COMMIT;');
    return result;
  } catch (error) {
    await db.exec('ROLLBACK;');
    throw error;
  }
}
const rpc = (name, params = []) => db.query(`SELECT public.${name}(${params.map((_, i) => `$${i + 1}`).join(',')}) AS result`, params)
  .then(r => r.rows[0].result);

await db.exec(`
  CREATE ROLE anon;
  CREATE ROLE authenticated;
  CREATE SCHEMA auth;
  GRANT USAGE ON SCHEMA auth TO anon, authenticated;
  CREATE TABLE auth.users(id uuid PRIMARY KEY, email text, email_confirmed_at timestamptz, raw_user_meta_data jsonb);
  CREATE TABLE auth.mfa_factors(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, status text);
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
    SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
  $$;
  CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$
    SELECT coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb;
  $$;
  -- Existing unrelated application objects must survive the migration.
  CREATE TABLE public.profiles(id uuid PRIMARY KEY, untouched text);
  INSERT INTO public.profiles VALUES ('${alice}', 'preserve this');
  INSERT INTO auth.users VALUES
    ('${alice}', 'alice@example.test', now(), '{"name":"Alice Owner", "role":"owner"}'),
    ('${bob}', 'bob@example.test', now(), '{"name":"Bob Owner", "role":"owner"}'),
    ('${unconfirmed}', 'unconfirmed@example.test', NULL, '{"name":"Unconfirmed"}');
`);

await check('migration compiles and applies in PostgreSQL', async () => db.exec(migration));
await check('reserved object rerun stops atomically and preserves unrelated profiles', async () => {
  await assert.rejects(db.exec(migration), /existing objects require review/);
  await db.exec('ROLLBACK;');
  const { rows } = await db.query('SELECT untouched FROM public.profiles');
  assert.equal(rows[0].untouched, 'preserve this');
});
await check('anonymous RPC and table access denied', async () => {
  await assert.rejects(asRole('anon', null, () => rpc('cleo_auth_context')), /permission denied/);
  await assert.rejects(asRole('anon', null, () => db.query('SELECT * FROM public.cleo_businesses')), /permission denied/);
});
await check('missing authenticated UUID denied', async () => {
  await assert.rejects(asRole('authenticated', null, () => rpc('cleo_auth_context')), /Sign in to continue/);
});
await check('unconfirmed email account denied', async () => {
  await assert.rejects(asRole('authenticated', unconfirmed, () => rpc('cleo_auth_context')), /verified email/);
});
await check('new account has no metadata-derived owner role or business', async () => {
  const c = await asRole('authenticated', alice, () => rpc('cleo_auth_context'));
  assert.equal(c.account.needsBusiness, true);
  assert.equal(c.account.role, null);
  assert.equal(c.account.name, 'Alice Owner');
  assert.equal(c.business, null);
});
await check('client identity and role fields rejected', async () => {
  await assert.rejects(asRole('authenticated', alice, () => rpc('cleo_create_business', [
    { name: 'Alice Store' }, ['retail'], { name: 'Alice Owner', role: 'owner', user_id: bob }
  ])), /Check the business and owner names/);
});
await check('invalid module and duplicate module inputs rejected', async () => {
  for (const modules of [['admin'], ['retail','retail'], [], [null]]) {
    await assert.rejects(asRole('authenticated', alice, () => rpc('cleo_create_business', [
      { name: 'Alice Store' }, modules, { name: 'Alice Owner' }
    ])), /Choose/);
  }
});
let aliceContext;
await check('business, branch, owner membership created atomically', async () => {
  aliceContext = await asRole('authenticated', alice, () => rpc('cleo_create_business', [
    { name: 'Alice Store' }, ['retail'], { name: 'Alice Owner' }
  ]));
  assert.equal(aliceContext.account.role, 'Owner');
  assert.equal(aliceContext.account.needsBusiness, false);
  assert.equal(aliceContext.business.name, 'Alice Store');
  assert.equal(aliceContext.branch.name, 'Main branch');
  const count = await db.query(`SELECT
    (SELECT count(*)::int FROM public.cleo_businesses) AS businesses,
    (SELECT count(*)::int FROM public.cleo_branches) AS branches,
    (SELECT count(*)::int FROM public.cleo_memberships WHERE user_id=$1 AND role='owner') AS owners`, [alice]);
  assert.deepEqual(count.rows[0], { businesses: 1, branches: 1, owners: 1 });
});
await check('onboarding retry preserves original business without duplicates', async () => {
  const retry = await asRole('authenticated', alice, () => rpc('cleo_create_business', [
    { name: 'Different Store' }, ['fnb'], { name: 'Changed Owner' }
  ]));
  assert.equal(retry.business.id, aliceContext.business.id);
  assert.equal(retry.business.name, 'Alice Store');
  assert.equal((await db.query('SELECT count(*)::int AS n FROM public.cleo_businesses')).rows[0].n, 1);
});
await check('bootstrap requires current legal acceptance', async () => {
  await assert.rejects(asRole('authenticated', alice, () => rpc('cleo_bootstrap')), /Accept the current/);
  await assert.rejects(asRole('authenticated', alice, () => rpc('cleo_accept_legal', ['terms 1.0, privacy 1.0', 'email'])), /current Terms/);
});
await check('legal version matches build and retry retains server timestamp', async () => {
  const build = fs.readFileSync(new URL('../../Frontend/source/build.js', import.meta.url), 'utf8');
  assert.match(build, /const LEGAL = \['privacy', 'terms'\]/);
  const first = await asRole('authenticated', alice, () => rpc('cleo_accept_legal', [legalVersion, 'google']));
  const retry = await asRole('authenticated', alice, () => rpc('cleo_accept_legal', [legalVersion, 'oauth']));
  assert.equal(first.at, retry.at);
  assert.equal(first.version, legalVersion);
  assert.equal((await db.query('SELECT method FROM public.cleo_legal_acceptances WHERE user_id=$1', [alice])).rows[0].method, 'google');
});
await check('bootstrap returns real identity and empty catalog with no invented subscription', async () => {
  const boot = await asRole('authenticated', alice, () => rpc('cleo_bootstrap'));
  assert.equal(boot.data.biz.name, 'Alice Store');
  assert.equal(boot.data.branches.length, 1);
  assert.equal(boot.data.branches[0].id, aliceContext.branch.id);
  assert.deepEqual(boot.data.products, []);
  assert.deepEqual(boot.data.categories, []);
  assert.equal(boot.collections.users[0].id, alice);
  assert.equal(boot.collections.users[0].roles.all, 'owner');
  assert.equal(boot.config.modules.retail, true);
  assert.equal(boot.config.modules.fnb, false);
  assert.equal(boot.plan, null);
  assert.equal(boot.subscription, null);
});
await check('second account sees no first tenant rows and resolves own tenant', async () => {
  assert.equal((await asRole('authenticated', bob, () => db.query('SELECT * FROM public.cleo_businesses'))).rows.length, 0);
  assert.equal((await asRole('authenticated', bob, () => db.query('SELECT * FROM public.cleo_profiles WHERE user_id=$1', [alice]))).rows.length, 0);
  const c = await asRole('authenticated', bob, () => rpc('cleo_create_business', [
    { name: 'Bob Store' }, ['fnb','svc'], { name: 'Bob Owner' }
  ]));
  assert.notEqual(c.business.id, aliceContext.business.id);
  const visible = await asRole('authenticated', bob, () => db.query('SELECT name FROM public.cleo_businesses'));
  assert.deepEqual(visible.rows, [{ name: 'Bob Store' }]);
});
await check('browser direct inserts, updates and membership changes denied', async () => {
  await assert.rejects(asRole('authenticated', bob, () => db.query("UPDATE public.cleo_memberships SET role='owner'")), /permission denied/);
  await assert.rejects(asRole('authenticated', bob, () => db.query("UPDATE public.cleo_businesses SET name='stolen'")), /permission denied/);
  await assert.rejects(asRole('authenticated', bob, () => db.query("INSERT INTO public.cleo_profiles(user_id) VALUES ($1)", [alice])), /permission denied/);
});
await check('MFA enrollment blocks AAL1 RPC and table access while context allows challenge', async () => {
  await db.query("INSERT INTO auth.mfa_factors(user_id,status) VALUES ($1,'verified')", [alice]);
  const c = await asRole('authenticated', alice, () => rpc('cleo_auth_context'));
  assert.equal(c.needsMfa, true);
  assert.equal(c.business, null);
  assert.equal(c.account.role, null);
  for (const name of ['cleo_bootstrap', 'cleo_create_business', 'cleo_accept_legal']) {
    const args = name === 'cleo_create_business' ? [{ name:'Store' }, ['retail'], {name:'Alice'}]
      : name === 'cleo_accept_legal' ? [legalVersion, 'email'] : [];
    await assert.rejects(asRole('authenticated', alice, () => rpc(name, args)), /two-step verification/);
  }
  assert.equal((await asRole('authenticated', alice, () => db.query('SELECT * FROM public.cleo_businesses'))).rows.length, 0);
});
await check('AAL2 session permits enrolled MFA tenant access', async () => {
  const boot = await asRole('authenticated', alice, () => rpc('cleo_bootstrap'), 'aal2');
  assert.equal(boot.data.biz.name, 'Alice Store');
  assert.equal((await asRole('authenticated', alice, () => db.query('SELECT * FROM public.cleo_businesses'), 'aal2')).rows.length, 1);
});
await check('revoked membership blocks bootstrap and cannot self-onboard past revocation', async () => {
  await db.query('UPDATE public.cleo_memberships SET revoked_at=now() WHERE user_id=$1', [bob]);
  await assert.rejects(asRole('authenticated', bob, () => rpc('cleo_bootstrap')), /Finish setting up/);
  await assert.rejects(asRole('authenticated', bob, () => rpc('cleo_create_business', [
    {name:'Fresh Store'}, ['retail'], {name:'Bob'}
  ])), /access restored/);
  assert.equal((await asRole('authenticated', bob, () => db.query('SELECT * FROM public.cleo_businesses'))).rows.length, 0);
});
await check('every exposed function pins search_path and removes anonymous execution', async () => {
  const {rows} = await db.query(`SELECT p.proname, p.prosecdef, p.proconfig,
    has_function_privilege('anon',p.oid,'EXECUTE') AS anon_execute,
    has_function_privilege('authenticated',p.oid,'EXECUTE') AS auth_execute
    FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname LIKE 'cleo_%'`);
  assert.equal(rows.length, 5);
  for (const row of rows) {
    assert.equal(row.prosecdef, true);
    assert.deepEqual(row.proconfig, ['search_path=""']);
    assert.equal(row.anon_execute, false);
    assert.equal(row.auth_execute, true);
  }
});

await db.close();
console.log(`\n${passed.length} PostgreSQL migration/security checks passed.`);
fs.writeFileSync(new URL('./results.json', import.meta.url), JSON.stringify({ passed: passed.length, checks: passed, database: 'PGlite 0.5.10 (PostgreSQL WASM); mocked auth.users/mfa_factors and request JWT settings', runAt: new Date().toISOString() }, null, 2));

