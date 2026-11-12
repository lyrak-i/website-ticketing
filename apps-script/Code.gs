/**
 * Backend MBP Command & Field Monitor (Google Apps Script Web App)
 *
 * Deploy:
 *   1. Extensions > Apps Script >New project
 *   2. Tempel SELURUH file ini (jangan dipotong)
 *   3. Deploy > New deployment > Web app
 *      - Execute as: Me
 *      - Who has access: Anyone
 *   4. Salin URL /exec ke js/config.js (DEFAULT_GAS_URL)
 *   5. Kalau Sheet/tab berbeda, ubah getSpreadsheetId() dan getSheetName()
 *
 * Setiap perubahan kode: Deploy > Manage deployments > Edit > Version: New version > Deploy.
 *
 * Kontrak API:
 *   GET  /exec  -> { status, data: [...], masterData?, serverTime }
 *   POST /exec  -> { action: "updateStatus", ... } | { action: "saveMaster", masterData: {...} }
 *                  -> upsert baris berdasarkan orderId, lalu balas data terbaru
 *
 * Baris dengan orderId "-" adalah baris placeholder (unit standby) dan tidak
 * pernah di-update lewat updateStatus.
 */

// Urutan kolom harus sama dengan header sheet.
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
    'totalDurasi'
  ];
}

function doGet() {
  var master = readMasterJson();
  var out = { status: 'success', data: readRows(), serverTime: new Date().toISOString() };
  if (master) out.masterData = master;
  return jsonOut(out);
}

function doPost(e) {
  var payload = {};
  try {
    payload = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return jsonOut({ status: 'error', message: 'Body harus JSON: ' + err.message });
  }

  try {
    if (payload.action === 'updateStatus') {
      upsertRow(payload);
    } else if (payload.action === 'saveMaster') {
      saveMasterJson(payload.masterData);
    } else {
      return jsonOut({ status: 'error', message: 'Aksi tidak dikenal: ' + payload.action });
    }
  } catch (err) {
    return jsonOut({ status: 'error', message: 'Gagal menulis: ' + err.message });
  }

  var master = readMasterJson();
  var out = { status: 'success', data: readRows(), serverTime: new Date().toISOString() };
  if (master) out.masterData = master;
  return jsonOut(out);
}

// ---------------------------------------------------------------- konfigurasi
// Nilai dikunci di dalam fungsi supaya tetap jalan walau baris deklarasi
// terpotong saat copy-paste ke editor Apps Script.

function getSpreadsheetId() {
  return '1TihE0UILTdwP0bUXTu7K6ukbsGGhYFBFAfopYVzBl8Q';
}

function getSheetName() {
  return 'Sheet1';
}

function getMasterSheetName() {
  return 'MasterData';
}

// ---------------------------------------------------------------- master JSON (personil / sites / units)

function getOrCreateMasterSheet() {
  var ss = SpreadsheetApp.openById(getSpreadsheetId());
  var name = getMasterSheetName();
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.getRange('A1').setValue('{}');
    sheet.getRange('A2').setNote(
      'Satu sel JSON: { personil:[], sites:[], units:[] }. Diisi otomatis dari halaman Admin web.'
    );
  }
  return sheet;
}

function readMasterJson() {
  var sheet = SpreadsheetApp.openById(getSpreadsheetId()).getSheetByName(getMasterSheetName());
  if (!sheet) return null;
  var raw = sheet.getRange('A1').getValue();
  if (!raw) return null;
  try {
    return JSON.parse(String(raw));
  } catch (e) {
    return null;
  }
}

function saveMasterJson(obj) {
  if (!obj || typeof obj !== 'object') throw new Error('masterData wajib objek JSON');
  var sheet = getOrCreateMasterSheet();
  sheet.getRange('A1').setValue(JSON.stringify(obj));
}

// ---------------------------------------------------------------- baca sheet

function getSheet() {
  var ss = SpreadsheetApp.openById(getSpreadsheetId());
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

// ---------------------------------------------------------------- tulis sheet

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

  // timestamp accept: saat order dibuat (dispatch OMC)
  row.push(str(payload.tsAccept) || (isNew ? now : ''));

  // timestamp OTW: diisi saat status jadi "OTW to Site"
  var isOtw = /^otw/i.test(status);
  row.push(isOtw ? (str(payload.tsOtw) || now) : (str(payload.tsOtw) || ''));

  // timestamp onsite / selesai
  row.push(str(payload.tsOnsite) || '');
  row.push(str(payload.tsSelesai) || '');

  // totalDurasi
  row.push(str(payload.totalDurasi) || (isNew ? 'Menunggu MBP Accept' : ''));

  return row;
}

function str(v) {
  if (v === null || v === undefined) return '';
  return String(v);
}

// ---------------------------------------------------------------- response

function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}
