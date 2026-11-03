import test from 'node:test';
import assert from 'node:assert/strict';
import {adminEntryResponse} from '../admin-routing.mjs';
import {redirectLegacyAdmin} from '../assets/admin-entry.js';
import {integrationSettings} from '../assets/integration-public.js';

const env={LEGACY_INTEGRATION_ENABLED:'true',INTEGRATION_HQ_ORIGIN:'https://integrated.example.test'};
const config={integration:{enabled:true,siteId:'10000000-0000-4000-8000-000000000001',hqOrigin:env.INTEGRATION_HQ_ORIGIN}};
const response=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});

test('legacy administrator URL aliases redirect to the fixed integrated login without request data',()=>{
 for(const url of ['/admin','/admin/','/admin.html','/admin.html/','/admin/old/path','/admin.html/old/path']){
  const result=adminEntryResponse(new Request(`https://management.example.test${url}?next=https://attacker.test&token=do-not-forward`,{method:'POST',body:'password=synthetic'}),env);
  assert.equal(result.status,303);assert.equal(result.headers.get('location'),'https://integrated.example.test/staff/login');
  assert.match(result.headers.get('cache-control'),/no-store/);assert.equal(result.body,null);
 }
});
test('nonintegration administrator and member-public routes retain normal handling',()=>{
 assert.equal(adminEntryResponse(new Request('https://management.example.test/admin'),{...env,LEGACY_INTEGRATION_ENABLED:'false'}),null);
 for(const url of ['/','/members','/members/apply','/api/config','/administrator'])assert.equal(adminEntryResponse(new Request(`https://management.example.test${url}`),env),null);
});
test('invalid or missing integration origins fail closed with no open redirect or production fallback',()=>{
 for(const origin of ['', 'javascript:alert(1)', 'https://user:secret@integrated.example.test','https://integrated.example.test/?next=other','https://integrated.example.test/path']){
  const result=adminEntryResponse(new Request('https://management.example.test/admin'),{...env,VERCEL_ENV:'preview',INTEGRATION_HQ_ORIGIN:origin,API_ORIGIN_PRODUCTION:'https://production.example.test'});
  assert.equal(result.status,503);assert.equal(result.headers.get('location'),null);
 }
});
test('cached administrator page resolves deployment configuration before allowing any old auth flow',async()=>{
 const calls=[],redirects=[];
 const redirected=await redirectLegacyAdmin(async(url,options)=>{calls.push({url,options});return response(config);},url=>redirects.push(url));
 assert.equal(redirected,true);assert.deepEqual(redirects,['https://integrated.example.test/staff/login']);
 assert.equal(calls[0].url,'/api/config');assert.equal(calls[0].options.credentials,'omit');assert.equal(calls[0].options.cache,'no-store');
 assert.equal(await redirectLegacyAdmin(async()=>response({integration:{enabled:false}}),()=>assert.fail('Disabled integration must not redirect')),false);
});
test('cached administrator configuration failures never choose legacy or production fallback',async()=>{
 for(const reply of [()=>response({},200),()=>response({integration:{enabled:true}},200),()=>response(config,503),()=>Promise.reject(new Error('offline'))]){
  await assert.rejects(redirectLegacyAdmin(reply,()=>assert.fail('Invalid configuration must not redirect')));
 }
});
test('public staff entry uses only the explicitly configured integrated origin',()=>{
 assert.equal(integrationSettings(config.integration).staffUrl,'https://integrated.example.test/staff/login');
 assert.equal(integrationSettings({...config.integration,hqOrigin:'https://preview.example.test'}).staffUrl,'https://preview.example.test/staff/login');
 assert.throws(()=>integrationSettings({...config.integration,hqOrigin:''}));
});
