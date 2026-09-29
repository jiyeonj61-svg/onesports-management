import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {testDatabase} from './db-harness.mjs';

// Exercise the actual deployed predecessor, not a hand-written approximation of its schema.
const PREDECESSOR='3003f96d4f24fcf87bf594a5da460421adcadee7';
const db=await testDatabase(), sql=db.client, ADMIN=randomUUID(), MEMBER=randomUUID(), results=[];
async function rpc(service,action,payload={},user=null){await sql.query('begin');try{await sql.query(`set local role ${user?'authenticated':'anon'}`);await sql.query("select set_config('request.jwt.claim.sub',$1,true)",[user||'']);const r=(await sql.query(`select public.${service}($1,$2::jsonb) result`,[action,JSON.stringify(payload)])).rows[0].result;await sql.query('commit');if(!r.ok)throw Error(r.error);return r;}catch(e){await sql.query('rollback');throw e;}}
const guest=(action,payload={})=>rpc('guest_service',action,payload);
const admin=(action,payload={})=>rpc('guest_service',action,payload,ADMIN);
const member=(action,payload={},user=ADMIN)=>rpc('member_service',action,payload,user);
const save=(entity,data)=>member('admin_save',{entity,data}).then(r=>r.item);
const home=()=>rpc('member_service','public_home');
const key=t=>({ticket_id:t.ticket_id,receipt_key:t.receipt_key});
let seq=0;
const profile=()=>({name:`프로그램 격리${++seq}`,building:'101',unit:String(2000+seq),phone:'010'+String(20000000+seq)});
async function prepare(program,consents,kind='application'){const person=profile(),r=await guest('prepare',{kind,program,phone:person.phone,consents});return {...r,person};}
const picture=Buffer.from('ffd8ff00112233445566778899aabb','hex').toString('base64');
const signature=async t=>(await guest('upload_photo',{...key(t),purpose:'signature',mime:'image/jpeg',base64:picture})).photo.id;
const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul'}).format(new Date());
function day(n){const d=new Date(today+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);}
async function test(name,fn){try{await fn();results.push({name,passed:true});console.log('PASS',name);}catch(e){results.push({name,passed:false,error:e.message});console.error('FAIL',name,e.stack);}}
let privacy,rules,common,product,gx,oldReceipt,oldDraft,settingsBefore,snapshotBefore,fitnessForm,gxForm,terms=[],cashTicket,cashReceipt;
const consentIds=program=>[privacy.id,rules.id,...terms.filter(t=>t.program===program).map(t=>t.id)];
function payload(t,program,extra={}){const item=program==='gx'?gx:product,f=program==='gx'?gxForm:fitnessForm;return {...key(t),profile:t.person,kind:'renewal',product_id:program==='gx'?null:item.id,gx_class_id:program==='gx'?item.id:null,payment_method:'cash',consents:consentIds(program),form_values:{[program==='gx'?'extra_health':'extra_safety']:true},expected_amount:item.price,expected_catalog_updated_at:item.updated_at,expected_form_id:f.id,...extra};}
try{
 await sql.query(execFileSync('git',['show',`${PREDECESSOR}:supabase/member-service.sql`],{encoding:'utf8'}));
 await sql.query(execFileSync('git',['show',`${PREDECESSOR}:supabase/guest-service.sql`],{encoding:'utf8'}));
 await sql.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now()),($3,$4,now())',[ADMIN,'admin@program-isolated.test',MEMBER,'member@program-isolated.test']);
 await sql.query("insert into app_admins(user_id,display_name) values($1,'격리 관리자')",[ADMIN]);
 privacy=await save('terms',{title:'공통 개인정보',body:'격리 테스트 개인정보',kind:'privacy',required:true,approved:true,active:true});
 rules=await save('terms',{title:'공통 이용규정',body:'격리 테스트 규정',kind:'rules',required:true,approved:true,active:true});
 common=await save('forms',{fields:[],active:true});
 product=await save('products',{id:'21000000-0000-4000-8000-000000000001',reviewed:true,active:true});
 await save('settings',{privacy_purpose:'격리 테스트',privacy_items:'가짜 개인정보',privacy_retention:'테스트 실행 동안',applications_enabled:true,requests_enabled:true});
 oldReceipt=await prepare(undefined,[privacy.id,rules.id]);
 await guest('submit_application',{...key(oldReceipt),profile:oldReceipt.person,kind:'renewal',product_id:product.id,payment_method:'card',consents:[privacy.id,rules.id],form_values:{},expected_amount:product.price,expected_catalog_updated_at:product.updated_at,expected_form_id:common.id});
 oldDraft=await prepare(undefined,[privacy.id,rules.id]);
 snapshotBefore=(await guest('receipt',key(oldReceipt))).receipt.application;
 await save('settings',{applications_enabled:false,requests_enabled:false});
 settingsBefore=(await member('admin_list',{entity:'settings'})).items[0];
 const adminHash=(await sql.query("select md5(pg_get_functiondef('public.is_app_admin()'::regprocedure)) v")).rows[0].v;
 await test('additive upgrade reruns without changing settings, snapshots, admin authority or grants',async()=>{
  const migration=await fs.readFile('supabase/program-forms.sql','utf8');await sql.query(migration);await sql.query(migration);
  assert.deepEqual((await member('admin_list',{entity:'settings'})).items[0],settingsBefore);
  assert.deepEqual((await guest('receipt',key(oldReceipt))).receipt.application,snapshotBefore);
  assert.equal((await sql.query("select md5(pg_get_functiondef('public.is_app_admin()'::regprocedure)) v")).rows[0].v,adminHash);
  for(const name of ['ms_form_for(text)','ms_terms_for(text)','ms_guest_receipt(uuid)'])assert.equal((await sql.query('select has_function_privilege($1,$2,$3) ok',['anon',`public.${name}`,'EXECUTE'])).rows[0].ok,false);
  assert.equal((await sql.query("select has_table_privilege('anon','public.ms_forms','SELECT') ok")).rows[0].ok,false);
  assert.equal((await sql.query("select to_regclass('public.ms_forms_one_active') v")).rows[0].v,null);
 });
 await test('existing common-only installation and NULL legacy tickets remain compatible',async()=>{
  await save('settings',{applications_enabled:true,requests_enabled:true});
  const h=await home();assert.equal(h.forms.length,1);assert.equal(h.form.id,common.id);assert.deepEqual(h.form_programs,[]);
  const r=await guest('submit_application',{...key(oldDraft),profile:oldDraft.person,kind:'renewal',product_id:product.id,payment_method:'cash',consents:[privacy.id,rules.id],form_values:{},expected_amount:product.price,expected_catalog_updated_at:product.updated_at,expected_form_id:common.id});assert.equal(r.receipt.application.payment_method,'cash');
  oldDraft=await prepare(undefined,[privacy.id,rules.id]);
  await save('settings',{applications_enabled:false,requests_enabled:false});
 });
 await test('source form seed is repeatable, keeps collection OFF and adds only two active scoped forms plus draft terms',async()=>{
  const before=(await sql.query('select count(*)::int n from ms_terms')).rows[0].n;
  const seed=await fs.readFile('supabase/program-form-content.sql','utf8');await sql.query(seed);await sql.query(seed);
  assert.equal((await sql.query('select count(*)::int n from ms_terms')).rows[0].n,before+4);
  const h=await home();assert.deepEqual(h.form_programs.sort(),['fitness_golf','gx']);assert.equal(h.forms.length,3);assert.equal(h.terms.length,2);
  assert.equal(h.settings.applications_enabled,false);assert.equal(h.settings.requests_enabled,false);
  assert.equal((await sql.query('select active from ms_forms where id=$1',[common.id])).rows[0].active,true);
  assert.equal((await sql.query("select count(*)::int n from ms_terms where program<>'common' and (approved or active)")).rows[0].n,0);
  assert.deepEqual((await guest('receipt',key(oldReceipt))).receipt.application,snapshotBefore);
 });
 await test('unapproved program rules block preparation and stale general tickets cannot bypass new specific forms',async()=>{
  await save('settings',{applications_enabled:true,requests_enabled:true});
  await assert.rejects(prepare('fitness_golf',[privacy.id,rules.id]),/규정/);
  await assert.rejects(prepare(undefined,[privacy.id,rules.id]),/프로그램/);
  await assert.rejects(guest('submit_application',{...key(oldDraft),profile:oldDraft.person}),/다시 시작/);
  const request=await prepare('gx',[privacy.id], 'request');assert.equal(request.program,'common');
  const cat=(await home()).request_categories[0];const r=await guest('submit_request',{...key(request),profile:request.person,consents:[privacy.id],category_id:cat.id,title:'공통 요청',body:'GX 규정과 무관하게 공통 개인정보 동의'});assert.equal(r.receipt.request.consents_snapshot.length,1);
  terms=(await member('admin_list',{entity:'terms'})).items.filter(t=>t.program!=='common');
  const approvedTerms=[];for(const t of terms)approvedTerms.push(await save('terms',{id:t.id,approved:true,active:true}));terms=approvedTerms;
  const forms=(await member('admin_list',{entity:'forms'})).items;
  fitnessForm=await save('forms',{id:forms.find(f=>f.program==='fitness_golf').id,fields:[{key:'extra_safety',type:'checkbox',label:'헬스·골프 확인',required:true}]});
  gxForm=await save('forms',{id:forms.find(f=>f.program==='gx').id,fields:[{key:'extra_health',type:'checkbox',label:'GX 건강상태 확인',required:true}]});
  gx=await save('gx_classes',{name:'프로그램 격리 GX',class_name:'A',weekdays:[1,3],start_time:'10:00',period_start:day(10),period_end:day(40),price:40000,capacity:3,registration_start:new Date(Date.now()-3600000).toISOString(),registration_end:new Date(Date.now()+86400000).toISOString(),payment_due_hours:24,waitlist_enabled:true,status:'open',reviewed:true});
 });
 await test('program ticket, form, dynamic fields, scoped terms and always-signature are enforced together',async()=>{
  const t=await prepare('fitness_golf',consentIds('fitness_golf'));
  await assert.rejects(guest('submit_application',payload(t,'gx')),/프로그램/);
  await assert.rejects(guest('submit_application',payload(t,'fitness_golf',{expected_form_id:gxForm.id})),/신청서/);
  await assert.rejects(guest('submit_application',payload(t,'fitness_golf',{consents:[privacy.id,rules.id,...terms.filter(x=>x.program==='gx').map(x=>x.id)]})),/필수/);
  await assert.rejects(guest('submit_application',payload(t,'fitness_golf',{form_values:{extra_health:true}})),/필수|항목/);
  await assert.rejects(guest('submit_application',payload(t,'fitness_golf')),/서명/);
  const sig=await signature(t);cashTicket=t;cashReceipt=(await guest('submit_application',payload(t,'fitness_golf',{signature_photo_id:sig}))).receipt;
  assert.equal(cashReceipt.application.form_snapshot.program,'fitness_golf');assert.equal(cashReceipt.application.form_snapshot.signature_mode,'always');assert.equal(cashReceipt.application.payment_method,'cash');assert.ok(!('bank_account' in cashReceipt.settings));
  assert.ok(cashReceipt.application.consents_snapshot.every(t=>['common','fitness_golf'].includes(t.program)));
  await assert.rejects(guest('payment_report',key(t)),/배정|입금|GX/);
 });
 await test('revoking a program rule closes staged signatures and legacy uploads require complete collection policy',async()=>{
  const t=await prepare('fitness_golf',consentIds('fitness_golf')),rule=terms.find(x=>x.program==='fitness_golf'&&x.kind==='rules');
  await sql.query('update ms_terms set active=false where id=$1',[rule.id]);
  await assert.rejects(signature(t),/규정/);
  await sql.query('update ms_terms set active=true where id=$1',[rule.id]);
  assert.ok(await signature(t));
  await sql.query('begin');await sql.query("select set_config('request.jwt.claim.sub',$1,true)",[MEMBER]);
  const path=`applications/${MEMBER}/${randomUUID()}.jpg`;
  assert.equal((await sql.query('select ms_file_upload($1) ok',[path])).rows[0].ok,true);
  await sql.query("update ms_settings set data=data||'{\"privacy_retention\":\"\"}'::jsonb");
  assert.equal((await sql.query('select ms_file_upload($1) ok',[path])).rows[0].ok,false);await sql.query('rollback');
 });
 await test('versioning is per-program; renaming a term deactivates only its prior version and snapshots remain immutable',async()=>{
  const priorGX=gxForm.id;
  fitnessForm=await save('forms',{id:fitnessForm.id,title:'변경된 헬스·골프 양식'});
  assert.equal((await home()).forms.find(f=>f.program==='gx').id,priorGX);
  const oldTerm=terms.find(t=>t.program==='fitness_golf'&&t.kind==='rules');const replacement=await save('terms',{id:oldTerm.id,title:'이름이 바뀐 헬스·골프 규정'});terms=terms.map(t=>t.id===oldTerm.id?replacement:t);
  assert.equal((await sql.query('select active from ms_terms where id=$1',[oldTerm.id])).rows[0].active,false);assert.equal(replacement.version,oldTerm.version+1);
  await assert.rejects(save('forms',{id:fitnessForm.id,program:'gx'}),/프로그램/);await assert.rejects(save('terms',{id:replacement.id,program:'gx'}),/프로그램/);
  assert.deepEqual((await guest('receipt',key(cashTicket))).receipt.application,cashReceipt.application);
 });
 await test('cash conversion and final approval preserve accepted form/consent/signature snapshots without Auth signup',async()=>{
  const created=await admin('admin_create_member',{id:cashTicket.ticket_id});await member('admin_action',{entity:'profiles',id:created.profile.id,operation:'verify'});await admin('admin_match',{id:cashTicket.ticket_id,member_id:created.profile.id});
  const a=(await admin('admin_convert',{id:cashTicket.ticket_id})).application;assert.deepEqual(a.form_snapshot,cashReceipt.application.form_snapshot);assert.deepEqual(a.consents_snapshot,cashReceipt.application.consents_snapshot);assert.equal(a.payment_method,'cash');
  const approved=(await member('admin_action',{entity:'applications',id:a.id,operation:'approve',actual_amount:a.amount})).item;assert.equal(approved.pass_status,'applied');
  const payment=(await sql.query('select * from ms_payments where application_id=$1',[a.id])).rows[0];assert.equal(payment.method,'cash');assert.equal((await sql.query('select count(*)::int n from auth.users')).rows[0].n,2);
 });
 await test('new and none signature modes are authoritative per-program, including legacy authenticated submission',async()=>{
  gxForm=await save('forms',{id:gxForm.id,signature_mode:'new'});
  const renewal=await prepare('gx',consentIds('gx'));await guest('submit_application',payload(renewal,'gx'));
  const fresh=await prepare('gx',consentIds('gx'));await assert.rejects(guest('submit_application',payload(fresh,'gx',{kind:'new'})),/서명/);const sig=await signature(fresh);await guest('submit_application',payload(fresh,'gx',{kind:'new',signature_photo_id:sig}));
  fitnessForm=await save('forms',{id:fitnessForm.id,signature_mode:'none'});
  const unsigned=await prepare('fitness_golf',consentIds('fitness_golf'));await assert.rejects(signature(unsigned),/종류/);await assert.rejects(guest('submit_application',payload(unsigned,'fitness_golf',{signature_photo_id:sig})),/수집하지/);await guest('submit_application',payload(unsigned,'fitness_golf'));
  const memberProfile=(await sql.query("insert into ms_profiles(user_id,name,building,unit,phone,approved,resident_verified) values($1,'격리 회원','101','3001','01099999999',true,true) returning id",[MEMBER])).rows[0].id;assert.ok(memberProfile);
  const app={idempotency_key:randomUUID(),kind:'renewal',product_id:product.id,payment_method:'cash',consents:consentIds('fitness_golf'),form_values:{extra_safety:true},expected_form_id:fitnessForm.id};
  await assert.rejects(member('application_submit',{...app,expected_form_id:gxForm.id},MEMBER),/신청서/);
  assert.equal((await member('application_submit',app,MEMBER)).application.payment_method,'cash');
 });
 await test('disabling a specific form blocks fallback while the other program stays available',async()=>{
  const t=await prepare('fitness_golf',consentIds('fitness_golf'));await save('forms',{id:fitnessForm.id,active:false});
  await assert.rejects(prepare('fitness_golf',consentIds('fitness_golf')),/신청서/);await assert.rejects(guest('submit_application',payload(t,'fitness_golf')),/신청서/);
  const h=await home();assert.ok(!h.forms.some(f=>f.program==='fitness_golf'));assert.ok(h.form_programs.includes('fitness_golf'));assert.equal(h.forms.find(f=>f.program==='common').id,common.id);assert.ok(h.forms.some(f=>f.program==='gx'));
 });
}finally{await db.close();}
console.log(JSON.stringify({passed:results.filter(r=>r.passed).length,total:results.length,results},null,2));
if(results.some(r=>!r.passed))process.exit(1);
