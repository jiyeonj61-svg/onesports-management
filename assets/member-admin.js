import { getClient, service, uploadPhoto, photoUrl, escapeHtml, todayKst } from './member-client.js';

const h = (value) => escapeHtml(String(value ?? ''));
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const arr = (value) => Array.isArray(value) ? value : [];
const money = (value) => `${Number(value || 0).toLocaleString('ko-KR')}원`;
const day = (value) => value ? String(value).slice(0, 10) : '미설정';
const stamp = (value) => value ? new Date(value).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) : '—';
const NAV = [['profiles','회원·이용권 관리'],['applications','신청·수납 관리'],['gx_classes','GX 수강 관리'],['posts','회원 안내 게시판 관리'],['requests','건의·민원 관리'],['settings','회원서비스 설정']];
const LABEL = { new:'새 신청', submitted:'새 신청', pending:'대기', pending_payment:'결제 대기', transfer_pending:'계좌이체 대기', card_pending:'현장 카드결제 대기', payment_requested:'입금 확인 요청', requested:'확인 요청', review:'확인 필요', on_hold:'확인 필요', hold:'보류', paid:'결제 확인', confirmed:'확인 완료', unpaid:'미확인', applied:'이용권 반영 완료', pending_apply:'이용권 반영 대기', completed:'처리 완료', approved:'승인', cancelled:'취소', refund_required:'환불 확인 필요', waiting:'대기접수', waitlisted:'대기접수', reserved:'임시 자리 확보', received:'접수 완료', reviewing:'확인 중', in_progress:'조치 중', resolved:'처리 완료', needs_info:'추가 확인 필요', rejected:'반영 어려움', draft:'임시저장', published:'게시 중', archived:'보관', inactive:'비활성', active:'활성', recruiting:'모집 중', open:'모집 중', closed:'마감', paused:'휴강', review_required:'검토 필요', verified:'현장 확인 완료', suspended:'이용 중지', transfer:'계좌이체', bank_transfer:'계좌이체', card:'현장 카드결제', onsite_card:'현장 카드결제', renewal:'재등록', new_member:'신규', fixed_days:'지정 일수', external_pending:'외부 출입 반영 대기', done:'완료', not_required:'해당 없음' };
Object.assign(LABEL, { needs_review:'확인 필요', awaiting:'결제 대기', reported:'입금 확인 요청', held:'보류', declined:'반영 어려움', revoked:'이용권 취소', expired:'기한 경과', none:'해당 없음', days:'지정 일수', fitness:'헬스', golf:'골프', fitness_golf:'헬스+골프' });
const label = (value) => LABEL[value] || value || '—';
const badge = (value) => `<span class="ms-badge ${['review','review_required','needs_info','on_hold','hold','pending','unpaid','draft'].includes(value) ? 'warn' : ['cancelled','refund_required','suspended'].includes(value) ? 'danger' : ['inactive','archived'].includes(value) ? 'muted' : ''}">${h(label(value))}</span>`;
const state = { initialized:false, active:null, lists:{}, settings:{}, generation:0, filters:{}, modal:null, settingsTab:'center' };

function errorText(error) { return error?.message || '서버에 연결하지 못했습니다. 저장되지 않았습니다. 다시 시도해 주세요.'; }
function alertIn(root, message, error = true) { const box = $('.ms-message', root); if (box) { box.className = `ms-message ${error ? 'ms-error' : 'ms-notice'}`; box.textContent = message; } }
function button(text, attrs = '', kind = 'soft-button') { return `<button type="button" class="${kind}" ${attrs}>${h(text)}</button>`; }
function options(values, current) { return values.map((v) => { const [value, text] = Array.isArray(v) ? v : [v, label(v)]; return `<option value="${h(value)}" ${String(current ?? '') === String(value) ? 'selected' : ''}>${h(text)}</option>`; }).join(''); }
function field(name, title, value = '', type = 'text', extra = '') { return `<label class="ms-field"><span>${h(title)}</span><input name="${h(name)}" type="${type}" value="${h(value)}" ${extra}></label>`; }
function textarea(name, title, value = '', extra = '') { return `<label class="ms-field ms-span"><span>${h(title)}</span><textarea name="${h(name)}" ${extra}>${h(value)}</textarea></label>`; }
function select(name, title, values, value = '') { return `<label class="ms-field"><span>${h(title)}</span><select name="${h(name)}">${options(values, value)}</select></label>`; }
function check(name, title, checked = false, extra = '') { return `<label class="ms-check"><input name="${h(name)}" type="checkbox" ${checked ? 'checked' : ''} ${extra}><span>${h(title)}</span></label>`; }
function formData(form) { const out = {}; for (const node of $$('[name]', form)) { if (node.type === 'file' || node.disabled) continue; out[node.name] = node.type === 'checkbox' ? node.checked : node.type === 'number' ? (node.value === '' ? null : Number(node.value)) : node.value.trim(); } return out; }
async function list(entity,query={}) { const generation=state.generation; const data = await service('admin_list', { entity,...query }); const items = arr(data.items); if(generation===state.generation) state.lists[entity] = items; return items; }
async function save(entity, data) { return service('admin_save', { entity, data }); }
async function action(entity, id, operation, more = {}) { return service('admin_action', { entity, id, operation, ...more }); }
function profile(id) { return arr(state.lists.profiles).find((p) => p.id === id) || {}; }
function memberText(item) { const p = item.member || profile(item.member_id || item.profile_id || item.id); return `${p.name || item.member_name || item.name || '회원'} · ${p.building || item.building || '—'}동 ${p.unit || item.unit || '—'}호`; }
function findItem(entity, id) { return arr(state.lists[entity]).find((item) => String(item.id) === String(id)); }
function section(entity) { return $(`#admin-view-ms-${entity}`); }
function closeDialog() { state.modal?.close(); state.modal?.remove(); state.modal = null; }
function dialog(title, body, onSubmit, submitLabel = '저장') {
  closeDialog();
  const node = document.createElement('dialog'); node.className = 'ms-dialog';
  node.innerHTML = `<div class="ms-dialog-head"><h2>${h(title)}</h2>${button('×','aria-label="닫기" data-close')}</div><div class="ms-dialog-body"><div class="ms-message" role="alert"></div><form>${body}${onSubmit ? `<div class="ms-dialog-footer">${button('닫기','data-close')}<button type="submit" class="primary-button">${h(submitLabel)}</button></div>` : ''}</form></div>`;
  node.addEventListener('click', (event) => { if (event.target.closest('[data-close]')) closeDialog(); });
  if (onSubmit) $('form', node).addEventListener('submit', async (event) => { event.preventDefault(); await busy(node, () => onSubmit(formData(event.currentTarget), event.currentTarget, node)); });
  node.addEventListener('close', () => { node.remove(); if (state.modal === node) state.modal = null; });
  document.body.append(node); state.modal = node; node.showModal(); return node;
}
async function busy(root, fn) { const controls = $$('button',root); controls.forEach((x) => x.disabled = true); alertIn(root,'',false); try { return await fn(); } catch (error) { alertIn(root,errorText(error)); return undefined; } finally { controls.forEach((x) => x.disabled = false); } }
function toolbar(title, subtitle, buttons = '') { return `<div class="ms-toolbar"><div><h2>${h(title)}</h2><p>${h(subtitle)}</p></div><div class="ms-actions">${buttons}${button('새로고침','data-ms-refresh')}</div></div><div class="ms-message" role="alert"></div>`; }
function filters(entity, statuses = [], extra = '') { const f = state.filters[entity] || {}; return `<form class="ms-filters" data-ms-filter><label class="ms-field ms-search"><span>검색</span><input name="search" placeholder="이름 · 동호수 · 전화번호 · 접수번호 · 제목" value="${h(f.search || '')}"></label>${statuses.length ? select('status','상태',[['','전체 상태'],...statuses],f.status || '') : ''}${extra}<button class="soft-button" type="submit">조회</button></form>`; }
function filterRows(entity, rows) { const f = state.filters[entity] || {}; return rows.filter((row) => { const p = row.member || profile(row.member_id); const text = [row.name,row.title,row.number,row.application_no,row.request_no,row.id,row.phone,row.building,row.unit,p.name,p.phone,p.building,p.unit,row.location].filter(Boolean).join(' ').toLowerCase(); const status = [row.status,row.application_status,row.payment_status,row.pass_status,row.fulfillment_status,row.reservation_status]; if(entity==='profiles')status.push(row.active===false ? 'suspended' : row.resident_verified ? 'verified' : 'pending'); if(entity==='applications'){if(['pending','new'].includes(row.application_status))status.push('submitted');if(row.payment_status==='awaiting' && !['cancelled','refund_required'].includes(row.application_status))status.push(row.payment_method==='transfer' ? 'transfer_pending' : 'card_pending');if(row.payment_status==='reported')status.push('payment_requested');if(row.application_status==='needs_review')status.push('review');if(row.payment_status==='confirmed' && row.pass_status!=='applied')status.push('pending_apply');} return (!f.search || text.includes(f.search.toLowerCase())) && (!f.status || status.includes(f.status)) && (!f.category || row.category_id === f.category) && (!f.location || String(row.location || '').includes(f.location)) && (!f.from || day(row.created_at) >= f.from) && (!f.to || day(row.created_at) <= f.to); }); }
function empty(text = '등록된 내역이 없습니다.') { return `<div class="ms-empty">${h(text)}</div>`; }
function statusGrid(item) { return `<div class="ms-status-grid"><div><span>신청</span><strong>${h(label(item.application_status || item.status))}</strong></div><div><span>결제 확인</span><strong>${h(label(item.payment_status==='awaiting' ? item.payment_method==='transfer' ? 'transfer_pending' : 'card_pending' : item.payment_status))}</strong></div><div><span>이용권 반영</span><strong>${h(label(item.pass_status==='pending' ? 'pending_apply' : item.pass_status || item.fulfillment_status))}</strong></div><div><span>외부 출입</span><strong>${h(label(item.external_status==='pending' ? 'external_pending' : item.external_status || 'external_pending'))}</strong></div></div>`; }
async function refresh(entity = state.active) {
  if (!entity) return;
  const root = section(entity); const generation = state.generation;
  $('.ms-content',root).innerHTML = empty('데이터를 불러오는 중입니다…');
  try {
    const deps = entity === 'profiles' ? ['profiles','passes','profile_changes','products'] : entity === 'applications' ? ['applications','profiles','passes'] : entity === 'requests' ? ['requests','profiles','categories','admins','settings'] : entity === 'posts' ? ['posts','categories','settings'] : entity === 'settings' ? ['settings','products','categories','terms','forms'] : ['gx_classes'];
    const f=state.filters[entity] || {}; const serverStatus=entity==='profiles' ? undefined : ({submitted:'pending',transfer_pending:'awaiting',card_pending:'awaiting',payment_requested:'reported',review:'needs_review',pending_apply:'confirmed'}[f.status] || f.status);
    const query={search:f.search || undefined,status:serverStatus || undefined,category_id:f.category || undefined,location:f.location || undefined,date_from:f.from || undefined,date_to:f.to || undefined};
    const results = await Promise.allSettled(deps.map((dep)=>list(dep,dep===entity ? query : {}))); const failed = results.find((r) => r.status === 'rejected'); if (failed) throw failed.reason;
    if (generation !== state.generation) return;
    if (state.lists.settings) state.settings = state.lists.settings[0] || {};
    render(entity);
  } catch (error) { if (generation !== state.generation) return; $('.ms-content',root).innerHTML = toolbar(NAV.find(([key])=>key===entity)?.[1] || '회원서비스','데이터와 입력 권한을 확인한 뒤 다시 시도해 주세요.') + empty('불러오지 못했습니다. 저장된 운영 데이터는 변경되지 않았습니다.'); alertIn(root,errorText(error)); }
}
function show(entity) { state.active = entity; $$('.admin-view').forEach((node) => { const active = node.dataset.adminView === `ms-${entity}`; node.hidden = !active; node.classList.toggle('active',active); }); $$('[data-admin-tab]').forEach((node) => node.classList.toggle('active',node.dataset.adminTab === `ms-${entity}`)); refresh(entity); }
export function clearMemberAdmin() { state.generation++; state.lists = {}; state.settings = {}; state.filters = {}; state.active = null; closeDialog(); NAV.forEach(([entity]) => { const content = $('.ms-content',section(entity) || document.createElement('div')); if (content) content.replaceChildren(); }); }
export function initMemberAdmin() {
  if (state.initialized) return;
  const nav = $('.admin-tabs'), main = $('.admin-main'); if (!nav || !main) return;
  state.initialized = true;
  nav.classList.add('ms-expanded-tabs');
  NAV.forEach(([entity,title]) => {
    const btn = document.createElement('button'); btn.className = 'admin-tab'; btn.type = 'button'; btn.dataset.adminTab = `ms-${entity}`; btn.textContent = title; btn.addEventListener('click', () => show(entity)); nav.append(btn);
    const root = document.createElement('section'); root.id = `admin-view-ms-${entity}`; root.className = 'admin-view ms-admin'; root.dataset.adminView = `ms-${entity}`; root.hidden = true;
    root.innerHTML = `<div class="ms-content"></div>`; main.append(root);
    root.addEventListener('click', (event) => handleClick(entity,event));
    root.addEventListener('submit', (event) => { if (!event.target.matches('[data-ms-filter]')) return; event.preventDefault(); state.filters[entity] = formData(event.target); refresh(entity); });
  });
  nav.addEventListener('click', (event) => { const tab = event.target.closest('[data-admin-tab]'); if (tab && !tab.dataset.adminTab.startsWith('ms-')) state.active = null; });
  let authUserId=null;
  getClient().then((client)=>{
    client.auth.onAuthStateChange((event,session)=>{
      const nextId=session?.user?.id || null;
      if(event==='SIGNED_OUT' || !nextId || (authUserId && authUserId!==nextId)) {
        clearMemberAdmin(); $('#adminApp')?.classList.add('hidden'); $('#loginScreen')?.classList.remove('hidden');
      }
      authUserId=nextId;
    });
  }).catch(()=>clearMemberAdmin());
  window.addEventListener('pagehide',clearMemberAdmin);
  window.addEventListener('pageshow',(event)=>{if(event.persisted){clearMemberAdmin();window.location.reload();}});
}

