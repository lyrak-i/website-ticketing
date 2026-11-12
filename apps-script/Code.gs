/**
 * Backend MBP Command & Field Monitor (Google Apps Script Web App)
 *
 * Deploy:
 *   1. Extensions > Apps Script
 *   2. Tempel SELURUH file ini ke Code.gs (jangan dipotong)
 *   3. Deploy > Manage deployments > Edit > Version: New version > Deploy
 *
 * Kontrak API:
 *   GET  /exec  -> { status: "success", data: [...], masterData: {...}, serverTime }
 *   POST /exec  -> body JSON { action: "updateStatus", ... } ATAU { action: "saveMaster", masterData: {...} }
 */

// Urutan kolom harus sama dengan header sheet MBP_Monitoring (A1:P1).
function getColumns() {
  return [
    'orderId',
    'namaMbp',
    'noWa',
    'siteDestinasi',
    'linkMapsSite',
    'prioritas',
    'status',
    'durasiIdleSebelumOrder',
    'estimasiEta',
    'selisihOtwEta',
    'tsIdle',
    'tsAccept',
    'tsOtw',
    'tsOnsite',
    'tsSelesai',
    'totalDurasi',
    'nop', // Kolom Q: Pengunci NOP historis
    'dispatchToken' // Kolom R: token magic link (hanya OMC yang tahu saat dispatch)
  ];
}

function doGet() {
  return jsonOut({
    status: 'success',
    data: readRows(),
    masterData: readMasterData(),
    serverTime: new Date().toISOString(),
    backendVersion: typeof authBackendVersion === 'function' ? authBackendVersion() : 1
  });
}

function doPost(e) {
  var payload = {};
  try {
    payload = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return jsonOut({ status: 'error', message: 'Body harus JSON: ' + err.message });
  }

  var action = String(payload.action || '');

  if (action === 'login') return jsonOut(authHandleLogin(payload));
  if (action === 'logout') return jsonOut(authHandleLogout(payload));
  if (action === 'validateMagicLink') return jsonOut(authHandleValidateMagicLink(payload));
  if (action === 'listUsers') return jsonOut(authHandleListUsers(payload));
  if (action === 'setPassword') return jsonOut(authHandleSetPassword(payload));

  var auth = authRequire(payload);
  if (!auth.ok) {
    return jsonOut({ status: 'error', message: auth.message });
  }

  try {
    if (action === 'updateStatus') {
      var can = authCanWriteOrder(auth.session, payload);
      if (!can.ok) return jsonOut({ status: 'error', message: can.message });
      upsertRow(payload);
    } else if (action === 'saveMaster' && payload.masterData) {
      if (auth.session.role !== 'admin') {
        return jsonOut({ status: 'error', message: 'Hanya Admin yang boleh menyimpan master data.' });
      }
      writeMasterData(payload.masterData);
      authSyncPersonilFromMaster(payload.masterData);
    } else {
      return jsonOut({ status: 'error', message: 'Aksi tidak dikenal: ' + action });
    }
  } catch (err) {
    return jsonOut({ status: 'error', message: 'Gagal menulis: ' + err.message });
  }

  return jsonOut({
    status: 'success',
    data: readRows(),
    masterData: readMasterData(),
    serverTime: new Date().toISOString(),
    backendVersion: authBackendVersion()
  });
}

// ---------------------------------------------------------------- konfigurasi

function getSheetName() {
  return 'MBP_Monitoring';
}

function getMasterSheetName() {
  return 'Master_Data';
}

function getSpreadsheet() {
  // Gunakan active spreadsheet jika script terikat langsung ke Sheet,
  // atau fallback ke openById jika dijalankan terpisah.
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (ss) return ss;
  throw new Error('Spreadsheet tidak ditemukan. Pastikan script dibuat dari menu Extensions > Apps Script di dalam Google Sheet Anda.');
}

// ---------------------------------------------------------------- baca/tulis MBP_Monitoring

function getSheet() {
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName(getSheetName()) || ss.getSheets()[0];
  if (!sheet) throw new Error('Sheet "' + getSheetName() + '" tidak ditemukan');
  return sheet;
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
    for (var c = 0; c < columns.length; c++) {
      obj[columns[c]] = cellToString(row[c]);
    }
    if (!obj.orderId) continue;
    out.push(obj);
  }
  return out;
}

function cellToString(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

function findOrderRowById(orderId) {
  var id = String(orderId || '').trim();
  if (!id) return null;
  var rows = readRows();
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].orderId || '').trim() === id) return rows[i];
  }
  return null;
}

