# Deploy ke Cloudflare Pages

Situs ini statis: `web/public` disajikan apa adanya, tanpa build step. File data di `web/public/data/` sudah
di-commit, jadi deploy tidak pernah membutuhkan file mentah TLC.

Atur sekali di dashboard Cloudflare (Workers & Pages → Create → Pages → Connect to Git):

| Pengaturan | Nilai |
|---|---|
| Repository | `muhshandy-dev/data-trust-bi-observatory` |
| Production branch | `main` |
| Framework preset | None |
| Build command | *(kosongkan)* |
| Build output directory | `web/public` |

Output directory harus `web/public`, karena di sanalah `index.html` berada. Jika diisi folder lain, situs
akan mengembalikan HTTP 404.

Lalu, di Settings → Builds, **matikan** preview build untuk branch selain production bila ingin menghemat
kuota. Pages memberi 500 build per bulan per akun, dipakai bersama oleh semua situs di akun tersebut.

`web/public/_headers` dibaca otomatis dan memasang header keamanan: CSP ketat, nosniff, dan larangan
framing.

Batas yang perlu dipatuhi: 25 MiB per file dan 20.000 file per deployment. `data-trust build` sudah menolak
menulis file JSON di atas 25 MiB. File terbesar saat ini adalah `zones.json`, sekitar 210 KB.

Untuk memperbarui data:
1. Jalankan `data-trust run --months ...`.
2. Periksa `git diff web/public/data/meta.json`.
3. Commit, lalu merge ke `main`. Pages akan deploy ulang dari push tersebut.
