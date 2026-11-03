import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import {createPublicIntegrationAdapter,integrationSettings} from '../assets/integration-public.js';
import {createLegacyIntegrationAdapter} from '../assets/integration-legacy.js';
import {localISODate,addDays,monthRange,formatDateTime} from '../assets/common.js';

const SITE='10000000-0000-4000-8000-000000000001',ROW='20000000-0000-4000-8000-000000000001';
const config={enabled:true,siteId:SITE,hqOrigin:'https://hq.example.test'};
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
async function proxy(file,env,fetcher){const sandbox={module:{exports:{}},process:{env},URL,Buffer,AbortSignal,fetch:fetcher,require:createRequire(pathToFileURL(path.resolve(file)))};vm.runInNewContext(await fs.readFile(file,'utf8'),sandbox);return sandbox.module.exports;}
async function invoke(handler,url,{method='GET',headers={},body}={}){
 const request={url,method,headers,async *[Symbol.asyncIterator](){if(body)yield Buffer.from(JSON.stringify(body));}};
 const result={statusCode:200,headers:{},body:null,setHeader(k,v){this.headers[k.toLowerCase()]=v;},end(value){this.body=value===undefined?Buffer.alloc(0):Buffer.from(value);}};
 await handler(request,result);return {...result,json:()=>JSON.parse(result.body.toString())};
}

