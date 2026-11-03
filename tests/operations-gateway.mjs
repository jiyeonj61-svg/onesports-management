import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHandler } from '../supabase/functions/onesports-operations/handler.js';

const pair=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
const publicKey=await crypto.subtle.exportKey('jwk',pair.publicKey);
const siteId='00000000-0000-4000-8000-000000000001';
const resource='issues';
async function fixture(){
  const calls=[];let responder=()=>Response.json({ok:true,items:[]});
  const handler=createHandler({supabaseUrl:'https://isolated-test.supabase.co',serviceKey:'synthetic-service-key',publicKey,environment:'local',fetcher:async(url,init)=>{calls.push({url,init});return responder(url,init);}});
  async function envelope(action,payload,delta={}){
    const now=Date.now(),message=JSON.stringify({version:1,projectRef:'isolated-test',environment:'local',issuedAt:now,expiresAt:now+30000,nonce:crypto.randomUUID(),action,payload,...delta});
    const signature=Buffer.from(await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},pair.privateKey,new TextEncoder().encode(message))).toString('base64url');
    return {message,signature};
  }
  const invoke=async(action,payload,delta)=>handler(new Request('https://gateway.invalid',{method:'POST',body:JSON.stringify(await envelope(action,payload,delta))}));
  return {handler,invoke,envelope,calls,respond:fn=>{responder=fn;}};
}
test('valid P256 signature forwards only scoped RPC',async()=>{const f=await fixture();const r=await f.invoke('rpc',{siteId,resource,action:'list',payload:{}});assert.equal(r.status,200);assert.equal(f.calls.length,1);assert.deepEqual(JSON.parse(f.calls[0].init.body),{p_site_id:siteId,p_resource:resource,p_action:'list',p_payload:{}});});
test('tampering cannot alter site or reach storage',async()=>{const f=await fixture();const e=await f.envelope('rpc',{siteId,resource,action:'list',payload:{}});e.message=e.message.replace(siteId,'00000000-0000-4000-8000-000000000002');const r=await f.handler(new Request('https://gateway.invalid',{method:'POST',body:JSON.stringify(e)}));assert.equal(r.status,401);assert.equal(f.calls.length,0);});
for(const [name,delta] of [['expired',{issuedAt:Date.now()-60000,expiresAt:Date.now()-1}],['future',{issuedAt:Date.now()+100000,expiresAt:Date.now()+130000}],['wrong project',{projectRef:'production-project'}],['wrong environment',{environment:'production'}],['unbounded lifetime',{expiresAt:Date.now()+1000000}]])test(name+' rejected before DB',async()=>{const f=await fixture();assert.equal((await f.invoke('rpc',{siteId,resource,action:'list',payload:{}},delta)).status,401);assert.equal(f.calls.length,0);});
test('arbitrary resource and destructive action rejected',async()=>{const f=await fixture();assert.equal((await f.invoke('rpc',{siteId,resource:'auth.users',action:'list',payload:{}})).status,400);assert.equal((await f.invoke('rpc',{siteId,resource,action:'delete',payload:{}})).status,400);assert.equal(f.calls.length,0);});
test('SQL diagnostics and keys do not leave gateway',async()=>{const f=await fixture();f.respond(()=>Response.json({code:'23505',message:'private data',details:'synthetic-service-key'},{status:409}));const r=await f.invoke('rpc',{siteId,resource,action:'create',payload:{}});assert.deepEqual(await r.json(),{code:'23505'});});
test('legacy identity requires live user AND app_admins membership',async()=>{const f=await fixture();let n=0;f.respond(()=>++n===1?Response.json({id:siteId,email:'synthetic@example.invalid'}):Response.json([]));assert.equal((await f.invoke('legacyIdentity',{accessToken:'synthetic-access-token-123456'})).status,403);assert.equal(f.calls.length,2);});
test('private record is never returned through public photo path',async()=>{const f=await fixture();f.respond(()=>Response.json({item:{integration_legacy_record:true,is_public:false,photo_paths:['known/photo.jpg']}}));assert.equal((await f.invoke('legacyPhoto',{siteId,resource,recordId:siteId,index:0,publicOnly:true})).status,404);assert.equal(f.calls.length,1);});
test('only stored legacy path can be fetched and output is no-store',async()=>{const f=await fixture();let n=0;f.respond(()=>++n===1?Response.json({item:{integration_legacy_record:true,is_public:true,photo_paths:['known/photo.jpg']}}):new Response(new Uint8Array([255,216,255]),{headers:{'Content-Type':'image/jpeg'}}));const r=await f.invoke('legacyPhoto',{siteId,resource,recordId:siteId,index:0,publicOnly:true});assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'private, no-store');assert.match(f.calls[1].url,/\/storage\/v1\/object\/authenticated\/management-photos\/known\/photo.jpg$/);});
test('stored path traversal rejected and non-legacy rows excluded',async()=>{for(const item of [{integration_legacy_record:true,photo_paths:['../secret']},{integration_legacy_record:false,photo_paths:['known/photo.jpg']}]){const f=await fixture();f.respond(()=>Response.json({item}));assert.equal((await f.invoke('legacyPhoto',{siteId,resource,recordId:siteId,index:0,publicOnly:false})).status,404);assert.equal(f.calls.length,1);}});
test('health proves signature/environment without reading data',async()=>{const f=await fixture();const r=await f.invoke('health',{});assert.equal(r.status,200);assert.equal(f.calls.length,0);});

