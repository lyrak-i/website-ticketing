/**
 * Autentikasi server-side: login PBKDF2 (Crypto.gs), sesi, magic link, kelola user Admin.
 * Tab spreadsheet: Auth_Users (kolom A–G).
 */

var AUTH_BACKEND_VERSION = 2;
var AUTH_SESSION_TTL_SEC = 12 * 60 * 60;
var AUTH_USERS_SHEET = 'Auth_Users';
var AUTH_CACHE_PREFIX = 'sess:';

// Hash awal (sama dengan js/demo-users.js) — hanya dipakai saat tab user masih kosong.
var AUTH_BOOTSTRAP_USERS = [
  {
    username: 'admin',
    role: 'admin',
    name: 'Administrator Master Data',
    nop: '',
    unit: '',
    passwordHash: 'pbkdf2$10000$c2ab6bd3d5ea28385e33a39e3cb8394b$509ad95ea212ef0d4a3e973865df363a605b1d52ad9e2f41afe78ee5aa481191'
  },
  {
    username: 'omc',
    role: 'omc',
    name: 'Operator OMC (semua NOP, demo)',
    nop: '',
    unit: '',
    passwordHash: 'pbkdf2$10000$7655671bf2e3a9dde0d81431de7ea036$dcafaa0490bb438fa347fd24ec83e1f4937e3e33750e2b7291303cacd45377ce'
  }
];

function authBackendVersion() {
  return AUTH_BACKEND_VERSION;
}

function getAuthUsersSheet() {
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName(AUTH_USERS_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(AUTH_USERS_SHEET);
    sheet.getRange(1, 1, 1, 7).setValues([[
      'username', 'role', 'name', 'nop', 'unit', 'passwordHash', 'updatedAt'
    ]]);
    authBootstrapIfEmpty(sheet);
  } else if (sheet.getLastRow() < 2) {
    authBootstrapIfEmpty(sheet);
  }
  return sheet;
}

function authBootstrapIfEmpty(sheet) {
  var now = new Date().toISOString();
  var rows = [];
  for (var i = 0; i < AUTH_BOOTSTRAP_USERS.length; i++) {
    var u = AUTH_BOOTSTRAP_USERS[i];
    rows.push([u.username, u.role, u.name, u.nop, u.unit, u.passwordHash, now]);
  }
  if (rows.length) sheet.getRange(2, 1, rows.length, 7).setValues(rows);
}

function authReadUsers() {
  var sheet = getAuthUsersSheet();
  var last = sheet.getLastRow();
  if (last < 2) return [];
  var values = sheet.getRange(2, 1, last - 1, 7).getValues();
  var out = [];
  for (var i = 0; i < values.length; i++) {
    var row = values[i];
    var username = String(row[0] || '').trim().toLowerCase();
    if (!username) continue;
    out.push({
      rowIndex: i + 2,
      username: username,
      role: String(row[1] || '').trim().toLowerCase(),
      name: String(row[2] || ''),
      nop: String(row[3] || ''),
      unit: String(row[4] || ''),
      passwordHash: String(row[5] || ''),
      updatedAt: String(row[6] || '')
    });
  }
  return out;
}

function authFindUser(username) {
  var u = String(username || '').trim().toLowerCase();
  if (!u) return null;
  var users = authReadUsers();
  for (var i = 0; i < users.length; i++) {
    if (users[i].username === u) return users[i];
  }
  return null;
}

function authVerifyPassword(password, storedHash) {
  var parts = String(storedHash || '').split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;
  var iterations = parseInt(parts[1], 10);
  if (!iterations || iterations < 1) return false;
  var saltHex = parts[2];
  var expectedHex = parts[3];
  var actualHex = pbkdf2Sha256(String(password), saltHex, iterations, expectedHex.length / 2);
  return safeEquals(actualHex, expectedHex);
}

function authMakePasswordHash(password) {
  var saltBytes = [];
  for (var i = 0; i < 16; i++) saltBytes.push(Math.floor(Math.random() * 256));
  var saltHex = bytesToHex(new Uint8Array(saltBytes));
  var iterations = 10000;
  var hashHex = pbkdf2Sha256(String(password), saltHex, iterations, 32);
  return 'pbkdf2$' + iterations + '$' + saltHex + '$' + hashHex;
}

