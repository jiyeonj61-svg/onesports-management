import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Exercise the actual browser module's pure functions without a DOM or production network.
// The production imports are replaced only inside this isolated VM test context.
const source = readFileSync(new URL('../assets/member-admin.js', import.meta.url), 'utf8')
  .replace(/^import[^\n]+\n/, '')
  .replace(/^export /gm, '');
function harness() {
  const context = vm.createContext({
    escapeHtml: value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;'),
    todayKst: () => '2026-10-01',
    service: () => { throw new Error('Network access is forbidden in unit tests'); },
    Date, Intl, console,
  });
  vm.runInContext(`${source}\nglobalThis.functions = { parseCsv, addDays, expectedPeriod, filterRows, kstIso, localDateTime, field, statusGrid, memberUrl, state, guestApplication, guestRequest, guestPhotoSource, validateGuestMatch, renderApplications, renderRequests, renderProfiles, currentProgramForm, applicationFormText, renderForms, renderTerms };`, context);
  return context.functions;
}
const plain = value => JSON.parse(JSON.stringify(value));

test('CSV preview preserves BOM headers, quoted names, embedded newlines and leading zeroes', () => {
  const { parseCsv } = harness();
  assert.deepEqual(plain(parseCsv('\ufeff이름,동,호수,전화번호\r\n"홍,길동",101,0101,01012345678\r\n')), [
    { name: '홍,길동', building: '101', unit: '0101', phone: '01012345678' },
  ]);
  assert.equal(parseCsv('name,building,unit,phone\n"이\n름",1,2,01000000000')[0].name, '이\n름');
  assert.equal(parseCsv('name,building,unit,phone\n"이""름",1,2,01000000000')[0].name, '이"름');
});

test('CSV preview refuses malformed input, missing required columns and oversized batches', () => {
  const { parseCsv } = harness();
  assert.throws(() => parseCsv('name,building,unit\nx,1,2'), /필수/);
  assert.throws(() => parseCsv('name,building,unit,phone\n"unclosed,1,2,3'), /따옴표/);
  assert.throws(() => parseCsv('name,building,unit,phone\n' + 'a,1,2,01000000000\n'.repeat(501)), /500/);
});

test('approval review uses inclusive 30, 90, 180 and 365 day periods', () => {
  const { addDays } = harness();
  for (const days of [30, 90, 180, 365]) {
    const end = addDays('2026-10-01', days - 1);
    assert.equal((Date.parse(end) - Date.parse('2026-10-01')) / 86400000 + 1, days);
  }
  assert.equal(addDays('2026-10-01', 29), '2026-10-30');
  assert.equal(addDays('2028-02-01', 29), '2028-03-01');
});

test('approval review considers future approved passes and avoids charging delayed days', () => {
  const { state, expectedPeriod } = harness();
  state.lists.passes = [
    { member_id: 'a', facility: 'fitness', status: 'active', start_date: '2026-10-01', end_date: '2026-10-30' },
    { member_id: 'a', facility: 'fitness', status: 'active', start_date: '2026-10-31', end_date: '2026-11-29' },
    { member_id: 'a', facility: 'fitness', status: 'revoked', start_date: '2026-12-01', end_date: '2028-12-01' },
  ];
  assert.deepEqual(plain(expectedPeriod({ member_id: 'a', product_snapshot: { facility: 'fitness', duration_days: 30 } })), {
    start: '2026-11-30', end: '2026-12-29',
  });
  assert.deepEqual(plain(expectedPeriod({ member_id: 'b', desired_start_date: '2026-09-01', product_snapshot: { facility: 'fitness', duration_days: 30 } })), {
    start: '2026-10-01', end: '2026-10-30',
  });
  assert.deepEqual(plain(expectedPeriod({ member_id: 'b', desired_start_date: '2026-11-01', product_snapshot: { facility: 'fitness', duration_days: 30 } })), {
    start: '2026-11-01', end: '2026-11-30',
  });
});

test('GX approval displays its original fixed course period', () => {
  const { expectedPeriod } = harness();
  assert.deepEqual(plain(expectedPeriod({ member_id: 'b', gx_class_id: 'gx', product_snapshot: { period_start: '2026-10-05', period_end: '2026-10-31' } })), {
    start: '2026-10-05', end: '2026-10-31',
  });
});

test('administrator filters distinguish actual payment and resident confirmation states', () => {
  const { state, filterRows } = harness();
  const rows = [
    { application_status: 'pending', payment_status: 'awaiting', payment_method: 'transfer' },
    { application_status: 'pending', payment_status: 'reported', payment_method: 'transfer' },
    { application_status: 'cancelled', payment_status: 'awaiting', payment_method: 'transfer' },
  ];
  state.filters.applications = { status: 'transfer_pending' };
  assert.equal(filterRows('applications', rows).length, 1);
  state.filters.applications = { status: 'payment_requested' };
  assert.equal(filterRows('applications', rows).length, 1);
  state.filters.profiles = { status: 'verified' };
  assert.equal(filterRows('profiles', [{ resident_verified: true, active: true }, { resident_verified: false, active: true }, { resident_verified: true, active: false }]).length, 1);
});

