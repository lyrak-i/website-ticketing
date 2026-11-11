// Konstanta & kunci localStorage hidup di js/config.js (const lintas <script> tidak boleh diulang)
let gasWebAppUrl = localStorage.getItem(STORAGE_KEY_URL) || DEFAULT_GAS_URL;
let activeRole = 'omc';
let selectedMobileMbp = '';

// Filter dashboard dari query string, contoh: index.html?nop=PLM-014
const nopFilter = new URLSearchParams(location.search).get('nop') || '';

// Database Hardcoded Koordinat Site
const SITE_LOCATIONS = [
  { name: 'SITE-PLM-014 (Ilir Barat)', lat: -2.9909, lng: 104.7565 },
  { name: 'SITE-PLM-089 (Seberang Ulu)', lat: -3.0034, lng: 104.7721 },
  { name: 'SITE-PLM-102 (Sukarami)', lat: -2.9189, lng: 104.7088 },
  { name: 'SITE-BTA-012 (Baturaja)', lat: -4.1294, lng: 104.1751 },
  { name: 'SITE-PBM-033 (Prabumulih)', lat: -3.4312, lng: 104.2341 },
  { name: 'SITE-LLG-021 (Lubuklinggau)', lat: -3.2964, lng: 102.8617 }
];

// Master data Admin (Personil OMC / Site List / Unit MBP) — satu kunci localStorage
const MASTER_SEED = {
  personil: [
    { id: 'PSN-01', nama: 'Andi (OMC Palembang)', nop: 'PLM-014' },
    { id: 'PSN-02', nama: 'Budi (OMC Baturaja)', nop: 'BTA-012' }
  ],
  sites: SITE_LOCATIONS.map(s => ({
    siteId: s.name.split(' ')[0],
    nama: s.name,
    nop: s.name.replace(/^SITE-/, '').split(' ')[0],
    lat: s.lat,
    lng: s.lng
  })),
  units: [
    { id: 'MBP-01', nama: 'MBP-01 (Tim Alpha)', noWa: '6281234567801' },
    { id: 'MBP-02', nama: 'MBP-02 (Tim Bravo)', noWa: '6281234567802' },
    { id: 'MBP-03', nama: 'MBP-03 (Tim Charlie)', noWa: '6281234567803' },
    { id: 'MBP-04', nama: 'MBP-04 (Tim Delta)', noWa: '6285175393095' }
  ]
};

let masterData = loadMasterData();

function loadMasterData() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY_MASTER));
    if (saved && saved.personil && saved.sites && saved.units) return saved;
  } catch (err) { /* data rusak -> pakai seed */ }
  return JSON.parse(JSON.stringify(MASTER_SEED));
}

function saveMasterData() {
  localStorage.setItem(STORAGE_KEY_MASTER, JSON.stringify(masterData));
}

// Nop aktif sebuah order: dari Site List dulu, fallback ke nop di record order
function getOrderNop(order) {
  if (!order) return '';
  const site = masterData.sites.find(s => s.siteId === (order.siteDestinasi || '').split(' ')[0]);
  return site ? site.nop : (order.nop || '');
}

function siteNopOf(siteName) {
  const site = masterData.sites.find(s => s.siteId === (siteName || '').split(' ')[0]);
  return site ? site.nop : '';
}

// NOP unit: site aktif, atau NOP order terakhir bila unit sedang idle
function getUnitNop(unit) {
  const active = siteNopOf(unit.activeSite);
  if (active) return active;
  const last = orderList.find(o => o.namaMbp === unit.namaMbp);
  return last ? (getOrderNop(last) || '') : '';
}

function getSiteCoords(siteName) {
  const siteId = (siteName || '').split(' ')[0];
  return masterData.sites.find(s => s.siteId === siteId || s.nama === siteName)
    || SITE_LOCATIONS.find(s => s.name === siteName)
    || null;
}

function getSiteMapsUrl(siteName) {
  const site = getSiteCoords(siteName);
  if (site) {
    return `https://www.google.com/maps/dir/?api=1&destination=${site.lat},${site.lng}`;
  }
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(siteName)}`;
}

function calculateHaversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371.0;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function calculateCarEtaSeconds(distanceKm) {
  // ponytail: estimasi haversine garis lurus 20km/h tidak akurat untuk rute riil, upgrade when: integrasi Maps Matrix API aktif
  const SPEED_KMH = 20.0;
  const hours = distanceKm / SPEED_KMH;
  return Math.round(hours * 3600);
}

function parseDurationSec(str) {
  if (!str || str === '-') return 0;
  const h = (str.match(/(\d+)h/)?.[1] || 0) * 3600;
  const m = (str.match(/(\d+)m/)?.[1] || 0) * 60;
  const s = (str.match(/(\d+)s/)?.[1] || 0) * 1;
  return Number(h) + Number(m) + Number(s);
}

const escapeHtml = str => String(str ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));

let fleetList = [];
let orderList = [];
const issuedOrderIds = new Set();

// shortcut: id unik dijamin di browser ini saja, upgrade when: beberapa OMC dispatch bersamaan
function isOrderIdUsed(id) {
  return orderList.some(o => o.orderId === id)
    || fleetList.some(u => (u.pendingOrder && u.pendingOrder.orderId === id) || u.activeOrderId === id);
}

function makeOrderId() {
  let t = Date.now();
  let id;
  do {
    const d = new Date(t);
    const pad = n => String(n).padStart(2, '0');
    id = `ORD-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
    t += 1000;
  } while (issuedOrderIds.has(id) || isOrderIdUsed(id));
  issuedOrderIds.add(id);
  return id;
}

function generateNewOrderId() {
  const orderId = makeOrderId();
  const input = document.getElementById('dispatchOrderId');
  if (input) input.value = orderId;
  updateWaPreview();
  return orderId;
}

function getSeedFleet() {
  const now = Date.now();
  const minAgo = m => new Date(now - (m * 60000)).toISOString();
  return [
    { namaMbp: 'MBP-01 (Tim Alpha)', noWa: '6281234567801', status: 'idle', activeOrderId: '-', activeSite: '-', activePriority: 'Low', tsIdleStart: minAgo(45), tsCurrentStatusStart: minAgo(45), pendingOrder: null, estimasiEta: '-', selisihOtwEta: '-' },
    { namaMbp: 'MBP-02 (Tim Bravo)', noWa: '6281234567802', status: 'idle', activeOrderId: '-', activeSite: '-', activePriority: 'Low', tsIdleStart: minAgo(120), tsCurrentStatusStart: minAgo(120), pendingOrder: null, estimasiEta: '-', selisihOtwEta: '-' },
    { namaMbp: 'MBP-03 (Tim Charlie)', noWa: '6281234567803', status: 'idle', activeOrderId: '-', activeSite: '-', activePriority: 'Low', tsIdleStart: minAgo(30), tsCurrentStatusStart: minAgo(30), pendingOrder: null, estimasiEta: '-', selisihOtwEta: '-' },
    { namaMbp: 'MBP-04 (Tim Delta)', noWa: '6285175393095', status: 'idle', activeOrderId: '-', activeSite: '-', activePriority: 'Low', tsIdleStart: minAgo(15), tsCurrentStatusStart: minAgo(15), pendingOrder: null, estimasiEta: '-', selisihOtwEta: '-' }
  ];
}

