import { data } from './data.js';
import { initMemberAdmin, clearMemberAdmin } from './member-admin.js';
import {
  APP_START_DATE,
  PERIOD_META,
  addDays,
  appCurrentDate,
  categoryMeta,
  clampAppDate,
  debounce,
  escapeHtml,
  formatDateTime,
  formatKoreanDate,
  formatShortDate,
  headOfficeCheckTypeMeta,
  inventoryCategoryMeta,
  inventoryStatusMeta,
  isOpenIssue,
  issueStatusMeta,
  itemStatusMeta,
  nl2br,
  openModal,
  closeModal,
  priorityMeta,
  registerServiceWorker,
  safeArray,
  setBusy,
  showToast,
  statusMeta,
  weekdayLabel,
} from './common.js';

const state = {
  connection: null,
  session: null,
  profile: null,
  areas: [],
  selectedDate: appCurrentDate(),
  inspections: [],
  issues: [],
  inventories: [],
  headOfficeChecks: [],
  activeTab: 'inspections',
  issueFilter: 'open',
  inspectionPhotos: [],
  issuePhotos: [],
  inventoryPhotos: [],
  headOfficeCheckPhotos: [],
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

function areaById(id) {
  return state.areas.find((area) => Number(area.id) === Number(id));
}

function renderMode(connection) {
  const banner = $('#setupBanner');
  const demoButton = $('#demoLoginButton');
  if (connection.isDemo) {
    banner.classList.remove('hidden');
    demoButton.classList.remove('hidden');
    if (connection.configError) {
      banner.className = 'setup-banner error';
      banner.textContent = `${connection.configError} 관리자 화면은 데모 저장소로 실행됩니다.`;
    } else {
      banner.className = 'setup-banner';
      banner.textContent = '현재 데모 모드입니다. 입력 내용은 이 브라우저에만 저장되며 실제 운영 전 Supabase 연결이 필요합니다.';
    }
  } else {
    banner.classList.add('hidden');
    demoButton.classList.add('hidden');
  }
}

function showLogin(message = '') {
  clearMemberAdmin();
  $('#loginScreen').classList.remove('hidden');
  $('#adminApp').classList.add('hidden');
  $('#loginMessage').textContent = message;
}

function showAdminShell() {
  $('#loginScreen').classList.add('hidden');
  $('#adminApp').classList.remove('hidden');
  $('#adminName').textContent = state.profile.display_name || '관리자';
  $('#adminEmail').textContent = state.profile.email || '';
  const badge = $('#adminModeBadge');
  if (state.connection.isDemo) {
    badge.textContent = '데모 모드';
    badge.classList.add('demo');
  } else {
    badge.textContent = '실시간 운영 모드';
    badge.classList.remove('demo');
  }
}

async function authorizeCurrentSession() {
  const session = await data.getSession();
  if (!session?.user) {
    showLogin();
    return false;
  }
  const profile = await data.getAdminProfile();
  if (!profile) {
    await data.signOut();
    showLogin('승인된 관리자 계정이 아닙니다. Supabase의 app_admins 목록을 확인해 주세요.');
    return false;
  }
  state.session = session;
  state.profile = profile;
  showAdminShell();
  return true;
}

function updateDateLabels() {
  state.selectedDate = clampAppDate(state.selectedDate);
  const maximum = appCurrentDate();
  const picker = $('#adminDatePicker');
  $('#adminSelectedDateLabel').textContent = formatKoreanDate(state.selectedDate, { weekday: false });
  $('#adminSelectedDateSub').textContent = `${weekdayLabel(state.selectedDate)} 점검 입력`;
  picker.min = APP_START_DATE;
  picker.max = maximum;
  picker.value = state.selectedDate;
  $('#adminPrevDay').disabled = state.selectedDate <= APP_START_DATE;
  $('#adminNextDay').disabled = state.selectedDate >= maximum;
  $('#adminGoToday').classList.toggle('hidden', state.selectedDate === maximum);
}

function renderDailySummary() {
  const total = state.areas.length * 2;
  const input = state.inspections.length;
  const normal = state.inspections.filter((item) => item.status === 'normal').length;
  const attention = state.inspections.filter((item) => ['issue', 'in_progress'].includes(item.status)).length;
  const completion = state.inspections.filter((item) => item.status === 'completed').length;
  const remaining = Math.max(total - input, 0);
  $('#adminDailySummary').innerHTML = `
    <article class="summary-card success"><span class="summary-label"><i class="summary-icon">✓</i>입력 완료</span><strong>${input}<small>/${total}건</small></strong><p>미점검 ${remaining}건</p></article>
    <article class="summary-card"><span class="summary-label"><i class="summary-icon">○</i>정상</span><strong>${normal}<small>건</small></strong><p>이상 없이 점검 완료</p></article>
    <article class="summary-card ${attention ? 'warning' : ''}"><span class="summary-label"><i class="summary-icon">!</i>확인·조치 필요</span><strong>${attention}<small>건</small></strong><p>이상 발견 및 조치 중</p></article>
    <article class="summary-card"><span class="summary-label"><i class="summary-icon">↻</i>조치 완료</span><strong>${completion}<small>건</small></strong><p>문제 확인 후 마감</p></article>
  `;
}

function adminCellHtml(area, period, inspection) {
  const meta = statusMeta(inspection?.status);
  const checked = safeArray(inspection?.checked_items).length;
  const detail = inspection ? `${checked}/${safeArray(area.checklist).length}개 항목 · ${inspection.manager_name || '-'}` : '눌러서 점검 입력';
  return `
    <button class="inspection-cell ${meta.className}" type="button" data-area-id="${area.id}" data-period="${period}">
      <span class="status-symbol">${meta.icon}</span>
      <span class="cell-copy"><strong>${meta.label}</strong><small>${escapeHtml(detail)}</small></span>
      <span class="cell-arrow">›</span>
    </button>
  `;
}

function renderInspectionMatrix() {
  const map = new Map(state.inspections.map((item) => [`${item.area_id}-${item.period}`, item]));
  $('#adminInspectionMatrix').innerHTML = `
    <div class="matrix-header"><span>관리 공간</span><span>오전 점검</span><span>오후 점검</span></div>
    ${state.areas.map((area, index) => `
      <div class="matrix-row">
        <div class="matrix-area"><span class="area-index">${String(index + 1).padStart(2, '0')}</span><span>${escapeHtml(area.name)}</span></div>
        ${adminCellHtml(area, 'AM', map.get(`${area.id}-AM`))}
        ${adminCellHtml(area, 'PM', map.get(`${area.id}-PM`))}
      </div>
    `).join('')}
  `;
  $$('.inspection-cell', $('#adminInspectionMatrix')).forEach((button) => {
    button.addEventListener('click', () => openInspectionEditor(button.dataset.areaId, button.dataset.period));
  });
}

async function loadDay() {
  updateDateLabels();
  try {
    state.inspections = await data.getInspections({ start: state.selectedDate, end: state.selectedDate });
    renderDailySummary();
    renderInspectionMatrix();
  } catch (error) {
    console.error(error);
    $('#adminInspectionMatrix').innerHTML = `<div class="empty-state">점검 기록을 불러오지 못했습니다.<br>${escapeHtml(error.message || '')}</div>`;
  }
}

function renderPhotoPreview(container, paths, onRemove) {
  container.innerHTML = paths.map((path, index) => {
    const url = data.resolvePhotoUrl(path);
    return `<div class="photo-preview-item"><img src="${escapeHtml(url)}" alt="첨부 사진" /><button class="photo-remove" type="button" data-remove-photo="${index}" aria-label="사진 삭제">×</button></div>`;
  }).join('');
  $$('[data-remove-photo]', container).forEach((button) => button.addEventListener('click', () => onRemove(Number(button.dataset.removePhoto))));
}

function buildChecklistRow(item, checked, status) {
  return `
    <div class="check-item-row">
      <label class="check-item check-item-rich">
        <span class="check-item-main"><input type="checkbox" name="inspection-check" value="${escapeHtml(item)}" ${checked ? 'checked' : ''} /><span>${escapeHtml(item)}</span></span>
      </label>
      <select class="item-status-select" data-item-status="${escapeHtml(item)}">
        <option value="unchecked" ${status === 'unchecked' ? 'selected' : ''}>미점검</option>
        <option value="normal" ${status === 'normal' ? 'selected' : ''}>정상</option>
        <option value="issue" ${status === 'issue' ? 'selected' : ''}>이상 발견</option>
        <option value="in_progress" ${status === 'in_progress' ? 'selected' : ''}>조치 중</option>
        <option value="completed" ${status === 'completed' ? 'selected' : ''}>조치 완료</option>
      </select>
    </div>
  `;
}

function openInspectionEditor(areaId, period) {
  const area = areaById(areaId);
  const existing = state.inspections.find((item) => Number(item.area_id) === Number(areaId) && item.period === period);
  $('#inspectionModalTitle').textContent = `${area.name} ${PERIOD_META[period].label} 점검`;
  $('#inspectionModalSubtitle').textContent = `${formatKoreanDate(state.selectedDate)} · ${existing ? '기존 기록 수정' : '새 점검 입력'}`;
  $('#inspectionId').value = existing?.id || '';
  $('#inspectionAreaId').value = area.id;
  $('#inspectionPeriod').value = period;
  $('#inspectionStatus').value = existing?.status || 'normal';
  $('#inspectionManager').value = existing?.manager_name || '';
  $('#inspectionNote').value = existing?.note || '';
  $('#inspectionPhotos').value = '';
  state.inspectionPhotos = [...safeArray(existing?.photo_paths)];
  const checked = new Set(existing ? safeArray(existing.checked_items) : safeArray(area.checklist));
  const itemStatuses = existing?.item_statuses || {};
  $('#inspectionChecklist').innerHTML = safeArray(area.checklist).map((item) => buildChecklistRow(item, checked.has(item), itemStatuses[item] || (checked.has(item) ? 'normal' : 'unchecked'))).join('');
  refreshInspectionPhotos();
  $('#deleteInspectionButton').classList.toggle('hidden', !existing);
  openModal($('#inspectionModal'));
}

function refreshInspectionPhotos() {
  renderPhotoPreview($('#inspectionPhotoPreview'), state.inspectionPhotos, (index) => {
    state.inspectionPhotos.splice(index, 1);
    refreshInspectionPhotos();
  });
}

async function saveInspection(event) {
  event.preventDefault();
  const button = $('#saveInspectionButton');
  setBusy(button, true, '저장 중...');
  try {
    const selectedFiles = Array.from($('#inspectionPhotos').files || []);
    if (state.inspectionPhotos.length + selectedFiles.length > 3) throw new Error('사진은 기존 사진을 포함해 최대 3장까지 등록할 수 있습니다.');
    const uploaded = await data.uploadPhotos(selectedFiles);
    const checkedItems = $$('input[name="inspection-check"]:checked').map((input) => input.value);
    const itemStatuses = Object.fromEntries($$('[data-item-status]').map((select) => [select.dataset.itemStatus, select.value]));
    await data.upsertInspection({
      inspection_date: state.selectedDate,
      period: $('#inspectionPeriod').value,
      area_id: $('#inspectionAreaId').value,
      status: $('#inspectionStatus').value,
      checked_items: checkedItems,
      item_statuses: itemStatuses,
      note: $('#inspectionNote').value,
      photo_paths: [...state.inspectionPhotos, ...uploaded],
      manager_name: $('#inspectionManager').value.trim(),
    });
    closeModal($('#inspectionModal'));
    await loadDay();
    showToast('점검 기록을 저장했습니다.');
  } catch (error) {
    console.error(error);
    showToast(error.message || '점검 기록 저장에 실패했습니다.', 'error');
  } finally {
    setBusy(button, false);
  }
}

async function deleteCurrentInspection() {
  const id = $('#inspectionId').value;
  if (!id) return;
  if (!window.confirm('이 점검 기록을 삭제할까요? 삭제 후 열람 화면에서도 즉시 사라집니다.')) return;
  const button = $('#deleteInspectionButton');
  setBusy(button, true, '삭제 중...');
  try {
    await data.deleteInspection(id);
    closeModal($('#inspectionModal'));
    await loadDay();
    showToast('점검 기록을 삭제했습니다.');
  } catch (error) {
    console.error(error);
    showToast(error.message || '점검 기록 삭제에 실패했습니다.', 'error');
  } finally {
    setBusy(button, false);
  }
}

async function bulkNormal(period) {
  if (!window.confirm(`${PERIOD_META[period].label} 미점검 항목을 전체 정상으로 입력할까요?`)) return;
  try {
    const existingKeys = new Set(state.inspections.filter((item) => item.period === period).map((item) => `${item.area_id}-${item.period}`));
    await Promise.all(state.areas.filter((area) => !existingKeys.has(`${area.id}-${period}`)).map((area) => data.upsertInspection({
      inspection_date: state.selectedDate,
      period,
      area_id: area.id,
      status: 'normal',
      checked_items: safeArray(area.checklist),
      item_statuses: Object.fromEntries(safeArray(area.checklist).map((item) => [item, 'normal'])),
      note: '',
      photo_paths: [],
      manager_name: state.profile.display_name || '',
    })));
    await loadDay();
    showToast(`${PERIOD_META[period].label} 미점검 항목을 전체 정상으로 저장했습니다.`);
  } catch (error) {
    console.error(error);
    showToast(error.message || '일괄 저장에 실패했습니다.', 'error');
  }
}

function issueCardHtml(issue, { editable = true } = {}) {
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
        ${editable ? `<button class="card-edit-button" type="button" data-edit-issue="${issue.id}">수정</button>` : ''}
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

function headOfficeCheckCardHtml(item, { editable = true } = {}) {
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
        ${editable ? `<button class="card-edit-button" type="button" data-edit-head-office="${item.id}">수정</button>` : ''}
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

function inventoryCardHtml(item, { editable = true } = {}) {
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
        ${editable ? `<button class="card-edit-button" type="button" data-edit-inventory="${item.id}">수정</button>` : ''}
      </div>
      <div class="issue-card-meta">
        <span>공간 ${escapeHtml(area?.name || '공통·기타')}</span>
        <span>기준일 ${escapeHtml(formatShortDate(item.record_date))}</span>
        ${item.quantity ? `<span>수량 ${escapeHtml(item.quantity)}</span>` : ''}
      </div>
      <div class="issue-card-body">
        <p>${item.note ? nl2br(item.note) : '등록된 비고가 없습니다.'}</p>
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

function bindEditButtons() {
  $$('[data-edit-issue]').forEach((button) => {
    const issue = state.issues.find((item) => item.id === button.dataset.editIssue);
    button.addEventListener('click', () => openIssueEditor(issue?.category === 'complaint' ? 'complaint' : 'issue', issue));
  });
  $$('[data-edit-inventory]').forEach((button) => {
    const item = state.inventories.find((inventory) => inventory.id === button.dataset.editInventory);
    button.addEventListener('click', () => openInventoryEditor(item));
  });
  $$('[data-edit-head-office]').forEach((button) => {
    const item = state.headOfficeChecks.find((check) => check.id === button.dataset.editHeadOffice);
    button.addEventListener('click', () => openHeadOfficeCheckEditor(item));
  });
}

function renderIssueLists() {
  const issueFiltered = applyIssueFilter(state.issues, state.issueFilter);

  $('#adminIssueCount').textContent = `전체 ${state.issues.length}건`;
  $('#adminIssuesList').className = issueFiltered.length ? 'card-list' : 'card-list empty-state';
  $('#adminIssuesList').innerHTML = issueFiltered.length ? issueFiltered.map((item) => issueCardHtml(item)).join('') : '해당 조건의 조치·민원 기록이 없습니다.';
  $('#adminHeadOfficeChecksList').className = state.headOfficeChecks.length ? 'card-list' : 'card-list empty-state';
  $('#adminHeadOfficeChecksList').innerHTML = state.headOfficeChecks.length ? state.headOfficeChecks.map((item) => headOfficeCheckCardHtml(item)).join('') : '등록된 본사점검 기록이 없습니다.';
  $('#adminInventoryList').className = state.inventories.length ? 'card-list' : 'card-list empty-state';
  $('#adminInventoryList').innerHTML = state.inventories.length ? state.inventories.map((item) => inventoryCardHtml(item)).join('') : '등록된 시설·비품 현황이 없습니다.';
  bindEditButtons();
}

async function loadIssues() {
  try {
    state.issues = await data.getIssues({ start: APP_START_DATE, end: appCurrentDate() });
    renderIssueLists();
  } catch (error) {
    console.error(error);
    $('#adminIssuesList').innerHTML = '<div class="empty-state">조치·민원 기록을 불러오지 못했습니다.</div>';
  }
}

async function loadInventories() {
  try {
    state.inventories = await data.getInventories({ start: APP_START_DATE, end: appCurrentDate() });
    renderIssueLists();
  } catch (error) {
    console.error(error);
    $('#adminInventoryList').innerHTML = '<div class="empty-state">시설·비품 현황을 불러오지 못했습니다.</div>';
  }
}

async function loadHeadOfficeChecks() {
  try {
    state.headOfficeChecks = await data.getHeadOfficeChecks({ start: APP_START_DATE, end: appCurrentDate() });
    renderIssueLists();
  } catch (error) {
    console.error(error);
    $('#adminHeadOfficeChecksList').innerHTML = '<div class="empty-state">본사점검 기록을 불러오지 못했습니다.</div>';
  }
}

function refreshIssuePhotos() {
  renderPhotoPreview($('#issuePhotoPreview'), state.issuePhotos, (index) => {
    state.issuePhotos.splice(index, 1);
    refreshIssuePhotos();
  });
}

function openIssueEditor(type, issue = null) {
  const complaint = type === 'complaint' || issue?.category === 'complaint';
  $('#issueModalKicker').textContent = complaint ? 'COMPLAINTS' : 'ACTION TRACKER';
  $('#issueModalTitle').textContent = issue ? (complaint ? '민원 기록 수정' : '조치업무 수정') : (complaint ? '민원 등록' : '조치업무 등록');
  $('#issueModalSubtitle').textContent = complaint ? '개인정보를 제외한 민원 요약과 처리상태를 기록합니다.' : '발견부터 완료까지 진행상황을 기록합니다.';
  $('#issueId').value = issue?.id || '';
  $('#issueCategory').value = complaint ? 'complaint' : (issue?.category || 'facility');
  $('#issueCategory').disabled = complaint;
  $('#issueCategoryField').classList.toggle('hidden', complaint);
  const maximum = appCurrentDate();
  const receivedDate = clampAppDate(issue?.received_date || maximum);
  $('#issueReceivedDate').min = APP_START_DATE;
  $('#issueReceivedDate').max = maximum;
  $('#issueReceivedDate').value = receivedDate;
  $('#issueDueDate').min = receivedDate;
  $('#issueAreaId').value = issue?.area_id || '';
  $('#issueStatus').value = issue?.status || 'received';
  $('#issuePriority').value = issue?.priority || 'normal';
  $('#issueDueDate').value = issue?.due_date && issue.due_date >= receivedDate ? issue.due_date : '';
  $('#issueIsPublic').checked = issue?.is_public !== false;
  $('#issueTitleLabel').innerHTML = `${complaint ? '민원 제목' : '업무 제목'} <b>*</b>`;
  $('#issueDescriptionLabel').innerHTML = `${complaint ? '민원 내용' : '발견 내용'} <b>*</b>`;
  $('#issueTitle').placeholder = complaint ? '예: 여자 탈의실 드라이기 점검 요청' : '예: 11번 러닝머신 화면 비율 이상';
  $('#issueTitle').value = issue?.title || '';
  $('#issueDescription').value = issue?.description || '';
  $('#issueActionNote').value = issue?.action_note || '';
  $('#issuePhotos').value = '';
  state.issuePhotos = [...safeArray(issue?.photo_paths)];
  refreshIssuePhotos();
  $('#deleteIssueButton').classList.toggle('hidden', !issue);
  openModal($('#issueModal'));
}

async function saveIssue(event) {
  event.preventDefault();
  const button = $('#saveIssueButton');
  setBusy(button, true, '저장 중...');
  try {
    const selectedFiles = Array.from($('#issuePhotos').files || []);
    if (state.issuePhotos.length + selectedFiles.length > 3) throw new Error('사진은 기존 사진을 포함해 최대 3장까지 등록할 수 있습니다.');
    const uploaded = await data.uploadPhotos(selectedFiles);
    await data.saveIssue({
      id: $('#issueId').value || null,
      category: $('#issueCategory').value,
      received_date: $('#issueReceivedDate').value,
      area_id: $('#issueAreaId').value || null,
      status: $('#issueStatus').value,
      priority: $('#issuePriority').value,
      due_date: $('#issueDueDate').value || null,
      is_public: $('#issueIsPublic').checked,
      title: $('#issueTitle').value,
      description: $('#issueDescription').value,
      action_note: $('#issueActionNote').value,
      photo_paths: [...state.issuePhotos, ...uploaded],
      manager_name: state.profile.display_name || '',
    });
    closeModal($('#issueModal'));
    await loadIssues();
    showToast('관리 기록을 저장했습니다.');
  } catch (error) {
    console.error(error);
    showToast(error.message || '저장에 실패했습니다.', 'error');
  } finally {
    setBusy(button, false);
  }
}

async function deleteCurrentIssue() {
  const id = $('#issueId').value;
  if (!id) return;
  if (!window.confirm('이 기록을 삭제할까요? 열람 화면에서도 즉시 사라집니다.')) return;
  const button = $('#deleteIssueButton');
  setBusy(button, true, '삭제 중...');
  try {
    await data.deleteIssue(id);
    closeModal($('#issueModal'));
    await loadIssues();
    showToast('기록을 삭제했습니다.');
  } catch (error) {
    showToast(error.message || '삭제에 실패했습니다.', 'error');
  } finally {
    setBusy(button, false);
  }
}

function refreshHeadOfficeCheckPhotos() {
  renderPhotoPreview($('#headOfficeCheckPhotoPreview'), state.headOfficeCheckPhotos, (index) => {
    state.headOfficeCheckPhotos.splice(index, 1);
    refreshHeadOfficeCheckPhotos();
  });
}

function openHeadOfficeCheckEditor(item = null) {
  const maximum = appCurrentDate();
  $('#headOfficeCheckModalTitle').textContent = item ? '본사점검 기록 수정' : '본사점검 등록';
  $('#headOfficeCheckModalSubtitle').textContent = '관련 공간은 전체, 상태는 완료로 고정됩니다.';
  $('#headOfficeCheckId').value = item?.id || '';
  $('#headOfficeCheckDate').min = APP_START_DATE;
  $('#headOfficeCheckDate').max = maximum;
  $('#headOfficeCheckDate').value = clampAppDate(item?.check_date || state.selectedDate || maximum);
  $('#headOfficeCheckType').value = item?.check_type || 'onsite';
  $('#headOfficeCheckScope').value = '전체';
  $('#headOfficeCheckStatus').value = '완료';
  $('#headOfficeCheckManager').value = item?.manager_name || '';
  $('#headOfficeCheckTitle').value = item?.title || '';
  $('#headOfficeCheckResult').value = item?.result || '';
  $('#headOfficeCheckFollowUp').value = item?.follow_up || '';
  $('#headOfficeCheckPhotos').value = '';
  state.headOfficeCheckPhotos = [...safeArray(item?.photo_paths)];
  refreshHeadOfficeCheckPhotos();
  $('#deleteHeadOfficeCheckButton').classList.toggle('hidden', !item);
  openModal($('#headOfficeCheckModal'));
}

async function saveHeadOfficeCheck(event) {
  event.preventDefault();
  const button = $('#saveHeadOfficeCheckButton');
  setBusy(button, true, '저장 중...');
  try {
    const selectedFiles = Array.from($('#headOfficeCheckPhotos').files || []);
    if (state.headOfficeCheckPhotos.length + selectedFiles.length > 3) throw new Error('사진은 기존 사진을 포함해 최대 3장까지 등록할 수 있습니다.');
    const uploaded = await data.uploadPhotos(selectedFiles);
    await data.saveHeadOfficeCheck({
      id: $('#headOfficeCheckId').value || null,
      check_date: $('#headOfficeCheckDate').value,
      check_type: $('#headOfficeCheckType').value,
      title: $('#headOfficeCheckTitle').value,
      result: $('#headOfficeCheckResult').value,
      follow_up: $('#headOfficeCheckFollowUp').value,
      photo_paths: [...state.headOfficeCheckPhotos, ...uploaded],
      manager_name: $('#headOfficeCheckManager').value.trim(),
    });
    closeModal($('#headOfficeCheckModal'));
    await loadHeadOfficeChecks();
    showToast('본사점검 기록을 저장했습니다.');
  } catch (error) {
    console.error(error);
    showToast(error.message || '본사점검 기록 저장에 실패했습니다.', 'error');
  } finally {
    setBusy(button, false);
  }
}

async function deleteCurrentHeadOfficeCheck() {
  const id = $('#headOfficeCheckId').value;
  if (!id) return;
  if (!window.confirm('이 본사점검 기록을 삭제할까요?')) return;
  const button = $('#deleteHeadOfficeCheckButton');
  setBusy(button, true, '삭제 중...');
  try {
    await data.deleteHeadOfficeCheck(id);
    closeModal($('#headOfficeCheckModal'));
    await loadHeadOfficeChecks();
    showToast('본사점검 기록을 삭제했습니다.');
  } catch (error) {
    console.error(error);
    showToast(error.message || '삭제에 실패했습니다.', 'error');
  } finally {
    setBusy(button, false);
  }
}

function refreshInventoryPhotos() {
  renderPhotoPreview($('#inventoryPhotoPreview'), state.inventoryPhotos, (index) => {
    state.inventoryPhotos.splice(index, 1);
    refreshInventoryPhotos();
  });
}

function openInventoryEditor(item = null) {
  const maximum = appCurrentDate();
  $('#inventoryModalTitle').textContent = item ? '시설·비품 기록 수정' : '시설·비품 등록';
  $('#inventoryModalSubtitle').textContent = '시설 및 비품의 현황을 기록하고 공개 여부를 설정합니다.';
  $('#inventoryId').value = item?.id || '';
  $('#inventoryRecordDate').min = APP_START_DATE;
  $('#inventoryRecordDate').max = maximum;
  $('#inventoryRecordDate').value = clampAppDate(item?.record_date || state.selectedDate || maximum);
  $('#inventoryCategory').value = item?.category || 'facility';
  $('#inventoryAreaId').value = item?.area_id || '';
  $('#inventoryStatus').value = item?.status || 'normal';
  $('#inventoryManager').value = item?.manager_name || '';
  $('#inventoryQuantity').value = item?.quantity || '';
  $('#inventoryIsPublic').checked = item?.is_public !== false;
  $('#inventoryName').value = item?.name || '';
  $('#inventoryNote').value = item?.note || '';
  $('#inventoryPhotos').value = '';
  state.inventoryPhotos = [...safeArray(item?.photo_paths)];
  refreshInventoryPhotos();
  $('#deleteInventoryButton').classList.toggle('hidden', !item);
  openModal($('#inventoryModal'));
}

async function saveInventory(event) {
  event.preventDefault();
  const button = $('#saveInventoryButton');
  setBusy(button, true, '저장 중...');
  try {
    const selectedFiles = Array.from($('#inventoryPhotos').files || []);
    if (state.inventoryPhotos.length + selectedFiles.length > 3) throw new Error('사진은 기존 사진을 포함해 최대 3장까지 등록할 수 있습니다.');
    const uploaded = await data.uploadPhotos(selectedFiles);
    await data.saveInventory({
      id: $('#inventoryId').value || null,
      record_date: $('#inventoryRecordDate').value,
      category: $('#inventoryCategory').value,
      area_id: $('#inventoryAreaId').value || null,
      status: $('#inventoryStatus').value,
      quantity: $('#inventoryQuantity').value,
      is_public: $('#inventoryIsPublic').checked,
      name: $('#inventoryName').value,
      note: $('#inventoryNote').value,
      photo_paths: [...state.inventoryPhotos, ...uploaded],
      manager_name: $('#inventoryManager').value.trim(),
    });
    closeModal($('#inventoryModal'));
    await loadInventories();
    showToast('시설·비품 현황을 저장했습니다.');
  } catch (error) {
    console.error(error);
    showToast(error.message || '시설·비품 현황 저장에 실패했습니다.', 'error');
  } finally {
    setBusy(button, false);
  }
}

async function deleteCurrentInventory() {
  const id = $('#inventoryId').value;
  if (!id) return;
  if (!window.confirm('이 시설·비품 기록을 삭제할까요?')) return;
  const button = $('#deleteInventoryButton');
  setBusy(button, true, '삭제 중...');
  try {
    await data.deleteInventory(id);
    closeModal($('#inventoryModal'));
    await loadInventories();
    showToast('시설·비품 기록을 삭제했습니다.');
  } catch (error) {
    console.error(error);
    showToast(error.message || '삭제에 실패했습니다.', 'error');
  } finally {
    setBusy(button, false);
  }
}

function showAdminTab(tab) {
  state.activeTab = tab;
  $$('.admin-view').forEach((view) => {
    const active = view.dataset.adminView === tab;
    view.hidden = !active;
    view.classList.toggle('active', active);
  });
  $$('[data-admin-tab]').forEach((button) => button.classList.toggle('active', button.dataset.adminTab === tab));
  if (tab !== 'inspections') renderIssueLists();
}

function bindEvents() {
  $('#loginForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = $('#loginButton');
    setBusy(button, true, '로그인 중...');
    $('#loginMessage').textContent = '';
    try {
      await data.signIn($('#loginEmail').value.trim(), $('#loginPassword').value);
      const authorized = await authorizeCurrentSession();
      if (authorized) await startAdminApp();
    } catch (error) {
      $('#loginMessage').textContent = error.message || '로그인에 실패했습니다.';
    } finally {
      setBusy(button, false);
    }
  });

  $('#demoLoginButton').addEventListener('click', async () => {
    await data.enterDemoAdmin();
    const authorized = await authorizeCurrentSession();
    if (authorized) await startAdminApp();
  });

  $('#logoutButton').addEventListener('click', async () => {
    await data.signOut();
    state.session = null;
    state.profile = null;
    showLogin();
  });

  $$('[data-admin-tab]').forEach((button) => button.addEventListener('click', () => showAdminTab(button.dataset.adminTab)));

  $('#adminPrevDay').addEventListener('click', () => {
    if (state.selectedDate > APP_START_DATE) {
      state.selectedDate = clampAppDate(addDays(state.selectedDate, -1));
      loadDay();
    }
  });
  $('#adminNextDay').addEventListener('click', () => {
    if (state.selectedDate < appCurrentDate()) {
      state.selectedDate = clampAppDate(addDays(state.selectedDate, 1));
      loadDay();
    }
  });
  $('#adminGoToday').addEventListener('click', () => { state.selectedDate = appCurrentDate(); loadDay(); });
  $('#adminDateButton').addEventListener('click', () => {
    const picker = $('#adminDatePicker');
    if (typeof picker.showPicker === 'function') picker.showPicker(); else picker.click();
  });
  $('#adminDatePicker').addEventListener('change', (event) => {
    if (!event.target.value) return;
    state.selectedDate = clampAppDate(event.target.value);
    loadDay();
  });

  $('#issueReceivedDate').addEventListener('change', (event) => {
    const receivedDate = clampAppDate(event.target.value);
    event.target.value = receivedDate;
    const due = $('#issueDueDate');
    due.min = receivedDate;
    if (due.value && due.value < receivedDate) due.value = '';
  });

  $('#bulkAmNormal').addEventListener('click', () => bulkNormal('AM'));
  $('#bulkPmNormal').addEventListener('click', () => bulkNormal('PM'));

  $('#inspectionForm').addEventListener('submit', saveInspection);
  $('#deleteInspectionButton').addEventListener('click', deleteCurrentInspection);
  $$('[data-close-inspection]').forEach((button) => button.addEventListener('click', () => closeModal($('#inspectionModal'))));

  $('#addIssueButton').addEventListener('click', () => openIssueEditor('issue'));
  $('#addComplaintButton').addEventListener('click', () => openIssueEditor('complaint'));
  $('#issueForm').addEventListener('submit', saveIssue);
  $('#deleteIssueButton').addEventListener('click', deleteCurrentIssue);
  $$('[data-close-issue]').forEach((button) => button.addEventListener('click', () => closeModal($('#issueModal'))));

  $('#addHeadOfficeCheckButton').addEventListener('click', () => openHeadOfficeCheckEditor());
  $('#headOfficeCheckForm').addEventListener('submit', saveHeadOfficeCheck);
  $('#deleteHeadOfficeCheckButton').addEventListener('click', deleteCurrentHeadOfficeCheck);
  $$('[data-close-head-office]').forEach((button) => button.addEventListener('click', () => closeModal($('#headOfficeCheckModal'))));

  $('#addInventoryButton').addEventListener('click', () => openInventoryEditor());
  $('#inventoryForm').addEventListener('submit', saveInventory);
  $('#deleteInventoryButton').addEventListener('click', deleteCurrentInventory);
  $$('[data-close-inventory]').forEach((button) => button.addEventListener('click', () => closeModal($('#inventoryModal'))));

  $$('[data-admin-issue-filter]').forEach((button) => button.addEventListener('click', () => {
    state.issueFilter = button.dataset.adminIssueFilter;
    $$('[data-admin-issue-filter]').forEach((item) => item.classList.toggle('active', item === button));
    renderIssueLists();
  }));
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeModal($('#inspectionModal'));
      closeModal($('#issueModal'));
      closeModal($('#headOfficeCheckModal'));
      closeModal($('#inventoryModal'));
    }
  });
}

