import { data } from './data.js';
import {createLiveRefresh,loadViewerSnapshot,viewerSelectionKey} from './viewer-refresh.js';
import {
  APP_START_DATE,
  APP_START_MONTH,
  PERIOD_META,
  addDays,
  appCurrentDate,
  categoryMeta,
  clampAppDate,
  clampAppMonth,
  completionPercent,
  escapeHtml,
  formatDateTime,
  formatKoreanDate,
  formatMonth,
  formatShortDate,
  headOfficeCheckTypeMeta,
  inventoryCategoryMeta,
  inventoryStatusMeta,
  isOpenIssue,
  issueStatusMeta,
  itemStatusMeta,
  monthKey,
  monthRange,
  nl2br,
  openModal,
  closeModal,
  parseLocalDate,
  priorityMeta,
  registerServiceWorker,
  safeArray,
  shiftMonth,
  statusMeta,
  weekdayLabel,
} from './common.js';

const state = {
  areas: [],
  selectedDate: appCurrentDate(),
  dailyDate: appCurrentDate(),
  calendarMonth: monthKey(appCurrentDate()),
  reportMonth: monthKey(appCurrentDate()),
  dailyInspections: [],
  dailyIssues: [],
  dailyHeadOfficeChecks: [],
  allIssues: [],
  allInventories: [],
  allHeadOfficeChecks: [],
  issueFilter: 'open',
  activeTab: 'today',
  lastToday: appCurrentDate(),
  detail: null,
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
let liveRefresh=null;
const renderedSnapshots=new Map();
function requestRefresh(){return liveRefresh?.request();}
function loadDaily(){return requestRefresh();}
function loadCalendar(){return requestRefresh();}
function loadMonthlyReport(){return requestRefresh();}

function areaById(id) {
  return state.areas.find((area) => Number(area.id) === Number(id));
}

function renderModeBanner(connection) {
  const banner = $('#setupBanner');
  if (connection.isDemo) {
    banner.classList.remove('hidden');
    banner.className = connection.configError ? 'setup-banner error' : 'setup-banner';
    banner.textContent = connection.configError
      ? `${connection.configError} 열람 화면은 데모 데이터로 표시됩니다.`
      : '현재 데모 모드입니다. 실시간 공유를 위해서는 Supabase 연결이 필요합니다.';
  } else {
    banner.classList.add('hidden');
  }
}

function updateHeaderDate() {
  const today = appCurrentDate();
  $('#todayLabel').textContent = formatKoreanDate(today, { weekday: false });
  $('#todayWeekday').textContent = weekdayLabel(today);
}

function updateSelectedDateLabels() {
  state.selectedDate = clampAppDate(state.selectedDate);
  const maximum = appCurrentDate();
  $('#selectedDateLabel').textContent = formatKoreanDate(state.selectedDate, { weekday: false });
  $('#selectedDateSub').textContent = weekdayLabel(state.selectedDate);
  $('#datePicker').min = APP_START_DATE;
  $('#datePicker').max = maximum;
  $('#datePicker').value = state.selectedDate;
  $('#prevDay').disabled = state.selectedDate <= APP_START_DATE;
  $('#nextDay').disabled = state.selectedDate >= maximum;
  $('#goToday').classList.toggle('hidden', state.selectedDate === maximum);
}

function renderDailySummary() {
  const total = state.areas.length * 2;
  const recorded = state.dailyInspections.length;
  const normal = state.dailyInspections.filter((item) => item.status === 'normal' || item.status === 'completed').length;
  const attention = state.dailyInspections.filter((item) => item.status === 'issue' || item.status === 'in_progress').length;
  const remaining = Math.max(total - recorded, 0);
  $('#dailySummary').innerHTML = `
    <article class="summary-card success">
      <span class="summary-label"><i class="summary-icon">✓</i>입력 완료</span>
      <strong>${recorded}<small>/${total}건</small></strong>
      <p>해당 일자의 오전·오후 점검 입력 현황</p>
    </article>
    <article class="summary-card">
      <span class="summary-label"><i class="summary-icon">○</i>정상 관리</span>
      <strong>${normal}<small>건</small></strong>
      <p>이상 없이 관리된 점검 수</p>
    </article>
    <article class="summary-card ${attention ? 'warning' : ''}">
      <span class="summary-label"><i class="summary-icon">!</i>확인·조치</span>
      <strong>${attention}<small>건</small></strong>
      <p>이상 발견 또는 현재 조치 중</p>
    </article>
    <article class="summary-card ${remaining ? 'danger' : ''}">
      <span class="summary-label"><i class="summary-icon">–</i>미점검</span>
      <strong>${remaining}<small>건</small></strong>
      <p>오전·오후 미입력 점검 수</p>
    </article>
  `;
}

function cellHtml(area, period, inspection) {
  const meta = statusMeta(inspection?.status);
  const checkedCount = safeArray(inspection?.checked_items).length;
  const sub = inspection
    ? `${checkedCount}/${safeArray(area.checklist).length}개 항목 · ${inspection.manager_name || '-'}`
    : `${PERIOD_META[period].label} 관리기록 없음`;
  return `
    <button class="inspection-cell ${meta.className}" type="button"
      data-inspection-id="${inspection?.id || ''}" data-area-id="${area.id}" data-period="${period}">
      <span class="status-symbol">${meta.icon}</span>
      <span class="cell-copy"><strong>${meta.label}</strong><small>${escapeHtml(sub)}</small></span>
      <span class="cell-arrow">›</span>
    </button>
  `;
}

function renderInspectionMatrix() {
  const map = new Map(state.dailyInspections.map((item) => [`${item.area_id}-${item.period}`, item]));
  $('#inspectionMatrix').innerHTML = `
    <div class="matrix-header"><span>관리 공간</span><span>오전 점검</span><span>오후 점검</span></div>
    ${state.areas.map((area, index) => `
      <div class="matrix-row">
        <div class="matrix-area"><span class="area-index">${String(index + 1).padStart(2, '0')}</span><span>${escapeHtml(area.name)}</span></div>
        ${cellHtml(area, 'AM', map.get(`${area.id}-AM`))}
        ${cellHtml(area, 'PM', map.get(`${area.id}-PM`))}
      </div>
    `).join('')}
  `;

  $$('.inspection-cell', $('#inspectionMatrix')).forEach((button) => {
    button.addEventListener('click', () => showInspectionDetail(button.dataset.areaId, button.dataset.period, button.dataset.inspectionId));
  });
}

function showInspectionDetail(areaId, period, inspectionId, open = true) {
  state.detail={areaId,period};
  const area = areaById(areaId);
  const inspection = state.dailyInspections.find((item) => item.id === inspectionId);
  const meta = statusMeta(inspection?.status);
  const checked = new Set(safeArray(inspection?.checked_items));
  const itemStatuses = inspection?.item_statuses || {};
  const photos = safeArray(inspection?.photo_paths).map((path) => data.resolvePhotoUrl(path)).filter(Boolean);

  $('#detailModalContent').innerHTML = `
    <div class="modal-heading">
      <p class="section-kicker">${escapeHtml(PERIOD_META[period].full)}</p>
      <h2 id="detailModalTitle">${escapeHtml(area?.name || '공간')} 관리현황</h2>
      <p>${escapeHtml(formatKoreanDate(state.dailyDate))}</p>
    </div>
    <div class="detail-status ${meta.className}">
      <span class="status-symbol">${meta.icon}</span>
      <div><strong>${meta.label}</strong><small>${inspection ? '관리자가 입력한 점검 기록입니다.' : '아직 입력된 점검 기록이 없습니다.'}</small></div>
    </div>
    <section class="detail-section">
      <h4>점검 항목별 상태</h4>
      <div class="detail-checklist">
        ${safeArray(area?.checklist).map((item) => {
          const itemMeta = itemStatusMeta(itemStatuses[item] || (checked.has(item) ? 'normal' : 'unchecked'));
          return `<div class="detail-check-item ${itemMeta.className}"><i>${itemMeta.icon}</i><span>${escapeHtml(item)}</span><b>${escapeHtml(itemMeta.label)}</b></div>`;
        }).join('')}
      </div>
    </section>
    <section class="detail-section">
      <h4>특이사항·조치내용</h4>
      <p>${inspection?.note ? nl2br(inspection.note) : '등록된 특이사항이 없습니다.'}</p>
    </section>
    ${photos.length ? `<section class="detail-section"><h4>현장 사진</h4><div class="photo-strip">${photos.map((url) => `<a class="photo-thumb" href="${escapeHtml(url)}" target="_blank" rel="noopener"><img src="${escapeHtml(url)}" alt="현장 관리 사진" /></a>`).join('')}</div></section>` : ''}
    <div class="detail-meta">
      <div><span>점검 담당자</span><strong>${escapeHtml(inspection?.manager_name || '-')}</strong></div>
      <div><span>최종 입력시간</span><strong>${inspection ? escapeHtml(formatDateTime(inspection.updated_at)) : '-'}</strong></div>
    </div>
  `;
  if(open)openModal($('#detailModal'));
}

function compactItemHtml(issue) {
  const category = categoryMeta(issue.category);
  const status = issueStatusMeta(issue.status);
  const area = areaById(issue.area_id);
  return `
    <div class="compact-item">
      <span class="mini-badge ${category.className}">${category.label.slice(0, 1)}</span>
      <span><strong>${escapeHtml(issue.title)}</strong><small>${escapeHtml(area?.name || '공통')} · ${escapeHtml(status.label)}</small></span>
      <small>${escapeHtml(formatShortDate(issue.received_date))}</small>
    </div>
  `;
}

function compactHeadOfficeCheckHtml(item) {
  const type = headOfficeCheckTypeMeta(item.check_type);
  return `
    <div class="compact-item">
      <span class="mini-badge ${type.className}">${type.label.slice(0, 1)}</span>
      <span><strong>${escapeHtml(item.title)}</strong><small>전체 · ${escapeHtml(type.label)} · 완료</small></span>
      <small>${escapeHtml(formatShortDate(item.check_date))}</small>
    </div>
  `;
}

function renderTodayActivities() {
  const visible = state.dailyIssues.filter((item) => item.is_public !== false).slice(0, 5);
  const headOfficeChecks = state.dailyHeadOfficeChecks.slice(0, 5);
  $('#todayIssues').className = visible.length ? 'compact-list' : 'compact-list empty-state';
  $('#todayIssues').innerHTML = visible.length ? visible.map(compactItemHtml).join('') : '등록된 조치·민원이 없습니다.';
  $('#todayHeadOfficeChecks').className = headOfficeChecks.length ? 'compact-list' : 'compact-list empty-state';
  $('#todayHeadOfficeChecks').innerHTML = headOfficeChecks.length ? headOfficeChecks.map(compactHeadOfficeCheckHtml).join('') : '등록된 본사점검이 없습니다.';
}

function renderDaily(snapshot) {
  state.dailyDate=snapshot.selection.selectedDate;
  updateSelectedDateLabels();
  state.dailyInspections=snapshot.inspections;
  state.dailyIssues=snapshot.issues.filter(item=>item.received_date===state.selectedDate);
  state.dailyHeadOfficeChecks=snapshot.headOfficeChecks;
  renderDailySummary();renderInspectionMatrix();renderTodayActivities();
  if(state.detail&&$('#detailModal').classList.contains('open')){
    const row=state.dailyInspections.find(item=>String(item.area_id)===String(state.detail.areaId)&&item.period===state.detail.period);
    showInspectionDetail(state.detail.areaId,state.detail.period,row?.id,false);
  }
}

function issueCardHtml(issue) {
  const category = categoryMeta(issue.category);
  const status = issueStatusMeta(issue.status);
  const priority = priorityMeta(issue.priority);
  const area = areaById(issue.area_id);
  const photos = safeArray(issue.photo_paths).map((path) => data.resolvePhotoUrl(path)).filter(Boolean);
  return `
    <article class="issue-card">
      <div class="issue-card-head">
        <div class="issue-card-title">
          <div class="issue-badges">
            <span class="badge category-${category.className}">${category.label}</span>
            <span class="badge status-${status.className}">${status.label}</span>
            ${['high', 'urgent'].includes(issue.priority) ? `<span class="badge priority-${priority.className}">${priority.label}</span>` : ''}
          </div>
          <h3>${escapeHtml(issue.title)}</h3>
        </div>
      </div>
      <div class="issue-card-meta">
        <span>공간 ${escapeHtml(area?.name || '공통·기타')}</span>
        <span>접수 ${escapeHtml(formatShortDate(issue.received_date))}</span>
        ${issue.due_date ? `<span>예정 ${escapeHtml(formatShortDate(issue.due_date))}</span>` : ''}
      </div>
      <div class="issue-card-body">
        <p>${nl2br(issue.description)}</p>
        ${issue.action_note ? `<div class="issue-action-box"><strong>조치 내용·진행 상황</strong><p>${nl2br(issue.action_note)}</p></div>` : ''}
        ${photos.length ? `<div class="photo-strip">${photos.map((url) => `<a class="photo-thumb" href="${escapeHtml(url)}" target="_blank" rel="noopener"><img src="${escapeHtml(url)}" alt="증빙 사진" /></a>`).join('')}</div>` : ''}
      </div>
      <div class="issue-card-footer"><span>담당 ${escapeHtml(issue.manager_name || '-')}</span><span>최종 업데이트 ${escapeHtml(formatDateTime(issue.updated_at))}</span></div>
    </article>
  `;
}

function headOfficeCheckCardHtml(item) {
  const type = headOfficeCheckTypeMeta(item.check_type);
  const photos = safeArray(item.photo_paths).map((path) => data.resolvePhotoUrl(path)).filter(Boolean);
  return `
    <article class="issue-card">
      <div class="issue-card-head">
        <div class="issue-card-title">
          <div class="issue-badges">
            <span class="badge type-${type.className}">${type.label}</span>
            <span class="badge status-completed">완료</span>
          </div>
          <h3>${escapeHtml(item.title)}</h3>
        </div>
      </div>
      <div class="issue-card-meta">
        <span>관련 공간 전체</span>
        <span>점검일 ${escapeHtml(formatShortDate(item.check_date))}</span>
        <span>형태 ${escapeHtml(type.label)}</span>
      </div>
      <div class="issue-card-body">
        <p>${nl2br(item.result)}</p>
        ${item.follow_up ? `<div class="issue-action-box"><strong>후속조치·비고</strong><p>${nl2br(item.follow_up)}</p></div>` : ''}
        ${photos.length ? `<div class="photo-strip">${photos.map((url) => `<a class="photo-thumb" href="${escapeHtml(url)}" target="_blank" rel="noopener"><img src="${escapeHtml(url)}" alt="본사점검 사진" /></a>`).join('')}</div>` : ''}
      </div>
      <div class="issue-card-footer"><span>본사 점검자 ${escapeHtml(item.manager_name || '-')}</span><span>최종 업데이트 ${escapeHtml(formatDateTime(item.updated_at))}</span></div>
    </article>
  `;
}

function inventoryCardHtml(item) {
  const category = inventoryCategoryMeta(item.category);
  const status = inventoryStatusMeta(item.status);
  const area = areaById(item.area_id);
  const photos = safeArray(item.photo_paths).map((path) => data.resolvePhotoUrl(path)).filter(Boolean);
  return `
    <article class="issue-card">
      <div class="issue-card-head">
        <div class="issue-card-title">
          <div class="issue-badges">
            <span class="badge category-${category.className}">${category.label}</span>
            <span class="badge status-${status.className}">${status.label}</span>
          </div>
          <h3>${escapeHtml(item.name)}</h3>
        </div>
      </div>
      <div class="issue-card-meta">
        <span>공간 ${escapeHtml(area?.name || '공통·기타')}</span>
        <span>기준일 ${escapeHtml(formatShortDate(item.record_date))}</span>
        ${item.quantity ? `<span>수량 ${escapeHtml(item.quantity)}</span>` : ''}
      </div>
      <div class="issue-card-body">
        <p>${item.note ? nl2br(item.note) : '등록된 현황 메모가 없습니다.'}</p>
        ${photos.length ? `<div class="photo-strip">${photos.map((url) => `<a class="photo-thumb" href="${escapeHtml(url)}" target="_blank" rel="noopener"><img src="${escapeHtml(url)}" alt="시설비품 사진" /></a>`).join('')}</div>` : ''}
      </div>
      <div class="issue-card-footer"><span>담당 ${escapeHtml(item.manager_name || '-')}</span><span>최종 업데이트 ${escapeHtml(formatDateTime(item.updated_at))}</span></div>
    </article>
  `;
}

function applyIssueFilter(items, filter) {
  if (filter === 'open') return items.filter(isOpenIssue);
  if (filter === 'completed') return items.filter((item) => item.status === 'completed');
  return items;
}


function renderIssueList(filter, targetId = 'issuesList') {
  const filtered = applyIssueFilter(state.allIssues, filter);
  const target = document.getElementById(targetId);
  target.className = filtered.length ? 'card-list' : 'card-list empty-state';
  target.innerHTML = filtered.length
    ? filtered.map((item) => issueCardHtml(item)).join('')
    : '해당 조건의 조치·민원 기록이 없습니다.';
}

function renderHeadOfficeCheckList() {
  const target = $('#headOfficeChecksList');
  target.className = state.allHeadOfficeChecks.length ? 'card-list' : 'card-list empty-state';
  target.innerHTML = state.allHeadOfficeChecks.length
    ? state.allHeadOfficeChecks.map((item) => headOfficeCheckCardHtml(item)).join('')
    : '등록된 본사점검 기록이 없습니다.';
}

function renderInventoryList() {
  const target = $('#inventoryList');
  target.className = state.allInventories.length ? 'card-list' : 'card-list empty-state';
  target.innerHTML = state.allInventories.length ? state.allInventories.map((item) => inventoryCardHtml(item)).join('') : '공개된 시설·비품 현황이 없습니다.';
}

function renderCalendar(inspections, month) {
  const { start: monthStart, days } = monthRange(month);
  const maximum = appCurrentDate();
  const currentMonth = monthKey(maximum);
  $('#calendarMonthLabel').textContent = formatMonth(month);
  $('#prevMonth').disabled = month <= APP_START_MONTH;
  $('#nextMonth').disabled = month >= currentMonth;

    const byDate = new Map();
    inspections.forEach((item) => {
      if (!byDate.has(item.inspection_date)) byDate.set(item.inspection_date, []);
      byDate.get(item.inspection_date).push(item);
    });
    const first = parseLocalDate(monthStart);
    const offset = first.getDay();
    const total = state.areas.length * 2;
    let completeDays = 0;
    let recordedDays = 0;
    const cells = [];
    for (let i = 0; i < offset; i += 1) cells.push('<div class="calendar-day empty-slot"></div>');
    for (let day = 1; day <= days; day += 1) {
      const date = `${month}-${String(day).padStart(2, '0')}`;
      const beforeStart = date < APP_START_DATE;
      const future = date > maximum;
      const unavailable = beforeStart || future;
      const rows = unavailable ? [] : (byDate.get(date) || []);
      const percent = completionPercent(rows.length, total);
      const hasAttention = rows.some((item) => item.status === 'issue' || item.status === 'in_progress');
      const type = rows.length === total && !hasAttention ? 'complete' : rows.length ? 'partial' : 'none';
      if (!unavailable && type === 'complete') completeDays += 1;
      if (!unavailable && rows.length) recordedDays += 1;
      const availabilityClass = beforeStart ? 'before-start' : future ? 'future' : '';
      const progressText = beforeStart ? '운영 전' : future ? '예정' : rows.length ? `${rows.length}/${total}건 · ${percent}%` : '기록 없음';
      cells.push(`
        <button class="calendar-day ${type} ${date === maximum ? 'today' : ''} ${availabilityClass}" type="button" ${unavailable ? 'disabled aria-disabled="true"' : `data-calendar-date="${date}"`}>
          <span class="day-number">${day}</span>
          <span class="day-progress"><span>${progressText}</span><span class="mini-progress"><i style="width:${percent}%"></i></span></span>
        </button>
      `);
    }
    $('#calendarGrid').innerHTML = cells.join('');
    $('#calendarSummary').innerHTML = `
      <div class="calendar-summary-item"><span>전체 점검 완료일</span><strong>${completeDays}일</strong></div>
      <div class="calendar-summary-item"><span>관리기록 입력일</span><strong>${recordedDays}일</strong></div>
      <div class="calendar-summary-item"><span>월 누적 점검</span><strong>${inspections.length}건</strong></div>
    `;
    $$('[data-calendar-date]').forEach((button) => button.addEventListener('click', () => {
      state.selectedDate = clampAppDate(button.dataset.calendarDate);
      showTab('today');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }));

}

function elapsedDaysForMonth(month) {
  const { start: monthStart, end: monthEnd } = monthRange(month);
  const start = monthStart < APP_START_DATE ? APP_START_DATE : monthStart;
  const end = monthEnd > appCurrentDate() ? appCurrentDate() : monthEnd;
  if (end < start) return 0;
  const milliseconds = parseLocalDate(end).getTime() - parseLocalDate(start).getTime();
  return Math.floor(milliseconds / 86400000) + 1;
}

function renderMonthlyReport(snapshot, month) {
  const {inspections,inventories,headOfficeChecks}=snapshot;
  const { start: monthStart, end: monthEnd } = monthRange(month);
  const maximum = appCurrentDate();
  const currentMonth = monthKey(maximum);
  const start = monthStart < APP_START_DATE ? APP_START_DATE : monthStart;
  const end = monthEnd > maximum ? maximum : monthEnd;
  $('#reportMonthLabel').textContent = formatMonth(month);
  $('#reportPrevMonth').disabled = month <= APP_START_MONTH;
  $('#reportNextMonth').disabled = month >= currentMonth;
    const publicIssues = snapshot.issues.filter(item=>item.received_date>=start&&item.received_date<=end);
    const publicInventories = inventories.filter((item) => item.is_public !== false);
    const elapsedDays = elapsedDaysForMonth(month);
    const possible = elapsedDays * state.areas.length * 2;
    const rate = completionPercent(inspections.length, possible);
    const normal = inspections.filter((item) => item.status === 'normal' || item.status === 'completed').length;
    const actions = publicIssues.filter((item) => item.category !== 'complaint');
    const complaints = publicIssues.filter((item) => item.category === 'complaint');
    const resolved = publicIssues.filter((item) => item.status === 'completed').length;

    $('#monthlySummary').innerHTML = `
      <article class="summary-card success"><span class="summary-label"><i class="summary-icon">%</i>점검 입력률</span><strong>${rate}<small>%</small></strong><p>${inspections.length}건 / 기준 ${possible || 0}건</p></article>
      <article class="summary-card"><span class="summary-label"><i class="summary-icon">✓</i>정상·완료 점검</span><strong>${normal}<small>건</small></strong><p>전체 점검 중 정상 관리 건수</p></article>
      <article class="summary-card progress-card"><span class="summary-label"><i class="summary-icon">!</i>조치·민원</span><strong>${publicIssues.length}<small>건</small></strong><p>조치 ${actions.length}건 · 민원 ${complaints.length}건</p></article>
      <article class="summary-card"><span class="summary-label"><i class="summary-icon">◆</i>본사점검·비품</span><strong>${headOfficeChecks.length + publicInventories.length}<small>건</small></strong><p>본사점검 ${headOfficeChecks.length}건 · 비품 ${publicInventories.length}건</p></article>
    `;

    const areaRows = state.areas.map((area) => {
      const rows = inspections.filter((item) => Number(item.area_id) === Number(area.id));
      const am = rows.filter((item) => item.period === 'AM').length;
      const pm = rows.filter((item) => item.period === 'PM').length;
      const areaPossible = elapsedDays * 2;
      const areaRate = completionPercent(rows.length, areaPossible);
      return `<tr><td><strong>${escapeHtml(area.name)}</strong></td><td>${am}건</td><td>${pm}건</td><td>${rows.length}건</td><td><span class="progress-bar"><span class="progress-track"><i style="width:${areaRate}%"></i></span><strong>${areaRate}%</strong></span></td></tr>`;
    }).join('');
    $('#areaReportTable').innerHTML = `<table class="data-table"><thead><tr><th>관리 공간</th><th>오전</th><th>오후</th><th>합계</th><th>입력률</th></tr></thead><tbody>${areaRows}</tbody></table>`;

    const activity = [
      ...publicIssues.map((item) => ({ kind: 'issue', date: item.received_date, item })),
      ...headOfficeChecks.map((item) => ({ kind: 'head-office', date: item.check_date, item })),
      ...publicInventories.map((item) => ({
        kind: 'issue',
        date: item.record_date,
        item: { category: 'other', title: `[비품] ${item.name}`, area_id: item.area_id, received_date: item.record_date, status: 'completed' },
      })),
    ].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 10);
    $('#monthlyActivityList').className = activity.length ? 'compact-list' : 'compact-list empty-state';
    $('#monthlyActivityList').innerHTML = activity.length
      ? activity.map((entry) => entry.kind === 'head-office' ? compactHeadOfficeCheckHtml(entry.item) : compactItemHtml(entry.item)).join('')
      : '해당 월에 등록된 관리 기록이 없습니다.';
}

