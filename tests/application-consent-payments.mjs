import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {testDatabase} from './db-harness.mjs';

const PREDECESSOR='1de26c838ef9fcc1b271798c917bdcf4457c6c1e';
const db=await testDatabase(),sql=db.client,ADMIN=randomUUID(),MEMBER=randomUUID(),results=[];
async function rpc(service,action,payload={},user=null){await sql.query('begin');try{await sql.query(`set local role ${user?'authenticated':'anon'}`);await sql.query("select set_config('request.jwt.claim.sub',$1,true)",[user||'']);const result=(await sql.query(`select public.${service}($1,$2::jsonb) result`,[action,JSON.stringify(payload)])).rows[0].result;await sql.query('commit');if(!result.ok)throw Error(result.error);return result;}catch(e){await sql.query('rollback');throw e;}}
const member=(action,payload={},user=ADMIN)=>rpc('member_service',action,payload,user);
const guest=(action,payload={})=>rpc('guest_service',action,payload);
const guestAdmin=(action,payload={})=>rpc('guest_service',action,payload,ADMIN);
const save=(entity,data)=>member('admin_save',{entity,data}).then(r=>r.item);
const key=t=>({ticket_id:t.ticket_id,receipt_key:t.receipt_key});
const count=table=>sql.query(`select count(*)::integer n from public.${table}`).then(r=>r.rows[0].n);
const permissions=()=>sql.query("select oid::regprocedure::text signature,proowner::regrole::text owner,proacl::text acl from pg_proc where oid in ('public.member_service(text,jsonb)'::regprocedure,'public.guest_service(text,jsonb)'::regprocedure) order by signature").then(r=>r.rows);
let seq=0;
const person=()=>({name:`동의격리${++seq}`,building:'101',unit:String(2000+seq),phone:'010'+String(30000000+seq)});
let privacy,rules,form,product,programTerms=[],gx,gxForm,oldTicket,oldApp,oldPayment,oldSnapshot,settingsBefore,aclBefore;
const consents=()=>[privacy.id,rules.id,...programTerms.map(t=>t.id)];
async function prepare(ids=consents(),program='fitness_golf'){const profile=person();const t=await guest('prepare',{kind:'application',program,phone:profile.phone,consents:ids});return {...t,profile};}
const application=(t,extra={})=>({...key(t),profile:t.profile,kind:'renewal',product_id:product.id,payment_method:'card',consents:consents(),form_values:{},expected_amount:product.price,expected_catalog_updated_at:product.updated_at,expected_form_id:form.id,...extra});
const legacy=(extra={})=>({idempotency_key:randomUUID(),kind:'renewal',product_id:product.id,payment_method:'card',consents:consents(),form_values:{},expected_form_id:form.id,...extra});
async function test(name,fn){try{await fn();results.push({name,passed:true});console.log('PASS',name);}catch(e){results.push({name,passed:false,error:e.message});console.error('FAIL',name,e.stack);}}
try{
 await sql.query(execFileSync('git',['show',`${PREDECESSOR}:supabase/member-service.sql`],{encoding:'utf8'}));
 await sql.query(execFileSync('git',['show',`${PREDECESSOR}:supabase/guest-service.sql`],{encoding:'utf8'}));
 await sql.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now()),($3,$4,now())',[ADMIN,'admin@consent-isolated.test',MEMBER,'member@consent-isolated.test']);
 await sql.query("insert into app_admins(user_id,display_name) values($1,'격리 관리자')",[ADMIN]);
 await sql.query("insert into ms_profiles(user_id,name,building,unit,phone,approved,resident_verified) values($1,'과거 회원','101','1001','01011111111',true,true)",[MEMBER]);
 privacy=await save('terms',{title:'공통 개인정보',body:'격리 테스트용 개인정보',program:'common',kind:'privacy',required:false,approved:true,active:true});
 rules=await save('terms',{title:'공통 이용규정',body:'격리 테스트용 이용규정',program:'common',kind:'rules',required:false,approved:true,active:true});
 form=await save('forms',{fields:[],active:true});
 product=await save('products',{id:'21000000-0000-4000-8000-000000000001',active:true,reviewed:true});
 await save('settings',{privacy_purpose:'격리 검증',privacy_items:'가짜 개인정보',privacy_retention:'테스트 중',applications_enabled:true,requests_enabled:true,bank_name:'TEST',bank_account:'NOT-A-REAL-ACCOUNT',bank_holder:'격리 테스트'});
 // A real predecessor permits optional privacy/rules and cash. Keep these exact historical records.
 oldTicket=await prepare([]);
 oldSnapshot=(await guest('submit_application',application(oldTicket,{consents:[],payment_method:'cash'}))).receipt.application;
 oldApp=(await member('application_submit',legacy({consents:[],payment_method:'cash'}),MEMBER)).application;
 await member('admin_action',{entity:'applications',id:oldApp.id,operation:'approve',actual_amount:oldApp.amount});
 oldApp=(await sql.query('select to_jsonb(a) data from ms_applications a where id=$1',[oldApp.id])).rows[0].data;
 oldPayment=(await sql.query('select to_jsonb(p) data from ms_payments p where application_id=$1',[oldApp.id])).rows[0].data;
 await save('settings',{applications_enabled:false,requests_enabled:false});settingsBefore=(await member('admin_list',{entity:'settings'})).items[0];aclBefore=await permissions();
 await test('targeted upgrade reruns without touching OFF switches, historical cash rows, snapshots or RPC ACLs',async()=>{
  const migration=await fs.readFile('supabase/application-consent-payments.sql','utf8');assert.equal((migration.match(/create or replace function/g)||[]).length,2);assert.ok(!/alter table|update public\.ms_settings set data=/i.test(migration.split("if action='admin_save'")[0]));
  await sql.query(migration);await sql.query(migration);
  assert.deepEqual((await member('admin_list',{entity:'settings'})).items[0],settingsBefore);assert.deepEqual(await permissions(),aclBefore);
  assert.deepEqual((await guest('receipt',key(oldTicket))).receipt.application,oldSnapshot);
  assert.deepEqual((await sql.query('select to_jsonb(a) data from ms_applications a where id=$1',[oldApp.id])).rows[0].data,oldApp);
  assert.deepEqual((await sql.query('select to_jsonb(p) data from ms_payments p where application_id=$1',[oldApp.id])).rows[0].data,oldPayment);
  assert.equal(oldPayment.method,'cash');assert.deepEqual(oldSnapshot.consents_snapshot,[]);
  await assert.rejects(prepare(),/설정/);
 });
 await test('prepare requires every applicable privacy consent even when the administrator marked it optional',async()=>{
  await save('settings',{applications_enabled:true,requests_enabled:true});
  form=await save('forms',{program:'fitness_golf',title:'격리 헬스·골프',signature_mode:'none',fields:[],active:true});
  for(const kind of ['privacy','rules'])programTerms.push(await save('terms',{program:'fitness_golf',title:`프로그램 ${kind}`,body:'격리 프로그램 안내',kind,required:false,approved:true,active:true}));
  const before=await count('ms_guest_submissions');
  await assert.rejects(prepare([]),/개인정보/);await assert.rejects(prepare([rules.id,...programTerms.filter(t=>t.kind==='rules').map(t=>t.id)]),/개인정보/);
  await assert.rejects(prepare([privacy.id]),/개인정보/);await assert.rejects(prepare(programTerms.filter(t=>t.kind==='privacy').map(t=>t.id)),/개인정보/);
  assert.equal(await count('ms_guest_submissions'),before);
  const t=await prepare([privacy.id,...programTerms.filter(t=>t.kind==='privacy').map(t=>t.id)]);assert.ok(t.ticket_id);
 });
 await test('request privacy keeps its existing optional-versus-required behavior',async()=>{
  const profile=person(),t=await guest('prepare',{kind:'request',phone:profile.phone,consents:[]});
  const category=(await rpc('member_service','public_home')).request_categories[0];
  const receipt=(await guest('submit_request',{...key(t),profile,category_id:category.id,title:'격리 건의',body:'선택 개인정보 동작 회귀',consents:[]})).receipt;assert.deepEqual(receipt.request.consents_snapshot,[]);
  await sql.query('update ms_terms set required=true where id=$1',[privacy.id]);
  await assert.rejects(guest('prepare',{kind:'request',phone:person().phone,consents:[]}),/개인정보/);
  await sql.query('update ms_terms set required=false where id=$1',[privacy.id]);
 });
 await test('guest submission rejects each missing privacy or rules checkbox and cash with no accepted record',async()=>{
  const t=await prepare(),before=await count('ms_applications');
  await assert.rejects(guest('submit_application',application(t,{consents:[]})),/각각|필수/);
  for(const missing of consents())await assert.rejects(guest('submit_application',application(t,{consents:consents().filter(id=>id!==missing)})),/각각|필수/);
  await assert.rejects(guest('submit_application',application(t,{payment_method:'cash'})),/카드 또는 계좌이체/);
  assert.equal((await sql.query('select status from ms_guest_submissions where id=$1',[t.ticket_id])).rows[0].status,'draft');assert.equal(await count('ms_applications'),before);
  const receipt=(await guest('submit_application',application(t))).receipt;assert.equal(receipt.application.payment_method,'card');assert.equal(receipt.application.consents_snapshot.length,4);assert.ok(receipt.application.consents_snapshot.every(term=>term.required===false));assert.equal(receipt.application.payment_status,'awaiting');
  assert.ok(!('bank_account' in receipt.settings));assert.equal(await count('ms_payments'),1);
 });
 await test('authenticated submission enforces the same mandatory consents and payment policy; card approval stays transactional',async()=>{
  const before=await count('ms_applications');
  for(const ids of [[],[privacy.id],[rules.id],...consents().map(missing=>consents().filter(id=>id!==missing))])await assert.rejects(member('application_submit',legacy({consents:ids}),MEMBER),/각각|필수/);
  await assert.rejects(member('application_submit',legacy({payment_method:'cash'}),MEMBER),/카드 또는 계좌이체/);assert.equal(await count('ms_applications'),before);
  const app=(await member('application_submit',legacy(),MEMBER)).application;assert.equal(app.payment_method,'card');assert.equal(app.consents_snapshot.length,4);
  await member('admin_action',{entity:'applications',id:app.id,operation:'approve',actual_amount:app.amount});
  assert.equal((await sql.query('select method from ms_payments where application_id=$1',[app.id])).rows[0].method,'card');
 });
 await test('transfer remains available with valid consents and only reports payment without creating a pass',async()=>{
  const t=await prepare();const before=await count('ms_payments');const receipt=(await guest('submit_application',application(t,{payment_method:'transfer'}))).receipt;assert.equal(receipt.settings.bank_account,'NOT-A-REAL-ACCOUNT');
  const reported=(await guest('payment_report',key(t))).receipt;assert.equal(reported.application.payment_status,'reported');assert.equal(await count('ms_payments'),before);
 });
 await test('preexisting cash receipts remain idempotent and manually processable with their original snapshots',async()=>{
  const replay=await guest('submit_application',{...key(oldTicket),payment_method:'cash',consents:[]});assert.equal(replay.duplicate,true);assert.deepEqual(replay.receipt.application,oldSnapshot);
  const created=await guestAdmin('admin_create_member',{id:oldTicket.ticket_id});await member('admin_action',{entity:'profiles',id:created.profile.id,operation:'verify'});await guestAdmin('admin_match',{id:oldTicket.ticket_id,member_id:created.profile.id});
  const app=(await guestAdmin('admin_convert',{id:oldTicket.ticket_id})).application;assert.equal(app.payment_method,'cash');assert.deepEqual(app.consents_snapshot,oldSnapshot.consents_snapshot);assert.deepEqual(app.form_snapshot,oldSnapshot.form_snapshot);
  await member('admin_action',{entity:'applications',id:app.id,operation:'approve',actual_amount:app.amount});assert.equal((await sql.query('select method from ms_payments where application_id=$1',[app.id])).rows[0].method,'cash');
  assert.equal((await guest('receipt',key(oldTicket))).receipt.application.payment_method,'cash');
 });
 await test('GX mandatory policy uses its own scope and preserves guardian conditions',async()=>{
  gxForm=await save('forms',{program:'gx',title:'격리 GX',signature_mode:'none',fields:[],active:true});
  const gxTerms=[];for(const kind of ['privacy','rules'])gxTerms.push(await save('terms',{program:'gx',title:`GX ${kind}`,body:'격리 GX 안내',kind,required:false,approved:true,active:true}));
  const guardian=await save('terms',{program:'gx',title:'보호자',body:'격리 어린이 보호자 안내',kind:'guardian',required:true,approved:true,active:true});
  const start=new Date(Date.now()+864000000).toISOString().slice(0,10),end=new Date(Date.now()+3456000000).toISOString().slice(0,10);
  gx=await save('gx_classes',{name:'동의검증 GX',class_name:'A',weekdays:[1,3],start_time:'10:00',period_start:start,period_end:end,price:40000,capacity:3,registration_start:new Date(Date.now()-3600000).toISOString(),registration_end:new Date(Date.now()+86400000).toISOString(),payment_due_hours:24,status:'open',reviewed:true});
  const ids=[privacy.id,rules.id,...gxTerms.map(t=>t.id)],t=await prepare(ids,'gx');
  const input=application(t,{product_id:null,gx_class_id:gx.id,consents:ids,expected_amount:gx.price,expected_catalog_updated_at:gx.updated_at,expected_form_id:gxForm.id});
  await assert.rejects(guest('submit_application',{...input,consents:ids.filter(id=>id!==gxTerms.find(x=>x.kind==='rules').id)}),/각각|필수/);
  const adult=(await guest('submit_application',input)).receipt;assert.ok(!adult.application.consents_snapshot.some(t=>t.id===guardian.id));
  gx=await save('gx_classes',{id:gx.id,is_child:true,guardian_terms:'격리 보호자 규정'});
  const child=await prepare(ids,'gx'),childInput={...input,...key(child),profile:child.profile,expected_catalog_updated_at:gx.updated_at,student_name:'격리 어린이',guardian_consent:true};
  await assert.rejects(guest('submit_application',childInput),/필수/);assert.equal((await guest('submit_application',{...childInput,consents:[...ids,guardian.id]})).receipt.application.guardian_consent,true);
 });
 await test('fresh-install source RPC definitions match the ordered targeted upgrades',async()=>{
  await sql.query(await fs.readFile('supabase/renewal-only.sql','utf8'));
  const definitions=(await sql.query("select proname,pg_get_functiondef(oid) definition from pg_proc where oid in ('public.member_service(text,jsonb)'::regprocedure,'public.guest_service(text,jsonb)'::regprocedure) order by proname")).rows;
  await sql.query(await fs.readFile('supabase/member-service.sql','utf8'));await sql.query(await fs.readFile('supabase/guest-service.sql','utf8'));
  const fresh=(await sql.query("select proname,pg_get_functiondef(oid) definition from pg_proc where oid in ('public.member_service(text,jsonb)'::regprocedure,'public.guest_service(text,jsonb)'::regprocedure) order by proname")).rows;assert.deepEqual(fresh,definitions);assert.deepEqual(await permissions(),aclBefore);
  const hashes=(await sql.query("select proname,md5(replace(prosrc,chr(13),'')) normalized_prosrc_md5 from pg_proc where oid in ('public.member_service(text,jsonb)'::regprocedure,'public.guest_service(text,jsonb)'::regprocedure) order by proname")).rows;console.log('FUNCTION_HASHES',JSON.stringify(hashes));
 });
}finally{await db.close();}
console.log(JSON.stringify({passed:results.filter(r=>r.passed).length,total:results.length,results},null,2));
if(results.some(r=>!r.passed))process.exit(1);
