// Konstanta & kunci localStorage hidup di js/config.js (const lintas <script> tidak boleh diulang)
let gasWebAppUrl = SUPABASE_URL;
let activeRole = 'omc';
let selectedMobileMbp = '';

// Filter NOP: OMC dari akun login, Admin dari dropdown, legacy ?nop= di URL
let adminNopFilter = localStorage.getItem(STORAGE_KEY_ADMIN_NOP) || '';

function getEffectiveNopFilter() {
  const urlNop = new URLSearchParams(location.search).get('nop') || '';
  if (typeof currentUser !== 'undefined' && currentUser) {
    if (currentUser.role === 'omc') return currentUser.nop || '';
    if (currentUser.role === 'admin') {
      const live = document.getElementById('adminNopFilter')?.value;
      if (live !== undefined && live !== null && live !== '') return live;
      return adminNopFilter || '';
    }
  }
  return urlNop;
}

function listKnownNops() {
  const set = new Set();
  (masterData.personil || []).forEach(p => { if (p.nop) set.add(p.nop); });
  (masterData.sites || []).forEach(s => { if (s.nop) set.add(s.nop); });
  (masterData.units || []).forEach(u => { if (u.nop) set.add(u.nop); });
  return [...set].sort();
}

function fleetInScope() {
  const nf = getEffectiveNopFilter();
  if (!nf) return fleetList;
  return fleetList.filter(u => getUnitNop(u).toUpperCase() === nf.toUpperCase());
}

function sitesInScope() {
  const nf = getEffectiveNopFilter();
  if (!nf) return masterData.sites;
  return masterData.sites.filter(s => (s.nop || '').toUpperCase() === nf.toUpperCase());
}

function refreshNopFilterUi() {
  const nf = getEffectiveNopFilter();
  const banner = document.getElementById('nopFilterBanner');
  const val = document.getElementById('nopFilterValue');
  const clearBtn = document.getElementById('nopFilterClearBtn');
  if (banner) banner.classList.toggle('hidden', !nf);
  if (val) val.textContent = nf || '-';
  const sessionBound = currentUser?.role === 'omc';
  if (clearBtn) clearBtn.classList.toggle('hidden', !!sessionBound);

  const adminSel = document.getElementById('adminNopFilter');
  if (adminSel && currentUser?.role === 'admin') {
    const nops = listKnownNops();
    const cur = adminNopFilter;
    adminSel.innerHTML = '<option value="">Semua NOP</option>' + nops.map(n =>
      `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`
    ).join('');
    adminSel.value = cur;
  }
}

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
    { id: 'MBP-01', nama: 'MBP-01 (Tim Alpha)', noWa: '6281234567801', nop: 'PLM-014' },
    { id: 'MBP-02', nama: 'MBP-02 (Tim Bravo)', noWa: '6281234567802', nop: 'PLM-014' },
    { id: 'MBP-03', nama: 'MBP-03 (Tim Charlie)', noWa: '6281234567803', nop: 'PLM-014' },
    { id: 'MBP-04', nama: 'MBP-04 (Tim Delta)', noWa: '6285175393095', nop: 'BTA-012' }
  ]
};

let masterData = loadMasterData();

function loadMasterData() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY_MASTER));
    if (saved && saved.personil && saved.sites && saved.units) {
      saved.units.forEach(u => {
        if (!u.nop) {
          const seed = MASTER_SEED.units.find(s => s.id === u.id || s.nama === u.nama);
          if (seed?.nop) u.nop = seed.nop;
        }
      });
      return saved;
    }
  } catch (err) { /* data rusak -> pakai seed */ }
  return gasWebAppUrl
    ? { personil: [], sites: [], units: [] }
    : JSON.parse(JSON.stringify(MASTER_SEED));
}

function saveMasterData() {
  localStorage.setItem(STORAGE_KEY_MASTER, JSON.stringify(masterData));
  if (gasWebAppUrl) {
    postToGas({ action: 'saveMaster', masterData });
  }
}

// Nop aktif sebuah order: dari Site List dulu, fallback ke nop di record order
function getOrderNop(order) {
  if (!order) return '';
  if (order.nop) return order.nop; // Utamakan NOP historis yang sudah terkunci
  const site = masterData.sites.find(s => s.siteId === (order.siteDestinasi || '').split(' ')[0] || s.nama === order.siteDestinasi);
  return site ? site.nop : '';
}

function siteNopOf(siteName) {
  const site = masterData.sites.find(s => s.siteId === (siteName || '').split(' ')[0] || s.nama === siteName);
  return site ? site.nop : '';
}

// NOP unit: master data dulu, lalu site aktif / order terakhir
function getUnitNop(unit) {
  if (unit.nop) return unit.nop;
  const master = masterData.units?.find(u => u.nama === unit.namaMbp || u.id === unit.id);
  if (master?.nop) return master.nop;
  const active = siteNopOf(unit.activeSite);
  if (active) return active;
  const last = orderList.find(o => o.namaMbp === unit.namaMbp);
  return last ? (getOrderNop(last) || '') : '';
}

