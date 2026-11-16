// Tidak ada lagi kredensial di sisi browser.
// Login memakai server (apps-script/Auth.gs): session token disimpan di browser,
// tapi password hanya pernah dikirim ke backend dan disimpan sebagai hash PBKDF2
// di tab `Auth_Users`.
const DEMO_USERS = [];
