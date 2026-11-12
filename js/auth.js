// ===================================================================
// AUTH LOKAL & MAGIC LINK MBP (OPTIMIZED FOR LOW-END MOBILE)
// ===================================================================

const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
let currentUser = null;

// Baca parameter URL SEGERA saat script dimuat (sebelum DOM / window.load)
const INITIAL_URL_PARAMS = new URLSearchParams(window.location.search);
const HAS_MAGIC_LINK = !!(INITIAL_URL_PARAMS.get('tkn') && INITIAL_URL_PARAMS.get('oid') && INITIAL_URL_PARAMS.get('mbp'));

// Jika link WA membawa URL Google Apps Script (&gas=...), langsung simpan otomatis untuk user baru!
const incomingGasUrl = INITIAL_URL_PARAMS.get('gas');
if (incomingGasUrl && incomingGasUrl.startsWith('https://script.google.com/')) {
  localStorage.setItem(STORAGE_KEY_URL, incomingGasUrl);
  if (typeof gasWebAppUrl !== 'undefined') {
    gasWebAppUrl = incomingGasUrl;
  }
}

function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

async function verifyPassword(password, storedHash) {
  const parts = String(storedHash || '').split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;

  const iterations = parseInt(parts[1], 10);
  if (!iterations || iterations < 1) return false;

  const salt = hexToBytes(parts[2]);
  const expected = hexToBytes(parts[3]);
  if (!expected.length) return false;

  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, key, expected.length * 8
  );
  const actual = new Uint8Array(bits);

  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= actual[i] ^ expected[i];
  return diff === 0;
}

function saveSession(user) {
  localStorage.setItem(AUTH_SESSION_KEY, JSON.stringify({
    username: user.username,
    name: user.name,
    role: user.role,
    unit: user.unit || '',
    nop: user.nop || '',
    orderId: user.orderId || '',
    token: user.token || '',
    loginAt: Date.now()
  }));
}

function readSession() {
  try {
    const s = JSON.parse(localStorage.getItem(AUTH_SESSION_KEY));
    if (!s || !s.username) return null;
    if (Date.now() - (s.loginAt || 0) > SESSION_TTL_MS) {
      localStorage.removeItem(AUTH_SESSION_KEY);
      return null;
    }
    return s;
  } catch (err) {
    return null;
  }
}

function isDemoMode() {
  const activeUrl = (typeof gasWebAppUrl !== 'undefined' && gasWebAppUrl) || localStorage.getItem(STORAGE_KEY_URL) || DEFAULT_GAS_URL;
  return !activeUrl;
}

function applyUser(user, demo) {
  currentUser = user;
  const isMbp = user.role === 'mbp';

  // 1. Sembunyikan layar login
  const login = document.getElementById('loginScreen');
  if (login) {
    login.classList.add('hidden');
    login.classList.remove('flex');
  }

  // 2. Tampilkan identitas user
  const badge = document.getElementById('userBadge');
  if (badge) {
    badge.classList.remove('hidden');
    badge.classList.add('flex');
  }
  const nameEl = document.getElementById('userName');
  if (nameEl) nameEl.textContent = user.name;
  const roleEl = document.getElementById('userRole');
  if (roleEl) {
    const nopNote = user.role === 'omc' && user.nop ? ` · NOP ${user.nop}` : '';
    roleEl.textContent = isMbp ? `Tiket: ${user.orderId || '-'}` : (demo ? `${user.role} (demo)${nopNote}` : `${user.role}${nopNote}`);
  }

  // 3. Khusus Teknisi MBP (Orang Awam / HP Low-End):
  // Sembunyikan Role Switcher, Tombol API, dan Tombol Keluar agar tidak salah pencet
  const switcher = document.getElementById('roleSwitcher');
  if (switcher) switcher.classList.toggle('hidden', !demo || isMbp);

  const apiBtn = document.querySelector('button[onclick="toggleConfigModal()"]');
  if (apiBtn) apiBtn.classList.toggle('hidden', isMbp);

  const logoutBtn = document.querySelector('button[onclick="logout()"]');
  if (logoutBtn) logoutBtn.classList.toggle('hidden', isMbp);

  // 4. Kunci pilihan unit MBP & sembunyikan dropdown pilih unit agar layar lebih ringkas
  const mobSelect = document.getElementById('mobileMbpSelect');
  if (isMbp && user.unit) {
    const unit = fleetList.find(m => m.namaMbp === user.unit || m.namaMbp.startsWith(user.unit));
    if (unit) {
      selectedMobileMbp = unit.namaMbp;
      if (mobSelect) {
        mobSelect.value = unit.namaMbp;
        mobSelect.disabled = true;
      }
    }
  } else if (mobSelect) {
    mobSelect.disabled = false;
  }

  // 5. Paksa pindah ke tampilan sesuai role (MBP -> viewMbp)
  if (typeof switchRole === 'function') {
    switchRole(user.role === 'admin' ? 'admin' : user.role);
  }
  if (typeof refreshNopFilterUi === 'function') refreshNopFilterUi();
}

