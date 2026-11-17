import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {database,ids,legalVersion} from './helpers.mjs';
const {db,as,asRole,onboard,subscribe}=await database();

// each test business gets its own owner account (an account has one business)
async function owner(name,plan){
 const id=randomUUID();
 await db.query("INSERT INTO auth.users(id,email,email_confirmed_at,raw_user_meta_data) VALUES($1,$2,now(),$3)",[id,`${id.slice(0,8)}@example.test`,{full_name:name}]);
 const c=await onboard(id,name,plan);
 return {id,business:c.business.id,branch:c.branch.id};
}
const products=(n,prefix='p')=>Array.from({length:n},(_,i)=>({id:`${prefix}${i}`,name:`Item ${i}`,price:10}));

await test('a business with no plan reads its data but changes nothing',async()=>{
 const o=await owner('No plan yet');
 await assert.rejects(as(o.id,'cleo_apply_records',['products',[{id:'a',name:'A',price:1}],[]]),/Choose a plan/);
 await assert.rejects(as(o.id,'cleo_add_branch',['Second']),/Choose a plan/);
 await assert.rejects(as(o.id,'cleo_add_staff',[o.branch,'Ana','cashier','2468']),/Choose a plan/);
 await assert.rejects(as(o.id,'cleo_register_terminal',[o.branch,1]),/Choose a plan/);
 const snap=await as(o.id,'cleo_bootstrap');
 assert.equal(snap.entitlement,null);assert.equal(snap.businessId,o.business);
 // a plan whose paid period ended more than 3 days ago counts as none
 await subscribe(o.business,'pro',{ended:true});
 await assert.rejects(as(o.id,'cleo_apply_records',['products',[{id:'a',name:'A',price:1}],[]]),/Choose a plan/);
});

await test('Free: 100 products, one branch, one terminal, one cashier, no stock or customers',async()=>{
 const o=await owner('Free shop','free');
 await as(o.id,'cleo_apply_records',['products',products(100),[]]);
 await assert.rejects(as(o.id,'cleo_apply_records',['products',[{id:'extra',name:'One more',price:5}],[]]),/up to 100 products/);
 // changing one of the 100 is still fine
 await as(o.id,'cleo_apply_records',['products',[{id:'p1',_version:1,price:12}],[]]);
 await assert.rejects(as(o.id,'cleo_apply_records',['ingredients',[{id:'beans',name:'Beans',unit:'kg'}],[]]),/Stock tracking is on the Basic plan/);
 await assert.rejects(as(o.id,'cleo_apply_records',['customers',[{id:'c1',name:'Cara',mobile:'+639171234567'}],[]]),/Customer profiles are on the Pro plan/);
 await assert.rejects(as(o.id,'cleo_add_branch',['Second']),/Free plan is for one branch/);
 const t=await as(o.id,'cleo_register_terminal',[o.branch,1]);assert.equal(t.ok,true);
 // the same number again (a reset device) takes it over; a second number does not fit Free
 assert.equal((await as(o.id,'cleo_register_terminal',[o.branch,1])).ok,true);
 await assert.rejects(as(o.id,'cleo_register_terminal',[o.branch,2]),/Free plan is for one terminal/);
 await as(o.id,'cleo_add_staff',[o.branch,'Ana Cruz','cashier','2468']);
 await assert.rejects(as(o.id,'cleo_add_staff',[o.branch,'Ben','cashier','1357']),/Free plan is for one cashier/);
});

