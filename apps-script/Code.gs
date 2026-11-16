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

function getSheetHeaders() {
  return [
    'Order ID', 'Nama MBP', 'Nomor WhatsApp MBP', 'Site Destinasi', 'Link Maps Site', 'Prioritas',
    'Status Saat Ini', 'Durasi Idle Sebelum Order', 'Estimasi ETA', 'Selisih OTW vs ETA',
    'Timestamp Awal Idle', 'Timestamp Belum OTW (Dispatch)', 'Timestamp Awal OTW',
    'Timestamp Awal Onsite', 'Timestamp Selesai', 'Total Durasi per Status',
    'NOP', 'Dispatch Token'
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
      var masterObj = readMasterJson() || { personil: [], sites: [], units: [] };
      if (auth.session.role === 'omc' && auth.session.nop) {
        records = records.filter(function (row) {
          if (row.nop) return row.nop === auth.session.nop;
          var siteId = String(row.siteDestinasi || '').split(' ')[0];
          var site = (masterObj.sites || []).find(function (item) {
            return item.siteId === siteId || item.nama === row.siteDestinasi;
          });
          return site && String(site.nop || '') === auth.session.nop;
        });
      } else if (auth.session.role === 'mbp') {
        records = records.filter(function (row) { return row.orderId === auth.session.orderId; });
      } else if (auth.session.role !== 'admin' && auth.session.role !== 'omc') {
        return jsonOut({ status: 'error', message: 'Role tidak diizinkan membaca data.' });
      }
      return jsonOut({
        status: 'success', data: records, masterData: masterObj,
        serverTime: new Date().toISOString(), backendVersion: authBackendVersion()
      });
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
      if (auth.session.role === 'omc' && auth.session.nop && payload.orderId) {
        var existing = findOrderRowById(payload.orderId);
        if (existing && existing.nop && existing.nop !== auth.session.nop) {
          return jsonOut({ status: 'error', message: 'Tiket berada di NOP lain.' });
        }
      }
      upsertRow(payload);
      var savedRows = readRows();
      var masterForResponse = readMasterJson() || { sites: [] };
      if (auth.session.role === 'omc' && auth.session.nop) {
        savedRows = savedRows.filter(function (row) {
          if (row.nop) return row.nop === auth.session.nop;
          var siteId = String(row.siteDestinasi || '').split(' ')[0];
          var site = (masterForResponse.sites || []).find(function (item) { return item.siteId === siteId || item.nama === row.siteDestinasi; });
          return site && String(site.nop || '') === auth.session.nop;
        });
      }
      if (auth.session.role === 'mbp') {
        savedRows = savedRows.filter(function (row) { return row.orderId === auth.session.orderId; });
      }
      return jsonOut({ status: 'success', data: savedRows, serverTime: new Date().toISOString(), backendVersion: authBackendVersion() });
    }
    return jsonOut({ status: 'error', message: 'Aksi tidak dikenal: ' + action });
  } catch (err) {
    return jsonOut({ status: 'error', message: 'Permintaan gagal: ' + err.message });
  }
}

function getSpreadsheet() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

function getSheetName() { return 'MBP_Monitoring'; }
function getMasterSheetName() { return 'Master_Data'; }

function getSheet() {
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName(getSheetName()) || ss.getSheetByName('Sheet1');
  if (!sheet) throw new Error('Tab "' + getSheetName() + '" tidak ditemukan.');
  ensureTicketHeaders(sheet);
  return sheet;
}

function ensureTicketHeaders(sheet) {
  var headers = getSheetHeaders();
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    return;
  }
  var existing = sheet.getRange(1, 1, 1, 18).getValues()[0];
  if (headers.slice(0, 16).some(function (header, i) { return String(existing[i] || '').trim() !== header; })) {
    throw new Error('Header A:P tidak sesuai. Backup tab tiket dan periksa urutan kolom sebelum deploy.');
  }
  if (String(existing[16] || '').trim() && String(existing[16]).trim() !== headers[16]) {
    throw new Error('Kolom Q sudah terpakai; backup sheet dan pindahkan field sebelum deploy.');
  }
  if (String(existing[17] || '').trim() && String(existing[17]).trim() !== headers[17]) {
    throw new Error('Kolom R sudah terpakai; backup sheet dan pindahkan field sebelum deploy.');
  }
  if (String(existing[16] || '').trim() !== headers[16]) sheet.getRange(1, 17).setValue(headers[16]);
  if (String(existing[17] || '').trim() !== headers[17]) sheet.getRange(1, 18).setValue(headers[17]);
}

