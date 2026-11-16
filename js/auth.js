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

function saveSession(user) {
  localStorage.setItem(AUTH_SESSION_KEY, JSON.stringify({
    username: user.username,
    name: user.name,
    role: user.role,
    unit: user.unit || '',
    nop: user.nop || '',
    orderId: user.orderId || '',
    namaMbp: user.namaMbp || '',
    sessionToken: user.sessionToken,
    loginAt: Date.now()
  }));
}

function readSession() {
  try {
    const session = JSON.parse(localStorage.getItem(AUTH_SESSION_KEY));
    return session?.sessionToken ? session : null;
  } catch (err) {
    return null;
  }
}

function isDemoMode() { return false; }

function applyUser(user) {
  currentUser = user;
  const isMbp = user.role === 'mbp';
  document.getElementById('loginScreen')?.classList.add('hidden');
  document.getElementById('loginScreen')?.classList.remove('flex');
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
  document.querySelector('button[onclick="logout()"]')?.classList.toggle('hidden', isMbp);
  if (isMbp) selectedMobileMbp = user.unit;
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
    localStorage.removeItem(AUTH_SESSION_KEY);
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
  const token = INITIAL_URL_PARAMS.get('tkn');
  const orderId = INITIAL_URL_PARAMS.get('oid');
  const namaMbp = INITIAL_URL_PARAMS.get('mbp');
  const site = INITIAL_URL_PARAMS.get('site') || '-';
  const priority = INITIAL_URL_PARAMS.get('prio') || 'Medium';
  const result = await gasPost({ action: 'validateMagicLink', orderId, token, namaMbp }, { auth: false });
  const cleanUrl = window.location.origin + window.location.pathname;
  window.history.replaceState({}, document.title, cleanUrl);
  if (result.status !== 'success') {
    document.getElementById('loginScreen')?.classList.remove('hidden');
    showLoginError(result.message || 'Link tugas tidak valid.');
    return true;
  }
  const user = { ...result.user, sessionToken: result.sessionToken };
  let unit = fleetList.find(item => item.namaMbp === user.unit || item.id === user.unit);
  if (!unit) {
    await syncFromServer(true);
    unit = fleetList.find(item => item.namaMbp === user.unit || item.id === user.unit);
  }
  if (!unit) {
    await gasPost({ action: 'logout', sessionToken: result.sessionToken }, { auth: false });
    document.getElementById('loginScreen')?.classList.remove('hidden');
    showLoginError('Unit MBP pada link tidak ditemukan. Hubungi OMC.');
    return true;
  }
  if (['idle', 'belum_otw'].includes(statusKey(unit.status))) {
    const dispatchedAt = new Date().toISOString();
    unit.pendingOrder = { orderId, token, siteDestinasi: site, linkMapsSite: getSiteMapsUrl(site), prioritas: priority, nop: siteNopOf(site), dispatchedAt };
    unit.status = 'belum_otw';
    unit.activeOrderId = orderId;
    unit.activeSite = site;
    unit.activePriority = priority;
    unit.tsCurrentStatusStart = dispatchedAt;
  }
  saveSession(user);
  applyUser(user);
  renderAll();
  await syncFromServer(true);
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
  if (session?.sessionToken) await gasPost({ action: 'logout', sessionToken: session.sessionToken }, { auth: false });
  localStorage.removeItem(AUTH_SESSION_KEY);
  currentUser = null;
  if (login) login.classList.remove('hidden');
  login?.classList.add('flex');
  document.getElementById('userBadge')?.classList.add('hidden');
  document.getElementById('roleSwitcher')?.classList.add('hidden');
  const password = document.getElementById('loginPassword');
  if (password) password.value = '';
}

async function initAuth() {
  const form = document.getElementById('loginForm');
  if (form) form.addEventListener('submit', handleLoginSubmit);
  if (HAS_MAGIC_LINK) {
    document.getElementById('loginScreen')?.classList.add('hidden');
    return;
  }
  const session = readSession();
  if (!session) {
    document.getElementById('loginScreen')?.classList.remove('hidden');
    return;
  }
  // Defer scripts run in document order, so app.js defines gasPost immediately after this file.
  if (typeof gasPost !== 'function') {
    localStorage.removeItem(AUTH_SESSION_KEY);
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
    localStorage.removeItem(AUTH_SESSION_KEY);
    document.getElementById('loginScreen')?.classList.remove('hidden');
    showLoginError(result.message || 'Sesi tidak bisa divalidasi. Login ulang.');
  }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initAuth, { once: true });
else initAuth();