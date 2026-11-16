/**
 * Backend MBP Command & Field Monitor (Google Apps Script Web App).
 * Deploy Code.gs, Auth.gs, and Crypto.gs together as a new web-app version.
 */

function getColumns() {
  return [
    'orderId', 'namaMbp', 'noWa', 'siteDestinasi', 'linkMapsSite', 'prioritas',
    'status', 'durasiIdleSebelumOrder', 'estimasiEta', 'selisihOtwEta',
    'tsIdle', 'tsAccept', 'tsOtw', 'tsOnsite', 'tsSelesai', 'totalDurasi',
    'nop', 'dispatchToken'
  ];
}

function doGet() {
  return jsonOut({ status: 'error', message: 'Gunakan POST dan login untuk mengakses data.', backendVersion: authBackendVersion() });
}

function doPost(e) {
  var payload;
  try {
    payload = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return jsonOut({ status: 'error', message: 'Body harus JSON.' });
  }

  try {
    var action = String(payload.action || '');
    if (action === 'login') return jsonOut(authHandleLogin(payload));
    if (action === 'validateMagicLink') return jsonOut(authHandleValidateMagicLink(payload));
    if (action === 'logout') return jsonOut(authHandleLogout(payload));
    if (action === 'validateSession') return jsonOut(authHandleValidateSession(payload));
    if (action === 'listUsers') return jsonOut(authHandleListUsers(payload));
    if (action === 'setPassword') return jsonOut(authHandleSetPassword(payload));

    var auth = authRequire(payload);
    if (!auth.ok) return jsonOut({ status: 'error', message: auth.message });

    if (action === 'read') {
      var records = readRows();
      if (auth.session.role === 'omc') {
        var masterForNop = readMasterJson() || { sites: [] };
        records = records.filter(function (row) {
          if (row.nop) return row.nop === auth.session.nop;
          var siteId = String(row.siteDestinasi || '').split(' ')[0];
          var site = (masterForNop.sites || []).find(function (item) { return item.siteId === siteId || item.nama === row.siteDestinasi; });
          return site && String(site.nop || '') === auth.session.nop;
        });
      } else if (auth.session.role === 'mbp') {
        records = records.filter(function (row) { return row.orderId === auth.session.orderId; });
      } else if (auth.session.role !== 'admin') {
        return jsonOut({ status: 'error', message: 'Role tidak diizinkan membaca data.' });
      }
      var out = { status: 'success', data: records, serverTime: new Date().toISOString(), backendVersion: authBackendVersion() };
      if (auth.session.role === 'admin') out.masterData = readMasterJson();
      return jsonOut(out);
    }

    if (action === 'saveMaster') {
      if (auth.session.role !== 'admin') return jsonOut({ status: 'error', message: 'Hanya Admin yang boleh menyimpan master data.' });
      saveMasterJson(payload.masterData);
      authSyncPersonilFromMaster(payload.masterData);
      return jsonOut({ status: 'success', masterData: readMasterJson(), serverTime: new Date().toISOString(), backendVersion: authBackendVersion() });
    }

    if (action === 'updateStatus') {
      var can = authCanWriteOrder(auth.session, payload);
      if (!can.ok) return jsonOut({ status: 'error', message: can.message });
      if (auth.session.role === 'omc' && payload.orderId) {
        var existing = findOrderRowById(payload.orderId);
        if (existing && existing.nop && existing.nop !== auth.session.nop) return jsonOut({ status: 'error', message: 'Tiket berada di NOP lain.' });
      }
      upsertRow(payload);
      var savedRows = readRows();
      if (auth.session.role === 'omc') savedRows = savedRows.filter(function (row) { return row.nop === auth.session.nop; });
      if (auth.session.role === 'mbp') savedRows = savedRows.filter(function (row) { return row.orderId === auth.session.orderId; });
      return jsonOut({ status: 'success', data: savedRows, serverTime: new Date().toISOString(), backendVersion: authBackendVersion() });
    }
    return jsonOut({ status: 'error', message: 'Aksi tidak dikenal: ' + action });
  } catch (err) {
    return jsonOut({ status: 'error', message: 'Permintaan gagal: ' + err.message });
  }
}

function getSpreadsheetId() {
  return '1TihE0UILTdwP0bUXTu7K6ukbsGGhYFBFAfopYVzBl8Q';
}

function getSheetName() { return 'Sheet1'; }
function getMasterSheetName() { return 'MasterData'; }

function getSpreadsheet() {
  return SpreadsheetApp.openById(getSpreadsheetId());
}

function getSheet() {
  var sheet = getSpreadsheet().getSheetByName(getSheetName());
  if (!sheet) throw new Error('Tab "' + getSheetName() + '" tidak ditemukan.');
  ensureTicketHeaders(sheet);
  return sheet;
}

