import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {database,ids,legalVersion} from './helpers.mjs';
const {db,as,asRole,onboard}=await database();
const owner=ids.owner,other=ids.other;
let business,branch,otherBusiness,otherBranch,secondBranch;
const apply=(kind,upserts=[],archive=[],actor=owner)=>as(actor,'cleo_apply_records',[kind,upserts,archive]);
const post=(kind,qty,cost=null,request=randomUUID(),actor=owner,target=branch,reason='Stock verification')=>
 as(actor,'cleo_post_stock',[target,'beans',kind,qty,cost,reason,request]);
await test('confirmed accounts backfill profiles but unconfirmed/missing-email accounts do not',async()=>{
 const {rows}=await db.query('SELECT user_id,display_name FROM public.cleo_profiles');
 assert.equal(rows.length,6);
 assert.equal(rows.find(x=>x.user_id===ids.facebook).display_name,'Facebook Owner');
 assert.equal((await db.query('SELECT count(*)::int AS n FROM public.cleo_memberships')).rows[0].n,0);
 assert.deepEqual((await db.query('SELECT untouched FROM public.profiles')).rows,[{untouched:'preserve this'}]);
});
await test('new verified Facebook account registers automatically; confirmation registers email once',async()=>{
 const id=randomUUID();
 await db.query("INSERT INTO auth.users VALUES($1,'facebook-new@example.test',now(),'{\"full_name\":\"New FB\",\"role\":\"owner\"}')",[id]);
 assert.equal((await db.query('SELECT display_name FROM public.cleo_profiles WHERE user_id=$1',[id])).rows[0].display_name,'New FB');
 await db.query('UPDATE auth.users SET email_confirmed_at=now() WHERE id=$1',[ids.unconfirmed]);
 await db.query("UPDATE public.cleo_profiles SET display_name='Chosen name' WHERE user_id=$1",[ids.unconfirmed]);
 await db.query('UPDATE auth.users SET email_confirmed_at=now() WHERE id=$1',[ids.unconfirmed]);
 assert.equal((await db.query('SELECT display_name FROM public.cleo_profiles WHERE user_id=$1',[ids.unconfirmed])).rows[0].display_name,'Chosen name');
 await db.query('UPDATE auth.users SET email_confirmed_at=NULL WHERE id=$1',[ids.unconfirmed]);
 const context=await as(id,'cleo_auth_context');assert.equal(context.account.needsBusiness,true);assert.equal(context.account.role,null);
});
await test('unconfirmed and missing-email users cannot accept legal terms or read context',async()=>{
 for(const id of [ids.unconfirmed,ids.missingEmail]){
  await assert.rejects(as(id,'cleo_accept_legal',[legalVersion,'facebook']),/verified email/);
  await assert.rejects(as(id,'cleo_auth_context'),/verified email/);
 }
});
await test('business onboarding and legal consent prepare isolated tenants',async()=>{
 const c=await onboard(owner,'Owner shop');business=c.business.id;branch=c.branch.id;
 const o=await onboard(other,'Other shop');otherBusiness=o.business.id;otherBranch=o.branch.id;
 secondBranch=randomUUID();
 await db.query("INSERT INTO public.cleo_branches(id,business_id,code,name) VALUES($1,$2,'SECOND','Second branch')",[secondBranch,business]);
 for(const [id,role] of [[ids.manager,'manager'],[ids.cashier,'cashier'],[ids.clerk,'clerk']]){
  await db.query('INSERT INTO public.cleo_memberships(user_id,business_id,branch_id,role) VALUES($1,$2,$3,$4)',[id,business,branch,role]);
  await as(id,'cleo_accept_legal',[legalVersion,'email']);
 }
});
await test('catalog creation returns server versions and stale/forged writes fail',async()=>{
 const rows=await apply('products',[{id:'latte',name:'Latte',price:160,sku:'LATTE'}]);
 assert.equal(rows[0]._version,1);
 await assert.rejects(apply('products',[{id:'latte',_version:0,price:1}]),/Record changed/);
 await assert.rejects(apply('products',[{id:'forged',name:'Invalid',price:1,business_id:otherBusiness}]),/server-owned/);
 await assert.rejects(apply('products',[{id:'bad',name:'Invalid',price:-1}]),/price/);
 await assert.rejects(apply('products',[{id:'bad',name:'Invalid',price:1.001}]),/price/);
 await assert.rejects(apply('products',[{id:'bad',name:'Invalid',price:1}],[],ids.cashier),/role/);
});
await test('multi-record catalog save is atomic; tenant SKU uniqueness is enforced',async()=>{
 await assert.rejects(apply('products',[{id:'new',name:'New',price:20},{id:'invalid',name:'',price:20}]),/name/);
 assert.equal((await as(owner,'cleo_bootstrap')).data.products.length,1);
 await assert.rejects(apply('products',[{id:'duplicate',name:'Dup',price:20,sku:'latte'}]),/duplicate/);
 await apply('products',[{id:'other-latte',name:'Other latte',price:30,sku:'LATTE'}],[],other);
 assert.equal((await as(owner,'cleo_bootstrap')).data.products.length,1);
});
await test('stock item master data cannot manufacture quantities or costs',async()=>{
 await assert.rejects(apply('ingredients',[{id:'beans',name:'Beans',unit:'kg',oh:{[branch]:999}}]),/server-owned/);
 await apply('ingredients',[{id:'beans',name:'Beans',unit:'kg',rp:3}]);
 assert.equal((await as(owner,'cleo_bootstrap')).data.ingredients[0].cost,0);
});
await test('recipe references require active tenant ingredients and block ingredient archive',async()=>{
 await apply('products',[{id:'latte',_version:1,recipe:[['beans',0.02]]}]);
 await assert.rejects(apply('products',[{id:'invalid',name:'Invalid',price:1,recipe:[['absent',1]]}]),/active stock item/);
 await assert.rejects(apply('ingredients',[],[{id:'beans',_version:1}]),/recipe/);
});
await test('receipt updates stock and weighted average cost by branch',async()=>{
 assert.equal((await post('receive',10,100)).quantity,10);
 const r=await post('receive',10,200);assert.equal(r.quantity,20);assert.equal(r.unitCost,150);
 assert.equal((await post('receive',5,75,randomUUID(),owner,secondBranch)).unitCost,75);
 const boot=await as(owner,'cleo_bootstrap');const item=boot.data.ingredients[0];
 assert.equal(item.oh[branch],20);assert.equal(item.oh[secondBranch],5);assert.equal(item._branchCosts[branch],150);
});
await test('movement retries return the original result without a duplicate movement',async()=>{
 const key=randomUUID();const first=await post('receive',2,120,key);
 const retry=await post('receive',2,120,key);assert.deepEqual(retry,first);
 await assert.rejects(post('receive',3,120,key),/Request id/);
 assert.equal((await db.query('SELECT count(*)::int AS n FROM public.cleo_stock_movements WHERE request_id=$1',[key])).rows[0].n,1);
});
await test('stock rejects invalid quantities, injected costs and cross-branch access',async()=>{
 for(const [kind,qty,cost] of [['receive',-2,10],['receive',1,-10],['adjust',0,null],['adjust',1,10],['count',-1,null],['receive',0.0000001,10]]){
  await assert.rejects(post(kind,qty,cost),/quantity|movement/);
 }
 await assert.rejects(post('receive',1,1,randomUUID(),ids.clerk,secondBranch),/access/);
 await assert.rejects(post('receive',1,1,randomUUID(),other,branch),/access/);
 await assert.rejects(post('receive',1,1,randomUUID(),ids.cashier),/role/);
});
await test('stock counts compute variance on the server and enforce approval thresholds',async()=>{
 await assert.rejects(post('count',0,null,randomUUID(),ids.clerk),/approval/);
 const count=await post('count',20);assert.equal(count.quantity,20);
 const adjust=await post('adjust',-1);assert.equal(adjust.quantity,19);
 await assert.rejects(apply('ingredients',[{id:'beans',_version:1,unit:'g'}]),/units cannot change/);
});
await test('settings allowlist, expected versions and business-name consistency',async()=>{
 const setting=await as(owner,'cleo_save_setting',['business.name','Renamed shop',0]);assert.equal(setting.version,1);
 assert.equal((await as(owner,'cleo_auth_context')).business.name,'Renamed shop');
 await assert.rejects(as(owner,'cleo_save_setting',['limits.adjustApproval',10,0]),/Settings changed/);
 await assert.rejects(as(owner,'cleo_save_setting',['roles.cashier',['owner'],1]),/Unsupported/);
 await assert.rejects(as(owner,'cleo_save_setting',['business.tin','bad tin',1]),/Invalid/);
 await assert.rejects(as(ids.cashier,'cleo_save_setting',['business.name','Stolen',1]),/role/);
 assert.equal((await as(owner,'cleo_bootstrap')).settingsVersion,1);
 await as(other,'cleo_save_setting',['limits.adjustApproval',50,0]);
 assert.equal((await as(other,'cleo_bootstrap')).config.business.name,'Other shop');
 await as(owner,'cleo_save_setting',['business.legal','Registered shop',1]);
 assert.equal((await as(owner,'cleo_bootstrap')).data.biz.legal,'Registered shop');
});
await test('locked Manila accounting month rejects new stock writes but permits retrying prior writes',async()=>{
 const key=randomUUID();const first=await post('receive',1,100,key);
 const month=(await db.query("SELECT date_trunc('month',now() AT TIME ZONE 'Asia/Manila')::date::text AS month")).rows[0].month;
 await as(owner,'cleo_lock_period',[month,true]);
 await assert.rejects(post('receive',1,100),/period is locked/);
 assert.deepEqual(await post('receive',1,100,key),first);
 await assert.rejects(as(ids.manager,'cleo_lock_period',[month,false]),/role/);
 await as(owner,'cleo_lock_period',[month,false]);await post('receive',1,100);
});
await test('customers cannot forge charge balances or points, and erasure leaves no personal audit copy',async()=>{
 await assert.rejects(apply('customers',[{id:'customer',name:'Customer',mobile:'+639123456789',points:10000}]),/server-owned/);
 await apply('customers',[{id:'customer',name:'Customer',mobile:'+639123456789'}]);
 await assert.rejects(apply('customers',[{id:'dup',name:'Duplicate',mobile:'+639123456789'}]),/duplicate/);
 assert.equal((await as(ids.clerk,'cleo_bootstrap')).collections.customers.length,0);
 assert.equal((await asRole(ids.clerk,()=>db.query("SELECT * FROM public.cleo_records WHERE kind='customers'"))).rows.length,0);
 await apply('customers',[],[{id:'customer',_version:1}]);
 const rows=(await db.query("SELECT before_value,after_value FROM public.cleo_audit_log WHERE action LIKE 'customers.%'" )).rows;
 assert.ok(rows.every(x=>x.before_value===null&&x.after_value===null));
});
await test('RLS separates tenants and scopes stock balances to the assigned branch',async()=>{
 assert.equal((await asRole(other,()=>db.query('SELECT * FROM public.cleo_stock_movements'))).rows.length,0);
 const balances=(await asRole(ids.clerk,()=>db.query('SELECT branch_id FROM public.cleo_stock_balances'))).rows;
 assert.ok(balances.length>0&&balances.every(x=>x.branch_id===branch));
 assert.deepEqual((await as(other,'cleo_bootstrap')).data.products.map(x=>x.id),['other-latte']);
});
await test('browser roles cannot write tables, forge audit events, invoke internal helpers or use anon RPCs',async()=>{
 for(const table of ['cleo_records','cleo_settings','cleo_stock_balances','cleo_stock_movements','cleo_audit_log','cleo_period_locks']){
  await assert.rejects(asRole(owner,()=>db.query(`DELETE FROM public.${table}`)),/permission denied/);
 }
 await assert.rejects(as(owner,'cleo_write_audit',[business,null,'forged','x',null,null]),/permission denied/);
 await assert.rejects(as(owner,'cleo_require_actor',[['owner'],null]),/permission denied/);
 await assert.rejects(asRole(null,()=>db.query("SELECT public.cleo_apply_records('products')"),'anon'),/permission denied/);
});
await test('MFA and revoked memberships reject operational APIs and RLS reads',async()=>{
 await db.query("INSERT INTO auth.mfa_factors(user_id,status) VALUES($1,'verified')",[owner]);
 await assert.rejects(apply('products',[{id:'nope',name:'Nope',price:1}]),/two-step/);
 assert.equal((await asRole(owner,()=>db.query('SELECT * FROM public.cleo_records'))).rows.length,0);
 assert.equal((await as(owner,'cleo_bootstrap',[],'aal2')).data.products.length,1);
 await db.query('UPDATE public.cleo_memberships SET revoked_at=now() WHERE user_id=$1',[other]);
 await assert.rejects(as(other,'cleo_bootstrap'),/access/);
 assert.equal((await asRole(other,()=>db.query('SELECT * FROM public.cleo_records'))).rows.length,0);
});
await test('all Cleo functions pin search_path and deny anonymous execution',async()=>{
 const rows=(await db.query(`SELECT p.proname,p.proconfig,has_function_privilege('anon',p.oid,'EXECUTE') AS anon_execute
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname LIKE 'cleo_%'`)).rows;
 for(const row of rows){assert.deepEqual(row.proconfig,['search_path=""']);assert.equal(row.anon_execute,false);}
});
await db.close();
