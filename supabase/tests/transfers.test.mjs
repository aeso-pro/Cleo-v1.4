import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {database,ids,legalVersion} from './helpers.mjs';
const {db,as,asRole,onboard}=await database();
const c=await onboard(ids.owner,'Sender');const business=c.business.id,source=c.branch.id,target=randomUUID();
const other=await onboard(ids.other,'Other tenant');
await db.query("INSERT INTO public.cleo_branches(id,business_id,code,name) VALUES($1,$2,'TGT','Target')",[target,business]);
for(const [id,role,branch] of [[ids.manager,'manager',source],[ids.clerk,'clerk',target]]){
 await db.query('INSERT INTO public.cleo_memberships(user_id,business_id,branch_id,role) VALUES($1,$2,$3,$4)',[id,business,branch,role]);
 await as(id,'cleo_accept_legal',[legalVersion,'email']);
}
await as(ids.owner,'cleo_apply_records',['ingredients',[{id:'beans',name:'Beans',unit:'kg'}],[]]);
await as(ids.owner,'cleo_post_stock',[source,'beans','receive',20,100,'Opening stock',randomUUID()]);
await as(ids.owner,'cleo_post_stock',[target,'beans','receive',10,200,'Opening stock',randomUUID()]);
const create=(qty=5,key=randomUUID(),actor=ids.owner,from=source,to=target,item='beans')=>as(actor,'cleo_create_transfer',[from,to,item,qty,key]);
const advance=(t,action,key=randomUUID(),actor=ids.owner,received=null)=>as(actor,'cleo_advance_transfer',[t.id,action,t.version,key,received]);
const balances=async()=>Object.fromEntries((await db.query("SELECT branch_id,quantity::float AS quantity,unit_cost::float AS cost FROM public.cleo_stock_balances WHERE business_id=$1 AND item_id='beans'",[business])).rows.map(x=>[x.branch_id,x]));
let transfer;
await test('transfer request is tenant-scoped, validated and idempotent',async()=>{
 const key=randomUUID();const first=await create(5,key);transfer=first.transfer;
 assert.deepEqual(await create(5,key),first);assert.equal(transfer.status,'requested');
 await assert.rejects(create(6,key),/Request id/);
 await assert.rejects(create(-1),/positive quantity/);
 await assert.rejects(create(1,randomUUID(),ids.owner,source,source),/different branches/);
 await assert.rejects(create(1,randomUUID(),ids.owner,source,other.branch.id),/access/);
 await assert.rejects(create(1,randomUUID(),ids.other),/access/);
});
await test('transfer cannot dispatch before approval or be approved by a clerk',async()=>{
 await assert.rejects(advance(transfer,'dispatch'),/state transition/);
 await assert.rejects(advance(transfer,'approve',randomUUID(),ids.clerk),/role or branch/);
 transfer=(await advance(transfer,'approve',randomUUID(),ids.manager)).transfer;
 assert.equal(transfer.status,'approved');
});
await test('dispatch deducts stock once at the source weighted cost and refuses stale versions',async()=>{
 await assert.rejects(advance({...transfer,version:1},'dispatch'),/Transfer changed/);
 const key=randomUUID(),before=transfer;const first=await advance(transfer,'dispatch',key);
 assert.deepEqual(await advance(before,'dispatch',key),first);
 transfer=first.transfer;
 assert.equal(transfer.unit_cost,100);
 assert.equal((await balances())[source].quantity,15);assert.equal((await balances())[target].quantity,10);
 await assert.rejects(advance(transfer,'reject'),/state transition/);
});
await test('only the receiving branch can receive, with weighted-average destination cost',async()=>{
 await assert.rejects(advance(transfer,'receive',randomUUID(),ids.manager),/role or branch/);
 const key=randomUUID(),before=transfer;const result=await advance(transfer,'receive',key,ids.clerk);
 assert.deepEqual(await advance(before,'receive',key,ids.clerk),result);transfer=result.transfer;
 const rows=await balances();assert.equal(rows[target].quantity,15);assert.equal(rows[target].cost,166.666667);
 assert.equal((await db.query("SELECT count(*)::int AS n FROM public.cleo_stock_movements WHERE kind IN('transfer_in','transfer_out')")).rows[0].n,2);
});
await test('oversized dispatch fails atomically without changing inventory or state',async()=>{
 const t=(await create(1000)).transfer;const approved=(await advance(t,'approve')).transfer;
 const before=await balances();await assert.rejects(advance(approved,'dispatch'),/Insufficient stock/);
 assert.deepEqual(await balances(),before);
 assert.equal((await db.query('SELECT status FROM public.cleo_transfers WHERE id=$1',[t.id])).rows[0].status,'approved');
});
await test('short receiving requires a manager and records the actual quantity and shortage',async()=>{
 let t=(await create(2)).transfer;t=(await advance(t,'approve')).transfer;t=(await advance(t,'dispatch')).transfer;
 await assert.rejects(advance(t,'receive',randomUUID(),ids.clerk,1),/manager/);
 const before=(await balances())[target].quantity;
 t=(await advance(t,'receive',randomUUID(),ids.owner,1)).transfer;
 assert.equal(t.received_quantity,1);assert.equal((await balances())[target].quantity,before+1);
});
await test('item with zero stock cannot be archived while a transfer is open',async()=>{
 await as(ids.owner,'cleo_apply_records',['ingredients',[{id:'empty',name:'Empty item',unit:'pc'}],[]]);
 const t=(await create(1,randomUUID(),ids.owner,source,target,'empty')).transfer;
 await assert.rejects(as(ids.owner,'cleo_apply_records',['ingredients',[],[{id:'empty',_version:1}]]),/open transfer/);
 await advance(t,'reject');
 await as(ids.owner,'cleo_apply_records',['ingredients',[],[{id:'empty',_version:1}]]);
});
await test('period lock blocks dispatch and receiving, and tables cannot be altered directly',async()=>{
 let t=(await create(1)).transfer;t=(await advance(t,'approve')).transfer;
 const month=(await db.query("SELECT date_trunc('month',now() AT TIME ZONE 'Asia/Manila')::date::text AS month")).rows[0].month;
 await as(ids.owner,'cleo_lock_period',[month,true]);await assert.rejects(advance(t,'dispatch'),/period is locked/);
 await as(ids.owner,'cleo_lock_period',[month,false]);t=(await advance(t,'dispatch')).transfer;
 await as(ids.owner,'cleo_lock_period',[month,true]);await assert.rejects(advance(t,'receive'),/period is locked/);
 await as(ids.owner,'cleo_lock_period',[month,false]);
 for(const table of ['cleo_transfers','cleo_transfer_requests']){
  await assert.rejects(asRole(ids.owner,()=>db.query(`DELETE FROM public.${table}`)),/permission denied/);
 }
 assert.equal((await asRole(ids.other,()=>db.query('SELECT * FROM public.cleo_transfers'))).rows.length,0);
 await assert.rejects(asRole(ids.clerk,()=>db.query('SELECT * FROM public.cleo_transfer_requests')),/permission denied/);
});
await db.close();
