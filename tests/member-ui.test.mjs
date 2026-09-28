// Isolated rendering fixtures only. These tests never call a real service or create accounts.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import test from 'node:test';
import assert from 'node:assert/strict';

const source = readFileSync(new URL('../assets/members.js', import.meta.url), 'utf8')
  .replace(/^import[^\n]+\n/, '')
  .replace(/boot\(\);\s*$/, 'globalThis.inspect={state,renderHome,renderRenew,renderAuth,renderRequests,renderMy,applicationCard,requestCard,selectionChanged,addDays,refreshMine};');

function harness() {
  const nodes = new Map();
  const node = () => ({ innerHTML: '', textContent: '', hidden: false, setAttribute() {}, removeAttribute() {}, querySelectorAll() { return []; }, scrollIntoView() {} });
  for (const id of ['memberContent','memberNav','memberAccount','memberCenterName','memberContact','memberConnection','memberToast','memberSelectionDetail','memberDesiredDate','memberGuardianFields','memberPeriodPreview']) nodes.set(id, node());
  const handlers = {};
  const home = {
    settings: { applications_enabled: true, requests_enabled: true, transfer_available: true, bank_name: 'TEST BANK', bank_account: 'TEST ACCOUNT', bank_holder: 'TEST ONLY', photo_limit: 3 },
    categories: [], request_categories: [{ id: 'r', name: '필요한 물품' }],
    products: [{ id: 'p', name: '헬스 30일', facility: 'fitness', duration_days: 30, price: 30000, updated_at: '2026-09-28T01:00:00Z' }],
    gx_classes: [], posts: [], terms: [{ id: 't', title: '개인정보', kind: 'privacy', required: true, body: 'TEST TERMS', version: 1 }], form: { id: 'f', fields: [] },
  };
  const box = {
    console, Intl, Date, Map, Promise, URLSearchParams, URL, Image: class {}, setTimeout, clearTimeout, crypto: webcrypto,
    navigator: { onLine: true }, location: { pathname: '/members', hash: '', search: '', origin: 'http://localhost' }, history: { pushState() {}, replaceState() {} },
    window: { addEventListener(name, callback) { handlers[name] = callback; }, scrollTo() {}, devicePixelRatio: 1 },
    document: { getElementById: id => nodes.get(id), querySelectorAll: () => [], addEventListener(name, callback) { handlers[name] = callback; } },
    getClient: async () => null, service: async () => ({}), uploadPhoto: async () => '', photoUrl: async () => '', todayKst: () => '2026-09-28',
    e: value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;'),
  };
  vm.createContext(box); vm.runInContext(source, box);
  const api = box.inspect;
  api.state.home = home;
  api.state.session = { user: { id: 'user-a', email: 'a@example.invalid' } };
  api.state.mine = { profile: { name: 'TEST MEMBER', active: true, approved: true, resident_verified: true }, passes: [], applications: [], requests: [] };
  return { api, box, home, nodes, handlers };
}

test('member home preserves the requested title and personal actions require authentication', () => {
  const { api, nodes } = harness();
  api.renderHome(); assert.match(nodes.get('memberContent').innerHTML, /회원분들께 보고드립니다\./);
  api.state.session = null;
  for (const render of [api.renderRenew, api.renderRequests, api.renderMy]) { render(); assert.match(nodes.get('memberContent').innerHTML, /data-form="login"/); }
});

test('applications stay unavailable until configured and verified membership is required for renewal', () => {
  const { api, nodes, home } = harness();
  api.renderRenew(); assert.match(nodes.get('memberContent').innerHTML, /data-form="application"/);
  home.settings.applications_enabled = false;
  api.renderRenew(); assert.doesNotMatch(nodes.get('memberContent').innerHTML, /data-form="application"/);
  home.settings.applications_enabled = true; api.state.mine.profile.resident_verified = false;
  api.renderRenew(); assert.doesNotMatch(nodes.get('memberContent').innerHTML, /data-form="application"/);
});

test('period preview counts the first day and appends to already approved future passes', () => {
  const { api, nodes } = harness();
  for (const [days, end] of [[30, '2026-10-30'], [90, '2026-12-29'], [180, '2027-03-29'], [365, '2027-09-30']]) assert.equal(api.addDays('2026-10-01', days - 1), end);
  const form = { elements: { selection: { value: 'product:p' }, desired_start_date: { value: '2026-10-01' } } };
  api.selectionChanged(form); assert.match(nodes.get('memberPeriodPreview').innerHTML, /2026\.10\.30/);
  api.state.mine.passes = [{ facility: 'fitness', status: 'active', end_date: '2026-12-31' }];
  api.selectionChanged(form); assert.match(nodes.get('memberPeriodPreview').innerHTML, /2027\.01\.01 ~ 2027\.01\.30/);
});

test('GX waitlisted applicants see no transfer account or payment report action', () => {
  const { api } = harness();
  const application = { id: 'id', application_no: 'A-TEST', product_snapshot: { name: '<img onerror=evil()>' }, amount: 30000, payment_method: 'transfer', application_status: 'pending', payment_status: 'awaiting', pass_status: 'pending', reservation_status: 'waitlisted', consents_snapshot: [], created_at: '2026-09-28T01:00:00Z' };
  const waiting = api.applicationCard(application);
  assert.match(waiting, /&lt;img onerror=evil\(\)&gt;/);
  assert.doesNotMatch(waiting, /TEST ACCOUNT|data-form="payment-report"/);
  const allocated = api.applicationCard({ ...application, reservation_status: 'none' });
  assert.match(allocated, /data-form="payment-report"/);
  assert.match(allocated, /관리자 확인 후 재등록이 완료됩니다/);
});

test('private request rendering escapes text and never includes internal notes', () => {
  const { api } = harness();
  const html = api.requestCard({ request_no: 'R-TEST', status: 'received', body: '<script>evil()</script>', reply: 'TEST REPLY', internal_notes: 'SECRET STAFF NOTE', created_at: '2026-09-28T01:00:00Z' });
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /SECRET STAFF NOTE/);
});

test('offline transition clears private data and replaces the visible personal page', () => {
  const { api, box, nodes, handlers } = harness();
  box.location.pathname = '/members/my'; box.navigator.onLine = false;
  handlers.offline();
  assert.equal(api.state.mine, null);
  assert.match(nodes.get('memberContent').innerHTML, /인터넷 연결이 필요합니다/);
  assert.doesNotMatch(nodes.get('memberContent').innerHTML, /TEST MEMBER/);
});

test('an old account response cannot populate a new account or a page invalidated by logout/offline', async () => {
  const { api, box } = harness();
  let resolve;
  box.service = () => new Promise(done => { resolve = done; });
  const pending = api.refreshMine();
  api.state.session = { user: { id: 'user-b' } }; api.state.mine = null;
  resolve({ profile: { name: 'OLD ACCOUNT' } }); await pending;
  assert.equal(api.state.mine, null);
  const invalidated = api.refreshMine();
  api.state.epoch++;
  resolve({ profile: { name: 'STALE RESPONSE' } }); await invalidated;
  assert.equal(api.state.mine, null);
});