function authUpsertUser(record) {
  var sheet = getAuthUsersSheet();
  var username = String(record.username || '').trim().toLowerCase();
  if (!username) throw new Error('username wajib');

  var existing = authFindUser(username);
  var now = new Date().toISOString();
  var row = [
    username,
    str(record.role),
    str(record.name),
    str(record.nop),
    str(record.unit),
    str(record.passwordHash),
    now
  ];

  if (existing && existing.rowIndex) {
    sheet.getRange(existing.rowIndex, 1, 1, 7).setValues([row]);
  } else {
    sheet.appendRow(row);
  }
}

function authCreateSession(user, extra) {
  extra = extra || {};
  var token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  var payload = {
    username: user.username,
    role: user.role,
    name: user.name,
    nop: user.nop || '',
    unit: user.unit || '',
    orderId: extra.orderId || '',
    namaMbp: extra.namaMbp || '',
    loginAt: Date.now()
  };
  var cache = CacheService.getScriptCache();
  cache.put(AUTH_CACHE_PREFIX + token, JSON.stringify(payload), AUTH_SESSION_TTL_SEC);
  return { sessionToken: token, user: payload };
}

function authGetSession(token) {
  if (!token) return null;
  var cache = CacheService.getScriptCache();
  var raw = cache.get(AUTH_CACHE_PREFIX + token);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (err) {
    return null;
  }
}

function authDestroySession(token) {
  if (!token) return;
  CacheService.getScriptCache().remove(AUTH_CACHE_PREFIX + token);
}

function authRequire(payload) {
  var token = String((payload && payload.sessionToken) || '').trim();
  var session = authGetSession(token);
  if (!session) {
    return { ok: false, message: 'Sesi tidak valid atau kedaluwarsa. Login ulang.' };
  }
  return { ok: true, session: session };
}

function authHandleLogin(payload) {
  ensureCryptoReady_();
  var username = String(payload.username || '').trim().toLowerCase();
  var password = String(payload.password || '');
  if (!username || !password) {
    return { status: 'error', message: 'Username dan password wajib.' };
  }
  var user = authFindUser(username);
  if (!user || !authVerifyPassword(password, user.passwordHash)) {
    return { status: 'error', message: 'Username atau password salah.' };
  }
  if (user.role === 'mbp') {
    return { status: 'error', message: 'Login manual MBP dinonaktifkan. Gunakan link WhatsApp.' };
  }
  var sess = authCreateSession(user, {});
  return { status: 'success', sessionToken: sess.sessionToken, user: sess.user, backendVersion: AUTH_BACKEND_VERSION };
}

function authHandleLogout(payload) {
  authDestroySession(String(payload.sessionToken || ''));
  return { status: 'success' };
}

function authHandleValidateMagicLink(payload) {
  ensureCryptoReady_();
  var orderId = String(payload.orderId || '').trim();
  var token = String(payload.token || '').trim().toLowerCase();
  var namaMbp = String(payload.namaMbp || '').trim();
  if (!orderId || !token) {
    return { status: 'error', message: 'Link tidak lengkap (order/token).' };
  }

  var row = findOrderRowById(orderId);
  if (!row) {
    return { status: 'error', message: 'Tiket tidak ditemukan. Pastikan OMC sudah mengirim dispatch ke server.' };
  }
  var storedToken = String(row.dispatchToken || '').trim().toLowerCase();
  if (!storedToken || storedToken !== token) {
    return { status: 'error', message: 'Token link tidak valid atau sudah kedaluwarsa.' };
  }
  if (namaMbp && row.namaMbp && row.namaMbp !== namaMbp) {
    return { status: 'error', message: 'Link ini untuk unit MBP lain.' };
  }
  var st = String(row.status || '').toLowerCase();
  if (st.indexOf('selesai') !== -1) {
    return { status: 'error', message: 'Tiket sudah SELESAI. Link tidak berlaku.' };
  }

  var user = {
    username: 'mbp_' + orderId,
    role: 'mbp',
    name: row.namaMbp || namaMbp,
    nop: row.nop || '',
    unit: row.namaMbp || namaMbp
  };
  var sess = authCreateSession(user, { orderId: orderId, namaMbp: row.namaMbp || namaMbp });
  return { status: 'success', sessionToken: sess.sessionToken, user: sess.user, backendVersion: AUTH_BACKEND_VERSION };
}

