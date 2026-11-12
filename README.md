# website-ticketing
website untuk meninjau tiket mbp

## Sinkronisasi Google Sheets

Semua device membaca & menulis status tiket lewat satu Google Apps Script Web App.
Backend ada di folder `apps-script/` (**deploy manual** — tidak otomatis dari GitHub Pages).

### Deploy backend (sekali saja)

1. Buka spreadsheet MBP kamu → **Extensions → Apps Script**
2. Buat **tiga** file berisi isi repo (nama file di editor harus persis):
   - `Code.gs` ← `apps-script/Code.gs`
   - `Crypto.gs` ← `apps-script/Crypto.gs`
   - `Auth.gs` ← `apps-script/Auth.gs`
3. Pastikan tab Sheet: **`MBP_Monitoring`** (tiket) dan **`Master_Data`** (master). Backend otomatis membuat **`Auth_Users`** saat login pertama.
4. Header tiket harus mencakup kolom **`dispatchToken`** (kolom R) — urutan lengkap di `getColumns()` dalam `Code.gs`.
5. **Deploy → Manage deployments → Web app**
   - Execute as: **Me**
   - Who has access: **Anyone**
6. Salin URL `/exec` → `js/config.js` (`DEFAULT_GAS_URL`). Nilai `EXPECTED_BACKEND_VERSION` di config harus sama dengan `AUTH_BACKEND_VERSION` di `Auth.gs` (saat ini **2**).

> Setelah kode diubah: **Deploy → Manage deployments → Edit → Version: New version → Deploy**. Jika UI menampilkan **Backend perlu deploy ulang**, langkah ini belum dilakukan.

### Google Sheet: tiket + master data

**Tab `Sheet1` (tiket)** — header baris 1, urutan kolom harus sama seperti di `apps-script/Code.gs` → `getColumns()`. Baris lama tidak perlu diubah.

**Tab `Master_Data`** — baris per entitas (lihat `readMasterData()` di `Code.gs`). Isi awal bisa lewat tab **Admin** di web (login sebagai `admin`) lalu **Simpan**; hanya Admin yang boleh menulis master (sesi server).

**Tab `Auth_Users`** — dibuat otomatis. Berisi hash password per username (OMC per personil + `admin`). Admin bisa **Reset password** di UI; password baru ditampilkan sekali. Setiap kali master personil disimpan, akun OMC (`psn-01`, …) disinkronkan ke tab ini.

**Login production (Apps Script aktif):**

| Username | Peran | Catatan |
|---|---|---|
| `admin` | Admin | Password default `admin2026` sampai direset |
| `omc` | OMC demo (semua NOP) | Password default `omc2026` |
| `psn-01`, … | OMC per NOP | Username = ID personil huruf kecil; password dari tab Auth / reset Admin |

Tanpa backend (demo lokal): login masih memakai `js/demo-users.js`.

Hash manual: `python tools/hash_password.py` (format sama dengan `Crypto.gs` / `Auth.gs`).

**Magic link MBP:** token di URL dicek server (`validateMagicLink`) terhadap kolom `dispatchToken` pada baris tiket.

### Urutan status satu tiket

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
| `index.html` | OMC & Admin | Dashboard, WhatsApp dispatcher, log tiket, master data |
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
npm test               # tes format hash & status (Node built-in)
```

Repo memakai **LF** (lihat `.gitattributes`) agar diff README/config tidak hanya churn CRLF.

`npm run build` melakukan dua hal:
1. Build `css/app.css` dari `src/input.css`.
2. Menulis `?v=<hash isi file>` pada link aset di `index.html` & `mbp.html`
   (`tools/stamp_assets.py`). Karena versinya dari hash isi file, **otomatis berubah
   begitu file berubah** — tidak perlu lagi menaikkan nomor versi manual.
   Ini yang mencegah browser memakai CSS/JS lama dari cache setelah deploy.

Jalankan `npm run build` **setiap kali** kamu mengubah `index.html`, `mbp.html`,
`js/*.js`, atau menambah kelas Tailwind baru (beberapa kelas dibangun runtime
di dalam string template JS).

> Tanpa Google Fonts: aplikasi memakai system font stack. Nol request font,
> tidak ada FOUT, dan halaman tampil jauh lebih cepat di jaringan lambat.

Node tidak wajib ada di PATH; di PC ini ada di `C:\laragon\bin\nodejs\node-v22`:

```bash
export PATH="/c/laragon/bin/nodejs/node-v22:$PATH"
```
