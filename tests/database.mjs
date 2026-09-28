import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {testDatabase} from './db-harness.mjs';

const db=await testDatabase();const sql=db.client;const results=[];
const A='a0000000-0000-4000-8000-000000000001',B='b0000000-0000-4000-8000-000000000001',ADMIN='f0000000-0000-4000-8000-000000000001',NEW='c0000000-0000-4000-8000-000000000001';
async function rpc(user,action,payload={},connection=sql){
  await connection.query('begin');
  try{
    await connection.query(`set local role ${user?'authenticated':'anon'}`);
    await connection.query("select set_config('request.jwt.claim.sub',$1,true), set_config('request.jwt.claim.role',$2,true)",[user||'',user?'authenticated':'anon']);
    const result=(await connection.query('select public.member_service($1,$2::jsonb) as result',[action,JSON.stringify(payload)])).rows[0].result;
    await connection.query('commit');
    if(result.ok===false)throw new Error(result.error);
    return result;
  }catch(error){await connection.query('rollback');throw error;}
}
const save=(entity,data)=>rpc(ADMIN,'admin_save',{entity,data}).then(v=>v.item);
const action=(entity,id,operation,more={})=>rpc(ADMIN,'admin_action',{entity,id,operation,...more}).then(v=>v.item);
async function check(name,fn){try{await fn();results.push({name,passed:true});console.log('PASS',name);}catch(error){results.push({name,passed:false,error:error.message});console.error('FAIL',name,error.message);}}
const kst=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul'}).format(new Date());
const day=(value,n)=>{const d=new Date(value+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10)};
let profileA,profileB,product,consents,transferApp,cardApp,request,boardCategory,requestCategory;
const application=(user,more={})=>rpc(user,'application_submit',{idempotency_key:randomUUID(),kind:'renewal',product_id:product.id,payment_method:'card',desired_start_date:kst(),consents,form_values:{},...more}).then(v=>v.application);
try{
  const migration=await fs.readFile('supabase/member-service.sql','utf8');
  await check('additive migration installs and reruns without overwriting initial state',async()=>{
    await sql.query(migration);await sql.query(migration);
    assert.equal((await sql.query('select count(*)::int n from ms_products')).rows[0].n,12);
    assert.equal((await sql.query('select count(*)::int n from ms_gx_classes')).rows[0].n,11);
  });
  await sql.query('insert into auth.users(id,email,email_confirmed_at) values ($1,$5,now()),($2,$6,now()),($3,$7,now()),($4,$8,now())',[A,B,ADMIN,NEW,'a@example.test','b@example.test','admin@example.test','new@example.test']);
  await sql.query("insert into app_admins(user_id,display_name) values($1,'격리 테스트 관리자')",[ADMIN]);
  await check('public defaults are safe and contain no active unreviewed prices or bank account',async()=>{
    const h=await rpc(null,'public_home');assert.equal(h.settings.main_title,'회원분들께 보고드립니다.');
    assert.equal(h.products.length,0);assert.equal(h.gx_classes.length,0);assert.equal(h.posts.length,0);assert.equal(h.settings.applications_enabled,false);assert.ok(!('bank_account' in h.settings));
    boardCategory=h.categories[0].id;requestCategory=h.request_categories[0].id;
    await assert.rejects(rpc(A,'admin_list',{entity:'profiles'}));
    await assert.rejects(rpc(null,'my'));
    await assert.rejects(save('settings',{applications_enabled:true}));
  });
  await check('onsite verification plus single-use invite links only intended confirmed account',async()=>{
    profileA=await save('profiles',{name:'테스트 A',building:'101',unit:'1001',phone:'010-0000-0001'});
    await assert.rejects(rpc(ADMIN,'issue_invite',{member_id:profileA.id}));
    profileA=await action('profiles',profileA.id,'verify');
    assert.equal(profileA.phone_verified,false);
    const invite=await rpc(ADMIN,'issue_invite',{member_id:profileA.id,email:'a@example.test'});
    assert.match(invite.code,/^[a-f0-9]{64}$/);
    await assert.rejects(rpc(B,'activate_invite',{code:invite.code}));
    assert.equal((await rpc(A,'activate_invite',{code:invite.code})).profile.id,profileA.id);
    await assert.rejects(rpc(B,'activate_invite',{code:invite.code}));
    profileB=await save('profiles',{name:'테스트 B',building:'101',unit:'1001',phone:'010-0000-0001'});
    await action('profiles',profileB.id,'verify');
    const inviteB=await rpc(ADMIN,'issue_invite',{member_id:profileB.id});
    await rpc(B,'activate_invite',{code:inviteB.code});
    assert.notEqual(profileA.id,profileB.id);
  });
  await check('only approved regulation versions and completed privacy settings permit collection',async()=>{
    const privacy=await save('terms',{title:'테스트 개인정보 안내',body:'격리 테스트에서만 사용되는 수집 목적·항목·기간 안내',kind:'privacy',required:true,approved:true,active:true});
    const rules=await save('terms',{title:'테스트 이용규정',body:'격리 테스트 이용규정 원문',kind:'rules',required:true,approved:true,active:true});
    consents=[privacy.id,rules.id];
    await save('forms',{fields:[],active:true});
    await save('settings',{privacy_purpose:'격리 테스트',privacy_items:'테스트 정보',privacy_retention:'테스트 종료까지',applications_enabled:true,requests_enabled:true});
    product=(await rpc(ADMIN,'admin_list',{entity:'products'})).items.find(v=>v.duration_days===30&&v.facility==='fitness');
    product=await save('products',{id:product.id,active:true,reviewed:true});
    await assert.rejects(application(A,{consents:[]}));
    await assert.rejects(application(A,{payment_method:'transfer'}));
    await save('settings',{bank_name:'테스트 전용 은행',bank_account:'TEST-NOT-A-REAL-ACCOUNT',bank_holder:'격리 테스트'});
  });
  await check('transfer submission and payment report never issue entitlement or confirm payment',async()=>{
    transferApp=await application(A,{payment_method:'transfer'});
    assert.equal(transferApp.amount,30000);assert.equal(transferApp.payment_status,'awaiting');
    assert.equal((await rpc(A,'my')).passes.length,0);
    const reported=(await rpc(A,'payment_report',{id:transferApp.id,payer_name:'테스트 A'})).application;
    assert.equal(reported.payment_status,'reported');assert.equal(reported.pass_status,'pending');
    assert.equal((await rpc(A,'my')).payments.length,0);assert.equal((await rpc(A,'my')).passes.length,0);
    await assert.rejects(rpc(B,'payment_report',{id:transferApp.id}));
    await assert.rejects(rpc(A,'admin_action',{entity:'applications',id:transferApp.id,operation:'approve',actual_amount:30000}));
  });
  await check('same application submission returns one record even with a second request key',async()=>{
    const second=await application(A,{payment_method:'transfer'});assert.equal(second.id,transferApp.id);
    assert.equal((await rpc(A,'my')).applications.length,1);
  });
  await check('two concurrent approvals create exactly one payment and one pass',async()=>{
    const c1=db.server.getPgClient('postgres'),c2=db.server.getPgClient('postgres');await Promise.all([c1.connect(),c2.connect()]);
    try{await Promise.all([c1,c2].map(c=>rpc(ADMIN,'admin_action',{entity:'applications',id:transferApp.id,operation:'approve',actual_amount:30000},c)));}finally{await Promise.all([c1.end(),c2.end()]);}
    const my=await rpc(A,'my');assert.equal(my.payments.length,1);assert.equal(my.passes.length,1);
    assert.equal(my.passes[0].end_date,day(my.passes[0].start_date,29));
    assert.equal(my.applications[0].external_status,'pending');
  });
  await check('card approval and all day-based terms append after the latest future approved pass',async()=>{
    let previous=(await rpc(A,'my')).passes[0].end_date;
    for(const days of [30,90,180,365]){
      let p=(await rpc(ADMIN,'admin_list',{entity:'products'})).items.find(v=>v.duration_days===days&&v.facility==='fitness');
      p=await save('products',{id:p.id,active:true,reviewed:true});
      cardApp=await application(A,{product_id:p.id});assert.equal(cardApp.payment_status,'awaiting');
      const final=await action('applications',cardApp.id,'approve',{actual_amount:p.price});
      assert.equal(final.final_start_date,day(previous,1));assert.equal(final.final_end_date,day(final.final_start_date,days-1));previous=final.final_end_date;
    }
  });
  await check('expired member and approval delay use approval date without backdating consumption',async()=>{
    const app=await application(B,{desired_start_date:day(kst(),-7)});
    await sql.query('update ms_applications set desired_start_date=$1,proposed_start_date=$1,proposed_end_date=$2 where id=$3',[day(kst(),-7),day(kst(),22),app.id]);
    const final=await action('applications',app.id,'approve',{actual_amount:30000});assert.equal(final.final_start_date,kst());assert.equal(final.final_end_date,day(kst(),29));
  });
  await check('amount mismatch is blocked and later catalog edits cannot change existing snapshots',async()=>{
    const app=await application(B,{desired_start_date:day(kst(),40)});
    await save('products',{id:product.id,price:31000});
    await assert.rejects(action('applications',app.id,'approve',{actual_amount:31000}));
    const preserved=(await rpc(B,'my')).applications.find(v=>v.id===app.id);assert.equal(preserved.amount,30000);assert.equal(preserved.product_snapshot.price,30000);
    const final=await action('applications',app.id,'approve',{actual_amount:30000});assert.equal(final.amount,30000);
  });
  await check('member A cannot directly select/update member B records or financial states',async()=>{
    await sql.query('begin');try{
      await sql.query('set local role authenticated');await sql.query("select set_config('request.jwt.claim.sub',$1,true)",[A]);
      await assert.rejects(sql.query('select id from ms_profiles'),/permission denied/);
    }finally{await sql.query('rollback');}
    await sql.query('begin');try{await sql.query('set local role authenticated');await sql.query("select set_config('request.jwt.claim.sub',$1,true)",[A]);await assert.rejects(sql.query("update ms_applications set payment_status='confirmed'"));}finally{await sql.query('rollback');}
    assert.equal((await rpc(B,'my',{member_id:profileA.id})).profile.id,profileB.id);
  });
  await check('private request, public reply and internal notes remain separately authorized',async()=>{
    request=(await rpc(A,'request_submit',{idempotency_key:randomUUID(),category_id:requestCategory,title:'격리 테스트 요청',body:'비공개 테스트 내용',photos:[]})).request;
    await action('requests',request.id,'update',{status:'reviewing',reply:'회원에게 보이는 답변',internal_note:'절대 회원에게 보이지 않는 메모'});
    const mine=await rpc(A,'my');assert.equal(mine.requests[0].reply,'회원에게 보이는 답변');assert.ok(!JSON.stringify(mine).includes('절대 회원에게'));
    assert.equal((await rpc(B,'my')).requests.length,0);assert.ok(!JSON.stringify(await rpc(null,'public_home')).includes('비공개 테스트 내용'));
    const admin=(await rpc(ADMIN,'admin_list',{entity:'requests'})).items;assert.ok(JSON.stringify(admin).includes('절대 회원에게'));
  });
  await check('only preview-confirmed published in-window posts and their files are public',async()=>{
    const post=await save('posts',{category_id:boardCategory,title:'격리 테스트 게시글',body:'공개 테스트 본문',status:'draft'});
    assert.equal((await rpc(null,'public_home')).posts.length,0);
    await assert.rejects(save('posts',{id:post.id,status:'published'}));
    await save('posts',{id:post.id,status:'published',preview_confirmed:true});assert.equal((await rpc(null,'public_home')).posts.length,1);
    await save('posts',{id:post.id,status:'archived'});assert.equal((await rpc(null,'public_home')).posts.length,0);
  });
  await check('GX parallel applications reserve at most capacity and waitlist cannot report payment',async()=>{
    const cls=await save('gx_classes',{name:'격리 GX',class_name:'A',weekdays:[1,3,5],start_time:'09:00',period_start:day(kst(),7),period_end:day(kst(),36),price:50000,capacity:1,registration_start:new Date(Date.now()-3600000).toISOString(),registration_end:new Date(Date.now()+86400000).toISOString(),payment_due_hours:24,waitlist_enabled:true,reviewed:true,status:'open'});
    const c1=db.server.getPgClient('postgres'),c2=db.server.getPgClient('postgres');await Promise.all([c1.connect(),c2.connect()]);let apps;
    try{apps=await Promise.all([[A,c1],[B,c2]].map(([user,c])=>rpc(user,'application_submit',{idempotency_key:randomUUID(),kind:'renewal',gx_class_id:cls.id,payment_method:'transfer',consents,form_values:{}},c).then(v=>({user,...v.application}))));}finally{await Promise.all([c1.end(),c2.end()]);}
    assert.equal(apps.filter(a=>a.reservation_status==='reserved').length,1);const waiting=apps.find(a=>a.reservation_status==='waitlisted');assert.ok(waiting);
    await assert.rejects(rpc(waiting.user,'payment_report',{id:waiting.id}));
    const reserved=apps.find(a=>a.reservation_status==='reserved');await rpc(reserved.user,'payment_report',{id:reserved.id});
    await sql.query("update ms_applications set reservation_expires_at=now()-interval '1 day' where id=$1",[reserved.id]);
    await assert.rejects(action('applications',waiting.id,'assign_seat'));
    assert.equal((await rpc(reserved.user,'my')).applications.find(v=>v.id===reserved.id).reservation_status,'reserved');
    await action('applications',reserved.id,'approve',{actual_amount:50000});
  });
  await check('paid cancellation preserves payment record and marks refund required',async()=>{
    const item=await action('applications',transferApp.id,'cancel',{note:'격리 테스트 취소 요청'});assert.equal(item.application_status,'refund_required');
    const my=await rpc(A,'my');assert.ok(my.payments.some(p=>p.application_id===transferApp.id&&p.refund_status==='required'));
  });
  await check('CSV preview validates and duplicate entries never merge distinct members',async()=>{
    const preview=await rpc(ADMIN,'import_members',{rows:[{name:'테스트 A',building:'101',unit:'1001',phone:'010-0000-0001'}],commit:false});assert.ok(preview.preview[0].duplicate_candidates.length>=2);
    await assert.rejects(rpc(ADMIN,'import_members',{rows:[{name:'테스트 A',building:'101',unit:'1001',phone:'010-0000-0001'}],commit:true}));
    const before=Number((await sql.query('select count(*) from ms_profiles')).rows[0].count);
    await rpc(ADMIN,'import_members',{rows:[{name:'테스트 A',building:'101',unit:'1001',phone:'010-0000-0001'}],commit:true,confirm_duplicates:true});
    assert.equal(Number((await sql.query('select count(*) from ms_profiles')).rows[0].count),before+1);
  });
  await check('settings and rule version changes preserve original application consents',async()=>{
    const before=(await rpc(A,'my')).applications.find(v=>v.id===transferApp.id).consents_snapshot;
    await save('terms',{title:'테스트 이용규정',body:'수정한 새 규정 원문',kind:'rules',required:true,approved:true,active:true});
    const after=(await rpc(A,'my')).applications.find(v=>v.id===transferApp.id).consents_snapshot;assert.deepEqual(after,before);
    await sql.query(migration);assert.equal((await rpc(null,'public_home')).products.find(v=>v.id===product.id).price,31000);
  });
}finally{
  await fs.mkdir('test-results',{recursive:true});await fs.writeFile('test-results/database.json',JSON.stringify({at:new Date().toISOString(),postgres:'17.6 local isolated',results},null,2));
  await db.close();
}
console.log(`${results.filter(r=>r.passed).length}/${results.length} passed`);if(results.some(r=>!r.passed))process.exit(1);
