# GitubGen V2

Extension Chromium (Chrome dan Microsoft Edge) untuk merekonsiliasi file DSM, activity GitHub, parent/sub-issue, dan KPI Excel.

## Fokus versi 0.1

- Berjalan memakai sesi GitHub yang sudah login di browser; tidak memerlukan webhook atau GitHub App organisasi.
- Membaca tiket berulang dari DSM per assignee, tanggal, dan sesi.
- Memindai timeline issue/PR melalui tab background.
- Menyimpan checkpoint scan di `chrome.storage.local`.
- Prioritas waktu: `In Progress` → `Ready to Review` pada parent dan tanggal DSM yang sama.
- Parent/link/sub-issue baru diperiksa jika status pair tidak lengkap.
- Fallback Start September: DSM 11:00 → 09:00; DSM 15:00/16:00 → 13:00.
- End Time harus berasal dari activity GitHub; jika tidak ada, row ditandai `Needs Review`.
- Hanya mengisi row KPI yang Start dan End-nya sama-sama kosong.
- Membuat ulang sheet `Diagnostic` dengan sumber keputusan per row.

## Build

Persyaratan: Node.js 20+.

```bash
npm install
npm run check
```

Hasil extension berada di folder `dist/`.

## Instalasi Chrome

1. Buka `chrome://extensions`.
2. Aktifkan **Developer mode**.
3. Klik **Load unpacked**.
4. Pilih folder `dist/`.
5. Login GitHub menggunakan akun yang dapat membuka issue organisasi.
6. Klik ikon GitubGen V2 untuk membuka side panel.

## Instalasi Microsoft Edge

1. Buka `edge://extensions`.
2. Aktifkan **Developer mode**.
3. Klik **Load unpacked**.
4. Pilih folder `dist/`.
5. Login GitHub, kemudian buka side panel melalui ikon extension.

## Cara pakai

1. Pilih file DSM `.md` atau `.txt`.
2. Pilih file KPI `.xlsx`.
3. Pilih assignee: Hizkia, Maulana, Dwiki, atau Allief.
4. Pilih kedalaman scan.
5. Klik **Mulai scan GitHub**.
6. Jangan logout dari GitHub selama scan berlangsung.
7. Setelah selesai, periksa ringkasan lalu klik **Download Excel**.

Extension akan membuka issue di tab tidak aktif dan menutupnya setelah timeline selesai dibaca. Jika browser ditutup di tengah jalan, checkpoint tetap tersimpan dan dapat digunakan untuk melanjutkan scan.

## Kontrak data DSM

Parser membutuhkan tiga konteks sebelum URL tiket:

- tanggal, misalnya `8 September 2026` atau `08/09/2026`;
- sesi `DSM 11:00`, `15:00`, atau `16:00`;
- nama assignee.

Contoh:

```md
## 8 September 2026 — DSM 11:00
### Hizkia
- https://github.com/GO-Bimbel/nama-repo/issues/123
```

## Aturan keputusan

| Urutan | Start | End | Confidence |
|---|---|---|---|
| 1 | Parent `In Progress` | Parent `Ready to Review` | High |
| 2 | Parent `In Progress` | Activity akhir parent/link | Medium |
| 3 | Fallback sesi DSM | Activity akhir parent/link | Low |
| 4 | Tidak ditemukan | Tidak ditemukan | Needs Review |

Keputusan dan URL sumber ditulis pada sheet `Diagnostic`.

## Batasan versi awal

- GitHub sering mengubah struktur HTML timeline; selector content script mungkin perlu disesuaikan.
- SheetJS Community Edition mempertahankan sebagian besar workbook, tetapi fitur Excel khusus seperti macro tidak didukung.
- Timeline yang tidak dirender oleh GitHub tidak dapat dibaca tanpa API token.
- Link terkait dipindai satu tingkat secara default agar scan tidak melebar ke seluruh repository.

## Pengembangan

```bash
npm test
npm run build
```

Source utama:

- `src/background.js` — antrean tab, checkpoint, dan retry.
- `src/content.js` — ekstraksi timeline dari halaman GitHub.
- `src/lib/dsm-parser.js` — parser DSM.
- `src/lib/activity-matcher.js` — rule Start/End.
- `src/sidepanel.js` — UI, rekonsiliasi workbook, dan export.