function formatDurationMs(ms) {
  if (!ms || ms < 0) return '00m 00s';
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const pad = n => String(n).padStart(2, '0');
  return h > 0 ? `${pad(h)}h ${pad(m)}m ${pad(s)}s` : `${pad(m)}m ${pad(s)}s`;
}

function formatElapsed(startIso) {
  if (!startIso || startIso === '-') return '00h 00m 00s';
  const startTime = new Date(startIso).getTime();
  if (isNaN(startTime)) return '00h 00m 00s';
  const diffMs = Math.max(0, Date.now() - startTime);
  return formatDurationMs(diffMs);
}

function getStatusBadgeHtml(status) {
  const key = statusKey(status);
  const label = STATUS_LABEL[key];
  const styles = {
    'Idle': 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30',
    'Belum OTW': 'bg-rose-500/15 text-rose-400 border border-rose-500/30',
    'OTW to Site': 'bg-orange-500/15 text-orange-400 border border-orange-500/30',
    'Onsite': 'bg-sky-500/15 text-sky-400 border border-sky-500/30',
    'Waiting Onsite': 'bg-amber-500/15 text-amber-400 border border-amber-500/30',
    'Waiting Selesai': 'bg-amber-500/15 text-amber-400 border border-amber-500/30',
    'Selesai': 'bg-slate-800 text-slate-300 border border-slate-700'
  };
  const dot = {
    'Idle': 'bg-emerald-400',
    'Belum OTW': 'bg-rose-400 animate-pulse',
    'OTW to Site': 'bg-orange-400 animate-ping',
    'Onsite': 'bg-sky-400 animate-pulse',
    'Waiting Onsite': 'bg-amber-400 animate-ping',
    'Waiting Selesai': 'bg-amber-400 animate-ping',
    'Selesai': 'bg-slate-400'
  };
  const cls = styles[label] || styles['Idle'];
  const dotCls = dot[label] || dot['Idle'];
  return `<span class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-semibold ${cls} whitespace-nowrap">
    <span class="w-1.5 h-1.5 rounded-full ${dotCls} shrink-0"></span>
    ${escapeHtml(label)}
  </span>`;
}

function getPriorityBadgeClass(prio) {
  const map = {
    'Critical': 'bg-rose-500/20 text-rose-400 border border-rose-500/40',
    'High': 'bg-orange-500/20 text-orange-400 border border-orange-500/40',
    'Medium': 'bg-amber-500/20 text-amber-300 border border-amber-500/40',
    'Low': 'bg-slate-800 text-slate-300 border border-slate-700'
  };
  return map[prio] || map['Low'];
}

// ============================================================================
// Status transisi MBP & OMC. Kunci kanonik disimpan di unit.status & order.status,
// label hanya untuk tampilan dan payload Sheets.
// ============================================================================
const STATUS_LABEL = {
  idle: 'Idle',
  belum_otw: 'Belum OTW',
  otw: 'OTW to Site',
  waiting_onsite: 'Waiting Onsite',
  onsite: 'Onsite',
  waiting_selesai: 'Waiting Selesai',
  selesai: 'Selesai'
};
const OMC_APPROVALS = {
  waiting_onsite: 'onsite',
  waiting_selesai: 'selesai'
};

// label (huruf besar/legacy Sheets) -> kunci kanonik
const STATUS_KEY = {
  'idle': 'idle',
  'belum otw': 'belum_otw',
  'otw to site': 'otw',
  'waiting onsite': 'waiting_onsite',
  'onsite': 'onsite',
  'waiting selesai': 'waiting_selesai',
  'selesai': 'selesai',
  'accept order': 'otw' // legacy: accept order tanpa tahap OTW
};

function statusKey(value) {
  const v = String(value ?? '').trim();
  if (STATUS_LABEL[v]) return v;
  return STATUS_KEY[v.toLowerCase()] || 'idle';
}

// Tombol dinamis tunggal di layar MBP
const MBP_STEP = {
  idle: { label: 'Terima & OTW', hint: 'Ambil tiket & berangkat ke site', cls: 'amber' },
  belum_otw: { label: 'Terima & OTW', hint: 'Ambil tiket & berangkat ke site', cls: 'amber' },
  otw: { label: 'Tiba di Site', hint: 'Konfirmasi tiba di site, lalu tunggu approval OMC', cls: 'orange' },
  waiting_onsite: { label: 'Menunggu Konfirmasi OMC', hint: 'Tunggu OMC menyetujui kedatangan Anda', disabled: true, cls: 'orange' },
  onsite: { label: 'Selesaikan Pekerjaan', hint: 'Tandai pekerjaan selesai', cls: 'sky' },
  waiting_selesai: { label: 'Menunggu Approval Selesai', hint: 'Tunggu OMC menyetujui penutupan tiket', disabled: true, cls: 'sky' }
};

const BTN_CLS = {
  amber: { active: 'border-amber-500 bg-amber-500/20 text-white shadow-lg shadow-amber-500/10', idle: 'border-amber-500/40 bg-slate-950/70 text-amber-300' },
  orange: { active: 'border-orange-500 bg-orange-500/20 text-white shadow-lg shadow-orange-500/10', idle: 'border-orange-500/30 bg-slate-950/70 text-orange-300' },
  sky: { active: 'border-sky-500 bg-sky-500/20 text-white shadow-lg shadow-sky-500/10', idle: 'border-sky-500/30 bg-slate-950/70 text-sky-300' }
};

function initApp() {
  // 1. Pasang interval timer langsung di awal
  setInterval(tickTimers, 1000);

  // 2. Load data local aman
  try {
    const savedFleet = localStorage.getItem(STORAGE_KEY_FLEET);
    fleetList = savedFleet ? JSON.parse(savedFleet) : getSeedFleet();
    if (!Array.isArray(fleetList) || fleetList.length === 0) fleetList = getSeedFleet();

    const savedOrders = localStorage.getItem(STORAGE_KEY_ORDERS);
    orderList = savedOrders ? JSON.parse(savedOrders) : [];
    if (!Array.isArray(orderList)) orderList = [];
  } catch (err) {
    fleetList = getSeedFleet();
    orderList = [];
  }

  // 2b. Normalisasi status lama (label Sheets) -> kunci kanonik
  fleetList.forEach(u => { u.status = statusKey(u.status); });
  orderList.forEach(o => { o.status = statusKey(o.status); });

  selectedMobileMbp = fleetList[0]?.namaMbp || 'MBP-01 (Tim Alpha)';

  syncFleetFromMaster();
  updateConnectionBadge();
  populateSelectDropdowns();
  generateNewOrderId();
  renderAdminTables();

  const banner = document.getElementById('nopFilterBanner');
  if (banner) {
    banner.classList.toggle('hidden', !nopFilter);
    const val = document.getElementById('nopFilterValue');
    if (val) val.textContent = nopFilter;
  }

  (async () => {
    if (typeof HAS_MAGIC_LINK !== 'undefined' && HAS_MAGIC_LINK && typeof tryMagicLinkAuth === 'function') {
      await tryMagicLinkAuth();
    } else {
      const session = typeof readSession === 'function' ? readSession() : null;
      if (session && typeof applyUser === 'function') {
        applyUser(session, typeof isDemoMode === 'function' ? isDemoMode() : false);
      }
      renderAll();
    }
    if (gasWebAppUrl) await syncFromServer(false);
  })();

  setInterval(() => {
    if (gasWebAppUrl) syncFromServer(false);
  }, 10000);
}

