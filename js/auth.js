// ===================================================================
// AUTH LOKAL (login via Web Crypto PBKDF2, tanpa server).
// Session disimpan di localStorage (AUTH_SESSION_KEY) dengan masa berlaku.
// apps-script/Crypto.gs adalah padanan sisi server untuk verifikasi Apps Script.
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
  if (roleEl) roleEl.textContent = demo ? (user.role + ' (demo)') : user.role;

  const switcher = document.getElementById('roleSwitcher');
  if (switcher) switcher.classList.toggle('hidden', !demo);

  // Unit MBP milik user mbp langsung dipilih
  if (user.role === 'mbp' && user.unit) {
    const unit = fleetList.find(m => m.namaMbp.startsWith(user.unit));
    if (unit) selectedMobileMbp = unit.namaMbp;
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

function startDemoMode() {
  const user = { username: 'demo', name: 'Mode Demo', role: 'omc', unit: '' };
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

  // Footer demo hanya tampil bila tidak ada server Apps Script
  const footer = document.getElementById('loginFooter');
  const notice = document.getElementById('loginNotice');
  if (isDemoMode()) {
    if (footer) footer.classList.remove('hidden');
    if (notice) notice.textContent = 'Server Apps Script belum diisi, jadi login memakai daftar user lokal di js/demo-users.js.';
  }

  const session = readSession();
  if (session) {
    const login = document.getElementById('loginScreen');
    if (login) login.classList.add('hidden');
  }
}

// Terapkan role setelah app.js selesai init (fleetList sudah terisi)
window.addEventListener('load', () => {
  const session = readSession();
  if (session) applyUser(session, isDemoMode());
});

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initAuth);
} else {
  initAuth();
}
