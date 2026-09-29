// Isolated UI fixtures: no real Auth, database, personal records or network writes.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
import { APPLICATION_DOCUMENTS } from '../assets/application-documents.js';

const original = readFileSync(new URL('../assets/members.js', import.meta.url),'utf8');
const source = original.replace(/^import[^\n]+\n/gm,'').replace(/boot\(\);\s*$/,'globalThis.inspect={state,route,renderHome,renderRenew,renderApplication,applicationForm,applicationDocument,applicationConsents,hasApplicationConsents,connection,signatureRequired,renderRequests,renderMy,collectionOpen,applicationCard,requestCard,selectionChanged,addDays,ensureTicket,submitApplication,submitRequest,lookupReceipt,receiptText};');
function harness() {
  const nodes = new Map();
  const node = () => ({innerHTML:'',textContent:'',hidden:false,setAttribute(){},removeAttribute(){},querySelectorAll(){return []},scrollIntoView(){}});
  for (const id of ['memberContent','memberNav','memberCenterName','memberContact','memberConnection','memberToast','memberSelectionDetail','memberDesiredDate','memberGuardianFields','memberPeriodPreview']) nodes.set(id,node());
  const handlers = {};
  const urls = [];
  const home = {settings:{applications_enabled:true,requests_enabled:true,transfer_available:true,photo_limit:3},categories:[],request_categories:[{id:'r',name:'필요한 물품'}],products:[{id:'p',name:'TEST 이용권',facility:'fitness',duration_days:30,price:30000,updated_at:'2026-09-28T01:00:00Z'}],gx_classes:[],posts:[],terms:[{id:'privacy',kind:'privacy',title:'개인정보',body:'TEST PRIVACY',required:true,active:true,approved:true},{id:'rules',kind:'rules',title:'이용규정',body:'TEST RULES',required:true,active:true,approved:true}],form:{id:'form',fields:[]}};
  home.form.program='common';home.form.signature_mode='none';home.forms=[home.form];home.form_programs=[];
  const box = {console,Intl,Date,Map,Promise,Set,URLSearchParams,URL,Blob,Image:class{},setTimeout,clearTimeout,APPLICATION_DOCUMENTS,
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
const formData = values => ({get:key=>values[key]??'',getAll:key=>key==='consents'?(values.consents??['privacy','rules']):[],has:key=>!!values[key]});
const secret = 'a'.repeat(64);

test('member public entry has no account or Auth call and keeps the requested board title',()=>{
  const {api,nodes}=harness();api.renderHome();
  assert.match(nodes.get('memberContent').innerHTML,/회원분들께 보고드립니다\./);
  assert.doesNotMatch(original,/signUp|signIn|auth\.|getClient|localStorage|sessionStorage|renderAuth|activate_invite/);
  assert.doesNotMatch(readFileSync(new URL('../members.html',import.meta.url),'utf8'),/로그인|memberAccount/);
});

test('disabled collection displays useful guest forms without accepting personal entry',()=>{
  const {api,home,nodes}=harness();home.settings.applications_enabled=false;home.settings.requests_enabled=false;
  for(const [render,kind] of [[()=>api.renderApplication('fitness_golf'),'application'],[()=>api.renderApplication('gx'),'application'],[api.renderRequests,'request']]){
    render();const html=nodes.get('memberContent').innerHTML;
    assert.match(html,new RegExp(`data-form="${kind}"`));
    assert.match(html,/name="name"/);assert.match(html,/name="phone"/);
    assert.match(html,/<fieldset class="member-form-fieldset" disabled>/);
    assert.match(html,/센터 설정 완료 후 접수 가능/);
    assert.doesNotMatch(html,/계정 만들기|로그인/);
  }
});

test('collection requires approved privacy and operational terms',()=>{
  const {api,home}=harness();assert.equal(api.collectionOpen('application','fitness_golf'),true);assert.equal(api.collectionOpen('request'),true);
  home.terms[0].approved=false;assert.equal(api.collectionOpen('application','fitness_golf'),false);assert.equal(api.collectionOpen('request'),false);
  home.terms[0].approved=true;home.terms[1].active=false;assert.equal(api.collectionOpen('application','fitness_golf'),false);assert.equal(api.collectionOpen('request'),true);
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

test('renewal menu links two separate application routes and preserves the pause footer',()=>{
  const {api,box,nodes}=harness();api.renderRenew();const html=nodes.get('memberContent').innerHTML;
  assert.match(html,/href="\/members\/renew\/fitness-golf"/);assert.match(html,/href="\/members\/renew\/gx"/);
  assert.doesNotMatch(html,/<form|name="selection"/);
  assert.match(html,/이용을 잠시 중단하는 이용 연기는 안내데스크로 문의해 주세요\. 02-826-8907/);
  for(const [path,value] of [['/members/renew','renew'],['/members/renew/fitness-golf','fitness_golf'],['/members/renew/gx/','gx']]){
    box.location.pathname=path;assert.equal(api.route(),value);
  }
});

test('program forms expose only their catalog and custom fields, without cash',()=>{
  const {api,home,nodes}=harness();
  home.gx_classes=[{id:'gx1',name:'TEST GX',class_name:'A',status:'open',registration_start:'2020-01-01',registration_end:'2099-01-01',weekdays:[2,4],start_time:'09:00',price:40000}];
  home.forms=[{id:'fitness-form',program:'fitness_golf',title:'센터 헬스 신청서',signature_mode:'none',fields:[{key:'fitness_only',type:'text',label:'FITNESS FIELD'}]},{id:'gx-form',program:'gx',title:'센터 GX 신청서',signature_mode:'none',fields:[{key:'gx_only',type:'text',label:'GX FIELD'}]}];
  api.renderRenew();assert.match(nodes.get('memberContent').innerHTML,/<h2>센터 헬스 신청서<\/h2>/);assert.match(nodes.get('memberContent').innerHTML,/<h2>센터 GX 신청서<\/h2>/);
  api.renderApplication('fitness_golf');let html=nodes.get('memberContent').innerHTML;
  assert.match(html,/<h1>센터 헬스 신청서<\/h1>/);assert.match(html,/value="product:p"/);assert.doesNotMatch(html,/value="gx:gx1"|name="extra_gx_only"/);assert.match(html,/name="extra_fitness_only"/);
  assert.match(html,/name="payment_method" value="card" checked/);assert.doesNotMatch(html,/name="payment_method" value="cash"|현장 현금결제/);assert.match(html,/name="payment_method" value="transfer"/);
  api.renderApplication('gx');html=nodes.get('memberContent').innerHTML;
  assert.match(html,/<h1>센터 GX 신청서<\/h1>/);assert.match(html,/value="gx:gx1"/);assert.doesNotMatch(html,/value="product:p"|name="extra_fitness_only"/);assert.match(html,/name="extra_gx_only"/);assert.match(html,/화·목/);
  assert.match(html,/id="memberDesiredDate" hidden/);
});

test('inactive specific form cannot fall back to common and specific rules are required',()=>{
  const {api,home}=harness();
  assert.equal(api.applicationForm('gx').id,'form');
  home.form_programs=['gx'];assert.equal(api.applicationForm('gx'),null);assert.equal(api.collectionOpen('application','gx'),false);
  home.forms.push({id:'gx-form',program:'gx',signature_mode:'none',fields:[]});
  assert.equal(api.applicationForm('gx').id,'gx-form');assert.equal(api.collectionOpen('application','gx'),false);
  home.terms.push({id:'gx-rules',program:'gx',kind:'rules',approved:true,active:true});
  assert.equal(api.collectionOpen('application','gx'),true);assert.equal(api.collectionOpen('application','fitness_golf'),true);
  home.terms[0].program='gx';assert.equal(api.collectionOpen('request'),false);assert.equal(api.collectionOpen('application','gx'),true);assert.equal(api.collectionOpen('application','fitness_golf'),false);
});

test('application consent scopes and request privacy do not leak across programs',()=>{
  const {api,home,nodes}=harness();
  home.terms.push(...['fitness_golf','gx'].flatMap(program=>['privacy','rules','guardian'].map(kind=>({id:`${program}-${kind}`,program,kind,title:`${program} ${kind}`,body:'TEST',approved:true,active:true,required:true}))));
  api.renderApplication('fitness_golf');let html=nodes.get('memberContent').innerHTML;
  assert.match(html,/value="fitness_golf-rules"/);assert.doesNotMatch(html,/value="gx-rules"|value="gx-guardian"|value="fitness_golf-guardian"/);
  api.renderApplication('gx');html=nodes.get('memberContent').innerHTML;
  assert.match(html,/value="gx-rules"/);assert.doesNotMatch(html,/value="fitness_golf-rules"|value="gx-guardian"/);
  api.renderRequests();html=nodes.get('memberContent').innerHTML;
  assert.match(html,/value="privacy"/);assert.doesNotMatch(html,/value="gx-privacy"|value="fitness_golf-privacy"|value="rules"/);
});

test('reference prices stay readable and draft agreements appear inside disabled application forms',()=>{
  const {api,home,nodes}=harness();home.settings.applications_enabled=false;home.products=[];home.terms=[];
  api.renderApplication('fitness_golf');const html=nodes.get('memberContent').innerHTML;
  const readOnly=html.slice(0,html.indexOf('<form class="member-form"'));
  assert.match(readOnly,/신청서 기준 요금표/);assert.match(readOnly,/515,000원/);assert.doesNotMatch(readOnly,/양도규정|data-consent-kind|<input/);
  const application=html.slice(html.indexOf('<form class="member-form"'));
  assert.match(application,/양도규정/);assert.match(application,/data-consent-kind="rules"/);assert.match(application,/data-consent-kind="privacy"/);
  assert.match(application,/<input type="checkbox" data-draft-consent="rules" disabled/);assert.match(application,/<input type="checkbox" data-draft-consent="privacy" disabled/);
  assert.doesNotMatch(application,/name="consents"|type="checkbox"[^>]*checked/);
  assert.match(html,/<fieldset class="member-form-fieldset" disabled>/);assert.doesNotMatch(html,/이 신청서의 상품·운영기간과 안내·동의 설정을 확인하고/);
  assert.doesNotMatch(api.applicationDocument('gx'),/515,000원/);assert.match(api.applicationDocument('gx'),/B \(초등반\)/);
  home.products=[{id:'live',name:'CURRENT PRICE',duration_days:30,price:123456}];home.forms=[{id:'fitness-form',program:'fitness_golf'}];
  home.terms=[{id:'live-rules',program:'fitness_golf',kind:'rules',title:'CURRENT RULES',body:'LATEST RULE BODY',active:true,approved:true},{id:'live-privacy',kind:'privacy',active:true,approved:true}];
  const updated=api.applicationDocument('fitness_golf')+api.applicationConsents('fitness_golf');assert.match(updated,/123,456원/);assert.match(updated,/LATEST RULE BODY/);assert.doesNotMatch(updated,/신청서 기준 요금표|515,000원|양도규정|보유기간을 확정|data-draft-consent/);
});

test('signature modes govern both rendering and submission before prepare',async()=>{
  const {api,home,nodes,box}=harness();
  for(const [mode,kind,required] of [['none','new',false],['new','new',true],['new','renewal',false],['always','new',true],['always','renewal',true]])assert.equal(api.signatureRequired({signature_mode:mode},kind),required);
  home.form.signature_mode='none';api.renderApplication('fitness_golf');assert.doesNotMatch(nodes.get('memberContent').innerHTML,/id="memberSignatureSection"/);
  home.form.signature_mode='new';api.renderApplication('fitness_golf');assert.match(nodes.get('memberContent').innerHTML,/id="memberSignatureSection" hidden/);
  home.form.signature_mode='always';api.renderApplication('fitness_golf');assert.match(nodes.get('memberContent').innerHTML,/id="memberSignatureSection" >/);
  let calls=0;box.guestService=async()=>{calls++;return {}};
  const form={dataset:{program:'fitness_golf'},elements:{selection:{value:'product:p'}}};
  await assert.rejects(api.submitApplication(form,formData({kind:'renewal',payment_method:'card'})),/신청자 서명/);assert.equal(calls,0);
});

test('ticket program is explicit and switching programs creates a fresh private ticket',async()=>{
  const {api,box}=harness();const calls=[];
  box.guestService=async(action,payload)=>{calls.push({action,payload});return {ticket_id:`ticket-${calls.length}`,receipt_no:'A-TEST',receipt_key:secret}};
  const form={dataset:{program:'fitness_golf'}};const data=formData({phone:'TEST'});
  const first=await api.ensureTicket(form,data,'application');await api.ensureTicket(form,data,'application');assert.equal(calls.length,1);assert.equal(calls[0].payload.program,'fitness_golf');
  form._signaturePhoto='old-signature';form.dataset.program='gx';const second=await api.ensureTicket(form,data,'application');
  assert.equal(calls.length,2);assert.equal(calls[1].payload.program,'gx');assert.notEqual(first.ticket_id,second.ticket_id);assert.equal(form._signaturePhoto,undefined);
});

test('application submit sends matching form snapshot, program and card payment',async()=>{
  const {api,home,box}=harness();const calls=[];
  home.forms.push({id:'fitness-form',program:'fitness_golf',signature_mode:'none',fields:[{key:'purpose',type:'text',required:true}]});
  home.terms.push({id:'fitness-rules',program:'fitness_golf',kind:'rules',active:true,approved:true});
  box.guestService=async(action,payload)=>{calls.push({action,payload});return action==='prepare'?{ticket_id:'ticket',receipt_no:'A-TEST',receipt_key:secret}:{receipt:{receipt_no:'A-TEST',kind:'application',status:'received',photos:[]}}};
  const form={isConnected:true,dataset:{program:'fitness_golf'},elements:{selection:{value:'product:p'}}};
  await api.submitApplication(form,formData({kind:'renewal',phone:'TEST',payment_method:'card',consents:['privacy','rules','fitness-rules'],extra_purpose:'TEST PURPOSE',desired_start_date:'2026-10-01'}));
  const sent=calls.find(call=>call.action==='submit_application').payload;
  assert.equal(sent.program,'fitness_golf');assert.equal(sent.expected_form_id,'fitness-form');assert.equal(sent.form_values.purpose,'TEST PURPOSE');assert.equal(sent.payment_method,'card');assert.equal(sent.product_id,'p');assert.equal(sent.gx_class_id,undefined);
  await assert.rejects(api.submitApplication({dataset:{program:'gx'},elements:{selection:{value:'product:p'}}},formData({kind:'new'})),/이용권 또는 GX 반을 선택/);
});

test('cash receipt does not offer transfer reporting or use a card-only instruction',()=>{
  const {api}=harness();api.state.receipt={settings:{bank_name:'TEST BANK',bank_account:'SECRET ACCOUNT',bank_holder:'TEST'}};
  const html=api.applicationCard({product_snapshot:{name:'TEST'},amount:30000,payment_method:'cash',application_status:'received',payment_status:'awaiting',pass_status:'pending',reservation_status:'none'});
  assert.match(html,/현금 \(기존 기록\)/);assert.doesNotMatch(html,/현장 현금결제|현금결제 후|SECRET ACCOUNT|data-form="payment-report"|카드결제 확인 후/);
});

test('both consent groups are unchecked mandatory controls even when database required flags are false',()=>{
  const {api,home}=harness();home.terms.forEach(term=>{term.required=false});
  const html=api.applicationConsents('fitness_golf');
  assert.match(html,/data-consent-kind="rules"/);assert.match(html,/data-consent-kind="privacy"/);
  assert.match(html,/name="consents" value="rules" required/);assert.match(html,/name="consents" value="privacy" required/);
  assert.doesNotMatch(html,/type="checkbox"[^>]*checked/);
  for(const ids of [[],['privacy'],['rules'],['privacy','unrelated-rules']])assert.equal(api.hasApplicationConsents(ids,'fitness_golf'),false);
  assert.equal(api.hasApplicationConsents(['privacy','rules'],'fitness_golf'),true);
  home.terms.push({id:'fitness-rules',program:'fitness_golf',kind:'rules',required:false,approved:true,active:true});
  assert.equal(api.hasApplicationConsents(['privacy','rules'],'fitness_golf'),false);
  assert.equal(api.hasApplicationConsents(['privacy','rules','fitness-rules'],'fitness_golf'),true);
  assert.equal(api.hasApplicationConsents(['privacy','rules'],'gx'),true);
});

test('application button stays disabled until both consent groups are checked and disables again when unchecked',()=>{
  const {api,box}=harness();
  const inputs=[{value:'privacy',checked:false},{value:'rules',checked:false}];
  const form={dataset:{program:'fitness_golf'},querySelectorAll:()=>inputs};
  const button={dataset:{unavailable:'false'},hasAttribute:()=>true,closest:()=>form};
  box.document.querySelectorAll=()=>[button];
  api.connection();assert.equal(button.disabled,true);
  inputs[0].checked=true;api.connection();assert.equal(button.disabled,true);
  inputs[1].checked=true;api.connection();assert.equal(button.disabled,false);
  inputs[0].checked=false;api.connection();assert.equal(button.disabled,true);
  inputs[0].checked=true;box.navigator.onLine=false;api.connection();assert.equal(button.disabled,true);
});

test('missing consent or a forged cash selection is rejected before transmitting personal data',async()=>{
  const {api,box}=harness();let calls=0;box.guestService=async()=>{calls++;return {}};
  const form={dataset:{program:'fitness_golf'},elements:{selection:{value:'product:p'}}};
  for(const ids of [[],['privacy'],['rules']])await assert.rejects(api.ensureTicket(form,formData({phone:'TEST',consents:ids}),'application'),/이용규정과 개인정보 안내를 모두/);
  await assert.rejects(api.submitApplication(form,formData({kind:'renewal',payment_method:'cash',consents:['privacy','rules']})),/카드결제 또는 계좌이체/);
  assert.equal(calls,0);
});
