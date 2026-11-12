// ===================================================================
// USER DEMO (login lokal tanpa server).
// Hash = pbkdf2$10000$<SALT_HEX>$<HASH_HEX>
// Password default: omc=omc2026, admin=admin2026, mbp01..04=mbp2026
// Ganti password sebelum produksi: tools/hash_password.py
// ===================================================================
const DEMO_USERS = [
  // Password default OMC: omc2026 — juga dipakai login via ID personil (psn-01, psn-02, …) + NOP dari master
  { username: 'omc',    name: 'Operator OMC (semua NOP, demo)', role: 'omc',   unit: '', nop: '',       hash: 'pbkdf2$10000$7655671bf2e3a9dde0d81431de7ea036$dcafaa0490bb438fa347fd24ec83e1f4937e3e33750e2b7291303cacd45377ce' },
  { username: 'admin',  name: 'Administrator Master Data',  role: 'admin', unit: '',       hash: 'pbkdf2$10000$c2ab6bd3d5ea28385e33a39e3cb8394b$509ad95ea212ef0d4a3e973865df363a605b1d52ad9e2f41afe78ee5aa481191' },
  { username: 'mbp01',  name: 'MBP-01 (Tim Alpha)',        role: 'mbp',   unit: 'MBP-01', hash: 'pbkdf2$10000$e449dda3b16620127960d5505f7c81e0$7960e08908ad8679a7f9331976452b4e596e11f6d33861a802a4a2a7b91a3f4a' },
  { username: 'mbp02',  name: 'MBP-02 (Tim Bravo)',        role: 'mbp',   unit: 'MBP-02', hash: 'pbkdf2$10000$a83b36b0405b18a1fbe9ae31b91d5c27$3bfffd434b5310128e6c6191cf7c819bceb2afa14dfc7fa10a4690a7958e75f9' },
  { username: 'mbp03',  name: 'MBP-03 (Tim Charlie)',      role: 'mbp',   unit: 'MBP-03', hash: 'pbkdf2$10000$c6a1aad1823746b85b6aa6522e7670a3$3fb7dd69cd8ab8c0bf3e97d1417e128db648e0133b3ae233b914c3a8c212a276' },
  { username: 'mbp04',  name: 'MBP-04 (Tim Delta)',        role: 'mbp',   unit: 'MBP-04', hash: 'pbkdf2$10000$1bafdf70e0eed5bce46e352ce3f3cb77$03956986c4f1f7481dbcd6031c8e50235067fb1e1d7b07b73a6ffd6879bd18d2' }
];
