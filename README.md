# website-ticketing
website untuk meninjau tiket mbp

## Sinkronisasi Google Sheets

Semua device membaca & menulis status tiket lewat satu Google Apps Script Web App.
Backend ada di `apps-script/` — **deploy manual, tidak ikut ter-push**. Ada tiga
file yang harus di-paste bersamaan:

| File | Isi |
|---|---|
| `apps-script/Code.gs` | Router API, baca/tulis Sheet, proteksi akses per role |
| `apps-script/Auth.gs` | Login, sesi, magic link, pengelolaan akun |
| `apps-script/Crypto.gs` | PBKDF2-HMAC-SHA256 (Apps Script tidak punya Web Crypto) |

### Deploy backend (sekali saja)

1. Buka <https://script.google.com> → **New project**
2. Paste **ketiga** file di atas sebagai file script terpisah (`Code.gs`, `Auth.gs`, `Crypto.gs`)
3. Cek `getSpreadsheetId()` = `1TihE0UILTdwP0bUXTu7K6ukbsGGhYFBFAfopYVzBl8Q`, `getSheetName()` = `Sheet1`
4. **Deploy → New deployment → Web app**
   - Execute as: **Me**
   - Who has access: **Anyone**
5. Salin URL `/exec` → tempel ke `js/config.js` (`DEFAULT_GAS_URL`)

> Kalau Sheet kamu punya tab selain `Sheet1`, ubah `getSheetName()`.
> Setelah kode diubah: **Deploy → Manage deployments → Edit → Version: New version → Deploy**.

### Google Sheet: tiket + master data + akun

**Tab `Sheet1` (tiket)** — header baris 1, urutan kolom harus sama seperti di
`apps-script/Code.gs` → `getColumns()`. Baris lama **tidak perlu diubah**:
backend hanya menambahkan kolom di ujung, tidak menggeser kolom yang sudah ada.

| Kolom | Nama | Kolom | Nama |
|---|---|---|---|
| A | orderId | I | estimasiEta |
| B | namaMbp | J | selisihOtwEta |
| C | noWa | K | tsIdle |
| D | siteDestinasi | L | tsAccept |
| E | linkMapsSite | M | tsOtw |
| F | prioritas | N | tsOnsite |
| G | status | O | tsSelesai |
| H | durasiIdleSebelumOrder | P | totalDurasi |
| | | **Q** | **nop** (baru) |
| | | **R** | **dispatchToken** (baru) |

Kolom Q dan R ditambahkan otomatis saat backend pertama kali menyentuh sheet.
Kalau Q/R sudah terisi dengan nama lain, backend berhenti dengan pesan error
daripada menimpa data — backup sheet dulu kalau sampai begitu.

**Tab baru `MasterData`** (untuk login OMC per NOP & unit MBP):

1. Di spreadsheet yang sama, buat tab bernama **`MasterData`** (nama persis).
2. Sel **`A1`** berisi satu objek JSON:
   ```json
   {
     "personil": [{"id":"PSN-01","nama":"Andi (OMC Palembang)","nop":"PLM-014"}],
     "sites": [{"siteId":"SITE-PLM-014","nama":"SITE-PLM-014 (Ilir Barat)","nop":"PLM-014","lat":-2.99,"lng":104.75}],
     "units": [{"id":"MBP-01","nama":"MBP-01 (Tim Alpha)","nop":"PLM-014","noWa":"6281234567801"}]
   }
   ```
3. Isi pertama kali bisa dikosongkan (`{}`); setelah deploy backend baru, buka **Admin** di web lalu **Simpan** master data — JSON akan tertulis ke `A1` lewat aksi `saveMaster`.
4. **Setiap unit MBP wajib punya field `nop`** (sama dengan NOP wilayah armada). OMC login memakai **username = ID personil huruf kecil** (`psn-01`).

**Tab baru `Auth_Users`** — dibuat otomatis oleh backend saat pertama kali
dibuka. Kolomnya: `username`, `role`, `name`, `nop`, `unit`, `passwordHash`,
`updatedAt`. **Isi manual jangan dihapus** — di sanalah hash password tersimpan.

### Login pertama & reset password admin

1. Di editor Apps Script, buka **Project Settings** → **Script Properties**.
2. Tambahkan `INITIAL_ADMIN_PASSWORD` dengan password awal yang kamu buat
   (minimal 8 karakter). Jangan taruh password ini di source atau di Sheet.
3. Simpan Script Properties, lalu jalankan fungsi backend apa pun untuk
   membuat tab `Auth_Users`, atau biarkan login pertama membuatnya.
4. Login dengan username `admin` dan password dari Script Property, lalu
   segera buka tab **Admin** → **Akun Login OMC**, pilih `admin`, masukkan
   password baru, lalu **Buat akun / atur password**. Script Property awal
   dihapus setelah reset berhasil.

