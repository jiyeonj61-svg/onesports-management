export const AREA_FALLBACK = [
  { id: 1, slug: 'lobby', name: '로비', sort_order: 1, active: true, checklist: ['바닥·출입구 청결', '안내물·비품 정리', '조명 상태', '특이사항 확인'] },
  { id: 2, slug: 'fitness', name: '헬스장', sort_order: 2, active: true, checklist: ['운동기구 작동 상태', '바닥·기구 청결', '안전 상태', '환기·온도', '원판·소도구 정리'] },
  { id: 3, slug: 'golf', name: '골프연습장', sort_order: 3, active: true, checklist: ['타석·스크린 작동', '안전망·매트 상태', '바닥 청결', '골프용품 정리', '조명·환기'] },
  { id: 4, slug: 'screen-golf-1', name: '스크린골프장 1번', sort_order: 4, active: true, checklist: ['기기 전원·작동', '타석·센서 상태', '매트·타석 청결', '골프채·비품 정리', '조명·환기'] },
  { id: 5, slug: 'screen-golf-2', name: '스크린골프장 2번', sort_order: 5, active: true, checklist: ['기기 전원·작동', '타석·센서 상태', '매트·타석 청결', '골프채·비품 정리', '조명·환기'] },
  { id: 6, slug: 'screen-golf-3', name: '스크린골프장 3번', sort_order: 6, active: true, checklist: ['기기 전원·작동', '타석·센서 상태', '매트·타석 청결', '골프채·비품 정리', '조명·환기'] },
  { id: 7, slug: 'gx', name: 'GX룸', sort_order: 7, active: true, checklist: ['바닥·거울 청결', '음향기기 작동', '운동용품 정리', '조명·환기', '안전 상태'] },
  { id: 8, slug: 'pilates', name: '기구필라테스룸', sort_order: 8, active: true, checklist: ['리포머·기구 상태', '바닥·거울 청결', '소도구 정리', '조명·환기', '안전 상태'] },
  { id: 9, slug: 'table-tennis', name: '탁구장', sort_order: 9, active: true, checklist: ['탁구대·네트 상태', '라켓·공 비품', '바닥 청결', '조명 상태', '주변 정리'] },
  { id: 10, slug: 'mens-locker', name: '남자 탈의실', sort_order: 10, active: true, checklist: ['락커·바닥 청결', '샤워시설·배수', '드라이기·비품', '악취·환기', '안전 상태'] },
  { id: 11, slug: 'womens-locker', name: '여자 탈의실', sort_order: 11, active: true, checklist: ['락커·바닥 청결', '샤워시설·배수', '드라이기·비품', '악취·환기', '안전 상태'] },
  { id: 12, slug: 'restroom', name: '화장실', sort_order: 12, active: true, checklist: ['변기·세면대 청결', '휴지·비누 보충', '배수 상태', '악취·환기', '조명 상태'] },
  { id: 13, slug: 'reading-room', name: '독서실', sort_order: 13, active: true, checklist: ['책상·의자 정리', '바닥 청결', '조명 상태', '냉난방·환기', '소음·이용환경'] },
];

export const APP_START_DATE = '2026-09-01';
export const APP_START_MONTH = APP_START_DATE.slice(0, 7);

export const INSPECTION_STATUS = {
  normal: { label: '정상', short: '정상', className: 'normal', icon: '✓' },
  issue: { label: '이상 발견', short: '이상', className: 'warning', icon: '!' },
  in_progress: { label: '조치 중', short: '조치 중', className: 'progress', icon: '↻' },
  completed: { label: '조치 완료', short: '완료', className: 'completed', icon: '✓' },
};

export const ITEM_STATUS = {
  unchecked: { label: '미점검', className: 'empty', icon: '–' },
  normal: { label: '정상', className: 'normal', icon: '✓' },
  issue: { label: '이상 발견', className: 'warning', icon: '!' },
  in_progress: { label: '조치 중', className: 'progress', icon: '↻' },
  completed: { label: '조치 완료', className: 'completed', icon: '✓' },
};

export const ISSUE_STATUS = {
  received: { label: '접수', className: 'received' },
  reviewing: { label: '확인 중', className: 'reviewing' },
  in_progress: { label: '조치 중', className: 'progress' },
  completed: { label: '완료', className: 'completed' },
};

export const ISSUE_CATEGORY = {
  facility: { label: '시설', className: 'facility' },
  safety: { label: '안전', className: 'safety' },
  cleaning: { label: '청결', className: 'cleaning' },
  complaint: { label: '민원', className: 'complaint' },
  other: { label: '기타', className: 'other' },
};

export const INVENTORY_STATUS = {
  normal: { label: '정상', className: 'completed' },
  low: { label: '부족', className: 'reviewing' },
  restocking: { label: '보충 중', className: 'progress' },
  repair: { label: '수리 필요', className: 'received' },
};

export const INVENTORY_CATEGORY = {
  facility: { label: '시설', className: 'facility' },
  equipment: { label: '비품', className: 'cleaning' },
  supply: { label: '소모품', className: 'safety' },
  other: { label: '기타', className: 'other' },
};

export const PRIORITY_META = {
  low: { label: '낮음', className: 'low' },
  normal: { label: '보통', className: 'normal-priority' },
  high: { label: '높음', className: 'high' },
  urgent: { label: '긴급', className: 'urgent' },
};

export const PERIOD_META = {
  AM: { label: '오전', full: '오전 점검' },
  PM: { label: '오후', full: '오후 점검' },
};