function showLoginError(msg) {
  const el = document.getElementById('loginError');
  if (!el) return;
  el.textContent = msg;
  el.classList.remove('hidden');
}

async function handleLoginSubmit(event) {
  event.preventDefault();
  const username = (document.getElementById('loginUsername')?.value || '').trim().toLowerCase();
  const password = document.getElementById('loginPassword')?.value || '';
  const errEl = document.getElementById('loginError');
  if (errEl) errEl.classList.add('hidden');

  let user = DEMO_USERS.find(u => u.username === username);
  if (!user && typeof masterData !== 'undefined' && Array.isArray(masterData.personil)) {
    const personil = masterData.personil.find(p => String(p.id).toLowerCase() === username);
    const omcBase = DEMO_USERS.find(u => u.username === 'omc');
    if (personil && omcBase) {
      user = {
        username: String(personil.id).toLowerCase(),
        name: personil.nama,
        role: 'omc',
        nop: personil.nop || '',
        unit: '',
        hash: omcBase.hash
      };
    }
  }
  if (!user) {
    showLoginError('Username tidak dikenal.');
    return;
  }

  if (user.role === 'mbp') {
    showLoginError('Login manual hanya untuk OMC & Admin. Teknisi MBP wajib membuka link dari WhatsApp.');
    return;
  }

  let ok = false;
  try {
    ok = await verifyPassword(password, user.hash);
  } catch (err) {
    showLoginError('Verifikasi gagal: ' + err.message);
    return;
  }
  if (!ok) {
    showLoginError('Password salah.');
    return;
  }

  saveSession(user);
  applyUser(user, isDemoMode());
}

