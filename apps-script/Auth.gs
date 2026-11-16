/**
 * Autentikasi server-side: login PBKDF2 (Crypto.gs), sesi, magic link, kelola user Admin.
 * Tab spreadsheet: Auth_Users (kolom A–G).
 */

var AUTH_BACKEND_VERSION = 3;
var AUTH_SESSION_TTL_SEC = 12 * 60 * 60;
var AUTH_USERS_SHEET = 'Auth_Users';
var AUTH_CACHE_PREFIX = 'sess:';
var AUTH_HASH_ITERATIONS = 10000;
var AUTH_BOOTSTRAP_USERS = [{
  username: 'admin', role: 'admin', name: 'Administrator Master Data', nop: '', unit: '',
  passwordHash: ''
}];
// Password awal admin TIDAK disimpan di source. Operator wajib membuat
// Script Property `INITIAL_ADMIN_PASSWORD` sendiri sebelum bootstrap pertama.

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
  }
  if (sheet.getLastRow() < 2) authBootstrapIfEmpty_(sheet);
  return sheet;
}

function authBootstrapIfEmpty_(sheet) {
  var initialPassword = PropertiesService.getScriptProperties().getProperty('INITIAL_ADMIN_PASSWORD');
  if (!initialPassword || initialPassword.length < 8) {
    throw new Error('Set Script Property INITIAL_ADMIN_PASSWORD (minimal 8 karakter) sebelum login pertama.');
  }
  var bootstrapHash = authMakePasswordHash(initialPassword);
  AUTH_BOOTSTRAP_USERS[0].passwordHash = bootstrapHash;
  sheet.getRange(2, 1, 1, 7).setValues([[
    'admin', 'admin', 'Administrator Master Data', '', '', bootstrapHash, new Date().toISOString()
  ]]);
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
  var saltHex = '';
  while (saltHex.length < 32) {
    var sample = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, Utilities.getUuid() + Utilities.getUuid());
    for (var i = 0; i < sample.length && saltHex.length < 32; i++) {
      var value = sample[i] & 255;
      saltHex += (value < 16 ? '0' : '') + value.toString(16);
    }
  }
  saltHex = saltHex.slice(0, 32);
  var hashHex = pbkdf2Sha256(String(password), saltHex, AUTH_HASH_ITERATIONS, 32);
  return 'pbkdf2$' + AUTH_HASH_ITERATIONS + '$' + saltHex + '$' + hashHex;
}

function authUpsertUser(record) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sheet = getAuthUsersSheet();
    var username = String(record.username || '').trim().toLowerCase();
    if (!username) throw new Error('username wajib');
    var existing = authFindUser(username);
    var row = [username, str(record.role), str(record.name), str(record.nop), str(record.unit), str(record.passwordHash), new Date().toISOString()];
    if (existing && existing.rowIndex) sheet.getRange(existing.rowIndex, 1, 1, 7).setValues([row]);
    else sheet.appendRow(row);
  } finally {
    lock.releaseLock();
  }
}

function authCreateSession(user, extra) {
  extra = extra || {};
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, Utilities.getUuid() + Utilities.getUuid());
  var token = '';
  for (var i = 0; i < bytes.length; i++) {
    var value = bytes[i] & 255;
    token += (value < 16 ? '0' : '') + value.toString(16);
  }
  token += Utilities.getUuid().replace(/-/g, '');
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
  if (!session) return { ok: false, message: 'Sesi tidak valid atau kedaluwarsa. Login ulang.' };
  var account = authFindUser(session.username);
  if (session.role !== 'mbp' && (!account || account.role !== session.role)) {
    authDestroySession(token);
    return { ok: false, message: 'Akun tidak aktif.' };
  }
  if (account) {
    session.name = account.name;
    session.nop = account.nop;
    session.unit = account.unit;
    if (account.role === 'omc') {
      var master = readMasterJson() || { personil: [] };
      var person = (master.personil || []).find(function (p) { return String(p.id || '').trim().toLowerCase() === account.username; });
      if (!person || String(person.nop || '') !== account.nop) {
        authDestroySession(token);
        return { ok: false, message: 'Akun OMC tidak aktif di MasterData.' };
      }
    }
    CacheService.getScriptCache().put(AUTH_CACHE_PREFIX + token, JSON.stringify(session), AUTH_SESSION_TTL_SEC);
  }
  return { ok: true, session: session };
}

function authHandleValidateSession(payload) {
  var auth = authRequire(payload);
  if (!auth.ok) return { status: 'error', message: auth.message };
  return { status: 'success', user: auth.session, backendVersion: AUTH_BACKEND_VERSION };
}

function authHandleLogin(payload) {
  ensureCryptoReady_();
  var username = String(payload.username || '').trim().toLowerCase();
  var password = String(payload.password || '');
  if (!username || !password) return { status: 'error', message: 'Username dan password wajib.' };
  var user = authFindUser(username);
  if (!user && username === 'admin') {
    var bootstrapPassword = PropertiesService.getScriptProperties().getProperty('INITIAL_ADMIN_PASSWORD');
    var bootstrapHash = AUTH_BOOTSTRAP_USERS[0].passwordHash;
    if (bootstrapPassword && authVerifyPassword(password, bootstrapHash)) {
      authUpsertUser({ username: 'admin', role: 'admin', name: 'Administrator Master Data', nop: '', unit: '', passwordHash: bootstrapHash });
      PropertiesService.getScriptProperties().deleteProperty('INITIAL_ADMIN_PASSWORD');
      user = authFindUser('admin');
    }
  }
  if (!user || !authVerifyPassword(password, user.passwordHash)) return { status: 'error', message: 'Username atau password salah.' };
  if (user.role !== 'admin' && user.role !== 'omc') return { status: 'error', message: 'Role tidak diizinkan login di dashboard ini.' };
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
  if (!orderId || !token || !namaMbp) return { status: 'error', message: 'Link tidak lengkap.' };
  var row = findOrderRowById(orderId);
  if (!row) return { status: 'error', message: 'Tiket tidak ditemukan.' };
  var storedToken = String(row.dispatchToken || '').trim().toLowerCase();
  if (!storedToken || !safeEquals(storedToken, token)) return { status: 'error', message: 'Token link tidak valid.' };
  if (row.namaMbp !== namaMbp) return { status: 'error', message: 'Link ini untuk unit MBP lain.' };
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
      needsPasswordSetup: !u.passwordHash,
      updatedAt: u.updatedAt
    };
  });
  return { status: 'success', users: users };
}

