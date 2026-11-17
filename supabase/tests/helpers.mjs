const { PGlite } = await import(process.env.CLEO_PGLITE_MODULE || '@electric-sql/pglite');
import fs from 'node:fs/promises';
export const ids = { owner:'11111111-1111-4111-8111-111111111111', other:'22222222-2222-4222-8222-222222222222',
  unconfirmed:'33333333-3333-4333-8333-333333333333', manager:'44444444-4444-4444-8444-444444444444',
  cashier:'55555555-5555-4555-8555-555555555555', clerk:'66666666-6666-4666-8666-666666666666',
  facebook:'77777777-7777-4777-8777-777777777777', missingEmail:'88888888-8888-4888-8888-888888888888' };
export const legalVersion='privacy 1.0, terms 1.0';
export async function database() {
 const db=new PGlite();
 await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE SCHEMA auth;
 GRANT USAGE ON SCHEMA auth TO anon,authenticated,service_role;
 CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb,
  raw_app_meta_data jsonb DEFAULT '{"provider":"email","providers":["email"]}',created_at timestamptz DEFAULT now(),
  last_sign_in_at timestamptz,banned_until timestamptz);
 CREATE TABLE auth.mfa_factors(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid,status text);
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
   SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid; $$;
 CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$
   SELECT coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb; $$;
 CREATE TABLE public.profiles(id uuid PRIMARY KEY,untouched text);
 INSERT INTO public.profiles VALUES('${ids.owner}','preserve this');`);
 for (const [name,id] of Object.entries(ids)) {
  await db.query('INSERT INTO auth.users VALUES ($1,$2,$3,$4)',[id,name==='missingEmail'?null:`${name}@example.test`,
   name==='unconfirmed'?null:new Date().toISOString(),{name:name==='facebook'?'   ':name,full_name:name==='facebook'?'Facebook Owner':name,role:'owner'}]);
 }
 await db.query("UPDATE auth.users SET raw_app_meta_data='{\"provider\":\"facebook\",\"providers\":[\"facebook\"]}' WHERE id=$1",[ids.facebook]);
 const files=['202610170001_auth_onboarding.sql','202610170002_verified_profiles.sql','202610170003_operations.sql','202610170004_transfers.sql','202611140005_platform_admin.sql','202611150006_billing.sql','202611170007_admin_controls.sql','202611180008_plans_branches_staff.sql'];
 for (const f of files) await db.exec(await fs.readFile(new URL('../migrations/'+f,import.meta.url),'utf8'));
 const rpc=async(name,args=[])=> (await db.query(`SELECT public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) AS result`,args.map((x,i)=>name==='cleo_save_setting'&&i===1?JSON.stringify(x):x))).rows[0].result;
 const asRole=async(id,fn,role='authenticated',aal='aal1')=>{
  await db.exec(`BEGIN; SET LOCAL ROLE ${role};`);
  try {
   await db.query("SELECT set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claims',$2,true)",[id||'',JSON.stringify({sub:id,aal})]);
   const result=await fn(); await db.exec('COMMIT'); return result;
  } catch(e){await db.exec('ROLLBACK');throw e;}
 };
 const as=(id,name,args=[],aal='aal1')=>asRole(id,()=>rpc(name,args),'authenticated',aal);
 // a plan for a test business, written as Aeso's own maintenance would (no signed-in account)
 const subscribe=(business,plan,{terminals=plan==='free'?1:10,branches=plan==='max'?5:1,ended=false}={})=>db.query(
  `INSERT INTO public.cleo_subscriptions(business_id,plan,terminals,branches,cycle,total_centavos,current_period_end)
   VALUES($1,$2,$3,$4,'monthly',0,CASE WHEN $5 THEN now()-interval '4 days' WHEN $2::text='free' THEN NULL ELSE now()+interval '30 days' END)
   ON CONFLICT (business_id) DO UPDATE SET plan=EXCLUDED.plan,terminals=EXCLUDED.terminals,branches=EXCLUDED.branches,
    current_period_end=EXCLUDED.current_period_end`,[business,plan,terminals,branches,ended]);
 const onboard=async(id,name,plan)=>{
  await as(id,'cleo_accept_legal',[legalVersion,'email']);
  const created=await as(id,'cleo_create_business',[{name},['retail','fnb'],{name}]);
  if(plan) await subscribe(created.business.id,plan);
  return created;
 };
 const asService=async(name,args=[])=>{
  await db.exec('BEGIN; SET LOCAL ROLE service_role;');
  try { await db.query("SELECT set_config('request.jwt.claim.sub','',true),set_config('request.jwt.claims',$1,true)",[JSON.stringify({role:'service_role'})]);
   const result=await rpc(name,args); await db.exec('COMMIT'); return result;
  } catch(e){await db.exec('ROLLBACK');throw e;}
 };
 return {db,rpc,asRole,as,asService,onboard,subscribe};
}
