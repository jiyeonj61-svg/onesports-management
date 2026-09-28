import { service, guestService, encodeGuestPhoto, photoUrl, escapeHtml as e, todayKst } from './member-client.js';

const content = document.getElementById('memberContent');
const state = { home: null, busy: false, epoch: 0, photoEpoch: 0, receipt: null, receiptKey: '', receiptNumber: '', receiptSaved: true, objectURLs: new Set(), submittingPath: '' };
const money = value => `${Number(value || 0).toLocaleString('ko-KR')}원`;
const rows = value => Array.isArray(value) ? value : [];
const text = value => e(value == null ? '' : String(value));
const date = value => value ? text(String(value).slice(0, 10).replaceAll('-', '.')) : '미정';
const when = value => value ? text(new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value))) : '미정';
const settings = () => state.home?.settings || {};
const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${({ home: '<path d="m3 10 9-7 9 7v10H3Z"/><path d="M9 20v-7h6v7"/>', renew: '<path d="M20 7a9 9 0 1 0 1 8"/><path d="M20 2v6h-6"/><path d="M12 8v8m-4-4h8"/>', requests: '<path d="M20 15a3 3 0 0 1-3 3H8l-5 4V5a3 3 0 0 1 3-3h11a3 3 0 0 1 3 3Z"/><path d="M7 8h9M7 12h6"/>', my: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 2h6v4H9ZM9 11h6M9 15h6"/>', board: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 8h10M7 12h10M7 16h6"/>' })[name] || ''}</svg>`;
const pageHeading = (title, subtitle = '') => `<a class="member-back" href="/members" data-member-route>‹ 회원 홈</a><h1>${text(title)}</h1>${subtitle ? `<p class="member-muted">${text(subtitle)}</p>` : ''}`;
const notice = (value, type = '') => `<div class="member-notice ${type}">${text(value)}</div>`;
const empty = value => `<div class="member-empty">${text(value)}</div>`;
const field = (label, name, value = '', extra = '') => `<label class="member-field">${text(label)}<input name="${text(name)}" value="${text(value)}" ${extra} /></label>`;
const errorSlot = '<div class="member-error" data-form-error role="alert" hidden></div>';
const statusLabels = {
  new: '새 신청', pending: '처리 대기', needs_review: '확인 필요', completed: '처리 완료', cancelled: '취소', refund_required: '환불 확인 필요',
  awaiting: '결제 확인 대기', reported: '입금 확인 요청', confirmed: '결제 확인 완료', applied: '이용권 반영 완료', revoked: '이용권 사용 중지',
  reserved: '자리 임시 확보', unassigned: '회원·자리 확인 대기', converted: '관리자 확인·신청 반영', submitted: '접수 완료', waitlisted: '대기접수', expired: '자리 배정 재확인', received: '접수 완료', reviewing: '확인 중', in_progress: '조치 중', needs_info: '추가 확인 필요', held: '보류', declined: '반영 어려움', active: '이용권 등록', suspended: '이용 연기 중', done: '외부 출입 반영 완료',
};
const badge = (value, fallback = '') => `<span class="member-badge ${['completed', 'applied', 'confirmed', 'done', 'active'].includes(value) ? '' : ['cancelled', 'refund_required', 'revoked', 'declined'].includes(value) ? 'danger' : 'waiting'}">${text(statusLabels[value] || fallback || value)}</span>`;

function route() {
  const path = location.pathname.replace(/\/$/, '').replace(/\.html$/, '');
  return path.endsWith('/renew') ? 'renew' : path.endsWith('/requests') ? 'requests' : path.endsWith('/my') ? 'my' : 'home';
}
function navigate(path) {
  if (state.busy) { toast('접수 결과를 확인 중입니다. 잠시만 기다려 주세요.'); return; }
  history.pushState({}, '', path);
  loadView();
  window.scrollTo({ top: 0, behavior: 'instant' });
}
function toast(message) {
  const el = document.getElementById('memberToast');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { el.hidden = true; }, 5500);
}
function fail(form, error) {
  let box = form?.querySelector('[data-form-error]');
  if (!box) { toast(error?.message || '처리하지 못했습니다. 다시 시도해 주세요.'); return; }
  box.textContent = error?.message || '처리하지 못했습니다. 다시 시도해 주세요.';
  box.hidden = false;
  box.scrollIntoView({ block: 'nearest' });
}
function connection() {
  const box = document.getElementById('memberConnection');
  box.hidden = navigator.onLine;
  box.textContent = '인터넷 연결이 끊겼습니다. 다시 연결한 후 신청해 주세요. 입력 내용은 접수되지 않았습니다.';
  document.querySelectorAll('[data-requires-network]').forEach(el => { el.disabled = !navigator.onLine || state.busy || el.dataset.unavailable === 'true'; });
}
function navigation() {
  const s = settings();
  const active = route();
  const entries = [['home', '홈', '/members', true], ['renew', '빠른 연장', '/members/renew', s.menu_renew !== false], ['requests', '건의·요청', '/members/requests', s.menu_requests !== false], ['my', '접수 조회', '/members/my', s.menu_my !== false]];
  document.getElementById('memberNav').innerHTML = entries.filter(v => v[3]).map(([id, label, href]) => `<a href="${href}" data-member-route class="${active === id ? 'active' : ''}" ${active === id ? 'aria-current="page"' : ''}>${icon(id)}<span>${label}</span></a>`).join('');
  document.getElementById('memberCenterName').textContent = s.center_name || '힐스테이트 상도 센트럴파크 1단지';
  document.getElementById('memberContact').textContent = s.contact ? `문의 ${s.contact}` : '';
}
function photos(paths, label = '첨부 사진') {
  return rows(paths).length ? `<div class="member-photo-grid">${rows(paths).map(path => `<a data-photo="${text(path)}" target="_blank" rel="noopener noreferrer" aria-label="${text(label)} 크게 보기"><span class="member-photo-loading">사진 불러오는 중</span></a>`).join('')}</div>` : '';
}
async function loadPhotos() {
  const epoch = ++state.photoEpoch;
  await Promise.allSettled([...content.querySelectorAll('[data-photo]')].map(async el => {
    try {
      const url = await photoUrl(el.dataset.photo);
      if (epoch !== state.photoEpoch || !el.isConnected) return;
      if (!url || !/^https?:\/\//.test(url)) throw new Error('사진 연결을 확인할 수 없습니다.');
      el.href = url;
      const img = new Image();
      img.loading = 'lazy'; img.alt = '첨부 사진'; img.src = url;
      img.addEventListener('error', () => { el.textContent = '사진을 불러오지 못했습니다. 새로고침해 주세요.'; });
      el.replaceChildren(img);
    } catch {
      if (epoch === state.photoEpoch && el.isConnected) el.textContent = '사진을 불러오지 못했습니다.';
    }
  }));
}
function postCard(post) {
  const category = rows(state.home.categories).find(item => item.id === post.category_id)?.name || '센터 소식';
  return `<details class="member-post ${post.pinned ? 'pinned' : ''}"><summary><div class="member-meta"><span class="member-badge">${post.pinned ? '고정 공지' : text(category)}</span><span>${date(post.publish_at)}</span></div><h3>${text(post.title)}</h3>${post.location ? `<div class="member-meta">${text(post.location)}</div>` : ''}</summary><div class="member-post-body"><div class="member-pre">${text(post.body)}</div>${post.progress_status || post.action_date ? `<div class="member-meta">${text(post.progress_status)} ${post.action_date ? `· 조치일 ${date(post.action_date)}` : ''}</div>` : ''}${photos(post.photos)}${rows(post.before_photos).length ? `<h4>조치 전</h4>${photos(post.before_photos, '조치 전 사진')}` : ''}${rows(post.after_photos).length ? `<h4>조치 후</h4>${photos(post.after_photos, '조치 후 사진')}` : ''}</div></details>`;
}
function renderHome() {
  const s = settings();
  const posts = rows(state.home.posts);
  const menus = [['renew', '빠른 연장', '/members/renew', s.menu_renew], ['requests', '건의·요청하기', '/members/requests', s.menu_requests], ['my', '접수 조회', '/members/my', s.menu_my], ['board', '공지·조치사항', '/members#memberBoard', s.menu_board]];
  content.innerHTML = `<section class="member-hero"><p class="member-eyebrow">${text(s.center_name || 'ONE SPORTS FITNESS')}</p><h1>${text(s.main_title || '회원분들께 보고드립니다.')}</h1><p>${text(s.subtitle || '회원님의 의견과 센터의 운영 소식을 전합니다.')}</p></section><nav class="member-menu-grid" aria-label="바로가기">${menus.filter(v => v[3] !== false).map(([id, label, href]) => `<a class="member-menu" href="${href}" data-member-route>${icon(id)}<span>${label} <span aria-hidden="true">›</span></span></a>`).join('')}</nav>${s.intro ? notice(s.intro) : ''}${s.menu_board === false ? '' : `<section id="memberBoard">${posts.filter(v => v.pinned).length ? `<section class="member-section"><h2>상단 고정 공지</h2>${posts.filter(v => v.pinned).map(postCard).join('')}</section>` : ''}${rows(state.home.categories).map(cat => `<section class="member-section"><div class="member-section-heading"><h2>${text(cat.name === '조치사항' ? '최근 조치사항' : cat.name)}</h2></div>${posts.filter(v => v.category_id === cat.id && !v.pinned).map(postCard).join('') || empty('등록된 소식이 없습니다.')}</section>`).join('') || empty('게시된 소식이 없습니다. 새로운 센터 소식을 이곳에서 확인해 주세요.')}</section>`}`;
}
function customFields() {
  return rows(state.home.form?.fields).map(f => {
    const name = `extra_${f.key}`;
    const attrs = `${f.required ? 'required' : ''} name="${text(name)}"`;
    const help = f.help ? `<small>${text(f.help)}</small>` : '';
    if (f.type === 'checkbox') return `<label class="member-check"><input type="checkbox" ${attrs} /><span>${text(f.label)}${f.required ? ' (필수)' : ''}${help}</span></label>`;
    if (f.type === 'select') return `<label class="member-field">${text(f.label)}${f.required ? ' (필수)' : ''}<select ${attrs}><option value="">선택해 주세요</option>${rows(f.options).map(v => `<option value="${text(v)}">${text(v)}</option>`).join('')}</select>${help}</label>`;
    if (f.type === 'textarea') return `<label class="member-field">${text(f.label)}${f.required ? ' (필수)' : ''}<textarea ${attrs} maxlength="3000"></textarea>${help}</label>`;
    return `<label class="member-field">${text(f.label)}${f.required ? ' (필수)' : ''}<input ${attrs} maxlength="500" />${help}</label>`;
  }).join('');
}
function termsMarkup(kind = 'all') {
  return rows(state.home.terms).filter(t => t.kind !== 'guardian' && (kind === 'all' || t.kind === kind)).map(t => `<div class="member-term"><label class="member-check"><input type="checkbox" name="consents" value="${text(t.id)}" ${t.required ? 'required' : ''} /><span>${text(t.title)} ${t.required ? '(필수)' : '(선택)'}</span></label><details><summary>내용 보기 · 버전 ${text(t.version)}</summary><div class="member-pre">${text(t.body)}</div></details></div>`).join('');
}

function collectionOpen(kind) {
  const s = settings();
  const terms = rows(state.home?.terms);
  const privacy = terms.some(t => t.kind === 'privacy' && t.approved === true && t.active === true);
  if (kind === 'request') return s.requests_enabled === true && privacy && rows(state.home?.request_categories).length > 0;
  return s.applications_enabled === true && privacy && terms.some(t => t.kind === 'rules' && t.approved === true && t.active === true) && !!state.home?.form?.id;
}
function setupNotice(kind) {
  return notice(kind === 'application' ? '가입 없이 이용 신청을 준비할 수 있는 화면입니다. 현재 요금·개인정보 안내·운영규정 등 관리자 설정을 확인하고 있어 입력과 접수는 아직 열리지 않았습니다. 설정 완료 후 이 화면에서 바로 신청할 수 있습니다.' : '가입 없이 건의·요청을 접수하는 화면입니다. 현재 개인정보 안내 등 관리자 설정을 확인하고 있어 입력과 접수는 아직 열리지 않았습니다.', 'warning');
}
function profileFields() {
  return `${field('신청자 이름', 'name', '', 'required maxlength="60" autocomplete="name"')}<div class="member-two-columns">${field('동', 'building', '', 'required maxlength="20"')}${field('호수', 'unit', '', 'required maxlength="20"')}</div>${field('휴대폰 번호', 'phone', '', 'type="tel" autocomplete="tel" required maxlength="24" inputmode="tel"')}<p class="member-muted">신청 확인과 연락에 사용합니다. 입력한 정보로 기존 회원정보를 자동 조회하거나 가족 정보를 보여주지 않습니다.</p>`;
}
const honeypot = '<div class="member-honeypot" aria-hidden="true"><label>웹사이트<input name="website" type="text" tabindex="-1" autocomplete="off" /></label></div>';
function renderRenew() {
  const s = settings();
  const products = rows(state.home.products);
  const classes = rows(state.home.gx_classes).filter(v => v.status === 'open' && new Date(v.registration_start) <= new Date() && new Date(v.registration_end) >= new Date());
  const available = collectionOpen('application') && (products.length > 0 || classes.length > 0);
  content.innerHTML = `${pageHeading('빠른 연장·재등록', '계정을 만들지 않고 신청해 주세요. 회원 확인과 결제 확인 후 이용권을 반영합니다.')}${!available ? setupNotice('application') : notice('기존 이용권과 입주민 여부는 관리자가 확인합니다. 신청 접수만으로 이용기간이 늘어나지는 않습니다.')}<form class="member-form" data-form="application"><fieldset class="member-form-fieldset" ${available ? '' : 'disabled'}>${honeypot}<section class="member-form-section"><h2>1. 신청자 정보</h2><div class="member-form"><label class="member-field">신청 구분<select name="kind" required><option value="renewal">기존 회원 재등록</option><option value="new">신규 이용 신청</option></select></label>${profileFields()}</div></section><section class="member-form-section"><h2>2. 이용권 선택</h2><div class="member-form"><label class="member-field">이용권 또는 GX 반<select name="selection" required><option value="">${products.length || classes.length ? '선택해 주세요' : '관리자가 이용권을 확인하고 있습니다'}</option>${products.length ? `<optgroup label="헬스·골프 이용권">${products.map(v => `<option value="product:${text(v.id)}">${text(v.name)} · ${text(v.duration_days)}일 · ${money(v.price)}</option>`).join('')}</optgroup>` : ''}${classes.length ? `<optgroup label="GX 프로그램">${classes.map(v => `<option value="gx:${text(v.id)}">${text(v.name)} ${text(v.class_name)} · ${text(v.start_time?.slice(0,5))} · ${money(v.price)}</option>`).join('')}</optgroup>` : ''}</select></label><div id="memberSelectionDetail"></div><label class="member-field" id="memberDesiredDate">희망 시작일<input name="desired_start_date" type="date" value="${todayKst()}" min="${todayKst()}" required /><small>기존 이용기간과 관리자 확인 시점을 반영하여 최종 기간을 정합니다.</small></label><div id="memberPeriodPreview"></div><div id="memberGuardianFields"></div></div></section><section class="member-form-section"><h2>3. 결제방식</h2><div class="member-form"><label class="member-check"><input type="radio" name="payment_method" value="card" checked required /><span>현장 카드결제<small>센터 방문 후 카드단말기로 결제합니다.</small></span></label><label class="member-check"><input type="radio" name="payment_method" value="transfer" ${s.transfer_available === true ? '' : 'disabled'} /><span>계좌이체<small>${s.transfer_available === true ? '접수 확인 화면에서 입금 안내를 확인합니다. GX는 자리 배정 후 안내합니다.' : '입금계좌 설정이 필요하여 현재 이용할 수 없습니다.'}</small></span></label><label class="member-field" id="memberPayerField" hidden>입금자명<input name="payer_name" maxlength="60" /></label>${notice('온라인 결제는 진행하지 않습니다. 관리자의 실제 결제 확인 후 재등록이 완료됩니다.')}</div></section><section class="member-form-section"><h2>4. 안내·동의</h2><div class="member-form">${customFields()}${termsMarkup()}${!rows(state.home.terms).length ? notice('관리자가 확인한 개인정보 안내와 이용규정이 이곳에 표시됩니다.', 'warning') : ''}${s.signature_enabled ? '<div id="memberSignatureSection" hidden><label class="member-field">신규 신청자 서명<small>서명은 비공개 접수기록으로 보관됩니다.</small><canvas id="memberSignature" class="member-signature" aria-label="신청자 서명란"></canvas></label><button class="member-secondary" type="button" data-clear-signature>서명 지우기</button></div>' : ''}<label class="member-check"><input type="checkbox" name="confirm_application" required /><span>상품·금액·신청내용을 확인했습니다. 회원정보와 결제 확인 후 이용기간이 확정됨을 이해했습니다.</span></label></div></section></fieldset>${errorSlot}<button class="member-button member-full" type="submit" data-requires-network data-unavailable="${!available}" ${available ? '' : 'disabled'}>${available ? '가입 없이 신청 접수하기' : '센터 설정 완료 후 접수 가능'}</button><p class="member-muted">빠른 연장은 유료 재등록입니다. 이용을 잠시 중단하는 이용 연기는 안내데스크로 문의해 주세요.</p></form>`;
}
function selectedItem(form) {
  const [kind, id] = (form.elements.selection.value || '').split(':');
  return { kind, item: rows(kind === 'gx' ? state.home.gx_classes : state.home.products).find(v => v.id === id) };
}
function addDays(value, days) { const d = new Date(`${value}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0,10); }
function selectionChanged(form) {
  const { kind, item } = selectedItem(form);
  const detail = document.getElementById('memberSelectionDetail');
  const desired = document.getElementById('memberDesiredDate');
  const guardian = document.getElementById('memberGuardianFields');
  const preview = document.getElementById('memberPeriodPreview');
  if (!item) { detail.innerHTML = ''; guardian.innerHTML = ''; preview.innerHTML = ''; return; }
  const gx = kind === 'gx';
  desired.hidden = gx; form.elements.desired_start_date.required = !gx; form.elements.desired_start_date.disabled = gx;
  detail.innerHTML = `<div class="member-price-box"><div class="member-price">${money(item.price)}</div><dl class="member-definition"><dt>상품</dt><dd>${text(item.name)} ${text(item.class_name || '')}</dd>${gx ? `<dt>수강기간</dt><dd>${date(item.period_start)} ~ ${date(item.period_end)}</dd><dt>요일·시간</dt><dd>${rows(item.weekdays).map(v => ['','월','화','수','목','금','토','일'][v] || '').join('·')} ${text(item.start_time?.slice(0,5))}</dd><dt>정원·남은 자리</dt><dd>${text(item.capacity)}명 · ${text(item.remaining_seats ?? '확인 중')}자리</dd>` : `<dt>이용기간</dt><dd>${text(item.duration_days)}일 · 시작일 포함</dd>`}</dl></div>${gx ? notice('남은 자리는 조회 시점 기준입니다. 관리자가 회원 확인과 자리 배정을 진행합니다. 자리 배정 전에는 입금하지 마세요.') : ''}`;
  guardian.innerHTML = gx && item.is_child ? `<div class="member-form">${field('어린이 수강생 이름', 'student_name', '', 'required maxlength="60"')}<p class="member-muted">위 신청자 정보에는 보호자 정보를 입력해 주세요. 어린이 수강생과 보호자를 구분하여 접수합니다.</p><div class="member-pre member-notice">${text(item.guardian_terms || '보호자 안내를 확인해 주세요.')}</div><label class="member-check"><input name="guardian_consent" type="checkbox" required /><span>보호자로서 어린이 수강 신청과 위 안내에 동의합니다.</span></label>${rows(state.home.terms).filter(t => t.kind === 'guardian').map(t => `<div class="member-term"><label class="member-check"><input name="consents" type="checkbox" value="${text(t.id)}" ${t.required ? 'required' : ''} /><span>${text(t.title)}${t.required ? ' (필수)' : ''}</span></label><details><summary>내용 보기</summary><div class="member-pre">${text(t.body)}</div></details></div>`).join('')}</div>` : '';
  if (gx) { preview.innerHTML = ''; return; }
  const start = form.elements.desired_start_date.value || todayKst();
  const end = addDays(start, Number(item.duration_days) - 1);
  preview.innerHTML = `<div class="member-notice"><strong>희망 시작일 기준 ${date(start)} ~ ${date(end)}</strong><p>참고용 기간입니다. 기존 이용권의 남은 기간과 이후 등록분은 관리자가 직접 확인합니다. 최종 기간은 회원 확인·결제 확인 후 확정되며, 확인이 늦어져 이용일수가 자동 차감되지 않도록 처리합니다.</p></div>`;
}
function renderRequests() {
  const s = settings();
  const available = collectionOpen('request');
  const categories = rows(state.home.request_categories);
  const limit = Math.max(0, Math.min(3, Number(s.photo_limit ?? 3)));
  content.innerHTML = `${pageHeading('건의·요청하기', '계정 없이 작성하고, 접수번호와 확인키로 답변을 확인하세요.')}${!available ? setupNotice('request') : ''}${notice(s.request_guide || '다른 사람의 이름·연락처·얼굴이 포함되지 않도록 작성해 주세요. 접수내용과 사진은 확인키를 가진 접수자와 권한 있는 관리자만 볼 수 있습니다.')}<form class="member-form" data-form="request"><fieldset class="member-form-fieldset" ${available ? '' : 'disabled'}>${honeypot}<section class="member-form-section"><h2>1. 신청자 정보</h2><div class="member-form">${profileFields()}</div></section><section class="member-form-section"><h2>2. 건의·요청 내용</h2><div class="member-form"><label class="member-field">분류<select name="category_id" required><option value="">선택해 주세요</option>${categories.map(v => `<option value="${text(v.id)}">${text(v.name)}</option>`).join('')}</select></label>${field('제목', 'title', '', 'required maxlength="150"')}<label class="member-field">내용<textarea name="body" required maxlength="10000" placeholder="어떤 점이 불편한지, 무엇이 필요한지 적어 주세요."></textarea></label>${field('관련 시설 또는 위치 (선택)', 'location', '', 'maxlength="120"')}<div class="member-two-columns" id="memberItemFields" hidden>${field('필요한 물품 (선택)', 'item_name', '', 'maxlength="120"')}${field('수량 (선택)', 'quantity', '', 'type="number" min="1" max="10000" step="1" inputmode="numeric"')}</div><label class="member-field">사진 첨부 (선택)<input name="photos" type="file" accept="image/jpeg,image/png,image/webp" multiple ${limit === 0 ? 'disabled' : ''} /><small>최대 ${limit}장, 원본 장당 8MB · JPG·PNG·WebP. 사진은 용량을 줄이고 위치정보를 제거하여 비공개로 보관합니다.</small></label><div id="memberUploadPreview" class="member-upload-preview"></div></div></section><section class="member-form-section"><h2>3. 개인정보 안내·동의</h2><div class="member-form">${termsMarkup('privacy') || notice('관리자가 승인한 개인정보 처리 안내가 이곳에 표시됩니다.', 'warning')}</div></section></fieldset>${errorSlot}<button class="member-button member-full" type="submit" data-requires-network data-unavailable="${!available}" ${available ? '' : 'disabled'}>${available ? '가입 없이 요청 접수하기' : '센터 설정 완료 후 접수 가능'}</button></form>`;
}

function guestPhotos(list, label = '첨부 사진') {
  return rows(list).length ? `<div class="member-photo-grid">${rows(list).map(photo => `<a data-guest-photo="${text(photo.id)}" target="_blank" rel="noopener noreferrer" aria-label="${text(label)} 크게 보기"><span class="member-photo-loading">사진 불러오는 중</span></a>`).join('')}</div>` : '';
}
function applicationCard(app) {
  const s = state.receipt?.settings || {};
  const snapshot = app.product_snapshot || {};
  const blockedSeat = ['unassigned','waitlisted','expired','cancelled'].includes(app.reservation_status);
  const blockedStatus = ['cancelled','refund_required','needs_review','held'].includes(app.application_status) || ['cancelled','held'].includes(state.receipt?.status);
  const payable = !blockedSeat && !blockedStatus && ['awaiting','reported'].includes(app.payment_status);
  return `<article class="member-card"><h2>${text(snapshot.name || '이용 신청')} ${text(snapshot.class_name || '')}</h2><div class="member-status-row">${badge(app.application_status)}${badge(app.payment_status)}${app.pass_status === 'applied' ? badge('applied') : ''}${app.reservation_status !== 'none' ? badge(app.reservation_status) : ''}</div><dl class="member-definition"><dt>신청 구분</dt><dd>${app.kind === 'new' ? '신규' : '재등록'}</dd><dt>접수 당시 금액</dt><dd><strong>${money(app.amount)}</strong></dd><dt>결제방식</dt><dd>${app.payment_method === 'transfer' ? '계좌이체' : '현장 카드결제'}</dd>${app.student_name ? `<dt>어린이 수강생</dt><dd>${text(app.student_name)}</dd>` : ''}${app.desired_start_date ? `<dt>희망 시작일</dt><dd>${date(app.desired_start_date)}</dd>` : ''}<dt>${app.final_start_date ? '최종 이용기간' : '이용기간'}</dt><dd>${app.final_start_date || app.proposed_start_date ? `${date(app.final_start_date || app.proposed_start_date)} ~ ${date(app.final_end_date || app.proposed_end_date)}` : '관리자 회원 확인 후 확정'}</dd>${app.reservation_expires_at && app.reservation_status === 'reserved' ? `<dt>결제기한</dt><dd>${when(app.reservation_expires_at)}</dd>` : ''}${app.pass_status === 'applied' ? `<dt>외부 출입프로그램</dt><dd>${app.external_status === 'done' ? '관리자 반영 완료' : '관리자 별도 반영 대기'}</dd>` : ''}</dl>${app.reservation_status === 'unassigned' ? notice('회원 확인과 GX 자리 배정을 기다리고 있습니다. 자리 배정 전에는 입금하지 마세요.', 'warning') : app.reservation_status === 'waitlisted' ? notice('현재 대기접수 상태입니다. 자리 배정 전에는 입금하지 마세요.', 'warning') : ''}${app.application_status === 'needs_review' ? notice('관리자가 신청 또는 결제 내용을 확인 중입니다. 센터 안내를 확인해 주세요.', 'warning') : ''}${app.payment_status === 'reported' ? notice('입금 확인을 요청했습니다. 관리자가 실제 입금과 회원정보를 확인한 뒤 이용권을 반영합니다.') : ''}${app.application_status === 'refund_required' ? notice('환불 확인이 필요합니다. 실제 카드 취소·계좌 반환은 센터로 문의해 주세요.', 'warning') : ''}${payable && app.payment_method === 'card' ? notice(s.card_guide || '사전 신청이 완료되었습니다. 안내데스크에서 회원 이름 또는 접수번호를 말씀해 주세요. 카드결제 확인 후 재등록이 완료됩니다.') : ''}${payable && app.payment_method === 'transfer' ? s.bank_name && s.bank_account && s.bank_holder ? `<div class="member-bank"><p>${text(s.bank_name)} · 예금주 ${text(s.bank_holder)}</p><strong>${text(s.bank_account)}</strong><p>입금금액 <b>${money(app.amount)}</b></p><button class="member-secondary" type="button" data-copy-bank>계좌번호 복사</button>${s.transfer_guide ? `<p class="member-muted member-pre">${text(s.transfer_guide)}</p>` : ''}<form class="member-form" data-form="payment-report">${field('입금자명', 'payer_name', app.payer_name || '', 'required maxlength="60"')}${errorSlot}<button class="member-button" type="submit" data-requires-network>${app.payment_status === 'reported' ? '입금자명 수정·확인 재요청' : '입금했어요 — 확인 요청'}</button></form><p class="member-muted">관리자 확인 후 재등록이 완료됩니다.</p></div>` : notice('현재 입금 안내를 확인할 수 없습니다. 임의로 입금하지 말고 센터로 문의해 주세요.', 'warning') : ''}<details class="member-term"><summary>접수 당시 안내·동의 기록</summary>${rows(app.consents_snapshot).map(t => `<h4>${text(t.title)} · ${text(t.version)}</h4><div class="member-pre">${text(t.body)}</div>`).join('') || '<p class="member-muted">접수 당시 기록을 확인 중입니다.</p>'}</details></article>`;
}
function requestCard(req) {
  const category = rows(state.home.request_categories).find(v => v.id === req.category_id)?.name || '건의·요청';
  return `<article class="member-card"><div class="member-meta">${badge(req.status)}<span>${text(category)}</span></div><h2>${text(req.title)}</h2><div class="member-pre">${text(req.body)}</div>${req.location ? `<p class="member-muted">위치: ${text(req.location)}</p>` : ''}${req.item_name ? `<p class="member-muted">물품: ${text(req.item_name)} ${req.quantity ? `· ${text(req.quantity)}개` : ''}</p>` : ''}${guestPhotos(rows(state.receipt?.photos).filter(v => v.purpose === 'photo'))}${req.reply ? `<div class="member-reply"><strong>센터 답변</strong><div class="member-pre">${text(req.reply)}</div>${guestPhotos(rows(state.receipt?.photos).filter(v => v.purpose === 'action'), '조치 사진')}</div>` : '<p class="member-muted">센터에서 확인 후 이 접수내역에 답변을 남깁니다.</p>'}</article>`;
}
function renderMy() {
  if (!state.receipt) {
    content.innerHTML = `${pageHeading('접수 조회', '접수 완료 시 받은 접수번호와 비공개 확인키를 입력해 주세요.')}<section class="member-card"><form class="member-form" data-form="receipt">${field('접수번호', 'receipt_no', state.receiptNumber, 'required maxlength="80" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="접수 완료 화면의 번호"')}<label class="member-field">비공개 확인키<input name="receipt_key" type="password" autocomplete="off" autocapitalize="none" spellcheck="false" required minlength="64" maxlength="64" pattern="[a-fA-F0-9]{64}" value="${text(state.receiptKey)}" /><small>접수할 때 받은 64자리 확인키입니다. 다른 사람에게 공유하지 마세요.</small></label>${errorSlot}<button class="member-button member-full" data-requires-network type="submit">내 접수내용 조회</button></form></section>${notice('이름·동호수·휴대폰 번호로 기존 회원정보나 다른 접수내역을 조회할 수 없습니다. 확인키를 잃어버렸다면 안내데스크로 문의해 주세요.')}`;
    return;
  }
  const receipt = state.receipt;
  const p = receipt.profile_snapshot || {};
  content.innerHTML = `${pageHeading(state.receiptSaved ? '내 접수내용' : '접수가 완료되었습니다.', '접수 완료와 최종 처리 완료는 다릅니다. 아래에서 진행 상태를 확인하세요.')}<section class="member-card member-receipt"><div class="member-success-mark" aria-hidden="true">✓</div><p class="member-number">접수번호</p><h2>${text(receipt.receipt_no || state.receiptNumber)}</h2><div class="member-status-row">${badge(receipt.status)}</div>${!state.receiptSaved ? notice('아래 접수번호와 확인키를 지금 복사하거나 파일로 저장해 주세요. 이 브라우저는 확인키를 영구 저장하지 않으며, 새로고침하거나 창을 닫으면 다시 입력해야 합니다.', 'warning') : ''}<details ${state.receiptSaved ? '' : 'open'}><summary>내 비공개 확인키</summary><code class="member-receipt-key">${text(state.receiptKey)}</code><p class="member-muted">확인키를 아는 사람은 이 접수내용과 답변을 볼 수 있습니다. 안전하게 보관해 주세요.</p></details><div class="member-actions"><button class="member-button" type="button" data-copy-receipt>접수정보 복사</button><button class="member-secondary" type="button" data-download-receipt>확인서 저장</button></div><details class="member-submitted-profile"><summary>내가 입력한 신청자 정보</summary><dl class="member-definition"><dt>이름</dt><dd>${text(p.name)}</dd><dt>동·호수</dt><dd>${text(p.building)}동 ${text(p.unit)}호</dd><dt>연락처</dt><dd>${text(p.phone)}</dd></dl><p class="member-muted">이번 접수에서 입력한 정보이며, 기존 회원자료를 조회한 결과가 아닙니다.</p></details></section>${receipt.application ? applicationCard(receipt.application) : ''}${receipt.request ? requestCard(receipt.request) : ''}${receipt.kind === 'application' ? guestPhotos(rows(receipt.photos).filter(v => v.purpose === 'signature'), '내 서명') : ''}<div class="member-actions"><button class="member-secondary" type="button" data-refresh-receipt>처리상태 새로고침</button><button class="member-text-button" type="button" data-end-receipt>조회 끝내기</button></div>`;
  loadGuestPhotos();
}
function receiptText() {
  return `원스포츠 비공개 접수 확인서\n접수번호: ${state.receipt?.receipt_no || state.receiptNumber}\n확인키: ${state.receiptKey}\n조회 주소: ${location.origin}/members/my\n\n확인키를 아는 사람은 접수내용을 조회할 수 있습니다. 다른 사람에게 공유하지 마세요.\n접수 완료는 결제 또는 이용권 반영 완료를 뜻하지 않습니다.\n`;
}
function revokePhotos() {
  state.objectURLs.forEach(url => URL.revokeObjectURL(url));
  state.objectURLs.clear();
}
function decodedPhoto(photo) {
  if (!photo || !['image/jpeg','image/png','image/webp'].includes(photo.mime) || typeof photo.base64 !== 'string' || photo.base64.length > 710000) throw new Error('사진 데이터를 확인할 수 없습니다.');
  const binary = atob(photo.base64);
  const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: photo.mime }));
  state.objectURLs.add(url);
  return url;
}
async function loadGuestPhotos() {
  const epoch = state.epoch;
  const number = state.receiptNumber;
  const key = state.receiptKey;
  await Promise.allSettled([...content.querySelectorAll('[data-guest-photo]')].map(async el => {
    try {
      const result = await guestService('photo', { receipt_no: number, receipt_key: key, photo_id: el.dataset.guestPhoto });
      if (epoch !== state.epoch || number !== state.receiptNumber || key !== state.receiptKey || !el.isConnected) return;
      const url = decodedPhoto(result.photo);
      const img = new Image(); img.alt = '비공개 첨부 사진'; img.src = url; img.loading = 'lazy';
      el.href = url; el.replaceChildren(img);
    } catch { if (el.isConnected && epoch === state.epoch) el.textContent = '사진을 불러오지 못했습니다. 처리상태를 새로고침해 주세요.'; }
  }));
}
function render() {
  if (!state.home) return;
  revokePhotos(); state.photoEpoch++;
  navigation();
  ({ home: renderHome, renew: renderRenew, requests: renderRequests, my: renderMy })[route()]();
  content.setAttribute('aria-busy','false'); connection(); loadPhotos();
  if (location.hash === '#memberBoard') document.getElementById('memberBoard')?.scrollIntoView({ block: 'start' });
}
async function loadView() {
  const epoch = ++state.epoch;
  content.setAttribute('aria-busy','true');
  try {
    const home = await service('public_home', {});
    if (epoch !== state.epoch) return;
    state.home = home; render();
  } catch (error) {
    if (epoch !== state.epoch) return;
    revokePhotos(); state.receipt = null;
    content.innerHTML = `${pageHeading('회원서비스 연결 확인')}${notice(error.message || '인터넷 연결과 센터 서비스 설정을 확인해 주세요.', 'error')}<button class="member-button" type="button" data-refresh>다시 시도</button>`;
    content.setAttribute('aria-busy','false');
  }
}

let signatureDrawn = false;
function initSignature() {
  signatureDrawn = false;
  const canvas = document.getElementById('memberSignature');
  if (!canvas) return;
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.round(canvas.clientWidth * ratio); canvas.height = Math.round(156 * ratio);
  const ctx = canvas.getContext('2d');
  ctx.scale(ratio,ratio); ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.strokeStyle = '#172b3a';
  let drawing = false;
  const point = event => { const box = canvas.getBoundingClientRect(); return [event.clientX-box.left,event.clientY-box.top]; };
  canvas.onpointerdown = event => { if (state.busy) return; drawing = true; canvas.closest('form')._signatureChanged = true; canvas.setPointerCapture(event.pointerId); ctx.beginPath(); ctx.moveTo(...point(event)); };
  canvas.onpointermove = event => { if (drawing) { ctx.lineTo(...point(event)); ctx.stroke(); signatureDrawn = true; } };
  canvas.onpointerup = canvas.onpointercancel = () => { drawing = false; };
}
function applicant(data) {
  return Object.fromEntries(['name','building','unit','phone'].map(key => [key,String(data.get(key) || '').trim()]));
}
async function ensureTicket(form, data, kind) {
  if (!collectionOpen(kind)) throw new Error('현재 접수 준비 중입니다. 관리자 설정 완료 후 다시 시도해 주세요.');
  if (form._ticket) return form._ticket;
  const ticket = await guestService('prepare', { kind, phone: String(data.get('phone') || '').trim(), consents: data.getAll('consents'), honeypot: String(data.get('website') || '') });
  if (!ticket.ticket_id || !ticket.receipt_no || !/^[a-f0-9]{64}$/i.test(ticket.receipt_key || '')) throw new Error('비공개 접수 확인정보를 받지 못했습니다. 아직 접수되지 않았습니다.');
  form._ticket = ticket;
  return ticket;
}
async function uploadGuestFile(file,ticket,purpose = 'photo',replaceId) {
  const encoded = await encodeGuestPhoto(file,purpose === 'signature');
  const result = await guestService('upload_photo', { ticket_id: ticket.ticket_id, receipt_key: ticket.receipt_key, ...encoded, purpose, replace_photo_id:replaceId });
  if (!result.photo?.id) throw new Error('사진 저장 결과를 확인하지 못했습니다.');
  return result.photo.id;
}
function accepted(result,ticket) {
  if (!result?.receipt?.receipt_no) throw new Error('접수 결과를 확인하지 못했습니다. 같은 화면에서 다시 시도해 주세요.');
  state.epoch++; revokePhotos();
  state.receipt = result.receipt; state.receiptNumber = result.receipt.receipt_no; state.receiptKey = ticket.receipt_key; state.receiptSaved = false;
  history.pushState({},'', '/members/my');
  render(); window.scrollTo({top:0,behavior:'instant'});
}
async function submitApplication(form,data) {
  const {kind,item} = selectedItem(form);
  if (!item) throw new Error('이용권 또는 GX 반을 선택해 주세요.');
  const wantsSignature = settings().signature_enabled && data.get('kind') === 'new';
  if (wantsSignature && !signatureDrawn) throw new Error('신규 신청자 서명을 입력해 주세요.');
  const epoch = state.epoch;
  const ticket = await ensureTicket(form,data,'application');
  if (wantsSignature && (!form._signaturePhoto || form._signatureChanged)) {
    const canvas = document.getElementById('memberSignature');
    const blob = await new Promise(resolve => canvas.toBlob(resolve,'image/png'));
    if (!blob) throw new Error('서명 이미지를 읽지 못했습니다.');
    form._signaturePhoto = await uploadGuestFile(new File([blob],'signature.png',{type:'image/png'}),ticket,'signature',form._signaturePhoto);
    form._signatureChanged = false;
  }
  if (epoch !== state.epoch || !form.isConnected) return;
  const formValues = {};
  rows(state.home.form?.fields).forEach(f => { const value = f.type === 'checkbox' ? data.has(`extra_${f.key}`) : (data.get(`extra_${f.key}`) || ''); if (value !== '' || f.required) formValues[f.key] = value; });
  const profile = applicant(data);
  const result = await guestService('submit_application', { ticket_id:ticket.ticket_id, receipt_key:ticket.receipt_key, profile, kind:data.get('kind'), ...(kind === 'gx' ? {gx_class_id:item.id} : {product_id:item.id}), expected_amount:item.price, expected_catalog_updated_at:item.updated_at, expected_form_id:state.home.form?.id, payment_method:data.get('payment_method'), payer_name:String(data.get('payer_name') || profile.name).trim(), desired_start_date:kind === 'gx' ? undefined : data.get('desired_start_date'), consents:data.getAll('consents'), form_values:formValues, signature_photo_id:wantsSignature ? form._signaturePhoto : undefined, student_name:data.get('student_name') || undefined, guardian_consent:data.has('guardian_consent') });
  if (epoch !== state.epoch || !form.isConnected) return;
  accepted(result,ticket);
}
async function submitRequest(form,data) {
  const files = [...form.elements.photos.files];
  const limit = Math.max(0,Math.min(3,Number(settings().photo_limit ?? 3)));
  if (files.length > limit) throw new Error(`사진은 최대 ${limit}장까지 첨부할 수 있습니다.`);
  for (const file of files) if (!['image/jpeg','image/png','image/webp'].includes(file.type) || !file.size || file.size>8*1024*1024) throw new Error('사진은 JPG·PNG·WebP 형식, 원본 장당 8MB 이하로 선택해 주세요.');
  const epoch = state.epoch;
  const ticket = await ensureTicket(form,data,'request');
  if (!form._photoSlots) form._photoSlots = [];
  for (let index=form._photosChanged ? 0 : form._photoSlots.length;index<files.length;index++) form._photoSlots[index] = await uploadGuestFile(files[index],ticket,'photo',form._photoSlots[index]);
  form._photoIds = form._photoSlots.slice(0,files.length); form._photosChanged = false;
  if (epoch !== state.epoch || !form.isConnected) return;
  const result = await guestService('submit_request', { ticket_id:ticket.ticket_id, receipt_key:ticket.receipt_key, profile:applicant(data), category_id:data.get('category_id'), title:String(data.get('title') || '').trim(), body:String(data.get('body') || '').trim(), location:String(data.get('location') || '').trim(), item_name:data.get('item_name') || undefined, quantity:data.get('quantity') ? Number(data.get('quantity')) : undefined, photo_ids:form._photoIds, consents:data.getAll('consents') });
  if (epoch !== state.epoch || !form.isConnected) return;
  accepted(result,ticket);
}
async function lookupReceipt(number,key) {
  const epoch = ++state.epoch;
  const previous = state.receipt;
  revokePhotos(); state.receipt = null;
  if (previous) content.innerHTML = empty('비공개 접수내용을 새로 확인하고 있습니다.');
  const result = await guestService('receipt', {receipt_no:number,receipt_key:key});
  if (epoch !== state.epoch) return;
  if (!result.receipt) throw new Error('접수번호와 확인키를 확인해 주세요.');
  state.receipt = result.receipt; state.receiptNumber = result.receipt.receipt_no || number; state.receiptKey = key; state.receiptSaved = true;
  render();
}
async function onSubmit(event) {
  const form = event.target.closest('form[data-form]');
  if (!form) return;
  event.preventDefault();
  if (state.busy) return;
  if (!navigator.onLine) { fail(form,new Error('인터넷 연결을 확인해 주세요. 아직 접수되지 않았습니다.')); return; }
  const data = new FormData(form);
  state.submittingPath = location.pathname;
  state.busy = true; connection();
  const button = form.querySelector('button[type="submit"]');
  const label = button?.textContent;
  const locks = [...form.querySelectorAll('fieldset')].map(el => ({el,disabled:el.disabled}));
  locks.forEach(({el}) => { el.disabled = true; });
  form.querySelector('[data-form-error]')?.setAttribute('hidden','');
  if (button) { button.disabled = true; button.textContent = '서버 확인 중…'; }
  try {
    if (form.dataset.form === 'application') await submitApplication(form,data);
    else if (form.dataset.form === 'request') await submitRequest(form,data);
    else if (form.dataset.form === 'receipt') await lookupReceipt(String(data.get('receipt_no') || '').trim(),String(data.get('receipt_key') || '').trim().toLowerCase());
    else if (form.dataset.form === 'payment-report') {
      const epoch = state.epoch;
      const result = await guestService('payment_report', {receipt_no:state.receiptNumber,receipt_key:state.receiptKey,payer_name:String(data.get('payer_name') || '').trim()});
      if (epoch === state.epoch) { state.receipt = result.receipt; render(); toast('입금 확인을 요청했습니다. 결제·이용권 완료 처리는 관리자가 진행합니다.'); }
    }
  } catch (error) { fail(form,error); }
  finally {
    state.busy = false;
    locks.forEach(({el,disabled}) => { if (el.isConnected) el.disabled = disabled; });
    if (button?.isConnected) button.textContent = label;
    connection();
  }
}

document.addEventListener('submit',onSubmit);
document.addEventListener('click',async event => {
  const link = event.target.closest('[data-member-route]');
  if (link && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) { event.preventDefault(); navigate(link.getAttribute('href')); return; }
  const target = event.target.closest('button');
  if (!target) return;
  if (target.hasAttribute('data-refresh')) { await loadView(); return; }
  if (target.hasAttribute('data-clear-signature')) {
    const canvas = document.getElementById('memberSignature');
    canvas?.getContext('2d').clearRect(0,0,canvas.width,canvas.height);
    signatureDrawn = false;
    if (canvas) canvas.closest('form')._signatureChanged = true;
    return;
  }
  if (target.hasAttribute('data-copy-bank')) {
    try { await navigator.clipboard.writeText(state.receipt?.settings?.bank_account || ''); toast('계좌번호를 복사했습니다.'); }
    catch { toast('복사할 수 없습니다. 표시된 계좌번호를 직접 확인해 주세요.'); }
    return;
  }
  if (target.hasAttribute('data-copy-receipt')) {
    try { await navigator.clipboard.writeText(receiptText()); state.receiptSaved = true; toast('접수번호와 비공개 확인키를 복사했습니다. 안전하게 보관해 주세요.'); }
    catch { toast('복사할 수 없습니다. 확인서 저장을 이용해 주세요.'); }
    return;
  }
  if (target.hasAttribute('data-download-receipt')) {
    const url = URL.createObjectURL(new Blob([receiptText()],{type:'text/plain;charset=utf-8'}));
    const link = document.createElement('a'); link.href = url; link.download = `원스포츠-접수확인-${state.receiptNumber.replace(/[^a-z0-9-]/gi,'')}.txt`;
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url),1000);
    state.receiptSaved = true; toast('확인서 저장을 요청했습니다. 파일을 안전하게 보관해 주세요.');
    return;
  }
  if (target.hasAttribute('data-end-receipt')) {
    state.epoch++; state.receipt = null; state.receiptKey = ''; state.receiptNumber = ''; state.receiptSaved = true; revokePhotos(); render();
    return;
  }
  if (target.hasAttribute('data-refresh-receipt')) {
    if (state.busy) return;
    state.busy = true; target.disabled = true;
    try { await lookupReceipt(state.receiptNumber,state.receiptKey); }
    catch (error) { renderMy(); toast(error.message || '접수내용을 새로 확인하지 못했습니다.'); }
    finally { state.busy = false; connection(); }
  }
});
document.addEventListener('change',event => {
  const form = event.target.closest('form');
  if (!form) return;
  if (['selection','desired_start_date'].includes(event.target.name)) selectionChanged(form);
  if (event.target.name === 'kind') {
    const section = document.getElementById('memberSignatureSection');
    if (section) { section.hidden = event.target.value !== 'new'; if (!section.hidden) initSignature(); }
  }
  if (event.target.name === 'payment_method') {
    const payer = document.getElementById('memberPayerField');
    payer.hidden = event.target.value !== 'transfer'; form.elements.payer_name.required = event.target.value === 'transfer';
    if (!form.elements.payer_name.value) form.elements.payer_name.value = form.elements.name.value;
  }
  if (event.target.name === 'category_id') {
    const name = rows(state.home.request_categories).find(v => v.id === event.target.value)?.name || '';
    document.getElementById('memberItemFields').hidden = !/물품/.test(name);
  }
  if (event.target.name === 'photos') {
    form._photosChanged = true;
    revokePhotos();
    const preview = document.getElementById('memberUploadPreview'); preview.replaceChildren();
    [...event.target.files].slice(0,3).forEach(file => {
      if (!['image/jpeg','image/png','image/webp'].includes(file.type) || file.size>8*1024*1024) return;
      const url = URL.createObjectURL(file); state.objectURLs.add(url);
      const img = new Image(); img.src = url; img.alt = '선택한 첨부 사진'; preview.append(img);
    });
  }
});
window.addEventListener('popstate',() => {
  if (state.busy) { history.pushState({},'',state.submittingPath || '/members/my'); toast('접수 결과를 확인 중입니다. 잠시만 기다려 주세요.'); return; }
  loadView();
});
window.addEventListener('beforeunload',event => {
  if (state.busy || (!state.receiptSaved && state.receiptKey)) { event.preventDefault(); event.returnValue = ''; }
});
window.addEventListener('online',() => { connection(); if (!state.busy) loadView(); });
window.addEventListener('offline',() => {
  connection();
  if (!state.busy && route() === 'my') {
    state.epoch++; state.receipt = null; revokePhotos();
    content.innerHTML = `${pageHeading('인터넷 연결이 필요합니다.')}${notice('비공개 접수내용은 연결 복구 후 다시 조회해 주세요. 확인키는 이 창이 열려 있는 동안만 기억합니다.', 'warning')}<button class="member-secondary" type="button" data-refresh>다시 확인</button>`;
  }
});
window.addEventListener('pageshow',event => { if (event.persisted) location.reload(); });
async function boot() { content.innerHTML = empty('센터 소식을 불러오고 있습니다.'); await loadView(); }
boot();