function render(entity) {
  const target = $('.ms-content',section(entity));
  if (entity === 'profiles') renderProfiles(target);
  if (entity === 'applications') renderApplications(target);
  if (entity === 'gx_classes') renderGx(target);
  if (entity === 'posts') renderPosts(target);
  if (entity === 'requests') renderRequests(target);
  if (entity === 'settings') renderSettings(target);
  if(entity!=='settings' && arr(state.lists[entity]).length>=1000) target.insertAdjacentHTML('afterbegin','<div class="ms-notice warning">현재 조건에 맞는 최신 1,000건을 표시합니다. 이전 기록은 이름·접수번호 검색 또는 기간 필터로 범위를 좁혀 조회하세요.</div>');
}

function renderProfiles(root) {
  const rows = filterRows('profiles',arr(state.lists.profiles)); const changes = arr(state.lists.profile_changes).filter((r) => r.status === 'pending');
  root.innerHTML = toolbar('회원·이용권 관리','현장 확인과 계정 연결을 분리해 관리합니다.',button('회원 추가','data-ms-command="new-profile"','primary-button')+button('CSV 가져오기','data-ms-command="csv"')) + `<div class="ms-notice">입주민 확인 후 일회성 초대코드를 발급하세요. 이름·연락처가 같아도 회원정보를 자동 병합하지 않습니다.</div>` + filters('profiles',['pending','verified','suspended']) + (changes.length ? `<article class="ms-card"><h3>회원정보 변경 확인 ${changes.length}건</h3>${changes.map((c) => `<p>${h(memberText(c))} ${button('변경 요청 검토',`data-ms-command="profile-change" data-id="${h(c.id)}"`)}</p>`).join('')}</article>` : '') + `<p class="ms-count">${rows.length}명</p><div class="ms-grid">${rows.map((p) => { const passes = arr(state.lists.passes).filter((t) => t.member_id === p.id); return `<article class="ms-card"><div class="ms-card-heading"><h3>${h(p.name)}</h3>${badge(p.status || (p.active === false ? 'suspended' : p.resident_verified ? 'verified' : 'pending'))}</div><p>${h(p.building)}동 ${h(p.unit)}호 · ${h(p.phone)}</p><p class="ms-meta">계정 ${p.user_id ? '연결됨' : '미연결'} · 입주민 ${p.resident_verified ? '확인' : '미확인'} · 휴대폰 ${p.phone_verified ? '확인' : '별도 확인 필요'}</p>${passes.slice(-3).map((t) => `<p class="ms-meta">${h(t.product_name || t.name || t.facility || '이용권')} · ${h(day(t.start_date))} ~ ${h(day(t.end_date))} ${badge(t.status)}</p>`).join('') || '<p class="ms-meta">등록된 이용권 없음</p>'}<div class="ms-actions">${button('상세·수정',`data-ms-command="edit-profile" data-id="${h(p.id)}"`)}${button('현장 확인',`data-ms-command="verify" data-id="${h(p.id)}"`)}${button('초대코드 발급',`data-ms-command="invite" data-id="${h(p.id)}"`)}${button('기존 이용권 이관',`data-ms-command="import-pass" data-id="${h(p.id)}"`)}</div></article>`; }).join('')}</div>` + (!rows.length ? empty() : '');
}
function renderApplications(root) {
  const rows = filterRows('applications',arr(state.lists.applications));
  root.innerHTML = toolbar('신청·수납 관리','결제 확인 후 이용권을 한 번만 반영하며, 외부 출입 반영은 따로 기록합니다.') + filters('applications',['submitted','transfer_pending','payment_requested','card_pending','review','pending_apply','completed','cancelled','refund_required','waitlisted']) + `<p class="ms-count">${rows.length}건 · 계좌이체 확인 요청을 누르지 않은 신청도 표시됩니다.</p><div class="ms-grid">${rows.map((a) => `<article class="ms-card"><div class="ms-card-heading"><h3>${h(a.application_no || a.number || String(a.id).slice(0,8))}</h3>${badge(a.kind === 'new' ? 'new_member' : 'renewal')}</div><p>${h(memberText(a))}</p><p><strong>${h(a.product_name || a.product_snapshot?.name || a.snapshot?.name || '신청 이용권')}</strong> · ${money(a.amount ?? a.price ?? a.product_snapshot?.price)}</p><p class="ms-meta">${h(label(a.payment_method))} · 입금자 ${h(a.payer_name || '—')}<br>예정 ${h(day(a.proposed_start_date || a.start_date))} ~ ${h(day(a.proposed_end_date || a.end_date))}<br>접수 ${h(stamp(a.created_at))}</p>${statusGrid(a)}<div class="ms-actions">${button('최신 내역 검토·처리',`data-ms-command="application" data-id="${h(a.id)}"`,'primary-button')}</div></article>`).join('')}</div>` + (!rows.length ? empty() : '');
}
function renderGx(root) {
  root.innerHTML = toolbar('GX 수강 관리','정원과 수강기간 등 필수 운영값을 확인한 반만 접수할 수 있습니다.',button('프로그램·반 추가','data-ms-command="new-gx"','primary-button')) + `<div class="ms-notice warning">사진 기준 시간표는 검토 필요 상태로 시작합니다. 정원·수강기간·접수기간·결제기한을 실제 운영 기준으로 입력해 주세요.</div><div class="ms-grid">${arr(state.lists.gx_classes).map((g) => `<article class="ms-card"><div class="ms-card-heading"><h3>${h(g.name || g.program_name)} ${h(g.class_name || '')}</h3>${badge(g.status)}</div><p>${h(arr(g.weekdays).map((n)=>['월','화','수','목','금','토','일'][n-1]).join('·'))} ${h(g.start_time || '')} · ${money(g.price || g.fee)}</p><p class="ms-meta">수강 ${h(day(g.period_start))} ~ ${h(day(g.period_end))}<br>정원 ${h(g.capacity ?? '미설정')}명 · 대기접수 ${g.waitlist_enabled ? '사용' : '미사용'}<br>접수 ${h(stamp(g.registration_start || g.registration_opens_at))} ~ ${h(stamp(g.registration_end || g.registration_closes_at))}</p><div class="ms-actions">${button('반 설정',`data-ms-command="edit-gx" data-id="${h(g.id)}"`)}${button('신청 내역',`data-ms-command="gx-applications" data-id="${h(g.id)}"`)}</div></article>`).join('')}</div>` + (!arr(state.lists.gx_classes).length ? empty() : '');
}
function categoryName(id) { return findItem('categories',id)?.name || '미분류'; }
function renderPosts(root) {
  const rows = filterRows('posts',arr(state.lists.posts));
  root.innerHTML = toolbar('회원 안내 게시판 관리','회원분들께 보고드립니다.',button('새 글 작성','data-ms-command="new-post"','primary-button')) + `<div class="ms-notice">여기에서 게시한 공개용 글만 회원에게 보입니다. 내부 민원 원문·이름·동호수·연락처·얼굴이 포함되지 않았는지 미리보기로 확인하세요.</div>` + filters('posts',['draft','published','archived']) + `<div class="ms-grid">${rows.map((p) => `<article class="ms-card"><div class="ms-card-heading"><h3>${p.pinned ? '📌 ' : ''}${h(p.title)}</h3>${badge(p.status)}</div><p class="ms-meta">${h(categoryName(p.category_id))} · 게시 ${h(stamp(p.publish_at || p.published_at))}<br>노출 종료 ${h(stamp(p.expires_at || p.visible_until))}</p><p>${h(String(p.body || p.content || '').slice(0,170))}</p><div class="ms-actions">${button('수정·미리보기',`data-ms-command="edit-post" data-id="${h(p.id)}"`)}</div></article>`).join('')}</div>` + (!rows.length ? empty('게시물이 없습니다. 실제 운영 소식을 직접 작성해 주세요.') : '');
}
function renderRequests(root) {
  const rows = filterRows('requests',arr(state.lists.requests)); const f = state.filters.requests || {};
  const categories = arr(state.lists.categories).filter((c) => c.kind === 'request' || c.type === 'request');
  root.innerHTML = toolbar('건의·민원 관리','회원 요청과 첨부사진은 비공개이며 공개 답변만 작성자에게 전달됩니다.') + filters('requests',['received','reviewing','in_progress','completed','needs_info','held','declined'],select('category','분류',[['','전체 분류'],...categories.map((c) => [c.id,c.name])],f.category)+field('location','시설·위치',f.location)+field('from','접수 시작일',f.from,'date')+field('to','접수 종료일',f.to,'date')) + `<p class="ms-count">${rows.length}건</p><div class="ms-grid">${rows.map((r) => `<article class="ms-card"><div class="ms-card-heading"><h3>${h(r.title)}</h3>${badge(r.status)}</div><p class="ms-meta">${h(r.request_no || String(r.id).slice(0,8))} · ${h(categoryName(r.category_id))}<br>${h(memberText(r))}<br>${h(r.location || '위치 미입력')} · ${h(stamp(r.created_at))}</p><p>${h(String(r.body || r.content || '').slice(0,180))}</p><div class="ms-actions">${button('상세·답변·처리',`data-ms-command="request" data-id="${h(r.id)}"`,'primary-button')}</div></article>`).join('')}</div>` + (!rows.length ? empty() : '');
}

