// Isolated UI fixtures: no real Auth, database, personal records or network writes.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

const original = readFileSync(new URL('../assets/members.js', import.meta.url),'utf8');
const source = original.replace(/^import[^\n]+\n/,'').replace(/boot\(\);\s*$/,'globalThis.inspect={state,renderHome,renderRenew,renderRequests,renderMy,collectionOpen,applicationCard,requestCard,selectionChanged,addDays,ensureTicket,submitRequest,lookupReceipt,receiptText};');
function harness() {
  const nodes = new Map();
  const node = () => ({innerHTML:'',textContent:'',hidden:false,setAttribute(){},removeAttribute(){},querySelectorAll(){return []},scrollIntoView(){}});
  for (const id of ['memberContent','memberNav','memberCenterName','memberContact','memberConnection','memberToast','memberSelectionDetail','memberDesiredDate','memberGuardianFields','memberPeriodPreview']) nodes.set(id,node());
  const handlers = {};
  const urls = [];
  const home = {settings:{applications_enabled:true,requests_enabled:true,transfer_available:true,photo_limit:3},categories:[],request_categories:[{id:'r',name:'필요한 물품'}],products:[{id:'p',name:'TEST 이용권',facility:'fitness',duration_days:30,price:30000,updated_at:'2026-09-28T01:00:00Z'}],gx_classes:[],posts:[],terms:[{id:'privacy',kind:'privacy',title:'개인정보',body:'TEST PRIVACY',required:true,active:true,approved:true},{id:'rules',kind:'rules',title:'이용규정',body:'TEST RULES',required:true,active:true,approved:true}],form:{id:'form',fields:[]}};
  const box = {console,Intl,Date,Map,Promise,Set,URLSearchParams,URL,Blob,Image:class{},setTimeout,clearTimeout,
    navigator:{onLine:true},location:{pathname:'/members',hash:'',search:'',origin:'http://localhost'},
    history:{pushState(_state,_title,url){urls.push(url);box.location.pathname=url.split('?')[0];}},
    window:{addEventListener(name,cb){handlers[name]=cb},scrollTo(){},devicePixelRatio:1},
    document:{getElementById:id=>nodes.get(id),querySelectorAll:()=>[],addEventListener(name,cb){handlers[name]=cb}},
    service:async()=>home,guestService:async()=>({}),encodeGuestPhoto:async()=>({}),photoUrl:async()=>'',todayKst:()=> '2026-09-28',
    e:v=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;')};
  vm.createContext(box);vm.runInContext(source,box);
  const api=box.inspect;api.state.home=home;
  return {api,box,home,nodes,handlers,urls};
}
const formData = values => ({get:key=>values[key]??'',getAll:key=>key==='consents'?['privacy','rules']:[],has:key=>!!values[key]});
const secret = 'a'.repeat(64);

test('member public entry has no account or Auth call and keeps the requested board title',()=>{
  const {api,nodes}=harness();api.renderHome();
  assert.match(nodes.get('memberContent').innerHTML,/회원분들께 보고드립니다\./);
  assert.doesNotMatch(original,/signUp|signIn|auth\.|getClient|localStorage|sessionStorage|renderAuth|activate_invite/);
  assert.doesNotMatch(readFileSync(new URL('../members.html',import.meta.url),'utf8'),/로그인|memberAccount/);
});

test('disabled collection displays useful guest forms without accepting personal entry',()=>{
  const {api,home,nodes}=harness();home.settings.applications_enabled=false;home.settings.requests_enabled=false;
  for(const [render,kind] of [[api.renderRenew,'application'],[api.renderRequests,'request']]){
    render();const html=nodes.get('memberContent').innerHTML;
    assert.match(html,new RegExp(`data-form="${kind}"`));
    assert.match(html,/name="name"/);assert.match(html,/name="phone"/);
    assert.match(html,/<fieldset class="member-form-fieldset" disabled>/);
    assert.match(html,/센터 설정 완료 후 접수 가능/);
    assert.doesNotMatch(html,/계정 만들기|로그인/);
  }
});

test('collection requires approved privacy and operational terms',()=>{
  const {api,home}=harness();assert.equal(api.collectionOpen('application'),true);assert.equal(api.collectionOpen('request'),true);
  home.terms[0].approved=false;assert.equal(api.collectionOpen('application'),false);assert.equal(api.collectionOpen('request'),false);
  home.terms[0].approved=true;home.terms[1].active=false;assert.equal(api.collectionOpen('application'),false);assert.equal(api.collectionOpen('request'),true);
});

test('guest preview counts the first day without looking up existing passes',()=>{
  const {api,nodes}=harness();
  for(const [days,end] of [[30,'2026-10-30'],[90,'2026-12-29'],[180,'2027-03-29'],[365,'2027-09-30']])assert.equal(api.addDays('2026-10-01',days-1),end);
  api.state.mine={passes:[{end_date:'2030-01-01',facility:'fitness',status:'active'}]};
  api.selectionChanged({elements:{selection:{value:'product:p'},desired_start_date:{value:'2026-10-01'}}});
  const html=nodes.get('memberPeriodPreview').innerHTML;
  assert.match(html,/2026\.10\.01 ~ 2026\.10\.30/);assert.match(html,/관리자가 직접 확인/);assert.doesNotMatch(html,/2030/);
});

test('unassigned or waiting GX receipts never display a transfer account or report action',()=>{
  const {api}=harness();api.state.receipt={status:'submitted',settings:{bank_name:'TEST BANK',bank_account:'SECRET ACCOUNT',bank_holder:'TEST'}};
  const app={product_snapshot:{name:'<img onerror=evil()>'},amount:30000,payment_method:'transfer',application_status:'received',payment_status:'awaiting',pass_status:'pending',consents_snapshot:[]};
  for(const status of ['unassigned','waitlisted','expired']){
    const html=api.applicationCard({...app,reservation_status:status});assert.doesNotMatch(html,/SECRET ACCOUNT|data-form="payment-report"/);assert.match(html,/&lt;img onerror=evil\(\)&gt;/);
  }
  assert.match(api.applicationCard({...app,reservation_status:'none'}),/data-form="payment-report"/);
  assert.doesNotMatch(api.applicationCard({...app,reservation_status:'none',application_status:'needs_review'}),/SECRET ACCOUNT/);
});

test('request rendering escapes content and excludes internal staff notes',()=>{
  const {api}=harness();api.state.receipt={photos:[]};
  const html=api.requestCard({status:'received',title:'TEST',body:'<script>evil()</script>',reply:'PUBLIC REPLY',internal_notes:'PRIVATE STAFF NOTE'});
  assert.match(html,/&lt;script&gt;/);assert.match(html,/PUBLIC REPLY/);assert.doesNotMatch(html,/PRIVATE STAFF NOTE/);
});

test('receipt lookup accepts only receipt number and secret, never identity-based lookup',()=>{
  const {api,nodes}=harness();api.renderMy();const html=nodes.get('memberContent').innerHTML;
  assert.match(html,/name="receipt_no"/);assert.match(html,/name="receipt_key" type="password"/);
  assert.doesNotMatch(html,/name="name"|name="phone"|name="building"|name="unit"/);
});

test('closed settings block prepare before any guest API transmission',async()=>{
  const {api,home,box}=harness();home.settings.requests_enabled=false;let calls=0;box.guestService=async()=>{calls++;return {}};
  await assert.rejects(api.ensureTicket({},formData({phone:'TEST'}),'request'),/현재 접수 준비 중/);assert.equal(calls,0);
});

test('guest submit preserves ticket for retries and exposes key only after confirmed receipt',async()=>{
  const {api,box,urls,nodes}=harness();const calls=[];
  const receipt={receipt_no:'R-TEST',kind:'request',status:'submitted',profile_snapshot:{name:'TEST MEMBER'},request:{title:'TEST',body:'TEST BODY',status:'received'},photos:[],settings:{}};
  box.guestService=async(action,payload)=>{calls.push({action,payload});if(action==='prepare')return {ticket_id:'ticket',receipt_no:'R-TEST',receipt_key:secret};if(action==='submit_request')return {receipt};return {}};
  const form={isConnected:true,elements:{photos:{files:[]}}};const data=formData({phone:'TEST PHONE',name:'TEST MEMBER',building:'101',unit:'1001',category_id:'r',title:'TEST',body:'TEST BODY'});
  const ticket=await api.ensureTicket(form,data,'request');assert.equal(api.state.receiptKey,'');assert.equal(ticket.receipt_key,secret);
  await api.submitRequest(form,data);
  assert.equal(calls.filter(v=>v.action==='prepare').length,1);assert.equal(api.state.receiptKey,secret);
  assert.match(nodes.get('memberContent').innerHTML,/접수가 완료되었습니다/);
  assert.equal(urls.at(-1),'/members/my');assert(!urls.some(v=>v.includes(secret)));
  assert.doesNotMatch(api.receiptText(),/TEST PHONE|TEST MEMBER|\?receipt/);
});

test('failed submission never produces success state or reveals the prepared key',async()=>{
  const {api,box}=harness();
  box.guestService=async action=>{if(action==='prepare')return {ticket_id:'ticket',receipt_no:'R-TEST',receipt_key:secret};throw new Error('DB unavailable')};
  await assert.rejects(api.submitRequest({isConnected:true,elements:{photos:{files:[]}}},formData({phone:'TEST',title:'TEST',body:'TEST'})),/DB unavailable/);
  assert.equal(api.state.receipt,null);assert.equal(api.state.receiptKey,'');
});

test('late receipt lookup cannot restore data after the view is invalidated',async()=>{
  const {api,box}=harness();let resolve;box.guestService=()=>new Promise(done=>{resolve=done});
  const pending=api.lookupReceipt('R-TEST',secret);api.state.epoch++;
  resolve({receipt:{receipt_no:'R-TEST',profile_snapshot:{name:'OLD PRIVATE DATA'}}});await pending;
  assert.equal(api.state.receipt,null);assert.equal(api.state.receiptKey,'');
});

test('offline lookup view removes private receipt content',()=>{
  const {api,box,nodes,handlers}=harness();box.location.pathname='/members/my';box.navigator.onLine=false;
  api.state.receipt={profile_snapshot:{name:'PRIVATE MEMBER'}};api.state.receiptKey=secret;handlers.offline();
  assert.equal(api.state.receipt,null);assert.doesNotMatch(nodes.get('memberContent').innerHTML,/PRIVATE MEMBER/);assert.match(nodes.get('memberContent').innerHTML,/인터넷 연결이 필요합니다/);
});
