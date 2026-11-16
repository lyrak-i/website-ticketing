import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// apps-script/Auth.gs dimuat apa adanya. Service Google (Spreadsheet, Cache,
// Properties, Lock, Utilities) diganti stub, dan fungsi kripto asli dari
// Crypto.gs ikut dimuat supaya verifikasi password benar-benar diuji.
const authSource = readFileSync(new URL('../apps-script/Auth.gs', import.meta.url), 'utf8');
const cryptoSource = readFileSync(new URL('../apps-script/Crypto.gs', import.meta.url), 'utf8');
const cryptoExports = new Function(
  `${cryptoSource}\nreturn { pbkdf2Sha256, safeEquals };`
)();

let uuidCounter = 0;

function makeAuth({ users = [], rows = [], master = { personil: [], sites: [], units: [] } } = {}) {
  const store = {
    users: users.map(row => [...row]),
    properties: {},
    cache: new Map()
  };

  const authSheet = {
    getLastRow: () => (store.users.length ? store.users.length + 1 : 1),
    getRange: (row, col, numRows, numCols) => ({
      getValue: () => store.users[row - 2]?.[col - 1] ?? '',
      getValues: () => {
        const out = [];
        for (let r = 0; r < numRows; r++) {
          const source = store.users[row - 2 + r];
          const line = [];
          for (let c = 0; c < numCols; c++) line.push(source ? source[c] : '');
          out.push(line);
        }
        return out;
      },
      setValues: values => {
        values.forEach((line, r) => {
          const index = row - 2 + r;
          if (index < store.users.length) store.users[index] = [...line];
          else store.users.push([...line]);
        });
      }
    }),
    appendRow: line => store.users.push([...line])
  };

  const globals = {
    Utilities: {
      DigestAlgorithm: { SHA_256: 'SHA_256' },
      computeDigest: (_alg, data) => {
        const out = new Uint8Array(32);
        const str = String(data);
        for (let i = 0; i < 32; i++) out[i] = str.charCodeAt(i % str.length) & 255;
        return Array.from(out);
      },
      getUuid: () => `uuid-${(uuidCounter++).toString(16).padStart(8, '0')}`
    },
    CacheService: {
      getScriptCache: () => ({
        put: (k, v) => store.cache.set(k, v),
        get: k => store.cache.get(k) ?? null,
        remove: k => store.cache.delete(k)
      })
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: k => store.properties[k] ?? (k === 'INITIAL_ADMIN_PASSWORD' ? 'bootstrap-pass-123' : null),
        setProperty: (k, v) => { store.properties[k] = v; },
        deleteProperty: k => { delete store.properties[k]; }
      })
    },
    LockService: { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) },
    SpreadsheetApp: {
      openById: () => ({
        getSheetByName: name => (name === 'Auth_Users' ? authSheet : null),
        insertSheet: () => authSheet
      })
    }
  };

  const extra = {
    getSpreadsheet: () => globals.SpreadsheetApp.openById(),
    readMasterJson: () => master,
    findOrderRowById: id => rows.find(row => row.orderId === id) || null,
    str: value => (value === undefined || value === null ? '' : String(value)),
    pbkdf2Sha256: cryptoExports.pbkdf2Sha256,
    safeEquals: cryptoExports.safeEquals
  };

  const names = [
    'authBackendVersion', 'getAuthUsersSheet', 'authBootstrapIfEmpty_', 'authReadUsers',
    'authFindUser', 'authVerifyPassword', 'authMakePasswordHash', 'authUpsertUser',
    'authCreateSession', 'authGetSession', 'authDestroySession', 'authRequire',
    'authHandleValidateSession', 'authHandleLogin', 'authHandleLogout',
    'authHandleValidateMagicLink', 'authHandleListUsers', 'authHandleSetPassword',
    'authSyncPersonilFromMaster', 'authGenerateTempPassword', 'authCanWriteOrder',
    'ensureCryptoReady_'
  ];

  const source = `${authSource}\nreturn { ${names.join(', ')} };`;
  const factory = new Function(...Object.keys(globals), ...Object.keys(extra), source);
  const api = factory(...Object.values(globals), ...Object.values(extra));
  return { api, store };
}

function hashOf(password) {
  const { api } = makeAuth();
  return api.authMakePasswordHash(password);
}

test('authRequire menolak sesi yang tidak ada', () => {
  const { api } = makeAuth();
  const result = api.authRequire({ sessionToken: 'tidak-ada' });
  assert.equal(result.ok, false);
  assert.match(result.message, /tidak valid|kedaluwarsa/i);
});

test('authRequire menerima sesi yang dibuat login', () => {
  const { api } = makeAuth({
    users: [['psn-01', 'omc', 'PSN-01', 'PLM-014', '', hashOf('benar123'), '2026-01-01']],
    master: { personil: [{ id: 'psn-01', nama: 'PSN-01', nop: 'PLM-014' }], sites: [], units: [] }
  });
  const session = api.authCreateSession({ username: 'psn-01', role: 'omc', name: 'PSN-01', nop: 'PLM-014', unit: '', passwordHash: '' }, {});
  const result = api.authRequire({ sessionToken: session.sessionToken });
  assert.equal(result.ok, true);
  assert.equal(result.session.username, 'psn-01');
  assert.equal(result.session.nop, 'PLM-014');
});