function getOrCreateMasterSheet() {
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName(getMasterSheetName()) || ss.getSheetByName('MasterData');
  if (!sheet) {
    sheet = ss.insertSheet(getMasterSheetName());
    sheet.getRange(1, 1, 1, 7).setValues([['Kategori', 'ID', 'Nama', 'NOP', 'No. WA', 'Latitude', 'Longitude']]);
  }
  return sheet;
}

function readMasterJson() {
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName(getMasterSheetName()) || ss.getSheetByName('MasterData');
  if (!sheet) return { personil: [], sites: [], units: [] };
  var lastRow = sheet.getLastRow();
  if (lastRow < 1) return { personil: [], sites: [], units: [] };

  var a1 = String(sheet.getRange(1, 1).getValue() || '').trim();
  if (a1.charAt(0) === '{') {
    try { return JSON.parse(a1); } catch (err) { throw new Error('JSON Master_Data!A1 tidak valid.'); }
  }

  if (lastRow < 2) return { personil: [], sites: [], units: [] };
  var values = sheet.getRange(2, 1, lastRow - 1, 7).getValues();
  var out = { personil: [], sites: [], units: [] };
  for (var i = 0; i < values.length; i++) {
    var row = values[i];
    var kategori = String(row[0] || '').trim().toLowerCase();
    var id = String(row[1] || '').trim();
    var nama = String(row[2] || '').trim();
    var nop = String(row[3] || '').trim();
    var noWa = String(row[4] || '').trim();
    var lat = row[5] !== '' && row[5] !== null ? Number(row[5]) : '';
    var lng = row[6] !== '' && row[6] !== null ? Number(row[6]) : '';
    if (!id && !nama) continue;
    if (kategori === 'personil') out.personil.push({ id: id, nama: nama, nop: nop });
    else if (kategori === 'units' || kategori === 'unit') out.units.push({ id: id, nama: nama, nop: nop, noWa: noWa });
    else if (kategori === 'sites' || kategori === 'site') {
      out.sites.push({ siteId: id, nama: nama || id, nop: nop, lat: isNaN(lat) ? 0 : lat, lng: isNaN(lng) ? 0 : lng });
    }
  }
  return out;
}

function saveMasterJson(obj) {
  if (!obj || !Array.isArray(obj.personil) || !Array.isArray(obj.sites) || !Array.isArray(obj.units)) {
    throw new Error('masterData harus berisi personil, sites, dan units berupa array.');
  }
  var sheet = getOrCreateMasterSheet();
  var rows = [['Kategori', 'ID', 'Nama', 'NOP', 'No. WA', 'Latitude', 'Longitude']];
  obj.personil.forEach(function (p) { rows.push(['personil', str(p.id), str(p.nama), str(p.nop), '', '', '']); });
  obj.units.forEach(function (u) { rows.push(['units', str(u.id), str(u.nama), str(u.nop), str(u.noWa), '', '']); });
  obj.sites.forEach(function (s) { rows.push(['sites', str(s.siteId || s.id), str(s.nama || s.siteId), str(s.nop), '', s.lat ?? '', s.lng ?? '']); });
  sheet.clearContents();
  sheet.getRange(1, 1, rows.length, 7).setValues(rows);
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
  var s = String(value);
  if (s === '#ERROR!' || s === '#VALUE!' || s === '#NAME?') return '-';
  return s;
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
    if (isNew) sheet.getRange(targetRow, 1, 1, columns.length).setValues([values]);
    else {
      var existing = sheet.getRange(targetRow, 1, 1, columns.length).getValues()[0];
      var merged = values.map(function (incoming, index) { return incoming === '' ? cellToString(existing[index]) : incoming; });
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
  var selisih = str(payload.selisihOtwEta) || (isNew ? '-' : '');
  if (selisih.charAt(0) === '-' && selisih.length > 1) selisih = "'" + selisih;
  return [
    String(payload.orderId), str(payload.namaMbp), str(payload.noWa), str(payload.siteDestinasi),
    str(payload.linkMapsSite), str(payload.prioritas), status,
    str(payload.durasiIdleSebelumOrder) || (isNew ? '-' : ''),
    str(payload.estimasiEta) || (isNew ? '-' : ''), selisih,
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