test('Korean local date inputs round trip without depending on device timezone', () => {
  const { kstIso, localDateTime } = harness();
  assert.equal(kstIso('2026-10-01T09:00'), '2026-10-01T00:00:00.000Z');
  assert.equal(localDateTime('2026-10-01T00:00:00Z'), '2026-10-01T09:00');
  assert.equal(localDateTime(null), '');
});

test('admin fields escape text and the shared member QR contains no personal information', () => {
  const { field, statusGrid, memberUrl } = harness();
  assert.match(field('title', '제목', '<script>"'), /&lt;script&gt;&quot;/);
  assert.match(statusGrid({ payment_status: 'awaiting', payment_method: 'transfer' }), /계좌이체 대기/);
  assert.equal(memberUrl(), 'https://onesports-management.vercel.app/members');
  assert.equal(new URL(memberUrl()).search, '');
  assert.equal(new URL(memberUrl()).hash, '');
});

test('unlinked guest application stays an unverified intake with no payment or pass approval control', () => {
  const { state, guestApplication, statusGrid, renderApplications } = harness();
  const receipt = {
    id: 'intake-1', receipt_no: 'G-20261001-ABC', status: 'received', amount: 30000,
    profile_snapshot: { name: '<입력한 이름>', building: '101', unit: '101', phone: '01000000000' },
    product_snapshot: { name: '헬스 30일', duration_days: 30 },
    application_payload: { kind: 'renewal', payment_method: 'transfer', product_id: 'fitness-30', desired_start_date: '2026-10-01' },
  };
  const row = guestApplication(receipt);
  assert.equal(row.payment_status, undefined);
  assert.equal(row.pass_status, undefined);
  assert.match(statusGrid(row), /미확인·미반영/);
  assert.match(statusGrid(row), /관리자 확인·연결 대기/);
  state.lists.guest_applications = [receipt]; state.lists.applications = [];
  const root = { innerHTML: '' }; renderApplications(root);
  assert.match(root.innerHTML, /data-ms-command="guest-application"/);
  assert.match(root.innerHTML, /&lt;입력한 이름&gt;/);
  assert.doesNotMatch(root.innerHTML, /data-app-action="approve"|자동 승인|연장 완료/);
});

test('guest GX intake never claims a reserved seat before conversion', () => {
  const { guestApplication, statusGrid } = harness();
  const row = guestApplication({ id: 'gx-intake', status: 'received', application_payload: { gx_class_id: 'class-1', payment_method: 'transfer' }, profile_snapshot: {} });
  assert.match(statusGrid(row), /GX 자리/);
  assert.match(statusGrid(row), /미배정·입금 안내 전/);
});

