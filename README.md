# Data Trust & BI Observatory

Audit kualitas data dan metrik BI yang *disesuaikan dengan hasil pemeriksaan*, atas data publik
[NYC TLC Yellow Taxi trip records](https://www.nyc.gov/site/tlc/about/tlc-trip-record-data.page).
Untuk setiap bulan, pipeline menjawab dua pertanyaan: **seberapa banyak data yang layak dipakai**, dan
**seberapa besar angka utama berubah setelah data bermasalah dikeluarkan?**

**Live demo:** https://data-trust-bi-observatory.pages.dev/ (situs statis di Cloudflare Pages, tanpa server
yang bisa tertidur) · [![CI](https://github.com/muhshandy-dev/data-trust-bi-observatory/actions/workflows/ci.yml/badge.svg)](https://github.com/muhshandy-dev/data-trust-bi-observatory/actions/workflows/ci.yml)

> **Status:** selesai untuk cakupan yang dinyatakan. Pipeline dijalankan pada enam bulan data asli Yellow
> Taxi (2024-01 s.d. 03 dan 2025-01 s.d. 03, total 20.752.804 baris). Hasil agregat disimpan di
> `web/public/data/` dan ditampilkan oleh dashboard. Lihat [Temuan](#temuan-pada-data-tlc-asli) dan
> [Evaluasi dan keterbatasan](#evaluasi-dan-keterbatasan).

**Teknologi:** Python 3.11+, DuckDB, PyArrow, pytest, ruff, GitHub Actions · HTML/CSS/ES modules statis
(tanpa framework, tanpa build step) · Cloudflare Pages.

## Cara kerja

```
Parquet TLC (CloudFront) ──ingest──▶ data/raw/ + manifest.json (ukuran, jumlah baris, SHA-256)
                                          │
                       View DuckDB `trips_flagged`: 12 aturan per baris + is_trusted
                                          │
              ┌───────────────────────────┴──────────────────────────┐
        trust_report (pelanggaran per aturan,         agregat: metrik semua data vs lolos pemeriksaan,
        baris duplikat, persentase lolos)             harian, jam per minggu, zona jemput, cara bayar
              └───────────────────────────┬──────────────────────────┘
                              web/public/data/*.json  (setiap file < 25 MiB untuk Cloudflare Pages)
```

Aturan pemeriksaan (`src/data_trust/validate.py`) punya dua tingkat. Aturan **error** (di dashboard:
"masalah kritis") mengeluarkan baris dari subset yang lolos pemeriksaan. Aturan **warning** (R10, R12; di
dashboard: "masalah ringan") dilaporkan dan dirinci per vendor dan jenis pembayaran, tetapi barisnya tetap
dipakai. Alasannya, pada data asli kedua aturan ini muncul pada sebagian besar data dari vendor atau jenis
pembayaran tertentu yang selebihnya wajar (lihat Temuan).

Daftar aturan:
- waktu jemput atau turun kosong
- waktu turun sebelum waktu jemput
- waktu jemput di luar bulan file
- durasi lebih dari 24 jam
- jarak nol atau negatif
- jarak lebih dari 100 mil
- kecepatan di atas 80 mph
- tarif negatif
- total bayar nol atau negatif
- jumlah penumpang tidak valid
- zona tidak dikenal atau placeholder (264/265)
- `total_amount` tidak cocok dengan jumlah komponen biayanya

Ambang batasnya berupa konstanta di modul tersebut. Baris duplikat persis dihitung per bulan, tetapi (belum)
dikeluarkan dari subset yang lolos. Setiap laporan memuat dua angka:
- `trusted_rate`: tidak ada aturan error yang terpicu.
- `clean_rate`: tidak ada aturan apa pun yang terpicu, termasuk warning.

Keputusan desain yang perlu diketahui:

- **Satu definisi "lolos".** Laporan kualitas dan semua agregat membaca view DuckDB yang sama.
- **Ingest idempoten dan bisa dideteksi bila berubah.** TLC tidak menerbitkan checksum, jadi manifest
  mencatat SHA-256 file yang diunduh. File lokal yang berubah memicu error, kecuali memakai `--force`.
- **Perubahan skema ditangani.** Nama kolom dicocokkan tanpa membedakan huruf besar kecil, dan kolom biaya
  hanya dipakai bila ada (`Airport_fee` → `airport_fee`, `cbd_congestion_fee` muncul di file yang lebih baru).
- **Cakupan agregat:** baris dengan waktu jemput di dalam bulan file, agar deret harian tetap terbaca.

## Temuan pada data TLC asli

Dijalankan pada file resmi dari `d37ci6vzurychx.cloudfront.net` (SHA-256 setiap file ada di
`web/public/data/meta.json`). Cakupan: Yellow Taxi, enam bulan. Ini adalah pengamatan atas isi file,
bukan klaim tentang alasan TLC atau vendor mencatat data seperti itu.

| Bulan | Baris | Lolos (tanpa aturan error) | Bersih (tanpa aturan apa pun) |
|---|---:|---:|---:|
| 2024-01 | 2.964.624 | 95,85% | 71,07% |
| 2024-02 | 3.007.526 | 95,62% | 70,17% |
| 2024-03 | 3.582.628 | 95,15% | 65,72% |
| 2025-01 | 3.475.226 | 92,89% | 63,96% |
| 2025-02 | 3.577.543 | 91,91% | 58,19% |
| 2025-03 | 4.145.257 | 92,23% | 59,35% |

- **R12 (total tidak cocok) adalah pola vendor atau cara pencatatan, bukan noise.**
  - Aturan ini terpicu pada 89 sampai 93% baris Vendor 1 setiap bulan.
  - Pada 2024-01, sebagian besar ketidakcocokan (591.045 dari 761.838) memiliki `total_amount` tepat 2,50
    lebih kecil dari jumlah kolom biaya. Artinya biaya kemacetan tercatat di kolomnya, tetapi tidak masuk
    ke total.
  - Aturan ini juga terpicu pada 80 sampai 92% baris jenis pembayaran 0 (flex fare). Pada baris ini kolom
    biayanya kosong, tetapi totalnya tampak sudah memuat biaya tersebut.
  - Vendor 2 berada di kisaran 4 sampai 21%.
- **R10 (jumlah penumpang) kosong pada 100% baris jenis pembayaran 0 (flex fare).**
  - Jumlah baris ini naik dari 140.162 (2024-01) menjadi 916.663 (2025-03). Karena itu R10 naik dari 5,8%
    menjadi 22,7% dari semua baris.
  - Di luar flex fare, kolom ini tidak valid pada sekitar 1% perjalanan kartu dan tunai.
- **Segelintir jarak yang mustahil mendominasi rata-rata mentah.**
  - 2025-03 memiliki 165 perjalanan di atas 1.000 mil (maksimum 320.136 mil). Perjalanan ini menyumbang
    13,8 juta dari 27,3 juta mil di file tersebut.
  - Rata-rata jarak mentah 6,58 mil, sedangkan setelah pemeriksaan 3,28 mil (−50%). Pada 2024-01 angkanya
    3,65 dan 3,23 mil.
- **Aturan error menolak 4,2 sampai 8,1% baris.**
  - Penyebab terbanyak adalah tarif negatif (1,3% pada 2024-01, 5,0% pada 2025-03) dan jarak nol atau
    negatif (2,0 sampai 2,8%).
  - Pendapatan setelah pemeriksaan 2,9 sampai 3,5% di bawah pendapatan mentah.
  - Rata-rata tarif naik 0,0 sampai 6,5% setelah refund, jarak nol, dan baris negatif dikeluarkan.
- **Masalah lain jarang terjadi.**
  - Waktu dan durasi yang mustahil (R01 sampai R04) totalnya di bawah 0,01% baris.
  - Baris duplikat persis: 0 di lima dari enam bulan, dan 1 pada 2024-02.

Konsekuensi desain: versi pertama memperlakukan semua aturan sebagai pengecualian. Hasilnya hanya 58 sampai
71% baris yang tersisa, dan hampir semua perjalanan Vendor 1 serta flex fare terbuang. Ini akan membuat setiap
metrik menjadi bias. Karena itu, aturan yang terpicu pada seluruh vendor atau jenis pembayaran kini menjadi
warning.

## Penggunaan

```bash
make install                      # venv + dependensi pengembangan
.venv/bin/data-trust run --months 2024-01 2024-02 2024-03   # ingest, lalu buat JSON
.venv/bin/data-trust validate --months 2024-01              # cetak laporan kualitas
make check                        # ruff + pytest dengan coverage
.venv/bin/python tools/recompute_check.py   # hitung ulang angka yang dipublikasikan dari file mentah
```

`ingest` menerima `--base-url` untuk memakai mirror host TLC. File mentah disimpan di `data/raw/`
(diabaikan git). Agregat yang dipublikasikan disimpan di `web/public/data/`.

## Frontend

`web/public` berisi HTML/CSS/ES modules biasa, tanpa framework dan tanpa build step, sehingga deploy di
Cloudflare Pages tidak memakai menit build. `index.html` berada di root output yang dipublikasikan.

Antarmuka memakai bahasa Indonesia sederhana untuk pembaca nonteknis, dengan format angka `4.145.257` dan
`92,23%` serta nama bulan seperti "Maret 2025". Aturan error ditampilkan sebagai "masalah kritis", aturan
warning sebagai "masalah ringan", dan kode aturan (R01 sampai R12) hanya label sekunder. Sebuah tes menjaga
agar nama tool, nama kolom, dan kata seperti rule/warning/error tidak muncul di teks halaman.

Isi halaman:

- sidebar yang bisa diciutkan (menjadi drawer di bawah 1024 px), berisi Ringkasan, Kualitas Data, Hasil
  Pemeriksaan, Analisis Perjalanan, Metodologi, dan Keterbatasan;
- header dengan pemilih bulan dan tombol mode terang/gelap;
- empat kartu KPI dengan tooltip penjelasan, bar komposisi data, dan temuan dalam bahasa sederhana;
- perbandingan kualitas antarbulan (kolom bertumpuk 100%, bisa diklik) dan tabel pola per pemeriksaan yang
  tersembunyi di balik toggle;
- accordion 12 pemeriksaan dengan filter Kritis/Ringan. Hanya satu item yang terbuka sekaligus, dan rincian
  per vendor dan cara bayar tersimpan di tampilan lanjutan. Setiap persentase menyebut pembaginya;
- metrik semua data vs lolos pemeriksaan, perjalanan harian, heatmap hari x jam, cara bayar, dan tabel zona
  jemput dengan pencarian dan filter wilayah;
- metodologi dan keterbatasan.

Grafik digambar ulang sesuai lebar kontainer, bisa diakses dengan keyboard, dan punya tampilan tabel. Label
tampilan ada di `web/public/js/rules.js` dan `format.js`. Browser tidak menghitung ulang angka apa pun,
selain selisih dan porsi sederhana dari angka yang sudah dipublikasikan.

Font Inter variable (SIL OFL 1.1, `assets/fonts/OFL.txt`) dan sprite ikon Lucide (ISC) di-host sendiri,
sehingga CSP di `_headers` tetap hanya `'self'`. Pratinjau lokal: `python -m http.server -d web/public`.
Jika file data tidak tersedia, halaman menampilkan pesan error dengan tombol coba lagi, bukan halaman kosong.

## Tes

`pytest` menjalankan tes unit dan end-to-end pada fixture Parquet sintetis yang sengaja berisi cacat (satu
baris per aturan), serta pada server HTTP lokal. Skenario server mencakup:
- unduhan sukses
- retry dengan backoff
- 404 tanpa retry
- file terpotong atau bukan Parquet
- checksum tidak cocok
- unduhan ulang yang idempoten

Fixture tersebut bukan data TLC. Jadi tes yang lolos menunjukkan bahwa kode bekerja sesuai klaimnya, bukan
menggambarkan isi data asli. CI (`.github/workflows/ci.yml`) menjalankan ruff dan pytest di Python 3.11 dan
3.13.

## Evaluasi dan keterbatasan

Cara hasil diperiksa, dan hal yang **tidak** ditunjukkan:

- **Tidak ada ground truth.** Tidak ada label baris yang benar atau salah, sehingga tidak ada precision atau
  recall. Hasilnya berupa jumlah pelanggaran aturan dan perubahan metrik menurut definisi "lolos" yang
  dinyatakan. Ambang batas (100 mil, 80 mph, 24 jam, 6 penumpang, toleransi 1 sen) adalah heuristik di
  `validate.py`. Mengubahnya akan mengubah angka.
- **Lolos tidak berarti benar.** Baris yang lolos semua aturan tetap bisa salah. Pendapatan adalah jumlah
  `total_amount` (termasuk tip, pajak, dan biaya tambahan), bukan penghasilan pengemudi.
- **Cakupan.**
  - Hanya Yellow Taxi selama enam bulan. Tidak ada klaim untuk green taxi, for-hire vehicle, atau tahun lain.
  - Duplikat dihitung, tetapi tidak dihapus.
  - Waktu dipakai apa adanya, tanpa penanganan zona waktu.
- **Aturan warning adalah keputusan penilaian.** R10 dan R12 tidak mengeluarkan baris karena terpicu pada
  seluruh vendor atau jenis pembayaran (lihat Temuan). Pembagian error/warning adalah pilihan desain yang
  didokumentasikan. Laporan menyediakan `trusted_rate` dan `clean_rate` yang lebih ketat, sehingga pembaca
  bisa memilih.
- **Verifikasi.**
  1. Tes di `tests/` (unit, end-to-end, kontrak JSON) berjalan di CI.
  2. `tests/test_published_data.py` memeriksa bahwa agregat yang dipublikasikan konsisten satu sama lain
     (total harian, per jam, per zona, dan per cara bayar sama dengan jumlah perjalanan bulanan yang lolos),
     di bawah batas ukuran Pages, dan disajikan dengan CSP ketat.
  3. `tools/recompute_check.py` menulis ulang aturan error dalam satu kueri SQL terpisah, lalu
     membandingkan jumlah baris, pendapatan, dan rata-rata jarak dengan JSON yang dipublikasikan. Hasilnya
     cocok untuk keenam bulan. Pemeriksa ini ditulis oleh penulis yang sama dengan pipeline, jadi ini
     pemeriksaan silang, bukan audit independen.
  4. SHA-256 setiap file sumber dipublikasikan di `meta.json`.
- **Reproduksibilitas.** Membangun ulang seluruh JSON dari enam file mentah menghasilkan file yang identik
  dengan yang dipublikasikan. Satu-satunya pengecualian: 2 dari 1.529 baris zona dengan rata-rata tarif yang
  selisih 0,0001 USD, akibat urutan penjumlahan floating-point paralel. Dashboard menampilkan dua desimal,
  jadi nilai yang terlihat tetap sama.
- **Pemeriksaan browser.** Diuji di Chromium headless dengan CSP produksi, pada lebar 320, 375, 768, 1280,
  dan 1440 px, mode terang dan gelap:
  - Tidak ada overflow horizontal, console error, atau request gagal.
  - 44 interaksi terskrip lulus, antara lain ganti bulan, filter, accordion, keyboard, drawer mobile,
    sticky header, dan tooltip sentuh.
  - Setiap KPI, jumlah kategori, dan jumlah pemeriksaan yang tampil cocok dengan JSON untuk keenam bulan.
  - axe-core (WCAG 2.1 AA dan best-practice) tidak menemukan pelanggaran.
  - Ini hanya Chromium, bukan pengujian lintas browser.

## Deployment

Cloudflare Pages menyajikan `web/public` secara langsung:

| Pengaturan | Nilai |
|---|---|
| Build command | kosong |
| Output directory | `web/public` |
| Production branch | `main` |

Situsnya statis, jadi tidak ada proses yang bisa tertidur. Satu-satunya dependensi runtime adalah edge
Cloudflare. `web/public/_headers` memasang Content-Security-Policy yang ketat (tanpa script atau style
inline, tanpa request pihak ketiga), `nosniff`, larangan framing, dan permissions policy minimal. Tidak ada
secret, token, atau API key yang dipakai.

Langkah setup ada di [docs/DEPLOY_CLOUDFLARE.md](docs/DEPLOY_CLOUDFLARE.md). Untuk memperbarui data,
jalankan pipeline secara lokal, periksa diff `web/public/data/meta.json`, lalu merge ke `main`. Pages akan
melakukan deploy ulang setelah push.

## Batasan hosting yang memengaruhi desain

- Cloudflare Pages membatasi 25 MiB per file dan 500 build per bulan yang dipakai bersama seluruh
  portofolio. Karena itu aplikasi web memakai JSON kecil yang sudah diagregasi, dan CI menghindari build
  deploy yang tidak perlu.
- Jadwal GitHub Actions dinonaktifkan setelah 60 hari tanpa aktivitas repository, jadi tidak ada bagian
  proyek ini yang bergantung pada jadwal.

## Roadmap

1. ~~Pipeline v0, tes, dan CI~~
2. ~~Menjalankan pada data TLC asli; mencatat temuan dan checksum~~
3. ~~UI web dan deployment Cloudflare Pages~~
4. Langkah berikutnya yang mungkin: lebih banyak bulan, analisis sensitivitas ambang batas, green taxi/HVFHV
5. Mengekstrak kerangka repo (CI, Makefile, pembatas ukuran) sebagai template untuk proyek lain

## Lisensi

MIT. Data TLC bersifat publik. Lihat situs TLC untuk ketentuan dan kamus datanya.
