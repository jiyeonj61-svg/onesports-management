import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { testDatabase } from './db-harness.mjs';

// Isolated local PostgreSQL only. Never uses config.js or a production connection.
const db = await testDatabase(), sql = db.client, results = [];
const ADMIN=randomUUID(), A=randomUUID(), B=randomUUID(), UNLINKED=randomUUID(), UNCONFIRMED=randomUUID(), ATTACKER=randomUUID();
async function as(user, callback) {
  await sql.query('begin');
  try {
    await sql.query(`set local role ${user ? 'authenticated' : 'anon'}`);
    await sql.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.role',$2,true)",[user||'',user?'authenticated':'anon']);
    const out=await callback(); await sql.query('commit'); return out;
  } catch(error) { await sql.query('rollback'); throw error; }
}
async function rawRpc(user, action, payload={}) {
  return as(user,async()=> (await sql.query('select public.member_service($1,$2::jsonb) result',[action,JSON.stringify(payload)])).rows[0].result);
}
async function rpc(user,action,payload={}) { const out=await rawRpc(user,action,payload); if(out.ok===false)throw new Error(out.error);return out; }
const save=(entity,data)=>rpc(ADMIN,'admin_save',{entity,data}).then(r=>r.item);
const adminAction=(entity,id,operation,extra={})=>rpc(ADMIN,'admin_action',{entity,id,operation,...extra}).then(r=>r.item);
const upload=(user,name)=>as(user,()=>sql.query("insert into storage.objects(bucket_id,name,owner_id,metadata) values('member-service-files',$1,$2,$3)",[name,user,JSON.stringify({mimetype:'image/jpeg',size:128})]));
const visible=(user,name)=>as(user,async()=> (await sql.query("select count(*)::int n from storage.objects where bucket_id='member-service-files' and name=$1",[name])).rows[0].n);
async function test(name,fn){try{await fn();results.push({name,passed:true});console.log('PASS',name);}catch(error){results.push({name,passed:false,error:error.message});console.error('FAIL',name,error.stack);}}
const today=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul'}).format(new Date());
const day=(n)=>{const d=new Date(today()+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);};
let ma,mb,product,privacy,rules,form,boardCategory,requestCategory;
const application=(user,extra={})=>rpc(user,'application_submit',{idempotency_key:randomUUID(),kind:'renewal',product_id:product.id,payment_method:'card',consents:[privacy.id,rules.id],form_values:{},...extra}).then(r=>r.application);
try {
  await sql.query(await fs.readFile('supabase/member-service.sql','utf8'));
  for (const [id,email,confirmed] of [[ADMIN,'admin@isolated.test',true],[A,'a@isolated.test',true],[B,'b@isolated.test',true],[UNLINKED,'new@isolated.test',true],[UNCONFIRMED,'not-confirmed@isolated.test',false],[ATTACKER,'attempts@isolated.test',true]]) {
    await sql.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,case when $3 then now() else null end)',[id,email,confirmed]);
  }
  await sql.query("insert into app_admins(user_id,display_name) values($1,'격리 테스트 관리자')",[ADMIN]);
  for (const [user,name] of [[A,'격리 회원 A'],[B,'격리 회원 B']]) {
    const p=await save('profiles',{name,building:'101',unit:user===A?'1001':'1002',phone:user===A?'010-0000-0001':'010-0000-0002'});
    await adminAction('profiles',p.id,'verify');
    const invite=await rpc(ADMIN,'issue_invite',{member_id:p.id});
    const linked=(await rpc(user,'activate_invite',{code:invite.code})).profile;
    if(user===A)ma=linked;else mb=linked;
  }
  privacy=await save('terms',{title:'격리 테스트 개인정보',body:'실제 운영에 사용하지 않는 격리 테스트 안내',kind:'privacy',required:true,approved:true,active:true});
  rules=await save('terms',{title:'격리 테스트 이용규정',body:'실제 운영에 사용하지 않는 격리 테스트 규정',kind:'rules',required:true,approved:true,active:true});
  form=await save('forms',{fields:[],active:true});
  await save('settings',{privacy_purpose:'격리 테스트',privacy_items:'테스트 회원',privacy_retention:'테스트 실행 동안',applications_enabled:true,requests_enabled:true});
  product=(await rpc(ADMIN,'admin_list',{entity:'products'})).items.find(p=>p.facility==='fitness'&&p.duration_days===30);
  product=await save('products',{id:product.id,active:true,reviewed:true});
  const home=await rpc(null,'public_home');boardCategory=home.categories[0].id;requestCategory=home.request_categories[0].id;

  await test('private bucket format limits and scoped upload authorization',async()=>{
    const bucket=(await sql.query("select * from storage.buckets where id='member-service-files'")).rows[0];
    assert.equal(bucket.public,false);assert.equal(Number(bucket.file_size_limit),8388608);assert.deepEqual(bucket.allowed_mime_types,['image/jpeg','image/png','image/webp']);
    await assert.rejects(upload(null,`requests/${A}/${randomUUID()}.jpg`));
    await assert.rejects(upload(B,`requests/${A}/${randomUUID()}.jpg`));
    await assert.rejects(upload(UNLINKED,`requests/${UNLINKED}/${randomUUID()}.jpg`));
    await assert.rejects(upload(UNCONFIRMED,`applications/${UNCONFIRMED}/${randomUUID()}.png`));
    await assert.rejects(upload(A,`posts/${randomUUID()}/${randomUUID()}.jpg`));
    await assert.rejects(upload(A,`requests/${A}/${randomUUID()}.svg`));
    await upload(A,`requests/${A}/${randomUUID()}.jpg`);
  });

  await test('draft, future, expired and archived board photos are unavailable to public visitors',async()=>{
    const id=randomUUID(), path=`posts/${id}/${randomUUID()}.jpg`;
    await upload(ADMIN,path);
    let post=await save('posts',{id,category_id:boardCategory,title:'격리 게시물',body:'개인정보 없는 테스트',photos:[path],status:'draft'});
    assert.equal(await visible(null,path),0);assert.equal(await visible(B,path),0);assert.equal(await visible(ADMIN,path),1);
    await assert.rejects(save('posts',{id,status:'published'}));
    post=await save('posts',{id,status:'published',preview_confirmed:true,publish_at:new Date(Date.now()+3600000).toISOString()});
    assert.equal(await visible(null,path),0);
    post=await save('posts',{id,status:'published',preview_confirmed:true,publish_at:new Date(Date.now()-7200000).toISOString(),expires_at:new Date(Date.now()-3600000).toISOString()});
    assert.equal(await visible(null,path),0);
    post=await save('posts',{id,status:'published',preview_confirmed:true,expires_at:null});
    assert.equal(await visible(null,path),1);assert.equal((await rpc(null,'public_home')).posts.filter(p=>p.id===id).length,1);
    await save('posts',{id,status:'archived'});assert.equal(await visible(null,path),0);
    await as(ADMIN,async()=>{const result=await sql.query("update storage.objects set metadata='{}' where name=$1",[path]);assert.equal(result.rowCount,0);});
    await as(ADMIN,async()=>{const result=await sql.query('delete from storage.objects where name=$1',[path]);assert.equal(result.rowCount,0);});
  });

  await test('private request and action photos never leak to another member; internal notes stay private',async()=>{
    const memberPath=`requests/${A}/${randomUUID()}.jpg`, actionPath=`requests/${ADMIN}/${randomUUID()}.jpg`;
    await upload(A,memberPath);await upload(ADMIN,actionPath);
    const request=(await rpc(A,'request_submit',{idempotency_key:randomUUID(),category_id:requestCategory,title:'개인 요청',body:'본인만 확인',photos:[memberPath],location:'테스트 위치'})).request;
    assert.equal(await visible(A,memberPath),1);assert.equal(await visible(B,memberPath),0);assert.equal(await visible(null,memberPath),0);
    await adminAction('requests',request.id,'update',{status:'reviewing',reply:'공개 답변',internal_note:'관리자만 보는 메모',action_photos:[actionPath],assignee:ADMIN});
    assert.equal(await visible(A,actionPath),1);assert.equal(await visible(B,actionPath),0);assert.equal(await visible(null,actionPath),0);
    const own=(await rpc(A,'my')).requests.find(r=>r.id===request.id);assert.equal(own.reply,'공개 답변');assert.ok(!JSON.stringify(own).includes('관리자만 보는 메모'));
    assert.equal((await rpc(B,'my',{member_id:ma.id})).requests.length,0);
    await assert.rejects(rpc(B,'request_submit',{idempotency_key:randomUUID(),category_id:requestCategory,title:'타인 사진',body:'거부됨',photos:[memberPath]}));
    const boardId=randomUUID();await assert.rejects(save('posts',{id:boardId,category_id:boardCategory,title:'재사용 차단',body:'별도 공개 사진 선택 필요',photos:[memberPath],status:'published',preview_confirmed:true}));
    const adminRows=(await rpc(ADMIN,'admin_list',{entity:'requests',location:'테스트',category_id:requestCategory,date_from:today(),date_to:today()})).items;
    assert.equal(adminRows.length,1);assert.equal(adminRows[0].internal_notes[0].body,'관리자만 보는 메모');
    assert.equal((await rpc(ADMIN,'admin_list',{entity:'requests',location:'다른 위치'})).items.length,0);
  });

  await test('unexposed tables, account-link fields and financial writes cannot be overposted',async()=>{
    for(const table of ['ms_profiles','ms_terms','ms_forms','ms_invites','ms_payments','ms_requests','ms_request_notes','ms_import_batches'])await assert.rejects(as(A,()=>sql.query(`select * from public.${table}`)),/permission denied/);
    await assert.rejects(save('profiles',{id:ma.id,user_id:B}));
    await assert.rejects(save('profiles',{id:ma.id,phone_verified:true}));
    await assert.rejects(rpc(A,'admin_action',{entity:'profiles',id:mb.id,operation:'verify'}));
    const app=await application(A,{payment_status:'confirmed',amount:1,pass_status:'applied',member_id:mb.id});
    assert.equal(app.amount,30000);assert.equal(app.payment_status,'awaiting');assert.equal(app.pass_status,'pending');assert.equal(app.member_id,ma.id);
    assert.equal((await rpc(A,'my')).payments.length,0);
    await adminAction('applications',app.id,'cancel',{note:'격리 테스트 종료'});
  });

  await test('dynamic form validates allowed keys/types, required values and optional empty selections',async()=>{
    await assert.rejects(save('forms',{active:true,fields:[{key:'payment_status',label:'권한 우회',type:'text'}]}));
    await assert.rejects(save('forms',{active:true,fields:[{key:'extra_x',label:'실행 코드',type:'javascript'}]}));
    await assert.rejects(save('forms',{active:true,fields:[{key:'extra_x',label:'선택',type:'select',options:[{html:'x'}]}]}));
    form=await save('forms',{active:true,fields:[{key:'extra_note',label:'필수 글',type:'text',required:true},{key:'extra_choice',label:'선택 항목',type:'select',required:false,options:['A','B']}]});
    await assert.rejects(application(A,{form_values:{}}));
    await assert.rejects(application(A,{form_values:{extra_note:'확인',unauthorized:'x'}}));
    await assert.rejects(application(A,{form_values:{extra_note:'확인',extra_choice:'UNKNOWN'}}));
    const app=await application(A,{form_values:{extra_note:'확인',extra_choice:''},expected_form_id:form.id});
    assert.equal(app.form_values.extra_choice,'');assert.equal(app.form_snapshot.id,form.id);
    await adminAction('applications',app.id,'cancel',{note:'격리 테스트 종료'});
    form=await save('forms',{active:true,fields:[]});
  });

  await test('stale catalog price, timestamp and form are rejected before a new application',async()=>{
    const oldProduct=product;
    product=await save('products',{id:product.id,price:32000});
    await assert.rejects(application(A,{expected_amount:oldProduct.price}),/변경/);
    await assert.rejects(application(A,{expected_amount:product.price,expected_catalog_updated_at:oldProduct.updated_at}),/변경/);
    await assert.rejects(application(A,{expected_form_id:randomUUID()}),/변경/);
    const app=await application(A,{expected_amount:product.price,expected_catalog_updated_at:product.updated_at,expected_form_id:form.id});
    assert.equal(app.amount,32000);await adminAction('applications',app.id,'cancel',{note:'격리 테스트 종료'});
  });

  await test('existing entitlement import is audited, requires verified resident and cannot overlap',async()=>{
    const unverified=await save('profiles',{name:'현장 미확인',building:'102',unit:'2001',phone:'010-0000-0003'});
    await assert.rejects(adminAction('profiles',unverified.id,'import_pass',{product_id:product.id,start_date:today(),end_date:day(10),note:'원본 대조'}));
    await assert.rejects(adminAction('profiles',ma.id,'import_pass',{product_id:product.id,start_date:today(),end_date:day(10),note:''}));
    const pass=await adminAction('profiles',ma.id,'import_pass',{product_id:product.id,start_date:day(-5),end_date:day(10),note:'별도 원본 대장 확인 — 테스트'});
    assert.equal(pass.source,'import');assert.equal(pass.application_id,null);
    assert.equal((await rpc(A,'my')).payments.length,0);
    await assert.rejects(adminAction('profiles',ma.id,'import_pass',{product_id:product.id,start_date:today(),end_date:day(20),note:'중복'}));
    await adminAction('passes',pass.id,'suspend',{note:'이용 연기 검토 — 기간 불변'});
    const app=await application(A);
    assert.equal(app.application_status,'needs_review');await assert.rejects(adminAction('applications',app.id,'approve',{actual_amount:app.amount}));
    await adminAction('passes',pass.id,'resume',{note:'확인 완료 — 기간 불변'});
    await assert.rejects(adminAction('applications',app.id,'approve',{actual_amount:app.amount,expected_start_date:today(),expected_end_date:day(29)}),/변경/);
    const final=await adminAction('applications',app.id,'approve',{actual_amount:app.amount,expected_start_date:day(11),expected_end_date:day(40)});
    assert.equal(final.final_start_date,day(11));assert.equal(final.final_end_date,day(40));
  });

  await test('GX requires complete operator values; guardian terms apply only to child classes',async()=>{
    const seed=(await rpc(ADMIN,'admin_list',{entity:'gx_classes'})).items[0];
    await assert.rejects(save('gx_classes',{id:seed.id,status:'open',reviewed:true}));
    const guardian=await save('terms',{title:'격리 보호자 안내',body:'격리 테스트 보호자 확인',kind:'guardian',required:true,approved:true,active:true});
    const adult=await application(B);assert.ok(!adult.consents_snapshot.some(t=>t.kind==='guardian'));await adminAction('applications',adult.id,'cancel',{note:'격리 테스트 종료'});
    const child=await save('gx_classes',{name:'격리 어린이 반',class_name:'A',weekdays:[6],start_time:'11:00',period_start:day(5),period_end:day(35),price:30000,capacity:2,registration_start:new Date(Date.now()-3600000).toISOString(),registration_end:new Date(Date.now()+86400000).toISOString(),payment_due_hours:24,status:'open',reviewed:true,is_child:true,guardian_terms:'보호자 계정으로 수강생을 신청합니다.'});
    await assert.rejects(application(B,{product_id:null,gx_class_id:child.id,student_name:'수강생',guardian_consent:true}));
    await assert.rejects(application(B,{product_id:null,gx_class_id:child.id,consents:[privacy.id,rules.id,guardian.id],student_name:'',guardian_consent:true}));
    const accepted=await application(B,{product_id:null,gx_class_id:child.id,consents:[privacy.id,rules.id,guardian.id],student_name:'테스트 수강생',guardian_consent:true});
    assert.equal(accepted.reservation_status,'reserved');assert.equal(accepted.student_name,'테스트 수강생');assert.equal(accepted.guardian_consent,true);
    assert.equal((await rpc(null,'public_home')).gx_classes.find(c=>c.id===child.id).remaining_seats,1);
  });

  await test('invites enforce confirmed email, recipient binding, expiry, single use and persisted attempt limits',async()=>{
    const target=await save('profiles',{name:'초대 테스트',building:'103',unit:'3001',phone:'010-0000-0004'});await adminAction('profiles',target.id,'verify');
    let invite=await rpc(ADMIN,'issue_invite',{member_id:target.id,email:'new@isolated.test'});
    assert.equal((await rawRpc(UNCONFIRMED,'activate_invite',{code:invite.code})).ok,false);
    assert.equal((await rawRpc(ATTACKER,'activate_invite',{code:invite.code})).ok,false);
    await sql.query("update ms_invites set expires_at=now()-interval '1 second' where member_id=$1",[target.id]);
    assert.equal((await rawRpc(UNLINKED,'activate_invite',{code:invite.code})).ok,false);
    invite=await rpc(ADMIN,'issue_invite',{member_id:target.id,email:'new@isolated.test'});
    assert.equal((await rpc(UNLINKED,'activate_invite',{code:invite.code})).profile.id,target.id);
    assert.equal((await rawRpc(ATTACKER,'activate_invite',{code:invite.code})).ok,false);
    for(let i=0;i<10;i++)await rawRpc(ATTACKER,'activate_invite',{code:'0'.repeat(64)});
    const limited=await rawRpc(ATTACKER,'activate_invite',{code:'0'.repeat(64)});assert.equal(limited.ok,false);assert.match(limited.error,/한도/);
    const attempts=(await sql.query("select sum(attempts)::int n from ms_rate_limits where actor_id=$1 and action='activate_invite'",[ATTACKER])).rows[0].n;assert.ok(attempts>10);
    const stored=(await sql.query('select code_hash from ms_invites where member_id=$1 order by created_at desc limit 1',[target.id])).rows[0].code_hash;assert.notEqual(stored,invite.code);
  });

  await test('CSV preview and idempotent commit do not merge or duplicate a replayed batch',async()=>{
    const rows=[{name:'격리 CSV',building:'104',unit:'4001',phone:'010-0000-0005'}],key=randomUUID();
    const preview=await rpc(ADMIN,'import_members',{rows,commit:false});assert.equal(preview.preview[0].errors.length,0);
    const before=(await sql.query('select count(*)::int n from ms_profiles')).rows[0].n;
    assert.equal((await sql.query('select count(*)::int n from ms_profiles')).rows[0].n,before);
    const first=await rpc(ADMIN,'import_members',{rows,commit:true,idempotency_key:key});assert.equal(first.inserted,1);
    const again=await rpc(ADMIN,'import_members',{rows,commit:true,idempotency_key:key,confirm_duplicates:true});assert.equal(again.duplicate,true);
    assert.equal((await sql.query('select count(*)::int n from ms_profiles')).rows[0].n,before+1);
    await assert.rejects(rpc(ADMIN,'import_members',{rows:[{...rows[0],name:'다른 파일'}],commit:true,idempotency_key:key,confirm_duplicates:true}));
    const dupPreview=await rpc(ADMIN,'import_members',{rows,commit:false});assert.equal(dupPreview.preview[0].duplicate_candidates.length,1);
    const invalid=await rawRpc(ADMIN,'import_members',{rows:[{name:'',phone:'1'}],commit:true});assert.equal(invalid.ok,false);
  });

  await test('collection settings cannot bypass privacy or payment safeguards',async()=>{
    await assert.rejects(save('settings',{privacy_retention:''}));
    await assert.rejects(save('settings',{payment_confirmation_required:false}));
    await assert.rejects(save('settings',{photo_limit:11}));
    await assert.rejects(save('settings',{photo_limit:null}));
    await assert.rejects(save('settings',{applications_enabled:'yes'}));
    await save('settings',{applications_enabled:false,requests_enabled:false});
    await assert.rejects(upload(A,`requests/${A}/${randomUUID()}.jpg`));
    await upload(ADMIN,`requests/${ADMIN}/${randomUUID()}.jpg`); // Existing backlog remains manageable while collection is closed.
    await assert.rejects(application(A));
    await assert.rejects(rpc(A,'request_submit',{idempotency_key:randomUUID(),category_id:requestCategory,title:'닫힌 접수',body:'거부됨',photos:[]}));
    assert.ok((await rpc(A,'my')).applications.length>0); // Own history survives feature shutdown.
  });

  await test('request photo upload requires an active approved privacy term as well as an open verified-member channel',async()=>{
    await save('settings',{requests_enabled:true});
    await upload(A,`requests/${A}/${randomUUID()}.jpg`);
    const currentPrivacy=await save('terms',{id:privacy.id,active:true,approved:true});
    // Model an operator migration retiring all privacy versions while the collection flag is still on.
    await sql.query("update ms_terms set active=false where kind='privacy'");
    await assert.rejects(upload(A,`requests/${A}/${randomUUID()}.jpg`));
    await sql.query('update ms_terms set active=true,approved=false where id=$1',[currentPrivacy.id]).then(()=>assert.fail('unapproved active term must be rejected'),error=>assert.match(error.message,/check constraint/));
    await upload(ADMIN,`requests/${ADMIN}/${randomUUID()}.jpg`);
    await sql.query('update ms_terms set active=true,approved=true where id=$1',[currentPrivacy.id]);
    await upload(A,`requests/${A}/${randomUUID()}.jpg`);
    await save('settings',{requests_enabled:false});
  });
} catch(error) {
  results.push({name:'test setup',passed:false,error:error.stack});console.error(error);
} finally {
  await fs.mkdir('work',{recursive:true});
  await fs.writeFile('work/backend-security-results.json',JSON.stringify({testedAt:new Date().toISOString(),isolated:true,results},null,2));
  await db.close();
}
console.log(`${results.filter(r=>r.passed).length}/${results.length} security groups passed`);
if(results.some(r=>!r.passed))process.exit(1);