function ensureTicketHeaders(sheet) {
  var columns = getColumns();
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, columns.length).setValues([columns]);
    return;
  }
  var existing = sheet.getRange(1, 1, 1, 18).getValues()[0];
  var expected = columns.slice(0, 16);
  if (expected.some(function (name, i) { return String(existing[i] || '').trim() !== name; })) {
    throw new Error('Header A:P tidak sesuai. Backup Sheet1 dan periksa urutan kolom sebelum deploy.');
  }
  if (String(existing[16] || '').trim() && String(existing[16]).trim() !== 'nop') throw new Error('Kolom Q sudah terpakai; backup sheet dan pindahkan field sebelum deploy.');
  if (String(existing[17] || '').trim() && String(existing[17]).trim() !== 'dispatchToken') throw new Error('Kolom R sudah terpakai; backup sheet dan pindahkan field sebelum deploy.');
  if (String(existing[16] || '').trim() !== 'nop') sheet.getRange(1, 17).setValue('nop');
  if (String(existing[17] || '').trim() !== 'dispatchToken') sheet.getRange(1, 18).setValue('dispatchToken');
}

function getOrCreateMasterSheet() {
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName(getMasterSheetName());
  if (!sheet) {
    sheet = ss.insertSheet(getMasterSheetName());
    sheet.getRange('A1').setValue('{"personil":[],"sites":[],"units":[]}');
    sheet.getRange('A2').setNote('Satu sel JSON. Dikelola lewat dashboard Admin.');
  }
  return sheet;
}

function readMasterJson() {
  var sheet = getSpreadsheet().getSheetByName(getMasterSheetName());
  if (!sheet) return null;
  var raw = sheet.getRange('A1').getValue();
  if (!raw) return null;
  try { return JSON.parse(String(raw)); } catch (err) { throw new Error('JSON MasterData!A1 tidak valid.'); }
}

function saveMasterJson(obj) {
  if (!obj || !Array.isArray(obj.personil) || !Array.isArray(obj.sites) || !Array.isArray(obj.units)) {
    throw new Error('masterData harus berisi personil, sites, dan units berupa array.');
  }
  getOrCreateMasterSheet().getRange('A1').setValue(JSON.stringify(obj));
}

function readRows() {
  var sheet = getSheet();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  var columns = getColumns();
  var values = sheet.getRange(2, 1, lastRow - 1, columns.length).getValues();
  var out = [];
  for (var i = 0; i < values.length; i++) {
    var row = values[i];
    var obj = { rowIndex: i + 2 };
    for (var c = 0; c < columns.length; c++) obj[columns[c]] = cellToString(row[c]);
    if (obj.orderId) out.push(obj);
  }
  return out;
}

function findOrderRowById(orderId) {
  orderId = String(orderId || '').trim();
  var rows = readRows();
  for (var i = 0; i < rows.length; i++) if (rows[i].orderId === orderId) return rows[i];
  return null;
}

function cellToString(value) {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function upsertRow(payload) {
  var orderId = String(payload.orderId || '').trim();
  if (!orderId || orderId === '-') throw new Error('orderId wajib diisi dan tidak boleh "-".');
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sheet = getSheet();
    var lastRow = sheet.getLastRow();
    var targetRow = -1;
    if (lastRow >= 2) {
      var ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
      for (var i = 0; i < ids.length; i++) {
        if (String(ids[i][0]).trim() === orderId) { targetRow = i + 2; break; }
      }
    }
    var isNew = targetRow === -1;
    if (isNew) targetRow = lastRow + 1;
    var values = buildRow(payload, isNew);
    var columns = getColumns();
    if (isNew) {
      sheet.getRange(targetRow, 1, 1, columns.length).setValues([values]);
    } else {
      var existing = sheet.getRange(targetRow, 1, 1, columns.length).getValues()[0];
      var merged = values.map(function (incoming, index) {
        return incoming === '' ? cellToString(existing[index]) : incoming;
      });
      sheet.getRange(targetRow, 1, 1, columns.length).setValues([merged]);
    }
    return targetRow;
  } finally {
    lock.releaseLock();
  }
}

function buildRow(payload, isNew) {
  var now = new Date().toISOString();
  var status = str(payload.newStatus) || str(payload.status) || 'Belum OTW';
  return [
    String(payload.orderId), str(payload.namaMbp), str(payload.noWa), str(payload.siteDestinasi),
    str(payload.linkMapsSite), str(payload.prioritas), status,
    str(payload.durasiIdleSebelumOrder) || (isNew ? '-' : ''),
    str(payload.estimasiEta) || (isNew ? '-' : ''), str(payload.selisihOtwEta) || (isNew ? '-' : ''),
    str(payload.tsIdle) || str(payload.lastIdleTimestamp) || '',
    str(payload.tsAccept) || (isNew ? now : ''),
    /^otw/i.test(status) ? (str(payload.tsOtw) || now) : str(payload.tsOtw),
    str(payload.tsOnsite), str(payload.tsSelesai),
    str(payload.totalDurasi) || (isNew ? 'Menunggu MBP Accept' : ''),
    str(payload.nop), str(payload.dispatchToken)
  ];
}

function str(value) {
  return value === null || value === undefined ? '' : String(value);
}

function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
