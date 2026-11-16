// ===================================================================
// KONFIGURASI APLIKASI
// Ubah nilai di sini lalu upload ke GitHub.
// ===================================================================

// URL Web App Google Apps Script (berakhiran /exec).
// Kosongkan = aplikasi terkunci (belum bisa login).
// js/config.js
const DEFAULT_GAS_URL = 'https://script.google.com/macros/s/AKfycbw7HhB7Pn5-30mTzOqA4RYVAxkN6mDpQnO69Rt8rfYwWoLvcyQlWIjyApAylC1viTy7/exec';

// Kunci localStorage
const STORAGE_KEY_FLEET = 'mbp_fleet_state_v2';
const STORAGE_KEY_ORDERS = 'mbp_orders_log_v2';
const STORAGE_KEY_URL = 'mbp_gas_webapp_url';
const AUTH_SESSION_KEY = 'mbp_auth_session_v1';
const STORAGE_KEY_MASTER = 'mbp_master_data_v1';
const STORAGE_KEY_ADMIN_NOP = 'mbp_admin_nop_filter_v1';
const EXPECTED_BACKEND_VERSION = 3;

// Interval polling data dari backend (ms). Makin kecil makin cepat, tapi makin
// banyak kuota Apps Script terpakai — 5 detik cukup untuk halaman MBP.
const SYNC_INTERVAL_MS = 5000;
// Batas waktu satu permintaan ke backend (ms) supaya koneksi yang macet tidak
// membekukan polling selamanya.
const SYNC_TIMEOUT_MS = 20000;