window.addEventListener('storage', (e) => {
  if (e.key === STORAGE_KEY_FLEET && e.newValue) {
    fleetList = JSON.parse(e.newValue);
    renderAll();
  }
  if (e.key === STORAGE_KEY_ORDERS && e.newValue) {
    orderList = JSON.parse(e.newValue);
    renderAll();
  }
}

);

function updateConnectionBadge() {
  const badge = document.getElementById('connectionBadge');
  if (gasWebAppUrl) {
    badge.textContent = 'Sheets Terhubung';
    badge.className = 'text-[10px] sm:text-[11px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 whitespace-nowrap';
  } else {
    badge.textContent = 'Demo Lokal';
    badge.className = 'text-[10px] sm:text-[11px] font-mono px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/30 whitespace-nowrap';
  }
}

function handleMbpDispatchChange() {
  const namaMbp = document.getElementById('dispatchMbpSelect')?.value;
  const waInput = document.getElementById('dispatchWaInput');
  if (!namaMbp || !waInput) return;
  const unit = fleetList.find(m => m.namaMbp === namaMbp);
  if (unit?.noWa) waInput.value = unit.noWa;
  updateWaLink();
}
window.handleMbpDispatchChange = handleMbpDispatchChange;

function populateSelectDropdowns() {
  const omcSelect = document.getElementById('dispatchMbpSelect');
  const mobSelect = document.getElementById('mobileMbpSelect');
  if (!omcSelect || !mobSelect) return;

  const currentOmc = omcSelect.value || fleetList[0]?.namaMbp;
  const currentMob = selectedMobileMbp || fleetList[0]?.namaMbp;

  omcSelect.innerHTML = fleetList.map(m =>
    `<option value="${escapeHtml(m.namaMbp)}">${escapeHtml(m.namaMbp)} — [${escapeHtml(STATUS_LABEL[statusKey(m.status)])}]</option>`
  ).join('');
  omcSelect.value = currentOmc;

  mobSelect.innerHTML = fleetList.map(m =>
    `<option value="${escapeHtml(m.namaMbp)}">${escapeHtml(m.namaMbp)}</option>`
  ).join('');
  mobSelect.value = currentMob;

  // Site List dari master data
  const siteSelect = document.getElementById('dispatchSiteSelect');
  if (siteSelect) {
    const currentSite = siteSelect.value;
    siteSelect.innerHTML = masterData.sites.map(s =>
      `<option value="${escapeHtml(s.nama || s.siteId)}">${escapeHtml(s.nama || s.siteId)} — NOP ${escapeHtml(s.nop)}</option>`
    ).join('');
    if (currentSite && masterData.sites.some(s => s.siteId === currentSite || s.nama === currentSite)) {
      siteSelect.value = currentSite;
    }
  }

  handleMbpDispatchChange();
}

let currentDispatchToken = '';

function generateDispatchToken() {
  const arr = new Uint8Array(6);
  crypto.getRandomValues(arr);
  currentDispatchToken = Array.from(arr, b => b.toString(16).padStart(2, '0')).join('');
  return currentDispatchToken;
}

function buildMagicLinkUrl(orderId, namaMbp, site, prio, token) {
  const base = location.origin + location.pathname;
  const paramsObj = {
    tkn: token,
    oid: orderId,
    mbp: namaMbp,
    site: site,
    prio: prio
  };
  // Otomatis sertakan URL Google Apps Script agar HP teknisi baru langsung terhubung!
  if (gasWebAppUrl) {
    paramsObj.gas = gasWebAppUrl;
  }
  const p = new URLSearchParams(paramsObj);
  return `${base}?${p.toString()}`;
}

function updateWaLink() {
  const orderId = document.getElementById('dispatchOrderId')?.value || 'ORD-...';
  const namaMbp = document.getElementById('dispatchMbpSelect')?.value || 'MBP-01 (Tim Alpha)';
  const rawWa = (document.getElementById('dispatchWaInput')?.value || '').replace(/\D/g, '');
  let phone = rawWa;
  if (phone.startsWith('0')) phone = '62' + phone.substring(1);

  const site = document.getElementById('dispatchSiteSelect')?.value || '...';
  const prio = document.getElementById('dispatchPrioritySelect')?.value || 'High';

  if (!currentDispatchToken) generateDispatchToken();
  const magicUrl = buildMagicLinkUrl(orderId, namaMbp, site, prio, currentDispatchToken);

  const waText = `[Order ID: ${orderId}] Ada masalah di site ${site} (Prioritas: ${prio}).\n\nKlik tautan khusus ini untuk membuka tugas & update status:\n${magicUrl}`;

  const previewEl = document.getElementById('waPreviewText');
  if (previewEl) previewEl.textContent = waText;

  const btn = document.getElementById('btnKirimWa');
  if (btn) {
    btn.href = phone ? `https://wa.me/${phone}?text=${encodeURIComponent(waText)}` : '#';
  }
}

function updateWaPreview() {
  generateDispatchToken();
  updateWaLink();
}

function handleDispatchClick(event) {
  let orderId = document.getElementById('dispatchOrderId')?.value;
  if (!orderId || orderId === '-') {
    orderId = generateNewOrderId();
  }

  const namaMbp = document.getElementById('dispatchMbpSelect').value;
  let rawWa = document.getElementById('dispatchWaInput').value.replace(/\D/g, '');
  const siteDest = document.getElementById('dispatchSiteSelect').value;
  const prioritas = document.getElementById('dispatchPrioritySelect').value;
  const linkMapsSite = getSiteMapsUrl(siteDest);

  if (rawWa.startsWith('0')) rawWa = '62' + rawWa.substring(1);

  if (!rawWa) {
    event.preventDefault();
    alert('Nomor WhatsApp MBP belum diisi!');
    document.getElementById('dispatchWaInput').focus();
    return;
  }

  // Pastikan link WA menggunakan token terbaru sebelum tab WA terbuka
  updateWaLink();

  const unit = fleetList.find(m => m.namaMbp === namaMbp);
  if (unit) {
    const nowIso = new Date().toISOString();
    unit.pendingOrder = {
      orderId,
      token: currentDispatchToken,
      siteDestinasi: siteDest,
      linkMapsSite,
      prioritas,
      nop: siteNopOf(siteDest),
      dispatchedAt: nowIso
    };
    unit.status = 'belum_otw';
    unit.activeOrderId = orderId;
    unit.activeSite = siteDest;
    unit.activePriority = prioritas;
    unit.estimasiEta = '-';
    unit.tsCurrentStatusStart = nowIso;
    unit.noWa = rawWa;
    saveAndBroadcast();
  }

  setTimeout(() => {
    generateNewOrderId();
    updateWaLink();
    renderAll();
  }, 150);
}

// Role 2: Mobile MBP Action
// ============================================================================
// Role 2: satu tombol dinamis di layar MBP
// idle -> otw -> waiting_onsite -> (OMC approve) -> onsite -> waiting_selesai
//       -> (OMC approve) -> selesai -> reset ke idle
// ============================================================================
let statusBusy = false;