function upsertRow(payload) {
  var orderId = String(payload.orderId || '').trim();
  if (!orderId || orderId === '-') {
    throw new Error('orderId wajib diisi (tidak boleh "-")');
  }

  var sheet = getSheet();
  var lastRow = sheet.getLastRow();

  // Cari baris dengan orderId yang sama -> update; kalau tidak ada -> append.
  var targetRow = -1;
  if (lastRow >= 2) {
    var ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    for (var i = 0; i < ids.length; i++) {
      if (String(ids[i][0]).trim() === orderId) {
        targetRow = i + 2;
        break;
      }
    }
  }

  var isNew = targetRow === -1;
  if (isNew) targetRow = lastRow + 1;

  // Kolom yang terisi dari payload (tidak menimpa nilai lama dengan kosong).
  var values = buildRow(payload, isNew);
  var columns = getColumns();

  if (isNew) {
    sheet.getRange(targetRow, 1, 1, columns.length).setValues([values]);
  } else {
    var existing = sheet.getRange(targetRow, 1, 1, columns.length).getValues()[0];
    var merged = [];
    for (var c = 0; c < columns.length; c++) {
      var incoming = values[c];
      merged.push(incoming === '' ? cellToString(existing[c]) : incoming);
    }
    sheet.getRange(targetRow, 1, 1, columns.length).setValues([merged]);
  }

  return targetRow;
}

function buildRow(payload, isNew) {
  var now = new Date().toISOString();
  var row = [];

  // orderId
  row.push(String(payload.orderId));

  // namaMbp, noWa, siteDestinasi, linkMapsSite, prioritas
  row.push(str(payload.namaMbp));
  row.push(str(payload.noWa));
  row.push(str(payload.siteDestinasi));
  row.push(str(payload.linkMapsSite));
  row.push(str(payload.prioritas));

  // status: label dari client (mis. "Belum OTW"), atau kunci canonical
  var status = str(payload.newStatus) || str(payload.status) || 'Belum OTW';
  row.push(status);

  // durasiIdleSebelumOrder
  row.push(str(payload.durasiIdleSebelumOrder) || (isNew ? '-' : ''));

  // estimasiEta, selisihOtwEta
  row.push(str(payload.estimasiEta) || (isNew ? '-' : ''));
  row.push(str(payload.selisihOtwEta) || (isNew ? '-' : ''));

  // timestamp idle
  row.push(str(payload.tsIdle) || str(payload.lastIdleTimestamp) || '');

  // timestamp Belum OTW (dispatch OMC)
  row.push(str(payload.tsAccept) || (isNew ? now : ''));

  // timestamp OTW: diisi saat status jadi "OTW to Site"
  var isOtw = /^otw/i.test(status);
  row.push(isOtw ? (str(payload.tsOtw) || now) : (str(payload.tsOtw) || ''));

  // timestamp onsite / selesai
  row.push(str(payload.tsOnsite) || '');
  row.push(str(payload.tsSelesai) || '');

  // totalDurasi
  row.push(str(payload.totalDurasi) || (isNew ? 'Menunggu MBP Accept' : ''));

  row.push(str(payload.nop) || '');
  row.push(str(payload.dispatchToken) || '');

  return row;
}

// ---------------------------------------------------------------- baca/tulis Master_Data
// ponytail: full-overwrite seluruh tab Master_Data setiap kali Admin klik Simpan, upgrade when: total baris master data > 1.000 baris

function readMasterData() {
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName(getMasterSheetName());
  if (!sheet || sheet.getLastRow() < 2) return null;

  var rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 7).getValues();
  var out = { personil: [], units: [], sites: [] };

  for (var i = 0; i < rows.length; i++) {
    var kat = String(rows[i][0]).trim().toLowerCase();
    var id = String(rows[i][1]).trim();
    var nama = String(rows[i][2]).trim();
    var nop = String(rows[i][3]).trim();
    var noWa = String(rows[i][4]).trim();
    if (!id) continue;

    if (kat === 'personil') {
      out.personil.push({ id: id, nama: nama, nop: nop });
    } else if (kat === 'units') {
      out.units.push({ id: id, nama: nama, nop: nop, noWa: noWa });
    } else if (kat === 'sites') {
      out.sites.push({
        siteId: id,
        nama: nama,
        nop: nop,
        lat: Number(rows[i][5]) || 0,
        lng: Number(rows[i][6]) || 0
      });
    }
  }
  return out;
}

function writeMasterData(md) {
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName(getMasterSheetName()) || ss.insertSheet(getMasterSheetName());
  var rows = [['Kategori', 'ID', 'Nama', 'NOP', 'No. WA', 'Latitude', 'Longitude']];

  (md.personil || []).forEach(function(p) {
    if (!p || !p.id) return;
    rows.push(['personil', str(p.id), str(p.nama), str(p.nop), '', '', '']);
  });

  (md.units || []).forEach(function(u) {
    if (!u || !u.id) return;
    rows.push(['units', str(u.id), str(u.nama), str(u.nop), str(u.noWa), '', '']);
  });

  (md.sites || []).forEach(function(s) {
    if (!s || !s.siteId) return;
    rows.push(['sites', str(s.siteId), str(s.nama), str(s.nop), '', Number(s.lat) || 0, Number(s.lng) || 0]);
  });

  sheet.clearContents();
  sheet.getRange(1, 1, rows.length, 7).setValues(rows);
}

// ---------------------------------------------------------------- helper & response

function str(v) {
  if (v === null || v === undefined) return '';
  return String(v);
}

function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}