function showTab(tab) {
  state.activeTab = tab;
  $$('.app-view').forEach((view) => {
    const active = view.dataset.view === tab;
    view.hidden = !active;
    view.classList.toggle('active', active);
  });
  $$('[data-tab]').forEach((button) => button.classList.toggle('active', button.dataset.tab === tab));
  history.replaceState(null, '', `#${tab}`);
  requestRefresh();
}

function bindEvents() {
  $$('[data-tab]').forEach((button) => button.addEventListener('click', () => showTab(button.dataset.tab)));
  $$('[data-tab-link]').forEach((button) => button.addEventListener('click', () => showTab(button.dataset.tabLink)));

  $('#prevDay').addEventListener('click', () => {
    if (state.selectedDate > APP_START_DATE) {
      state.selectedDate = clampAppDate(addDays(state.selectedDate, -1));
      loadDaily();
    }
  });
  $('#nextDay').addEventListener('click', () => {
    if (state.selectedDate < appCurrentDate()) {
      state.selectedDate = clampAppDate(addDays(state.selectedDate, 1));
      loadDaily();
    }
  });
  $('#goToday').addEventListener('click', () => { state.selectedDate = appCurrentDate(); loadDaily(); });
  $('#datePickerButton').addEventListener('click', () => {
    const picker = $('#datePicker');
    if (typeof picker.showPicker === 'function') picker.showPicker(); else picker.click();
  });
  $('#datePicker').addEventListener('change', (event) => {
    if (!event.target.value) return;
    state.selectedDate = clampAppDate(event.target.value);
    loadDaily();
  });

  $('#prevMonth').addEventListener('click', () => {
    if (state.calendarMonth > APP_START_MONTH) {
      state.calendarMonth = clampAppMonth(shiftMonth(state.calendarMonth, -1));
      loadCalendar();
    }
  });
  $('#nextMonth').addEventListener('click', () => {
    if (state.calendarMonth < monthKey(appCurrentDate())) {
      state.calendarMonth = clampAppMonth(shiftMonth(state.calendarMonth, 1));
      loadCalendar();
    }
  });
  $('#reportPrevMonth').addEventListener('click', () => {
    if (state.reportMonth > APP_START_MONTH) {
      state.reportMonth = clampAppMonth(shiftMonth(state.reportMonth, -1));
      loadMonthlyReport();
    }
  });
  $('#reportNextMonth').addEventListener('click', () => {
    if (state.reportMonth < monthKey(appCurrentDate())) {
      state.reportMonth = clampAppMonth(shiftMonth(state.reportMonth, 1));
      loadMonthlyReport();
    }
  });
  $('#printReport').addEventListener('click', () => window.print());

  $$('[data-issue-filter]').forEach((button) => button.addEventListener('click', () => {
    state.issueFilter = button.dataset.issueFilter;
    $$('[data-issue-filter]').forEach((item) => item.classList.toggle('active', item === button));
    renderIssueList(state.issueFilter);
  }));
  $$('[data-close-modal]').forEach((button) => button.addEventListener('click', () => closeModal($('#detailModal'))));
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeModal($('#detailModal')); });
}

