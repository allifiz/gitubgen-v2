# GitubGen V2 — 0.10.0

Extension Chrome/Edge untuk merekonsiliasi DSM, GitHub Project 11, Recorder, dan KPI Excel. Token GitHub hanya memerlukan akses baca; tidak menggunakan webhook atau GitHub App organisasi.

## Build dan instalasi

Node.js 22 atau lebih baru:

```sh
npm ci
npm run check
```

Load folder `dist/` melalui **Load unpacked** pada `chrome://extensions` atau `edge://extensions`. Untuk memperbarui instalasi lama, ganti isi folder extension lalu klik **Reload**. Reset checkpoint lama dan scan ulang agar menggunakan rule interval yang baru.

## Pemakaian

1. Pilih DSM Markdown dan PIC. Excel referensi opsional; tanpa Excel, aplikasi membuat workbook baru.
2. Pilih parent saja atau penelusuran sampai tiga tingkat, termasuk parent → sub-issue → closing PR.
3. Masukkan token GitHub (akses repo, organisasi, project sesuai kebutuhan). Recorder URL/secret opsional. Extension mendukung Recorder HTTPS pada `*.vercel.app`. Kredensial berada di session storage selama sesi browser, tidak masuk checkpoint/workbook.
4. Scan, lalu periksa preview dan flag review. Jika GitHub gagal, bukti Recorder tetap dipakai; kegagalan masing-masing sumber ditampilkan.
5. Untuk Excel lama, default **Isi field kosong**. Pilih **Rekonsiliasi nilai lama** bila ingin mengoreksi nilai lama. Preview sebelum/sesudah muncul sebelum unduhan; pilih baris yang disetujui atau batalkan. File asli tidak ditimpa.

Kolom `Manual`, `Locked`, atau `Manual Override` bernilai YES/TRUE/1/LOCKED/MANUAL melindungi baris. Sel formula tidak ditimpa. Impor mempertahankan posisi baris dan menambahkan Target Date di ujung bila belum ada, sehingga referensi formula tidak bergeser. Workbook dengan chart, pivot, macro, embedded object, atau drawing ditolak sebelum impor karena round-trip fitur tersebut belum didukung; gunakan workbook baru dari DSM.

## DSM

Tanggal, sesi, dan PIC hanya dibaca dari header struktural. Catatan task/deadline/mention tidak mengganti konteks. Di blok Task, URL tiket harus berada pada field GitHub.

```md
**15 Oktober 2026 Pukul 16.00**
**Maulana**
## Task 1 | [PROJECT] FEAT: Example
* GitHub : https://github.com/OWNER/REPO/issues/123
* Status : Staging
```

Format sederhana header tanggal/sesi, header PIC, lalu URL juga didukung. Tanggal tidak valid ditolak. Satu baris KPI mewakili PIC + URL + tanggal; dua sesi DSM digabung.

## Aturan waktu

- Status DSM untuk pelaporan; tidak menentukan target End. In Progress membuka sesi. Ready to Review menutup sesi. Todo/No status menghentikan sesi; restart membuka sesi baru. Keluar langsung ke Staging/Deployed menjadi fallback dengan flag.
- Hour adalah **jumlah interval kerja efektif**, bukan End dikurangi Start. Review/waiting di antara sesi tidak dihitung. Siklus singkat yang terlihat pada GitHub dipertahankan dan ditandai untuk review; tidak dikirim kembali ke database Recorder.
- Start berasal dari parent In Progress atau komentar parent yang persis `/start`. `/end` adalah marker eksplisit. Komentar biasa, assignment, mention, dan review reviewer bukan completion pekerjaan.
- Commit/opened PR pada hubungan terverifikasi dapat menjadi kandidat End/Last Work At. Tanpa interval kerja yang lengkap, Hour tetap unknown (kosong), termasuk jika ada Start saja atau End saja.
- Carryover 09:00 memerlukan interval yang terbuka dari history sebelumnya, tidak cukup status DSM hari sebelumnya. Jam pulang 17:00 (Sabtu 16:00) hanya digunakan setelah waktunya lewat, untuk interval yang masih terbuka dan DSM In Progress sesi 16. Keduanya diberi label policy.
- Jam efektif: 09–17 Senin–Jumat, Sabtu 09–16, Minggu nol. Jeda 12–13; Jumat 11:30–13:30. Timestamp faktual tidak digeser oleh clipping ini.
- Assignment/handoff, baseline, sumber parsial, pekerjaan setelah RTR tanpa restart, siklus singkat, dan overlap diberi flag. Aktor pemindah status tidak diasumsikan sebagai pelaksana. Waktu overlap tidak dibagi otomatis dan pembagi KPI tidak diubah.
- Native dan Recorder dikorelasikan hanya untuk transisi/status/project yang sama dengan selisih maksimal tiga detik. Timestamp mentah tetap tersedia. Baseline bukan bukti waktu mulai dengan confidence HIGH.

## Bukti dan ketahanan

Workbook berisi KPI, Diagnostic (ID baris stabil, detik, interval, flag, sumber, rule version, project, coverage), Rekap Tiket Unik, Evidence, dan Run Metadata. Tanggal memakai Asia/Jakarta; rentang Recorder dinormalisasi UTC dengan batas akhir eksklusif.

Collector memisahkan sub-issue/closing PR/connected link dari mention biasa. Connection GitHub dipaginasi, dengan batas 40 request logis per node, 1.200 percobaan HTTP per scan, 1.500 node, dan empat worker. Batas/izin/error menghasilkan coverage parsial; hasil tidak dinyatakan lengkap. Metadata rate limit disimpan bila diberikan GitHub. Recorder dibaca dalam batch maksimal 200 URL, termasuk konteks sebelum awal periode.

Checkpoint disimpan sebelum network dan sebelum mengeluarkan batch dari antrean, termasuk in-flight work. Resume hanya untuk fingerprint input/PIC/project/range/depth/rule/source yang sama. Worker yang terhenti dapat memulihkan antrean menggunakan kredensial session; tanpa kredensial job menjadi paused. Input atau kedalaman berubah memerlukan scan baru.

## Pengujian

```sh
npm test
npm run build
```

Tes mencakup parser, interval, carryover, beberapa siklus, partial evidence, project scope, graph sampai PR, pagination/partial GraphQL, fallback Recorder independen, checkpoint, impor parsial/rekonsiliasi, round-trip formula/link/note/style/merge, Diagnostic, overlap, dan alur DOM sidepanel. Tes DOM memakai API Chrome/network stub; bukan pengujian token organisasi atau extension terpasang secara langsung.