async function handleMbpAction() {
  const unit = fleetList.find(m => m.namaMbp === selectedMobileMbp);
  if (!unit || statusBusy) return;

  const from = statusKey(unit.status);
  const step = MBP_STEP[from];
  if (!step || step.disabled) return;

  statusBusy = true;
  try {
    if (from === 'otw') {
      await applyApproval(unit, 'waiting_onsite');
    } else if (from === 'onsite') {
      await applyApproval(unit, 'waiting_selesai');
    } else {
      await beginJob(unit);
    }
  } finally {
    statusBusy = false;
  }
}

// Ambil tiket & langsung OTW (dari state idle)
async function beginJob(unit) {
  // 1. Validasi ke Google Sheets terlebih dahulu agar tidak terjadi duplikasi Order ID
  if (gasWebAppUrl) {
    await syncFromServer(false);
  }

  const nowIso = new Date().toISOString();
  const nowMs = Date.now();
  const idleStartMs = unit.tsIdleStart ? new Date(unit.tsIdleStart).getTime() : nowMs;

  const orderToAccept = unit.pendingOrder;
  if (!orderToAccept) {
    // Cek jika order sebenarnya sudah masuk dari hasil sync Sheets
    const activeFromSheet = orderList.find(o => o.namaMbp === unit.namaMbp && statusKey(o.status) !== 'selesai');
    if (activeFromSheet) {
      renderAll();
      return;
    }
    alert('Belum ada tiket masuk. Buka melalui link tugas WhatsApp dari OMC.');
    return;
  }

  // Cek apakah Order ID ini sudah pernah tercatat di orderList / Google Sheets
  const existingOrder = orderList.find(o => o.orderId === orderToAccept.orderId);
  if (existingOrder) {
    if (statusKey(existingOrder.status) === 'selesai') {
      alert('Tiket ini sudah dikonfirmasi Selesai oleh OMC.');
      unit.pendingOrder = null;
      if (typeof checkMbpSessionExpiry === 'function') checkMbpSessionExpiry();
      return;
    }
    // Jika sudah ada di Sheets, cukup sinkronkan ke unit tanpa unshift baris baru
    unit.status = statusKey(existingOrder.status) === 'idle' ? 'otw' : statusKey(existingOrder.status);
    unit.activeOrderId = existingOrder.orderId;
    unit.activeSite = existingOrder.siteDestinasi;
    unit.activePriority = existingOrder.prioritas;
    unit.pendingOrder = null;
    saveAndBroadcast();
    return;
  }

  const st = statusKey(unit.status);
  if (st !== 'idle' && st !== 'belum_otw') closeOrder(unit, nowIso, nowMs);

  const durasiIdleStr = formatDurationMs(Math.max(0, nowMs - idleStartMs));

  orderList.unshift({
    orderId: orderToAccept.orderId,
    token: orderToAccept.token || '',
    namaMbp: unit.namaMbp,
    noWa: unit.noWa,
    siteDestinasi: orderToAccept.siteDestinasi,
    linkMapsSite: orderToAccept.linkMapsSite || getSiteMapsUrl(orderToAccept.siteDestinasi),
    prioritas: orderToAccept.prioritas,
    nop: orderToAccept.nop || siteNopOf(orderToAccept.siteDestinasi),
    status: 'otw',
    durasiIdleSebelumOrder: durasiIdleStr,
    estimasiEta: '-',
    selisihOtwEta: '-',
    etaSeconds: 0,
    tsIdle: unit.tsIdleStart,
    tsAccept: nowIso,
    tsOtw: nowIso,
    tsOnsite: '',
    tsSelesai: '',
    totalDurasi: 'Idle Sebelum Order: ' + durasiIdleStr
  });

  unit.status = 'otw';
  unit.activeOrderId = orderToAccept.orderId;
  unit.activeSite = orderToAccept.siteDestinasi;
  unit.activeMapsLink = orderToAccept.linkMapsSite;
  unit.activePriority = orderToAccept.prioritas;
  unit.activeIdleDuration = durasiIdleStr;
  unit.estimasiEta = '-';
  unit.selisihOtwEta = '-';
  unit.tsCurrentStatusStart = nowIso;
  unit.pendingOrder = null;

  saveAndBroadcast();
  showFeedback();

  if (gasWebAppUrl) {
    await postToGas({
      action: 'updateStatus',
      namaMbp: unit.namaMbp,
      orderId: orderToAccept.orderId,
      noWa: unit.noWa,
      siteDestinasi: orderToAccept.siteDestinasi,
      linkMapsSite: unit.activeMapsLink,
      prioritas: orderToAccept.prioritas,
      newStatus: STATUS_LABEL.otw,
      lastIdleTimestamp: unit.tsIdleStart,
      timestamp: nowIso
    });
  }

  await updateOtwEta(unit, nowIso, nowMs);
}

// Hitung ETA dari posisi MBP (butuh izin geolokasi)
async function updateOtwEta(unit, nowIso, nowMs) {
  await new Promise(resolve => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        pos => processOtwWithCoords(pos.coords.latitude, pos.coords.longitude, unit, nowIso, nowMs).then(resolve, resolve),
        () => processOtwWithCoords(-2.9833, 104.7558, unit, nowIso, nowMs).then(resolve, resolve),
        { enableHighAccuracy: true, timeout: 5000 }
      );
    } else {
      processOtwWithCoords(-2.9833, 104.7558, unit, nowIso, nowMs).then(resolve, resolve);
    }
  });
}

// ============================================================================
// Penutupan tiket & reset state unit
// ============================================================================
function closeOrder(unit, nowIso, nowMs) {
  const order = orderList.find(o => o.orderId === unit.activeOrderId);
  if (order && order.status !== 'selesai') {
    order.status = 'selesai';
    order.tsSelesai = nowIso;
    if (order.tsOnsite) {
      order.totalDurasi += ' | Onsite: ' + formatDurationMs(nowMs - new Date(order.tsOnsite).getTime());
    }
  }

  unit.status = 'idle';
  unit.activeOrderId = '-';
  unit.activeSite = '-';
  unit.activeMapsLink = '#';
  unit.activePriority = 'Low';
  unit.activeIdleDuration = '-';
  unit.estimasiEta = '-';
  unit.selisihOtwEta = '-';
  unit.tsIdleStart = nowIso;
  unit.tsCurrentStatusStart = nowIso;
  // pendingOrder sengaja tidak disentuh: tiket berikutnya harus tetap utuh
  if (typeof checkMbpSessionExpiry === 'function') checkMbpSessionExpiry();
}

// ============================================================================
// Handler approval OMC: waiting_onsite -> onsite, waiting_selesai -> selesai
// ============================================================================
async function approveOrder(orderId) {
  const order = orderList.find(o => o.orderId === orderId);
  if (!order) return;

  const to = OMC_APPROVALS[order.status];
  if (!to) {
    alert('Order ' + orderId + ' tidak menunggu approval (status: ' + STATUS_LABEL[statusKey(order.status)] + ').');
    return;
  }

  const unit = fleetList.find(m => m.namaMbp === order.namaMbp && m.activeOrderId === order.orderId);
  if (!unit) {
    alert('Unit MBP ' + order.namaMbp + ' tidak lagi memegang order ' + orderId + '.');
    return;
  }

  await applyApproval(unit, to);
}