async function handleClick(entity,event) {
  const node = event.target.closest('button'); if (!node) return;
  if (node.hasAttribute('data-ms-refresh')) return refresh(entity);
  if (node.dataset.settingsTab) { state.settingsTab = node.dataset.settingsTab; return render('settings'); }
  const cmd = node.dataset.msCommand, id = node.dataset.id; if (!cmd) return;
  try {
    if (cmd === 'new-profile' || cmd === 'edit-profile') editProfile(findItem('profiles',id));
    if (cmd === 'import-pass') importPass(findItem('profiles',id));
    if (cmd === 'verify') verifyProfile(findItem('profiles',id));
    if (cmd === 'invite') inviteProfile(findItem('profiles',id));
    if (cmd === 'csv') importCsv();
    if (cmd === 'profile-change') reviewProfileChange(findItem('profile_changes',id));
    if (cmd === 'application') await editApplication(id);
    if (cmd === 'new-gx' || cmd === 'edit-gx') editGx(findItem('gx_classes',id));
    if (cmd === 'gx-applications') { await showGxApplications(id); }
    if (cmd === 'new-post' || cmd === 'edit-post') editPost(findItem('posts',id));
    if (cmd === 'request') await editRequest(id);
    if (cmd === 'new-product' || cmd === 'edit-product') editProduct(findItem('products',id));
    if (cmd === 'new-category' || cmd === 'edit-category') editCategory(findItem('categories',id));
    if (cmd === 'new-term' || cmd === 'edit-term') editTerm(findItem('terms',id));
    if (cmd === 'edit-form') editForm();
    if (cmd === 'qr-copy') { await navigator.clipboard.writeText(memberUrl()); alertIn(section('settings'),'회원용 주소를 복사했습니다.',false); }
    if (cmd === 'qr-save') saveQr();
  } catch (error) { alertIn(section(entity),errorText(error)); }
}

