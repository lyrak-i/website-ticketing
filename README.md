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
Tailwind CDN tidak dipakai lagi.

```bash
npm install
npm run build:css       # sekali
npm run watch:css       # mode watch saat develop
```

Jalankan ulang build **setiap kali menambah kelas Tailwind baru** di `index.html`,
`mbp.html`, atau `js/*.js` (beberapa kelas dibangun runtime di JS).

Node tidak wajib ada di PATH; di PC ini ada di `C:\laragon\bin\nodejs\node-v22`:

```bash
export PATH="/c/laragon/bin/nodejs/node-v22:$PATH"
```