// Dipakai MBP (klik tombol) maupun OMC (approve)
async function applyApproval(unit, to) {
  const nowIso = new Date().toISOString();
  const nowMs = Date.now();
  const order = orderList.find(o => o.orderId === unit.activeOrderId);
  const orderId = order ? order.orderId : '-';

  if (order) {
    if (to === 'onsite') {
      let selisihStr = '-';
      if (order.tsOtw) {
        const otwMs = nowMs - new Date(order.tsOtw).getTime();
        const etaSec = order.etaSeconds || parseDurationSec(order.estimasiEta);
        if (etaSec > 0) {
          const diffSec = Math.floor(otwMs / 1000) - etaSec;
          const abs = formatDurationMs(Math.abs(diffSec) * 1000);
          selisihStr = diffSec > 0 ? '+' + abs + ' (Terlambat)' : '-' + abs + ' (Lebih Cepat)';
        }
        order.totalDurasi += ' | OTW: ' + formatDurationMs(otwMs);
      }
      order.tsOnsite = nowIso;
      order.selisihOtwEta = selisihStr;
      unit.selisihOtwEta = selisihStr;
    }

    if (to === 'selesai') {
      order.tsSelesai = nowIso;
      if (order.tsOnsite) {
        order.totalDurasi += ' | Onsite: ' + formatDurationMs(nowMs - new Date(order.tsOnsite).getTime());
      }
    }

    order.status = to;
  }

  unit.status = to;
  unit.tsCurrentStatusStart = nowIso;

  // selesai = reset state unit kembali ke idle
  if (to === 'selesai') closeOrder(unit, nowIso, nowMs);

  saveAndBroadcast();
  showFeedback();

  if (gasWebAppUrl) {
    await postToGas({
      action: 'updateStatus',
      namaMbp: unit.namaMbp,
      orderId: orderId,
      newStatus: STATUS_LABEL[to] || to,
      timestamp: nowIso
    });
  }
}

async function processOtwWithCoords(mbpLat, mbpLng, unit, nowIso, nowMs) {
  const siteObj = getSiteCoords(unit.activeSite) || SITE_LOCATIONS[0];
  const distKm = calculateHaversineKm(mbpLat, mbpLng, siteObj.lat, siteObj.lng);
  const etaSec = calculateCarEtaSeconds(distKm);
  const etaStr = `${formatDurationMs(etaSec * 1000)} (${distKm.toFixed(1)} km)`;

  const order = orderList.find(o => o.orderId === unit.activeOrderId);
  if (order) {
    order.status = 'otw';
    order.tsOtw = nowIso;
    order.estimasiEta = etaStr;
    order.etaSeconds = etaSec;
  }

  unit.status = 'otw';
  unit.estimasiEta = etaStr;
  unit.tsCurrentStatusStart = nowIso;

  saveAndBroadcast();
  showFeedback();

  if (gasWebAppUrl) {
    await postToGas({
      action: 'updateStatus',
      namaMbp: unit.namaMbp,
      orderId: unit.activeOrderId,
      newStatus: STATUS_LABEL.otw,
      estimasiEta: etaStr,
      timestamp: nowIso
    });
  }
}

function showFeedback() {
  const fb = document.getElementById('mobileSyncFeedback');
  if (fb) {
    fb.classList.remove('hidden');
    setTimeout(() => fb.classList.add('hidden'), 2000);
  }
}

function saveAndBroadcast() {
  localStorage.setItem(STORAGE_KEY_FLEET, JSON.stringify(fleetList));
  localStorage.setItem(STORAGE_KEY_ORDERS, JSON.stringify(orderList));
  populateSelectDropdowns();
  renderAll();
  document.getElementById('lastSyncText').textContent = 'Update: ' + new Date().toLocaleTimeString('id-ID');
}

function renderAll() {
  renderOmcView();
  renderMobileView();
}

function renderOmcView() {
  const total = fleetList.length;
  const idleCount = fleetList.filter(m => statusKey(m.status) === 'idle').length;
  const movingCount = fleetList.filter(m => {
    const s = statusKey(m.status);
    return s === 'otw' || s === 'belum_otw';
  }).length;
  // waiting_* = unit sudah di site, hanya menunggu approval OMC
  const onsiteCount = fleetList.filter(m => ['onsite', 'waiting_onsite', 'waiting_selesai'].includes(statusKey(m.status))).length;

  const idlePct = total > 0 ? ((idleCount / total) * 100).toFixed(0) : '0';
  const movingPct = total > 0 ? ((movingCount / total) * 100).toFixed(0) : '0';
  const onsitePct = total > 0 ? ((onsiteCount / total) * 100).toFixed(0) : '0';

  document.getElementById('kpiTotal').textContent = total;
  document.getElementById('kpiIdle').textContent = idleCount;
  document.getElementById('kpiIdlePct').textContent = `${idlePct}%`;
  document.getElementById('kpiMoving').textContent = movingCount;
  document.getElementById('kpiMovingPct').textContent = `${movingPct}%`;
  document.getElementById('kpiOnsite').textContent = onsiteCount;
  document.getElementById('kpiOnsitePct').textContent = `${onsitePct}%`;

  document.getElementById('barIdle').style.width = `${idlePct}%`;
  document.getElementById('barMoving').style.width = `${movingPct}%`;
  document.getElementById('barOnsite').style.width = `${onsitePct}%`;

  document.getElementById('distLabelIdle').textContent = `${idlePct}%`;
  document.getElementById('distLabelMoving').textContent = `${movingPct}%`;
  document.getElementById('distLabelOnsite').textContent = `${onsitePct}%`;

  // Filter dashboard: ?nop=PLM-014 (tanpa parameter = semua NOP)
  const visibleFleet = nopFilter
    ? fleetList.filter(u => getUnitNop(u).toUpperCase() === nopFilter.toUpperCase())
    : fleetList;

  const fleetTbody = document.getElementById('fleetTableBody');
  if (visibleFleet.length === 0) {
    fleetTbody.innerHTML = `<tr><td colspan="7" class="py-6 text-center text-slate-500 text-xs font-mono">Tidak ada unit untuk NOP ${escapeHtml(nopFilter)}</td></tr>`;
  } else {
    fleetTbody.innerHTML = visibleFleet.map(unit => {
      const pending = unit.pendingOrder;
      const belum = statusKey(unit.status) === 'belum_otw';
      const displayOid = belum && pending ? pending.orderId : unit.activeOrderId;
      const displaySite = belum && pending ? pending.siteDestinasi : unit.activeSite;
      const timerStr = formatElapsed(unit.tsCurrentStatusStart);
      return `
      <tr class="hover:bg-slate-800/40 transition">
        <td class="py-3 px-3.5 whitespace-nowrap">
          <div class="font-bold text-white">${escapeHtml(unit.namaMbp)}</div>
          <div class="text-[11px] font-mono text-slate-400">+${escapeHtml(unit.noWa)}</div>
        </td>
        <td class="py-3 px-3.5 font-mono text-xs text-amber-400 whitespace-nowrap">${escapeHtml(displayOid)}</td>
        <td class="py-3 px-3.5 font-medium text-slate-200 whitespace-nowrap">${escapeHtml(displaySite)}</td>
        <td class="py-3 px-3.5 font-mono font-semibold text-amber-400 whitespace-nowrap">${escapeHtml(unit.estimasiEta || '-')}</td>
        <td class="py-3 px-3.5 whitespace-nowrap">${getStatusBadgeHtml(unit.status)}</td>
        <td class="py-3 px-3.5 whitespace-nowrap">${fleetApprovalCellHtml(unit)}</td>
        <td class="py-3 px-3.5 whitespace-nowrap">
          <span data-fleet-timer="${escapeHtml(unit.namaMbp)}" class="font-mono font-bold text-amber-400 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded-md text-xs">
            ${timerStr}
          </span>
        </td>
      </tr>
    `;
    }).join('');
  }

  const visibleOrders = nopFilter
    ? orderList.filter(o => getOrderNop(o).toUpperCase() === nopFilter.toUpperCase())
    : orderList;

  document.getElementById('totalOrdersCount').textContent = visibleOrders.length;
  const orderTbody = document.getElementById('orderLogTableBody');
  if (visibleOrders.length === 0) {
    orderTbody.innerHTML = `
      <tr>
        <td colspan="10" class="py-6 text-center text-slate-500 text-xs font-mono">
          Belum ada riwayat tiket. Kirim tiket dari OMC dan klik 'Terima &amp; OTW' di sisi mobile untuk membuat baris pertama.
        </td>
      </tr>
    `;
  } else {
    orderTbody.innerHTML = visibleOrders.map(item => `
      <tr class="hover:bg-slate-800/40 transition">
        <td class="py-3 px-3.5 font-mono font-bold text-amber-400 whitespace-nowrap">${escapeHtml(item.orderId)}</td>
        <td class="py-3 px-3.5 font-medium text-white whitespace-nowrap">${escapeHtml(item.namaMbp)}</td>
        <td class="py-3 px-3.5 text-slate-200 whitespace-nowrap">${escapeHtml(item.siteDestinasi)}</td>
        <td class="py-3 px-3.5 whitespace-nowrap">
          <span class="px-2 py-0.5 rounded-md text-[11px] font-semibold ${getPriorityBadgeClass(item.prioritas)}">${escapeHtml(item.prioritas)}</span>
        </td>
        <td class="py-3 px-3.5 font-mono text-emerald-400 whitespace-nowrap">${escapeHtml(item.durasiIdleSebelumOrder || '-')}</td>
        <td class="py-3 px-3.5 font-mono font-semibold text-amber-400 whitespace-nowrap">${escapeHtml(item.estimasiEta || '-')}</td>
        <td class="py-3 px-3.5 font-mono font-semibold whitespace-nowrap ${item.selisihOtwEta && item.selisihOtwEta.includes('Terlambat') ? 'text-rose-400' : 'text-emerald-400'}">${escapeHtml(item.selisihOtwEta || '-')}</td>
        <td class="py-3 px-3.5 whitespace-nowrap">${getStatusBadgeHtml(item.status)}</td>
        <td class="py-3 px-3.5 text-[11px] font-mono text-slate-400 whitespace-nowrap">${escapeHtml(item.totalDurasi || '-')}</td>
        <td class="py-3 px-3.5 whitespace-nowrap">${approvalCellHtml(item)}</td>
      </tr>
    `).join('');
  }
}