await test('Basic receives stock; Pro adjusts it and keeps customers; Max transfers and adds paid branches',async()=>{
 const b=await owner('Basic shop','basic');
 await as(b.id,'cleo_apply_records',['ingredients',[{id:'beans',name:'Beans',unit:'kg'}],[]]);
 await as(b.id,'cleo_post_stock',[b.branch,'beans','receive',5,100,'Delivery',randomUUID()]);
 await assert.rejects(as(b.id,'cleo_post_stock',[b.branch,'beans','adjust',-1,null,'Spilled',randomUUID()]),/Stock adjustments and counts are on the Pro plan/);
 await as(b.id,'cleo_apply_records',['products',products(120),[]]);   // no product limit
 await as(b.id,'cleo_register_terminal',[b.branch,1]);await as(b.id,'cleo_register_terminal',[b.branch,2]);

 const p=await owner('Pro shop','pro');
 await as(p.id,'cleo_apply_records',['ingredients',[{id:'beans',name:'Beans',unit:'kg'}],[]]);
 await as(p.id,'cleo_post_stock',[p.branch,'beans','receive',5,100,'Delivery',randomUUID()]);
 await as(p.id,'cleo_post_stock',[p.branch,'beans','adjust',-1,null,'Spilled',randomUUID()]);
 await as(p.id,'cleo_apply_records',['customers',[{id:'c1',name:'Cara',mobile:'+639171234567'}],[]]);
 await assert.rejects(as(p.id,'cleo_add_branch',['North']),/Pro plan is for one branch/);

 const x=await owner('Max shop','max');
 await subscribe(x.business,'max',{branches:2});
 const north=await as(x.id,'cleo_add_branch',['North','Quezon City','12 Main St']);
 assert.equal(north.name,'North');assert.equal(north.bcode,'B2');assert.equal(north.terminals,0);
 await assert.rejects(as(x.id,'cleo_add_branch',['South']),/Max subscription covers 2 branches/);
 await subscribe(x.business,'max',{branches:3});
 await assert.rejects(as(x.id,'cleo_add_branch',['north']),/already have a branch with that name/);
 await assert.rejects(as(x.id,'cleo_add_branch',['  ']),/name/);
 assert.equal((await as(x.id,'cleo_add_branch',['South'])).bcode,'B3');
 const snap=await as(x.id,'cleo_bootstrap');
 assert.deepEqual(snap.data.branches.map(b=>b.name),['Main branch','North','South']);
 assert.equal(snap.entitlement.plan,'max');assert.equal(snap.entitlement.branches,3);
});

await test('only owners and head office add branches',async()=>{
 const x=await owner('Owned','max');
 const mgr=randomUUID();
 await db.query("INSERT INTO auth.users(id,email,email_confirmed_at,raw_user_meta_data) VALUES($1,'mgr-plans@example.test',now(),'{}')",[mgr]);
 await db.query("INSERT INTO public.cleo_memberships(user_id,business_id,branch_id,role) VALUES($1,$2,$3,'manager')",[mgr,x.business,x.branch]);
 await as(mgr,'cleo_accept_legal',[legalVersion,'email']);
 await assert.rejects(as(mgr,'cleo_add_branch',['Rogue']),/role/);
 // a manager adds cashiers to their own branch, but not managers
 await as(mgr,'cleo_add_staff',[x.branch,'Dina','cashier','1470']);
 await assert.rejects(as(mgr,'cleo_add_staff',[x.branch,'Boss','manager','1471']),/Only the owner adds branch managers/);
});

await test('staff PINs: hashed, checked on the server, locked after three wrong tries, never readable',async()=>{
 const o=await owner('PIN shop','basic');
 const ana=await as(o.id,'cleo_add_staff',[o.branch,'  Ana   Reyes ','cashier','2468','#2e5e8c']);
 assert.equal(ana.name,'Ana Reyes');assert.equal(ana.initials,'AR');assert.equal(ana.role,'Cashier');assert.equal(ana.pin,true);
 assert.equal(ana.roles[o.branch],'cashier');assert.equal(ana.id,`u-${ana.staffId}`);
 for (const bad of ['123','12345','abcd','0000']) await assert.rejects(as(o.id,'cleo_add_staff',[o.branch,'Bad','cashier',bad]),/4-digit PIN/);
 const {rows:[row]}=await db.query('SELECT pin_hash,pin_salt FROM public.cleo_staff WHERE id=$1',[ana.staffId]);
 assert.notEqual(row.pin_hash,'2468');assert.ok(!row.pin_hash.includes('2468'));assert.ok(row.pin_salt.length>=32);
 await assert.rejects(asRole(o.id,()=>db.query('SELECT * FROM public.cleo_staff')),/permission denied/);
 await assert.rejects(asRole(o.id,()=>db.query('SELECT * FROM public.cleo_attendance')),/permission denied/);

 assert.equal((await as(o.id,'cleo_check_pin',[ana.staffId,'2468'])).ok,true);
 let r=await as(o.id,'cleo_check_pin',[ana.staffId,'1111']);assert.deepEqual([r.ok,r.code,r.left],[false,'wrong_pin',2]);
 r=await as(o.id,'cleo_check_pin',[ana.staffId,'2222']);assert.equal(r.left,1);
 r=await as(o.id,'cleo_check_pin',[ana.staffId,'3333']);assert.equal(r.code,'locked');assert.ok(r.until>Date.now());
 // locked: even the right PIN waits
 assert.equal((await as(o.id,'cleo_check_pin',[ana.staffId,'2468'])).code,'locked');
 // a new PIN from the owner clears the lock
 await as(o.id,'cleo_set_staff_pin',[ana.staffId,'8642']);
 assert.equal((await as(o.id,'cleo_check_pin',[ana.staffId,'2468'])).ok,false);
 assert.equal((await as(o.id,'cleo_check_pin',[ana.staffId,'8642'])).ok,true);

 // another business can't check, clock or change this PIN
 const other=await owner('Elsewhere','basic');
 assert.equal((await as(other.id,'cleo_check_pin',[ana.staffId,'8642'])).code,'not_found');
 await assert.rejects(as(other.id,'cleo_clock',[ana.staffId,'in']),/isn’t on this branch/);
 await assert.rejects(as(other.id,'cleo_set_staff_pin',[ana.staffId,'1111']),/isn’t on this branch/);
 await assert.rejects(as(other.id,'cleo_add_staff',[o.branch,'Spy','cashier','1234']),/access/);

 const clocked=await as(o.id,'cleo_clock',[ana.staffId,'in']);assert.equal(clocked.kind,'in');assert.equal(clocked.who,ana.staffId);
 await as(o.id,'cleo_register_terminal',[o.branch,1]);
 const snap=await as(o.id,'cleo_bootstrap');
 assert.equal(snap.data.cashiers.length,1);assert.equal(snap.data.cashiers[0].name,'Ana Reyes');
 assert.ok(snap.collections.users.some(u=>u.id===ana.id&&u.pin===true));
 assert.ok(!JSON.stringify(snap).includes(row.pin_hash));
 assert.deepEqual(snap.collections.terminals.map(t=>t.id),[`${o.branch}-t1`]);
 assert.equal(snap.data.branches[0].terminals,1);
 assert.equal(snap.collections.attendance[0].who,ana.staffId);
 assert.equal((await as(other.id,'cleo_bootstrap')).data.cashiers.length,0);

 await as(o.id,'cleo_remove_staff',[ana.staffId]);
 assert.equal((await as(o.id,'cleo_check_pin',[ana.staffId,'8642'])).code,'not_found');
 assert.equal((await as(o.id,'cleo_bootstrap')).data.cashiers.length,0);
});

