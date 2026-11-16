import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Aturan NOP dan merge sinkronisasi diuji terhadap source frontend yang asli
// supaya test menguji implementasi, bukan salinan logika.
const appSource = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `fungsi ${name} tidak ditemukan`);
  let depth = 0;
  for (let i = start; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`fungsi ${name} tidak tertutup rapi`);
}

const masterData = {
  personil: [{ id: 'psn-01', nama: 'PSN-01', nop: 'PLM-014' }],
  sites: [
    { siteId: 'SITE-PLM-014', nama: 'SITE-PLM-014 (Ilir Barat)', nop: 'PLM-014', lat: -2.99, lng: 104.75 },
    { siteId: 'SITE-BTA-012', nama: 'SITE-BTA-012 (Baturaja)', nop: 'BTA-012', lat: -4.2, lng: 104.2 }
  ],
  units: [{ id: 'MBP-01', nama: 'MBP-01 (Tim Alpha)', nop: 'PLM-014', noWa: '628123' }]
};

const STATUS_LABEL = {
  idle: 'Idle', belum_otw: 'Belum OTW', otw: 'OTW to Site',
  waiting_onsite: 'Waiting Onsite', onsite: 'Onsite',
  waiting_selesai: 'Waiting Selesai', selesai: 'Selesai'
};

function statusKey(value) {
  const v = String(value ?? '').trim();
  if (STATUS_LABEL[v]) return v;
  const map = {
    'idle': 'idle', 'belum otw': 'belum_otw', 'otw to site': 'otw',
    'waiting onsite': 'waiting_onsite', 'onsite': 'onsite',
    'waiting selesai': 'waiting_selesai', 'selesai': 'selesai'
  };
  return map[v.toLowerCase()] || 'idle';
}

const nopApi = new Function(
  'masterData',
  `${extractFunction(appSource, 'siteNopOf')}\n${extractFunction(appSource, 'getOrderNop')}\nreturn { siteNopOf, getOrderNop };`
)(masterData);

test('siteNopOf mencocokkan lewat siteId maupun nama site', () => {
  assert.equal(nopApi.siteNopOf('SITE-PLM-014 (Ilir Barat)'), 'PLM-014');
  assert.equal(nopApi.siteNopOf('SITE-PLM-014'), 'PLM-014');
  assert.equal(nopApi.siteNopOf('SITE-BTA-012 (Baturaja)'), 'BTA-012');
  assert.equal(nopApi.siteNopOf('TIDAK-ADA'), '');
});

test('getOrderNop memakai NOP historis pada tiket bila tersedia', () => {
  assert.equal(nopApi.getOrderNop({ nop: 'PLM-014', siteDestinasi: 'SITE-BTA-012 (Baturaja)' }), 'PLM-014');
});

test('getOrderNop mencari NOP dari site bila tiket belum punya NOP', () => {
  assert.equal(nopApi.getOrderNop({ siteDestinasi: 'SITE-BTA-012 (Baturaja)' }), 'BTA-012');
  assert.equal(nopApi.getOrderNop({ siteDestinasi: 'TIDAK-ADA' }), '');
});

test('siteNopOf dan getOrderNop memakai aturan pencocokan yang sama', () => {
  for (const site of ['SITE-PLM-014 (Ilir Barat)', 'SITE-PLM-014', 'SITE-BTA-012 (Baturaja)']) {
    assert.equal(nopApi.siteNopOf(site), nopApi.getOrderNop({ siteDestinasi: site }), `beda hasil untuk ${site}`);
  }
});

// ---------------------------------------------------------------------------
// Merge sinkronisasi: state lokal yang lebih baru tidak boleh ditimpa
// respons server yang sudah basi.
// ---------------------------------------------------------------------------
function merge(fleetList, sheetRecords) {
  const globals = {
    statusKey,
    STORAGE_KEY_ORDERS: 'orders',
    STORAGE_KEY_FLEET: 'fleet',
    localStorage: { getItem: () => null, setItem: () => {} },
    orderList: [],
    fleetList,
    populateSelectDropdowns: () => {},
    checkMbpSessionExpiry: () => {}
  };
  const factory = new Function(
    ...Object.keys(globals),
    `${extractFunction(appSource, 'applySheetRecords')}\nreturn { applySheetRecords };`
  );
  factory(...Object.values(globals)).applySheetRecords(sheetRecords);
  return fleetList;
}

test('merge sinkronisasi mempertahankan dispatch lokal yang lebih baru', () => {
  const fleetList = [{
    namaMbp: 'MBP-01 (Tim Alpha)', status: 'belum_otw', activeOrderId: 'ORD-LOKAL',
    activeSite: 'SITE-PLM-014 (Ilir Barat)',
    pendingOrder: { orderId: 'ORD-LOKAL', dispatchedAt: '2026-01-02T10:00:00.000Z' }
  }];
  merge(fleetList, [{ orderId: 'ORD-LAMA', namaMbp: 'MBP-01 (Tim Alpha)', status: 'Selesai', tsAccept: '2026-01-01T08:00:00.000Z', tsSelesai: '2026-01-01T09:00:00.000Z' }]);
  assert.equal(fleetList[0].status, 'belum_otw');
  assert.equal(fleetList[0].activeOrderId, 'ORD-LOKAL');
  assert.ok(fleetList[0].pendingOrder);
});

test('merge sinkronisasi mengikuti server bila server lebih baru', () => {
  const fleetList = [{
    namaMbp: 'MBP-01 (Tim Alpha)', status: 'belum_otw', activeOrderId: 'ORD-LOKAL',
    activeSite: 'SITE-PLM-014 (Ilir Barat)',
    pendingOrder: { orderId: 'ORD-LOKAL', dispatchedAt: '2026-01-01T08:00:00.000Z' }
  }];
  merge(fleetList, [{ orderId: 'ORD-SERVER', namaMbp: 'MBP-01 (Tim Alpha)', status: 'OTW to Site', tsAccept: '2026-01-01T09:00:00.000Z', tsOtw: '2026-01-01T09:05:00.000Z' }]);
  assert.equal(fleetList[0].status, 'otw');
  assert.equal(fleetList[0].activeOrderId, 'ORD-SERVER');
  assert.equal(fleetList[0].pendingOrder, null);
});

test('merge sinkronisasi tidak mengembalikan unit idle bila server tidak punya baris', () => {
  const fleetList = [{
    namaMbp: 'MBP-01 (Tim Alpha)', status: 'otw', activeOrderId: 'ORD-LOKAL',
    activeSite: 'SITE-PLM-014 (Ilir Barat)',
    pendingOrder: { orderId: 'ORD-LOKAL', dispatchedAt: '2026-01-02T10:00:00.000Z' }
  }];
  merge(fleetList, []);
  assert.equal(fleetList[0].status, 'otw');
  assert.equal(fleetList[0].activeOrderId, 'ORD-LOKAL');
});