function approvalCellHtml(item) {
  const to = OMC_APPROVALS[item.status];
  if (!to) return '<span class="text-slate-600 text-[11px] font-mono">-</span>';
  const label = to === 'onsite' ? '✔ Approve Onsite' : '✔ Approve Selesai';
  return `<button onclick="approveOrder('${escapeHtml(item.orderId)}')" class="px-2.5 py-1 rounded-lg text-[11px] font-bold bg-amber-500 hover:bg-amber-400 text-slate-950 transition">${label}</button>`;
}

function fleetApprovalCellHtml(unit) {
  const oid = unit.activeOrderId;
  if (!oid || oid === '-') return '<span class="text-slate-600 text-[11px] font-mono">-</span>';
  const item = orderList.find(o => o.orderId === oid);
  if (!item) return '<span class="text-slate-600 text-[11px] font-mono">-</span>';
  return approvalCellHtml(item);
}

function renderMobileView() {
  const unit = fleetList.find(m => m.namaMbp === selectedMobileMbp) || fleetList[0];
  if (!unit) return;

  const incomingBanner = document.getElementById('incomingOrderBanner');
  const orderIdEl = document.getElementById('mobileOrderId');
  const siteDestEl = document.getElementById('mobileSiteDest');
  const mapsBtn = document.getElementById('mobileMapsBtn');
  const prioBadge = document.getElementById('mobilePriorityBadge');

  const sk = statusKey(unit.status);
  const hasTicket = unit.pendingOrder && (sk === 'idle' || sk === 'belum_otw' || sk === 'selesai');
  if (hasTicket) {
    if (incomingBanner) incomingBanner.classList.remove('hidden');
    if (orderIdEl) orderIdEl.textContent = `${unit.pendingOrder.orderId} (Menunggu Diterima)`;
    if (siteDestEl) siteDestEl.textContent = unit.pendingOrder.siteDestinasi;
    if (mapsBtn) mapsBtn.href = unit.pendingOrder.linkMapsSite || getSiteMapsUrl(unit.pendingOrder.siteDestinasi);
    if (prioBadge) {
      prioBadge.textContent = unit.pendingOrder.prioritas;
      prioBadge.className = `px-2.5 py-0.5 rounded-full text-xs font-bold shrink-0 ${getPriorityBadgeClass(unit.pendingOrder.prioritas)}`;
    }
  } else {
    if (incomingBanner) incomingBanner.classList.add('hidden');
    if (orderIdEl) orderIdEl.textContent = unit.activeOrderId;
    if (siteDestEl) siteDestEl.textContent = unit.activeSite;
    if (mapsBtn) mapsBtn.href = unit.activeMapsLink || getSiteMapsUrl(unit.activeSite);
    if (prioBadge) {
      prioBadge.textContent = unit.activePriority;
      prioBadge.className = `px-2.5 py-0.5 rounded-full text-xs font-bold shrink-0 ${getPriorityBadgeClass(unit.activePriority)}`;
    }
  }

  const idlePrevEl = document.getElementById('mobileIdlePrevDuration');
  if (idlePrevEl) idlePrevEl.textContent = unit.activeIdleDuration || '-';

  const etaValEl = document.getElementById('mobileEtaVal');
  if (etaValEl) etaValEl.textContent = unit.estimasiEta || '-';

  const diffEl = document.getElementById('mobileDiffVal');
  if (diffEl) {
    diffEl.textContent = unit.selisihOtwEta || '-';
    diffEl.className = unit.selisihOtwEta && unit.selisihOtwEta.includes('Terlambat')
      ? 'font-bold mt-0.5 text-rose-400'
      : 'font-bold mt-0.5 text-emerald-400';
  }

  const badgeEl = document.getElementById('mobileCurrentStatusBadge');
  if (badgeEl) badgeEl.innerHTML = getStatusBadgeHtml(unit.status);

  const liveTimerEl = document.getElementById('mobileLiveTimer');
  if (liveTimerEl) liveTimerEl.textContent = formatElapsed(unit.tsCurrentStatusStart);

  const timerTitleEl = document.getElementById('timerTitle');
  if (timerTitleEl) timerTitleEl.textContent = statusKey(unit.status) === 'idle' ? 'Durasi Idle (Siaga)' : 'Durasi Tugas Aktif';

  // Satu tombol dinamis mengikuti state unit
  const stateKey = statusKey(unit.status);
  const step = MBP_STEP[stateKey] || MBP_STEP.idle;
  const palette = BTN_CLS[step.cls] || BTN_CLS.amber;
  const btn = document.getElementById('btnMbpAction');
  if (btn) {
    const base = 'status-btn w-full py-3.5 px-4 rounded-xl border-2 flex items-center justify-between transition-all';
    const tone = step.disabled ? palette.idle : palette.active;
    btn.disabled = !!step.disabled;
    btn.className = `${base} ${tone}`;
    const labelEl = btn.querySelector('[data-btn-label]');
    const hintEl = btn.querySelector('[data-btn-hint]');
    if (labelEl) labelEl.textContent = step.label;
    if (hintEl) hintEl.textContent = step.hint;
  }
}

