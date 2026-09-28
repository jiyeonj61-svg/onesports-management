import { getClient, service, uploadPhoto, photoUrl, escapeHtml as e, todayKst } from './member-client.js';

const content = document.getElementById('memberContent');
const state = { home: null, mine: null, session: null, client: null, account: false, authMode: 'login', recovery: false, busy: false, epoch: 0, photoEpoch: 0 };
const money = value => `${Number(value || 0).toLocaleString('ko-KR')}원`;
const rows = value => Array.isArray(value) ? value : [];
const text = value => e(value == null ? '' : String(value));
const uuid = () => crypto.randomUUID();
const date = value => value ? text(String(value).slice(0, 10).replaceAll('-', '.')) : '미정';
const when = value => value ? text(new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value))) : '미정';
const verified = () => !!(state.mine?.profile?.active && state.mine.profile.approved && state.mine.profile.resident_verified);
const settings = () => ({ ...(state.home?.settings || {}), ...(state.mine?.settings || {}) });
const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${({ home: '<path d="m3 10 9-7 9 7v10H3Z"/><path d="M9 20v-7h6v7"/>', renew: '<path d="M20 7a9 9 0 1 0 1 8"/><path d="M20 2v6h-6"/><path d="M12 8v8m-4-4h8"/>', requests: '<path d="M20 15a3 3 0 0 1-3 3H8l-5 4V5a3 3 0 0 1 3-3h11a3 3 0 0 1 3 3Z"/><path d="M7 8h9M7 12h6"/>', my: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 2h6v4H9ZM9 11h6M9 15h6"/>', board: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 8h10M7 12h10M7 16h6"/>' })[name] || ''}</svg>`;
const pageHeading = (title, subtitle = '') => `<a class="member-back" href="/members" data-member-route>‹ 회원 홈</a><h1>${text(title)}</h1>${subtitle ? `<p class="member-muted">${text(subtitle)}</p>` : ''}`;
const notice = (value, type = '') => `<div class="member-notice ${type}">${text(value)}</div>`;
const empty = value => `<div class="member-empty">${text(value)}</div>`;
const field = (label, name, value = '', extra = '') => `<label class="member-field">${text(label)}<input name="${text(name)}" value="${text(value)}" ${extra} /></label>`;
const errorSlot = '<div class="member-error" data-form-error role="alert" hidden></div>';
const statusLabels = {
  new: '새 신청', pending: '처리 대기', needs_review: '확인 필요', completed: '처리 완료', cancelled: '취소', refund_required: '환불 확인 필요',
  awaiting: '결제 확인 대기', reported: '입금 확인 요청', confirmed: '결제 확인 완료', applied: '이용권 반영 완료', revoked: '이용권 사용 중지',
  reserved: '자리 임시 확보', waitlisted: '대기접수', expired: '자리 배정 재확인', received: '접수 완료', reviewing: '확인 중', in_progress: '조치 중', needs_info: '추가 확인 필요', held: '보류', declined: '반영 어려움', active: '이용권 등록', suspended: '이용 연기 중', done: '외부 출입 반영 완료',
};
const badge = (value, fallback = '') => `<span class="member-badge ${['completed', 'applied', 'confirmed', 'done', 'active'].includes(value) ? '' : ['cancelled', 'refund_required', 'revoked', 'declined'].includes(value) ? 'danger' : 'waiting'}">${text(statusLabels[value] || fallback || value)}</span>`;

function route() {
  const path = location.pathname.replace(/\/$/, '').replace(/\.html$/, '');
  return path.endsWith('/renew') ? 'renew' : path.endsWith('/requests') ? 'requests' : path.endsWith('/my') ? 'my' : 'home';
}
function navigate(path) {
  state.account = false;
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
  const entries = [['home', '홈', '/members', true], ['renew', '빠른 연장', '/members/renew', s.menu_renew !== false], ['requests', '건의·요청', '/members/requests', s.menu_requests !== false], ['my', '내 신청', '/members/my', s.menu_my !== false]];
  document.getElementById('memberNav').innerHTML = entries.filter(v => v[3]).map(([id, label, href]) => `<a href="${href}" data-member-route class="${active === id && !state.account ? 'active' : ''}" ${active === id ? 'aria-current="page"' : ''}>${icon(id)}<span>${label}</span></a>`).join('');
  document.getElementById('memberAccount').textContent = state.session ? '내 계정' : '로그인';
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
  const menus = [['renew', '빠른 연장', '/members/renew', s.menu_renew], ['requests', '건의·요청하기', '/members/requests', s.menu_requests], ['my', '내 신청내역', '/members/my', s.menu_my], ['board', '공지·조치사항', '/members#memberBoard', s.menu_board]];
  content.innerHTML = `<section class="member-hero"><p class="member-eyebrow">${text(s.center_name || 'ONE SPORTS FITNESS')}</p><h1>${text(s.main_title || '회원분들께 보고드립니다.')}</h1><p>${text(s.subtitle || '회원님의 의견과 센터의 운영 소식을 전합니다.')}</p></section><nav class="member-menu-grid" aria-label="바로가기">${menus.filter(v => v[3] !== false).map(([id, label, href]) => `<a class="member-menu" href="${href}" data-member-route>${icon(id)}<span>${label} <span aria-hidden="true">›</span></span></a>`).join('')}</nav>${s.intro ? notice(s.intro) : ''}${s.menu_board === false ? '' : `<section id="memberBoard">${posts.filter(v => v.pinned).length ? `<section class="member-section"><h2>상단 고정 공지</h2>${posts.filter(v => v.pinned).map(postCard).join('')}</section>` : ''}${rows(state.home.categories).map(cat => `<section class="member-section"><div class="member-section-heading"><h2>${text(cat.name === '조치사항' ? '최근 조치사항' : cat.name)}</h2></div>${posts.filter(v => v.category_id === cat.id && !v.pinned).map(postCard).join('') || empty('등록된 소식이 없습니다.')}</section>`).join('') || empty('게시된 소식이 없습니다. 새로운 센터 소식을 이곳에서 확인해 주세요.')}</section>`}`;
}
function signupPrivacyTerms() {
  return rows(state.home?.terms).filter(term => term.kind === 'privacy' && term.approved === true && term.active === true);
}
function signupAvailable() {
  const s = state.home?.settings || {};
  return (s.applications_enabled === true || s.requests_enabled === true) && signupPrivacyTerms().length > 0;
}
function renderAuth() {
  const signup = state.authMode === 'signup';
  const recovery = state.recovery;
  const heading = pageHeading(recovery ? '새 비밀번호 설정' : signup ? '회원서비스 계정 만들기' : '회원 계정으로 로그인', '본인에게 연결된 이용권과 신청내역만 확인할 수 있습니다.');
  const tabs = !recovery ? `<div class="member-tabs"><button type="button" data-auth-mode="login" class="${signup ? '' : 'active'}">로그인</button><button type="button" data-auth-mode="signup" class="${signup ? 'active' : ''}">계정 만들기</button></div>` : '';
  if (signup && !recovery && !signupAvailable()) {
    content.innerHTML = `${heading}<section class="member-card">${tabs}${notice('신규 계정 생성은 개인정보 처리 안내를 관리자가 승인하고 회원 접수를 시작한 뒤 이용할 수 있습니다. 지금은 신규 이메일·비밀번호를 입력받지 않습니다.', 'warning')}<button class="member-secondary member-full" type="button" data-auth-mode="login">기존 계정으로 로그인</button></section>`;
    return;
  }
  const privacy = signup ? signupPrivacyTerms().map(term => `<div class="member-term"><label class="member-check"><input type="checkbox" name="signup_consents" value="${text(term.id)}" required /><span>${text(term.title)} 확인·동의 (필수)</span></label><details><summary>개인정보 처리 안내 · 버전 ${text(term.version)}</summary><div class="member-pre">${text(term.body)}</div></details></div>`).join('') : '';
  content.innerHTML = `${heading}<section class="member-card">${tabs}<form class="member-form" data-form="${recovery ? 'password-update' : signup ? 'signup' : 'login'}">${!recovery ? field('이메일', 'email', '', 'type="email" autocomplete="email" required maxlength="254"') : ''}${field(recovery ? '새 비밀번호' : '비밀번호', 'password', '', `type="password" autocomplete="${signup || recovery ? 'new-password' : 'current-password'}" required minlength="${signup || recovery ? 10 : 1}" maxlength="128"`)}${signup || recovery ? field('비밀번호 확인', 'password_confirm', '', 'type="password" autocomplete="new-password" required minlength="10" maxlength="128"') : ''}${signup ? notice('이메일 주소와 비밀번호로 계정을 만듭니다. 기존 회원은 현장 확인 후 받은 1회용 초대코드로 회원정보를 연결하고, 신규 회원은 관리자의 입주민 확인을 거쳐 이용권이 등록됩니다.') : ''}${privacy}${errorSlot}<button class="member-button member-full" data-requires-network type="submit">${recovery ? '비밀번호 변경' : signup ? '계정 만들기' : '로그인'}</button>${!signup && !recovery ? '<button class="member-text-button" type="button" data-reset-password>비밀번호를 잊으셨나요?</button>' : ''}</form></section>${notice('계정 생성·로그인만으로 이메일 주소의 소유, 휴대폰 또는 입주민 확인이 완료되지는 않습니다. 회원 확인은 관리자가 현장에서 별도로 진행합니다.')}`;
}
function renderAccount() {
  if (!state.session) { renderAuth(); return; }
  const p = state.mine?.profile;
  content.innerHTML = `${pageHeading('내 계정')}<section class="member-card"><h2>${p ? `${text(p.name)} 님` : '계정 연결'}</h2><p class="member-muted">${text(state.session.user.email)}</p>${p ? `<dl class="member-definition"><dt>동·호수</dt><dd>${text(p.building)}동 ${text(p.unit)}호</dd><dt>연락처</dt><dd>${text(p.phone)}</dd><dt>회원 상태</dt><dd>${verified() ? '입주민 확인 · 승인 완료' : p.active === false ? '이용 제한 · 센터 문의' : '관리자 입주민 확인 대기'}</dd><dt>휴대폰 확인</dt><dd>${p.phone_verified ? '별도 확인 완료' : '미확인'}</dd></dl>` : notice('기존 회원은 아래 초대코드를 입력해 주세요. 신규 회원은 신규 이용 신청을 진행할 수 있습니다.')}<div class="member-actions"><a class="member-button" href="/members/renew" data-member-route>${p ? '빠른 연장' : '신규 이용 신청'}</a><button class="member-secondary" type="button" data-signout>로그아웃</button></div></section>${!p ? inviteForm() : profileChangeForm(p)}`;
}
function inviteForm() {
  return `<section class="member-card"><h2>기존 회원정보 연결</h2><p class="member-muted">현장 확인 후 안내데스크에서 받은 1회용 초대코드를 입력해 주세요. 만료되었거나 이미 사용한 코드는 다시 발급받아야 합니다.</p><form class="member-form" data-form="invite"><label class="member-field">초대코드<input name="code" autocomplete="off" spellcheck="false" autocapitalize="none" required minlength="64" maxlength="64" pattern="[a-fA-F0-9]{64}" /></label>${errorSlot}<button class="member-button" type="submit" data-requires-network>내 회원정보 연결</button></form></section>`;
}
function profileChangeForm(p) {
  return `<details class="member-card"><summary>회원정보 변경 요청</summary><p class="member-muted">관리자 확인 후 반영됩니다. 기존 정보가 즉시 변경되지는 않습니다.</p><form class="member-form" data-form="profile-change">${profileFields(p)}${errorSlot}<button class="member-button" type="submit" data-requires-network>변경 확인 요청</button></form>${rows(state.mine.profile_changes).length ? `<p class="member-muted">최근 요청: ${text(state.mine.profile_changes[0].status || '관리자 확인 대기')}</p>` : ''}</details>`;
}
function profileFields(p = {}) {
  return `${field('이름', 'name', p.name, 'required maxlength="60" autocomplete="name"')}<div class="member-two-columns">${field('동', 'building', p.building, 'required maxlength="20"')}${field('호수', 'unit', p.unit, 'required maxlength="20"')}</div>${field('휴대폰 번호', 'phone', p.phone, 'type="tel" autocomplete="tel" required maxlength="24" inputmode="tel"')}`;
}
function passCards() {
  return rows(state.mine?.passes).filter(p => p.status !== 'revoked').map(p => `<article class="member-card"><div class="member-meta">${badge(p.status)}</div><h3>${text(p.product_name)}</h3><dl class="member-definition"><dt>이용기간</dt><dd>${date(p.start_date)} ~ ${date(p.end_date)}</dd></dl></article>`).join('') || empty('등록된 이용권이 없습니다. 승인된 이용권이 이곳에 표시됩니다.');
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
function termsMarkup() {
  return rows(state.home.terms).filter(t => t.kind !== 'guardian').map(t => `<div class="member-term"><label class="member-check"><input type="checkbox" name="consents" value="${text(t.id)}" ${t.required ? 'required' : ''} /><span>${text(t.title)} ${t.required ? '(필수)' : '(선택)'}</span></label><details><summary>내용 보기 · 버전 ${text(t.version)}</summary><div class="member-pre">${text(t.body)}</div></details></div>`).join('');
}
function renderRenew() {
  if (!state.session) { renderAuth(); return; }
  const s = settings();
  const p = state.mine?.profile;
  const newMember = !p;
  if (p && !verified()) {
    content.innerHTML = `${pageHeading('빠른 연장·재등록')}${notice('관리자의 입주민·회원 확인이 필요합니다. 이미 접수한 신청은 내 신청내역에서 확인할 수 있습니다.', 'warning')}<div class="member-actions"><a class="member-button" href="/members/my" data-member-route>내 신청내역</a><button class="member-secondary" type="button" data-account>내 계정</button></div>`;
    return;
  }
  if (!s.applications_enabled || s.menu_renew === false) {
    content.innerHTML = `${pageHeading('빠른 연장·재등록')}${notice('현재 온라인 이용 신청을 준비하거나 점검하고 있습니다. 요금·운영규정 등 관리자 설정이 완료된 뒤 신청할 수 있습니다.', 'warning')}${!newMember ? `<h2>내 이용권</h2>${passCards()}` : ''}`;
    return;
  }
  const products = rows(state.home.products);
  const classes = rows(state.home.gx_classes).filter(v => v.status === 'open' && new Date(v.registration_start) <= new Date() && new Date(v.registration_end) >= new Date());
  const transferAvailable = s.transfer_available === true || !!(s.bank_name && s.bank_account && s.bank_holder);
  content.innerHTML = `${pageHeading(newMember ? '신규 이용 신청' : '빠른 연장·재등록', '금액과 예정 기간을 확인하고 신청해 주세요. 결제 확인 후 이용권이 등록됩니다.')}${newMember ? `<details class="member-card"><summary>이미 등록된 회원이신가요?</summary>${inviteForm()}</details>` : `<section class="member-section"><h2>내 이용권</h2>${passCards()}</section>`}<form class="member-form" data-form="application" data-key="${uuid()}" data-kind="${newMember ? 'new' : 'renewal'}">${newMember ? `<section class="member-form-section"><h2>1. 신청자 정보</h2>${notice('입주민 확인 전에는 이용권이 등록되지 않습니다. 보호자 계정으로 어린이 반을 신청하는 경우 아래에는 보호자 정보를 입력해 주세요.')}<div class="member-form">${profileFields()}</div></section>` : `<section class="member-form-section"><h2>1. 회원 확인</h2><p>${text(p.name)} · ${text(p.building)}동 ${text(p.unit)}호</p><p class="member-muted">${text(p.phone)}</p><button class="member-text-button" data-account type="button">정보 변경은 관리자 확인 요청</button></section>`}<section class="member-form-section"><h2>2. 이용권 선택</h2><div class="member-form"><label class="member-field">이용권 또는 GX 반<select name="selection" required><option value="">선택해 주세요</option>${products.length ? `<optgroup label="헬스·골프 이용권">${products.map(v => `<option value="product:${text(v.id)}">${text(v.name)} · ${text(v.duration_days)}일 · ${money(v.price)}</option>`).join('')}</optgroup>` : ''}${classes.length ? `<optgroup label="GX 프로그램">${classes.map(v => `<option value="gx:${text(v.id)}">${text(v.name)} ${text(v.class_name)} · ${text(v.start_time?.slice(0, 5))} · ${money(v.price)}</option>`).join('')}</optgroup>` : ''}</select></label>${!products.length && !classes.length ? notice('현재 접수 가능한 상품·GX 반이 없습니다. 관리자 확인 후 활성화된 상품만 표시됩니다.', 'warning') : ''}<div id="memberSelectionDetail"></div><label class="member-field" id="memberDesiredDate">희망 시작일<input name="desired_start_date" type="date" value="${todayKst()}" min="${todayKst()}" required /><small>이용기간이 남아 있으면 마지막 이용권 종료일 다음 날부터 이어집니다. 관리자 확인이 늦어지면 확인 시점을 반영하여 기간을 확정합니다.</small></label><div id="memberPeriodPreview"></div><div id="memberGuardianFields"></div></div></section><section class="member-form-section"><h2>3. 결제방식</h2><div class="member-form"><label class="member-check"><input type="radio" name="payment_method" value="card" checked required /><span>현장 카드결제<small>센터 방문 후 기존 카드단말기로 결제합니다.</small></span></label><label class="member-check"><input type="radio" name="payment_method" value="transfer" ${transferAvailable ? '' : 'disabled'} /><span>계좌이체<small>${transferAvailable ? '자리 배정된 신청을 접수한 뒤 입금계좌를 안내합니다.' : '입금계좌 설정이 필요하여 현재 이용할 수 없습니다.'}</small></span></label><label class="member-field" id="memberPayerField" hidden>입금자명<input name="payer_name" value="${text(p?.name || '')}" maxlength="60" /></label>${notice('온라인 카드결제는 진행하지 않습니다. 신청 접수만으로 결제 완료나 이용기간 연장이 되지 않습니다.')}</div></section><section class="member-form-section"><h2>4. 안내 확인·동의</h2><div class="member-form">${customFields()}${termsMarkup()}${s.signature_enabled && newMember ? `<label class="member-field">신청자 서명<small>아래 칸에 손가락이나 마우스로 서명해 주세요. 서명은 비공개 신청기록에 저장됩니다.</small><canvas id="memberSignature" class="member-signature" aria-label="신청자 서명란"></canvas></label><button class="member-secondary" data-clear-signature type="button">서명 지우기</button>` : ''}<label class="member-check"><input type="checkbox" name="confirm_application" required /><span>선택한 상품·금액·기간과 신청내용을 확인했습니다. 최종 이용기간은 관리자 결제 확인 후 확정됨을 이해했습니다.</span></label></div></section>${errorSlot}<button class="member-button member-full" data-requires-network type="submit" ${products.length || classes.length ? '' : 'disabled data-unavailable="true"'}>신청 접수하기</button><p class="member-muted">빠른 연장은 유료 재등록입니다. 이용을 잠시 중단하는 이용 연기는 안내데스크로 문의해 주세요.</p></form>`;
  initSignature();
}
function selectedItem(form) {
  const [kind, id] = (form.elements.selection.value || '').split(':');
  const item = rows(kind === 'gx' ? state.home.gx_classes : state.home.products).find(v => v.id === id);
  return { kind, item };
}
function addDays(value, days) { const d = new Date(`${value}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); }
function selectionChanged(form) {
  const { kind, item } = selectedItem(form);
  const detail = document.getElementById('memberSelectionDetail');
  const desired = document.getElementById('memberDesiredDate');
  const guardian = document.getElementById('memberGuardianFields');
  const preview = document.getElementById('memberPeriodPreview');
  if (!item) { detail.innerHTML = ''; guardian.innerHTML = ''; preview.innerHTML = ''; return; }
  const gx = kind === 'gx';
  desired.hidden = gx; form.elements.desired_start_date.required = !gx; form.elements.desired_start_date.disabled = gx;
  detail.innerHTML = `<div class="member-price-box"><div class="member-price">${money(item.price)}</div><dl class="member-definition"><dt>상품</dt><dd>${text(item.name)} ${text(item.class_name || '')}</dd>${gx ? `<dt>수강기간</dt><dd>${date(item.period_start)} ~ ${date(item.period_end)}</dd><dt>요일·시간</dt><dd>${rows(item.weekdays).map(v => ['','월','화','수','목','금','토','일'][v] || '').join('·')} ${text(item.start_time?.slice(0, 5))}</dd><dt>정원·남은 자리</dt><dd>${text(item.capacity)}명 · ${text(item.remaining_seats ?? '확인 중')}자리</dd><dt>접수기간</dt><dd>${when(item.registration_start)} ~ ${when(item.registration_end)}</dd>${item.priority_start ? `<dt>기존 수강생 우선접수</dt><dd>${when(item.priority_start)} ~ ${when(item.priority_end)}</dd>` : ''}<dt>결제기한</dt><dd>자리 확보 후 ${text(item.payment_due_hours)}시간</dd>` : `<dt>이용기간</dt><dd>${text(item.duration_days)}일 · 시작일 포함</dd>`}</dl></div>${gx ? notice('남은 자리는 조회 시점 기준입니다. 최종 자리 배정은 신청 순간에 확정됩니다.') + notice(item.waitlist_enabled ? '신청 시 남은 자리를 확인합니다. 정원이 차면 대기접수로 저장되며, 자리 배정 전에는 입금하지 마세요.' : '신청 시 남은 자리를 확인합니다. 정원이 찬 경우 접수할 수 없습니다.') : ''}`;
  guardian.innerHTML = gx && item.is_child ? `<div class="member-form">${field('어린이 수강생 이름', 'student_name', '', 'required maxlength="60"')}<p class="member-muted">현재 로그인한 회원이 보호자입니다. 수강생과 보호자 정보를 구분하여 접수합니다.</p><div class="member-pre member-notice">${text(item.guardian_terms || '보호자 안내를 확인해 주세요.')}</div><label class="member-check"><input name="guardian_consent" type="checkbox" required /><span>보호자로서 어린이 수강 신청과 위 안내에 동의합니다.</span></label>${rows(state.home.terms).filter(t => t.kind === 'guardian').map(t => `<div class="member-term"><label class="member-check"><input name="consents" type="checkbox" value="${text(t.id)}" ${t.required ? 'required' : ''} /><span>${text(t.title)}${t.required ? ' (필수)' : ''}</span></label><details><summary>내용 보기</summary><div class="member-pre">${text(t.body)}</div></details></div>`).join('')}</div>` : '';
  if (gx) { preview.innerHTML = ''; return; }
  let start = form.elements.desired_start_date.value || todayKst();
  const activePasses = rows(state.mine?.passes).filter(v => v.facility === item.facility && v.status === 'active' && v.end_date >= todayKst());
  for (const pass of activePasses) { const next = addDays(pass.end_date, 1); if (next > start) start = next; }
  const end = addDays(start, Number(item.duration_days) - 1);
  const exceptions = rows(state.mine?.passes).some(v => v.status === 'suspended' || (v.status === 'active' && v.facility !== item.facility && !v.gx_class_id && v.end_date >= todayKst()));
  preview.innerHTML = `<div class="member-notice ${exceptions ? 'warning' : ''}"><strong>예정 이용기간 ${date(start)} ~ ${date(end)}</strong><p>현재 정보로 계산한 예상 기간입니다. 승인 시 최신 이용권과 확인 날짜를 기준으로 최종 확정됩니다.${exceptions ? ' 이용 연기 또는 권종 변경 내역이 있어 관리자 확인이 필요합니다.' : ''}</p></div>`;
}
function renderRequests() {
  if (!state.session) { renderAuth(); return; }
  if (!verified()) { content.innerHTML = `${pageHeading('건의·요청하기')}${notice('확인된 회원만 요청을 접수할 수 있습니다. 기존 회원은 초대코드 연결을 완료하고, 신규 회원은 관리자 확인을 기다려 주세요.', 'warning')}<button class="member-button" data-account type="button">회원 확인·계정 연결</button>`; return; }
  const s = settings();
  if (!s.requests_enabled || s.menu_requests === false) { content.innerHTML = `${pageHeading('건의·요청하기')}${notice('현재 온라인 건의 접수를 준비하거나 점검하고 있습니다. 센터로 문의해 주세요.', 'warning')}`; return; }
  const categories = rows(state.home.request_categories);
  content.innerHTML = `${pageHeading('건의·요청하기', '회원님의 의견을 확인하고 내 요청내역으로 답변드립니다.')}${notice(s.request_guide || '다른 사람의 이름·연락처·얼굴이 포함되지 않도록 작성해 주세요. 요청 내용과 사진은 본인과 권한 있는 관리자만 볼 수 있습니다.')}<section class="member-card"><p class="member-muted">신청자: ${text(state.mine.profile.name)} · ${text(state.mine.profile.building)}동 ${text(state.mine.profile.unit)}호</p><form class="member-form" data-form="request" data-key="${uuid()}"><label class="member-field">분류<select name="category_id" required><option value="">선택해 주세요</option>${categories.map(v => `<option value="${text(v.id)}">${text(v.name)}</option>`).join('')}</select></label>${field('제목', 'title', '', 'required maxlength="150"')}<label class="member-field">내용<textarea name="body" required maxlength="10000" placeholder="어떤 점이 불편한지, 무엇이 필요한지 적어 주세요."></textarea></label>${field('관련 시설 또는 위치 (선택)', 'location', '', 'maxlength="120"')}<div class="member-two-columns" id="memberItemFields" hidden>${field('필요한 물품 (선택)', 'item_name', '', 'maxlength="120"')}${field('수량 (선택)', 'quantity', '', 'type="number" min="1" max="10000" step="1" inputmode="numeric"')}</div><label class="member-field">사진 첨부 (선택)<input type="file" name="photos" accept="image/jpeg,image/png,image/webp" multiple /><small>최대 ${text(Number(s.photo_limit ?? 3))}장, 장당 8MB · JPG·PNG·WebP. 얼굴과 개인정보가 보이지 않는 사진을 선택해 주세요.</small></label><div id="memberUploadPreview" class="member-upload-preview"></div>${privacyInfo()}${errorSlot}<button class="member-button" data-requires-network type="submit" ${categories.length ? '' : 'disabled data-unavailable="true"'}>요청 접수하기</button></form></section>`;
}
function privacyInfo() {
  const s = settings();
  return `<details class="member-term"><summary>개인정보 처리 안내</summary><div class="member-pre">수집 목적: ${text(s.privacy_purpose)}\n수집 항목: ${text(s.privacy_items)}\n보유기간: ${text(s.privacy_retention)}</div></details>`;
}
function applicationCard(app) {
  const isWait = app.reservation_status === 'waitlisted';
  const isCancelled = ['cancelled', 'refund_required'].includes(app.application_status);
  const payable = !isWait && !isCancelled && !['expired','cancelled'].includes(app.reservation_status) && ['awaiting', 'reported'].includes(app.payment_status);
  const s = settings();
  const snapshot = app.product_snapshot || {};
  return `<article class="member-card" id="application-${text(app.id)}"><p class="member-number">신청번호 ${text(app.application_no)}</p><h3>${text(snapshot.name || snapshot.product_name || '이용 신청')} ${text(snapshot.class_name || '')}</h3><div class="member-status-row">${badge(app.application_status)}${badge(app.payment_status)}${app.pass_status === 'applied' ? badge('applied') : ''}${app.reservation_status !== 'none' ? badge(app.reservation_status, app.reservation_status === 'confirmed' ? '수강 확정' : '') : ''}</div><dl class="member-definition"><dt>신청 구분</dt><dd>${app.kind === 'new' ? '신규' : '재등록'}</dd><dt>신청금액</dt><dd><strong>${money(app.amount)}</strong></dd><dt>결제방식</dt><dd>${app.payment_method === 'transfer' ? '계좌이체' : '현장 카드결제'}</dd><dt>접수일시</dt><dd>${when(app.created_at)}</dd>${app.student_name ? `<dt>어린이 수강생</dt><dd>${text(app.student_name)}</dd>` : ''}<dt>${app.final_start_date ? '최종 이용기간' : '예정 이용기간'}</dt><dd>${date(app.final_start_date || app.proposed_start_date)} ~ ${date(app.final_end_date || app.proposed_end_date)}</dd>${app.reservation_expires_at && app.reservation_status === 'reserved' ? `<dt>입금·결제기한</dt><dd>${when(app.reservation_expires_at)}</dd>` : ''}${app.pass_status === 'applied' ? `<dt>외부 출입프로그램</dt><dd>${app.external_status === 'done' ? '관리자 반영 완료' : '관리자 별도 반영 대기'}</dd>` : ''}</dl>${isWait ? notice('현재 대기접수 상태입니다. 자리 배정 전에는 입금하지 마세요. 배정 상태는 내 신청내역에서 확인할 수 있습니다.', 'warning') : ''}${app.application_status === 'needs_review' ? notice('관리자가 신청 또는 결제 내용을 확인 중입니다. 센터의 안내를 확인해 주세요.', 'warning') : ''}${app.payment_status === 'reported' ? notice('입금 확인을 요청했습니다. 실제 입금 확인과 이용권 반영은 관리자가 처리합니다.') : ''}${app.application_status === 'refund_required' ? notice('환불 확인이 필요한 신청입니다. 실제 카드 취소·계좌 반환은 센터에 문의해 주세요.', 'warning') : ''}${payable && app.payment_method === 'card' ? notice(s.card_guide || '사전 신청이 완료되었습니다. 안내데스크에서 회원 이름 또는 신청번호를 말씀해 주세요. 카드결제 확인 후 재등록이 완료됩니다.') : ''}${payable && app.payment_method === 'transfer' ? s.bank_name && s.bank_account && s.bank_holder ? `<div class="member-bank"><p>${text(s.bank_name)} · 예금주 ${text(s.bank_holder)}</p><strong>${text(s.bank_account)}</strong><p>입금금액 <b>${money(app.amount)}</b></p><button class="member-secondary" type="button" data-copy-bank>계좌번호 복사</button>${s.transfer_guide ? `<p class="member-muted member-pre">${text(s.transfer_guide)}</p>` : ''}<form class="member-form" data-form="payment-report" data-id="${text(app.id)}">${field('입금자명', 'payer_name', app.payer_name || '', 'required maxlength="60"')}${errorSlot}<button class="member-button" type="submit" data-requires-network>${app.payment_status === 'reported' ? '입금자명 수정·확인 재요청' : '입금했어요 — 확인 요청'}</button></form><p class="member-muted">관리자 확인 후 재등록이 완료됩니다.</p></div>` : notice('입금계좌 설정을 확인 중입니다. 임의로 입금하지 말고 센터로 문의해 주세요.', 'warning') : ''}<details class="member-term"><summary>신청 당시 안내·동의 기록</summary>${rows(app.consents_snapshot).map(t => `<h4>${text(t.title)} · ${text(t.version)}</h4><div class="member-pre">${text(t.body)}</div>`).join('') || '<p class="member-muted">저장된 규정 기록을 확인 중입니다.</p>'}<p class="member-muted">동의·신청 시각 ${when(app.created_at)}</p></details></article>`;
}
function requestCard(req) {
  const category = rows(state.home.request_categories).find(v => v.id === req.category_id)?.name || '건의·요청';
  return `<article class="member-card"><p class="member-number">접수번호 ${text(req.request_no)}</p><div class="member-meta">${badge(req.status)}<span>${text(category)}</span><span>${when(req.created_at)}</span></div><h3>${text(req.title)}</h3><div class="member-pre">${text(req.body)}</div>${req.location ? `<p class="member-muted">위치: ${text(req.location)}</p>` : ''}${req.item_name ? `<p class="member-muted">물품: ${text(req.item_name)} ${req.quantity ? `· ${text(req.quantity)}개` : ''}</p>` : ''}${photos(req.photos)}${req.reply ? `<div class="member-reply"><strong>센터 답변</strong><div class="member-pre">${text(req.reply)}</div>${photos(req.action_photos, '조치 사진')}</div>` : '<p class="member-muted">센터에서 확인 후 이곳에 답변을 남깁니다.</p>'}</article>`;
}
function renderMy() {
  if (!state.session) { renderAuth(); return; }
  const p = state.mine?.profile;
  content.innerHTML = `${pageHeading('내 신청·요청내역', '접수 상태와 결제 확인, 최종 처리 결과를 확인해 주세요.')}<div class="member-actions"><button class="member-secondary" type="button" data-refresh>새로고침</button><button class="member-text-button" type="button" data-account>회원정보·계정</button></div>${!p ? `${notice('아직 연결된 회원정보가 없습니다. 기존 회원은 초대코드로 연결하고, 신규 회원은 이용 신청을 진행해 주세요.')}${inviteForm()}` : !verified() ? notice('관리자의 입주민·회원 확인을 기다리고 있습니다.', 'warning') : ''}<section class="member-section"><h2>내 이용권</h2>${passCards()}</section><section class="member-section"><h2>이용 신청내역</h2>${rows(state.mine?.applications).map(applicationCard).join('') || empty('접수한 이용 신청이 없습니다.')}</section><section class="member-section"><h2>내 건의·요청</h2>${rows(state.mine?.requests).map(requestCard).join('') || empty('접수한 건의·요청이 없습니다.')}</section>`;
}
function render() {
  if (!state.home) return;
  state.photoEpoch++;
  navigation();
  if (state.recovery) renderAuth();
  else if (state.account) renderAccount();
  else ({ home: renderHome, renew: renderRenew, requests: renderRequests, my: renderMy })[route()]();
  content.setAttribute('aria-busy', 'false');
  connection();
  loadPhotos();
  if (location.hash === '#memberBoard') document.getElementById('memberBoard')?.scrollIntoView({ block: 'start' });
}
async function refreshMine() {
  const uid = state.session?.user.id;
  const epoch = state.epoch;
  if (!uid) { state.mine = null; return; }
  const result = await service('my', {});
  if (state.session?.user.id === uid && state.epoch === epoch && navigator.onLine) state.mine = result;
}
async function loadView() {
  const epoch = ++state.epoch;
  content.setAttribute('aria-busy', 'true');
  try {
    const [home] = await Promise.all([service('public_home', {}), route() !== 'home' || state.account ? refreshMine() : Promise.resolve()]);
    if (epoch !== state.epoch) return;
    state.home = home;
    render();
  } catch (error) {
    if (epoch !== state.epoch) return;
    state.mine = null;
    content.innerHTML = `${pageHeading('정보를 불러오지 못했습니다.')}${notice(error.message || '인터넷 연결과 로그인 상태를 확인해 주세요.', 'error')}<button class="member-button" type="button" data-refresh>다시 시도</button>`;
    content.setAttribute('aria-busy', 'false');
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
  ctx.scale(ratio, ratio); ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.strokeStyle = '#172b3a';
  let drawing = false;
  const point = event => { const box = canvas.getBoundingClientRect(); return [event.clientX - box.left, event.clientY - box.top]; };
  canvas.addEventListener('pointerdown', event => { drawing = true; canvas.closest('form')?.removeAttribute('data-signature-path'); canvas.setPointerCapture(event.pointerId); ctx.beginPath(); ctx.moveTo(...point(event)); });
  canvas.addEventListener('pointermove', event => { if (!drawing) return; ctx.lineTo(...point(event)); ctx.stroke(); signatureDrawn = true; });
  canvas.addEventListener('pointerup', () => { drawing = false; });
  canvas.addEventListener('pointercancel', () => { drawing = false; });
}
async function submitApplication(form, data) {
  const owner = state.session?.user.id;
  const epoch = state.epoch;
  const { kind, item } = selectedItem(form);
  if (!item) throw new Error('이용권 또는 GX 반을 선택해 주세요.');
  let signaturePath;
  const canvas = document.getElementById('memberSignature');
  if (canvas) {
    if (!signatureDrawn) throw new Error('신청자 서명을 입력해 주세요.');
    if (!form.dataset.signaturePath) {
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error('서명 이미지를 저장하지 못했습니다.');
      form.dataset.signaturePath = await uploadPhoto(new File([blob], 'signature.png', { type: 'image/png' }), { kind: 'applications' });
    }
    signaturePath = form.dataset.signaturePath;
  }
  const formValues = {};
  rows(state.home.form?.fields).forEach(f => {
    const value = f.type === 'checkbox' ? data.has(`extra_${f.key}`) : (data.get(`extra_${f.key}`) || '');
    if (value !== '' || f.required) formValues[f.key] = value;
  });
  const profile = form.dataset.kind === 'new' ? Object.fromEntries(['name','building','unit','phone'].map(key => [key, String(data.get(key) || '').trim()])) : undefined;
  if (state.session?.user.id !== owner || state.epoch !== epoch || !navigator.onLine) return;
  const result = await service('application_submit', { idempotency_key: form.dataset.key, kind: form.dataset.kind, ...(kind === 'gx' ? { gx_class_id: item.id } : { product_id: item.id }), expected_amount: item.price, expected_catalog_updated_at: item.updated_at, expected_form_id: state.home.form?.id, payment_method: data.get('payment_method'), desired_start_date: kind === 'gx' ? undefined : data.get('desired_start_date'), payer_name: data.get('payer_name') || profile?.name || state.mine?.profile?.name, consents: data.getAll('consents'), form_values: formValues, signature_path: signaturePath, profile, student_name: data.get('student_name') || undefined, guardian_consent: data.has('guardian_consent') });
  if (state.session?.user.id !== owner || state.epoch !== epoch || !navigator.onLine) return;
  await refreshMine();
  if (state.session?.user.id !== owner || state.epoch !== epoch || !navigator.onLine) return;
  navigate('/members/my');
  toast(result.duplicate ? '동일한 신청이 이미 접수되어 기존 신청을 표시합니다.' : '신청이 접수되었습니다. 결제·회원 확인 후 이용권이 등록됩니다.');
}
async function submitRequest(form, data) {
  const owner = state.session?.user.id;
  const epoch = state.epoch;
  const files = [...form.elements.photos.files];
  const limit = Number(settings().photo_limit ?? 3);
  if (files.length > limit) throw new Error(`사진은 최대 ${limit}장까지 첨부할 수 있습니다.`);
  for (const file of files) if (!['image/jpeg','image/png','image/webp'].includes(file.type) || file.size > 8 * 1024 * 1024) throw new Error('사진은 JPG·PNG·WebP 형식, 장당 8MB 이하로 첨부해 주세요.');
  let paths = form._uploadedPhotos;
  if (!paths) {
    paths = [];
    for (const file of files) paths.push(await uploadPhoto(file, { kind: 'requests' }));
    form._uploadedPhotos = paths;
  }
  if (state.session?.user.id !== owner || state.epoch !== epoch || !navigator.onLine) return;
  const result = await service('request_submit', { idempotency_key: form.dataset.key, category_id: data.get('category_id'), title: data.get('title').trim(), body: data.get('body').trim(), location: data.get('location').trim(), photos: paths, item_name: data.get('item_name')?.trim() || undefined, quantity: data.get('quantity') ? Number(data.get('quantity')) : undefined });
  if (state.session?.user.id !== owner || state.epoch !== epoch || !navigator.onLine) return;
  await refreshMine();
  if (state.session?.user.id !== owner || state.epoch !== epoch || !navigator.onLine) return;
  content.innerHTML = `${pageHeading('요청이 접수되었습니다.')}<section class="member-card"><div class="member-success-mark" aria-hidden="true">✓</div><h2>센터에서 확인하겠습니다.</h2><dl class="member-definition"><dt>접수번호</dt><dd>${text(result.request.request_no)}</dd><dt>접수일시</dt><dd>${when(result.request.created_at)}</dd><dt>현재 상태</dt><dd>접수 완료</dd></dl><a href="/members/my" data-member-route class="member-button member-full">내 요청 확인</a></section>`;
}
async function createMemberAccount(form, data) {
  // Recheck the member collection policy before sending any email/password to shared Auth.
  state.home = await service('public_home', {});
  if (!signupAvailable()) throw new Error('현재 신규 계정을 만들 수 없습니다. 개인정보 처리 안내 승인과 회원 접수 시작이 필요합니다.');
  const agreed = data.getAll('signup_consents');
  if (signupPrivacyTerms().some(term => !agreed.includes(term.id))) throw new Error('개인정보 처리 안내가 변경되었거나 동의가 필요합니다. 새로고침 후 안내를 확인해 주세요.');
  if (data.get('password') !== data.get('password_confirm')) throw new Error('비밀번호 확인이 일치하지 않습니다.');
  const { data: auth, error } = await state.client.auth.signUp({ email: data.get('email').trim(), password: data.get('password'), options: { emailRedirectTo: `${location.origin}/members` } });
  if (error) throw error;
  if (auth.session) { state.session = auth.session; state.account = true; await refreshMine(); render(); }
  else { form.reset(); form.innerHTML = `${notice('계정 생성 요청을 처리했습니다. 이메일 확인 안내가 도착한 경우 해당 절차를 완료한 뒤 로그인해 주세요. 이미 가입한 이메일이라면 기존 계정으로 로그인해 주세요.')}<button class="member-button" type="button" data-auth-mode="login">로그인 화면으로</button>`; }
}
async function onSubmit(event) {
  const form = event.target.closest('form[data-form]');
  if (!form) return;
  event.preventDefault();
  if (state.busy) return;
  if (!navigator.onLine) { fail(form, new Error('인터넷 연결 후 다시 신청해 주세요. 아직 접수되지 않았습니다.')); return; }
  state.busy = true;
  form.querySelector('[data-form-error]')?.setAttribute('hidden','');
  const button = form.querySelector('button[type="submit"]');
  const label = button?.textContent;
  if (button) { button.disabled = true; button.textContent = '처리 중…'; }
  const data = new FormData(form);
  try {
    switch (form.dataset.form) {
      case 'login': {
        const { data: auth, error } = await state.client.auth.signInWithPassword({ email: data.get('email').trim(), password: data.get('password') });
        if (error) throw error;
        state.session = auth.session; state.account = false;
        await refreshMine(); render(); break;
      }
      case 'signup': {
        await createMemberAccount(form, data);
        break;
      }
      case 'password-update': {
        if (data.get('password') !== data.get('password_confirm')) throw new Error('비밀번호 확인이 일치하지 않습니다.');
        const { error } = await state.client.auth.updateUser({ password: data.get('password') });
        if (error) throw error;
        state.recovery = false; history.replaceState({}, '', '/members'); state.account = true; await loadView(); toast('비밀번호를 변경했습니다.'); break;
      }
      case 'invite': await service('activate_invite', { code: data.get('code').trim() }); await refreshMine(); render(); toast('내 회원정보를 연결했습니다.'); break;
      case 'application': await submitApplication(form, data); break;
      case 'request': await submitRequest(form, data); break;
      case 'payment-report': await service('payment_report', { id: form.dataset.id, payer_name: data.get('payer_name').trim() }); await refreshMine(); render(); toast('입금 확인을 요청했습니다. 결제 완료 처리는 관리자가 진행합니다.'); break;
      case 'profile-change': await service('profile_change', { changes: Object.fromEntries(['name','building','unit','phone'].map(key => [key, data.get(key).trim()])) }); await refreshMine(); render(); toast('회원정보 변경을 요청했습니다. 관리자 확인 후 반영됩니다.'); break;
    }
  } catch (error) { fail(form, error); }
  finally { state.busy = false; if (button?.isConnected) { button.disabled = !navigator.onLine; button.textContent = label; } connection(); }
}
document.addEventListener('submit', onSubmit);
document.addEventListener('click', async event => {
  const routeLink = event.target.closest('[data-member-route]');
  if (routeLink && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) { event.preventDefault(); navigate(routeLink.getAttribute('href')); return; }
  const target = event.target.closest('button');
  if (!target) return;
  if (target.id === 'memberAccount' || target.hasAttribute('data-account')) { state.account = true; loadView(); return; }
  if (target.dataset.authMode) { state.authMode = target.dataset.authMode; renderAuth(); return; }
  if (target.hasAttribute('data-refresh')) { if (!state.home) boot(); else loadView(); return; }
  if (target.hasAttribute('data-clear-signature')) { const canvas = document.getElementById('memberSignature'); canvas?.getContext('2d').clearRect(0,0,canvas.width,canvas.height); signatureDrawn = false; canvas?.closest('form').removeAttribute('data-signature-path'); return; }
  if (target.hasAttribute('data-copy-bank')) {
    try { await navigator.clipboard.writeText(settings().bank_account || ''); toast('계좌번호를 복사했습니다.'); } catch { toast('복사할 수 없습니다. 표시된 계좌번호를 직접 확인해 주세요.'); }
    return;
  }
  if (target.hasAttribute('data-signout')) {
    target.disabled = true;
    try {
      state.photoEpoch++; state.epoch++; state.mine = null; state.session = null; content.innerHTML = empty('로그아웃 중입니다.');
      const { error } = await state.client.auth.signOut();
      if (error) throw error;
      state.account = false; navigate('/members'); toast('로그아웃했습니다.');
    } catch (error) { state.account = true; renderAuth(); toast(`로그아웃 처리 확인 필요: ${error.message}`); }
    return;
  }
  if (target.hasAttribute('data-reset-password')) {
    const form = target.closest('form');
    const email = form.elements.email;
    if (!email.reportValidity()) return;
    target.disabled = true;
    try { const { error } = await state.client.auth.resetPasswordForEmail(email.value.trim(), { redirectTo: `${location.origin}/members?recovery=1` }); if (error) throw error; toast('이메일의 비밀번호 재설정 안내를 확인해 주세요.'); }
    catch (error) { fail(form, error); }
    finally { target.disabled = false; }
  }
});
document.addEventListener('change', event => {
  const form = event.target.closest('form');
  if (!form) return;
  if (['selection','desired_start_date'].includes(event.target.name)) selectionChanged(form);
  if (event.target.name === 'payment_method') { const field = document.getElementById('memberPayerField'); field.hidden = event.target.value !== 'transfer'; form.elements.payer_name.required = event.target.value === 'transfer'; }
  if (event.target.name === 'category_id') { const name = rows(state.home.request_categories).find(v => v.id === event.target.value)?.name || ''; document.getElementById('memberItemFields').hidden = !/물품/.test(name); }
  if (event.target.name === 'photos') {
    form._uploadedPhotos = null;
    const preview = document.getElementById('memberUploadPreview');
    preview.replaceChildren();
    [...event.target.files].forEach(file => { if (!['image/jpeg','image/png','image/webp'].includes(file.type)) return; const img = new Image(); const url = URL.createObjectURL(file); img.src = url; img.alt = '선택한 첨부 사진'; img.onload = () => URL.revokeObjectURL(url); img.onerror = () => URL.revokeObjectURL(url); preview.append(img); });
  }
});
window.addEventListener('popstate', () => { state.account = false; loadView(); });
window.addEventListener('online', () => { connection(); if (route() !== 'home' || state.account) loadView(); });
window.addEventListener('offline', () => {
  connection();
  state.mine = null; state.photoEpoch++; state.epoch++;
  if (route() !== 'home' || state.account) {
    content.innerHTML = `${pageHeading('인터넷 연결이 필요합니다.')}${notice('개인 신청내역은 연결 복구 후 다시 확인합니다. 작성 중인 신청은 접수되지 않았습니다.', 'warning')}<button type="button" class="member-secondary" data-refresh>연결 후 다시 확인</button>`;
  }
});
window.addEventListener('pageshow', event => { if (event.persisted) location.reload(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) state.photoEpoch++; });
async function boot() {
  content.innerHTML = empty('센터 소식을 불러오고 있습니다.');
  try {
    state.client = await getClient();
    const [{ data: auth, error }, home] = await Promise.all([state.client.auth.getSession(), service('public_home', {})]);
    if (error) throw error;
    state.session = auth.session; state.home = home;
    if (!state._authSubscription) {
      state._authSubscription = state.client.auth.onAuthStateChange((event, session) => {
        const changed = state.session?.user.id !== session?.user.id;
        state.session = session;
        if (event === 'PASSWORD_RECOVERY') state.recovery = true;
        if (changed || event === 'SIGNED_OUT') { state.mine = null; state.photoEpoch++; state.epoch++; content.innerHTML = empty('계정 상태를 확인하고 있습니다.'); setTimeout(loadView, 0); }
        else if (event === 'PASSWORD_RECOVERY') setTimeout(render, 0);
      });
    }
    if (new URLSearchParams(location.search).has('recovery') && state.session) state.recovery = true;
    await loadView();
  } catch (error) {
    state.mine = null;
    content.innerHTML = `${pageHeading('회원서비스 연결 확인')}<div class="member-notice error">회원서비스를 불러오지 못했습니다. 접수된 것으로 처리하지 않습니다.<p>${text(error.message || '센터 서비스 설정과 인터넷 연결을 확인해 주세요.')}</p></div><button class="member-button" data-refresh type="button">다시 시도</button>`;
    content.setAttribute('aria-busy','false');
  }
}
boot();
