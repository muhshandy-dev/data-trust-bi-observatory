// Plain-language Indonesian text for the 12 checks in src/data_trust/validate.py. Thresholds here must
// match the constants there (MAX_TRIP_MILES=100, MAX_SPEED_MPH=80, MAX_DURATION_MIN=1440,
// MAX_PASSENGERS=6, AMOUNT_TOLERANCE=0.011, zone IDs 1-263). Shown to users, so no column names.
export const RULES = {
  R01: { title: "Waktu perjalanan tidak tercatat", detail: "Waktu jemput atau waktu turun kosong." },
  R02: { title: "Waktu turun lebih awal dari jemput", detail: "Waktu turun tercatat sebelum waktu jemput, sehingga durasinya negatif." },
  R03: { title: "Waktu jemput di luar bulan data", detail: "Waktu jemput tidak berada di bulan yang dilaporkan." },
  R04: { title: "Durasi lebih dari 24 jam", detail: "Perjalanan tercatat berlangsung lebih dari satu hari." },
  R05: { title: "Jarak nol atau negatif", detail: "Jarak tercatat 0 atau kurang, misalnya karena perjalanan batal atau jarak gagal tercatat." },
  R06: { title: "Jarak lebih dari 100 mil", detail: "Jarak di atas 100 mil (sekitar 160 km), jauh di luar perjalanan taksi biasa." },
  R07: { title: "Kecepatan tidak wajar", detail: "Kecepatan rata-rata di atas 80 mph (sekitar 129 km/jam) untuk perjalanan minimal 1 menit." },
  R08: { title: "Tarif negatif", detail: "Tarif bernilai negatif, biasanya karena koreksi atau pengembalian dana." },
  R09: { title: "Total bayar nol atau negatif", detail: "Jumlah yang dibayar penumpang 0 atau kurang." },
  R10: { title: "Jumlah penumpang tidak valid", detail: "Jumlah penumpang kosong atau di luar 1 sampai 6. Selalu kosong untuk perjalanan dengan tarif di muka." },
  R11: { title: "Lokasi tidak dikenal", detail: "Lokasi jemput atau turun kosong, tidak dikenal, atau di luar New York City." },
  R12: { title: "Total tidak cocok dengan rincian biaya", detail: "Total bayar berbeda lebih dari 1 sen dari jumlah rinciannya (tarif, tip, pajak, tol, dan biaya tambahan)." },
};

export const SEVERITY = {
  error: { label: "Kritis", impact: "Perjalanan ini dikeluarkan dari analisis." },
  warning: { label: "Ringan", impact: "Perjalanan ini tetap dipakai dalam analisis, tetapi temuannya dicatat." },
};

// TLC Yellow Taxi data dictionary codes.
export const VENDORS = { 1: "Creative Mobile Technologies", 2: "Curb Mobility", 6: "Myle Technologies", 7: "Helix" };
export const PAYMENTS = { 0: "Tarif di muka", 1: "Kartu kredit", 2: "Tunai", 3: "Tanpa biaya", 4: "Sengketa", 5: "Tidak diketahui", 6: "Dibatalkan" };
export const groupLabel = (by, key) => (by === "vendor_id" ? VENDORS : PAYMENTS)[key] ?? `Lainnya (${key})`;