function currentSelection(){
  const today=appCurrentDate();
  if(today!==state.lastToday){
    if(state.selectedDate===state.lastToday)state.selectedDate=today;
    if(state.calendarMonth===monthKey(state.lastToday))state.calendarMonth=monthKey(today);
    if(state.reportMonth===monthKey(state.lastToday))state.reportMonth=monthKey(today);
    state.lastToday=today;updateHeaderDate();
  }
  return {activeTab:state.activeTab,selectedDate:state.selectedDate,calendarMonth:state.calendarMonth,reportMonth:state.reportMonth,today};
}

async function refreshVisibleData() {
  const selection=currentSelection(),snapshot=await loadViewerSnapshot(data,selection);
  if(viewerSelectionKey(selection)!==viewerSelectionKey(currentSelection()))return false;
  state.areas=snapshot.areas;state.allIssues=snapshot.issues;
  const badge=$('#issueTabCount'),openCount=snapshot.issues.filter(isOpenIssue).length;
  badge.textContent=openCount;badge.classList.toggle('hidden',!openCount);
  const signature=JSON.stringify(snapshot);
  if(renderedSnapshots.get(selection.activeTab)!==signature){
    const focused=document.activeElement?.dataset;
    switch(selection.activeTab){
      case 'today':renderDaily(snapshot);break;
      case 'calendar':renderCalendar(snapshot.inspections,selection.calendarMonth);break;
      case 'report':renderMonthlyReport(snapshot,selection.reportMonth);break;
      case 'issues':renderIssueList(state.issueFilter);break;
      case 'inventory':state.allInventories=snapshot.inventories;renderInventoryList();break;
      case 'head-office':state.allHeadOfficeChecks=snapshot.headOfficeChecks;renderHeadOfficeCheckList();break;
    }
    renderedSnapshots.set(selection.activeTab,signature);
    if(focused?.areaId&&focused.period&&!$('#detailModal').classList.contains('open')){
      $$('.inspection-cell').find(node=>node.dataset.areaId===focused.areaId&&node.dataset.period===focused.period)?.focus({preventScroll:true});
    }
  }
  return true;
}