test('converted guest intake displays the existing financial workflow once without duplicate cards', () => {
  const { state, renderApplications, guestApplication } = harness();
  state.lists.applications = [{ id: 'original-app', application_no: 'A-1', member_id: 'member-1', application_status: 'completed', payment_status: 'confirmed', pass_status: 'applied', external_status: 'pending', amount: 30000, created_at: '2026-10-01T00:00:00Z' }];
  const receipt = { id: 'intake-1', receipt_no: 'G-1', status: 'converted', linked_application_id: 'original-app', application_payload: { payment_method: 'card' }, profile_snapshot: { name: '접수인' }, created_at: '2026-10-01T00:00:00Z' };
  state.lists.guest_applications = [receipt];
  assert.equal(guestApplication(receipt).pass_status, 'applied');
  const root = { innerHTML: '' }; renderApplications(root);
  assert.equal((root.innerHTML.match(/<article class="ms-card/g) || []).length, 1);
  assert.match(root.innerHTML, /연결된 신청·처리 확인/);
  assert.match(root.innerHTML, /이용권 반영 완료/);
});

test('guest matching requires explicit selected member and real-world confirmation but no member account', () => {
  const { validateGuestMatch } = harness();
  assert.throws(() => validateGuestMatch(null, true), /직접 선택/);
  assert.throws(() => validateGuestMatch({ id: 'a', active: false }, true), /사용 중지/);
  assert.throws(() => validateGuestMatch({ id: 'a', active: true }, false), /현장 확인/);
  const pending = validateGuestMatch({ id: 'a', active: true, user_id: null, resident_verified: false, approved: false }, true);
  assert.deepEqual(plain(pending), { memberId: 'a', needsVerification: true });
  const verified = validateGuestMatch({ id: 'a', active: true, user_id: null, resident_verified: true, approved: true }, true);
  assert.equal(verified.needsVerification, false);
});

test('guest request payload is escaped and kept in a private receipt workflow', () => {
  const { state, guestRequest, renderRequests, filterRows } = harness();
  const receipt = { id: 'request-1', receipt_no: 'R-1', status: 'received', profile_snapshot: { name: '접수인' }, request_payload: { title: '<script>내용</script>', body: '기구 확인 요청', category_id: 'equipment', location: '헬스장' }, created_at: '2026-10-01T00:00:00Z' };
  state.lists.guest_requests = [receipt]; state.lists.requests = []; state.lists.categories = [];
  const root = { innerHTML: '' }; renderRequests(root);
  assert.match(root.innerHTML, /&lt;script&gt;내용&lt;\/script&gt;/);
  assert.match(root.innerHTML, /비공개/);
  assert.match(root.innerHTML, /data-ms-command="guest-request"/);
  state.filters.requests = { source: 'guest', location: '헬스장' };
  assert.equal(filterRows('requests', [guestRequest(receipt), { id: 'legacy', location: '헬스장' }]).length, 1);
});

test('guest photo display accepts only bounded image data, never HTML or active SVG', () => {
  const { guestPhotoSource } = harness();
  assert.equal(guestPhotoSource({ mime: 'image/jpeg', base64: 'YWJj' }), 'data:image/jpeg;base64,YWJj');
  assert.equal(guestPhotoSource({ mime: 'image/jpeg', base64: 'YW\nJj' }), 'data:image/jpeg;base64,YWJj');
  assert.throws(() => guestPhotoSource({ mime: 'image/svg+xml', base64: 'YWJj' }), /사진 형식/);
  assert.throws(() => guestPhotoSource({ mime: 'text/html', base64: 'YWJj' }), /사진 형식/);
  assert.throws(() => guestPhotoSource({ mime: 'image/png', base64: '<script>' }), /사진 형식/);
  assert.throws(() => guestPhotoSource({ mime: 'image/png', base64: 'A'.repeat(720001) }), /사진 형식/);
});

test('profile administration does not offer member account invitations or unlinked-account labels', () => {
  const { state, renderProfiles } = harness();
  state.lists.profiles = [{ id: 'a', name: '회원', building: '101', unit: '101', phone: '01000000000', user_id: null, active: true }];
  state.lists.passes = []; state.lists.profile_changes = [];
  const root = { innerHTML: '' }; renderProfiles(root);
  assert.doesNotMatch(root.innerHTML, /초대코드|계정 연결|미연결|이메일/);
  assert.match(root.innerHTML, /가입·로그인 없이/);
  assert.match(root.innerHTML, /현장 확인/);
});

test('cash payment waits are distinct from card and transfer and exclude cancelled applications', () => {
  const { state, filterRows, statusGrid } = harness();
  const rows = ['cash', 'card', 'transfer'].map(payment_method => ({ payment_method, payment_status: 'awaiting', application_status: 'pending' }));
  rows.push({ payment_method: 'cash', payment_status: 'awaiting', application_status: 'cancelled' });
  state.filters.applications = { status: 'cash_pending' };
  assert.deepEqual(plain(filterRows('applications', rows)).map(row => row.payment_method), ['cash']);
  assert.match(statusGrid(rows[0]), /현장 현금결제 대기/);
  assert.doesNotMatch(statusGrid(rows[0]), /카드결제/);
  state.filters.applications = { status: 'card_pending' };
  assert.deepEqual(plain(filterRows('applications', rows)).map(row => row.payment_method), ['card']);
});

test('program-specific forms remain separate and an inactive GX form does not fall back to common', () => {
  const { state, currentProgramForm, renderForms } = harness();
  state.lists.forms = [
    { id: 'common', program: 'common', active: true, version: 9, title: '공통 양식', signature_mode: 'new', fields: [] },
    { id: 'fitness-old', program: 'fitness_golf', active: false, version: 1, title: '지난 헬스 양식', signature_mode: 'new', fields: [] },
    { id: 'fitness', program: 'fitness_golf', active: true, version: 2, title: '헬스·골프 신청', signature_mode: 'always', fields: [] },
    { id: 'gx', program: 'gx', active: false, version: 3, title: '<GX 사용신청서>', signature_mode: 'none', fields: [] },
  ];
  assert.equal(currentProgramForm('fitness_golf').id, 'fitness');
  assert.equal(currentProgramForm('gx').id, 'gx');
  assert.equal(currentProgramForm('gx').active, false);
  const root = { innerHTML: '' }; renderForms(root);
  assert.match(root.innerHTML, /data-id="fitness" data-program="fitness_golf"/);
  assert.match(root.innerHTML, /data-id="gx" data-program="gx"/);
  assert.match(root.innerHTML, /모든 신청에 서명/);
  assert.match(root.innerHTML, /&lt;GX 사용신청서&gt;/);
});

test('application form labels use the submitted snapshot rather than current form settings', () => {
  const { state, applicationFormText, guestApplication } = harness();
  state.lists.forms = [{ program: 'gx', title: '새 제목', version: 8 }];
  const original = { program: 'gx', title: '접수 당시 GX 신청서', version: 2, signature_mode: 'always' };
  assert.equal(applicationFormText({ form_snapshot: original }), '접수 당시 GX 신청서 · GX 프로그램 · 버전 2');
  const guest = guestApplication({ id: 'guest', application_payload: { form_snapshot: original } });
  assert.equal(applicationFormText(guest), '접수 당시 GX 신청서 · GX 프로그램 · 버전 2');
  assert.equal(applicationFormText({}), '이전 신청서 기록');
});
