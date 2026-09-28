import { APP_START_DATE, AREA_FALLBACK, appCurrentDate, safeArray, uuid } from './common.js';

const DEMO_STORE_KEY = 'onesports-management-demo-v6';
const DEMO_ADMIN_KEY = 'onesports-management-demo-admin';
const PHOTO_BUCKET = 'management-photos';

const memoryStorage = new Map();

function storageGet(key) {
  try { return window.localStorage.getItem(key); }
  catch { return memoryStorage.has(key) ? memoryStorage.get(key) : null; }
}

function storageSet(key, value) {
  const text = String(value);
  try { window.localStorage.setItem(key, text); }
  catch { memoryStorage.set(key, text); }
}

function storageRemove(key) {
  try { window.localStorage.removeItem(key); }
  catch { memoryStorage.delete(key); }
}

let mode = 'initializing';
let supabase = null;
let configError = '';
let initialized = false;

function nowIso() {
  return new Date().toISOString();
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function getFallbackConfig() {
  const config = window.ONESPORTS_CONFIG || {};
  return {
    supabaseUrl: config.supabaseUrl || config.SUPABASE_URL || '',
    supabasePublishableKey: config.supabasePublishableKey || config.SUPABASE_PUBLISHABLE_KEY || config.supabaseAnonKey || '',
  };
}

async function fetchRuntimeConfig() {
  const fallback = getFallbackConfig();
  if (!location.protocol.startsWith('http')) return fallback;
  try {
    const response = await fetch('/api/config', { cache: 'no-store' });
    if (!response.ok) return fallback;
    const runtime = await response.json();
    return {
      supabaseUrl: runtime.supabaseUrl || fallback.supabaseUrl,
      supabasePublishableKey: runtime.supabasePublishableKey || fallback.supabasePublishableKey,
    };
  } catch {
    return fallback;
  }
}

function defaultItemStatuses(area, partial = false) {
  return Object.fromEntries((area?.checklist || []).map((item, index) => [item, partial && index === 0 ? 'issue' : 'normal']));
}

function generateDemoStore() {
  const today = appCurrentDate();
  const timestamp = nowIso();
  const inspections = [];
  AREA_FALLBACK.forEach((area, index) => {
    inspections.push({
      id: uuid(),
      inspection_date: today,
      period: 'AM',
      area_id: area.id,
      status: index === 1 ? 'issue' : 'normal',
      checked_items: area.checklist.slice(0, area.checklist.length),
      item_statuses: defaultItemStatuses(area, index === 1),
      note: index === 1 ? '11번 러닝머신 점검 중 화면 비율 이상 현상을 확인했습니다.' : '',
      photo_paths: [],
      manager_name: index < 6 ? '오전 관리자' : '센터장',
      created_at: timestamp,
      updated_at: timestamp,
    });
  });
  AREA_FALLBACK.slice(0, 8).forEach((area, index) => {
    inspections.push({
      id: uuid(),
      inspection_date: today,
      period: 'PM',
      area_id: area.id,
      status: index === 3 ? 'in_progress' : 'normal',
      checked_items: area.checklist.slice(0, area.checklist.length),
      item_statuses: defaultItemStatuses(area, index === 3),
      note: index === 3 ? '스크린골프장 1번 센서 반응을 추가 확인 중입니다.' : '',
      photo_paths: [],
      manager_name: '오후 관리자',
      created_at: timestamp,
      updated_at: timestamp,
    });
  });

  return {
    version: 6,
    areas: deepClone(AREA_FALLBACK),
    inspections,
    issues: [
      {
        id: uuid(), category: 'facility', area_id: 2, title: '11번 러닝머신 화면 비율 확대',
        description: '셋톱박스 해체 후에도 화면 비율 확대 현상이 지속되어 제조사 확인이 필요합니다.',
        status: 'in_progress', priority: 'normal', received_date: today, due_date: '',
        action_note: '디렉스 A/S 접수 및 방문 일정 조율 중입니다.',
        photo_paths: [], is_public: true, manager_name: '센터장', created_at: timestamp, updated_at: timestamp,
      },
      {
        id: uuid(), category: 'complaint', area_id: 11, title: '여자 탈의실 드라이기 점검 요청',
        description: '드라이기 한 대의 바람 세기가 약하다는 이용자 의견이 접수되었습니다.',
        status: 'reviewing', priority: 'normal', received_date: today, due_date: '',
        action_note: '관리자가 작동 상태를 확인 중입니다.',
        photo_paths: [], is_public: true, manager_name: '센터장', created_at: timestamp, updated_at: timestamp,
      },
    ],
    inventories: [
      {
        id: uuid(),
        record_date: today,
        area_id: 1,
        category: 'equipment',
        name: '로비 안내 배너',
        quantity: '1개',
        status: 'normal',
        note: '정상 비치 중',
        photo_paths: [],
        is_public: true,
        manager_name: '센터장',
        created_at: timestamp,
        updated_at: timestamp,
      },
      {
        id: uuid(),
        record_date: today,
        area_id: 12,
        category: 'supply',
        name: '화장실 휴지',
        quantity: '2박스',
        status: 'low',
        note: '오후 추가 보충 예정',
        photo_paths: [],
        is_public: true,
        manager_name: '오전 관리자',
        created_at: timestamp,
        updated_at: timestamp,
      },
    ],
    headOfficeChecks: [
      {
        id: uuid(),
        check_date: today,
        check_type: 'onsite',
        scope: 'all',
        status: 'completed',
        title: '본사 정기 현장점검',
        result: '센터 전 공간의 청결, 시설 작동상태 및 안전관리 현황을 확인했습니다.',
        follow_up: '특이사항은 조치·민원 관리 메뉴에서 후속 관리합니다.',
        photo_paths: [],
        manager_name: '본사 관리자',
        created_at: timestamp,
        updated_at: timestamp,
      },
    ],
  };
}

function loadDemoStore() {
  let store;
  try {
    store = JSON.parse(storageGet(DEMO_STORE_KEY) || 'null');
  } catch {
    store = null;
  }
  if (!store || store.version !== 6) {
    store = generateDemoStore();
    saveDemoStore(store);
  }
  if (!Array.isArray(store.inventories)) store.inventories = [];
  if (!Array.isArray(store.headOfficeChecks)) store.headOfficeChecks = [];
  return store;
}

function saveDemoStore(store) {
  storageSet(DEMO_STORE_KEY, JSON.stringify(store));
  window.dispatchEvent(new CustomEvent('onesports-demo-change'));
}

function demoFilterDate(items, field, start, end) {
  return items.filter((item) => (!start || item[field] >= start) && (!end || item[field] <= end));
}

function normalizeDateRange(start, end) {
  const maximum = appCurrentDate();
  const safeStart = !start || start < APP_START_DATE ? APP_START_DATE : String(start).slice(0, 10);
  const safeEnd = !end || end > maximum ? maximum : String(end).slice(0, 10);
  return { start: safeStart, end: safeEnd, empty: safeEnd < safeStart };
}

function assertOperationalDate(value, label = '날짜') {
  const date = String(value || '').slice(0, 10);
  if (!date || date < APP_START_DATE) {
    throw new Error(`${label}는 2026년 9월 1일 이후로 선택해 주세요.`);
  }
  if (date > appCurrentDate()) {
    throw new Error(`${label}는 현재 관리 가능일보다 이후로 선택할 수 없습니다.`);
  }
  return date;
}

function withTimeout(promise, milliseconds, message) {
  return Promise.race([
    promise,
    new Promise((_, reject) => window.setTimeout(() => reject(new Error(message)), milliseconds)),
  ]);
}

async function loadSupabaseModule() {
  const sources = [
    'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm',
    'https://esm.sh/@supabase/supabase-js@2',
  ];
  let lastError = null;
  for (const source of sources) {
    try {
      return await withTimeout(import(source), 10000, 'Supabase 라이브러리 불러오기 시간 초과');
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('Supabase 라이브러리를 불러오지 못했습니다.');
}

async function initSupabase(config) {
  const module = await loadSupabaseModule();
  const createClient = module.createClient || module.default?.createClient;
  if (typeof createClient !== 'function') throw new Error('Supabase createClient 함수를 찾지 못했습니다.');
  supabase = createClient(config.supabaseUrl.trim(), config.supabasePublishableKey.trim(), {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    global: { fetch: (input, options = {}) => fetch(input, { ...options, cache: 'no-store' }) },
  });
}

async function init() {
  if (initialized) return state();
  const config = await fetchRuntimeConfig();
  if (config.supabaseUrl && config.supabasePublishableKey) {
    try {
      await initSupabase(config);
      mode = 'supabase';
    } catch (error) {
      configError = `Supabase 클라이언트 연결 실패: ${error?.message || '알 수 없는 오류'}`;
      mode = 'error';
      throw new Error(configError + ' 실제 저장이 중단되었습니다. 연결을 확인해 주세요.');
    }
  } else {
    const localDemo = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)
      && new URLSearchParams(location.search).get('demo') === '1';
    if (!localDemo) {
      mode = 'error';
      throw new Error('운영 DB 연결 설정을 불러오지 못했습니다. 저장되지 않았습니다. 관리자에게 문의해 주세요.');
    }
    mode = 'demo';
    loadDemoStore();
  }
  initialized = true;
  return state();
}

function state() {
  return {
    mode,
    isDemo: mode !== 'supabase',
    isSupabase: mode === 'supabase',
    configError,
  };
}

async function getAreas() {
  await init();
  if (mode !== 'supabase') return deepClone(loadDemoStore().areas).sort((a, b) => a.sort_order - b.sort_order);
  const { data, error } = await supabase.from('areas').select('*').eq('active', true).order('sort_order');
  if (error) throw error;
  return data || [];
}

async function getInspections({ start, end } = {}) {
  await init();
  const range = normalizeDateRange(start, end);
  if (range.empty) return [];
  if (mode !== 'supabase') {
    return deepClone(demoFilterDate(loadDemoStore().inspections, 'inspection_date', range.start, range.end));
  }
  const { data, error } = await supabase
    .from('inspections')
    .select('*')
    .gte('inspection_date', range.start)
    .lte('inspection_date', range.end)
    .order('inspection_date')
    .order('period');
  if (error) throw error;
  return data || [];
}

async function upsertInspection(payload) {
  await init();
  const record = {
    inspection_date: assertOperationalDate(payload.inspection_date, '점검일'),
    period: payload.period,
    area_id: Number(payload.area_id),
    status: payload.status,
    checked_items: safeArray(payload.checked_items),
    item_statuses: payload.item_statuses || {},
    note: payload.note || '',
    photo_paths: safeArray(payload.photo_paths),
    manager_name: (payload.manager_name || '').trim(),
  };
  if (mode !== 'supabase') {
    const store = loadDemoStore();
    const index = store.inspections.findIndex((item) => item.inspection_date === record.inspection_date && item.period === record.period && Number(item.area_id) === record.area_id);
    const timestamp = nowIso();
    if (index >= 0) {
      store.inspections[index] = { ...store.inspections[index], ...record, updated_at: timestamp };
      saveDemoStore(store);
      return deepClone(store.inspections[index]);
    }
    const created = { id: uuid(), ...record, created_at: timestamp, updated_at: timestamp };
    store.inspections.push(created);
    saveDemoStore(store);
    return deepClone(created);
  }
  const { data, error } = await supabase
    .from('inspections')
    .upsert(record, { onConflict: 'inspection_date,period,area_id' })
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function deleteInspection(id) {
  await init();
  if (mode !== 'supabase') {
    const store = loadDemoStore();
    store.inspections = store.inspections.filter((item) => item.id !== id);
    saveDemoStore(store);
    return;
  }
  const { error } = await supabase.from('inspections').delete().eq('id', id);
  if (error) throw error;
}

async function getIssues({ start, end, category } = {}) {
  await init();
  const range = normalizeDateRange(start, end);
  if (range.empty) return [];
  if (mode !== 'supabase') {
    let items = demoFilterDate(loadDemoStore().issues, 'received_date', range.start, range.end);
    if (category) items = items.filter((item) => item.category === category);
    return deepClone(items).sort((a, b) => `${b.received_date}${b.created_at}`.localeCompare(`${a.received_date}${a.created_at}`));
  }
  let query = supabase
    .from('issues')
    .select('*')
    .gte('received_date', range.start)
    .lte('received_date', range.end)
    .order('received_date', { ascending: false })
    .order('created_at', { ascending: false });
  if (category) query = query.eq('category', category);
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

async function saveIssue(payload) {
  await init();
  const record = {
    category: payload.category || 'other',
    area_id: payload.area_id ? Number(payload.area_id) : null,
    title: payload.title.trim(),
    description: payload.description.trim(),
    status: payload.status || 'received',
    priority: payload.priority || 'normal',
    received_date: assertOperationalDate(payload.received_date, '발생·접수일'),
    due_date: payload.due_date || null,
    action_note: payload.action_note?.trim() || '',
    photo_paths: safeArray(payload.photo_paths),
    is_public: payload.is_public !== false,
    manager_name: (payload.manager_name || '').trim(),
  };
  if (record.status === 'completed') record.completed_at = nowIso();
  else record.completed_at = null;

  if (mode !== 'supabase') {
    const store = loadDemoStore();
    const timestamp = nowIso();
    if (payload.id) {
      const index = store.issues.findIndex((item) => item.id === payload.id);
      if (index < 0) throw new Error('수정할 기록을 찾을 수 없습니다.');
      store.issues[index] = { ...store.issues[index], ...record, updated_at: timestamp };
      saveDemoStore(store);
      return deepClone(store.issues[index]);
    }
    const created = { id: uuid(), ...record, created_at: timestamp, updated_at: timestamp };
    store.issues.push(created);
    saveDemoStore(store);
    return deepClone(created);
  }

  if (payload.id) {
    const { data, error } = await supabase.from('issues').update(record).eq('id', payload.id).select().single();
    if (error) throw error;
    return data;
  }
  const { data, error } = await supabase.from('issues').insert(record).select().single();
  if (error) throw error;
  return data;
}

async function deleteIssue(id) {
  await init();
  if (mode !== 'supabase') {
    const store = loadDemoStore();
    store.issues = store.issues.filter((item) => item.id !== id);
    saveDemoStore(store);
    return;
  }
  const { error } = await supabase.from('issues').delete().eq('id', id);
  if (error) throw error;
}

async function getInventories({ start, end } = {}) {
  await init();
  const range = normalizeDateRange(start, end);
  if (range.empty) return [];
  if (mode !== 'supabase') {
    return deepClone(demoFilterDate(loadDemoStore().inventories, 'record_date', range.start, range.end))
      .sort((a, b) => `${b.record_date}${b.created_at}`.localeCompare(`${a.record_date}${a.created_at}`));
  }
  const { data, error } = await supabase
    .from('inventories')
    .select('*')
    .gte('record_date', range.start)
    .lte('record_date', range.end)
    .order('record_date', { ascending: false })
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

async function saveInventory(payload) {
  await init();
  const record = {
    record_date: assertOperationalDate(payload.record_date, '기준일'),
    area_id: payload.area_id ? Number(payload.area_id) : null,
    category: payload.category || 'other',
    name: payload.name.trim(),
    quantity: payload.quantity?.trim() || '',
    status: payload.status || 'normal',
    note: payload.note?.trim() || '',
    photo_paths: safeArray(payload.photo_paths),
    is_public: payload.is_public !== false,
    manager_name: (payload.manager_name || '').trim(),
  };
  if (mode !== 'supabase') {
    const store = loadDemoStore();
    const timestamp = nowIso();
    if (payload.id) {
      const index = store.inventories.findIndex((item) => item.id === payload.id);
      if (index < 0) throw new Error('수정할 시설·비품 기록을 찾을 수 없습니다.');
      store.inventories[index] = { ...store.inventories[index], ...record, updated_at: timestamp };
      saveDemoStore(store);
      return deepClone(store.inventories[index]);
    }
    const created = { id: uuid(), ...record, created_at: timestamp, updated_at: timestamp };
    store.inventories.push(created);
    saveDemoStore(store);
    return deepClone(created);
  }
  if (payload.id) {
    const { data, error } = await supabase.from('inventories').update(record).eq('id', payload.id).select().single();
    if (error) throw error;
    return data;
  }
  const { data, error } = await supabase.from('inventories').insert(record).select().single();
  if (error) throw error;
  return data;
}

async function deleteInventory(id) {
  await init();
  if (mode !== 'supabase') {
    const store = loadDemoStore();
    store.inventories = store.inventories.filter((item) => item.id !== id);
    saveDemoStore(store);
    return;
  }
  const { error } = await supabase.from('inventories').delete().eq('id', id);
  if (error) throw error;
}

async function getHeadOfficeChecks({ start, end } = {}) {
  await init();
  const range = normalizeDateRange(start, end);
  if (range.empty) return [];
  if (mode !== 'supabase') {
    return deepClone(demoFilterDate(loadDemoStore().headOfficeChecks, 'check_date', range.start, range.end))
      .sort((a, b) => `${b.check_date}${b.created_at}`.localeCompare(`${a.check_date}${a.created_at}`));
  }
  const { data, error } = await supabase
    .from('head_office_checks')
    .select('*')
    .gte('check_date', range.start)
    .lte('check_date', range.end)
    .order('check_date', { ascending: false })
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

async function saveHeadOfficeCheck(payload) {
  await init();
  const record = {
    check_date: assertOperationalDate(payload.check_date, '점검일'),
    check_type: payload.check_type === 'written' ? 'written' : 'onsite',
    scope: 'all',
    status: 'completed',
    title: payload.title.trim(),
    result: payload.result.trim(),
    follow_up: payload.follow_up?.trim() || '',
    photo_paths: safeArray(payload.photo_paths),
    manager_name: (payload.manager_name || '').trim(),
  };

  if (mode !== 'supabase') {
    const store = loadDemoStore();
    const timestamp = nowIso();
    if (payload.id) {
      const index = store.headOfficeChecks.findIndex((item) => item.id === payload.id);
      if (index < 0) throw new Error('수정할 본사점검 기록을 찾을 수 없습니다.');
      store.headOfficeChecks[index] = { ...store.headOfficeChecks[index], ...record, updated_at: timestamp };
      saveDemoStore(store);
      return deepClone(store.headOfficeChecks[index]);
    }
    const created = { id: uuid(), ...record, created_at: timestamp, updated_at: timestamp };
    store.headOfficeChecks.push(created);
    saveDemoStore(store);
    return deepClone(created);
  }

  if (payload.id) {
    const { data, error } = await supabase.from('head_office_checks').update(record).eq('id', payload.id).select().single();
    if (error) throw error;
    return data;
  }
  const { data, error } = await supabase.from('head_office_checks').insert(record).select().single();
  if (error) throw error;
  return data;
}

async function deleteHeadOfficeCheck(id) {
  await init();
  if (mode !== 'supabase') {
    const store = loadDemoStore();
    store.headOfficeChecks = store.headOfficeChecks.filter((item) => item.id !== id);
    saveDemoStore(store);
    return;
  }
  const { error } = await supabase.from('head_office_checks').delete().eq('id', id);
  if (error) throw error;
}

async function uploadPhotos(files) {
  await init();
  const selected = Array.from(files || []).slice(0, 3);
  if (!selected.length) return [];
  for (const file of selected) {
    if (!file.type.startsWith('image/')) throw new Error('이미지 파일만 첨부할 수 있습니다.');
    if (file.size > 5 * 1024 * 1024) throw new Error('사진 한 장의 용량은 5MB 이하로 선택해 주세요.');
  }

  if (mode !== 'supabase') {
    return Promise.all(selected.map((file) => new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('사진을 읽지 못했습니다.'));
      reader.readAsDataURL(file);
    })));
  }

  const uploaded = [];
  for (const file of selected) {
    const extension = (file.name.split('.').pop() || 'jpg').replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
    const path = `${appCurrentDate().slice(0, 7)}/${uuid()}.${extension}`;
    const { error } = await supabase.storage.from(PHOTO_BUCKET).upload(path, file, {
      cacheControl: '3600', upsert: false, contentType: file.type,
    });
    if (error) throw error;
    uploaded.push(path);
  }
  return uploaded;
}

function resolvePhotoUrl(path) {
  if (!path) return '';
  if (String(path).startsWith('data:') || String(path).startsWith('http')) return path;
  if (!supabase) return '';
  return supabase.storage.from(PHOTO_BUCKET).getPublicUrl(path).data.publicUrl;
}

async function signIn(email, password) {
  await init();
  if (mode !== 'supabase') {
    storageSet(DEMO_ADMIN_KEY, 'true');
    return { user: { id: 'demo-admin', email: email || 'demo@onesports.kr', user_metadata: { display_name: '데모 관리자' } } };
  }
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

async function enterDemoAdmin() {
  await init();
  storageSet(DEMO_ADMIN_KEY, 'true');
  return getSession();
}

async function signOut() {
  await init();
  if (mode !== 'supabase') {
    storageRemove(DEMO_ADMIN_KEY);
    return;
  }
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

async function getSession() {
  await init();
  if (mode !== 'supabase') {
    if (storageGet(DEMO_ADMIN_KEY) !== 'true') return null;
    return { user: { id: 'demo-admin', email: 'demo@onesports.kr', user_metadata: { display_name: '데모 관리자' } } };
  }
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return data.session;
}

async function getAdminProfile() {
  await init();
  const session = await getSession();
  if (!session?.user) return null;
  if (mode !== 'supabase') {
    return { user_id: session.user.id, display_name: '데모 관리자', active: true, email: session.user.email };
  }
  const { data, error } = await supabase
    .from('app_admins')
    .select('user_id, display_name, active')
    .eq('user_id', session.user.id)
    .maybeSingle();
  if (error) throw error;
  if (!data?.active) return null;
  return { ...data, email: session.user.email };
}

function subscribe(callback) {
  if (mode === 'supabase' && supabase) {
    const channel = supabase
      .channel(`onesports-management-${uuid()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'inspections' }, (payload) => callback({ table: 'inspections', payload }))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'issues' }, (payload) => callback({ table: 'issues', payload }))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'inventories' }, (payload) => callback({ table: 'inventories', payload }))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'head_office_checks' }, (payload) => callback({ table: 'head_office_checks', payload }))
      .subscribe((status) => callback({ table: 'connection', status }));
    return () => supabase.removeChannel(channel);
  }

  const handler = () => callback({ table: 'demo', status: 'SUBSCRIBED' });
  window.addEventListener('storage', handler);
  window.addEventListener('onesports-demo-change', handler);
  queueMicrotask(() => {
    callback({ table: 'connection', status: 'DEMO' });
    handler();
  });
  return () => {
    window.removeEventListener('storage', handler);
    window.removeEventListener('onesports-demo-change', handler);
  };
}

export const data = {
  async getClient() {
    await init();
    if (mode !== 'supabase' || !supabase) throw new Error('실제 DB 연결이 필요합니다.');
    return supabase;
  },
  init,
  state,
  getAreas,
  getInspections,
  upsertInspection,
  deleteInspection,
  getIssues,
  saveIssue,
  deleteIssue,
  getInventories,
  saveInventory,
  deleteInventory,
  getHeadOfficeChecks,
  saveHeadOfficeCheck,
  deleteHeadOfficeCheck,
  uploadPhotos,
  resolvePhotoUrl,
  signIn,
  enterDemoAdmin,
  signOut,
  getSession,
  getAdminProfile,
  subscribe,
};
