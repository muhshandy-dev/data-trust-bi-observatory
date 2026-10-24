// Indonesian text for the 12 trust rules in src/data_trust/validate.py. Thresholds here must match
// the constants there (MAX_TRIP_MILES=100, MAX_SPEED_MPH=80, MAX_DURATION_MIN=1440, MAX_PASSENGERS=6,
// AMOUNT_TOLERANCE=0.011, zone IDs 1-263). The rule id and technical name come from the data.
export const RULES = {
  R01: { title: "Waktu perjalanan kosong", detail: "Waktu jemput (tpep_pickup_datetime) atau waktu turun (tpep_dropoff_datetime) tidak terisi." },
  R02: { title: "Waktu turun sebelum waktu jemput", detail: "Waktu turun tercatat lebih awal daripada waktu jemput, sehingga durasi bernilai negatif." },
  R03: { title: "Waktu jemput di luar bulan file", detail: "Waktu jemput tidak berada dalam bulan yang ditunjukkan nama file. Baris ini juga dikeluarkan dari agregat harian." },
  R04: { title: "Durasi lebih dari 24 jam", detail: "Selisih waktu turun dan waktu jemput melebihi 1.440 menit." },
  R05: { title: "Jarak nol atau negatif", detail: "trip_distance bernilai 0 atau kurang. Termasuk perjalanan batal dan pencatatan jarak yang gagal." },
  R06: { title: "Jarak lebih dari 100 mil", detail: "trip_distance melebihi 100 mil. Pada data asli ditemukan nilai hingga ratusan ribu mil." },
  R07: { title: "Kecepatan tidak wajar", detail: "Kecepatan rata-rata di atas 80 mph untuk perjalanan berdurasi minimal 1 menit." },
  R08: { title: "Tarif negatif", detail: "fare_amount bernilai negatif, umumnya koreksi atau pengembalian dana." },
  R09: { title: "Total pembayaran nol atau negatif", detail: "total_amount bernilai 0 atau kurang." },
  R10: { title: "Jumlah penumpang tidak valid", detail: "passenger_count kosong atau di luar rentang 1 sampai 6. Pada data asli, kolom ini selalu kosong untuk perjalanan flex fare." },
  R11: { title: "Zona tidak dikenal", detail: "Zona jemput atau turun kosong, atau berupa kode placeholder 264 (Unknown) dan 265 (Outside of NYC)." },
  R12: { title: "Total tidak cocok dengan komponen biaya", detail: "total_amount berbeda lebih dari 1 sen dari penjumlahan komponen biaya yang tersedia di file (tarif, extra, pajak, tip, tol, surcharge, biaya bandara, biaya CBD)." },
};

export const SEVERITY = {
  error: { label: "Kritis", long: "Aturan kritis", hint: "Baris yang melanggar dikeluarkan dari subset Lolos Pemeriksaan Kritis." },
  warning: { label: "Peringatan", long: "Aturan peringatan", hint: "Pelanggaran dilaporkan, tetapi baris tetap dihitung sebagai lolos pemeriksaan kritis." },
};

// TLC Yellow Taxi data dictionary codes.
export const VENDORS = { 1: "Creative Mobile Technologies", 2: "Curb Mobility", 6: "Myle Technologies", 7: "Helix" };
export const PAYMENTS = { 0: "Flex fare", 1: "Kartu kredit", 2: "Tunai", 3: "Tanpa biaya", 4: "Sengketa", 5: "Tidak diketahui", 6: "Dibatalkan" };
export const groupLabel = (by, key) => (by === "vendor_id" ? VENDORS : PAYMENTS)[key] ?? `Kode ${key}`;