test('authRequire membatalkan sesi bila akun dihapus dari Auth_Users', () => {
  const { api } = makeAuth();
  const session = api.authCreateSession({ username: 'psn-01', role: 'omc', name: 'PSN-01', nop: 'PLM-014' }, {});
  const result = api.authRequire({ sessionToken: session.sessionToken });
  assert.equal(result.ok, false);
  assert.match(result.message, /tidak aktif/i);
});

test('authRequire membatalkan sesi OMC yang NOP-nya sudah tidak sinkron dengan MasterData', () => {
  const { api } = makeAuth({
    users: [['psn-01', 'omc', 'PSN-01', 'PLM-014', '', hashOf('benar123'), '2026-01-01']],
    master: { personil: [{ id: 'psn-01', nama: 'PSN-01', nop: 'BTA-012' }], sites: [], units: [] }
  });
  const session = api.authCreateSession({ username: 'psn-01', role: 'omc', name: 'PSN-01', nop: 'PLM-014' }, {});
  const result = api.authRequire({ sessionToken: session.sessionToken });
  assert.equal(result.ok, false);
  assert.match(result.message, /MasterData/i);
});

test('authHandleLogin menolak password salah', () => {
  const { api } = makeAuth({ users: [['psn-01', 'omc', 'PSN-01', 'PLM-014', '', hashOf('benar123'), '2026-01-01']] });
  const result = api.authHandleLogin({ username: 'psn-01', password: 'salah' });
  assert.equal(result.status, 'error');
  assert.match(result.message, /salah/i);
});

test('authHandleLogin berhasil dengan hash yang benar', () => {
  const { api } = makeAuth({ users: [['psn-01', 'omc', 'PSN-01', 'PLM-014', '', hashOf('benar123'), '2026-01-01']] });
  const result = api.authHandleLogin({ username: 'psn-01', password: 'benar123' });
  assert.equal(result.status, 'success');
  assert.equal(result.user.role, 'omc');
  assert.equal(result.user.nop, 'PLM-014');
  assert.ok(result.sessionToken);
});

test('authHandleLogin menolak role MBP untuk login manual', () => {
  const { api } = makeAuth({ users: [['mbp-01', 'mbp', 'MBP-01', 'PLM-014', 'MBP-01', hashOf('benar123'), '2026-01-01']] });
  const result = api.authHandleLogin({ username: 'mbp-01', password: 'benar123' });
  assert.equal(result.status, 'error');
});

test('authHandleListUsers menolak role non-admin', () => {
  const { api } = makeAuth({
    users: [['psn-01', 'omc', 'PSN-01', 'PLM-014', '', hashOf('benar123'), '2026-01-01']],
    master: { personil: [{ id: 'psn-01', nama: 'PSN-01', nop: 'PLM-014' }], sites: [], units: [] }
  });
  const session = api.authCreateSession({ username: 'psn-01', role: 'omc', name: 'PSN-01', nop: 'PLM-014' }, {});
  const result = api.authHandleListUsers({ sessionToken: session.sessionToken });
  assert.equal(result.status, 'error');
  assert.match(result.message, /Admin/i);
});

test('authHandleSetPassword menolak non-admin', () => {
  const { api } = makeAuth();
  const session = api.authCreateSession({ username: 'psn-01', role: 'omc', name: 'PSN-01', nop: 'PLM-014' }, {});
  const result = api.authHandleSetPassword({ sessionToken: session.sessionToken, targetUsername: 'psn-02', newPassword: 'rahasia123' });
  assert.equal(result.status, 'error');
});

test('authCanWriteOrder membatasi OMC ke NOP-nya sendiri', () => {
  const { api } = makeAuth({
    users: [['psn-01', 'omc', 'PSN-01', 'PLM-014', '', hashOf('benar123'), '2026-01-01']],
    master: { personil: [{ id: 'psn-01', nama: 'PSN-01', nop: 'PLM-014' }], sites: [], units: [] }
  });
  const session = { username: 'psn-01', role: 'omc', nop: 'PLM-014' };
  assert.equal(api.authCanWriteOrder(session, { nop: 'PLM-014', orderId: 'ORD-1' }).ok, true);
  const denied = api.authCanWriteOrder(session, { nop: 'BTA-012', orderId: 'ORD-1' });
  assert.equal(denied.ok, false);
  assert.match(denied.message, /NOP/i);
});

test('authCanWriteOrder menolak OMC yang tidak lagi sinkron dengan MasterData', () => {
  const { api } = makeAuth({
    users: [['psn-01', 'omc', 'PSN-01', 'PLM-014', '', hashOf('benar123'), '2026-01-01']],
    master: { personil: [{ id: 'psn-01', nama: 'PSN-01', nop: 'BTA-012' }], sites: [], units: [] }
  });
  const result = api.authCanWriteOrder({ username: 'psn-01', role: 'omc', nop: 'PLM-014' }, { nop: 'PLM-014', orderId: 'ORD-1' });
  assert.equal(result.ok, false);
  assert.match(result.message, /tidak aktif/i);
});