function editProfile(p = {}) {
  const passes = arr(state.lists.passes).filter((row) => row.member_id === p.id);
  const node=dialog(p.id ? '회원 상세·정보 수정' : '회원 추가', `<div class="ms-form-grid">${field('name','이름',p.name,'text','required maxlength="80"')}${field('phone','휴대폰 번호',p.phone,'tel','required maxlength="20"')}${field('building','동',p.building,'text','required maxlength="30"')}${field('unit','호수',p.unit,'text','required maxlength="30"')}${check('active','회원서비스 사용',p.active !== false)}</div><p class="ms-meta">휴대폰 소유 확인과 입주민 확인은 별개입니다. 회원 추가만으로 본인 확인·이용권이 승인되지 않습니다.</p>${passes.length ? `<hr class="ms-divider"><h3>보유 이용권</h3>${passes.map((t) => `<div class="ms-card"><p>${h(t.product_name)} · ${h(t.start_date)} ~ ${h(t.end_date)} ${badge(t.status)}</p><span class="ms-meta">${t.source==='import' ? '기존 이용권 이관' : '신청·결제 확인 등록'}</span>${['active','suspended'].includes(t.status) ? `<div class="ms-actions">${button(t.status==='active' ? '이용 연기 표시' : '이용 연기 해제',`data-pass-operation="${t.status==='active' ? 'suspend' : 'resume'}" data-pass-id="${h(t.id)}"`)}</div>` : ''}</div>`).join('')}` : ''}`, async (data) => { await save('profiles',{...data,...(p.id ? {id:p.id,expected_updated_at:p.updated_at} : {})}); closeDialog(); await refresh('profiles'); });
  $$('[data-pass-operation]',node).forEach((b)=>b.addEventListener('click',()=>{
    const current=formData($('form',node)); if(['name','phone','building','unit'].some((key)=>current[key]!==String(p[key] || '')) && !window.confirm('저장하지 않은 회원정보 변경사항을 닫고 이용권 상태를 변경할까요?'))return;
    const t=passes.find((pass)=>pass.id===b.dataset.passId), op=b.dataset.passOperation;
    dialog(op==='suspend' ? '이용 연기 표시' : '이용 연기 해제',`<p>${h(p.name)} · ${h(t.product_name)} · ${h(t.start_date)} ~ ${h(t.end_date)}</p><div class="ms-notice">이 작업은 이용권의 연기 상태만 변경하며 시작일·종료일을 자동으로 바꾸지 않습니다. 적용 규정과 실제 잔여기간을 확인하세요. 연기 중에는 빠른 연장 승인이 보류됩니다.</div>${textarea('note','처리 사유 및 확인 내용','','required maxlength="2000"')}`,async(data)=>{await action('passes',t.id,op,{note:data.note});closeDialog();await refresh('profiles');},'상태 기록');
  }));
}
function importPass(p) {
  if(!p)return;
  const products=arr(state.lists.products);
  dialog('기존 이용권 이관',`<p><strong>${h(p.name)}</strong> · ${h(p.building)}동 ${h(p.unit)}호</p><div class="ms-notice warning">기존 외부 회원관리 기록에서 확인한 이용기간만 옮기세요. 이 작업은 결제나 신규 매출을 기록하지 않습니다. 현장 확인된 회원에게만 적용되며 겹치는 이용권은 등록할 수 없습니다.</div><div class="ms-form-grid">${select('product_id','기존 이용권에 해당하는 상품',products.map((t)=>[t.id,`${t.name} · ${label(t.facility)}`]),products[0]?.id)}${field('start_date','기존 이용 시작일','','date','required')}${field('end_date','기존 이용 종료일','','date','required')}${textarea('note','원본 확인 근거·이관 사유','','required maxlength="2000"')}</div>${check('verified_source','외부 기록에서 회원 본인과 기존 이용기간을 확인했습니다.',false,'required')}`,async(data)=>{if(data.end_date<data.start_date)throw new Error('종료일은 시작일 이후여야 합니다.');delete data.verified_source;await action('profiles',p.id,'import_pass',data);closeDialog();await refresh('profiles');},'기존 이용권 이관 기록');
}
function verifyProfile(p) {
  if (!p) return;
  dialog('현장 입주민 확인',`<p><strong>${h(p.name)}</strong> · ${h(p.building)}동 ${h(p.unit)}호 · ${h(p.phone)}</p><div class="ms-notice">실제 현장에서 입주민과 회원 본인을 확인한 뒤 승인합니다. 이 작업은 휴대폰 소유 인증을 대신하지 않습니다.</div>${check('confirmed','현장에서 회원 본인과 입주민 자격을 확인했습니다.',false,'required')}`,async () => { await action('profiles',p.id,'verify'); closeDialog(); await refresh('profiles'); },'입주민 확인 완료');
}
function inviteProfile(p) {
  if (!p) return;
  dialog('일회성 계정 연결 초대',`<p>${h(memberText(p))}</p><div class="ms-notice">현장 확인이 끝난 회원에게 직접 전달하세요. 공통 QR에 초대코드를 넣지 않습니다. 새 코드를 발급하면 기존 미사용 코드는 무효화됩니다.</div><div class="ms-form-grid">${field('email','연결할 계정 이메일 (선택)','','email','autocomplete="off"')}${field('expires_hours','만료 시간 (1~24시간)',24,'number','min="1" max="24" required')}</div>`,async (data,form,node) => {
    const result = await service('issue_invite',{member_id:p.id,...data});
    $('form',node).innerHTML = `<div class="ms-notice">한 번만 사용할 수 있습니다. 코드는 이 화면에서만 확인할 수 있습니다.</div><code class="ms-code">${h(result.code)}</code><p>만료: ${h(stamp(result.expires_at))}</p><p class="ms-meta">회원이 /members/my에서 본인 이메일 계정으로 로그인한 뒤 이 코드를 입력하도록 안내하세요.</p><div class="ms-actions">${button('코드 복사','data-copy-invite')}${button('닫기','data-close')}</div>`;
    $('[data-copy-invite]',node).addEventListener('click',async () => { try { await navigator.clipboard.writeText(result.code); alertIn(node,'코드를 복사했습니다.',false); } catch { alertIn(node,'복사가 차단되었습니다. 표시된 코드를 직접 선택해 복사하세요.'); } });
  },'초대코드 발급');
}
function reviewProfileChange(c) {
  if (!c) return;
  const p = profile(c.member_id), changes = c.changes || c.requested_changes || {};
  const node = dialog('회원정보 변경 요청 검토',`<p>${h(memberText(c))}</p><div class="ms-table-scroll"><table class="ms-table"><thead><tr><th>항목</th><th>현재</th><th>요청</th></tr></thead><tbody>${Object.entries(changes).map(([key,value]) => `<tr><td>${h({name:'이름',building:'동',unit:'호수',phone:'연락처'}[key] || key)}</td><td>${h(p[key])}</td><td>${h(value)}</td></tr>`).join('')}</tbody></table></div>${textarea('note','확인 메모')}<div class="ms-dialog-footer">${button('반려','data-reject-change','danger-button')}<button type="submit" class="primary-button">확인 후 반영</button></div>`,async (data) => { await action('profile_changes',c.id,'approve',{note:data.note}); closeDialog(); await refresh('profiles'); },'변경 승인');
  $('.ms-dialog-footer:last-child',node).remove();
  $('[data-reject-change]',node).addEventListener('click',() => busy(node,async () => { await action('profile_changes',c.id,'reject',{note:$('[name=note]',node).value}); closeDialog(); await refresh('profiles'); }));
}
function parseCsv(text) {
  const rows = []; let row = [], value = '', quote = false;
  for (let i=0;i<text.length;i++) { const ch=text[i]; if (ch === '"') { if (quote && text[i+1] === '"') { value += '"'; i++; } else quote=!quote; } else if (ch === ',' && !quote) { row.push(value); value=''; } else if ((ch === '\n' || ch === '\r') && !quote) { if(ch==='\r' && text[i+1]==='\n') i++; row.push(value); if(row.some((v)=>v.trim())) rows.push(row); row=[]; value=''; } else value+=ch; }
  if (quote) throw new Error('CSV의 따옴표가 닫히지 않았습니다.'); row.push(value); if(row.some((v)=>v.trim())) rows.push(row);
  if (!rows.length) throw new Error('CSV에 데이터가 없습니다.');
  const aliases={이름:'name',성명:'name',동:'building',호:'unit',호수:'unit',휴대폰:'phone',휴대폰번호:'phone',전화번호:'phone',연락처:'phone'}; const headers=rows.shift().map((v)=>aliases[v.trim().replace(/^\uFEFF/,'').replace(/\s/g,'')] || v.trim().replace(/^\uFEFF/,''));
  if (!['name','building','unit','phone'].every((key)=>headers.includes(key))) throw new Error('필수 열 이름은 name,building,unit,phone 또는 이름,동,호수,전화번호입니다.');
  if(rows.length>500) throw new Error('한 번에 500명까지 가져올 수 있습니다.');
  return rows.map((values)=>Object.fromEntries(['name','building','unit','phone'].map((key)=>[key,String(values[headers.indexOf(key)] || '').trim()])));
}
function importCsv() {
  let rows = [], preview = [], importKey=crypto.randomUUID();
  const node = dialog('회원 CSV 가져오기',`<div class="ms-notice">UTF-8 CSV 첫 줄: 이름,동,호수,전화번호. 500명 이하로 업로드하세요. 중복 후보는 별도 회원으로 등록되며 자동 병합되지 않습니다.</div><label class="ms-field"><span>CSV 파일</span><input type="file" accept=".csv,text/csv" data-csv-file required></label><div class="ms-actions">${button('미리보기·검사','data-csv-preview','primary-button')}</div><div data-csv-results></div>${check('confirm_duplicates','중복 후보를 확인했으며 각각 별도 회원으로 등록합니다.')}`,async (data) => {
    if (!rows.length || !preview.length) throw new Error('먼저 미리보기·검사를 실행하세요.');
    if(preview.some((p)=>arr(p.errors).length)) throw new Error('필수값 오류를 수정한 후 다시 업로드하세요.');
    const result = await service('import_members',{rows,commit:true,confirm_duplicates:data.confirm_duplicates,idempotency_key:importKey}); closeDialog(); await refresh('profiles'); alertIn(section('profiles'),`${result.inserted ?? rows.length}명 등록 완료. 현장 확인 후 초대코드를 발급하세요.`,false);
  },'검사한 회원 등록');
  const submit = $('[type=submit]',node); submit.disabled=true;
  $('[data-csv-file]',node).addEventListener('change',()=>{ rows=[];preview=[];importKey=crypto.randomUUID();submit.disabled=true;$('[data-csv-results]',node).replaceChildren(); });
  $('[data-csv-preview]',node).addEventListener('click',()=>busy(node,async ()=>{
    const file=$('[data-csv-file]',node).files[0]; if(!file) throw new Error('CSV 파일을 선택하세요.'); if(file.size>2*1024*1024) throw new Error('CSV는 2MB 이하만 사용할 수 있습니다.');
    rows=parseCsv(await file.text()); const result=await service('import_members',{rows,commit:false}); preview=arr(result.preview);
    $('[data-csv-results]',node).innerHTML=`<h3>등록 전 미리보기 ${preview.length}명</h3><div class="ms-table-scroll"><table class="ms-table"><thead><tr><th>행</th><th>회원정보</th><th>검사</th></tr></thead><tbody>${preview.map((p,i)=>`<tr><td>${p.index ?? i+2}</td><td>${h(rows[i]?.name)} · ${h(rows[i]?.building)}동 ${h(rows[i]?.unit)}호<br>${h(rows[i]?.phone)}</td><td>${arr(p.errors).map(h).join('<br>') || '필수값 정상'}${arr(p.duplicate_candidates).length ? `<br><strong>중복 후보 ${p.duplicate_candidates.length}건</strong>${p.duplicate_candidates.map((c)=>c.batch_duplicate ? '<p>현재 CSV 안에 같은 이름 또는 연락처가 있습니다.</p>' : `<p>${h(c.name)} · ${h(c.building)}동 ${h(c.unit)}호 · ${h(c.phone)}</p>`).join('')}` : ''}</td></tr>`).join('')}</tbody></table></div>`;
  }).then(()=>{submit.disabled=!preview.length || preview.some((p)=>arr(p.errors).length);}));
}

