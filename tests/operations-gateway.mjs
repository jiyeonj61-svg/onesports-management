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