export function localISODate(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function appCurrentDate() {
  const today = localISODate();
  return today < APP_START_DATE ? APP_START_DATE : today;
}

export function clampAppDate(value) {
  const maximum = appCurrentDate();
  const date = String(value || maximum).slice(0, 10);
  if (date < APP_START_DATE) return APP_START_DATE;
  if (date > maximum) return maximum;
  return date;
}

export function isAppDateAllowed(value) {
  const date = String(value || '').slice(0, 10);
  return Boolean(date) && date >= APP_START_DATE && date <= appCurrentDate();
}

export function clampAppMonth(value) {
  const maximum = monthKey(appCurrentDate());
  const month = String(value || maximum).slice(0, 7);
  if (month < APP_START_MONTH) return APP_START_MONTH;
  if (month > maximum) return maximum;
  return month;
}

export function parseLocalDate(value) {
  if (value instanceof Date) return new Date(value.getFullYear(), value.getMonth(), value.getDate());
  const [year, month, day] = String(value).split('-').map(Number);
  return new Date(year, (month || 1) - 1, day || 1);
}

export function addDays(value, amount) {
  const date = parseLocalDate(value);
  date.setDate(date.getDate() + amount);
  return localISODate(date);
}

export function monthKey(value = new Date()) {
  const date = value instanceof Date ? value : parseLocalDate(`${String(value).slice(0, 7)}-01`);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

export function shiftMonth(value, amount) {
  const date = value instanceof Date ? new Date(value) : parseLocalDate(`${String(value).slice(0, 7)}-01`);
  date.setDate(1);
  date.setMonth(date.getMonth() + amount);
  return monthKey(date);
}

export function monthRange(value) {
  const date = parseLocalDate(`${String(value).slice(0, 7)}-01`);
  const start = localISODate(date);
  const endDate = new Date(date.getFullYear(), date.getMonth() + 1, 0);
  return { start, end: localISODate(endDate), days: endDate.getDate() };
}

export function formatKoreanDate(value, options = {}) {
  const date = parseLocalDate(value);
  const base = { year: 'numeric', month: 'long', day: 'numeric', weekday: options.weekday === false ? undefined : 'long' };
  return new Intl.DateTimeFormat('ko-KR', base).format(date);
}

export function formatMonth(value) {
  const date = parseLocalDate(`${String(value).slice(0, 7)}-01`);
  return new Intl.DateTimeFormat('ko-KR', { year: 'numeric', month: 'long' }).format(date);
}

export function formatShortDate(value) {
  if (!value) return '-';
  const date = parseLocalDate(value);
  return new Intl.DateTimeFormat('ko-KR', { month: 'short', day: 'numeric' }).format(date);
}

export function formatDateTime(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return new Intl.DateTimeFormat('ko-KR', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(date);
}

export function weekdayLabel(value) {
  const date = parseLocalDate(value);
  return new Intl.DateTimeFormat('ko-KR', { weekday: 'long' }).format(date);
}

export function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

export function nl2br(value = '') {
  return escapeHtml(value).replace(/\n/g, '<br>');
}

export function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

export function statusMeta(status) {
  return INSPECTION_STATUS[status] || { label: '미점검', short: '미점검', className: 'empty', icon: '–' };
}

export function itemStatusMeta(status) {
  return ITEM_STATUS[status] || ITEM_STATUS.unchecked;
}

export function issueStatusMeta(status) {
  return ISSUE_STATUS[status] || ISSUE_STATUS.received;
}

export function categoryMeta(category) {
  return ISSUE_CATEGORY[category] || ISSUE_CATEGORY.other;
}

export function inventoryStatusMeta(status) {
  return INVENTORY_STATUS[status] || INVENTORY_STATUS.normal;
}

export function inventoryCategoryMeta(category) {
  return INVENTORY_CATEGORY[category] || INVENTORY_CATEGORY.other;
}

export function priorityMeta(priority) {
  return PRIORITY_META[priority] || PRIORITY_META.normal;
}

export function showToast(message, type = 'success') {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = message;
  toast.className = `toast show ${type}`;
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => {
    toast.className = 'toast';
  }, 2600);
}

export function setBusy(button, busy, busyText = '처리 중...') {
  if (!button) return;
  if (busy) {
    button.dataset.originalText = button.textContent;
    button.textContent = busyText;
    button.disabled = true;
  } else {
    button.textContent = button.dataset.originalText || button.textContent;
    button.disabled = false;
  }
}

export function openModal(modal) {
  if (!modal) return;
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
  document.body.classList.add('modal-open');
  const focusable = modal.querySelector('input:not([type="hidden"]), select, textarea, button');
  window.setTimeout(() => focusable?.focus(), 50);
}

export function closeModal(modal) {
  if (!modal) return;
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
  if (!document.querySelector('.modal.open')) document.body.classList.remove('modal-open');
}

export function debounce(fn, delay = 180) {
  let timer;
  return (...args) => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => fn(...args), delay);
  };
}

export function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || !location.protocol.startsWith('http')) return;
  window.addEventListener('load', async () => {
    try {
      const registration = await navigator.serviceWorker.register('/sw.js?v=20260828-6', { updateViaCache: 'none' });
      await registration.update();
    } catch (error) {
      console.warn('서비스워커 등록 실패:', error);
    }
  });
}

export function uuid() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function isOpenIssue(issue) {
  return issue?.status !== 'completed';
}

export function completionPercent(count, total) {
  if (!total) return 0;
  return Math.round((count / total) * 100);
}
