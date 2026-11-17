const INITIAL_URL_PARAMS = new URLSearchParams(window.location.search);
const HAS_MAGIC_LINK = !!(INITIAL_URL_PARAMS.get('tkn') && INITIAL_URL_PARAMS.get('oid') && INITIAL_URL_PARAMS.get('mbp'));
const incomingGasUrl = INITIAL_URL_PARAMS.get('gas');
if (incomingGasUrl) {
  try {
    const parsedGasUrl = new URL(incomingGasUrl);
    if (parsedGasUrl.origin === 'https://script.google.com' && parsedGasUrl.pathname.endsWith('/exec')) {
      localStorage.setItem(STORAGE_KEY_URL, incomingGasUrl);
      if (typeof gasWebAppUrl !== 'undefined') gasWebAppUrl = incomingGasUrl;
    }
  } catch (err) {
    console.warn('URL Apps Script pada link tidak valid.');
  }
}

let currentUser = null;
// State runtime MBP dideklarasikan di sini (auth.js dimuat sebelum app.js) agar
// readSession() tidak menyentuh binding yang belum terinisialisasi.
let mbpRuntimeState = null;

function sessionPayload(user) {
  return {
    username: user.username,
    name: user.name,
    role: user.role,
    unit: user.unit || '',
    nop: user.nop || '',
    orderId: user.orderId || '',
    namaMbp: user.namaMbp || '',
    sessionToken: user.sessionToken,
    dispatchToken: user.role === 'mbp' ? user.dispatchToken || '' : '',
    loginAt: Date.now()
  };
}

function saveSession(user) {
  const data = JSON.stringify(sessionPayload(user));
  if (user.role === 'mbp') {
    const persisted = JSON.parse(localStorage.getItem(AUTH_SESSION_KEY) || 'null');
    if (persisted?.role === 'mbp') localStorage.removeItem(AUTH_SESSION_KEY);
    sessionStorage.removeItem(AUTH_SESSION_KEY);
    currentUser = user;
    mbpRuntimeState = { role: 'mbp', unit: user.unit, orderId: user.orderId, dispatchToken: user.dispatchToken || '', sessionToken: user.sessionToken };
    return;
  }
  sessionStorage.removeItem(AUTH_SESSION_KEY);
  localStorage.setItem(AUTH_SESSION_KEY, data);
}

function readSession() {
  const runtimeMbp = mbpRuntimeState?.role === 'mbp' && currentUser?.role === 'mbp' ? currentUser : null;
  if (runtimeMbp) return runtimeMbp;
  const raw = localStorage.getItem(AUTH_SESSION_KEY);
  if (!raw) return null;
  try {
    const session = JSON.parse(raw);
    return session?.sessionToken ? session : null;
  } catch (err) {
    return null;
  }
}

function clearAuthSession({ all = false } = {}) {
  const persisted = JSON.parse(localStorage.getItem(AUTH_SESSION_KEY) || 'null');
  // Sesi admin/OMC di localStorage tidak boleh dihapus oleh tab MBP.
  if (all || !persisted || persisted.role === 'mbp') localStorage.removeItem(AUTH_SESSION_KEY);
  sessionStorage.removeItem(AUTH_SESSION_KEY);
  if (currentUser?.role === 'mbp' || mbpRuntimeState?.role === 'mbp') mbpRuntimeState = null;
}

function isDemoMode() { return false; }

