# website-ticketing
website untuk meninjau tiket mbp

## Sinkronisasi Google Sheets

Semua device membaca & menulis status tiket lewat satu Google Apps Script Web App.
Backend ada di `apps-script/Code.gs` (deploy manual — tidak ikut ter-push).

### Deploy backend (sekali saja)

1. Buka <https://script.google.com> → **New project**
2. Tempel isi `apps-script/Code.gs`
3. Cek `getSpreadsheetId()` = `1TihE0UILTdwP0bUXTu7K6ukbsGGhYFBFAfopYVzBl8Q`, `getSheetName()` = `Sheet1`
4. **Deploy → New deployment → Web app**
   - Execute as: **Me**
   - Who has access: **Anyone**
5. Salin URL `/exec` → tempel ke `js/config.js` (`DEFAULT_GAS_URL`)

> Kalau Sheet kamu punya tab selain `Sheet1`, ubah `getSheetName()`.
> Setelah kode diubah: **Deploy → Manage deployments → Edit → Version: New version → Deploy**.

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
```

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