async function tryMagicLinkAuth() {
  if (!HAS_MAGIC_LINK) return false;

  const tkn = INITIAL_URL_PARAMS.get('tkn');
  const oid = INITIAL_URL_PARAMS.get('oid');
  const mbp = INITIAL_URL_PARAMS.get('mbp');
  const site = INITIAL_URL_PARAMS.get('site') || '-';
  const prio = INITIAL_URL_PARAMS.get('prio') || 'Medium';

  // Pastikan gasWebAppUrl di app.js memakai URL terbaru
  if (incomingGasUrl && typeof gasWebAppUrl !== 'undefined') {
    gasWebAppUrl = incomingGasUrl;
    if (typeof updateConnectionBadge === 'function') updateConnectionBadge();
  }

  // Bersihkan URL bar agar rapi dan tidak di-bookmark mentah
  const cleanUrl = window.location.origin + window.location.pathname;
  window.history.replaceState({}, document.title, cleanUrl);

  // Pastikan unit MBP ada di fleetList
  let unit = fleetList.find(m => m.namaMbp === mbp || m.namaMbp.startsWith(mbp));
  if (!unit && fleetList.length > 0) {
    unit = fleetList[0];
  }

  // Langsung siapkan sesi dan buka tampilan MBP seketika (tanpa menunggu jaringan lambat)
  const mbpUser = {
    username: `mbp_${oid}`,
    name: unit ? unit.namaMbp : mbp,
    role: 'mbp',
    unit: unit ? unit.namaMbp : mbp,
    orderId: oid,
    token: tkn
  };

  if (unit && (statusKey(unit.status) === 'idle' || statusKey(unit.status) === 'belum_otw')) {
    const dispatchedAt = unit.pendingOrder?.dispatchedAt || new Date().toISOString();
    unit.pendingOrder = {
      orderId: oid,
      token: tkn,
      siteDestinasi: site,
      linkMapsSite: typeof getSiteMapsUrl === 'function' ? getSiteMapsUrl(site) : '#',
      prioritas: prio,
      nop: typeof siteNopOf === 'function' ? siteNopOf(site) : '',
      dispatchedAt
    };
    unit.status = 'belum_otw';
    unit.activeOrderId = oid;
    unit.activeSite = site;
    unit.activePriority = prio;
    unit.estimasiEta = '-';
    unit.tsCurrentStatusStart = dispatchedAt;
  }

  saveSession(mbpUser);
  applyUser(mbpUser, isDemoMode());
  if (typeof renderAll === 'function') renderAll();

  // Validasi ke Google Sheets di latar belakang
  if (gasWebAppUrl && typeof syncFromServer === 'function') {
    await syncFromServer(true);
    const existingOrder = orderList.find(o => o.orderId === oid);
    if (existingOrder) {
      if (statusKey(existingOrder.status) === 'selesai') {
        logout();
        showLoginError(`Tiket ${oid} sudah SELESAI. Link ini sudah tidak berlaku.`);
        return true;
      }
      // Jika tiket masih berjalan di Sheets, pastikan pendingOrder dikosongkan karena sudah aktif
      if (unit) unit.pendingOrder = null;
    } else if (unit && (statusKey(unit.status) === 'idle' || statusKey(unit.status) === 'belum_otw')) {
      // Kembalikan pendingOrder jika di Sheets belum tercatat (karena baru akan dibuat saat klik Terima & OTW)
      const dispatchedAt = unit.pendingOrder?.dispatchedAt || new Date().toISOString();
      unit.pendingOrder = {
        orderId: oid,
        token: tkn,
        siteDestinasi: site,
        linkMapsSite: typeof getSiteMapsUrl === 'function' ? getSiteMapsUrl(site) : '#',
        prioritas: prio,
        nop: typeof siteNopOf === 'function' ? siteNopOf(site) : '',
        dispatchedAt
      };
      unit.status = 'belum_otw';
      unit.activeOrderId = oid;
      unit.activeSite = site;
      unit.activePriority = prio;
      unit.tsCurrentStatusStart = dispatchedAt;
    }
    if (typeof saveAndBroadcast === 'function') saveAndBroadcast();
  }

  return true;
}

function checkMbpSessionExpiry() {
  if (!currentUser || currentUser.role !== 'mbp' || !currentUser.orderId) return;
  const ord = orderList.find(o => o.orderId === currentUser.orderId);
  if (ord && statusKey(ord.status) === 'selesai') {
    logout();
    showLoginError(`Terima kasih! Tugas tiket ${currentUser.orderId} telah dikonfirmasi SELESAI oleh OMC.`);
  }
}

function startDemoMode() {
  const user = { username: 'demo', name: 'Mode Demo (OMC)', role: 'omc', unit: '' };
  saveSession(user);
  applyUser(user, true);
}

function logout() {
  localStorage.removeItem(AUTH_SESSION_KEY);
  currentUser = null;

  const login = document.getElementById('loginScreen');
  if (login) {
    login.classList.remove('hidden');
    login.classList.add('flex');
  }
  const badge = document.getElementById('userBadge');
  if (badge) badge.classList.add('hidden');
  const switcher = document.getElementById('roleSwitcher');
  if (switcher) switcher.classList.add('hidden');

  const pwd = document.getElementById('loginPassword');
  if (pwd) pwd.value = '';
}

function initAuth() {
  const form = document.getElementById('loginForm');
  if (form) form.addEventListener('submit', handleLoginSubmit);

  // Jika masuk dari link WA, langsung sembunyikan layar login sejak detik pertama
  if (HAS_MAGIC_LINK) {
    const login = document.getElementById('loginScreen');
    if (login) login.classList.add('hidden');
    return;
  }

  const footer = document.getElementById('loginFooter');
  const notice = document.getElementById('loginNotice');
  if (isDemoMode()) {
    if (footer) footer.classList.remove('hidden');
    if (notice) notice.textContent = 'Login OMC: username = ID personil di Master (mis. psn-01), password default omc2026. Admin: admin / admin2026. MBP via link WhatsApp.';
  }

  const session = readSession();
  if (session) {
    const login = document.getElementById('loginScreen');
    if (login) login.classList.add('hidden');
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initAuth);
} else {
  initAuth();
}