function applyUser(user) {
  currentUser = user;
  const isMbp = user.role === 'mbp';
  const unitName = user.unit || user.namaMbp || user.name;
  selectedMobileMbp = isMbp ? unitName : selectedMobileMbp;
  if (isMbp) {
    const cleanUrl = window.location.origin + window.location.pathname;
    window.history.replaceState({}, document.title, cleanUrl);
    const sessionFleet = JSON.parse(sessionStorage.getItem(STORAGE_KEY_FLEET) || '[]');
    const matched = sessionFleet.find(item => item.namaMbp === unitName || item.id === unitName)
      || fleetList.find(item => item.namaMbp === unitName || item.id === unitName)
      || getSeedFleet().find(item => item.namaMbp === unitName || item.id === unitName);
    fleetList = matched ? [matched] : [];
    orderList = JSON.parse(sessionStorage.getItem(STORAGE_KEY_ORDERS) || '[]');
    selectedMobileMbp = matched?.namaMbp || unitName;
    mbpRuntimeState = { role: 'mbp', unit: unitName, orderId: user.orderId, dispatchToken: user.dispatchToken || '', sessionToken: user.sessionToken };
    localStorage.removeItem(STORAGE_KEY_FLEET);
    localStorage.removeItem(STORAGE_KEY_ORDERS);
    localStorage.removeItem(STORAGE_KEY_MASTER);
  } else {
    mbpRuntimeState = null;
  }
  document.getElementById('loginScreen')?.classList.add('hidden');
  document.getElementById('loginScreen')?.classList.remove('flex');
  document.getElementById('loginError')?.classList.add('hidden');
  const badge = document.getElementById('userBadge');
  badge?.classList.remove('hidden');
  badge?.classList.add('flex');
  const name = document.getElementById('userName');
  const role = document.getElementById('userRole');
  if (name) name.textContent = user.name;
  if (role) role.textContent = isMbp ? `Tiket: ${user.orderId || '-'}` : `${user.role}${user.nop ? ` · NOP ${user.nop}` : ''}`;
  const isAdmin = user.role === 'admin';
  document.getElementById('roleSwitcher')?.classList.toggle('hidden', isMbp || !isAdmin);
  document.getElementById('tabAdmin')?.classList.toggle('hidden', !isAdmin);
  document.querySelector('button[onclick="toggleConfigModal()"]')?.classList.toggle('hidden', isMbp || !isAdmin);
  const logoutBtn = document.querySelector('button[onclick="logout()"]');
  logoutBtn?.classList.toggle('hidden', isMbp);
  logoutBtn?.addEventListener('click', event => {
    event.preventDefault();
    logout();
  }, { once: true });
  if (!isMbp && typeof switchRole === 'function') switchRole(isAdmin ? 'admin' : 'omc');
  if (typeof refreshNopFilterUi === 'function') refreshNopFilterUi();
}

function showLoginError(message) {
  const el = document.getElementById('loginError');
  if (!el) return;
  el.textContent = message;
  el.classList.remove('hidden');
}

async function handleLoginSubmit(event) {
  event.preventDefault();
  const username = document.getElementById('loginUsername')?.value.trim().toLowerCase();
  const password = document.getElementById('loginPassword')?.value || '';
  document.getElementById('loginError')?.classList.add('hidden');
  const result = await gasPost({ action: 'login', username, password }, { auth: false });
  if (result.status !== 'success') {
    clearAuthSession();
    showLoginError(result.message || 'Login gagal.');
    return;
  }
  const user = { ...result.user, sessionToken: result.sessionToken };
  saveSession(user);
  applyUser(user);
  await syncFromServer(true);
}

async function tryMagicLinkAuth() {
  if (!HAS_MAGIC_LINK) return false;
  clearAuthSession();
  if (typeof gasPost !== 'function') {
    document.getElementById('loginScreen')?.classList.remove('hidden');
    showLoginError('Backend belum siap dimuat. Muat ulang halaman.');
    return true;
  }
  const token = INITIAL_URL_PARAMS.get('tkn');
  const orderId = INITIAL_URL_PARAMS.get('oid');
  const namaMbp = INITIAL_URL_PARAMS.get('mbp');
  const site = INITIAL_URL_PARAMS.get('site') || '-';
  currentUser = null;
  const result = await gasPost({ action: 'validateMagicLink', orderId, token, namaMbp }, { auth: false });
  if (result.status !== 'success') {
    document.getElementById('loginScreen')?.classList.remove('hidden');
    document.getElementById('loginScreen')?.classList.add('flex');
    showLoginError(result.message || 'Link tugas tidak valid.');
    return true;
  }
  const cleanUrl = window.location.origin + window.location.pathname;
  window.history.replaceState({}, document.title, cleanUrl);
  const user = { ...result.user, sessionToken: result.sessionToken, dispatchToken: token };
  saveSession(user);
  applyUser(user);
  let unit = fleetList.find(item => item.namaMbp === user.unit || item.id === user.unit);
  if (!unit) {
    const resultRead = await gasPost({ action: 'read', sessionToken: result.sessionToken }, { auth: false });
    if (resultRead.status === 'success') {
      masterData = resultRead.masterData || masterData;
      localStorage.setItem(STORAGE_KEY_MASTER, JSON.stringify(masterData));
      syncFleetFromMaster();
      applyServerPayload(resultRead);
      unit = fleetList.find(item => item.namaMbp === user.unit || item.id === user.unit);
    }
  }
  if (!unit) {
    await gasPost({ action: 'logout', sessionToken: result.sessionToken }, { auth: false });
    clearAuthSession();
    currentUser = null;
    mbpRuntimeState = null;
    document.getElementById('loginScreen')?.classList.remove('hidden');
    document.getElementById('loginScreen')?.classList.add('flex');
    showLoginError('Unit MBP pada link tidak ditemukan. Hubungi OMC.');
    return true;
  }
  if (['idle', 'belum_otw'].includes(statusKey(unit.status))) {
    const dispatchedAt = new Date().toISOString();
    unit.pendingOrder = { orderId, token, siteDestinasi: site, linkMapsSite: getSiteMapsUrl(site), prioritas: '-', nop: siteNopOf(site), dispatchedAt };
    unit.status = 'belum_otw';
    unit.activeOrderId = orderId;
    unit.activeSite = site;
    unit.activePriority = '-';
    unit.tsCurrentStatusStart = dispatchedAt;
  }
  saveSession(user);
  applyUser(user);
  renderAll();
  await syncFromServer(true);
  if (orderList.some(order => order.orderId === orderId && statusKey(order.status) === 'selesai')) {
    const completedId = user.orderId;
    await logout();
    showLoginError(`Tiket ${completedId} sudah selesai.`);
  }
  return true;
}

