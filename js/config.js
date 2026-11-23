// ===================================================================
// KONFIGURASI APLIKASI
// Ubah nilai di sini lalu upload ke GitHub.
// ===================================================================

// URL Web App Google Apps Script (berakhiran /exec).
// Kosongkan = aplikasi terkunci (belum bisa login).
// js/config.js
const SUPABASE_URL = 'https://mkbqrwjwgsjjlbjmaobw.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1rYnFyd2p3Z3Nqamxiam1hb2J3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTU0MDAxODYsImV4cCI6MjExMDk3NjE4Nn0.FA-Vhm1FwzPEkVVapARvS8sIhBkaI6TDg4mCEu5Xn5U';

// Kunci localStorage
const STORAGE_KEY_FLEET = 'mbp_fleet_state_v2';
const STORAGE_KEY_ORDERS = 'mbp_orders_log_v2';
const STORAGE_KEY_URL = 'mbp_gas_webapp_url';
const AUTH_SESSION_KEY = 'mbp_auth_session_v1';
const STORAGE_KEY_MASTER = 'mbp_master_data_v1';
const STORAGE_KEY_ADMIN_NOP = 'mbp_admin_nop_filter_v1';
const EXPECTED_BACKEND_VERSION = 3;

// Batas waktu satu permintaan ke backend (ms) supaya koneksi yang macet tidak
// membekukan polling selamanya.
const SYNC_TIMEOUT_MS = 20000;