function addDays(date,n) { const d=new Date(`${date}T00:00:00Z`); d.setUTCDate(d.getUTCDate()+n); return d.toISOString().slice(0,10); }
function expectedPeriod(a) {
  if(a.gx_class_id) return {start:a.product_snapshot?.period_start || a.proposed_start_date,end:a.product_snapshot?.period_end || a.proposed_end_date};
  const facility=a.product_snapshot?.facility; const passes=arr(state.lists.passes).filter((p)=>p.member_id===a.member_id && p.facility===facility && p.status==='active' && !p.gx_class_id);
  const latest=passes.reduce((date,p)=>p.end_date>date ? p.end_date : date,''); const start=[todayKst(),a.desired_start_date || '',latest ? addDays(latest,1) : ''].sort().at(-1); const duration=Number(a.product_snapshot?.duration_days || 0);
  return {start,end:duration ? addDays(start,duration-1) : a.proposed_end_date};
}
async function historyHtml(entity,id) {
  const events=await list('audit'); const rows=events.filter((e)=>e.entity===entity && String(e.entity_id)===String(id));
  return rows.length ? `<ol class="ms-history">${rows.map((e)=>`<li>${h(stamp(e.created_at))} · ${h(e.action)} · 관리자 ${h(String(e.actor_id || '').slice(0,8))}<details><summary>변경 전후 보기</summary><pre class="ms-pre">${h(JSON.stringify({before:e.before_data,after:e.after_data},null,2))}</pre></details></li>`).join('')}</ol>` : '<p class="ms-meta">기록된 처리 이력이 없습니다.</p>';
}
async function editApplication(id) {
  await Promise.all([list('applications'),list('passes'),list('profiles')]); const a=findItem('applications',id); if(!a) throw new Error('신청 내역을 찾을 수 없습니다.');
  const p=profile(a.member_id), period=expectedPeriod(a), passes=arr(state.lists.passes).filter((t)=>t.member_id===a.member_id); const processed=a.pass_status==='applied';
  const node=dialog('신청·결제 확인 및 이용권 반영',`<h3>${h(a.application_no)} · ${h(memberText(a))}</h3>${statusGrid(a)}<p>${h(p.phone || '')} · 입주민 ${p.resident_verified ? '확인 완료' : '확인 필요'}</p><div class="ms-notice"><strong>${h(a.product_snapshot?.name || '이용권')} · 신청 당시 ${money(a.amount)}</strong><br>${h(label(a.payment_method))} · 입금자 ${h(a.payer_name || '—')}<br>최신 이용권 기준 승인 예정 기간: <strong>${h(day(period.start))} ~ ${h(day(period.end))}</strong><br>예정 기간과 금액을 확인하세요. 현재 이용 연기·권종 변경 등 예외는 보류로 처리합니다.</div><details><summary>최신 이용권 및 신청 당시 기록</summary>${passes.map((t)=>`<p>${h(t.product_name)} · ${h(t.start_date)} ~ ${h(t.end_date)} ${badge(t.status)}</p>`).join('') || '<p>기존 이용권 없음</p>'}<p class="ms-meta">신청 당시 기존 기간: ${h(day(a.previous_start_date))} ~ ${h(day(a.previous_end_date))}<br>신청 시 예정 기간: ${h(day(a.proposed_start_date))} ~ ${h(day(a.proposed_end_date))}<br>최종 기간: ${h(day(a.final_start_date))} ~ ${h(day(a.final_end_date))}</p><h4>동의·입력 기록</h4><pre class="ms-pre">${h(JSON.stringify({규정:a.consents_snapshot,추가입력:a.form_values,수강생:a.student_name,보호자동의:a.guardian_consent},null,2))}</pre><div data-signature></div></details><hr class="ms-divider"><div class="ms-form-grid">${field('actual_amount','실제 확인한 결제금액 (원)',a.amount,'number','required min="0" step="1"')}${field('paid_at','실제 결제일시 (한국 시간)',localDateTime(new Date()),'datetime-local','required')}${textarea('payment_note','결제 확인 메모 (승인번호 등)','','maxlength="1000"')}${textarea('note','처리 메모 / 보류·취소 사유','','maxlength="2000"')}</div><p class="ms-meta">카드번호·유효기간·보안코드는 기록하지 마세요. 이체 사진만으로 승인하지 말고 실제 입금을 확인하세요.</p>${check('checked','최신 이용기간과 신청 당시 금액을 검토하고 실제 결제를 확인했습니다.',false,processed ? 'disabled' : '')}<div class="ms-actions">${button('결제 확인 후 이용권 반영','data-app-action="approve"','primary-button')}${button('확인 필요로 보류','data-app-action="hold"')}${button('신청 취소','data-app-action="cancel"','danger-button')}${button('외부 출입 반영 완료','data-app-action="external_done"')}${a.reservation_status==='waitlisted' ? button('빈자리 배정','data-app-action="assign_seat"') : ''}</div><div class="ms-notice warning">외부 출입프로그램을 직접 수정한 다음 별도로 반영 완료를 표시하세요. 결제 완료 건의 취소는 환불 확인 필요 상태가 되며 실제 환불은 수행하지 않습니다.</div><details><summary>처리 이력</summary><div data-audit>불러오는 중…</div></details>`,null);
  if(processed) $('[data-app-action="approve"]',node).disabled=true;
  if(a.signature_path) photoUrl(a.signature_path).then((url)=>{if(node.isConnected)$('[data-signature]',node).innerHTML=`<p>신청 서명 (비공개)</p><img src="${h(url)}" alt="회원 신청 서명" style="max-width:360px">`;}).catch(()=>{});
  historyHtml('applications',id).then((html)=>{if(node.isConnected)$('[data-audit]',node).innerHTML=html;}).catch(()=>{if(node.isConnected)$('[data-audit]',node).textContent='이력을 불러오지 못했습니다.';});
  $$('[data-app-action]',node).forEach((b)=>b.addEventListener('click',()=>busy(node,async ()=>{
    const op=b.dataset.appAction, data=formData($('form',node));
    if(op==='approve' && !$('form',node).reportValidity()) return;
    if(op==='approve' && !data.checked) throw new Error('최신 이용기간과 실제 결제 확인 항목을 체크하세요.');
    if(op==='approve' && Number(data.actual_amount)!==Number(a.amount)) throw new Error('실제 금액이 신청 당시 금액과 다릅니다. 확인 필요로 보류하고 메모를 남겨 주세요.');
    if(['hold','cancel'].includes(op) && !data.note) throw new Error('보류·취소 사유를 입력하세요.');
    if(op==='cancel' && !window.confirm('신청을 취소할까요? 결제 확인 건은 환불 확인 필요 상태로 남습니다.')) return;
    if(op==='external_done' && !window.confirm('외부 출입프로그램에서 실제 이용기간을 수정했습니까?')) return;
    await action('applications',id,op,{actual_amount:data.actual_amount,paid_at:data.paid_at ? kstIso(data.paid_at) : null,payment_note:data.payment_note,note:data.note,expected_updated_at:a.updated_at,expected_start_date:period.start,expected_end_date:period.end}); closeDialog(); await refresh('applications');
  })));
}
function localDateTime(value) { if(!value) return ''; const d=new Date(value); if(Number.isNaN(d.getTime())) return ''; return new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(d).replace(' ','T'); }
function kstIso(value) { return value ? new Date(`${value}:00+09:00`).toISOString() : null; }
function editGx(g = {}) {
  const days=['월','화','수','목','금','토','일'];
  const node=dialog(g.id ? 'GX 반 설정' : 'GX 프로그램·반 추가',`<div class="ms-notice warning">사진에 없는 정원·수강기간은 운영자가 입력합니다. 검토 확인과 필수 운영값이 있어야 모집 중으로 저장할 수 있습니다.</div><div class="ms-form-grid">${field('name','프로그램명',g.name,'text','required maxlength="120"')}${field('class_name','반 이름',g.class_name,'text','maxlength="80"')}<div class="ms-field ms-span"><span>수업 요일</span><div class="ms-actions">${days.map((name,i)=>check(`weekday_${i+1}`,name,arr(g.weekdays).includes(i+1))).join('')}</div></div>${field('start_time','시작시간',String(g.start_time || '').slice(0,5),'time','required')}${field('price','수강료 (원)',g.price,'number','min="0" required')}${field('period_start','수강 시작일',g.period_start,'date')}${field('period_end','수강 종료일',g.period_end,'date')}${field('capacity','정원',g.capacity,'number','min="1" max="1000"')}${field('payment_due_hours','자리 확보 후 결제기한 (시간)',g.payment_due_hours,'number','min="1" max="720"')}${field('registration_start','접수 시작 (한국 시간)',localDateTime(g.registration_start),'datetime-local')}${field('registration_end','접수 종료 (한국 시간)',localDateTime(g.registration_end),'datetime-local')}${field('priority_start','기존 수강생 우선접수 시작',localDateTime(g.priority_start),'datetime-local')}${field('priority_end','기존 수강생 우선접수 종료',localDateTime(g.priority_end),'datetime-local')}${select('status','운영 상태',['inactive','open','closed',['suspended','휴강']],g.status || 'inactive')}${check('waitlist_enabled','정원 마감 시 대기접수 사용',g.waitlist_enabled)}${check('is_child','어린이 반 (수강생·보호자 구분)',g.is_child)}${check('reviewed','금액·요일·시간·운영값 검토 완료',g.reviewed)}${textarea('guardian_terms','어린이 반 보호자 안내·동의',g.guardian_terms)}</div>`,async(data)=>{
    const weekdays=days.map((_,i)=>i+1).filter((n)=>data[`weekday_${n}`]); days.forEach((_,i)=>delete data[`weekday_${i+1}`]); if(!weekdays.length) throw new Error('수업 요일을 선택하세요.');
    ['registration_start','registration_end','priority_start','priority_end'].forEach((key)=>data[key]=kstIso(data[key]));
    data.period_start=data.period_start || null; data.period_end=data.period_end || null;
    await save('gx_classes',{...data,weekdays,...(g.id ? {id:g.id,expected_updated_at:g.updated_at} : {})}); closeDialog(); await refresh('gx_classes');
  });
  return node;
}
async function showGxApplications(id) {
  await Promise.all([list('applications'),list('profiles')]); const rows=arr(state.lists.applications).filter((a)=>a.gx_class_id===id);
  const node=dialog('GX 수강 신청 내역',rows.length ? rows.map((a)=>`<article class="ms-card"><strong>${h(memberText(a))}</strong><p>${h(a.student_name ? `수강생: ${a.student_name}` : '')} ${badge(a.reservation_status)}</p>${statusGrid(a)}<div class="ms-actions">${button('신청 검토',`data-open-app="${h(a.id)}"`)}</div></article>`).join('') : empty(),null);
  $$('[data-open-app]',node).forEach((b)=>b.addEventListener('click',()=>editApplication(b.dataset.openApp).catch((e)=>alertIn(node,errorText(e)))));
}