async function checkMbpSessionExpiry() {
  if (currentUser?.role === 'mbp' && currentUser.orderId) {
    const order = orderList.find(item => item.orderId === currentUser.orderId);
    if (order && statusKey(order.status) === 'selesai') {
      const orderId = currentUser.orderId;
      await logout();
      showLoginError(`Terima kasih! Tugas tiket ${orderId} telah selesai.`);
    }
  }
}

async function logout() {
  const session = readSession();
  const wasMbp = currentUser?.role === 'mbp' || mbpRuntimeState?.role === 'mbp';
  if (session?.sessionToken && typeof gasPost === 'function') {
    try {
      await gasPost({ action: 'logout', sessionToken: session.sessionToken }, { auth: false });
    } catch (err) {
      console.warn('Server logout gagal:', err);
    }
  }
  clearAuthSession({ all: true });
  currentUser = null;
  if (wasMbp) {
    mbpRuntimeState = null;
    fleetList = getSeedFleet();
    orderList = [];
    sessionStorage.removeItem(STORAGE_KEY_FLEET);
    sessionStorage.removeItem(STORAGE_KEY_ORDERS);
    localStorage.removeItem(STORAGE_KEY_FLEET);
    localStorage.removeItem(STORAGE_KEY_ORDERS);
    localStorage.removeItem(STORAGE_KEY_MASTER);
    masterData = JSON.parse(JSON.stringify(MASTER_SEED));
    selectedMobileMbp = '';
  }
  const loginScreen = document.getElementById('loginScreen');
  if (loginScreen) {
    loginScreen.classList.remove('hidden');
    loginScreen.classList.add('flex');
  }
  document.getElementById('userBadge')?.classList.add('hidden');
  document.getElementById('roleSwitcher')?.classList.add('hidden');
  document.getElementById('viewOmc')?.classList.add('hidden');
  document.getElementById('viewAdmin')?.classList.add('hidden');
  const password = document.getElementById('loginPassword');
  if (password) password.value = '';
  document.getElementById('loginError')?.classList.add('hidden');
  if (typeof renderAll === 'function') renderAll();
}
window.logout = logout;

async function initAuth() {
  const form = document.getElementById('loginForm');
  if (form) form.addEventListener('submit', handleLoginSubmit);
  if (HAS_MAGIC_LINK) return;
  const session = readSession();
  if (!session) {
    document.getElementById('loginScreen')?.classList.remove('hidden');
    return;
  }
  if (typeof gasPost !== 'function') {
    clearAuthSession({ all: true });
    document.getElementById('loginScreen')?.classList.remove('hidden');
    showLoginError('Backend belum siap dimuat. Muat ulang halaman.');
    return;
  }
  const result = await gasPost({ action: 'validateSession', sessionToken: session.sessionToken }, { auth: false });
  if (result.status === 'success') {
    const user = { ...result.user, sessionToken: session.sessionToken };
    saveSession(user);
    applyUser(user);
  } else {
    clearAuthSession({ all: true });
    document.getElementById('loginScreen')?.classList.remove('hidden');
    showLoginError(result.message || 'Sesi tidak bisa divalidasi. Login ulang.');
  }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initAuth, { once: true });
else initAuth();

window.tryMagicLinkAuth = tryMagicLinkAuth;
