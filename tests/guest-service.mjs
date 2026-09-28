import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {testDatabase} from './db-harness.mjs';
const db=await testDatabase(),sql=db.client,ADMIN=randomUUID(),results=[];
async function call(user,service,action,payload={},connection=sql){await connection.query('begin');try{await connection.query(`set local role ${user?'authenticated':'anon'}`);await connection.query("select set_config('request.jwt.claim.sub',$1,true)",[user||'']);const result=(await connection.query(`select public.${service}($1,$2::jsonb) result`,[action,JSON.stringify(payload)])).rows[0].result;await connection.query('commit');return result;}catch(e){await connection.query('rollback');throw e;}}
async function guest(action,payload={},user=null,connection=sql){const r=await call(user,'guest_service',action,payload,connection);if(!r.ok)throw new Error(r.error);return r;}
async function member(action,payload){const r=await call(ADMIN,'member_service',action,payload);if(!r.ok)throw new Error(r.error);return r;}
const save=(entity,data)=>member('admin_save',{entity,data}).then(r=>r.item);
const admin=(action,payload)=>guest(action,payload,ADMIN);
const verify=id=>member('admin_action',{entity:'profiles',id,operation:'verify'});
async function test(name,fn){try{await fn();results.push({name,passed:true});console.log('PASS',name);}catch(e){results.push({name,passed:false,error:e.message});console.error('FAIL',name,e.stack);}}
const today=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul'}).format(new Date());
const day=n=>{const d=new Date(today()+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);};
let privacy,rules,form,product,requestCategory,requestTicket,requestId,requestPhoto,applicationTicket,applicationId,converted,seq=0;
const profile=()=>({name:`격리 비회원 ${++seq}`,building:'101',unit:String(1000+seq),phone:'010'+String(10000000+seq)});
const key=t=>({ticket_id:t.ticket_id,receipt_key:t.receipt_key});
const receiptKey=t=>({receipt_no:t.receipt_no,receipt_key:t.receipt_key});
async function prepare(kind,person=profile()){const t=await guest('prepare',{kind,phone:person.phone,consents:[privacy.id,rules.id],honeypot:''});return {...t,person};}
const submitApp=(t,extra={})=>guest('submit_application',{...key(t),profile:t.person,kind:'renewal',product_id:product.id,payment_method:'card',consents:[privacy.id,rules.id],form_values:{},expected_amount:product.price,expected_catalog_updated_at:product.updated_at,expected_form_id:form.id,...extra});
const imageData=n=>Buffer.from('ffd8ff'+n.toString(16).padStart(2,'0')+'00112233445566778899aabb','hex').toString('base64');
try{
 await sql.query(await fs.readFile('supabase/member-service.sql','utf8'));
 await sql.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',[ADMIN,'admin@guest-isolated.test']);
 await sql.query("insert into app_admins(user_id,display_name) values($1,'격리 관리자')",[ADMIN]);
 const authBefore=(await sql.query("select md5(pg_get_functiondef('public.is_app_admin()'::regprocedure)) v")).rows[0].v;
 const migration=await fs.readFile('supabase/guest-service.sql','utf8');
 await test('guest migration installs twice, keeps safe switches and existing admin function',async()=>{
  await sql.query(migration);await sql.query(migration);
  assert.equal((await sql.query("select md5(pg_get_functiondef('public.is_app_admin()'::regprocedure)) v")).rows[0].v,authBefore);
  const settings=(await member('admin_list',{entity:'settings'})).items[0];assert.equal(settings.applications_enabled,false);assert.equal(settings.requests_enabled,false);
  const denied=await call(null,'guest_service','prepare',{kind:'request',phone:'01012345678',consents:[]});assert.equal(denied.ok,false);
  assert.equal((await sql.query('select count(*)::int n from ms_guest_submissions')).rows[0].n,0);
 });
 privacy=await save('terms',{title:'격리 개인정보 안내',body:'실제 운영용이 아닌 격리 테스트 안내',kind:'privacy',required:true,approved:true,active:true});
 rules=await save('terms',{title:'격리 이용규정',body:'격리 테스트 규정',kind:'rules',required:true,approved:true,active:true});
 form=await save('forms',{fields:[],active:true});
 await save('settings',{privacy_purpose:'격리 테스트',privacy_items:'가짜 회원정보',privacy_retention:'테스트 실행 동안',applications_enabled:true,requests_enabled:true,bank_name:'TEST BANK',bank_account:'NOT-A-REAL-ACCOUNT',bank_holder:'격리 테스트'});
 product=(await member('admin_list',{entity:'products'})).items.find(p=>p.facility==='fitness'&&p.duration_days===30);product=await save('products',{id:product.id,reviewed:true,active:true});
 requestCategory=(await call(null,'member_service','public_home')).request_categories[0].id;
 await test('anonymous intake creates no auth account and stores only hashed receipt capability',async()=>{
  requestTicket=await prepare('request');assert.match(requestTicket.receipt_key,/^[0-9a-f]{64}$/);assert.match(requestTicket.receipt_no,/^R-/);
  const row=(await sql.query('select * from ms_guest_submissions where id=$1',[requestTicket.ticket_id])).rows[0];assert.equal(row.profile_snapshot,null);assert.ok(Buffer.isBuffer(row.secret_hash));assert.notEqual(row.secret_hash.toString('hex'),requestTicket.receipt_key);
  assert.equal((await sql.query('select count(*)::int n from auth.users')).rows[0].n,1);assert.equal((await sql.query('select count(*)::int n from ms_profiles')).rows[0].n,0);
  await assert.rejects(guest('receipt',receiptKey(requestTicket)),/최종/);
  await assert.rejects(guest('admin_list',{entity:'requests'}),/관리자/);
 });
 await test('photo capability, format, staging replacement and private receipt isolation',async()=>{
  requestPhoto=(await guest('upload_photo',{...key(requestTicket),mime:'image/jpeg',base64:imageData(1),purpose:'photo'})).photo;
  assert.equal((await guest('upload_photo',{...key(requestTicket),mime:'image/jpeg',base64:imageData(1),purpose:'photo'})).photo.id,requestPhoto.id);
  assert.equal((await guest('upload_photo',{...key(requestTicket),mime:'image/jpeg',base64:imageData(2),purpose:'photo',replace_photo_id:requestPhoto.id})).photo.id,requestPhoto.id);
  await assert.rejects(guest('upload_photo',{...key(requestTicket),mime:'image/svg+xml',base64:imageData(1)}));
  await assert.rejects(guest('upload_photo',{...key(requestTicket),mime:'image/png',base64:imageData(1)}));
  await assert.rejects(guest('upload_photo',{...key(requestTicket),receipt_key:'0'.repeat(64),mime:'image/jpeg',base64:imageData(1)}));
  await assert.rejects(guest('upload_photo',{...key(requestTicket),mime:'image/jpeg',base64:Buffer.concat([Buffer.from('ffd8ff','hex'),Buffer.alloc(524286)]).toString('base64')}),/512/);
  await guest('upload_photo',{...key(requestTicket),mime:'image/jpeg',base64:imageData(5)});await guest('upload_photo',{...key(requestTicket),mime:'image/jpeg',base64:imageData(6)});await assert.rejects(guest('upload_photo',{...key(requestTicket),mime:'image/jpeg',base64:imageData(7)}),/개수/);
  const submitted=await guest('submit_request',{...key(requestTicket),profile:requestTicket.person,category_id:requestCategory,title:'격리 건의',body:'본인 확인키로만 조회',photo_ids:[requestPhoto.id],consents:[privacy.id]});requestId=submitted.receipt.ticket_id;
  assert.equal(submitted.receipt.photos.length,1);assert.ok(!JSON.stringify(submitted).includes('secret_hash'));
  const photo=(await guest('photo',{...receiptKey(requestTicket),photo_id:requestPhoto.id})).photo;assert.equal(Buffer.from(photo.base64,'base64').toString('hex'),Buffer.from(imageData(2),'base64').toString('hex'));
  await assert.rejects(guest('upload_photo',{...key(requestTicket),mime:'image/jpeg',base64:imageData(3),replace_photo_id:requestPhoto.id}));
  await assert.rejects(guest('receipt',{receipt_no:requestTicket.receipt_no,receipt_key:'a'.repeat(64)}));
  const duplicate=await guest('submit_request',{...key(requestTicket),profile:requestTicket.person,category_id:requestCategory,title:'재시도',body:'재시도',consents:[privacy.id]});assert.equal(duplicate.duplicate,true);assert.equal(duplicate.receipt.request.title,'격리 건의');
  const other=await prepare('request');await assert.rejects(guest('submit_request',{...key(other),profile:other.person,category_id:requestCategory,title:'다른 요청',body:'사진 재사용 거부',photo_ids:[requestPhoto.id],consents:[privacy.id]}));
 });
 await test('admin replies and action photos are scoped; internal notes never enter guest receipt',async()=>{
  const actionPhoto=(await admin('admin_upload_photo',{id:requestId,mime:'image/jpeg',base64:imageData(3),purpose:'action'})).photo;
  await admin('admin_update_request',{id:requestId,status:'reviewing',reply:'공개 답변',internal_note:'관리자 전용 메모',assignee:ADMIN,action_photo_ids:[actionPhoto.id]});
  const receipt=(await guest('receipt',receiptKey(requestTicket))).receipt;assert.equal(receipt.request.reply,'공개 답변');assert.equal(receipt.photos.length,2);assert.ok(!JSON.stringify(receipt).includes('관리자 전용 메모'));
  assert.equal((await admin('admin_detail',{id:requestId})).item.internal_notes[0].body,'관리자 전용 메모');
  assert.equal((await guest('photo',{...receiptKey(requestTicket),photo_id:actionPhoto.id})).photo.mime,'image/jpeg');
  const other=await prepare('request');await guest('submit_request',{...key(other),profile:other.person,category_id:requestCategory,title:'다른 요청',body:'격리',consents:[privacy.id]});await assert.rejects(guest('photo',{...receiptKey(other),photo_id:actionPhoto.id}));
 });
 await test('server rejects stale catalogs, forms and core overposting; transfer report never creates a pass',async()=>{
  applicationTicket=await prepare('application');
  await assert.rejects(submitApp(applicationTicket,{expected_amount:1}));await assert.rejects(submitApp(applicationTicket,{expected_form_id:randomUUID()}));await assert.rejects(submitApp(applicationTicket,{consents:[]}));
  const result=await submitApp(applicationTicket,{payment_method:'transfer',amount:1,payment_status:'confirmed',member_id:randomUUID()});applicationId=result.receipt.ticket_id;
  assert.equal(result.receipt.application.amount,30000);assert.equal(result.receipt.application.payment_status,'awaiting');assert.equal(result.receipt.settings.bank_account,'NOT-A-REAL-ACCOUNT');
  await guest('payment_report',{...receiptKey(applicationTicket),payer_name:'테스트 입금자'});assert.equal((await guest('receipt',receiptKey(applicationTicket))).receipt.application.payment_status,'reported');
  assert.equal((await sql.query('select count(*)::int n from ms_applications')).rows[0].n,0);assert.equal((await sql.query('select count(*)::int n from ms_passes')).rows[0].n,0);
  product=await save('products',{id:product.id,price:33000,duration_days:31});
 });
 await test('manual match/create requires verification; conversion preserves original snapshots and honest NULL submitter',async()=>{
  await assert.rejects(admin('admin_convert',{id:applicationId}));
  const created=await admin('admin_create_member',{id:applicationId});assert.equal(created.profile.user_id,null);assert.equal(created.profile.approved,false);assert.equal(created.item.matched_member_id,null);
  assert.equal((await admin('admin_create_member',{id:applicationId})).profile.id,created.profile.id);
  await assert.rejects(admin('admin_match',{id:applicationId,member_id:created.profile.id}));await verify(created.profile.id);await admin('admin_match',{id:applicationId,member_id:created.profile.id});
  await save('products',{id:product.id,active:false});await assert.rejects(admin('admin_convert',{id:applicationId}),/중단/);product=await save('products',{id:product.id,active:true});
  converted=(await admin('admin_convert',{id:applicationId})).application;assert.equal(converted.amount,30000);assert.equal(converted.product_snapshot.duration_days,30);assert.equal(converted.submitted_by,null);assert.equal(converted.guest_submission_id,applicationId);assert.equal(converted.payment_status,'reported');
  assert.equal((await admin('admin_convert',{id:applicationId})).application.id,converted.id);
  await member('admin_action',{entity:'applications',id:converted.id,operation:'hold',note:'입금 확인 필요'});await assert.rejects(guest('payment_report',receiptKey(applicationTicket)));
  const final=(await member('admin_action',{entity:'applications',id:converted.id,operation:'approve',actual_amount:30000})).item;
  await member('admin_action',{entity:'applications',id:converted.id,operation:'approve',actual_amount:30000});
  assert.equal((await sql.query('select count(*)::int n from ms_payments')).rows[0].n,1);assert.equal((await sql.query('select count(*)::int n from ms_passes')).rows[0].n,1);assert.equal(final.final_end_date,day(29));
  const receipt=(await guest('receipt',receiptKey(applicationTicket))).receipt;assert.equal(receipt.application.pass_status,'applied');for(const hidden of ['member_id','submitted_by','previous_end_date','guest_submission_id'])assert.ok(!(hidden in receipt.application));
  assert.equal((await sql.query('select count(*)::int n from auth.users')).rows[0].n,1);
 });
 await test('GX promises no seat or payment until staff matching; concurrent conversions respect capacity',async()=>{
  const gx=await save('gx_classes',{name:'격리 GX',class_name:'A',weekdays:[1,3],start_time:'10:00',period_start:day(10),period_end:day(40),price:40000,capacity:1,registration_start:new Date(Date.now()-3600000).toISOString(),registration_end:new Date(Date.now()+86400000).toISOString(),payment_due_hours:24,waitlist_enabled:true,status:'open',reviewed:true});
  const tickets=[];
  for(let i=0;i<2;i++){const ticket=await prepare('application');const receipt=(await submitApp(ticket,{product_id:null,gx_class_id:gx.id,payment_method:'transfer',expected_amount:gx.price,expected_catalog_updated_at:gx.updated_at})).receipt;assert.equal(receipt.application.reservation_status,'unassigned');assert.ok(!('bank_account' in receipt.settings));await assert.rejects(guest('payment_report',receiptKey(ticket)));const created=await admin('admin_create_member',{id:ticket.ticket_id});await verify(created.profile.id);await admin('admin_match',{id:ticket.ticket_id,member_id:created.profile.id});tickets.push(ticket);}
  const c1=db.server.getPgClient('postgres'),c2=db.server.getPgClient('postgres');await c1.connect();await c2.connect();let apps;
  try{apps=await Promise.all(tickets.map((t,i)=>guest('admin_convert',{id:t.ticket_id},ADMIN,i===0?c1:c2).then(r=>r.application)));}finally{await c1.end();await c2.end();}
  assert.deepEqual(apps.map(a=>a.reservation_status).sort(),['reserved','waitlisted']);
  const waiting=tickets[apps.findIndex(a=>a.reservation_status==='waitlisted')];await assert.rejects(guest('payment_report',receiptKey(waiting)));assert.ok(!('bank_account' in (await guest('receipt',receiptKey(waiting))).receipt.settings));
  const reservedIndex=apps.findIndex(a=>a.reservation_status==='reserved'),reserved=tickets[reservedIndex],reservedApp=apps[reservedIndex];
  await sql.query("update ms_applications set reservation_expires_at=now()-interval '1 minute' where id=$1",[reservedApp.id]);
  const expiredReceipt=(await guest('receipt',receiptKey(reserved))).receipt;assert.equal(expiredReceipt.application.reservation_status,'expired');assert.ok(!('bank_account' in expiredReceipt.settings));await assert.rejects(guest('payment_report',receiptKey(reserved)),/기한/);
  assert.equal((await sql.query('select reservation_status from ms_applications where id=$1',[reservedApp.id])).rows[0].reservation_status,'reserved'); // Read only overlay, no receipt mutation.
  await sql.query("update ms_applications set payment_status='reported' where id=$1",[reservedApp.id]);
  const protectedReceipt=(await guest('receipt',receiptKey(reserved))).receipt;assert.equal(protectedReceipt.application.reservation_status,'reserved');assert.equal(protectedReceipt.application.payment_status,'reported'); // Staff delay cannot expire an already reported payment.
 });
 await test('privacy/switch changes close every collection step while preserving existing receipts and admin backlog',async()=>{
  const ticket=await prepare('request');
  await save('settings',{applications_enabled:false,requests_enabled:false,privacy_retention:''});
  await assert.rejects(prepare('request'));await assert.rejects(guest('upload_photo',{...key(ticket),mime:'image/jpeg',base64:imageData(4)}));await assert.rejects(guest('submit_request',{...key(ticket),profile:ticket.person,category_id:requestCategory,title:'중단',body:'중단',consents:[privacy.id]}));
  assert.equal((await guest('receipt',receiptKey(requestTicket))).receipt.request.title,'격리 건의');
  await admin('admin_upload_photo',{id:requestId,mime:'image/jpeg',base64:imageData(4),purpose:'action'});
  await save('settings',{privacy_retention:'테스트 실행 동안',requests_enabled:true,applications_enabled:true});
  await sql.query("update ms_settings set data=jsonb_set(data,'{privacy_purpose}','\"\"') where id=true");
  await assert.rejects(guest('upload_photo',{...key(ticket),mime:'image/jpeg',base64:imageData(4)}));await assert.rejects(guest('submit_request',{...key(ticket),profile:ticket.person,category_id:requestCategory,title:'중단',body:'중단',consents:[privacy.id]}));
  await sql.query("update ms_settings set data=jsonb_set(data,'{privacy_purpose}','\"격리 테스트\"') where id=true");
 });
 await test('fixed rate keys, contact quotas, expiration, honeypot and no direct table access',async()=>{
  const before=(await sql.query('select count(*)::int n from ms_guest_limits')).rows[0].n;
  for(let i=0;i<10;i++)assert.equal((await call(null,'guest_service','invented-'+randomUUID(),{})).ok,false);
  assert.equal((await sql.query('select count(*)::int n from ms_guest_limits')).rows[0].n,before);
  const person=profile();for(let i=0;i<5;i++)await prepare('request',person);await assert.rejects(prepare('request',person),/한도/);
  await assert.rejects(guest('prepare',{kind:'request',phone:profile().phone,consents:[privacy.id],honeypot:'bot'}));
  const expired=await prepare('request');await sql.query("update ms_guest_submissions set expires_at=now()-interval '1 minute' where id=$1",[expired.ticket_id]);await assert.rejects(guest('submit_request',{...key(expired),profile:expired.person,category_id:requestCategory,title:'만료',body:'만료',consents:[privacy.id]}));
  for(const table of ['ms_guest_submissions','ms_guest_photos','ms_guest_notes','ms_guest_limits']){await sql.query('begin');try{await sql.query('set local role anon');await assert.rejects(sql.query(`select * from public.${table}`),/permission denied/);}finally{await sql.query('rollback');}}
  const grants=(await sql.query("select has_function_privilege('anon','public.ms_guest_receipt(uuid)','EXECUTE') r,has_function_privilege('anon','public.ms_guest_rate(text,integer,text)','EXECUTE') q")).rows[0];assert.equal(grants.r,false);assert.equal(grants.q,false);
 });
}catch(e){results.push({name:'setup',passed:false,error:e.stack});console.error(e);}finally{await fs.mkdir('work',{recursive:true});await fs.writeFile('work/guest-service-results.json',JSON.stringify({isolated:true,testedAt:new Date().toISOString(),results},null,2));await db.close();}
console.log(`${results.filter(r=>r.passed).length}/${results.length} guest groups passed`);if(results.some(r=>!r.passed))process.exit(1);