function authHandleSetPassword(payload) {
  var auth = authRequire(payload);
  if (!auth.ok) return { status: 'error', message: auth.message };
  if (auth.session.role !== 'admin') return { status: 'error', message: 'Hanya Admin yang boleh mengatur akun.' };
  var username = String(payload.targetUsername || '').trim().toLowerCase();
  var role = String(payload.role || 'omc').trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,40}$/.test(username) || (role !== 'admin' && role !== 'omc')) return { status: 'error', message: 'Username atau role tidak valid.' };
  if (username === 'admin' && auth.session.username !== 'admin') return { status: 'error', message: 'Hanya akun admin utama yang dapat mengatur admin.' };

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var target = authFindUser(username);
    if (target && target.role !== role) return { status: 'error', message: 'Role akun yang sudah ada tidak dapat diubah di sini.' };
    if (!target && !payload.createIfMissing) return { status: 'error', message: 'User tidak ditemukan.' };

    var newPassword = String(payload.newPassword || '');
    if (newPassword.length < 8 || newPassword.length > 128) return { status: 'error', message: 'Password harus 8–128 karakter.' };
    var master = readMasterJson() || { personil: [], sites: [], units: [] };
    var person = (master.personil || []).find(function (p) { return String(p.id || '').trim().toLowerCase() === username; });
    if (role === 'omc' && !person) return { status: 'error', message: 'Akun OMC harus terdaftar sebagai personil dengan ID yang sama.' };
    if (target && role === 'omc' && String(person.nop || '') !== target.nop) return { status: 'error', message: 'NOP pada akun berbeda dengan MasterData.' };
    if (role === 'admin' && username !== 'admin') return { status: 'error', message: 'Hanya akun admin utama yang dapat disunting.' };

    authUpsertUser({
      username: username,
      role: target ? target.role : role,
      name: target ? target.name : String(payload.name || (person && person.nama) || username),
      nop: target ? target.nop : String(payload.nop || (person && person.nop) || ''),
      unit: target ? target.unit : '',
      passwordHash: authMakePasswordHash(newPassword)
    });
    if (username === 'admin') PropertiesService.getScriptProperties().deleteProperty('INITIAL_ADMIN_PASSWORD');
    return { status: 'success', username: username, users: authHandleListUsers(payload).users };
  } finally {
    lock.releaseLock();
  }
}

function authSyncPersonilFromMaster(masterData) {
  if (!masterData || !Array.isArray(masterData.personil)) return;
  masterData.personil.forEach(function (p) {
    if (!p || !p.id) return;
    var username = String(p.id).trim().toLowerCase();
    var existing = authFindUser(username);
    if (existing && existing.role === 'omc') {
      authUpsertUser({ username: username, role: 'omc', name: p.nama || existing.name, nop: p.nop || existing.nop, unit: '', passwordHash: existing.passwordHash });
    }
  });
}

function authGenerateTempPassword() {
  var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  var out = '';
  while (out.length < 12) {
    var sample = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, Utilities.getUuid());
    for (var i = 0; i < sample.length && out.length < 12; i++) {
      var value = sample[i] & 255;
      if (value < 248) out += chars.charAt(value % chars.length);
    }
  }
  return out;
}

function authCanWriteOrder(session, payload) {
  if (!session) return { ok: false, message: 'Sesi tidak valid.' };
  if (session.role === 'admin') return { ok: true };
  if (session.role === 'omc') {
    var account = authFindUser(session.username);
    var master = readMasterJson() || { personil: [], sites: [], units: [] };
    var person = (master.personil || []).find(function (p) { return String(p.id || '').trim().toLowerCase() === session.username; });
    if (!account || account.role !== 'omc' || !person || account.nop !== session.nop || person.nop !== session.nop) {
      return { ok: false, message: 'Akun OMC atau NOP sudah tidak aktif.' };
    }
    var orderNop = String(payload.nop || '').trim();
    if (!orderNop) {
      var master = readMasterJson() || { sites: [] };
      var siteId = String(payload.siteDestinasi || '').split(' ')[0];
      var site = (master.sites || []).find(function (s) { return s.siteId === siteId || s.nama === payload.siteDestinasi; });
      orderNop = site ? String(site.nop || '') : '';
    }
    return orderNop && orderNop === session.nop
      ? { ok: true }
      : { ok: false, message: 'OMC hanya boleh mengubah tiket untuk NOP akunnya.' };
  }
  if (session.role === 'mbp') {
    var oid = String(payload.orderId || '').trim();
    var row = findOrderRowById(oid);
    if (!oid || oid !== String(session.orderId || '').trim() || !row || row.namaMbp !== session.namaMbp) {
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