test('legacy integration requires explicit safe site and HQ configuration',()=>{
 assert.equal(createPublicIntegrationAdapter({enabled:false}),null);
 assert.throws(()=>integrationSettings({...config,siteId:'guess-by-site-name'}));
 for(const origin of ['javascript:alert(1)','https://user:password@hq.example.test','https://hq.example.test/?token=x','https://hq.example.test/other'])assert.throws(()=>integrationSettings({...config,hqOrigin:origin}));
 assert.equal(integrationSettings(config).hqUrl,`https://hq.example.test/hq/sites/${SITE}`);
});
test('public compatibility fetches all pages and converts counts to fixed scoped photo references',async()=>{
 const calls=[];const adapter=createPublicIntegrationAdapter(config,async(url,options)=>{
  calls.push({url,options});const offset=new URL(url,'https://local.test').searchParams.get('offset');
  return json({ok:true,total:2,items:offset==='0'?[{id:ROW,legacy_photo_count:1}]:[{id:'20000000-0000-4000-8000-000000000002',legacy_photo_count:0}]});
 });
 const rows=await adapter.list('issues',{start:'2026-11-01',end:'2026-11-03'});
 assert.equal(rows.length,2);assert.equal(calls.length,2);assert.ok(calls.every(c=>c.options.credentials==='omit'&&!c.options.headers));
 assert.equal(adapter.photoUrl(rows[0].photo_paths[0]),rows[0].photo_paths[0]);
 assert.equal(adapter.photoUrl('https://storage.example.test/raw.jpg'),'');
 assert.equal(adapter.photoUrl('/api/integration-public?resource=issues&recordId='+ROW+'&photoIndex=0&siteId=other'),'');
});
test('public API errors, incomplete pages and changing totals never become normal empty results',async()=>{
 await assert.rejects(createPublicIntegrationAdapter(config,async()=>json({error:'Unavailable'},503)).list('issues'));
 await assert.rejects(createPublicIntegrationAdapter(config,async()=>json({ok:true,total:2,items:[]})).list('issues'));
 let count=0;await assert.rejects(createPublicIntegrationAdapter(config,async()=>json({ok:true,total:++count===1?2:3,items:[{id:ROW}]})).list('issues'),/변경/);
});
test('public relay pins configured site, isolates staging and never forwards caller credentials',async()=>{
 const calls=[];const env={VERCEL_ENV:'production',LEGACY_INTEGRATION_ENABLED:'true',LEGACY_SITE_ID:SITE,API_ORIGIN_PRODUCTION:'https://production.example.test',API_ORIGIN_STAGING:'https://staging.example.test'};
 const handler=await proxy('api/integration-public.js',env,async(url,options)=>{calls.push({url:String(url),options});return json({ok:true,total:0,items:[]});});
 const response=await invoke(handler,'/api/integration-public?resource=issues&limit=20&offset=0',{headers:{authorization:'Bearer private-test-token',cookie:'private-test-cookie'}});
 assert.equal(response.statusCode,200);assert.ok(calls[0].url.includes(`/public/sites/${SITE}/issues`));assert.equal(calls[0].options.headers.Authorization,undefined);assert.equal(calls[0].options.headers.cookie,undefined);
 assert.equal((await invoke(handler,'/api/integration-public?resource=issues&siteId=other')).statusCode,400);
 assert.equal((await invoke(handler,'/api/integration-public?resource=issues',{method:'POST'})).statusCode,405);
 const unconfigured=await proxy('api/integration-public.js',{...env,VERCEL_ENV:'preview',API_ORIGIN_STAGING:''},()=>{throw new Error('Must not fallback');});
 assert.equal((await invoke(unconfigured,'/api/integration-public?resource=issues')).statusCode,503);
});
test('legacy scoped adapter never writes raw photo paths and sends original update version',async()=>{
 const calls=[];const adapter=createLegacyIntegrationAdapter(async()=>'synthetic.access.token',async(url,options)=>{
  calls.push({url,options});const body=options.body&&JSON.parse(options.body);
  if(options.method==='GET')return json({ok:true,total:1,items:[{id:ROW,title:'Old',updated_at:'2026-11-01T01:00:00Z',integration_legacy_record:true,photo_paths:['private-legacy-path.jpg']}]});
  return json({ok:true,item:{id:ROW,...body,updated_at:'2026-11-03T01:00:00Z'}});
 });
 const rows=await adapter.list('issues');assert.equal(rows[0].photo_paths[0],`legacy:issues:${ROW}:0`);
 await adapter.save('issues',{id:ROW,title:'Changed',photo_paths:rows[0].photo_paths,expected_updated_at:'2026-11-01T01:00:00Z'});
 const mutation=JSON.parse(calls[1].options.body);assert.equal(mutation.photo_paths,undefined);assert.equal(mutation.expected_updated_at,'2026-11-01T01:00:00Z');assert.equal(calls[1].options.headers.Authorization,'Bearer synthetic.access.token');assert.ok(!calls[1].url.includes('token'));
});
test('record-save/photo-upload partial failure retries original row and original file operation',async()=>{
 let writes=0,uploads=0;const uploadBodies=[];
 const adapter=createLegacyIntegrationAdapter(async()=>'synthetic.access.token',async(url,options)=>{
  const path=new URL(url,'https://local.test').searchParams.get('path');
  if(path==='files'){uploads++;uploadBodies.push(JSON.parse(options.body));return uploads===1?json({error:'Temporary failure'},503):json({id:'30000000-0000-4000-8000-000000000001'});}
  writes++;return json({ok:true,item:{id:ROW,title:'New',updated_at:'2026-11-03T01:00:00Z',photo_paths:[]}});
 });
 const refs=await adapter.stagePhotos([{name:'test.png'}],async()=>({mime:'image/jpeg',base64:'dGVzdA=='}));
 const payload={title:'New',description:'Synthetic local test',photo_paths:refs};
 await assert.rejects(adapter.save('issues',payload),/기록은 저장/);
 await adapter.save('issues',payload);assert.equal(writes,1);assert.equal(uploads,2);assert.equal(uploadBodies[0].idempotencyKey,uploadBodies[1].idempotencyKey);
 adapter.clear();
});
test('logout invalidates an in-flight private photo before a Blob URL is created',async()=>{
 let finish,started;const start=new Promise(resolve=>started=resolve);
 const adapter=createLegacyIntegrationAdapter(async()=>'synthetic.access.token',async()=>{started();return new Promise(resolve=>finish=resolve);});
 const loading=adapter.photoUrl(`legacy:issues:${ROW}:0`);await start;adapter.clear();finish(new Response(new Uint8Array([255,216,255]),{headers:{'Content-Type':'image/jpeg'}}));
 await assert.rejects(loading,/로그인 상태/);
});
test('retired legacy relay never forwards tokens, cookies, bodies or caller routes',async()=>{
 const calls=[];const handler=await proxy('api/integration-legacy.js',{VERCEL_ENV:'production',LEGACY_INTEGRATION_ENABLED:'true',INTEGRATION_HQ_ORIGIN:'https://hq.example.test',API_ORIGIN_PRODUCTION:'https://worker.example.test'},async(...args)=>{calls.push(args);throw new Error('Retired relay must not forward');});
 const headers={authorization:'Bearer synthetic.access.token',host:'management.example.test',origin:'https://management.example.test','content-type':'application/json',cookie:'must-not-forward'};
 for(const method of ['GET','POST','PATCH','DELETE']){
  const response=await invoke(handler,'/?path=../hq/settings&returnUrl=https://attacker.test',{method,headers,body:{title:'Synthetic'}});
  assert.equal(response.statusCode,410);assert.equal(response.json().loginUrl,'https://hq.example.test/staff/login');
 }
 assert.equal(calls.length,0);
 const unconfigured=await proxy('api/integration-legacy.js',{VERCEL_ENV:'preview',LEGACY_INTEGRATION_ENABLED:'true',API_ORIGIN_PRODUCTION:'https://production.example.test'},()=>{throw new Error('No production fallback');});
 assert.equal((await invoke(unconfigured,'/?path=session',{headers})).statusCode,503);
});
test('today and rendered timestamps use Korea while date-only calendar math does not shift',()=>{
 assert.equal(localISODate(new Date('2026-11-02T16:00:00Z')),'2026-11-03');
 assert.equal(addDays('2026-11-01',-1),'2026-10-31');assert.deepEqual(monthRange('2026-11'),{start:'2026-11-01',end:'2026-11-30',days:30});
 assert.match(formatDateTime('2026-11-02T16:00:00Z'),/11\. 03/);
});