function authHandleListUsers(payload) {
  var auth = authRequire(payload);
  if (!auth.ok) return { status: 'error', message: auth.message };
  if (auth.session.role !== 'admin') {
    return { status: 'error', message: 'Hanya Admin yang boleh melihat daftar akun.' };
  }
  var users = authReadUsers().map(function (u) {
    return {
      username: u.username,
      role: u.role,
      name: u.name,
      nop: u.nop,
      unit: u.unit,
      updatedAt: u.updatedAt
    };
  });
  return { status: 'success', users: users };
}

function authHandleSetPassword(payload) {
  var auth = authRequire(payload);
  if (!auth.ok) return { status: 'error', message: auth.message };
  if (auth.session.role !== 'admin') {
    return { status: 'error', message: 'Hanya Admin yang boleh mengatur password.' };
  }
  var username = String(payload.targetUsername || '').trim().toLowerCase();
  if (!username) return { status: 'error', message: 'targetUsername wajib' };

  var target = authFindUser(username);
  if (!target && payload.createIfMissing) {
    target = {
      username: username,
      role: String(payload.role || 'omc').toLowerCase(),
      name: String(payload.name || username),
      nop: String(payload.nop || ''),
      unit: '',
      passwordHash: ''
    };
  }
  if (!target) return { status: 'error', message: 'User tidak ditemukan.' };

  var newPassword = String(payload.newPassword || '').trim();
  if (!newPassword) {
    newPassword = authGenerateTempPassword();
  }
  if (newPassword.length < 6) {
    return { status: 'error', message: 'Password minimal 6 karakter.' };
  }

  authUpsertUser({
    username: target.username,
    role: target.role || payload.role || 'omc',
    name: target.name || payload.name || username,
    nop: target.nop || payload.nop || '',
    unit: target.unit || '',
    passwordHash: authMakePasswordHash(newPassword)
  });

  return {
    status: 'success',
    username: username,
    newPassword: newPassword,
    users: authHandleListUsers(payload).users
  };
}

function authSyncPersonilFromMaster(masterData) {
  if (!masterData || !masterData.personil) return;
  var defaultHash = authFindUser('omc');
  var hash = defaultHash ? defaultHash.passwordHash : AUTH_BOOTSTRAP_USERS[1].passwordHash;

  masterData.personil.forEach(function (p) {
    if (!p || !p.id) return;
    var username = String(p.id).trim().toLowerCase();
    var existing = authFindUser(username);
    if (existing) {
      authUpsertUser({
        username: username,
        role: 'omc',
        name: p.nama || existing.name,
        nop: p.nop || existing.nop,
        unit: '',
        passwordHash: existing.passwordHash
      });
    } else {
      authUpsertUser({
        username: username,
        role: 'omc',
        name: p.nama || username,
        nop: p.nop || '',
        unit: '',
        passwordHash: hash
      });
    }
  });
}

function authGenerateTempPassword() {
  var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  var out = '';
  for (var i = 0; i < 10; i++) {
    out += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return out;
}

function authCanWriteOrder(session, payload) {
  if (!session) return { ok: false, message: 'Sesi tidak valid.' };
  if (session.role === 'admin' || session.role === 'omc') return { ok: true };
  if (session.role === 'mbp') {
    var oid = String(payload.orderId || '').trim();
    if (!oid || oid !== String(session.orderId || '').trim()) {
      return { ok: false, message: 'MBP hanya boleh mengubah tiket dari link mereka.' };
    }
    return { ok: true };
  }
  return { ok: false, message: 'Role tidak diizinkan menulis.' };
}

function ensureCryptoReady_() {
  if (typeof pbkdf2Sha256 !== 'function') {
    throw new Error('Crypto.gs belum terpasang di project Apps Script.');
  }
}