let appStarted = false;
async function startAdminApp() {
  if (!state.connection.isDemo) initMemberAdmin();
  if (!state.areas.length) {
    state.areas = await data.getAreas();
    const options = '<option value="">공통·기타</option>' + state.areas.map((area) => `<option value="${area.id}">${escapeHtml(area.name)}</option>`).join('');
    $('#issueAreaId').innerHTML = options;
    $('#inventoryAreaId').innerHTML = options;
  }
  await Promise.all([loadDay(), loadIssues(), loadHeadOfficeChecks(), loadInventories()]);
  if (appStarted) return;
  appStarted = true;
  const indicator = $('#adminLiveIndicator');
  const refresh = debounce(async () => {
    if (state.activeTab === 'inspections') await loadDay();
    await Promise.all([loadIssues(), loadHeadOfficeChecks(), loadInventories()]);
  }, 180);
  data.subscribe((event) => {
    if (event.table === 'connection') {
      if (event.status === 'SUBSCRIBED') {
        indicator.className = 'live-indicator dark connected';
        indicator.querySelector('span').textContent = '실시간 연결됨';
      } else if (event.status === 'DEMO') {
        indicator.className = 'live-indicator dark demo';
        indicator.querySelector('span').textContent = '데모 모드';
      } else if (event.status === 'CHANNEL_ERROR' || event.status === 'TIMED_OUT') {
        indicator.className = 'live-indicator dark error';
        indicator.querySelector('span').textContent = '재연결 중';
      }
      return;
    }
    refresh();
  });
}

async function bootstrap() {
  registerServiceWorker();
  bindEvents();
  state.connection = await data.init();
  renderMode(state.connection);
  document.documentElement.dataset.appReady = 'true';
  const authorized = await authorizeCurrentSession();
  if (authorized) await startAdminApp();
}

bootstrap().catch((error) => {
  console.error(error);
  document.documentElement.dataset.appReady = 'error';
  showLogin(`초기화 중 오류가 발생했습니다: ${error.message || '알 수 없는 오류'}`);
});
