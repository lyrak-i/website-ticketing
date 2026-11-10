// ===================================================================
// AUTH LOKAL & MAGIC LINK MBP
// Login manual hanya untuk OMC & Admin.
// Teknisi MBP masuk via Magic Link sekali pakai per-Order dari WA.
// ===================================================================

const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

let currentUser = null;

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
  return !gasWebAppUrl;
}

function applyUser(user, demo) {
  currentUser = user;

  const login = document.getElementById('loginScreen');
  if (login) login.classList.add('hidden');

  const badge = document.getElementById('userBadge');
  if (badge) badge.classList.remove('hidden');
  const nameEl = document.getElementById('userName');
  if (nameEl) nameEl.textContent = user.name;
  const roleEl = document.getElementById('userRole');
  if (roleEl) roleEl.textContent = user.role === 'mbp'
    ? `Tiket: ${user.orderId || '-'}`
    : (demo ? (user.role + ' (demo)') : user.role);

  // Role switcher HANYA tampil jika mode demo DAN bukan sesi Magic Link MBP
  const switcher = document.getElementById('roleSwitcher');
  if (switcher) switcher.classList.toggle('hidden', !demo || user.role === 'mbp');

  // Kunci unit MBP untuk teknisi
  const mobSelect = document.getElementById('mobileMbpSelect');
  if (user.role === 'mbp' && user.unit) {
    const unit = fleetList.find(m => m.namaMbp === user.unit || m.namaMbp.startsWith(user.unit));
    if (unit) {
      selectedMobileMbp = unit.namaMbp;
      if (mobSelect) {
        mobSelect.value = unit.namaMbp;
        mobSelect.disabled = true;
        mobSelect.classList.add('opacity-60', 'cursor-not-allowed');
      }
    }
  } else if (mobSelect) {
    mobSelect.disabled = false;
    mobSelect.classList.remove('opacity-60', 'cursor-not-allowed');
  }

  if (typeof switchRole === 'function') {
    switchRole(user.role === 'admin' ? 'admin' : user.role);
  }
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

  const user = DEMO_USERS.find(u => u.username === username);
  if (!user) {
    showLoginError('Username tidak dikenal.');
    return;
  }

  // Batasi login manual: Hanya untuk OMC & Admin
  if (user.role === 'mbp') {
    showLoginError('Login manual hanya untuk OMC & Admin. Teknisi MBP wajib masuk melalui tautan tugas di WhatsApp.');
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

// Validasi & Login via Magic Link WA (?tkn=...&oid=...&mbp=...&site=...&prio=...)
async function tryMagicLinkAuth() {
  const params = new URLSearchParams(location.search);
  const tkn = params.get('tkn');
  const oid = params.get('oid');
  const mbp = params.get('mbp');
  const site = params.get('site') || '-';
  const prio = params.get('prio') || 'High';

  if (!tkn || !oid || !mbp) return false;

  // Bersihkan parameter sensitif dari address bar setelah dibaca
  const cleanUrl = location.origin + location.pathname;
  window.history.replaceState({}, document.title, cleanUrl);

  // 1. Validasi ke Google Sheets terlebih dahulu jika URL GAS terpasang
  if (gasWebAppUrl && typeof syncFromServer === 'function') {
    await syncFromServer(true);
  }

  // 2. Cek apakah order sudah ada di daftar order (hasil sync Sheets / lokal)
  const existingOrder = orderList.find(o => o.orderId === oid);
  if (existingOrder) {
    // Jika tiket sudah dikonfirmasi Selesai oleh OMC, tolak link!
    if (statusKey(existingOrder.status) === 'selesai') {
      logout();
      showLoginError(`Tautan tidak berlaku: Tiket ${oid} sudah dikonfirmasi SELESAI oleh OMC.`);
      return true;
    }
    // Jika token tersimpan di order dan berbeda, tolak
    if (existingOrder.token && existingOrder.token !== tkn) {
      logout();
      showLoginError('Token tautan tidak valid untuk Order ID ini.');
      return true;
    }
  }

  // 3. Siapkan state unit MBP agar tidak terjadi duplikasi saat teknisi klik tombol
  const unit = fleetList.find(m => m.namaMbp === mbp || m.namaMbp.startsWith(mbp));
  if (unit) {
    if (!existingOrder && statusKey(unit.status) === 'idle') {
      // Tiket belum di-Accept di Sheets -> pasang sebagai pendingOrder
      unit.pendingOrder = {
        orderId: oid,
        token: tkn,
        siteDestinasi: site,
        linkMapsSite: typeof getSiteMapsUrl === 'function' ? getSiteMapsUrl(site) : '#',
        prioritas: prio,
        nop: typeof siteNopOf === 'function' ? siteNopOf(site) : '',
        dispatchedAt: new Date().toISOString()
      };
    }
    if (typeof saveAndBroadcast === 'function') saveAndBroadcast();
  }

  const mbpUser = {
    username: `mbp_${oid}`,
    name: mbp,
    role: 'mbp',
    unit: mbp,
    orderId: oid,
    token: tkn
  };

  saveSession(mbpUser);
  applyUser(mbpUser, isDemoMode());
  return true;
}

// Cek apakah sesi MBP yang sedang aktif sudah di-Approve Selesai oleh OMC
function checkMbpSessionExpiry() {
  if (!currentUser || currentUser.role !== 'mbp' || !currentUser.orderId) return;
  const ord = orderList.find(o => o.orderId === currentUser.orderId);
  if (ord && statusKey(ord.status) === 'selesai') {
    logout();
    showLoginError(`Tugas pada tiket ${currentUser.orderId} telah dikonfirmasi SELESAI oleh OMC. Sesi Anda otomatis ditutup.`);
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

  const footer = document.getElementById('loginFooter');
  const notice = document.getElementById('loginNotice');
  if (isDemoMode()) {
    if (footer) footer.classList.remove('hidden');
    if (notice) notice.textContent = 'Login manual khusus OMC & Admin. Teknisi MBP masuk melalui link WhatsApp.';
  }

  const session = readSession();
  if (session) {
    const login = document.getElementById('loginScreen');
    if (login) login.classList.add('hidden');
  }
}

window.addEventListener('load', async () => {
  // Prioritaskan pengecekan Magic Link dari WA terlebih dahulu
  const handledByLink = await tryMagicLinkAuth();
  if (handledByLink) return;

  const session = readSession();
  if (session) {
    if (gasWebAppUrl && typeof syncFromServer === 'function') {
      await syncFromServer(false);
    }
    applyUser(session, isDemoMode());
    checkMbpSessionExpiry();
  }
});

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initAuth);
} else {
  initAuth();
}