test('resident service carries only signed site and staff actor to the fixed RPC',async()=>{
 const f=await fixture(),actorId=crypto.randomUUID(),payload={entity:'requests',limit:20};
 const r=await f.invoke('residentService',{siteId,actorId,service:'guest',action:'admin_list',payload});
 assert.equal(r.status,200);assert.equal(f.calls.length,1);
 assert.equal(f.calls[0].url,'https://isolated-test.supabase.co/rest/v1/rpc/osi_staff_resident_service');
 assert.deepEqual(JSON.parse(f.calls[0].init.body),{p_site_id:siteId,p_actor_id:actorId,p_service:'guest',p_action:'admin_list',p_payload:payload});
 assert.equal(r.headers.get('cache-control'),'private, no-store');
});
test('resident gateway rejects arbitrary RPC, scope and settings actions before storage',async()=>{
 const f=await fixture(),base={siteId,actorId:crypto.randomUUID(),service:'guest',action:'admin_list',payload:{}};
 for(const delta of [{siteId:'bad'},{actorId:'bad'},{service:'member_service'},{service:'__proto__'},{service:'member',action:'admin_save'},{action:'submit_request'},{payload:[]},{resource:'auth.users'}]){
  assert.equal((await f.invoke('residentService',{...base,...delta})).status,400);
 }
 assert.equal(f.calls.length,0);
});
test('resident readiness is a signed member read and does not enable settings writes',async()=>{
 const f=await fixture(),actorId=crypto.randomUUID(),status={center_name:'Synthetic center',applications_enabled:false,requests_enabled:true,programs:[{program:'fitness_golf',ready:false},{program:'gx',ready:true}],message:'접수 준비 상태를 확인해 주세요.'};
 f.respond(()=>Response.json({ok:true,status}));
 const r=await f.invoke('residentService',{siteId,actorId,service:'member',action:'status',payload:{}});
 assert.equal(r.status,200);assert.deepEqual(await r.json(),{ok:true,status});
 assert.deepEqual(JSON.parse(f.calls[0].init.body),{p_site_id:siteId,p_actor_id:actorId,p_service:'member',p_action:'status',p_payload:{}});
 assert.equal((await f.invoke('residentService',{siteId,actorId,service:'guest',action:'status',payload:{}})).status,400);
 assert.equal((await f.invoke('residentService',{siteId,actorId,service:'member',action:'admin_save',payload:{entity:'settings',data:{requests_enabled:true}}})).status,400);
 assert.equal(f.calls.length,1);
});
test('resident gateway signature binds staff identity and protects database diagnostics',async()=>{
 const f=await fixture(),base={siteId,actorId:crypto.randomUUID(),service:'guest',action:'admin_detail',payload:{id:siteId}};
 const envelope=await f.envelope('residentService',base);
 envelope.message=envelope.message.replace(base.actorId,crypto.randomUUID());
 assert.equal((await f.handler(new Request('https://gateway.invalid',{method:'POST',body:JSON.stringify(envelope)}))).status,401);
 assert.equal(f.calls.length,0);
 f.respond(()=>Response.json({code:'42501',message:'synthetic-private-person',details:'synthetic-service-key'},{status:403}));
 const r=await f.invoke('residentService',base);assert.equal(r.status,403);assert.deepEqual(await r.json(),{code:'42501'});
});