function tickTimers() {
  const timerElements = document.querySelectorAll('[data-fleet-timer]');
  timerElements.forEach(el => {
    const idx = el.getAttribute('data-fleet-timer');
    const unit = fleetList.find(m => m.namaMbp === idx);
    if (unit) {
      el.textContent = formatElapsed(unit.tsCurrentStatusStart);
    }
  });

  const currentUnit = fleetList.find(m => m.namaMbp === selectedMobileMbp);
  if (currentUnit) {
    const mobTimer = document.getElementById('mobileLiveTimer');
    if (mobTimer) mobTimer.textContent = formatElapsed(currentUnit.tsCurrentStatusStart);
  }
}

function handleMobileMbpSelectChange() {
  selectedMobileMbp = document.getElementById('mobileMbpSelect').value;
  renderMobileView();
}

function applySheetRecords(sheetRecords) {
  const serverIds = new Set(sheetRecords.map(r => r.orderId));
  const localOnly = orderList.filter(o => !serverIds.has(o.orderId));
  // normalisasi status server (label Sheets) -> kunci kanonik, agar approval & filter NOP tetap jalan
  sheetRecords.forEach(r => { r.status = statusKey(r.status); });
  orderList = sheetRecords.slice().reverse().concat(localOnly);
  localStorage.setItem(STORAGE_KEY_ORDERS, JSON.stringify(orderList));

  const byMbp = new Map();
  for (const r of sheetRecords) {
    const key = (r.namaMbp || '').trim();
    if (!key) continue;
    if (!byMbp.has(key)) byMbp.set(key, []);
    byMbp.get(key).push(r);
  }
  const tsOf = o => new Date(o.tsAccept || o.tsOtw || o.tsOnsite || o.tsSelesai || 0).getTime() || 0;

  fleetList.forEach(unit => {
    const localDispatch =
      statusKey(unit.status) === 'belum_otw' && unit.pendingOrder &&
      !orderList.some(o => o.orderId === unit.pendingOrder.orderId);
    const rows = (byMbp.get((unit.namaMbp || '').trim()) || []).sort((a, b) => tsOf(b) - tsOf(a));
    const open = rows.find(o => statusKey(o.status) !== 'selesai' && statusKey(o.status) !== 'idle');
    if (localDispatch && !open) {
      return;
    }
    if (open) {
      unit.status = statusKey(open.status);
      unit.activeOrderId = open.orderId;
      unit.activeSite = open.siteDestinasi;
      unit.activePriority = open.prioritas;
      unit.estimasiEta = open.estimasiEta || '-';
      unit.selisihOtwEta = open.selisihOtwEta || '-';
      const stamp = statusKey(open.status) === 'otw' ? (open.tsOtw || open.tsAccept)
        : open.tsOnsite;
      if (stamp) unit.tsCurrentStatusStart = stamp;
    } else {
      unit.status = 'idle';
      unit.activeOrderId = '-';
      unit.activeSite = '-';
      unit.activePriority = 'Low';
      unit.estimasiEta = '-';
      unit.selisihOtwEta = '-';
      if (rows[0] && rows[0].tsSelesai) {
        unit.tsCurrentStatusStart = rows[0].tsSelesai;
        unit.tsIdleStart = rows[0].tsSelesai;
      }
    }
    if (typeof checkMbpSessionExpiry === 'function') checkMbpSessionExpiry();
  });

  localStorage.setItem(STORAGE_KEY_FLEET, JSON.stringify(fleetList));
  populateSelectDropdowns();
}

let isSyncing = false;
async function syncFromServer(showSpinner = false) {
  if (!gasWebAppUrl || isSyncing) {
    document.getElementById('lastSyncText').textContent = 'Lokal: ' + new Date().toLocaleTimeString('id-ID');
    return;
  }
  isSyncing = true;
  const icon = document.getElementById('syncIcon');
  if (showSpinner) icon.classList.add('animate-spin');

  try {
    const res = await fetch(gasWebAppUrl, { method: 'GET', redirect: 'follow' });
    const json = await res.json();
    if (json.status === 'success' && Array.isArray(json.data)) {
      const sheetRecords = json.data.filter(r => r.orderId && r.orderId !== '-');
      if (sheetRecords.length > 0) applySheetRecords(sheetRecords);
      renderAll();
    }
  } catch (err) {
    console.warn('Gagal sinkronisasi data dari Apps Script:', err);
  } finally {
    if (showSpinner) icon.classList.remove('animate-spin');
    isSyncing = false;
  }
}

async function postToGas(payload) {
  try {
    const res = await fetch(gasWebAppUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
      redirect: 'follow'
    });
    const json = await res.json();
    if (json.status === 'success' && Array.isArray(json.data)) {
      const sheetRecords = json.data.filter(r => r.orderId && r.orderId !== '-');
      if (sheetRecords.length > 0) applySheetRecords(sheetRecords);
      renderAll();
    }
  } catch (err) {
    console.warn('Gagal POST ke Google Apps Script:', err);
  }
}


// ============================================================================
// Halaman Admin: CRUD master data (Personil OMC / Site List / Unit MBP)
// ============================================================================
const ADMIN_TABLES = {
  personil: {
    label: 'Personil OMC',
    cols: ['ID', 'Nama', 'NOP'],
    fields: [
      { key: 'id', label: 'ID', type: 'text' },
      { key: 'nama', label: 'Nama', type: 'text' },
      { key: 'nop', label: 'NOP', type: 'text' }
    ]
  },
  sites: {
    label: 'Site List',
    cols: ['Site ID', 'Nama Site', 'NOP', 'Lat', 'Lng'],
    fields: [
      { key: 'siteId', label: 'Site ID', type: 'text' },
      { key: 'nama', label: 'Nama Site', type: 'text' },
      { key: 'nop', label: 'NOP', type: 'text' },
      { key: 'lat', label: 'Latitude', type: 'number' },
      { key: 'lng', label: 'Longitude', type: 'number' }
    ]
  },
  units: {
    label: 'Unit MBP',
    cols: ['ID', 'Nama Unit', 'No. WhatsApp'],
    fields: [
      { key: 'id', label: 'ID', type: 'text' },
      { key: 'nama', label: 'Nama Unit', type: 'text' },
      { key: 'noWa', label: 'No. WhatsApp', type: 'text' }
    ]
  }
};

let adminEdit = { table: null, index: -1 };