await test('sales upload once per invoice, only from a registered terminal of the caller’s business',async()=>{
 const o=await owner('Sales shop','free');
 const sale={b:o.branch,t:1,who:'Ana',total:245.5,items:['Latte','Croissant'],method:'Cash',inv:'00000001'};
 await assert.rejects(as(o.id,'cleo_upload_sale',[sale]),/isn’t registered/);
 await as(o.id,'cleo_register_terminal',[o.branch,1]);
 assert.deepEqual(await as(o.id,'cleo_upload_sale',[sale]),{ok:true,duplicate:false});
 assert.deepEqual(await as(o.id,'cleo_upload_sale',[sale]),{ok:true,duplicate:true});
 for (const bad of [{...sale,b:'x'},{...sale,total:'245'},{...sale,items:[1]},{...sale,inv:5},'[]'])
  await assert.rejects(as(o.id,'cleo_upload_sale',[bad]),/Invalid sale/);
 const other=await owner('Not yours','free');
 await assert.rejects(as(other.id,'cleo_upload_sale',[sale]),/access/);
 const {rows}=await db.query('SELECT total::float AS total,items FROM public.cleo_sales WHERE business_id=$1',[o.business]);
 assert.deepEqual(rows,[{total:245.5,items:['Latte','Croissant']}]);
 assert.equal((await asRole(other.id,()=>db.query('SELECT * FROM public.cleo_sales'))).rows.length,0);
 assert.equal((await asRole(o.id,()=>db.query('SELECT * FROM public.cleo_sales'))).rows.length,1);
});

await test('settings: every Settings section saves, nested keys are created, unknown or risky ones are refused',async()=>{
 const o=await owner('Settings shop','free');
 let r=await as(o.id,'cleo_save_setting',['orderTypes.dine',false,null]);assert.equal(r.config.orderTypes.dine,false);
 r=await as(o.id,'cleo_save_setting',['tax.vat',true,null]);
 r=await as(o.id,'cleo_save_setting',['payments.methods.gcash',true,null]);assert.equal(r.config.payments.methods.gcash,true);
 r=await as(o.id,'cleo_save_setting',['business.name','Renamed',r.version]);
 assert.equal((await db.query('SELECT name FROM public.cleo_businesses WHERE id=$1',[o.business])).rows[0].name,'Renamed');
 await assert.rejects(as(o.id,'cleo_save_setting',['business.name','Late',0]),/Settings changed/);
 for (const [path,value] of [['roles.cashier',['owner']],['__proto__.x',1],['features',true],['modules.fnb','yes'],['business.tin','bad tin'],['notify.a.b.c.d.e',1],['ui.note','x'.repeat(501)]])
  await assert.rejects(as(o.id,'cleo_save_setting',[path,value,null]),/Unsupported|Invalid/);
});