function photoEditor(node,entries,{kind,recordId,roles=false,limit=8}) {
  const target=$('[data-photo-editor]',node); if(!target) return;
  let version=0;
  async function draw() {
    const current=++version;
    target.innerHTML=`<div class="ms-photo-grid">${entries.map((p,i)=>`<div class="ms-photo"><div data-photo-image="${i}" class="ms-meta">사진 불러오는 중…</div>${roles ? `<select data-photo-role="${i}" aria-label="사진 구분">${options([['photos','일반 사진'],['before_photos','조치 전'],['after_photos','조치 후']],p.role)}</select>` : ''}${button('사진 제외',`data-remove-photo="${i}"`)}</div>`).join('')}</div><label class="ms-field"><span>사진 첨부 (JPEG·PNG·WebP, 파일당 8MB 이하)</span><input type="file" accept="image/jpeg,image/png,image/webp" multiple data-upload-photo ${limit===0 ? 'disabled' : ''}></label><small class="ms-meta">최대 ${limit}장. 개인정보와 다른 사람의 얼굴이 포함되지 않은 사진을 선택하세요.</small>`;
    $$('[data-remove-photo]',target).forEach((b)=>b.addEventListener('click',()=>{entries.splice(Number(b.dataset.removePhoto),1);draw();}));
    $$('[data-photo-role]',target).forEach((s)=>s.addEventListener('change',()=>{entries[Number(s.dataset.photoRole)].role=s.value;}));
    $('[data-upload-photo]',target).addEventListener('change',(event)=>busy(node,async()=>{
      const files=[...event.target.files]; if(entries.length+files.length>limit) throw new Error(`사진은 최대 ${limit}장까지 첨부할 수 있습니다.`);
      for(const file of files) { const path=await uploadPhoto(file,{kind,recordId}); entries.push({path,role:'photos'}); }
      await draw();
    }));
    const results=await Promise.allSettled(entries.map((p)=>photoUrl(p.path)));
    if(current!==version || !node.isConnected) return;
    results.forEach((result,i)=>{const box=$(`[data-photo-image="${i}"]`,target); if(!box)return; if(result.status==='fulfilled'){box.innerHTML=`<img src="${h(result.value)}" alt="첨부 사진 ${i+1}" loading="lazy">`;}else box.textContent='사진을 불러오지 못했습니다.';});
  }
  draw();
}
async function displayPhotos(target,paths) {
  if(!target) return;
  if(!arr(paths).length) {target.textContent='첨부 사진 없음';return;}
  target.classList.add('ms-photo-grid');
  const results=await Promise.allSettled(paths.map((p)=>photoUrl(p)));
  if(!target.isConnected)return;
  target.innerHTML=results.map((result,i)=>result.status==='fulfilled' ? `<a href="${h(result.value)}" target="_blank" rel="noopener noreferrer"><img src="${h(result.value)}" alt="첨부 사진 ${i+1}" loading="lazy"></a>` : '<p class="ms-meta">사진 접근 실패</p>').join('');
}
function editPost(p = {}) {
  const id=p.id || crypto.randomUUID(); let previewed=false;
  const entries=['photos','before_photos','after_photos'].flatMap((role)=>arr(p[role]).map((path)=>({path,role})));
  const categories=arr(state.lists.categories).filter((c)=>c.kind==='board' && (c.active || c.id===p.category_id));
  const node=dialog(p.id ? '회원 안내글 수정' : '회원 안내글 작성',`<div class="ms-notice">민원 원문이나 회원정보를 자동 복사하지 않습니다. 공개할 내용과 사진만 직접 선택해 작성하세요.</div><div class="ms-form-grid">${field('title','제목',p.title,'text','required maxlength="160"')}${select('category_id','분류',categories.map((c)=>[c.id,c.name]),p.category_id)}${field('location','관련 시설·위치',p.location,'text','maxlength="120"')}${field('progress_status','진행 상태 (공개 문구)',p.progress_status,'text','maxlength="80"')}${field('action_date','조치일',p.action_date,'date')}${select('status','저장 상태',['draft','published','archived'],p.status || 'draft')}${field('publish_at','게시 시작 (한국 시간)',localDateTime(p.publish_at || new Date()),'datetime-local','required')}${field('expires_at','노출 종료 (선택)',localDateTime(p.expires_at),'datetime-local')}${check('pinned','상단 고정',p.pinned)}${textarea('body','회원에게 공개할 내용',p.body,'required maxlength="20000"')}</div><h3>공개 사진</h3><div data-photo-editor></div><div class="ms-actions">${button('회원 화면 미리보기','data-preview-post','primary-button')}${button('게시 중단·임시저장','data-unpublish-post')}${button('보관','data-archive-post')}</div><div data-post-preview></div>${check('privacy_checked','미리보기를 확인했으며 공개 내용·사진에 개인정보가 없습니다.',false)}<p class="ms-meta">글을 수정하거나 사진을 바꾼 뒤에는 미리보기를 다시 확인하세요. 게시 중단 후 기존 사진 링크는 최대 60초 안에 만료됩니다.</p>`,async(data)=>{
    if(data.status==='published' && (!previewed || !data.privacy_checked)) throw new Error('회원 화면 미리보기를 열고 개인정보 확인 항목을 체크하세요.');
    delete data.privacy_checked; const photos={photos:[],before_photos:[],after_photos:[]}; entries.forEach((photo)=>photos[photo.role].push(photo.path));
    await save('posts',{...data,...photos,id,...(p.id ? {expected_updated_at:p.updated_at} : {}),publish_at:kstIso(data.publish_at),expires_at:kstIso(data.expires_at),action_date:data.action_date || null,preview_confirmed:previewed}); closeDialog(); await refresh('posts');
  },'선택한 상태로 저장');
  photoEditor(node,entries,{kind:'posts',recordId:id,roles:true,limit:Number(state.settings.photo_limit ?? 5)});
  $('form',node).addEventListener('input',(event)=>{if(event.target.name!=='privacy_checked'){previewed=false;$('[name=privacy_checked]',node).checked=false;}});
  $('form',node).addEventListener('change',(event)=>{if(event.target.name!=='privacy_checked'){previewed=false;$('[name=privacy_checked]',node).checked=false;}});
  $('[data-photo-editor]',node).addEventListener('click',(event)=>{if(event.target.closest('[data-remove-photo]')){previewed=false;$('[name=privacy_checked]',node).checked=false;}});
  $('[data-preview-post]',node).addEventListener('click',()=>{
    const data=formData($('form',node)); const preview=$('[data-post-preview]',node); preview.innerHTML=`<article class="ms-preview"><span class="ms-badge">${h(categoryName(data.category_id))}</span><h3>${h(data.title || '제목 없음')}</h3><p class="ms-meta">${h(data.location)} · ${h(data.progress_status)} · ${h(day(data.action_date))}</p><div class="ms-pre">${h(data.body)}</div><h4>일반 사진</h4><div data-preview-photos></div><h4>조치 전</h4><div data-preview-before></div><h4>조치 후</h4><div data-preview-after></div></article>`;
    displayPhotos($('[data-preview-photos]',preview),entries.filter((p)=>p.role==='photos').map((p)=>p.path)); displayPhotos($('[data-preview-before]',preview),entries.filter((p)=>p.role==='before_photos').map((p)=>p.path)); displayPhotos($('[data-preview-after]',preview),entries.filter((p)=>p.role==='after_photos').map((p)=>p.path)); previewed=true; preview.scrollIntoView({behavior:'smooth',block:'nearest'});
  });
  $('[data-unpublish-post]',node).addEventListener('click',()=>{$('[name=status]',node).value='draft';$('form',node).requestSubmit();});
  $('[data-archive-post]',node).addEventListener('click',()=>{$('[name=status]',node).value='archived';$('form',node).requestSubmit();});
}
async function editRequest(id) {
  await list('requests'); const r=findItem('requests',id); if(!r)throw new Error('접수 내역을 찾을 수 없습니다.');
  const entries=arr(r.action_photos).map((path)=>({path,role:'photos'}));
  const node=dialog('건의·민원 상세 및 처리',`<h3>${h(r.title)}</h3><p class="ms-meta">${h(r.request_no)} · ${h(stamp(r.created_at))}<br>${h(memberText(r))} · ${h(profile(r.member_id).phone)}<br>${h(categoryName(r.category_id))} · ${h(r.location || '위치 미입력')}</p><div class="ms-card"><div class="ms-pre">${h(r.body)}</div>${r.item_name ? `<p>요청 물품: ${h(r.item_name)} · 수량 ${h(r.quantity || '미입력')}</p>` : ''}<div data-request-photos></div></div><hr class="ms-divider"><div class="ms-form-grid">${select('status','처리상태',['received','reviewing','in_progress','completed','needs_info','held','declined'],r.status)}${select('assignee','담당자',[['','미지정'],...arr(state.lists.admins).map((a)=>[a.id,a.display_name || '관리자'])],r.assignee)}${textarea('reply','회원에게 보여줄 답변',r.reply,'maxlength="10000"')}${textarea('internal_note','새 내부 메모 (회원에게 보이지 않음)','','maxlength="5000"')}</div><h3>회원에게 보여줄 조치 사진</h3><div data-photo-editor></div><div class="ms-notice">답변과 조치 사진은 이 요청의 작성자에게만 표시됩니다. 처리 완료와 공개 게시 여부는 별개입니다. 공개하려면 게시판에서 개인정보 없는 글을 별도로 작성하세요.</div><details><summary>관리자 전용 내부 메모</summary>${arr(r.internal_notes).map((n)=>`<p class="ms-meta">${h(stamp(n.created_at))} · ${h(n.note || n.body || n.content)}</p>`).join('') || '<p class="ms-meta">내부 메모 없음</p>'}</details><details><summary>처리 이력</summary><div data-audit>불러오는 중…</div></details>`,async(data)=>{
    if(data.status==='declined' && !data.reply)throw new Error('반영하기 어려운 이유를 회원 답변에 작성하세요.');
    await action('requests',id,'update',{...data,action_photos:entries.map((p)=>p.path)}); closeDialog(); await refresh('requests');
  },'답변·처리 저장');
  displayPhotos($('[data-request-photos]',node),r.photos); photoEditor(node,entries,{kind:'requests',limit:Number(state.settings.photo_limit ?? 5)});
  historyHtml('requests',id).then((html)=>{if(node.isConnected)$('[data-audit]',node).innerHTML=html;}).catch(()=>{if(node.isConnected)$('[data-audit]',node).textContent='이력을 불러오지 못했습니다.';});
}