Password yang dimasukkan admin **tidak dapat dibaca kembali** setelah hash
tersimpan. Jika lupa, reset lagi dan berikan password baru yang kamu pilih.

### Onboarding orang OMC

1. Tambahkan personil di tab **Admin** → **Personil OMC**; ID menjadi username,
   NOP wajib diisi, lalu simpan.
2. Di panel **Akun Login OMC**, pilih personil yang belum memiliki akun,
   masukkan password awal minimal 8 karakter, lalu tekan **Buat akun / atur password**.
3. Berikan password itu secara aman kepada orangnya. Admin tidak dapat
   melihat password lama; hanya hash PBKDF2 yang disimpan di `Auth_Users`.

Akun OMC hanya bisa membaca dan mengubah tiket dalam NOP-nya; scope ini dicek
oleh Apps Script, tidak hanya oleh filter browser.

## Autentikasi

- Login dan validasi magic link adalah satu-satunya permintaan yang boleh
  tanpa sesi. Semua baca/tulis data lain wajib menyertakan token sesi.
- Sesi berlaku 12 jam. Halaman selalu memvalidasi sesi ke server saat dibuka;
  sesi yang sudah tidak berlaku memaksa login ulang.
- Password disimpan sebagai PBKDF2-HMAC-SHA256 (10.000 iterasi, salt acak).
- Magic link MBP diverifikasi server: token harus cocok dengan baris tiket,
  untuk unit yang benar, dan tiket belum `Selesai`.

## Urutan status satu tiket

| Tahap | Status di Sheet | Siapa |
|---|---|---|
| 1 | `Belum OTW` | OMC saat kirim WA (order dibuat) |
| 2 | `OTW to Site` | MBP tekan "Terima & OTW" |
| 3 | `Waiting Onsite` | MBP tekan "Tiba di Site" |
| 4 | `Onsite` | OMC Approve Onsite |
| 5 | `Waiting Selesai` | MBP tekan "Selesaikan Pekerjaan" |
| 6 | `Selesai` | OMC Approve Selesai |

Baris ditulis **upsert** per `orderId`: order yang sama tidak pernah jadi baris ganda.
Baris dengan `orderId` `-` adalah placeholder unit standby dan tidak pernah di-update.

## Halaman

| Halaman | Untuk | Isi |
|---|---|---|
| `index.html` | OMC & Admin | Dashboard, WhatsApp dispatcher, log tiket, master data, kelola akun |
| `mbp.html` | Teknisi MBP (HP) | Site tujuan + status + **satu** tombol aksi |

Link WhatsApp yang dikirim OMC mengarah ke `mbp.html` (lihat `buildMagicLinkUrl()` di `js/app.js`).

## Build CSS (Tailwind)

Tailwind **dibuild sekali** lalu hasilnya (`css/app.css`) di-commit — deploy cukup `git push`.
Tailwind CDN tidak dipakai anymore.

```bash
npm install
npm run build          # build CSS + stamp versi aset (JALANKAN SETIAP KALI)
npm run build:css      # hanya build CSS
npm run watch:css      # mode watch saat develop
npm run stamp          # hanya perbarui ?v= di halaman
```

`npm run build` melakukan dua hal:
1. Build `css/app.css` dari `src/input.css`.
2. Menulis `?v=<hash isi file>` pada link aset di `index.html` & `mbp.html`
   (`tools/stamp_assets.py`). Karena versinya dari hash isi file, **otomatis berubah
   begitu file berubah** — tidak perlu lagi menaikkan nomor versi manual.
   Ini yang mencegah browser memakai CSS/JS lama dari cache setelah deploy.
   Hash dihitung dari byte file yang sudah dinormalisasi ke LF, jadi hasilnya
   sama di Windows maupun Linux.

Jalankan `npm run build` **setiap kali** kamu mengubah `index.html`, `mbp.html`,
`js/*.js`, atau menambah kelas Tailwind baru (beberapa kelas dibangun runtime
di dalam string template JS).

## Test

```bash
npm test
```

Test memakai `node:test` bawaan Node, tanpa dependency baru, dan tidak
menyentuh jaringan. Cakupannya: vektor known PBKDF2/HMAC (parity dengan
`hashlib` Python), guard auth dan scope NOP, penolakan magic link, aturan
NOP, dan merge sinkronisasi saat server lebih basi dari state lokal.

> Tanpa Google Fonts: aplikasi memakai system font stack. Nol request font,
> tidak ada FOUT, dan halaman tampil jauh lebih cepat di jaringan lambat.

Node tidak wajib ada di PATH; di PC ini ada di `C:\laragon\bin\nodejs\node-v22`:

```bash
export PATH="/c/laragon/bin/nodejs/node-v22:$PATH"
```