function getSiteCoords(siteName) {
  const siteId = (siteName || '').split(' ')[0];
  return masterData.sites.find(s => s.siteId === siteId || s.nama === siteName)
    || (gasWebAppUrl ? null : SITE_LOCATIONS.find(s => s.name === siteName))
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

// Kolom prioritas masih ada di Sheet; OMC tidak lagi memilih prioritas di form.
const DISPATCH_PRIORITAS = '-';

function isOrderIdUsed(id) {
  const trimmed = String(id || '').trim();
  if (!trimmed || trimmed === '-') return false;
  if (orderList.some(o => o.orderId === trimmed)) return true;
  return fleetList.some(u => {
    if (u.pendingOrder?.orderId === trimmed) return true;
    return u.activeOrderId && u.activeOrderId !== '-' && u.activeOrderId === trimmed;
  });
}

function refreshDispatchOrderIdWarning() {
  const input = document.getElementById('dispatchOrderId');
  const warning = document.getElementById('dispatchOrderIdWarning');
  const btn = document.getElementById('btnKirimWa');
  if (!input || !warning) return;
  const orderId = input.value.trim();
  const duplicate = orderId && orderId !== '-' && isOrderIdUsed(orderId);
  warning.textContent = duplicate
    ? 'Order ID ini sudah dipakai pada tiket/armada. Gunakan ID lain.'
    : '';
  warning.classList.toggle('hidden', !duplicate);
  input.classList.toggle('border-rose-500', duplicate);
  input.classList.toggle('focus:border-rose-500', duplicate);
  input.setAttribute('aria-invalid', duplicate ? 'true' : 'false');
  if (btn) {
    btn.classList.toggle('opacity-50', duplicate);
    btn.classList.toggle('pointer-events-none', duplicate);
    btn.setAttribute('aria-disabled', duplicate ? 'true' : 'false');
  }
  return duplicate;
}

function getSeedFleet() {
  const now = Date.now();
  const start = new Date(now - 30 * 60000).toISOString();
  const units = masterData.units?.length
    ? masterData.units
    : (gasWebAppUrl ? [] : MASTER_SEED.units);
  return units.map(unit => ({
    id: unit.id,
    namaMbp: unit.nama,
    noWa: unit.noWa || '',
    nop: unit.nop || '',
    status: 'idle',
    activeOrderId: '-',
    activeSite: '-',
    activePriority: 'Low',
    tsIdleStart: start,
    tsCurrentStatusStart: start,
    pendingOrder: null,
    estimasiEta: '-',
    selisihOtwEta: '-'
  }));
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
    'Idle': 'bg-emerald-500/10 text-emerald-700 border border-emerald-500/25',
    'Belum OTW': 'bg-rose-500/10 text-rose-600 border border-rose-500/25',
    'OTW to Site': 'bg-orange-500/10 text-orange-700 border border-orange-500/25',
    'Onsite': 'bg-sky-500/10 text-sky-700 border border-sky-500/25',
    'Waiting Onsite': 'bg-amber-500/15 text-amber-700 border border-amber-500/30',
    'Waiting Selesai': 'bg-amber-500/15 text-amber-700 border border-amber-500/30',
    'Selesai': 'bg-surface-3 text-muted border border-line'
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
  return `<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[13px] font-semibold ${cls} whitespace-nowrap">
    <span class="w-2 h-2 rounded-full ${dotCls} shrink-0"></span>
    ${escapeHtml(label)}
  </span>`;
}

function getPriorityBadgeClass(prio) {
  const map = {
    'Critical': 'bg-rose-500/10 text-rose-600 border border-rose-500/30',
    'High': 'bg-orange-500/10 text-orange-700 border border-orange-500/30',
    'Medium': 'bg-amber-500/15 text-amber-700 border border-amber-500/30',
    'Low': 'bg-surface-3 text-muted border border-line'
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

// Tombol aksi: latar berwarna solid, teks gelap (hitam) supaya kontrasnya kuat di tema terang.
const BTN_CLS = {
  amber: { active: 'border-amber-500 bg-amber-500 text-slate-950 shadow-lg shadow-amber-500/25', idle: 'border-amber-500/30 bg-surface-2 text-amber-700' },
  orange: { active: 'border-orange-500 bg-orange-500 text-slate-950 shadow-lg shadow-orange-500/25', idle: 'border-orange-500/30 bg-surface-2 text-orange-700' },
  sky: { active: 'border-sky-600 bg-sky-600 text-slate-950 shadow-lg shadow-sky-600/25', idle: 'border-sky-500/30 bg-surface-2 text-sky-700' }
};

function initApp() {
  setInterval(tickTimers, 1000);
  const hasMagicLink = typeof HAS_MAGIC_LINK !== 'undefined' && HAS_MAGIC_LINK;
  const savedSession = typeof readSession === 'function' ? readSession() : null;
  const isMbpSession = savedSession?.role === 'mbp';
  if (hasMagicLink) {
    fleetList = getSeedFleet();
    orderList = [];
  } else if (isMbpSession && mbpRuntimeState) {
    fleetList = JSON.parse(sessionStorage.getItem(STORAGE_KEY_FLEET) || '[]');
    orderList = JSON.parse(sessionStorage.getItem(STORAGE_KEY_ORDERS) || '[]');
  } else if (isMbpSession) {
    fleetList = getSeedFleet();
    orderList = [];
  } else {
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
  }

  fleetList.forEach(u => { u.status = statusKey(u.status); });
  orderList.forEach(o => { o.status = statusKey(o.status); });
  selectedMobileMbp = savedSession?.role === 'mbp' ? savedSession.unit : (fleetList[0]?.namaMbp || '');
  if (!isMbpSession && !hasMagicLink) syncFleetFromMaster();
  updateConnectionBadge();
  populateSelectDropdowns();
  if (document.getElementById('dispatchOrderId')) updateWaLink();
  renderAdminTables();
  refreshNopFilterUi();

  if (hasMagicLink) {
    Promise.resolve().then(() => tryMagicLinkAuth()).catch(err => {
      document.getElementById('loginScreen')?.classList.remove('hidden');
      document.getElementById('loginScreen')?.classList.add('flex');
      showLoginError(err.message || 'Gagal membuka link tugas.');
    });
  } else if (savedSession?.role === 'mbp') {
    Promise.resolve().then(async () => {
      const result = await gasPost({ action: 'validateSession', sessionToken: savedSession.sessionToken }, { auth: false });
      if (result.status !== 'success') return logout();
      const user = { ...result.user, sessionToken: savedSession.sessionToken, dispatchToken: savedSession.dispatchToken || '' };
      applyUser(user);
      await syncFromServer(false);
      renderAll();
    });
  } else if (savedSession) {
    Promise.resolve().then(() => initAuth());
  } else {
    renderAll();
  }

  async function runSync() {
    if (gasWebAppUrl && readSession()) await syncFromServer(false);
  }
  runSync();
  setInterval(runSync, SYNC_INTERVAL_MS);
  if (typeof checkMbpSessionExpiry === 'function') setInterval(checkMbpSessionExpiry, 5000);
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

function updateConnectionBadge(connected = false, label = '') {
  const badge = document.getElementById('connectionBadge');
  if (!badge) return;
  if (label) {
    badge.textContent = label;
    badge.className = 'text-[10px] sm:text-[11px] font-mono px-2 py-0.5 rounded-full bg-rose-500/10 text-rose-700 border border-rose-500/30 whitespace-nowrap';
  } else if (connected) {
    badge.textContent = 'Data Terhubung';
    badge.className = 'text-[10px] sm:text-[11px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 border border-emerald-500/30 whitespace-nowrap';
  } else if (!gasWebAppUrl) {
    badge.textContent = 'URL backend belum diatur';
    badge.className = 'text-[10px] sm:text-[11px] font-mono px-2 py-0.5 rounded-full bg-rose-500/10 text-rose-700 border border-rose-500/30 whitespace-nowrap';
  } else {
    badge.textContent = 'Belum tersambung';
    badge.className = 'text-[10px] sm:text-[11px] font-mono px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-700 border border-amber-500/30 whitespace-nowrap';
  }
}

let lastDispatchMbpName = null;
let lastDispatchWaValue = '';

function handleMbpDispatchChange({ force = false } = {}) {
  const namaMbp = document.getElementById('dispatchMbpSelect')?.value;
  const waInput = document.getElementById('dispatchWaInput');
  if (!namaMbp || !waInput) return;
  const unit = fleetList.find(m => m.namaMbp === namaMbp);
  const masterWa = unit?.noWa || '';
  // Nomor WA ditulis ulang hanya bila unit berganti atau master data berubah.
  // Refresh polling tidak boleh menimpa nomor yang sedang diketik manual OMC.
  const unitChanged = namaMbp !== lastDispatchMbpName;
  const masterChanged = masterWa !== lastDispatchWaValue;
  if ((unitChanged || masterChanged || force) && masterWa) {
    waInput.value = masterWa;
    lastDispatchWaValue = masterWa;
  }
  lastDispatchMbpName = namaMbp;
  updateWaLink();
}
window.handleMbpDispatchChange = handleMbpDispatchChange;

function populateSelectDropdowns() {
  const mbpInput = document.getElementById('dispatchMbpSelect');
  if (mbpInput && document.activeElement !== mbpInput) {
    refreshMbpDatalist(mbpInput.value);
  }

  const siteInput = document.getElementById('dispatchSiteSelect');
  if (siteInput && document.activeElement !== siteInput) {
    refreshSiteDatalist(siteInput.value);
  }

  handleMbpDispatchChange();
}

let currentDispatchToken = '';

function generateDispatchToken() {
  const arr = new Uint8Array(16);
  crypto.getRandomValues(arr);
  currentDispatchToken = Array.from(arr, b => b.toString(16).padStart(2, '0')).join('');
  return currentDispatchToken;
}

function buildMagicLinkUrl(orderId, namaMbp, site, token) {
  // pathname bisa "/website-ticketing/" (Pages) atau "/index.html" (file lokal):
  // buang segmen terakhir agar hasilnya selalu direktori + mbp.html
  const dir = location.pathname.replace(/[^/]*$/, '');
  const base = location.origin + dir + 'mbp.html';
  const paramsObj = {
    tkn: token,
    oid: orderId,
    mbp: namaMbp,
    site: site
  };
  
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

  if (!currentDispatchToken) generateDispatchToken();
  const magicUrl = buildMagicLinkUrl(orderId, namaMbp, site, currentDispatchToken);

  const waText = `[Order ID: ${orderId}] Ada masalah di site ${site}.\n\nKlik tautan khusus ini untuk membuka tugas & update status:\n${magicUrl}`;

  const previewEl = document.getElementById('waPreviewText');
  if (previewEl) previewEl.textContent = waText;

  const btn = document.getElementById('btnKirimWa');
  if (btn) {
    btn.href = phone ? `https://wa.me/${phone}?text=${encodeURIComponent(waText)}` : '#';
  }
  refreshDispatchOrderIdWarning();
}

function updateWaPreview() {
  generateDispatchToken();
  updateWaLink();
}

async function handleDispatchClick(event) {
  const dispatchButton = event.currentTarget;
  const finishDispatch = () => {
    if (dispatchButton) {
      dispatchButton.removeAttribute('data-dispatching');
      dispatchButton.removeAttribute('aria-busy');
    }
  };
  if (dispatchButton?.dataset.dispatching === 'true') {
    event.preventDefault();
    return;
  }
  if (refreshDispatchOrderIdWarning()) {
    event.preventDefault();
    document.getElementById('dispatchOrderId')?.focus();
    return;
  }
  if (dispatchButton) dispatchButton.dataset.dispatching = 'true';
  dispatchButton?.setAttribute('aria-busy', 'true');
  try {
    await dispatchTicket(event);
  } finally {
    finishDispatch();
  }
}

function clearPendingDispatch(unit) {
  unit.status = 'idle';
  unit.activeOrderId = '-';
  unit.activeSite = '-';
  unit.activePriority = 'Low';
  unit.estimasiEta = '-';
  unit.selisihOtwEta = '-';
  unit.pendingOrder = null;
  saveAndBroadcast();
}

function showSyncError(message) {
  const syncText = document.getElementById('lastSyncText');
  if (syncText) syncText.textContent = 'Sync gagal: ' + message;
  const feedback = document.getElementById('mobileSyncFeedback');
  if (feedback) {
    feedback.textContent = message;
    feedback.classList.remove('hidden', 'text-emerald-700');
    feedback.classList.add('text-rose-700');
  }
}

async function dispatchTicket(event) {
  const dispatchButton = event.currentTarget;
  const waHref = dispatchButton?.href || '';
  const selectedUnit = fleetList.find(m => m.namaMbp === document.getElementById('dispatchMbpSelect')?.value);
  if (selectedUnit && statusKey(selectedUnit.status) !== 'idle') {
    event.preventDefault();
    alert('Unit MBP sedang memegang tiket aktif. Pilih unit lain atau selesaikan tiket sebelumnya.');
    return;
  }
  const orderId = document.getElementById('dispatchOrderId')?.value.trim();
  if (!orderId || orderId === '-') {
    event.preventDefault();
    alert('Order ID wajib diisi.');
    document.getElementById('dispatchOrderId')?.focus();
    return;
  }
  if (isOrderIdUsed(orderId)) {
    event.preventDefault();
    alert('Order ID sudah dipakai. Gunakan ID lain.');
    document.getElementById('dispatchOrderId')?.focus();
    return;
  }
  const prioritas = DISPATCH_PRIORITAS;

  const namaMbp = document.getElementById('dispatchMbpSelect').value;
  let rawWa = document.getElementById('dispatchWaInput').value.replace(/\D/g, '');
  const siteDest = document.getElementById('dispatchSiteSelect').value;
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
  if (!unit) {
    event.preventDefault();
    alert('Unit MBP tidak ditemukan.');
    return;
  }
  if (!currentUser || !['omc', 'admin'].includes(currentUser.role)) {
    event.preventDefault();
    alert('Login OMC/Admin diperlukan untuk mengirim tiket.');
    return;
  }
  if (currentUser.role === 'omc' && siteNopOf(siteDest) !== currentUser.nop) {
    event.preventDefault();
    alert('Site tujuan harus berada di NOP akun OMC.');
    return;
  }

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
  if (currentUser?.role === 'mbp') mbpRuntimeState = { ...mbpRuntimeState, orderId, dispatchToken: currentDispatchToken };
  unit.status = 'belum_otw';
  unit.activeOrderId = orderId;
  unit.activeSite = siteDest;
  unit.activePriority = prioritas;
  unit.estimasiEta = '-';
  unit.selisihOtwEta = '-';
  unit.tsCurrentStatusStart = nowIso;
  unit.noWa = rawWa;
  saveAndBroadcast();

  if (gasWebAppUrl) {
    const idleMs = unit.tsIdleStart ? Date.now() - new Date(unit.tsIdleStart).getTime() : 0;
    const response = await postToGas({
      action: 'updateStatus',
      orderId,
      dispatchToken: currentDispatchToken,
      namaMbp: unit.namaMbp,
      noWa: rawWa,
      siteDestinasi: siteDest,
      linkMapsSite,
      prioritas,
      nop: siteNopOf(siteDest),
      newStatus: STATUS_LABEL.belum_otw,
      durasiIdleSebelumOrder: formatDurationMs(Math.max(0, idleMs)),
      estimasiEta: '-',
      selisihOtwEta: '-',
      tsIdle: unit.tsIdleStart || '',
      tsAccept: nowIso,
      totalDurasi: 'Idle Sebelum Order: ' + formatDurationMs(Math.max(0, idleMs)),
      timestamp: nowIso
    });
    if (response.status !== 'success') {
      clearPendingDispatch(unit);
      event.preventDefault();
      const msg = response.message || 'Gagal menyimpan dispatch ke server.';
      if (/sudah dipakai|duplicate|double/i.test(msg)) {
        refreshDispatchOrderIdWarning();
        alert(msg);
      }
      return;
    }
  } else {
    clearPendingDispatch(unit);
    event.preventDefault();
    showSyncError('Backend tidak tersedia. Link MBP tidak dikirim karena token belum tersimpan.');
    return;
  }

  if (dispatchButton && waHref) window.open(waHref, '_blank', 'noopener');
  setTimeout(() => {
    const orderInput = document.getElementById('dispatchOrderId');
    if (orderInput) orderInput.value = '';
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
  const unit = currentUser?.role === 'mbp'
    ? fleetList.find(m => m.namaMbp === currentUser.unit || m.id === currentUser.unit)
    : fleetList.find(m => m.namaMbp === selectedMobileMbp);
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

// Susun payload Sheets dari order + unit, supaya semua kolom & timestamp selalu ikut.
function buildOrderPayload(unit, order, newStatus, timestamp) {
  const o = order || {};
  return {
    action: 'updateStatus',
    orderId: o.orderId || unit.activeOrderId || '-',
    namaMbp: unit.namaMbp,
    noWa: unit.noWa || o.noWa || '',
    siteDestinasi: o.siteDestinasi || unit.activeSite || '',
    linkMapsSite: o.linkMapsSite || unit.activeMapsLink || '',
    prioritas: o.prioritas || unit.activePriority || 'Low',
    dispatchToken: o.dispatchToken || unit.pendingOrder?.token || mbpRuntimeState?.dispatchToken || '',
    newStatus,
    durasiIdleSebelumOrder: o.durasiIdleSebelumOrder || unit.activeIdleDuration || '-',
    estimasiEta: o.estimasiEta || unit.estimasiEta || '-',
    selisihOtwEta: o.selisihOtwEta || unit.selisihOtwEta || '-',
    tsIdle: o.tsIdle || unit.tsIdleStart || '',
    tsAccept: o.tsAccept || '',
    tsOtw: o.tsOtw || '',
    tsOnsite: o.tsOnsite || '',
    tsSelesai: o.tsSelesai || '',
    totalDurasi: o.totalDurasi || '',
    lastIdleTimestamp: unit.tsIdleStart || '',
    timestamp
  };
}

// Ambil tiket & langsung OTW (dari state idle)
async function beginJob(unit) {
  if (!currentUser?.sessionToken) {
    alert('Sesi tidak valid. Login ulang.');
    return;
  }
  if (gasWebAppUrl) {
    await syncFromServer(false);
  }

  const nowIso = new Date().toISOString();
  const nowMs = Date.now();
  const idleStartMs = unit.tsIdleStart ? new Date(unit.tsIdleStart).getTime() : nowMs;

  const orderToAccept = unit.pendingOrder;
  if (!orderToAccept) {
    const activeFromSheet = orderList.find(o => o.namaMbp === unit.namaMbp && statusKey(o.status) !== 'selesai');
    if (activeFromSheet) {
      renderAll();
      return;
    }
    alert('Belum ada tiket masuk. Buka melalui link tugas WhatsApp dari OMC.');
    return;
  }
  if (orderToAccept.orderId !== currentUser?.orderId || !orderToAccept.token || orderToAccept.token !== currentUser?.dispatchToken) {
    alert('Link ini tidak berlaku untuk tiket yang sedang dibuka. Buka kembali link WhatsApp terbaru.');
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
    // Order sudah dibuat saat dispatch (status Belum OTW): lanjut ke OTW,
    // perbarui baris yang sama di Sheets, jangan buat baris baru.
    const durasiIdleStr = formatDurationMs(Math.max(0, nowMs - idleStartMs));

    existingOrder.status = 'otw';
    if (!existingOrder.durasiIdleSebelumOrder || existingOrder.durasiIdleSebelumOrder === '-') {
      existingOrder.durasiIdleSebelumOrder = durasiIdleStr;
    }
    existingOrder.tsAccept = existingOrder.tsAccept || nowIso;
    existingOrder.tsOtw = nowIso;
    existingOrder.totalDurasi = 'Idle Sebelum Order: ' + existingOrder.durasiIdleSebelumOrder;

    unit.status = 'otw';
    unit.activeOrderId = existingOrder.orderId;
    unit.activeSite = existingOrder.siteDestinasi;
    unit.activeMapsLink = existingOrder.linkMapsSite || getSiteMapsUrl(existingOrder.siteDestinasi);
    unit.activePriority = existingOrder.prioritas;
    unit.activeIdleDuration = existingOrder.durasiIdleSebelumOrder;
    unit.estimasiEta = existingOrder.estimasiEta || '-';
    unit.selisihOtwEta = existingOrder.selisihOtwEta || '-';
    unit.tsCurrentStatusStart = nowIso;
    unit.pendingOrder = null;

    saveAndBroadcast();
    showFeedback();

    if (gasWebAppUrl) {
      await postToGas(buildOrderPayload(unit, existingOrder, STATUS_LABEL.otw, nowIso));
    }

    await updateOtwEta(unit, nowIso, nowMs);
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
    await postToGas(buildOrderPayload(unit, orderList.find(x => x.orderId === orderToAccept.orderId), STATUS_LABEL.otw, nowIso));
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
    await postToGas(buildOrderPayload(unit, order, STATUS_LABEL[to] || to, nowIso));
  }
}

async function processOtwWithCoords(mbpLat, mbpLng, unit, nowIso, nowMs) {
  const siteObj = getSiteCoords(unit.activeSite) || (gasWebAppUrl ? null : SITE_LOCATIONS[0]);
  const distKm = siteObj ? calculateHaversineKm(mbpLat, mbpLng, siteObj.lat, siteObj.lng) : 0;
  const etaSec = siteObj ? calculateCarEtaSeconds(distKm) : 0;
  const etaStr = siteObj ? `${formatDurationMs(etaSec * 1000)} (${distKm.toFixed(1)} km)` : '-';

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
    await postToGas(buildOrderPayload(unit, order, STATUS_LABEL.otw, nowIso));
  }
}

function showFeedback() {
  const fb = document.getElementById('mobileSyncFeedback');
  if (fb) {
    fb.textContent = 'Tersimpan';
    fb.classList.remove('hidden', 'text-rose-700');
    fb.classList.add('text-emerald-700');
    clearTimeout(fb.__hideTimer);
    fb.__hideTimer = setTimeout(() => fb.classList.add('hidden'), 2000);
  }
}

function saveAndBroadcast() {
  const isMbpSession = currentUser?.role === 'mbp';
  if (isMbpSession) {
    mbpRuntimeState = {
      role: 'mbp', unit: currentUser.unit, orderId: currentUser.orderId,
      dispatchToken: currentUser.dispatchToken || '', sessionToken: currentUser.sessionToken
    };
    sessionStorage.setItem(STORAGE_KEY_FLEET, JSON.stringify(fleetList));
    sessionStorage.setItem(STORAGE_KEY_ORDERS, JSON.stringify(orderList));
  } else {
    localStorage.setItem(STORAGE_KEY_FLEET, JSON.stringify(fleetList));
    localStorage.setItem(STORAGE_KEY_ORDERS, JSON.stringify(orderList));
  }
  populateSelectDropdowns();
  renderAll();
  const syncText = document.getElementById('lastSyncText');
  if (syncText) syncText.textContent = 'Update: ' + new Date().toLocaleTimeString('id-ID');
}

function renderAll() {
  renderOmcView();
  renderMobileView();
}

function renderOmcView() {
  if (!document.getElementById('viewOmc')) return;
  refreshNopFilterUi();
  const scoped = fleetInScope();
  const dispatchForm = document.getElementById('dispatchForm');
  const allowed = currentUser?.role === 'admin' || currentUser?.role === 'omc';
  if (dispatchForm) dispatchForm.classList.toggle('hidden', !allowed);
  refreshDispatchOrderIdWarning();
  const total = scoped.length;
  const idleCount = scoped.filter(m => statusKey(m.status) === 'idle').length;
  const movingCount = scoped.filter(m => {
    const s = statusKey(m.status);
    return s === 'otw' || s === 'belum_otw';
  }).length;
  // waiting_* = unit sudah di site, hanya menunggu approval OMC
  const onsiteCount = scoped.filter(m => ['onsite', 'waiting_onsite', 'waiting_selesai'].includes(statusKey(m.status))).length;

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

  const nf = getEffectiveNopFilter();
  const visibleFleet = fleetInScope();

  const fleetTbody = document.getElementById('fleetTableBody');
  if (visibleFleet.length === 0) {
    fleetTbody.innerHTML = `<tr><td colspan="7" class="py-6 text-center text-slate-500 text-xs font-mono">Tidak ada unit untuk NOP ${escapeHtml(nf)}</td></tr>`;
  } else {
    fleetTbody.innerHTML = visibleFleet.map(unit => {
      const pending = unit.pendingOrder;
      const belum = statusKey(unit.status) === 'belum_otw';
      const displayOid = belum && pending ? pending.orderId : unit.activeOrderId;
      const displaySite = belum && pending ? pending.siteDestinasi : unit.activeSite;
      const timerStr = formatElapsed(unit.tsCurrentStatusStart);
      return `
      <tr class="hover:bg-surface-3 transition">
        <td class="py-3 px-3.5 whitespace-nowrap">
          <div class="font-bold text-body">${escapeHtml(unit.namaMbp)}</div>
          <div class="text-[11px] font-mono text-slate-400">+${escapeHtml(unit.noWa)}</div>
        </td>
        <td class="py-3 px-3.5 font-mono text-xs text-amber-700 whitespace-nowrap">${escapeHtml(displayOid)}</td>
        <td class="py-3 px-3.5 font-medium text-body whitespace-nowrap">${escapeHtml(displaySite)}</td>
        <td class="py-3 px-3.5 font-mono font-semibold text-amber-700 whitespace-nowrap">${escapeHtml(unit.estimasiEta || '-')}</td>
        <td class="py-3 px-3.5 whitespace-nowrap">${getStatusBadgeHtml(unit.status)}</td>
        <td class="py-3 px-3.5 whitespace-nowrap">${fleetApprovalCellHtml(unit)}</td>
        <td class="py-3 px-3.5 whitespace-nowrap">
          <span data-fleet-timer="${escapeHtml(unit.namaMbp)}" class="font-mono font-bold text-amber-700 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded-md text-xs tabular">
            ${timerStr}
          </span>
        </td>
      </tr>
    `;
    }).join('');
  }

  const visibleOrders = nf
    ? orderList.filter(o => getOrderNop(o).toUpperCase() === nf.toUpperCase())
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
      <tr class="hover:bg-surface-3 transition">
        <td class="py-3 px-3.5 font-mono font-bold text-amber-700 whitespace-nowrap">${escapeHtml(item.orderId)}</td>
        <td class="py-3 px-3.5 font-medium text-body whitespace-nowrap">${escapeHtml(item.namaMbp)}</td>
        <td class="py-3 px-3.5 text-body whitespace-nowrap">${escapeHtml(item.siteDestinasi)}</td>
        <td class="py-3 px-3.5 whitespace-nowrap">
          <span class="px-2 py-0.5 rounded-md text-[11px] font-semibold ${getPriorityBadgeClass(item.prioritas)}">${escapeHtml(item.prioritas)}</span>
        </td>
        <td class="py-3 px-3.5 font-mono text-emerald-700 whitespace-nowrap">${escapeHtml(item.durasiIdleSebelumOrder || '-')}</td>
        <td class="py-3 px-3.5 font-mono font-semibold text-amber-700 whitespace-nowrap">${escapeHtml(item.estimasiEta || '-')}</td>
        <td class="py-3 px-3.5 font-mono font-semibold whitespace-nowrap ${item.selisihOtwEta && item.selisihOtwEta.includes('Terlambat') ? 'text-rose-600' : 'text-emerald-700'}">${escapeHtml(item.selisihOtwEta || '-')}</td>
        <td class="py-3 px-3.5 whitespace-nowrap">${getStatusBadgeHtml(item.status)}</td>
        <td class="py-3 px-3.5 text-[11px] font-mono text-slate-400 whitespace-nowrap">${escapeHtml(item.totalDurasi || '-')}</td>
        <td class="py-3 px-3.5 whitespace-nowrap">${approvalCellHtml(item)}</td>
      </tr>
    `).join('');
  }
}

function approvalCellHtml(item) {
  const to = OMC_APPROVALS[item.status];
  if (!to) return '<span class="text-faint text-[11px] font-mono">-</span>';
  const label = to === 'onsite' ? 'Approve Onsite' : 'Approve Selesai';
  return `<button data-order-id="${escapeHtml(item.orderId)}" onclick="approveOrder(this.dataset.orderId)" class="px-2.5 py-1 rounded-lg text-[11px] font-bold bg-amber-500 hover:bg-amber-400 text-slate-950 transition">${label}</button>`;
}

function fleetApprovalCellHtml(unit) {
  const oid = unit.activeOrderId;
  if (!oid || oid === '-') return '<span class="text-faint text-[11px] font-mono">-</span>';
  const item = orderList.find(o => o.orderId === oid);
  if (!item) return '<span class="text-faint text-[11px] font-mono">-</span>';
  return approvalCellHtml(item);
}

function renderMobileView() {
  if (currentUser?.role !== 'mbp') return;
  const unit = fleetList.find(m => m.namaMbp === currentUser.unit || m.id === currentUser.unit);
  if (!unit) return;

  const orderIdEl = document.getElementById('mobileOrderId');
  const siteDestEl = document.getElementById('mobileSiteDest');
  const prioBadge = document.getElementById('mobilePriorityBadge');
  const unitNameEl = document.getElementById('mobileUnitName');
  if (unitNameEl) unitNameEl.textContent = unit.namaMbp;

  const sk = statusKey(unit.status);
  const hasTicket = unit.pendingOrder && (sk === 'idle' || sk === 'belum_otw' || sk === 'selesai');
  if (hasTicket) {
    if (orderIdEl) orderIdEl.textContent = unit.pendingOrder.orderId;
    if (siteDestEl) siteDestEl.textContent = unit.pendingOrder.siteDestinasi;
    if (prioBadge) {
      prioBadge.textContent = unit.pendingOrder.prioritas;
      prioBadge.className = `px-2.5 py-0.5 rounded-full text-xs font-bold shrink-0 ${getPriorityBadgeClass(unit.pendingOrder.prioritas)}`;
    }
  } else {
    if (orderIdEl) orderIdEl.textContent = unit.activeOrderId;
    if (siteDestEl) siteDestEl.textContent = unit.activeSite;
    if (prioBadge) {
      prioBadge.textContent = unit.activePriority;
      prioBadge.className = `px-2.5 py-0.5 rounded-full text-xs font-bold shrink-0 ${getPriorityBadgeClass(unit.activePriority)}`;
    }
  }

  const etaValEl = document.getElementById('mobileEtaVal');
  if (etaValEl) etaValEl.textContent = unit.estimasiEta || '-';

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
    const base = 'status-btn w-full py-6 px-5 rounded-2xl border-2 flex flex-col items-center justify-center gap-1 transition-colors';
    const tone = step.disabled ? palette.idle : palette.active;
    btn.disabled = !!step.disabled;
    btn.className = `${base} ${tone}`;
    const labelEl = btn.querySelector('[data-btn-label]');
    const hintEl = btn.querySelector('[data-btn-hint]');
    if (labelEl) labelEl.textContent = step.label;
    if (hintEl) {
      hintEl.textContent = step.hint;
      hintEl.classList.toggle('hidden', !step.hint || step.disabled);
    }
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

function applySheetRecords(sheetRecords) {
  sheetRecords.forEach(r => { r.status = statusKey(r.status); });
  orderList = sheetRecords.slice().reverse();
  localStorage.setItem(STORAGE_KEY_ORDERS, JSON.stringify(orderList));

  const byMbp = new Map();
  for (const row of sheetRecords) {
    const key = (row.namaMbp || '').trim();
    if (!key || row.orderId === '-') continue;
    if (!byMbp.has(key)) byMbp.set(key, []);
    byMbp.get(key).push(row);
  }
  const timestampOf = row => new Date(row.tsSelesai || row.tsOnsite || row.tsOtw || row.tsAccept || 0).getTime() || 0;

  fleetList.forEach(unit => {
    const rows = (byMbp.get((unit.namaMbp || '').trim()) || []).sort((a, b) => timestampOf(b) - timestampOf(a));
    const open = rows.find(row => !['selesai', 'idle'].includes(statusKey(row.status)));
    const localOrderId = unit.pendingOrder?.orderId || (unit.activeOrderId && unit.activeOrderId !== '-' ? unit.activeOrderId : '');
    const localOrder = localOrderId ? orderList.find(row => row.orderId === localOrderId) : null;
    const localTime = new Date(unit.pendingOrder?.dispatchedAt || localOrder?.timestamp || localOrder?.tsAccept || 0).getTime() || 0;
    const serverOrder = localOrderId ? rows.find(row => row.orderId === localOrderId) : null;
    const latestServer = rows[0];
    if (localOrderId && !serverOrder && localTime >= timestampOf(latestServer || {})) {
      if (typeof checkMbpSessionExpiry === 'function') checkMbpSessionExpiry();
      return;
    }

    if (open) {
      const key = statusKey(open.status);
      unit.status = key;
      unit.activeOrderId = open.orderId;
      unit.activeSite = open.siteDestinasi;
      unit.activePriority = open.prioritas;
      unit.estimasiEta = open.estimasiEta || '-';
      unit.selisihOtwEta = open.selisihOtwEta || '-';
      const stamp = open.tsSelesai || open.tsOnsite || open.tsOtw || open.tsAccept;
      if (stamp) unit.tsCurrentStatusStart = stamp;
      if (key === 'belum_otw') {
        unit.pendingOrder = unit.pendingOrder?.orderId === open.orderId ? unit.pendingOrder : {
          orderId: open.orderId, token: open.dispatchToken || '', siteDestinasi: open.siteDestinasi,
          linkMapsSite: open.linkMapsSite || '#', prioritas: open.prioritas, nop: open.nop || '',
          dispatchedAt: open.tsAccept || new Date().toISOString()
        };
      } else {
        unit.pendingOrder = null;
      }
    } else {
      unit.status = 'idle';
      unit.activeOrderId = '-';
      unit.activeSite = '-';
      unit.activePriority = 'Low';
      unit.estimasiEta = '-';
      unit.selisihOtwEta = '-';
      if (latestServer?.tsSelesai) unit.tsIdleStart = unit.tsCurrentStatusStart = latestServer.tsSelesai;
      unit.pendingOrder = null;
    }
    if (typeof checkMbpSessionExpiry === 'function') checkMbpSessionExpiry();
  });

  localStorage.setItem(STORAGE_KEY_FLEET, JSON.stringify(fleetList));
  populateSelectDropdowns();
}

let isSyncing = false;
let lastServerDataHash = '';

// ponytail: batasi 30 option di datalist agar main thread tidak freeze saat autocomplete, upgrade when: daftar site > 50.000 baris butuh virtual list
function refreshSiteDatalist(query = '') {
  const siteList = document.getElementById('dispatchSiteList');
  if (!siteList) return;
  const q = query.trim().toLowerCase();
  const sites = sitesInScope();
  const matched = (q
    ? sites.filter(s => (s.siteId + ' ' + (s.nama || '')).toLowerCase().includes(q))
    : sites
  ).slice(0, 30);

  siteList.innerHTML = matched.map(s => {
    const label = s.nama && s.nama !== s.siteId ? `${s.siteId} — ${s.nama}` : s.siteId;
    return `<option value="${escapeHtml(s.siteId)}" label="${escapeHtml(label)}"></option>`;
  }).join('');
}

function refreshMbpDatalist(query = '') {
  const mbpList = document.getElementById('dispatchMbpList');
  if (!mbpList) return;
  const q = query.trim().toLowerCase();
  const fleet = fleetInScope();
  const matched = (q
    ? fleet.filter(m => (m.namaMbp + ' ' + (m.id || '')).toLowerCase().includes(q))
    : fleet
  ).slice(0, 30);

  mbpList.innerHTML = matched.map(m => {
    const label = `${m.namaMbp} — [${STATUS_LABEL[statusKey(m.status)]}]`;
    return `<option value="${escapeHtml(m.namaMbp)}" label="${escapeHtml(label)}"></option>`;
  }).join('');
}
window.refreshMbpDatalist = refreshMbpDatalist;

function applyMasterResponse(json) {
  if (!json?.masterData || !Array.isArray(json.masterData.personil) || !Array.isArray(json.masterData.sites) || !Array.isArray(json.masterData.units)) return;
  masterData = json.masterData;
  localStorage.setItem(STORAGE_KEY_MASTER, JSON.stringify(masterData));
  syncFleetFromMaster();
  renderAdminTables();
}

function applyServerPayload(json) {
  if (!json || json.status !== 'success' || !Array.isArray(json.data)) return false;
  if (typeof EXPECTED_BACKEND_VERSION === 'number' && json.backendVersion !== EXPECTED_BACKEND_VERSION) {
    updateConnectionBadge(false, 'Backend perlu deploy ulang');
    notifySyncError('Versi backend di server tidak sama dengan frontend. Deploy ulang Apps Script.');
    return false;
  }
  const rows = json.data.filter(r => r.orderId && r.orderId !== '-');
  if (currentUser?.role === 'mbp') {
    const row = rows.find(item => item.orderId === currentUser.orderId);
    if (row && statusKey(row.status) === 'selesai') {
      orderList = [row];
      applySheetRecords([row]);
    } else if (row) {
      orderList = [row];
      const unit = fleetList.find(item => item.namaMbp === currentUser.unit || item.id === currentUser.unit);
      if (unit) {
        unit.status = statusKey(row.status);
        unit.activeOrderId = row.orderId;
        unit.activeSite = row.siteDestinasi;
        unit.activePriority = row.prioritas;
        unit.estimasiEta = row.estimasiEta || '-';
        unit.selisihOtwEta = row.selisihOtwEta || '-';
        unit.pendingOrder = statusKey(row.status) === 'belum_otw' ? {
          orderId: row.orderId, token: row.dispatchToken || currentUser.dispatchToken || '',
          siteDestinasi: row.siteDestinasi, linkMapsSite: row.linkMapsSite || '#',
          prioritas: row.prioritas, nop: row.nop || '', dispatchedAt: row.tsAccept || new Date().toISOString()
        } : null;
      }
    }
  } else {
    applySheetRecords(rows);
  }
  applyMasterResponse(json);
  renderAll();
  const syncText = document.getElementById('lastSyncText');
  if (syncText) syncText.textContent = 'Sync: ' + new Date().toLocaleTimeString('id-ID');
  updateConnectionBadge(true);
  return true;
}

function notifySyncError(message) {
  const syncText = document.getElementById('lastSyncText');
  if (syncText) syncText.textContent = 'Sync gagal: ' + message;
  const feedback = document.getElementById('mobileSyncFeedback');
  if (feedback) {
    feedback.textContent = 'Gagal simpan: ' + message;
    feedback.classList.remove('hidden', 'text-emerald-700');
    feedback.classList.add('text-rose-700');
    clearTimeout(feedback.__hideTimer);
    feedback.__hideTimer = setTimeout(() => feedback.classList.add('hidden'), 5000);
  }
  updateConnectionBadge(false, 'Sync gagal');
}

function getGasSessionToken() {
  return typeof readSession === 'function' ? readSession()?.sessionToken || '' : '';
}

function getApiSessionToken() {
  return currentUser?.role === 'mbp'
    ? mbpRuntimeState?.sessionToken || currentUser.sessionToken || ''
    : getGasSessionToken();
}

const sbTs = v => (v && v !== '-' ? v : null);

const sbToOrder = r => ({
  orderId: r.order_id, namaMbp: r.nama_mbp || '', noWa: r.no_wa || '',
  siteDestinasi: r.site_destinasi || '', linkMapsSite: r.link_maps_site || '',
  prioritas: r.prioritas || '-', status: r.status || 'Idle',
  durasiIdleSebelumOrder: r.durasi_idle_sebelum_order || '-',
  estimasiEta: r.estimasi_eta || '-', selisihOtwEta: r.selisih_otw_eta || '-',
  tsIdle: r.ts_idle || '', tsAccept: r.ts_accept || '', tsOtw: r.ts_otw || '',
  tsOnsite: r.ts_onsite || '', tsSelesai: r.ts_selesai || '',
  totalDurasi: r.total_durasi || '', nop: r.nop || '',
  dispatchToken: r.dispatch_token || ''
});

function sbToMaster(rows) {
  const out = { personil: [], sites: [], units: [] };
  for (const r of rows || []) {
    if (r.kategori === 'personil') out.personil.push({ id: r.id, nama: r.nama || '', nop: r.nop || '' });
    else if (r.kategori === 'sites') out.sites.push({ siteId: r.id, nama: r.nama || '', nop: r.nop || '', lat: r.latitude, lng: r.longitude });
    else if (r.kategori === 'units') out.units.push({ id: r.id, nama: r.nama || '', nop: r.nop || '', noWa: r.no_wa || '' });
  }
  return out;
}

async function sbReq(path, { method = 'GET', body, token, prefer, signal } = {}) {
  const headers = { apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (prefer) headers.Prefer = prefer;
  const res = await fetch(`${SUPABASE_URL}${path}`, {
    method, headers, body: body !== undefined ? JSON.stringify(body) : undefined, signal
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(data?.error_description || data?.message || data?.msg || `HTTP ${res.status}`);
  return data;
}

async function gasPost(payload, { auth = true } = {}) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return { status: 'error', message: 'Konfigurasi Supabase belum diisi.' };
  const body = { ...payload };
  if (body.action === 'updateStatus' && !body.nop) body.nop = siteNopOf(body.siteDestinasi);
  const token = auth ? getApiSessionToken() : (body.sessionToken || '');
  if (auth && !token) return { status: 'error', message: 'Sesi habis. Login ulang.' };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SYNC_TIMEOUT_MS);
  const sig = controller.signal;
  const isMbp = currentUser?.role === 'mbp' || mbpRuntimeState?.role === 'mbp';

  try {
    let json;

    if (body.action === 'login') {
      const email = `${String(body.username || '').trim().toLowerCase()}@mbp.local`;
      const d = await sbReq('/auth/v1/token?grant_type=password', { method: 'POST', body: { email, password: body.password }, signal: sig });
      const meta = d.user?.app_metadata || {};
      const username = (d.user?.email || email).replace(/@mbp\.local$/i, '');
      json = { status: 'success', sessionToken: d.access_token, user: { username, name: meta.name || username, role: meta.role || 'omc', nop: meta.nop || '', unit: meta.unit || '' } };
    } else if (body.action === 'validateSession') {
      const d = await sbReq('/auth/v1/user', { token, signal: sig });
      const meta = d.app_metadata || {};
      const username = (d.email || '').replace(/@mbp\.local$/i, '');
      json = { status: 'success', user: { username, name: meta.name || username, role: meta.role || 'omc', nop: meta.nop || '', unit: meta.unit || '' } };
    } else if (body.action === 'validateMagicLink') {
      const rows = await sbReq('/rest/v1/rpc/get_ticket_by_token', { method: 'POST', body: { p_order_id: body.orderId, p_token: body.token }, signal: sig });
      const row = rows?.[0];
      if (!row || row.order_id !== body.orderId) return { status: 'error', message: 'Link tugas tidak valid atau sudah tidak berlaku.' };
      if (statusKey(row.status) === 'selesai') return { status: 'error', message: `Tiket ${row.order_id} sudah selesai.` };
      const unitName = row.nama_mbp || body.namaMbp;
      json = { status: 'success', sessionToken: body.token, user: { username: 'mbp', name: unitName, role: 'mbp', unit: unitName, namaMbp: unitName, orderId: row.order_id, dispatchToken: body.token } };
    } else if (body.action === 'logout') {
      if (token && token.includes('.')) await sbReq('/auth/v1/logout', { method: 'POST', token, signal: sig }).catch(() => {});
      return { status: 'success' };
    } else if (body.action === 'read') {
      if (isMbp) {
        const rows = await sbReq('/rest/v1/rpc/get_ticket_by_token', { method: 'POST', body: { p_order_id: currentUser?.orderId || mbpRuntimeState?.orderId || '', p_token: token }, signal: sig });
        json = { status: 'success', backendVersion: EXPECTED_BACKEND_VERSION, data: (rows || []).map(sbToOrder) };
      } else {
        const [tickets, coreMaster, siteMaster] = await Promise.all([
          sbReq('/rest/v1/tickets?select=*&order=ts_accept.asc.nullsfirst', { token, signal: sig }),
          sbReq('/rest/v1/master_data?select=*&kategori=in.(personil,units)', { token, signal: sig }),
          sbReq('/rest/v1/master_data?select=*&kategori=eq.sites', { token, signal: sig })
        ]);
        json = {
          status: 'success',
          backendVersion: EXPECTED_BACKEND_VERSION,
          data: (tickets || []).map(sbToOrder),
          masterData: sbToMaster([...(coreMaster || []), ...(siteMaster || [])])
        };
      }
    } else if (body.action === 'updateStatus') {
      if (isMbp) {
        const rows = await sbReq('/rest/v1/rpc/update_ticket_by_token', {
          method: 'POST', signal: sig,
          body: {
            p_order_id: body.orderId,
            p_token: body.dispatchToken || token,
            p_status: body.newStatus,
            p_durasi_idle_sebelum_order: body.durasiIdleSebelumOrder || null,
            p_estimasi_eta: body.estimasiEta || null,
            p_selisih_otw_eta: body.selisihOtwEta || null,
            p_ts_accept: sbTs(body.tsAccept),
            p_ts_otw: sbTs(body.tsOtw),
            p_ts_onsite: sbTs(body.tsOnsite),
            p_ts_selesai: sbTs(body.tsSelesai),
            p_total_durasi: body.totalDurasi || null
          }
        });
        json = { status: 'success', backendVersion: EXPECTED_BACKEND_VERSION, data: (rows || []).map(sbToOrder) };
      } else {
        const row = {
          order_id: body.orderId, nama_mbp: body.namaMbp || '', no_wa: body.noWa || '',
          site_destinasi: body.siteDestinasi || '', link_maps_site: body.linkMapsSite || '',
          prioritas: body.prioritas || '-', status: body.newStatus,
          durasi_idle_sebelum_order: body.durasiIdleSebelumOrder || '-',
          estimasi_eta: body.estimasiEta || '-', selisih_otw_eta: body.selisihOtwEta || '-',
          ts_idle: sbTs(body.tsIdle), ts_accept: sbTs(body.tsAccept), ts_otw: sbTs(body.tsOtw),
          ts_onsite: sbTs(body.tsOnsite), ts_selesai: sbTs(body.tsSelesai),
          total_durasi: body.totalDurasi || '', nop: body.nop || '',
          dispatch_token: statusKey(body.newStatus) === 'selesai' ? null : (body.dispatchToken || null)
        };
        await sbReq('/rest/v1/tickets?on_conflict=order_id', {
          method: 'POST', token, body: row, prefer: 'resolution=merge-duplicates,return=minimal', signal: sig
        });
        json = { status: 'success' };
      }
    } else if (body.action === 'saveMaster') {
      const m = body.masterData || {};
      const rows = [
        ...(m.personil || []).map(p => ({ kategori: 'personil', id: p.id, nama: p.nama || '', nop: p.nop || '', no_wa: null, latitude: null, longitude: null })),
        ...(m.sites || []).map(s => ({ kategori: 'sites', id: s.siteId, nama: s.nama || '', nop: s.nop || '', no_wa: null, latitude: s.lat === '' || s.lat == null ? null : Number(s.lat), longitude: s.lng === '' || s.lng == null ? null : Number(s.lng) })),
        ...(m.units || []).map(u => ({ kategori: 'units', id: u.id, nama: u.nama || '', nop: u.nop || '', no_wa: u.noWa || '', latitude: null, longitude: null }))
      ];
      await sbReq('/rest/v1/master_data?kategori=in.(personil,sites,units)', { method: 'DELETE', token, signal: sig });
      if (rows.length) await sbReq('/rest/v1/master_data', { method: 'POST', token, body: rows, prefer: 'return=minimal', signal: sig });
      json = { status: 'success', masterData: m };
    } else if (['listUsers', 'setPassword', 'deleteUser'].includes(body.action)) {
      json = await sbReq('/functions/v1/swift-api', {
        method: 'POST', token, body, signal: sig
      });
    } else {
      return { status: 'error', message: 'Aksi tidak dikenal: ' + body.action };
    }

    if (json.status === 'success' && Array.isArray(json.data) && body.action !== 'read') applyServerPayload(json);
    return json;
  } catch (err) {
    const message = err.name === 'AbortError'
      ? 'Server tidak merespons dalam ' + Math.round(SYNC_TIMEOUT_MS / 1000) + ' detik.'
      : (err.message || String(err));
    if (/jwt|expired|invalid.*token|401/i.test(message)) logout();
    notifySyncError(message);
    return { status: 'error', message };
  } finally {
    clearTimeout(timer);
  }
}
window.gasPost = gasPost;

window.gasPost = gasPost;

async function syncFromServer(showSpinner = false) {
  const syncText = document.getElementById('lastSyncText');
  if (!gasWebAppUrl || isSyncing) return;
  const sessionToken = getApiSessionToken();
  if (!sessionToken) return;
  isSyncing = true;
  try {
    const json = await gasPost({ action: 'read' });
    if (json.status !== 'success') return;

    const newHash = JSON.stringify([json.data, json.masterData]);
    if (!showSpinner && newHash === lastServerDataHash) return;

    const accepted = applyServerPayload(json);
    if (accepted) {
      lastServerDataHash = newHash;
      if (typeof saveAndBroadcast === 'function') saveAndBroadcast();
    }
    if (showSpinner && accepted && syncText) syncText.textContent = 'Sync: ' + new Date().toLocaleTimeString('id-ID');
  } catch (err) {
    notifySyncError(err.message || String(err));
  } finally {
    isSyncing = false;
  }
}

async function postToGas(payload) {
  if (!gasWebAppUrl) return { status: 'error', message: 'URL Apps Script belum diatur.' };
  if (payload.action === 'saveMaster') {
    const result = await gasPost(payload);
    if (result.status === 'success') applyMasterResponse({ masterData: payload.masterData });
    return result;
  }
  const result = await gasPost(payload);
  if (result.status === 'success' && payload.action === 'setPassword') result.newPassword = payload.newPassword;
  if (result.status !== 'success') notifySyncError(result.message || 'Gagal menyimpan ke server.');
  return result;
}
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
    cols: ['ID', 'Nama Unit', 'NOP', 'No. WhatsApp'],
    fields: [
      { key: 'id', label: 'ID', type: 'text' },
      { key: 'nama', label: 'Nama Unit', type: 'text' },
      { key: 'nop', label: 'NOP', type: 'text' },
      { key: 'noWa', label: 'No. WhatsApp', type: 'text' }
    ]
  }
};

let adminEdit = { table: null, index: -1 };

const ADMIN_SETTABLE_STATUSES = [
  'idle', 'belum_otw', 'otw', 'waiting_onsite', 'onsite', 'waiting_selesai', 'selesai'
];

function renderAdminFleetStatus() {
  const tbody = document.getElementById('adminFleetStatusBody');
  if (!tbody) return;
  refreshNopFilterUi();

  const rows = fleetInScope();
  if (rows.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="py-4 text-center text-slate-500 text-xs font-mono">Tidak ada unit armada</td></tr>';
    return;
  }

  const opts = ADMIN_SETTABLE_STATUSES.map(k =>
    `<option value="${k}">${escapeHtml(STATUS_LABEL[k])}</option>`
  ).join('');

  tbody.innerHTML = rows.map((unit, i) => {
    const fleetIndex = fleetList.indexOf(unit);
    const cur = statusKey(unit.status);
    const pending = unit.pendingOrder;
    const belum = cur === 'belum_otw';
    const displayOid = belum && pending ? pending.orderId : unit.activeOrderId;
    return `
      <tr class="hover:bg-surface-3 transition">
        <td class="py-2 px-3 text-xs font-bold text-body whitespace-nowrap">${escapeHtml(unit.namaMbp)}</td>
        <td class="py-2 px-3 text-xs font-mono text-amber-700 whitespace-nowrap">${escapeHtml(displayOid || '-')}</td>
        <td class="py-2 px-3 whitespace-nowrap">${getStatusBadgeHtml(unit.status)}</td>
        <td class="py-2 px-3 whitespace-nowrap">
          <select id="adminStatusSelect_${i}" class="bg-surface-2 border border-line-strong rounded-lg px-2 py-1.5 text-[11px] text-body focus:outline-none focus:border-amber-500">
            ${opts}
          </select>
        </td>
        <td class="py-2 px-3 whitespace-nowrap">
          <button type="button" onclick="adminApplyFleetStatus(${fleetIndex})" class="px-2.5 py-1 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-[11px] font-bold">Terapkan</button>
        </td>
      </tr>`;
  }).join('');

  rows.forEach((unit, i) => {
    const sel = document.getElementById('adminStatusSelect_' + i);
    if (sel) sel.value = statusKey(unit.status);
  });
}

async function applyAdminStatusOverride(unit, to) {
  const nowIso = new Date().toISOString();
  const nowMs = Date.now();
  to = statusKey(to);

  let order = unit.activeOrderId && unit.activeOrderId !== '-'
    ? orderList.find(o => o.orderId === unit.activeOrderId)
    : null;
  if (!order && unit.pendingOrder) {
    order = orderList.find(o => o.orderId === unit.pendingOrder.orderId);
  }

  if (to === 'idle' || to === 'selesai') {
    if (!order && unit.activeOrderId !== '-') throw new Error('Order aktif tidak ditemukan; status tidak diubah.');
    if (!order && unit.pendingOrder) order = { ...unit.pendingOrder, namaMbp: unit.namaMbp, noWa: unit.noWa, status: 'belum_otw' };
    if (order && to === 'idle') order.status = 'selesai';
    if (order && to === 'selesai') order.tsSelesai = nowIso;
    const orderSnap = order;
    closeOrder(unit, nowIso, nowMs);
    saveAndBroadcast();
    if (gasWebAppUrl && orderSnap) await postToGas(buildOrderPayload(unit, orderSnap, STATUS_LABEL.selesai, nowIso));
    return;
  }

  if (!order) throw new Error('Status selain Idle memerlukan order aktif.');
  if (to === 'otw') { order.tsOtw = order.tsOtw || nowIso; unit.estimasiEta = order.estimasiEta || '-'; }
  if (to === 'onsite') order.tsOnsite = order.tsOnsite || nowIso;
  if (to === 'waiting_selesai') order.tsSelesai = order.tsSelesai || '';
  if (order) {
    order.status = to;
    if (to === 'otw' && !order.tsOtw) order.tsOtw = nowIso;
    if (to === 'onsite' && !order.tsOnsite) order.tsOnsite = nowIso;
  }

  unit.status = to;
  unit.tsCurrentStatusStart = nowIso;

  saveAndBroadcast();

  if (gasWebAppUrl && order) {
    await postToGas(buildOrderPayload(unit, order, STATUS_LABEL[to] || to, nowIso));
  }
}

async function adminApplyFleetStatus(fleetIndex) {
  if (currentUser?.role !== 'admin') return;
  const unit = fleetList[fleetIndex];
  if (!unit) return;

  const sel = document.getElementById('adminStatusSelect_' + fleetIndex);
  if (!sel) return;

  const to = statusKey(sel.value);
  const from = statusKey(unit.status);
  if (to === from) {
    alert('Status sudah sama.');
    return;
  }

  const fromLabel = STATUS_LABEL[from] || from;
  const toLabel = STATUS_LABEL[to] || to;
  if (!confirm(`Ubah status ${unit.namaMbp}\n${fromLabel} → ${toLabel}?`)) return;

  try {
    await applyAdminStatusOverride(unit, to);
    renderAdminFleetStatus();
  } catch (err) {
    alert(err.message);
  }
}

async function loadAdminAuthUsers() {
  if (currentUser?.role !== 'admin') return;
  const notice = document.getElementById('adminAuthNotice');
  const response = await gasPost({ action: 'listUsers' });
  if (response.status !== 'success') {
    if (notice) {
      notice.textContent = 'Gagal memuat daftar akun: ' + (response.message || 'Edge Function error');
      notice.classList.remove('hidden');
    }
    return;
  }
  if (notice) {
    notice.textContent = '';
    notice.classList.add('hidden');
  }
  const tbody = document.getElementById('adminAuthUsersBody');
  if (!tbody) return;
  const users = response.users || [];
  tbody.innerHTML = users.map(user => `
    <tr>
      <td class="py-2 px-3 font-mono text-xs">${escapeHtml(user.username)}</td>
      <td class="py-2 px-3 text-xs">${escapeHtml(user.name)}</td>
      <td class="py-2 px-3 font-mono text-xs">${escapeHtml(user.nop || '-')}</td>
      <td class="py-2 px-3 text-xs">${escapeHtml(user.role)}</td>
      <td class="py-2 px-3 whitespace-nowrap">
      <button type="button" data-username="${escapeHtml(user.username)}" onclick="adminResetAuthPassword(this.dataset.username)" class="px-2 py-1 rounded bg-surface-3 text-xs mr-1">Atur password</button>
        ${user.username !== currentUser?.username
          ? `<button type="button" data-username="${escapeHtml(user.username)}" onclick="adminDeleteAuthUser(this.dataset.username)" class="px-2 py-1 rounded bg-rose-500/20 text-rose-700 text-xs">Hapus</button>`
          : ''}
      </td>
    </tr>
  `).join('');
  const known = new Set(users.map(user => user.username));
  const select = document.getElementById('adminAuthPersonSelect');
  if (select) {
    const people = (masterData.personil || []).filter(person => !known.has(String(person.id).toLowerCase()));
    select.innerHTML = people.map(person => `<option value="${escapeHtml(person.id)}">${escapeHtml(person.id)} — ${escapeHtml(person.nama)} (${escapeHtml(person.nop)})</option>`).join('');
    select.disabled = !people.length;
  }
}

async function adminSetAuthPassword(username, createIfMissing = false, forcedPassword = null) {
  const inputEl = document.getElementById('adminAuthNewPassword');
  const password = forcedPassword !== null ? forcedPassword : (inputEl?.value || '');
  if (password.length < 8) {
    alert('Password minimal 8 karakter.');
    return;
  }
  const person = masterData.personil.find(item => String(item.id).toLowerCase() === username);
  const response = await gasPost({
    action: 'setPassword', targetUsername: username, newPassword: password, createIfMissing,
    role: 'omc', name: person?.nama || username, nop: person?.nop || ''
  });
  if (response.status !== 'success') {
    alert('Gagal ubah password: ' + (response.message || 'Error server'));
    return;
  }
  const output = document.getElementById('adminAuthPasswordNotice');
  if (output) {
    output.textContent = `Password baru tersimpan untuk ${response.username}. Berikan password baru tersebut kepada pemilik akun.`;
    output.classList.remove('hidden');
  }
  if (inputEl) inputEl.value = '';
  await loadAdminAuthUsers();
}

function adminSetSelectedAuthPassword() {
  const username = document.getElementById('adminAuthPersonSelect')?.value.toLowerCase();
  if (username) return adminSetAuthPassword(username, true);
  return Promise.resolve();
}

function adminResetAuthPassword(username) {
  const inputEl = document.getElementById('adminAuthNewPassword');
  const pw = inputEl?.value || '';
  if (pw.length < 8) {
    const notice = document.getElementById('adminAuthNotice');
    if (notice) {
      notice.textContent = `Ketik password baru (min. 8 karakter) di kolom "Password baru" terlebih dahulu, lalu klik "Atur password" untuk ${username}.`;
      notice.classList.remove('hidden');
    }
    inputEl?.focus();
    return Promise.resolve();
  }
  return adminSetAuthPassword(username, false, pw);
}

async function adminDeleteAuthUser(username) {
  if (!confirm(`Hapus akun "${username}"?`)) return;
  const response = await gasPost({ action: 'deleteUser', targetUsername: username });
  if (response.status !== 'success') return;
  await loadAdminAuthUsers();
}

function renderAdminTables() {
  const accounts = document.getElementById('adminAccountsPanel');
  if (accounts) accounts.classList.toggle('hidden', currentUser?.role !== 'admin');
  renderAdminFleetStatus();
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
      <tr class="hover:bg-surface-3 transition">
        ${def.fields.map(f => `<td class="py-2 px-3 text-xs whitespace-nowrap ${f.type === 'number' ? 'font-mono text-muted' : 'text-body'}">${escapeHtml(row[f.key] ?? '-')}</td>`).join('')}
        <td class="py-2 px-3 whitespace-nowrap">
          <button onclick="adminEditRow('${key}',${i})" class="px-2 py-0.5 rounded bg-surface-3 hover:bg-surface-2 text-[11px] font-semibold text-body mr-1">Edit</button>
          <button onclick="adminDeleteRow('${key}',${i})" class="px-2 py-0.5 rounded bg-rose-500/20 hover:bg-rose-500/30 text-[11px] font-semibold text-rose-700">Hapus</button>
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
      <label class="block text-xs font-medium text-body mb-1">${escapeHtml(f.label)}</label>
      <input data-admin-field="${escapeHtml(f.key)}" type="${f.type}" value="${escapeHtml(row[f.key] ?? '')}" class="w-full bg-surface-2 border border-line-strong rounded-xl px-3 py-2 text-xs font-mono text-body focus:outline-none focus:border-amber-500" />
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
      <label class="block text-xs font-medium text-body mb-1">${escapeHtml(f.label)}</label>
      <input data-admin-field="${escapeHtml(f.key)}" type="${f.type}" value="" class="w-full bg-surface-2 border border-line-strong rounded-xl px-3 py-2 text-xs font-mono text-body focus:outline-none focus:border-amber-500" />
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
  // 1. Tambah atau update unit dari masterData.units
  masterData.units.forEach(u => {
    let unit = fleetList.find(f => f.namaMbp === u.nama || f.id === u.id);
    if (!unit) {
      fleetList.push({
        id: u.id, namaMbp: u.nama, noWa: u.noWa, nop: u.nop || '', status: 'idle', activeOrderId: '-', activeSite: '-',
        activePriority: 'Low', tsIdleStart: new Date().toISOString(),
        tsCurrentStatusStart: new Date().toISOString(), pendingOrder: null,
        estimasiEta: '-', selisihOtwEta: '-'
      });
    } else {
      unit.namaMbp = u.nama;
      unit.noWa = u.noWa;
      unit.nop = u.nop || unit.nop || '';
    }
  });
  // 2. Hapus unit dari fleetList jika sudah dihapus oleh Admin (kecuali sedang memegang order aktif)
  const validNames = new Set(masterData.units.map(u => u.nama));
  fleetList = fleetList.filter(f => validNames.has(f.namaMbp));
  masterData.units.forEach(unit => {
    if (!fleetList.some(fleet => fleet.id === unit.id || fleet.namaMbp === unit.nama)) {
      fleetList.push({
        id: unit.id, namaMbp: unit.nama, noWa: unit.noWa || '', nop: unit.nop || '',
        status: 'idle', activeOrderId: '-', activeSite: '-', activePriority: 'Low',
        tsIdleStart: new Date().toISOString(), tsCurrentStatusStart: new Date().toISOString(),
        pendingOrder: null, estimasiEta: '-', selisihOtwEta: '-'
      });
    }
  });
}

function goToMbpPage() {
  const dir = location.pathname.replace(/[^/]*$/, '');
  location.href = location.origin + dir + 'mbp.html';
}

function switchRole(role) {
  if (!currentUser || (currentUser.role !== 'admin' && currentUser.role !== 'omc')) return;
  if (currentUser.role === 'omc') role = 'omc';
  if (role === 'mbp') return;
  activeRole = role;
  const views = {
    omc: document.getElementById('viewOmc'),
    admin: document.getElementById('viewAdmin')
  };
  const tabs = {
    omc: document.getElementById('tabOmc'),
    admin: document.getElementById('tabAdmin')
  };
  const onCls = 'flex-1 sm:flex-none text-center px-3.5 py-1.5 rounded-lg text-xs sm:text-sm font-semibold transition-all bg-amber-500 text-slate-950 shadow';
  const offCls = 'flex-1 sm:flex-none text-center px-3.5 py-1.5 rounded-lg text-xs sm:text-sm font-semibold transition-all text-muted hover:text-body';

  Object.keys(views).forEach(k => {
    if (!views[k] || !tabs[k]) return;
    const hide = k !== role;
    views[k].classList.toggle('hidden', hide);
    tabs[k].className = hide ? offCls : onCls;
  });
  tabs.admin?.classList.toggle('hidden', currentUser?.role !== 'admin');

  if (activeRole === 'admin') {
    renderAdminTables();
    loadAdminAuthUsers();
  }
  renderAll();
}

function setAdminNopFilter(nop) {
  if (currentUser?.role !== 'admin') return;
  adminNopFilter = nop || '';
  if (adminNopFilter) localStorage.setItem(STORAGE_KEY_ADMIN_NOP, adminNopFilter);
  else localStorage.removeItem(STORAGE_KEY_ADMIN_NOP);
  refreshNopFilterUi();
  populateSelectDropdowns();
  if (activeRole === 'admin') renderAdminTables();
  renderAll();
}
window.setAdminNopFilter = setAdminNopFilter;

function clearNopFilter() {
  if (currentUser?.role === 'omc') return;
  if (currentUser?.role === 'admin') {
    setAdminNopFilter('');
    return;
  }
  const url = new URL(location.href);
  url.searchParams.delete('nop');
  location.href = url.toString();
}

function toggleConfigModal() {
  if (currentUser?.role !== 'admin') return;
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
  const url = document.getElementById('gasUrlInput').value.trim();
  try {
    const parsed = new URL(url);
    if (parsed.origin !== 'https://script.google.com' || !parsed.pathname.endsWith('/exec')) throw new Error();
  } catch (err) {
    alert('Masukkan URL Apps Script /exec yang valid.');
    return;
  }
  gasWebAppUrl = url;
  localStorage.setItem(STORAGE_KEY_URL, gasWebAppUrl);
  updateConnectionBadge(false, 'Memeriksa backend…');
  toggleConfigModal();
  const session = readSession();
  if (session) syncFromServer(true);
}

function resetDemoData() {
  if (currentUser?.role !== 'admin') return;
  if (!confirm('Reset data lokal armada dan riwayat? Data di server tidak dihapus.')) return;
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
