// Real isolated PostgreSQL on a dedicated localhost port. No deployment secrets,
// remote DB URLs or production rows are read. All people and payments are fake.
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {testDatabase} from './db-harness.mjs';
const db=await testDatabase({port:55442}),sql=db.client,ADMIN=randomUUID(),SITE=randomUUID(),OTHER=randomUUID(),ACTOR=randomUUID(),results=[];
async function role(who,fn){await sql.query('begin');try{await sql.query('set local role '+who);await sql.query("select set_config('request.jwt.claim.sub',$1,true)",[who==='authenticated'?ADMIN:'']);const r=await fn();await sql.query('commit');return r;}catch(e){await sql.query('rollback');throw e;}}
async function old(service,action,payload={},who='authenticated'){const r=await role(who,async()=>(await sql.query('select public.'+service+'_service($1,$2::jsonb) r',[action,JSON.stringify(payload)])).rows[0].r);if(!r.ok)throw new Error(r.error);return r;}
const staff=(service,action,payload={},site=SITE,who='service_role')=>role(who,async()=>(await sql.query('select public.osi_staff_resident_service($1,$2,$3,$4,$5::jsonb) r',[site,ACTOR,service,action,JSON.stringify(payload)])).rows[0].r);
const detail=(service,id,entity)=>staff(service,'admin_detail',{id,...(entity?{entity}:{})}).then(r=>r.item);
async function check(name,fn){try{await fn();results.push({name,passed:true});console.log('PASS',name);}catch(e){results.push({name,passed:false,error:e.message});console.error('FAIL',name,e.message,e.position||'',e.where||'');}}
const save=(entity,data)=>old('member','admin_save',{entity,data}).then(r=>r.item);
const person={name:'격리 테스트 회원',building:'101',unit:'9999',phone:'01000009999'};
const now=new Date().toISOString(),today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul'}).format(new Date());
const image=Buffer.from('ffd8ff00112233445566778899aabb','hex').toString('base64');
let privacy,rules,form,product,category,request,application,profile,converted,post;
try{
 await sql.query(await fs.readFile('supabase/member-service.sql','utf8'));await sql.query(await fs.readFile('supabase/guest-service.sql','utf8'));
 await sql.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',[ADMIN,'admin@resident-isolated.invalid']);await sql.query("insert into app_admins(user_id,display_name) values($1,'격리 관리자')",[ADMIN]);
 const functionHashes=async()=>(await sql.query("select proname,md5(pg_get_functiondef(oid)) hash from pg_proc where oid in ('public.member_service(text,jsonb)'::regprocedure,'public.guest_service(text,jsonb)'::regprocedure,'public.is_app_admin()'::regprocedure) order by proname")).rows;
 const hashes=await functionHashes();
 privacy=await save('terms',{title:'격리 개인정보',body:'테스트 자료',kind:'privacy',required:true,approved:true,active:true});rules=await save('terms',{title:'격리 이용규정',body:'테스트 자료',kind:'rules',required:true,approved:true,active:true});form=await save('forms',{fields:[],active:true});
 await save('settings',{privacy_purpose:'격리 테스트',privacy_items:'가짜정보',privacy_retention:'테스트동안',applications_enabled:true,requests_enabled:true});
 product=(await old('member','admin_list',{entity:'products'})).items.find(p=>p.facility==='fitness'&&p.duration_days===30);product=await save('products',{id:product.id,reviewed:true,active:true});category=(await old('member','public_home',{},'anon')).request_categories[0].id;
 const prepare=kind=>old('guest','prepare',{kind,phone:person.phone,consents:[privacy.id,rules.id]},'anon');
 const rt=await prepare('request');await old('guest','submit_request',{ticket_id:rt.ticket_id,receipt_key:rt.receipt_key,profile:person,category_id:category,title:'격리 건의',body:'원본을 보존합니다.',consents:[privacy.id]},'anon');request=rt;
 const at=await prepare('application');await old('guest','submit_application',{ticket_id:at.ticket_id,receipt_key:at.receipt_key,profile:person,kind:'renewal',product_id:product.id,payment_method:'card',consents:[privacy.id,rules.id],form_values:{},expected_amount:product.price,expected_catalog_updated_at:product.updated_at,expected_form_id:form.id},'anon');application=at;
 const tableHashes=async()=>{const out={};for(const {tablename} of (await sql.query("select tablename from pg_tables where schemaname='public' and tablename like 'ms_%' order by tablename")).rows){assert.match(tablename,/^[a-z_]+$/);out[tablename]=(await sql.query(`select md5(coalesce(string_agg((to_jsonb(t)-'staff_actor_id')::text,',' order by (to_jsonb(t)-'staff_actor_id')::text),'')) h from public.${tablename} t`)).rows[0].h;}return out;};
 const before=await tableHashes();
 const migration=await fs.readFile('supabase/migrations/20261103225932_staff_resident_service.sql','utf8');
 await check('migration installs twice and preserves original functions and every original table row field',async()=>{await sql.query(migration);await sql.query(migration);assert.deepEqual(await functionHashes(),hashes);assert.deepEqual(await tableHashes(),before);});
 if(results.some(r=>!r.passed))throw new Error('Migration blocked');
 await check('binding defaults closed; only owner can bind; original roles cannot invoke wrapper or internal executors',async()=>{
  await assert.rejects(staff('guest','admin_list',{entity:'requests'}),/연결/);
  for(const who of ['anon','authenticated','service_role'])await assert.rejects(role(who,()=>sql.query('insert into osi_resident_centers(site_id,enabled,evidence) values($1,true,$2)',[SITE,'explicit isolated fixture binding'])),/permission/);
  await sql.query('insert into osi_resident_centers(site_id,enabled,evidence) values($1,true,$2)',[SITE,'explicit isolated fixture binding']);
  for(const who of ['anon','authenticated'])await assert.rejects(staff('guest','admin_list',{entity:'requests'},SITE,who),/permission/);
  for(const who of ['anon','authenticated','service_role'])await assert.rejects(role(who,()=>sql.query("select osi_resident_private.member_core('admin_list','{\"entity\":\"profiles\"}')")),/permission/);
  await assert.rejects(staff('guest','admin_list',{entity:'requests'},OTHER),/연결/);
 });
 await check('paginated lists, search and detail never expose receipt capability hashes or Auth identity',async()=>{
  const status=await staff('member','status');assert.equal(status.status.applications_enabled,true);assert.equal(status.status.requests_enabled,true);assert.equal(status.status.programs.find(p=>p.program==='fitness_golf').ready,true);assert.ok(!JSON.stringify(status).match(/bank_account|bank_holder|privacy_items/));
  const rows=await staff('guest','admin_list',{entity:'requests',limit:1,offset:0});assert.equal(rows.total,1);assert.equal(rows.items.length,1);assert.equal((await staff('guest','admin_list',{entity:'requests',offset:1})).items.length,0);
  assert.equal((await staff('guest','admin_list',{entity:'requests',search:'not present'})).total,0);
  const d=await detail('guest',request.ticket_id);assert.equal(d.profile_snapshot.name,person.name);assert.ok(!JSON.stringify(d).match(/secret_hash|phone_hash|receipt_key/));
  for(const payload of [{entity:'settings'},{entity:'posts',site_id:OTHER},{entity:'profiles',actor_id:ADMIN}])await assert.rejects(staff('member','admin_list',payload));
  await assert.rejects(staff('member','admin_save',{entity:'products',data:{id:product.id,price:1}}));
 });
 await check('guest request reply and private notes retain the correct staff actor and reject stale changes',async()=>{
  const d=await detail('guest',request.ticket_id);
  await assert.rejects(staff('guest','admin_update_request',{id:d.id,status:'completed',reply:'처리',expected_updated_at:now}),/최신/);
  await staff('guest','admin_update_request',{id:d.id,status:'completed',reply:'완료 답변',internal_note:'직원만 보는 가짜 메모',expected_updated_at:d.updated_at,actor_name:'격리 직원'});
  const receipt=await old('guest','receipt',{receipt_no:request.receipt_no,receipt_key:request.receipt_key},'anon');assert.ok(JSON.stringify(receipt).includes('완료 답변'));assert.ok(!JSON.stringify(receipt).includes('가짜 메모'));
  const note=(await sql.query('select created_by,staff_actor_id from ms_guest_notes where submission_id=$1',[d.id])).rows[0];assert.equal(note.created_by,null);assert.equal(note.staff_actor_id,ACTOR);
  await assert.rejects(staff('guest','admin_update_request',{id:d.id,status:'reviewing',expected_updated_at:d.updated_at}),/최신/);
 });
 await check('application creates pending member, requires explicit identity check, matches and converts once',async()=>{
  let d=await detail('guest',application.ticket_id);
  const created=await staff('guest','admin_create_member',{id:d.id,expected_updated_at:d.updated_at});profile=created.profile;assert.equal(profile.approved,false);assert.equal(profile.resident_verified,false);assert.equal(profile.user_id,undefined);
  assert.equal((await staff('guest','admin_create_member',{id:d.id,expected_updated_at:d.updated_at})).profile.id,profile.id);
  await assert.rejects(staff('member','admin_action',{entity:'profiles',id:profile.id,operation:'verify',expected_updated_at:profile.updated_at}),/현장/);
  await staff('member','admin_action',{entity:'profiles',id:profile.id,operation:'verify',expected_updated_at:profile.updated_at,identity_confirmed:true});
  d=await detail('guest',d.id);await staff('guest','admin_match',{id:d.id,member_id:profile.id,identity_confirmed:true,expected_updated_at:d.updated_at});
  d=await detail('guest',d.id);const convertedResult=await staff('guest','admin_convert',{id:d.id,expected_updated_at:d.updated_at});converted=convertedResult.application;
  assert.equal((await staff('guest','admin_convert',{id:d.id,expected_updated_at:d.updated_at})).application.id,converted.id);
  assert.equal((await sql.query('select count(*)::int n from ms_passes')).rows[0].n,0);assert.equal((await sql.query('select submitted_by from ms_applications where id=$1',[converted.id])).rows[0].submitted_by,null);
 });
 await check('actual payment and period checks precede one idempotent payment/pass; actor never impersonates Auth',async()=>{
  const d=await detail('member',converted.id,'applications');assert.equal(d.member.id,profile.id);assert.equal(d.expected_period.start,today);
  const input={entity:'applications',id:d.id,operation:'approve',expected_updated_at:d.updated_at,actual_amount:d.amount,paid_at:new Date().toISOString(),expected_start_date:d.expected_period.start,expected_end_date:d.expected_period.end};
  await assert.rejects(staff('member','admin_action',{...input,actual_amount:d.amount+1}),/금액/);
  await assert.rejects(staff('member','admin_action',{...input,expected_end_date:'2099-01-01'}),/기간/);
  assert.equal((await staff('member','admin_action',input)).item.pass_status,'applied');assert.equal((await staff('member','admin_action',input)).duplicate,true);
  const payment=(await sql.query('select confirmed_by,staff_actor_id from ms_payments where application_id=$1',[d.id])).rows[0];assert.equal(payment.confirmed_by,null);assert.equal(payment.staff_actor_id,ACTOR);
  assert.equal((await sql.query('select count(*)::int n from ms_payments')).rows[0].n,1);assert.equal((await sql.query('select count(*)::int n from ms_passes')).rows[0].n,1);assert.equal((await sql.query('select count(*)::int n from auth.users')).rows[0].n,1);
 });
 await check('published posts require privacy preview and use the original public board',async()=>{
  const cats=await staff('member','admin_list',{entity:'categories'});const board=cats.items.find(c=>c.kind==='board');
  await assert.rejects(staff('member','admin_save',{entity:'posts',data:{category_id:board.id,title:'격리 공지',body:'테스트',status:'published'}}),/미리보기/);
  post=(await staff('member','admin_save',{entity:'posts',data:{category_id:board.id,title:'격리 공지',body:'테스트',status:'draft'}})).item;
  await staff('member','admin_save',{entity:'posts',data:{id:post.id,status:'published',preview_confirmed:true,expected_updated_at:post.updated_at}});
  assert.ok((await old('member','public_home',{},'anon')).posts.some(p=>p.id===post.id));
 });
 await check('guest photos remain private and use valid parent-scoped IDs',async()=>{
  const uploaded=await staff('guest','admin_upload_photo',{id:request.ticket_id,mime:'image/jpeg',base64:image,purpose:'action'});
  assert.equal((await staff('guest','photo',{photo_id:uploaded.photo.id})).photo.mime,'image/jpeg');
  await assert.rejects(staff('guest','admin_upload_photo',{id:application.ticket_id,mime:'image/jpeg',base64:image,purpose:'action'}));
  await assert.rejects(staff('guest','admin_upload_photo',{id:request.ticket_id,mime:'image/svg+xml',base64:image,purpose:'action'}));
 });
 await check('legacy request photo stages are bound to their exact parent and actor; old public RPC retains private ownership',async()=>{
  const first=randomUUID(),second=randomUUID();
  for(const [id,no] of [[first,'LOCAL-1'],[second,'LOCAL-2']])await sql.query('insert into ms_requests(id,request_no,member_id,category_id,title,body,idempotency_key,submitted_by) values($1,$2,$3,$4,$5,$6,$7,$8)',[id,no,profile.id,category,'가짜 기존 건의','접수별 사진 권한 검사',randomUUID(),ADMIN]);
  const oldPhoto=`requests/${ADMIN}/${randomUUID()}.jpeg`;await sql.query("insert into storage.objects(bucket_id,name) values('member-service-files',$1)",[oldPhoto]);await sql.query('update ms_requests set photos=array[$1] where id=$2',[oldPhoto,first]);
  assert.equal((await staff('member','photo',{entity:'requests',id:first,kind:'photo',index:0})).photo.path,oldPhoto);
  const upload=await staff('member','admin_upload_photo',{id:first,entity:'requests',purpose:'action',mime:'image/jpeg',base64:image});
  assert.equal(upload.upload,true);assert.match(upload.photo.path,new RegExp('^requests/'+first+'/'));
  assert.equal((await staff('member','admin_upload_photo',{id:first,entity:'requests',purpose:'action',mime:'image/jpeg',base64:image})).photo.path,upload.photo.path);
  let d=await detail('member',first,'requests');
  await assert.rejects(staff('member','admin_action',{entity:'requests',id:first,operation:'update',status:'completed',action_photos:[upload.photo.path],expected_updated_at:d.updated_at}),/사진/);
  await sql.query("insert into storage.objects(bucket_id,name) values('member-service-files',$1)",[upload.photo.path]);
  const other=await detail('member',second,'requests');await assert.rejects(staff('member','admin_action',{entity:'requests',id:second,operation:'update',status:'completed',action_photos:[upload.photo.path],expected_updated_at:other.updated_at}),/사진/);
  await staff('member','admin_action',{entity:'requests',id:first,operation:'update',status:'completed',reply:'조치 사진 첨부',internal_note:'새 직원 메모',action_photos:[upload.photo.path],expected_updated_at:d.updated_at});
  assert.equal((await staff('member','photo',{entity:'requests',id:first,kind:'action',index:0})).photo.path,upload.photo.path);
  await assert.rejects(staff('member','photo',{entity:'requests',id:second,kind:'action',index:0}),/사진/);
  const note=(await sql.query('select created_by,staff_actor_id from ms_request_notes where request_id=$1',[first])).rows[0];assert.equal(note.created_by,null);assert.equal(note.staff_actor_id,ACTOR);
  d=await detail('member',first,'requests');await staff('member','admin_action',{entity:'requests',id:first,operation:'update',status:'reviewing',expected_updated_at:d.updated_at});
  assert.deepEqual((await detail('member',first,'requests')).action_photos,[upload.photo.path]);
 });
 await check('post photos cannot be borrowed from a request or another post; draft and publish control anonymous access',async()=>{
  post=await detail('member',post.id,'posts');
  const first=(await sql.query('select path from osi_resident_uploads where entity=$1 limit 1',['requests'])).rows[0].path;
  await assert.rejects(staff('member','admin_save',{entity:'posts',data:{id:post.id,status:'published',photos:[first],preview_confirmed:true,expected_updated_at:post.updated_at}}),/사진/);
  const uploaded=await staff('member','admin_upload_photo',{entity:'posts',id:post.id,purpose:'photo',mime:'image/jpeg',base64:image});
  await sql.query("insert into storage.objects(bucket_id,name) values('member-service-files',$1)",[uploaded.photo.path]);
  post=(await staff('member','admin_save',{entity:'posts',data:{id:post.id,status:'published',photos:[uploaded.photo.path],preview_confirmed:true,expected_updated_at:post.updated_at}})).item;
  assert.equal((await role('anon',async()=>(await sql.query('select ms_file_read($1) ok',[uploaded.photo.path])).rows[0])).ok,true);
  await staff('member','admin_save',{entity:'posts',data:{id:post.id,status:'draft',expected_updated_at:post.updated_at}});
  assert.equal((await role('anon',async()=>(await sql.query('select ms_file_read($1) ok',[uploaded.photo.path])).rows[0])).ok,false);
 });
 await check('paid cancellation preserves money and pass history while requesting a refund review',async()=>{
  let d=await detail('member',converted.id,'applications');
  await staff('member','admin_action',{entity:'applications',id:d.id,operation:'external_done',expected_updated_at:d.updated_at});
  d=await detail('member',d.id,'applications');await staff('member','admin_action',{entity:'applications',id:d.id,operation:'cancel',note:'격리 취소 검증',expected_updated_at:d.updated_at});
  assert.equal((await detail('member',d.id,'applications')).application_status,'refund_required');assert.equal((await sql.query('select refund_status from ms_payments where application_id=$1',[d.id])).rows[0].refund_status,'required');
  assert.equal((await sql.query('select count(*)::int n from ms_payments')).rows[0].n,1);assert.equal((await sql.query('select count(*)::int n from ms_passes')).rows[0].n,1);
  d=await detail('member',d.id,'applications');await assert.rejects(staff('member','admin_action',{entity:'applications',id:d.id,operation:'approve',expected_updated_at:d.updated_at,actual_amount:d.amount,paid_at:new Date().toISOString(),expected_start_date:d.expected_period.start,expected_end_date:d.expected_period.end}),/취소/);
 });
 await check('GX capacity, waiting, assignment and fixed course dates retain existing transition guards',async()=>{
  const day=n=>{const d=new Date(today+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);};
  const gx=await save('gx_classes',{name:'격리 직원 GX',class_name:'A',weekdays:[1,3],start_time:'10:00',period_start:day(10),period_end:day(40),price:40000,capacity:1,registration_start:new Date(Date.now()-3600000).toISOString(),registration_end:new Date(Date.now()+86400000).toISOString(),payment_due_hours:24,waitlist_enabled:true,status:'open',reviewed:true});
  const apps=[];
  for(let i=0;i<2;i++){
   const applicant={...person,name:'격리 GX 회원 '+i,phone:'0100000888'+i};const t=await old('guest','prepare',{kind:'application',phone:applicant.phone,consents:[privacy.id,rules.id]},'anon');
   await old('guest','submit_application',{ticket_id:t.ticket_id,receipt_key:t.receipt_key,profile:applicant,kind:'renewal',gx_class_id:gx.id,payment_method:'card',consents:[privacy.id,rules.id],form_values:{},expected_amount:gx.price,expected_catalog_updated_at:gx.updated_at,expected_form_id:form.id},'anon');
   let d=await detail('guest',t.ticket_id);const p=(await staff('guest','admin_create_member',{id:d.id,expected_updated_at:d.updated_at})).profile;await staff('member','admin_action',{entity:'profiles',id:p.id,operation:'verify',expected_updated_at:p.updated_at,identity_confirmed:true});
   d=await detail('guest',d.id);await staff('guest','admin_match',{id:d.id,member_id:p.id,expected_updated_at:d.updated_at,identity_confirmed:true});d=await detail('guest',d.id);apps.push((await staff('guest','admin_convert',{id:d.id,expected_updated_at:d.updated_at})).application);
  }
  assert.deepEqual(apps.map(a=>a.reservation_status),['reserved','waitlisted']);
  let wait=await detail('member',apps[1].id,'applications');assert.equal(wait.expected_period.start,gx.period_start);assert.equal(wait.expected_period.end,gx.period_end);
  await assert.rejects(staff('member','admin_action',{entity:'applications',id:wait.id,operation:'approve',expected_updated_at:wait.updated_at,actual_amount:wait.amount,paid_at:new Date().toISOString(),expected_start_date:gx.period_start,expected_end_date:gx.period_end}),/자리/);
  await assert.rejects(staff('member','admin_action',{entity:'applications',id:wait.id,operation:'assign_seat',expected_updated_at:wait.updated_at}),/자리/);
  await staff('member','admin_action',{entity:'applications',id:apps[0].id,operation:'cancel',note:'격리 대기순서검증',expected_updated_at:apps[0].updated_at});
  wait=(await staff('member','admin_action',{entity:'applications',id:wait.id,operation:'assign_seat',expected_updated_at:wait.updated_at})).item;assert.equal(wait.reservation_status,'reserved');
 });
 await check('staff audit covers private reads and writes while original Auth administrator still works',async()=>{
  assert.ok((await sql.query('select count(*)::int n from osi_resident_audit where actor_id=$1 and actor_type=$2',[ACTOR,'SITE_STAFF'])).rows[0].n>=10);
  assert.deepEqual(await functionHashes(),hashes);assert.equal((await old('member','admin_list',{entity:'applications'})).items.length,3);
  const req=(await sql.query("select id from ms_requests where request_no='LOCAL-1'")).rows[0];await old('member','admin_action',{entity:'requests',id:req.id,operation:'update',internal_note:'기존 관리자 메모'});
  const legacyNote=(await sql.query("select created_by,staff_actor_id from ms_request_notes where body='기존 관리자 메모'")).rows[0];assert.equal(legacyNote.created_by,ADMIN);assert.equal(legacyNote.staff_actor_id,null);
  await assert.rejects(role('service_role',()=>sql.query('update osi_resident_centers set enabled=false')),/permission/);
 });
}finally{await fs.writeFile('work/resident-service-results.json',JSON.stringify({database:'isolated local PostgreSQL',results},null,2));await db.close();}
if(results.some(r=>!r.passed))process.exit(1);