function renderAdminTables() {
  Object.keys(ADMIN_TABLES).forEach(key => {
    const tbody = document.getElementById('adminTbody_' + key);
    if (!tbody) return;
    const def = ADMIN_TABLES[key];
    const rows = masterData[key] || [];

    if (rows.length === 0) {
      tbody.innerHTML = `<tr><td colspan="${def.cols.length + 1}" class="py-4 text-center text-slate-500 text-xs font-mono">Belum ada data</td></tr>`;
      return;
    }

    tbody.innerHTML = rows.map((row, i) => `
      <tr class="hover:bg-slate-800/40 transition">
        ${def.fields.map(f => `<td class="py-2 px-3 text-xs whitespace-nowrap ${f.type === 'number' ? 'font-mono text-slate-300' : 'text-slate-200'}">${escapeHtml(row[f.key] ?? '-')}</td>`).join('')}
        <td class="py-2 px-3 whitespace-nowrap">
          <button onclick="adminEditRow('${key}',${i})" class="px-2 py-0.5 rounded bg-slate-700 hover:bg-slate-600 text-[11px] font-semibold text-white mr-1">Edit</button>
          <button onclick="adminDeleteRow('${key}',${i})" class="px-2 py-0.5 rounded bg-rose-500/20 hover:bg-rose-500/30 text-[11px] font-semibold text-rose-300">Hapus</button>
        </td>
      </tr>
    `).join('');
  });
}

function adminEditRow(table, index) {
  adminEdit = { table, index };
  const def = ADMIN_TABLES[table];
  const row = masterData[table][index];

  const wrap = document.getElementById('adminFormFields');
  if (!wrap) return;
  wrap.innerHTML = def.fields.map(f => `
    <div>
      <label class="block text-xs font-medium text-slate-300 mb-1">${escapeHtml(f.label)}</label>
      <input data-admin-field="${escapeHtml(f.key)}" type="${f.type}" value="${escapeHtml(row[f.key] ?? '')}" class="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-amber-500" />
    </div>
  `).join('');

  const title = document.getElementById('adminFormTitle');
  if (title) title.textContent = 'Edit ' + def.label + ' #' + (index + 1);
  const cancel = document.getElementById('adminFormCancel');
  if (cancel) cancel.classList.remove('hidden');
}

function adminNewRow(table) {
  adminEdit = { table, index: -1 };
  const def = ADMIN_TABLES[table];

  const wrap = document.getElementById('adminFormFields');
  if (!wrap) return;
  wrap.innerHTML = def.fields.map(f => `
    <div>
      <label class="block text-xs font-medium text-slate-300 mb-1">${escapeHtml(f.label)}</label>
      <input data-admin-field="${escapeHtml(f.key)}" type="${f.type}" value="" class="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-amber-500" />
    </div>
  `).join('');

  const title = document.getElementById('adminFormTitle');
  if (title) title.textContent = 'Tambah ' + def.label;
  const cancel = document.getElementById('adminFormCancel');
  if (cancel) cancel.classList.remove('hidden');
}

function adminCancelEdit() {
  adminEdit = { table: null, index: -1 };
  const wrap = document.getElementById('adminFormFields');
  if (wrap) wrap.innerHTML = '';
  const title = document.getElementById('adminFormTitle');
  if (title) title.textContent = 'Tambah Data';
  const cancel = document.getElementById('adminFormCancel');
  if (cancel) cancel.classList.add('hidden');
}

function adminSaveRow() {
  if (!adminEdit.table) {
    alert('Pilih dulu tombol Tambah pada salah satu tabel.');
    return;
  }
  const def = ADMIN_TABLES[adminEdit.table];
  const row = {};
  for (const f of def.fields) {
    const el = document.querySelector(`[data-admin-field="${f.key}"]`);
    let v = el ? el.value.trim() : '';
    if (f.type === 'number' && v !== '') {
      const num = Number(v);
      if (isNaN(num)) {
        alert(f.label + ' harus berupa angka.');
        return;
      }
      v = num;
    }
    row[f.key] = v;
  }

  if (!row[def.fields[0].key]) {
    alert(def.fields[0].label + ' wajib diisi.');
    return;
  }

  const rows = masterData[adminEdit.table];
  if (adminEdit.index >= 0) {
    rows[adminEdit.index] = row;
  } else {
    rows.push(row);
  }

  saveMasterData();
  syncFleetFromMaster();
  renderAdminTables();
  adminCancelEdit();
  saveAndBroadcast();
}

function adminDeleteRow(table, index) {
  const def = ADMIN_TABLES[table];
  const row = masterData[table][index];
  if (!confirm('Hapus ' + def.label + ' "' + (row[def.fields[0].key] || '') + '"?')) return;

  masterData[table].splice(index, 1);
  saveMasterData();
  syncFleetFromMaster();
  renderAdminTables();
  saveAndBroadcast();
}

// Unit MBP master = sumber kebenaran nama & WA armada
function syncFleetFromMaster() {
  masterData.units.forEach(u => {
    let unit = fleetList.find(f => f.namaMbp === u.nama);
    if (!unit) {
      unit = {
        namaMbp: u.nama, noWa: u.noWa, status: 'idle', activeOrderId: '-', activeSite: '-',
        activePriority: 'Low', tsIdleStart: new Date().toISOString(),
        tsCurrentStatusStart: new Date().toISOString(), pendingOrder: null,
        estimasiEta: '-', selisihOtwEta: '-'
      };
      fleetList.push(unit);
    }
    unit.noWa = u.noWa;
  });
}

function switchRole(role) {
  activeRole = role;
  const views = {
    omc: document.getElementById('viewOmc'),
    mbp: document.getElementById('viewMbp'),
    admin: document.getElementById('viewAdmin')
  };
  const tabs = {
    omc: document.getElementById('tabOmc'),
    mbp: document.getElementById('tabMbp'),
    admin: document.getElementById('tabAdmin')
  };
  const onCls = 'flex-1 sm:flex-none text-center px-3.5 py-1.5 rounded-lg text-xs sm:text-sm font-semibold transition-all bg-amber-500 text-slate-950 shadow';
  const offCls = 'flex-1 sm:flex-none text-center px-3.5 py-1.5 rounded-lg text-xs sm:text-sm font-semibold transition-all text-slate-400 hover:text-white';

  Object.keys(views).forEach(k => {
    const hide = k !== role;
    views[k].classList.toggle('hidden', hide);
    tabs[k].className = hide ? offCls : onCls;
  });

  if (role === 'admin') renderAdminTables();
  renderAll();
}

function clearNopFilter() {
  const url = new URL(location.href);
  url.searchParams.delete('nop');
  location.href = url.toString();
}

function toggleConfigModal() {
  const modal = document.getElementById('configModal');
  const input = document.getElementById('gasUrlInput');
  if (modal.classList.contains('hidden')) {
    input.value = gasWebAppUrl;
    modal.classList.remove('hidden');
    modal.classList.add('flex');
  } else {
    modal.classList.add('hidden');
    modal.classList.remove('flex');
  }
}

function saveGasUrl() {
  gasWebAppUrl = document.getElementById('gasUrlInput').value.trim();
  localStorage.setItem(STORAGE_KEY_URL, gasWebAppUrl);
  updateConnectionBadge();
  toggleConfigModal();
  if (gasWebAppUrl) syncFromServer(true);
}

function resetDemoData() {
  localStorage.removeItem(STORAGE_KEY_FLEET);
  localStorage.removeItem(STORAGE_KEY_ORDERS);
  fleetList = getSeedFleet();
  orderList = [];
  saveAndBroadcast();
  toggleConfigModal();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}