const SETTINGS_TABS=[['center','센터·접수·결제'],['products','이용권'],['categories','게시판·건의 분류'],['terms','규정·동의'],['forms','신청서'],['qr','회원용 QR']];
function renderSettings(root) {
  root.innerHTML=toolbar('회원서비스 설정','운영값을 저장하면 새 신청부터 적용됩니다. 과거 신청 당시 금액·규정은 유지됩니다.')+`<div class="ms-subnav">${SETTINGS_TABS.map(([key,name])=>button(name,`data-settings-tab="${key}"`,`soft-button ${state.settingsTab===key ? 'active' : ''}`)).join('')}</div><div data-settings-panel></div>`;
  const target=$('[data-settings-panel]',root), tab=state.settingsTab;
  if(tab==='center') renderCenterSettings(target);
  if(tab==='products') renderProducts(target);
  if(tab==='categories') renderCategories(target);
  if(tab==='terms') renderTerms(target);
  if(tab==='forms') renderForms(target);
  if(tab==='qr') renderQr(target).catch((e)=>{target.innerHTML=`<div class="ms-error">${h(errorText(e))}</div>`;});
}
function renderCenterSettings(root) {
  const s=state.settings.data || state.settings;
  root.innerHTML=`<form data-center-settings class="ms-card"><div class="ms-message" role="alert"></div><h3>센터 기본 정보</h3><div class="ms-form-grid">${field('center_name','센터명',s.center_name,'text','required maxlength="160"')}${field('contact','연락처',s.contact,'text','maxlength="80"')}${field('main_title','회원용 메인 제목',s.main_title || '회원분들께 보고드립니다.','text','required maxlength="160"')}${field('subtitle','보조 문구',s.subtitle || '회원님의 의견과 센터의 운영 소식을 전합니다.','text','maxlength="240"')}${textarea('intro','센터 안내 문구',s.intro,'maxlength="3000"')}</div><h3>메뉴 및 접수</h3><div class="ms-form-grid">${check('menu_renew','빠른 연장 메뉴 표시',s.menu_renew !== false)}${check('menu_requests','건의·요청 메뉴 표시',s.menu_requests !== false)}${check('menu_my','내 신청내역 메뉴 표시',s.menu_my !== false)}${check('menu_board','공지·조치사항 메뉴 표시',s.menu_board !== false)}${check('applications_enabled','신규·재등록 신청 접수 허용',s.applications_enabled)}${check('requests_enabled','건의·요청 접수 허용',s.requests_enabled)}</div><div class="ms-notice warning">신청 접수는 개인정보 수집 목적·항목·보유기간, 승인된 개인정보 동의·이용규정, 신청서가 준비되어야 켤 수 있습니다. 계좌가 비어 있으면 계좌이체 신청은 중단됩니다.</div><h3>수납 안내</h3><div class="ms-form-grid">${field('bank_name','은행',s.bank_name,'text','maxlength="80"')}${field('bank_account','계좌번호',s.bank_account,'text','maxlength="80"')}${field('bank_holder','예금주',s.bank_holder,'text','maxlength="80"')}${textarea('transfer_guide','계좌이체 안내',s.transfer_guide,'maxlength="3000"')}${textarea('card_guide','현장 카드결제 안내',s.card_guide,'maxlength="3000"')}</div><h3>개인정보 운영 설정</h3><div class="ms-form-grid">${textarea('privacy_purpose','개인정보 수집 목적',s.privacy_purpose,'maxlength="5000"')}${textarea('privacy_items','수집 항목',s.privacy_items,'maxlength="5000"')}${textarea('privacy_retention','보유기간 및 파기 기준',s.privacy_retention,'maxlength="5000"')}</div><p class="ms-meta">실제 운영 기준과 기록 보존 필요성을 확인해 입력하세요. 이 설정으로 기존 기록을 일괄 삭제하지 않습니다. 지문·주민등록번호·불필요한 건강정보는 수집하지 않습니다.</p><h3>신청서·건의 안내</h3><div class="ms-form-grid">${check('signature_enabled','최초 신청 서명 사용',s.signature_enabled)}${field('photo_limit','사진 첨부 제한 (0~10장, 0은 미사용)',s.photo_limit ?? 5,'number','required min="0" max="10"')}${textarea('request_guide','건의·요청 작성 안내',s.request_guide,'maxlength="3000"')}</div><div class="ms-dialog-footer"><button type="submit" class="primary-button">센터 설정 저장</button></div></form>`;
  $('form',root).addEventListener('submit',(event)=>{event.preventDefault();const form=event.currentTarget;busy(form,async()=>{const values=formData(form);const result=await save('settings',values);state.settings=result.item || values;alertIn(form,'설정을 저장했습니다. 새 신청부터 적용됩니다.',false);});});
}
function renderProducts(root) {
  root.innerHTML=`<div class="ms-toolbar"><p>사진 기준 초기 상품은 검토·활성화 전까지 판매되지 않습니다.</p>${button('이용권 상품 추가','data-ms-command="new-product"','primary-button')}</div><div class="ms-grid">${arr(state.lists.products).map((p)=>`<article class="ms-card"><div class="ms-card-heading"><h3>${h(p.name)}</h3>${badge(p.active && p.reviewed ? 'active' : p.reviewed ? 'inactive' : 'review_required')}</div><p>${h(label(p.facility))} · ${h(p.duration_days)}일 · <strong>${money(p.price)}</strong></p><p class="ms-meta">지정 일수 · 적용 ${h(day(p.effective_from))} · 순서 ${h(p.sort_order)}</p><div class="ms-actions">${button('수정·검토',`data-ms-command="edit-product" data-id="${h(p.id)}"`)}</div></article>`).join('')}</div>`;
}
function editProduct(p = {}) {
  dialog(p.id ? '이용권 상품 수정·검토' : '이용권 상품 추가',`<div class="ms-form-grid">${field('name','상품명',p.name,'text','required maxlength="120"')}${field('facility','시설·권종 식별자',p.facility,'text','required maxlength="80" pattern="[a-zA-Z0-9_-]+"')}${field('duration_days','이용 일수',p.duration_days,'number','required min="1" max="3650"')}${field('price','금액 (원)',p.price,'number','required min="0" step="1"')}${select('calculation_method','계산 방식',[['days','지정 일수 (시작일 포함)']],p.calculation_method || 'days')}${field('effective_from','적용 시작일',p.effective_from || todayKst(),'date','required')}${field('sort_order','노출 순서',p.sort_order || 0,'number','required min="0"')}${check('reviewed','사진과 실제 운영 금액·기간 검토 완료',p.reviewed)}${check('active','판매 활성화',p.active)}</div><div class="ms-notice">헬스: fitness · 골프: golf · 헬스+골프: fitness_golf. 같은 시설 권종은 같은 식별자를 사용합니다. 사용된 상품의 시설 식별자는 변경할 수 없습니다. 새 권종은 영문 식별자로 추가하세요. 30일권은 시작일을 첫날로 계산합니다. 예: 10월 1일 시작 → 10월 30일 종료.</div>`,async(data)=>{await save('products',{...data,...(p.id ? {id:p.id,expected_updated_at:p.updated_at} : {})});closeDialog();await refresh('settings');});
}
function renderCategories(root) {
  root.innerHTML=`<div class="ms-toolbar"><p>사용된 분류는 삭제 대신 비활성화하세요.</p>${button('분류 추가','data-ms-command="new-category"','primary-button')}</div><div class="ms-grid">${arr(state.lists.categories).sort((a,b)=>a.sort_order-b.sort_order).map((c)=>`<article class="ms-card"><div class="ms-card-heading"><h3>${h(c.name)}</h3>${badge(c.active ? 'active' : 'inactive')}</div><p class="ms-meta">${c.kind==='board' ? '회원 안내 게시판' : '건의·요청'} · 순서 ${h(c.sort_order)}</p><div class="ms-actions">${button('수정',`data-ms-command="edit-category" data-id="${h(c.id)}"`)}</div></article>`).join('')}</div>`;
}
function editCategory(c = {}) {
  dialog(c.id ? '분류 수정' : '분류 추가',`<div class="ms-form-grid">${field('name','분류명',c.name,'text','required maxlength="80"')}${select('kind','사용 위치',[['board','회원 안내 게시판'],['request','건의·요청']],c.kind || 'board')}${field('sort_order','노출 순서',c.sort_order || 0,'number','required min="0"')}${check('active','사용',c.active !== false)}</div>`,async(data)=>{await save('categories',{...data,...(c.id ? {id:c.id} : {})});closeDialog();await refresh('settings');});
}
function renderTerms(root) {
  root.innerHTML=`<div class="ms-notice warning">사진의 흐리거나 잘린 문장은 확정하지 않았습니다. 운영자가 실제 적용할 원문을 검토·수정하고 승인하세요. 전자화 자체가 법적 검토 완료를 의미하지 않습니다.</div><div class="ms-toolbar"><p>저장은 새 버전을 만들며 기존 동의기록은 유지됩니다.</p>${button('규정·동의 추가','data-ms-command="new-term"','primary-button')}</div><div class="ms-grid">${arr(state.lists.terms).map((t)=>`<article class="ms-card"><div class="ms-card-heading"><h3>${h(t.title)}</h3>${badge(t.approved && t.active ? 'active' : 'review_required')}</div><p class="ms-meta">${h({privacy:'개인정보',rules:'이용규정',guardian:'보호자 동의'}[t.kind] || t.kind)} · 버전 ${h(t.version)} · ${t.required ? '필수' : '선택'} · ${t.active ? '현재 버전' : '이전·비활성 버전'}</p><p>${h(String(t.body || '').slice(0,200))}</p><div class="ms-actions">${button('검토·새 버전 작성',`data-ms-command="edit-term" data-id="${h(t.id)}"`)}</div></article>`).join('')}</div>`;
}
function editTerm(t = {}) {
  dialog('규정·동의 새 버전 작성',`<div class="ms-form-grid">${field('title','제목',t.title,'text','required maxlength="160"')}${select('kind','종류',[['privacy','개인정보 수집·이용'],['rules','이용규정'],['guardian','보호자 안내·동의']],t.kind || 'rules')}${textarea('body','실제 적용할 규정·동의 원문',t.body,'required maxlength="30000"')}${check('required','필수 동의',t.required !== false)}${check('active','현재 적용 버전',t.active !== false)}${check('approved','원문과 운영 기준을 검토하고 적용 승인',false)}</div><div class="ms-notice warning">승인하지 않으면 신청에 적용되지 않습니다. 임의의 환불·연기·양도·책임 조건을 더하지 말고 실제 운영 규정을 확인하세요.</div>`,async(data)=>{await save('terms',data);closeDialog();await refresh('settings');},'새 버전 저장');
}
function renderForms(root) {
  const form=arr(state.lists.forms).find((f)=>f.active);
  root.innerHTML=`<div class="ms-card"><h3>추가 신청 항목</h3><p>이름·회원 확인·상품·금액·결제·권한의 핵심 항목은 보호됩니다. 아래에서 추가 항목만 설정합니다.</p><p class="ms-meta">현재 버전 ${h(form?.version || '미등록')} · 추가 항목 ${arr(form?.fields).length}개</p>${arr(form?.fields).map((f)=>`<p><strong>${h(f.label)}</strong> · ${h({text:'짧은 글',textarea:'긴 글',select:'선택지',checkbox:'체크박스'}[f.type])} · ${f.required ? '필수' : '선택'}</p>`).join('')}<div class="ms-actions">${button('추가 항목 편집·새 버전 저장','data-ms-command="edit-form"','primary-button')}</div><p class="ms-meta">추가 항목이 없어도 빈 신청서를 한 번 저장해 활성화할 수 있습니다. 임의 HTML·JavaScript 입력 기능은 제공하지 않습니다.</p></div>`;
}
function editForm() {
  const current=arr(state.lists.forms).find((f)=>f.active); const fields=structuredClone(arr(current?.fields));
  const node=dialog('신청서 추가 항목 편집',`<p class="ms-meta">위에서 아래 순서로 표시됩니다. 개인식별번호·생체정보·건강정보를 수집하지 마세요. 항목 식별자는 extra_로 시작하는 영문·숫자·밑줄로 입력합니다. 예: extra_visit_time</p><div data-form-fields class="ms-field-list"></div><div class="ms-actions">${button('항목 추가','data-add-field')}</div>`,async()=>{
    read(); const keys=fields.map((f)=>f.key); if(new Set(keys).size!==keys.length)throw new Error('항목 식별자가 중복되었습니다.');
    for(const f of fields){if(!/^extra_[a-z0-9_]{1,40}$/.test(f.key))throw new Error('항목 식별자는 extra_로 시작하고 뒤에 1~40자의 영문 소문자·숫자·밑줄이어야 합니다.');if(!f.label)throw new Error('항목명을 입력하세요.');if(f.type==='select' && !f.options.length)throw new Error('선택 항목의 선택지를 입력하세요.');}
    await save('forms',{fields,active:true});closeDialog();await refresh('settings');
  },'새 신청서 버전 저장');
  function read(){ $$('[data-field-row]',node).forEach((row,i)=>{const values=formData(row);fields[i]={key:values.key,label:values.label,type:values.type,required:values.required,help:values.help,options:values.type==='select' ? values.options.split('\n').map((v)=>v.trim()).filter(Boolean) : []};}); }
  function draw(){ $('[data-form-fields]',node).innerHTML=fields.map((f,i)=>`<div class="ms-field-row" data-field-row="${i}"><div class="ms-form-grid">${field('key','항목 식별자',f.key,'text','required maxlength="64"')}${field('label','항목명',f.label,'text','required maxlength="120"')}${select('type','입력 유형',[['text','짧은 글'],['textarea','긴 글'],['select','선택지'],['checkbox','체크박스']],f.type)}${check('required','필수',f.required)}${field('help','도움말',f.help,'text','maxlength="300"')}${textarea('options','선택지 (한 줄에 하나)',arr(f.options).join('\n'),'maxlength="3000"')}</div><div class="ms-actions">${button('위로',`data-field-up="${i}" ${i===0?'disabled':''}`)}${button('아래로',`data-field-down="${i}" ${i===fields.length-1?'disabled':''}`)}${button('삭제',`data-field-remove="${i}"`,'danger-button')}</div></div>`).join('') || empty('추가 항목이 없습니다.'); }
  $('[data-add-field]',node).addEventListener('click',()=>{read();if(fields.length>=20){alertIn(node,'추가 항목은 최대 20개입니다.');return;}fields.push({key:'extra_',label:'',type:'text',required:false,help:'',options:[]});draw();});
  $('[data-form-fields]',node).addEventListener('click',(event)=>{const b=event.target.closest('button');if(!b)return;read();if(b.dataset.fieldRemove!==undefined)fields.splice(Number(b.dataset.fieldRemove),1);if(b.dataset.fieldUp!==undefined){const i=Number(b.dataset.fieldUp);[fields[i-1],fields[i]]=[fields[i],fields[i-1]];}if(b.dataset.fieldDown!==undefined){const i=Number(b.dataset.fieldDown);[fields[i+1],fields[i]]=[fields[i],fields[i+1]];}draw();}); draw();
}
function memberUrl() { return 'https://onesports-management.vercel.app/members'; }
let qrSvg='';
async function renderQr(root) {
  const url=memberUrl(); const {default:qrcode}=await import('./vendor/qrcode.mjs');const qr=qrcode(0,'M');qr.addData(url);qr.make();qrSvg=qr.createSvgTag({cellSize:6,margin:24,scalable:true});
  root.innerHTML=`<div class="ms-card"><h3>회원용 공통 QR</h3><p>센터 안내데스크와 안내문에 사용하세요. 회원용 메인으로 연결되며 개인 인증은 별도로 진행됩니다.</p><div class="ms-qr" data-qr-image></div><a class="ms-code" href="${h(url)}" target="_blank" rel="noopener">${h(url)}</a><div class="ms-actions">${button('SVG 저장','data-ms-command="qr-save"','primary-button')}${button('링크 복사','data-ms-command="qr-copy"')}</div><p class="ms-meta">이 QR에는 이름·전화번호·초대코드·인증토큰이 없습니다. 운영 주소가 바뀌기 전까지 같은 QR을 사용할 수 있습니다.</p></div>`;
  $('[data-qr-image]',root).innerHTML=qrSvg;
}
function saveQr(){if(!qrSvg)throw new Error('QR을 먼저 불러오세요.');const url=URL.createObjectURL(new Blob([qrSvg],{type:'image/svg+xml;charset=utf-8'}));const link=document.createElement('a');link.href=url;link.download='onesports-members-qr.svg';link.click();setTimeout(()=>URL.revokeObjectURL(url),5000);}