test('authCanWriteOrder membatasi MBP pada order miliknya', () => {
  const { api } = makeAuth({
    rows: [
      { orderId: 'ORD-1', dispatchToken: 'abc123', namaMbp: 'MBP-01 (Tim Alpha)', status: 'Belum OTW' },
      { orderId: 'ORD-2', dispatchToken: 'def456', namaMbp: 'MBP-02 (Tim Bravo)', status: 'Belum OTW' }
    ]
  });
  const session = { role: 'mbp', orderId: 'ORD-1', namaMbp: 'MBP-01 (Tim Alpha)' };
  assert.equal(api.authCanWriteOrder(session, { orderId: 'ORD-1' }).ok, true);
  assert.equal(api.authCanWriteOrder(session, { orderId: 'ORD-2' }).ok, false);
});

test('authCanWriteOrder mengizinkan admin tanpa scope', () => {
  const { api } = makeAuth();
  assert.equal(api.authCanWriteOrder({ role: 'admin' }, { orderId: 'ORD-9' }).ok, true);
});

test('authHandleValidateMagicLink menolak token yang tidak cocok', () => {
  const { api } = makeAuth({ rows: [{ orderId: 'ORD-1', dispatchToken: 'abc123', namaMbp: 'MBP-01 (Tim Alpha)', status: 'Belum OTW' }] });
  const result = api.authHandleValidateMagicLink({ orderId: 'ORD-1', token: 'salah', namaMbp: 'MBP-01 (Tim Alpha)' });
  assert.equal(result.status, 'error');
  assert.match(result.message, /tidak valid/i);
});

test('authHandleValidateMagicLink menolak tiket yang sudah selesai', () => {
  const { api } = makeAuth({ rows: [{ orderId: 'ORD-1', dispatchToken: 'abc123', namaMbp: 'MBP-01 (Tim Alpha)', status: 'Selesai' }] });
  const result = api.authHandleValidateMagicLink({ orderId: 'ORD-1', token: 'abc123', namaMbp: 'MBP-01 (Tim Alpha)' });
  assert.equal(result.status, 'error');
  assert.match(result.message, /SELESAI/i);
});

test('authHandleValidateMagicLink menolak link untuk unit lain', () => {
  const { api } = makeAuth({ rows: [{ orderId: 'ORD-1', dispatchToken: 'abc123', namaMbp: 'MBP-01 (Tim Alpha)', status: 'Belum OTW' }] });
  const result = api.authHandleValidateMagicLink({ orderId: 'ORD-1', token: 'abc123', namaMbp: 'MBP-02 (Tim Bravo)' });
  assert.equal(result.status, 'error');
  assert.match(result.message, /unit MBP lain/i);
});

test('authHandleValidateMagicLink memberi sesi MBP untuk token yang cocok', () => {
  const { api } = makeAuth({ rows: [{ orderId: 'ORD-1', dispatchToken: 'abc123', namaMbp: 'MBP-01 (Tim Alpha)', status: 'Belum OTW' }] });
  const result = api.authHandleValidateMagicLink({ orderId: 'ORD-1', token: 'abc123', namaMbp: 'MBP-01 (Tim Alpha)' });
  assert.equal(result.status, 'success');
  assert.equal(result.user.role, 'mbp');
  assert.equal(result.user.orderId, 'ORD-1');
  assert.ok(result.sessionToken);
});

test('authSyncPersonilFromMaster tidak menimpa hash password yang ada', () => {
  const { api, store } = makeAuth({
    users: [['psn-01', 'omc', 'PSN-01', 'PLM-014', '', 'HASH-LAMA', '2026-01-01']]
  });
  api.authSyncPersonilFromMaster({ personil: [{ id: 'psn-01', nama: 'PSN-01 Baru', nop: 'BTA-012' }] });
  assert.equal(store.users[0][5], 'HASH-LAMA');
  assert.equal(store.users[0][2], 'PSN-01 Baru');
  assert.equal(store.users[0][3], 'BTA-012');
});

test('authSyncPersonilFromMaster tidak membuat akun OMC baru diam-diam', () => {
  const { api, store } = makeAuth();
  api.authSyncPersonilFromMaster({ personil: [{ id: 'psn-99', nama: 'Orang Baru', nop: 'PLM-014' }] });
  const usernames = store.users.map(row => String(row[0]).toLowerCase());
  assert.ok(!usernames.includes('psn-99'));
});

test('authMakePasswordHash menghasilkan hash pbkdf2 yang bisa diverifikasi', () => {
  const { api } = makeAuth();
  const hash = api.authMakePasswordHash('rahasia123');
  assert.match(hash, /^pbkdf2\$\d+\$[0-9a-f]{32}\$[0-9a-f]{64}$/);
  assert.equal(api.authVerifyPassword('rahasia123', hash), true);
  assert.equal(api.authVerifyPassword('rahasia124', hash), false);
});