function renderFreshness({status,lastSuccess,error}){
  const labels={loading:'새 기록 확인 중',fresh:'5초마다 자동 확인',paused:'화면으로 돌아오면 갱신',offline:'오프라인 · 연결 복구 후 갱신',error:'갱신 지연 · 자동 재시도 중'};
  const text=labels[status]||labels.loading;
  const timestamp=lastSuccess?new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(new Date(lastSuccess)):'';
  const indicator=$('#liveIndicator');indicator.className='live-indicator '+(['error','offline'].includes(status)?'error':status==='fresh'?'connected':'');
  indicator.querySelector('span').textContent=text;indicator.title=timestamp?'마지막 확인 '+timestamp:text;
  const statusNode=$('#viewerRefreshStatus');statusNode.dataset.status=status;
  $('#viewerRefreshText').textContent=text+(timestamp?' · 마지막 확인 '+timestamp:'');
  statusNode.title=error?.message||'';
  $('#refreshNow').disabled=status==='loading'||status==='offline';
  $$('.app-view').forEach(view=>view.setAttribute('aria-busy',String(status==='loading'&&view.dataset.view===state.activeTab)));
}

async function bootstrap() {
  registerServiceWorker();
  updateHeaderDate();
  bindEvents();
  const connection = await data.init();
  renderModeBanner(connection);
  const loginLink=$('#workLoginLink');
  if(connection.integration?.enabled){
    loginLink.href=connection.integration.staffUrl;
    loginLink.textContent='현장 직원 로그인';loginLink.setAttribute('aria-label','현장 직원 로그인');
  }else{
    loginLink.textContent='관리자';loginLink.setAttribute('aria-label','관리자 로그인');
  }

  const requestedTab = location.hash.slice(1);
  const normalizedTab = ['complaints', 'actions'].includes(requestedTab) ? 'issues' : requestedTab;
  const initialTab = ['today', 'calendar', 'issues', 'head-office', 'inventory', 'report'].includes(normalizedTab) ? normalizedTab : 'today';
  showTab(initialTab);

  liveRefresh=createLiveRefresh({refresh:refreshVisibleData,onState:renderFreshness});
  $('#refreshNow').addEventListener('click',requestRefresh);
  document.documentElement.dataset.appReady='true';
  await liveRefresh.start();
  if(!connection.integration?.enabled)data.subscribe(event=>{if(event.table!=='connection')requestRefresh();});

}

bootstrap().catch((error) => {
  console.error(error);
  document.documentElement.dataset.appReady = 'error';
  const banner = $('#setupBanner');
  banner.className = 'setup-banner error';
  banner.textContent = `페이지 초기화 중 오류가 발생했습니다: ${error.message || '알 수 없는 오류'}`;
});