test('resident private image is resolved by SQL and relayed as bounded pixels without raw path',async()=>{
 const f=await fixture(),objectId=crypto.randomUUID(),path=`requests/${siteId}/${objectId}.png`;
 const bytes=Buffer.from('89504e470d0a1a0a001122','hex');
 f.respond((url)=>url.includes('/rpc/')?Response.json({ok:true,photo:{bucket:'member-service-files',path}}):new Response(bytes,{headers:{'Content-Type':'image/png'}}));
 const r=await f.invoke('residentService',{siteId,actorId:crypto.randomUUID(),service:'member',action:'photo',payload:{entity:'requests',id:siteId,kind:'photo',index:0}});
 assert.equal(r.status,200);const body=await r.json();assert.deepEqual(body,{ok:true,photo:{mime:'image/png',base64:bytes.toString('base64')}});
 assert.equal(f.calls[1].url,`https://isolated-test.supabase.co/storage/v1/object/authenticated/member-service-files/${path}`);
});
test('resident image reading preserves legacy jpeg extension compatibility',async()=>{
 const f=await fixture(),path=`requests/${siteId}/${crypto.randomUUID()}.jpeg`,bytes=Buffer.from('ffd8ff001122','hex');
 f.respond(url=>url.includes('/rpc/')?Response.json({ok:true,photo:{bucket:'member-service-files',path}}):new Response(bytes,{headers:{'Content-Type':'image/jpeg'}}));
 const r=await f.invoke('residentService',{siteId,actorId:crypto.randomUUID(),service:'member',action:'photo',payload:{entity:'requests',id:siteId,kind:'photo',index:0}});
 assert.equal(r.status,200);assert.deepEqual(await r.json(),{ok:true,photo:{mime:'image/jpeg',base64:bytes.toString('base64')}});
 assert.equal(f.calls[1].url,`https://isolated-test.supabase.co/storage/v1/object/authenticated/member-service-files/${path}`);
});
test('resident image relay rejects other buckets, traversal, HTML and oversize responses',async()=>{
 for(const variant of ['bucket','path','type','length']){
 const f=await fixture(),path=`requests/${siteId}/${crypto.randomUUID()}.png`;
 f.respond(url=>url.includes('/rpc/')?Response.json({ok:true,photo:{bucket:variant==='bucket'?'other':'member-service-files',path:variant==='path'?'../secret':path}}):new Response('<secret>',{headers:{'Content-Type':variant==='type'?'text/html':'image/png','Content-Length':variant==='length'?'9999999':'8'}}));
 const r=await f.invoke('residentService',{siteId,actorId:crypto.randomUUID(),service:'member',action:'photo',payload:{entity:'requests',id:siteId,kind:'photo',index:0}});
 assert.equal(r.status,503);assert.deepEqual(await r.json(),{code:'gateway_unavailable'});
 }
});
test('resident photo uploads require SQL-authorized parent path and original image bytes',async()=>{
 const f=await fixture(),path=`requests/${siteId}/${crypto.randomUUID()}.jpg`,bytes=Buffer.from('ffd8ff001122','hex');
 f.respond(url=>url.includes('/rpc/')?Response.json({ok:true,upload:true,photo:{bucket:'member-service-files',path,mime:'image/jpeg',bytes:bytes.length}}):Response.json({Key:path}));
 const r=await f.invoke('residentService',{siteId,actorId:crypto.randomUUID(),service:'member',action:'admin_upload_photo',payload:{entity:'requests',id:siteId,mime:'image/jpeg',base64:bytes.toString('base64'),purpose:'action'}});
 assert.equal(r.status,200);assert.equal(f.calls.length,2);assert.equal(f.calls[1].init.method,'POST');
 assert.equal(f.calls[1].init.headers['x-upsert'],'true');assert.deepEqual(Buffer.from(f.calls[1].init.body),bytes);
 assert.deepEqual(await r.json(),{ok:true,photo:{path,mime:'image/jpeg',bytes:bytes.length}});
});
test('mismatched upload parents and MIME signatures never reach Storage',async()=>{
 for(const mismatch of ['parent','signature']){
 const f=await fixture(),path=`requests/${mismatch==='parent'?crypto.randomUUID():siteId}/${crypto.randomUUID()}.jpg`;
 const bytes=Buffer.from('89504e470d0a1a0a','hex');
 f.respond(()=>Response.json({ok:true,upload:true,photo:{bucket:'member-service-files',path,mime:'image/jpeg',bytes:bytes.length}}));
 const r=await f.invoke('residentService',{siteId,actorId:crypto.randomUUID(),service:'member',action:'admin_upload_photo',payload:{id:siteId,mime:'image/jpeg',base64:bytes.toString('base64'),purpose:'action'}});
 assert.equal(r.status,503);assert.equal(f.calls.length,1);
 }
});
