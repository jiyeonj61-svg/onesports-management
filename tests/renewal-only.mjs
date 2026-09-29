import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {testDatabase} from './db-harness.mjs';

const PREDECESSOR='bd80333dd4ef431534f9c3e82c3f8217b97a1176';
const db=await testDatabase(),sql=db.client,ADMIN=randomUUID(),OLDUSER=randomUUID(),MEMBER=randomUUID(),UNLINKED=randomUUID(),results=[];
async function rpc(service,action,payload={},user=null){await sql.query('begin');try{await sql.query(`set local role ${user?'authenticated':'anon'}`);await sql.query("select set_config('request.jwt.claim.sub',$1,true)",[user||'']);const r=(await sql.query(`select public.${service}($1,$2::jsonb) result`,[action,JSON.stringify(payload)])).rows[0].result;await sql.query('commit');if(!r.ok)throw Error(r.error);return r;}catch(e){await sql.query('rollback');throw e;}}
const member=(action,payload={},user=ADMIN)=>rpc('member_service',action,payload,user);
const guest=(action,payload={})=>rpc('guest_service',action,payload);
const admin=(action,payload={})=>rpc('guest_service',action,payload,ADMIN);
const save=(entity,data)=>member('admin_save',{entity,data}).then(r=>r.item);
const count=table=>sql.query(`select count(*)::int n from ${table.includes('.')?table:`public.${table}`}`).then(r=>r.rows[0].n);
const permissions=()=>sql.query("select oid::regprocedure::text signature,proowner::regrole::text owner,proacl::text acl from pg_proc where oid in ('public.member_service(text,jsonb)'::regprocedure,'public.guest_service(text,jsonb)'::regprocedure) order by signature").then(r=>r.rows);
const key=t=>({ticket_id:t.ticket_id,receipt_key:t.receipt_key});
let seq=0;const person=()=>({name:`재등록격리${++seq}`,building:'101',unit:String(3000+seq),phone:'010'+String(40000000+seq)});
let privacy,rules,form,product,oldTicket,oldReceipt,oldLegacy,oldDraft,settingsBefore,aclBefore,renewTicket,renewReceipt;
const consents=()=>[privacy.id,rules.id];
async function prepare(profile=person()){return {...await guest('prepare',{kind:'application',program:'fitness_golf',phone:profile.phone,consents:consents()}),profile};}
const payload=(t,more={})=>({...key(t),profile:t.profile,kind:'renewal',product_id:product.id,payment_method:'card',consents:consents(),form_values:{},expected_amount:product.price,expected_catalog_updated_at:product.updated_at,expected_form_id:form.id,...more});
const legacy=(more={})=>({idempotency_key:randomUUID(),kind:'renewal',product_id:product.id,payment_method:'card',consents:consents(),form_values:{},expected_form_id:form.id,...more});
async function test(name,fn){try{await fn();results.push({name,passed:true});console.log('PASS',name);}catch(e){results.push({name,passed:false,error:e.message});console.error('FAIL',name,e.stack);}}
try{
 await sql.query(execFileSync('git',['show',`${PREDECESSOR}:supabase/member-service.sql`],{encoding:'utf8'}));await sql.query(execFileSync('git',['show',`${PREDECESSOR}:supabase/guest-service.sql`],{encoding:'utf8'}));
 for(const [id,name] of [[ADMIN,'admin'],[OLDUSER,'old-new'],[MEMBER,'member'],[UNLINKED,'unlinked']])await sql.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',[id,`${name}@renewal-isolated.test`]);
 await sql.query("insert into app_admins(user_id,display_name) values($1,'격리 관리자')",[ADMIN]);
 await sql.query("insert into ms_profiles(user_id,name,building,unit,phone,approved,resident_verified) values($1,'기존 회원','101','1001','01011111111',true,true)",[MEMBER]);
 privacy=await save('terms',{title:'격리 개인정보',body:'격리 개인정보 안내',program:'common',kind:'privacy',required:false,approved:true,active:true});rules=await save('terms',{title:'격리 규정',body:'격리 이용규정',program:'common',kind:'rules',required:false,approved:true,active:true});
 form=await save('forms',{program:'fitness_golf',title:'격리 재등록 양식',fields:[],signature_mode:'none',active:true});
 await save('terms',{title:'격리 헬스 규정',body:'격리 이용규정',program:'fitness_golf',kind:'rules',required:false,approved:true,active:true}).then(t=>{rules=t;});
 // Both common and program rules are mandatory; use one active rule for a focused kind-policy fixture.
 await sql.query("update ms_terms set active=false where program='common' and kind='rules'");
 product=await save('products',{id:'21000000-0000-4000-8000-000000000001',active:true,reviewed:true});
 await save('settings',{privacy_purpose:'격리 검증',privacy_items:'가짜 개인정보',privacy_retention:'테스트 중',applications_enabled:true,requests_enabled:true,bank_name:'TEST',bank_account:'NOT-A-REAL-ACCOUNT',bank_holder:'격리 테스트'});
 oldTicket=await prepare();oldReceipt=(await guest('submit_application',payload(oldTicket,{kind:'new'}))).receipt;
 const oldPayload=legacy({kind:'new',profile:person()});oldLegacy=(await member('application_submit',oldPayload,OLDUSER)).application;
 oldDraft=await prepare();
 await save('settings',{applications_enabled:false,requests_enabled:false});settingsBefore=(await member('admin_list',{entity:'settings'})).items[0];aclBefore=await permissions();
 await test('renewal-only upgrade is repeatable and preserves OFF switches, RPC ACLs and accepted new snapshots',async()=>{
  const migration=await fs.readFile('supabase/renewal-only.sql','utf8');assert.equal((migration.match(/create or replace function/g)||[]).length,2);await sql.query(migration);await sql.query(migration);
  assert.deepEqual((await member('admin_list',{entity:'settings'})).items[0],settingsBefore);assert.deepEqual(await permissions(),aclBefore);
  const unchanged=(await guest('receipt',key(oldTicket))).receipt;assert.deepEqual(unchanged.application,oldReceipt.application);assert.deepEqual(unchanged.profile_snapshot,oldReceipt.profile_snapshot);
  const current=(await member('my',{},OLDUSER)).applications.find(a=>a.id===oldLegacy.id);assert.deepEqual(current.form_snapshot,oldLegacy.form_snapshot);assert.deepEqual(current.consents_snapshot,oldLegacy.consents_snapshot);assert.equal(current.kind,'new');
 });
 await test('guest new, missing and invalid kind cannot finalize even a pre-upgrade draft or store applicant identity',async()=>{
  await save('settings',{applications_enabled:true,requests_enabled:true});
  const beforeProfiles=await count('ms_profiles'),beforeApps=await count('ms_applications'),beforeAuth=await count('auth.users');
  for(const kind of ['new',undefined,null,'','NEW','renewal ',0,'invalid'])await assert.rejects(guest('submit_application',payload(oldDraft,{kind})),/수기 이용신청서/);
  const row=(await sql.query('select * from ms_guest_submissions where id=$1',[oldDraft.ticket_id])).rows[0];assert.equal(row.status,'draft');assert.equal(row.profile_snapshot,null);assert.equal(row.application_payload,null);
  assert.equal(await count('ms_profiles'),beforeProfiles);assert.equal(await count('ms_applications'),beforeApps);assert.equal(await count('auth.users'),beforeAuth);
 });
 await test('legacy invalid/new submissions cannot create profiles or applications and unlinked renewal remains blocked',async()=>{
  const beforeProfiles=await count('ms_profiles'),beforeApps=await count('ms_applications');
  for(const user of [MEMBER,UNLINKED])for(const kind of ['new',undefined,null,'','invalid'])await assert.rejects(member('application_submit',legacy({kind,profile:person()}),user),/수기 이용신청서/);
  await assert.rejects(member('application_submit',legacy({profile:person()}),UNLINKED),/연결/);
  assert.equal(await count('ms_profiles'),beforeProfiles);assert.equal(await count('ms_applications'),beforeApps);assert.equal((await sql.query('select count(*)::int n from ms_profiles where user_id=$1',[UNLINKED])).rows[0].n,0);
 });
 await test('anonymous renewal records only its own input and does not auto-match or verify an existing contact',async()=>{
  const beforeProfiles=await count('ms_profiles'),beforeAuth=await count('auth.users'),beforeApps=await count('ms_applications');
  renewTicket=await prepare({...person(),phone:'01011111111'});
  renewReceipt=(await guest('submit_application',payload(renewTicket,{profile:{...renewTicket.profile,approved:true,resident_verified:true,user_id:ADMIN},member_id:randomUUID()}))).receipt;
  assert.equal(renewReceipt.application.kind,'renewal');assert.equal(renewReceipt.intake_status,'received');assert.deepEqual(renewReceipt.profile_snapshot,renewTicket.profile);
  assert.equal(await count('ms_profiles'),beforeProfiles);assert.equal(await count('auth.users'),beforeAuth);assert.equal(await count('ms_applications'),beforeApps);
  const record=(await admin('admin_detail',{id:renewTicket.ticket_id})).item;assert.equal(record.matched_member_id,null);assert.equal(record.linked_application_id,null);
  await assert.rejects(admin('admin_convert',{id:renewTicket.ticket_id}),/확인한 회원/);
 });
 await test('staff may import paper-era member details but must separately verify and match before approving renewal',async()=>{
  const created=await admin('admin_create_member',{id:renewTicket.ticket_id});assert.equal(created.profile.user_id,null);assert.equal(created.profile.approved,false);assert.equal(created.profile.resident_verified,false);
  await assert.rejects(admin('admin_match',{id:renewTicket.ticket_id,member_id:created.profile.id}),/현장 확인/);
  await member('admin_action',{entity:'profiles',id:created.profile.id,operation:'verify'});await admin('admin_match',{id:renewTicket.ticket_id,member_id:created.profile.id});
  const app=(await admin('admin_convert',{id:renewTicket.ticket_id})).application;assert.equal(app.kind,'renewal');assert.deepEqual(app.form_snapshot,renewReceipt.application.form_snapshot);assert.deepEqual(app.consents_snapshot,renewReceipt.application.consents_snapshot);
  assert.equal((await member('admin_action',{entity:'applications',id:app.id,operation:'approve',actual_amount:app.amount})).item.pass_status,'applied');
 });
 await test('accepted old new applications keep exact replay identity and their administrator processing path',async()=>{
  const countBefore=await count('ms_applications');
  const duplicate=await guest('submit_application',payload(oldTicket,{kind:'new'}));assert.equal(duplicate.duplicate,true);assert.deepEqual(duplicate.receipt,oldReceipt);
  const oldReplay=await member('application_submit',oldPayload,OLDUSER);assert.equal(oldReplay.duplicate,true);assert.equal(oldReplay.application.id,oldLegacy.id);assert.equal(oldReplay.application.kind,'new');assert.equal(await count('ms_applications'),countBefore);
  await member('admin_action',{entity:'profiles',id:oldLegacy.member_id,operation:'verify'});assert.equal((await member('admin_action',{entity:'applications',id:oldLegacy.id,operation:'approve',actual_amount:oldLegacy.amount})).item.pass_status,'applied');
  const created=await admin('admin_create_member',{id:oldTicket.ticket_id});await member('admin_action',{entity:'profiles',id:created.profile.id,operation:'verify'});await admin('admin_match',{id:oldTicket.ticket_id,member_id:created.profile.id});const app=(await admin('admin_convert',{id:oldTicket.ticket_id})).application;assert.equal(app.kind,'new');assert.deepEqual(app.form_snapshot,oldReceipt.application.form_snapshot);assert.deepEqual(app.consents_snapshot,oldReceipt.application.consents_snapshot);
  assert.equal((await member('admin_action',{entity:'applications',id:app.id,operation:'approve',actual_amount:app.amount})).item.pass_status,'applied');
 });
 await test('renewals retain mandatory consents, card/transfer policy and existing authenticated access',async()=>{
  const ticket=await prepare();await assert.rejects(guest('submit_application',payload(ticket,{consents:[]})),/각각|필수/);await assert.rejects(guest('submit_application',payload(ticket,{payment_method:'cash'})),/카드 또는 계좌이체/);
  assert.equal((await guest('submit_application',payload(ticket,{payment_method:'transfer'}))).receipt.application.kind,'renewal');
  const app=(await member('application_submit',legacy(),MEMBER)).application;assert.equal(app.kind,'renewal');assert.equal(app.payment_method,'card');
 });
 await test('fresh-install RPC bodies equal the ordered upgrade without ACL changes',async()=>{
  const query="select proname,pg_get_functiondef(oid) definition from pg_proc where oid in ('public.member_service(text,jsonb)'::regprocedure,'public.guest_service(text,jsonb)'::regprocedure) order by proname";
  const upgraded=(await sql.query(query)).rows;await sql.query(await fs.readFile('supabase/member-service.sql','utf8'));await sql.query(await fs.readFile('supabase/guest-service.sql','utf8'));assert.deepEqual((await sql.query(query)).rows,upgraded);assert.deepEqual(await permissions(),aclBefore);
  console.log('FUNCTION_HASHES',JSON.stringify((await sql.query("select proname,md5(replace(prosrc,chr(13),'')) normalized_prosrc_md5 from pg_proc where oid in ('public.member_service(text,jsonb)'::regprocedure,'public.guest_service(text,jsonb)'::regprocedure) order by proname")).rows));
 });
}finally{await db.close();}
console.log(JSON.stringify({passed:results.filter(r=>r.passed).length,total:results.length,results},null,2));
if(results.some(r=>!r.passed))process.exit(1);
