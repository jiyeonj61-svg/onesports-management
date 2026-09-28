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
  vm.runInContext(`${source}\nglobalThis.functions = { parseCsv, addDays, expectedPeriod, filterRows, kstIso, localDateTime, field, statusGrid, memberUrl, state };`, context);
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
