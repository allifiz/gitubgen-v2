# GitubGen V2

Extension Chromium (Chrome dan Microsoft Edge) untuk merekonsiliasi file DSM, activity GitHub, parent/sub-issue, dan KPI Excel.

## Fokus versi 0.7

- Seluruh status dan aktivitas issue/PR dibaca dari GitHub GraphQL menggunakan token read-only; tidak memerlukan scraping, webhook, atau GitHub App organisasi.
- Membaca tiket berulang dari DSM per assignee, tanggal, dan sesi.
- Bisa membuat workbook KPI dari nol hanya dengan upload DSM; file KPI lama bersifat opsional.
- Dua sesi tiket yang sama pada tanggal yang sama digabung menjadi satu row KPI berdasarkan `Assignee + Ticket URL + Date`.
- Status dan judul diambil dari kemunculan DSM terakhir pada hari tersebut.
- Mengambil status, sub-issue, linked PR, comment, review, commit, merge/close, dan Target Date melalui GraphQL.
- Menyimpan checkpoint scan di `chrome.storage.local`.
- Start mengutamakan transisi `In Progress` pada parent issue di tanggal DSM yang sama. Jika event tersebut hilang, komentar parent yang mengandung kata `start` menjadi fallback.
- End mengutamakan status DSM; jika tidak tercatat, gunakan aktivitas kerja GitHub yang valid pada parent, sub-issue, atau PR.
- Parent/link/sub-issue diperiksa berdasarkan status DSM per tanggal, bukan hanya pasangan `In Progress` → `Ready to Review`.
- Jam sesi DSM tidak lagi digunakan sebagai fallback Start.
- End Time harus berasal dari activity GitHub; jika tidak ada, row ditandai `Needs Review`.
- Hanya mengisi row KPI yang Start dan End-nya sama-sama kosong.
- Membuat ulang sheet `Diagnostic` dengan sumber keputusan per row.
- Menambahkan `Target Date` dari field GitHub Project pada setiap row KPI.
- Tiket yang masih `In Progress` pada DSM 16:00 ditutup sementara pada jam pulang kerja; jika dilanjutkan esok hari, start berikutnya menjadi 09:00.
- Sheet KPI dan Rekap Tiket Unik diurutkan dari tanggal paling awal.

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
5. Klik ikon GitubGen V2 untuk membuka side panel.

## Instalasi Microsoft Edge

1. Buka `edge://extensions`.
2. Aktifkan **Developer mode**.
3. Klik **Load unpacked**.
4. Pilih folder `dist/`.
5. Buka side panel melalui ikon extension.

## Cara pakai

1. Pilih file DSM `.md` atau `.txt`.
2. File KPI `.xlsx` bersifat opsional. Kosongkan untuk membuat KPI baru dari DSM.
3. Pilih assignee: Hizkia, Maulana, Dwiki, atau Allief.
4. Pilih kedalaman scan.
5. Masukkan token GitHub read-only dengan scope `repo`, `read:org`, dan `read:project`. Token hanya berada selama proses scan dan tidak ditulis ke workbook/checkpoint.
6. Klik **Mulai scan GitHub**.
7. Setelah selesai, periksa ringkasan lalu klik **Download Excel**.

Workbook baru menggunakan urutan kolom tetap:

```text
Assignee | Type | Ticket Title | Ticket URL | Type | Status | Priority | Date | Target Date | Week | Start Time | End Time | Hour
```

Workbook berisi sheet `KPI` dengan header, border, zebra rows, filter, lebar kolom, dan format Hour; serta sheet `Diagnostic` untuk sumber keputusan waktu.

Extension tidak membuka tab GitHub selama scan. Checkpoint tetap tersimpan dan dapat digunakan untuk melanjutkan scan.

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
| 1 | Parent `In Progress` | Status parent yang sama dengan status DSM | High |
| 2 | Komentar `start` pada parent | Komentar `end` pada parent/sub-issue/PR | Medium |
| 3 | Parent `In Progress` atau komentar `start` | PR/review/commit valid pada parent/sub-issue | Medium |
| 4 | Tidak ditemukan | Tidak ditemukan | Needs Review |

Keputusan dan URL sumber ditulis pada sheet `Diagnostic`.

- Event mention, assign, add-to-project, dan add-parent tidak dianggap sebagai bukti selesai.
- Komentar hanya menjadi penanda waktu jika seluruh isinya persis `start` atau `end` setelah spasi tepi dibuang (case-insensitive). Kalimat seperti `hal ini akan di start` bukan marker.
- PR linked/opened, review, commit, merge, dan issue closed adalah end valid. Durasi sangat pendek tetap dipertahankan jika timestamp GitHub memang demikian.
- Untuk DSM berstatus `In Progress`, transisi tersebut adalah start. Jika ada aktivitas kerja sesudahnya pada hari yang sama, aktivitas terakhir menjadi titik observasi end.
- Khusus tiket yang masih `In Progress` pada DSM 16:00, End Time adalah jam pulang: 17:00 pada Senin–Jumat atau 16:00 pada Sabtu. Minggu tidak dibuatkan jam pulang otomatis.
- Jika tiket masih `In Progress` pada sesi terakhir dan muncul lagi pada hari kerja berikutnya, Start Time hari lanjutan dibuat 09:00. Hari kerja adalah Senin–Sabtu, sehingga kelanjutan dari Sabtu diteruskan pada Senin.
- Jika transisi `In Progress` dan komentar `start` sama-sama tidak ditemukan, Start dikosongkan dan row ditandai `Needs Review`.
- End Time tidak pernah dibuat dari waktu DSM.
- Durasi memakai jam kerja efektif 09:00–17:00 (Sabtu sampai 16:00), dipotong istirahat 12:00–13:00 atau Jumat 11:30–13:30.
- Export baru berisi sheet `KPI`, `Diagnostic`, dan `Rekap Tiket Unik`. Pada rekap unik, `Date` diambil dari Start Time pertama yang benar-benar diputuskan untuk KPI, sedangkan `End Date` adalah tanggal issue ditutup/deployed.
- `Status` pada Rekap Tiket Unik diambil dari perubahan status GitHub terakhir pada parent issue; status DSM terakhir hanya dipakai sebagai fallback.

## Batasan versi awal

- GraphQL membatasi setiap kelompok timeline/comment/commit/review pada 100 event per issue atau PR.
- SheetJS Community Edition mempertahankan sebagian besar workbook, tetapi fitur Excel khusus seperti macro tidak didukung.
- Jika GitHub tidak membuat event status (misalnya akibat bug GitHub Projects), GraphQL akan mengembalikan riwayat kosong dan aturan fallback tetap berlaku.
- Link terkait dipindai satu tingkat secara default agar scan tidak melebar ke seluruh repository.

## Pengembangan

```bash
npm test
npm run build
```

Source utama:

- `src/background.js` — antrean GraphQL dan checkpoint.
- `src/lib/github-graphql.js` — query dan normalisasi seluruh activity GitHub.
- `src/lib/dsm-parser.js` — parser DSM.
- `src/lib/activity-matcher.js` — rule Start/End.
- `src/sidepanel.js` — UI, rekonsiliasi workbook, dan export.
