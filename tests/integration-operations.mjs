// REAL isolated PostgreSQL. No environment/database URL is read by this suite.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {testDatabase} from './db-harness.mjs';

const db=await testDatabase(),sql=db.client,results=[];
const A=randomUUID(),B=randomUUID(),ADMIN=randomUUID();
const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul'}).format(new Date());
async function asRole(role,fn){
 await sql.query('begin');
 try{await sql.query(`set local role ${role}`);await sql.query("select set_config('request.jwt.claim.sub',$1,true)",[role==='authenticated'?ADMIN:'']);const result=await fn();await sql.query('commit');return result;}
 catch(e){await sql.query('rollback');throw e;}
}
const call=(site,resource,action,payload={},role='service_role')=>asRole(role,async()=>
 (await sql.query('select public.integration_operations($1,$2,$3,$4::jsonb) result',[site,resource,action,JSON.stringify(payload)])).rows[0].result);
const create=(site,resource,data={})=>call(site,resource,'create',{request_id:randomUUID(),...data}).then(r=>r.item);
async function check(name,fn){try{await fn();results.push({name,passed:true});console.log('PASS',name);}catch(e){results.push({name,passed:false,error:e.message});console.error('FAIL',name,e.stack);}}
let areaA,areaB,issueA,inspectionA,legacyId,legacyArea;
try{
 await sql.query('create publication supabase_realtime');
 // setup.sql is destructive for an existing DB and is used ONLY in this new,
 // empty localhost test database to reproduce the repository legacy schema.
 await sql.query(await fs.readFile('supabase/setup.sql','utf8'));
 await sql.query(await fs.readFile('supabase/add-head-office-check.sql','utf8'));
 await sql.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',[ADMIN,'isolated-operator@example.test']);
 await sql.query("insert into app_admins(user_id,display_name) values($1,'Isolated operator')",[ADMIN]);
 legacyArea=(await sql.query('select id from areas order by id limit 1')).rows[0].id;
 legacyId=(await sql.query("insert into issues(title,description,area_id,received_date) values('Legacy public','Existing record',$1,$2) returning id",[legacyArea,today])).rows[0].id;
 await sql.query('create table public.calendar_tasks(id integer primary key,title text); insert into calendar_tasks values(7,\'Shared untouched\')');
 const migration=await fs.readFile('supabase/migrations/20261030_integration_operations.sql','utf8');
 await check('additive migration and rerun preserve legacy row and shared table',async()=>{
  await sql.query(migration);await sql.query(migration);
  const row=(await sql.query('select * from issues where id=$1',[legacyId])).rows[0];
  assert.equal(row.integration_site_id,null);assert.equal(row.title,'Legacy public');
  assert.equal((await sql.query('select title from calendar_tasks where id=7')).rows[0].title,'Shared untouched');
 });
 await check('anonymous and legacy authenticated users cannot call server RPC',async()=>{
  for(const role of ['anon','authenticated']) await assert.rejects(call(A,'areas','list',{},role),/permission denied/);
 });
 await check('site scope and resource/action/field allowlists reject spoofing',async()=>{
  await assert.rejects(call(null,'areas','list'),/Site scope/);
  await assert.rejects(call(A,'calendar_tasks','list'),/Unsupported/);
  await assert.rejects(call(A,'areas','truncate'),/Unsupported/);
  await assert.rejects(create(A,'areas',{name:'A',tenant_id:B}),/Unexpected write/);
 });
 await check('create isolated site areas and defaults',async()=>{
  areaA=await create(A,'areas',{name:'A gym',checklist:['Clean','Safe']});
  areaB=await create(B,'areas',{name:'B gym',checklist:['Clean']});
  assert.notEqual(areaA.id,areaB.id);assert.equal(areaA.integration_site_id,A);
  assert.equal((await call(A,'areas','list')).items.length,1);
 });
 await check('new integration rows cannot leak through legacy direct table policies',async()=>{
  for(const role of ['anon','authenticated']){
   const rows=await asRole(role,async()=>(await sql.query('select id from areas')).rows);
   assert.ok(!rows.some(r=>String(r.id)===String(areaA.id)));
  }
  assert.equal((await asRole('anon',async()=>(await sql.query('select title from issues where id=$1',[legacyId])).rows))[0].title,'Legacy public');
 });
 await check('staff-relevant operations share real scoped original tables',async()=>{
  inspectionA=await create(A,'inspections',{inspection_date:today,period:'AM',area_id:areaA.id,checked_items:['Clean'],item_statuses:{Clean:'normal'}});
  issueA=await create(A,'issues',{title:'Broken cable',description:'Needs repair',area_id:areaA.id,received_date:today});
  assert.equal(inspectionA.is_public,false);assert.equal(issueA.is_public,false);
  assert.equal((await sql.query('select count(*)::int n from issues where id=$1',[issueA.id])).rows[0].n,1);
 });
 await check('cross-site record reads, searches, changes and deletion denied',async()=>{
  await assert.rejects(call(B,'issues','get',{id:issueA.id}),/not found/);
  await assert.rejects(call(B,'issues','update',{id:issueA.id,title:'Changed'}),/not found/);
  await assert.rejects(call(B,'issues','delete',{id:issueA.id}),/not found/);
  assert.equal((await call(B,'issues','list',{search:'Broken'})).items.length,0);
  await assert.rejects(create(B,'inspections',{area_id:areaA.id}),/Area does not belong/);
  await assert.rejects(call(A,'issues','update',{id:issueA.id,area_id:areaB.id}),/Area does not belong/);
 });
 await check('legacy admin cannot modify integration rows directly or move site scope',async()=>{
  const changed=await asRole('authenticated',async()=>await sql.query("update issues set title='leak' where id=$1 returning id",[issueA.id]));
  assert.equal(changed.rowCount,0);
  await assert.rejects(asRole('authenticated',()=>sql.query('update issues set integration_site_id=$1 where id=$2',[A,legacyId])),/row-level security/);
 });
 await check('public projection requires explicit per-record visibility and strips staff data/files',async()=>{
  assert.equal((await call(A,'issues','public_list')).items.length,0);
  await call(A,'issues','update',{id:issueA.id,is_public:true,manager_name:'Self-entered author'});
  const row=(await call(A,'issues','public_list')).items[0];
  assert.equal(row.id,issueA.id);assert.equal('manager_name' in row,false);assert.equal('photo_paths' in row,false);assert.equal('integration_site_id' in row,false);
  assert.equal((await call(B,'issues','public_list')).items.length,0);
 });
 await check('idempotent create retries once and rejects altered payloads',async()=>{
  const payload={request_id:randomUUID(),name:'Retry area'};
  const first=await call(A,'areas','create',payload),second=await call(A,'areas','create',payload);
  assert.equal(first.item.id,second.item.id);
  await assert.rejects(call(A,'areas','create',{...payload,name:'Different'}),/Idempotency key reused/);
 });
 await check('all resource operations validate fields and preserve legacy fixed enums',async()=>{
  const inventory=await create(A,'inventories',{name:'Mats',record_date:today,quantity:'4',area_id:areaA.id});
  assert.equal(inventory.is_public,false);
  const updated=await call(A,'inventories','update',{id:inventory.id,status:'restocking'});assert.equal(updated.item.status,'restocking');
  const hq=await create(A,'head_office_checks',{title:'HQ visit',result:'Checked',check_date:today});assert.equal(hq.is_public,false);
  await call(A,'head_office_checks','update',{id:hq.id,is_public:true});assert.equal((await call(A,'head_office_checks','public_list')).items.length,1);
  await assert.rejects(create(A,'issues',{title:'Photo spoof',description:'x',photo_paths:['https://evil.test/a']}),/Unexpected write/);
  await assert.rejects(create(A,'head_office_checks',{title:'Bad',result:'x',status:'pending'}),/Unexpected write/);
  await assert.rejects(create(A,'inspections',{area_id:areaA.id,inspection_date:'2026-08-01'}),/Date outside/);
  await assert.rejects(create(A,'inspections',{area_id:areaA.id,inspection_date:'2099-01-01'}),/Date outside/);
 });
 await check('summary aggregates every scoped row at server KST date with fixed public-safe fields',async()=>{
  await create(A,'inspections',{inspection_date:today,period:'PM',area_id:areaA.id,status:'in_progress'});
  await create(B,'inspections',{inspection_date:today,period:'AM',area_id:areaB.id,status:'normal'});
  const summary=await call(A,'inspections','summary');
  assert.equal(summary.today,today);assert.equal(summary.inspectionCount,2);assert.equal(summary.completedCount,1);
  assert.equal(summary.expectedChecks,4);assert.equal(summary.openIssueCount,1);
  assert.equal(summary.recentHeadOfficeChecks.length,1);assert.equal('manager_name' in summary.recentHeadOfficeChecks[0],false);
  await assert.rejects(call(A,'issues','summary'),/Summary requires/);
  await assert.rejects(call(A,'inspections','summary',{site_id:B}),/Summary requires/);
 });
 await check('summary date range includes prior days and keeps site and default-today boundaries',async()=>{
  const previous=new Date(today+'T00:00:00Z');previous.setUTCDate(previous.getUTCDate()-1);const yesterday=previous.toISOString().slice(0,10);
  await create(A,'inspections',{inspection_date:yesterday,period:'AM',area_id:areaA.id,status:'completed'});
  const range=await call(A,'inspections','summary',{start:yesterday,end:today});
  assert.equal(range.today,today);assert.equal(range.periodStart,yesterday);assert.equal(range.periodEnd,today);
  assert.equal(range.inspectionCount,3);assert.equal(range.completedCount,2);
  assert.equal((await call(A,'inspections','summary')).inspectionCount,2);
  await assert.rejects(call(A,'inspections','summary',{start:today,end:yesterday}),/start must not exceed/);
 });
 await check('bounded pages return accurate scoped total even after the last page',async()=>{
  const first=await call(A,'areas','list',{limit:1,offset:0}),last=await call(A,'areas','list',{limit:1,offset:2});
  assert.equal(first.items.length,1);assert.equal(first.total,2);assert.equal(last.items.length,0);assert.equal(last.total,2);
  const publicIssues=await call(A,'issues','public_list',{limit:1});assert.equal(publicIssues.total,1);
  const notMatched=await call(A,'issues','list',{search:'not present'});assert.equal(notMatched.total,0);
  assert.equal((await call(A,'issues','list',{status:'received'})).total,1);
  assert.equal((await call(A,'issues','list',{status:'completed'})).total,0);
 });
 await check('optimistic update rejects stale timestamps without overwriting the newer edit',async()=>{
  const before=(await call(A,'issues','get',{id:issueA.id})).item;
  await call(A,'issues','update',{id:issueA.id,title:'First edit',expected_updated_at:before.updated_at,actor_type:'SITE_ADMIN',actor_id:ADMIN});
  await assert.rejects(call(A,'issues','update',{id:issueA.id,title:'Stale edit',expected_updated_at:before.updated_at}),e=>e.code==='40001');
  assert.equal((await call(A,'issues','get',{id:issueA.id})).item.title,'First edit');
 });
 await check('mapping API is not granted even to service_role',async()=>{
  await assert.rejects(asRole('service_role',()=>sql.query('select public.integration_map_legacy_records($1,$2,$3,$4)',[A,'[]','Test mapping evidence',ADMIN])),/permission denied/);
  await assert.rejects(asRole('service_role',()=>sql.query('select public.integration_map_legacy_records($1,$2,$3,$4,$5)',[A,'[]','Test mapping evidence',ADMIN,'better-auth'])),/permission denied/);
 });
 await check('external deployment approver is namespaced without inventing a Supabase user',async()=>{
  const owner=randomUUID();
  const row=(await sql.query("insert into areas(name,slug,sort_order) values('Reviewed external approver area','external-approver-test',900) returning id")).rows[0];
  const hash=(await sql.query("select encode(extensions.digest(convert_to((to_jsonb(t)-'integration_site_id'-'integration_legacy_record'-'integration_is_public')::text,'UTF8'),'sha256'),'hex') h from areas t where id=$1",[row.id])).rows[0].h;
  const manifest=JSON.stringify([{resource:'areas',id:String(row.id),sha256:hash}]);
  const map=namespace=>sql.query('select integration_map_legacy_records($1,$2::jsonb,$3,$4,$5)',[A,manifest,'Verified isolated Better Auth deployment owner evidence',owner,namespace]);
  await assert.rejects(map('supabase-auth'),/Verified Supabase/);
  await assert.rejects(map('unverified-provider'),/namespace/);
  await assert.rejects(map(null),/namespace/);
  await map('better-auth');
  const ledger=(await sql.query('select approved_by,approved_by_system from osi_legacy_mappings where resource=$1 and record_id=$2',['areas',String(row.id)])).rows[0];
  assert.deepEqual(ledger,{approved_by:owner,approved_by_system:'better-auth'});
  assert.equal((await sql.query('select actor_id from osi_operation_audit where action=$1 and record_id=$2',['legacy_mapping',String(row.id)])).rows[0].actor_id,`better-auth:${owner}`);
  assert.equal((await sql.query('select count(*)::int n from auth.users where id=$1',[owner])).rows[0].n,0);
 });
 await check('explicit manifest checks fingerprint, relationship and atomic retry',async()=>{
  const digest=async(resource,id)=>(await sql.query(`select encode(extensions.digest(convert_to((to_jsonb(t)-'integration_site_id'-'integration_legacy_record'-'integration_is_public')::text,'UTF8'),'sha256'),'hex') h from public.${resource} t where id::text=$1`,[String(id)])).rows[0].h;
  const areaEntry={resource:'areas',id:String(legacyArea),sha256:await digest('areas',legacyArea)};
  const issueEntry={resource:'issues',id:legacyId,sha256:await digest('issues',legacyId)};
  const originalIssue=(await sql.query('select updated_at,updated_by,photo_paths from issues where id=$1',[legacyId])).rows[0];
  const map=(manifest)=>sql.query('select public.integration_map_legacy_records($1,$2::jsonb,$3,$4) result',[A,JSON.stringify(manifest),'Isolated test verified mapping only',ADMIN]);
  await assert.rejects(map([issueEntry]),/Map the verified area first/);
  await assert.rejects(map([areaEntry,{...issueEntry,sha256:'0'.repeat(64)}]),/Record changed/);
  assert.equal((await sql.query('select integration_site_id from areas where id=$1',[legacyArea])).rows[0].integration_site_id,null);
  assert.equal((await map([areaEntry,issueEntry])).rows[0].result.mapped,2);
  assert.equal((await map([areaEntry,issueEntry])).rows[0].result.mapped,0);
  assert.deepEqual((await sql.query('select updated_at,updated_by,photo_paths from issues where id=$1',[legacyId])).rows[0],originalIssue);
  assert.equal((await call(A,'issues','get',{id:legacyId})).item.integration_legacy_record,true);
  assert.equal((await asRole('anon',async()=>(await sql.query('select id from issues where id=$1',[legacyId])).rows)).length,0);
 });
 await check('audit records omit payload contents and shared task unchanged',async()=>{
  assert.ok((await sql.query('select count(*)::int n from osi_operation_audit')).rows[0].n>5);
  assert.equal((await sql.query('select title from calendar_tasks where id=7')).rows[0].title,'Shared untouched');
 });
 await check('mapping preserves proven historical public predicates only with explicit per-row evidence',async()=>{
  const legacy=(await sql.query("insert into head_office_checks(check_date,title,result,photo_paths) values($1,'Historical public','Old completed result',ARRAY['2026-11/old.jpg']) returning id,updated_at",[today])).rows[0];
  const hash=(await sql.query("select encode(extensions.digest(convert_to((to_jsonb(t)-'integration_site_id'-'integration_legacy_record'-'integration_is_public')::text,'UTF8'),'sha256'),'hex') h from head_office_checks t where id=$1",[legacy.id])).rows[0].h;
  const entry={resource:'head_office_checks',id:legacy.id,sha256:hash};
  const map=manifest=>sql.query('select integration_map_legacy_records($1,$2::jsonb,$3,$4)',[A,JSON.stringify(manifest),'Historical source and policy reviewed in isolated test',ADMIN]);
  await assert.rejects(map([entry]),/historical visibility/);
  await map([{...entry,was_public:true,visibility_evidence:'Verified pre-migration head_office_checks_public_read: check_date >= 2026-09-01'}]);
  const publicRow=(await call(A,'head_office_checks','public_list',{id:legacy.id})).items[0];
  assert.equal(publicRow.legacy_photo_count,1);assert.equal('photo_paths' in publicRow,false);
  assert.equal(new Date((await call(A,'head_office_checks','get',{id:legacy.id})).item.updated_at).toISOString(),legacy.updated_at.toISOString());
  await assert.rejects(map([{...entry,was_public:false,visibility_evidence:'Changed mapping review should never silently override'}]),/already mapped differently/);
 });
}finally{
 await fs.mkdir('work',{recursive:true});await fs.writeFile('work/integration-test-results.json',JSON.stringify(results,null,2));
 process.exitCode=results.some(r=>!r.passed)?1:0;
 await db.close();
}
if(results.some(r=>!r.passed))process.exitCode=1;
