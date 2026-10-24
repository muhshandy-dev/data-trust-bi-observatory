// Indonesian number, date and label formatting. All user-facing numbers go through here.
const LOCALE = "id-ID";

const intFmt = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 0 });
const pctFmts = new Map();
const decFmts = new Map();
const usdFmt = new Intl.NumberFormat(LOCALE, { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const usd0Fmt = new Intl.NumberFormat(LOCALE, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const monthLong = new Intl.DateTimeFormat(LOCALE, { month: "long", year: "numeric", timeZone: "UTC" });
const monthShort = new Intl.DateTimeFormat(LOCALE, { month: "short", year: "numeric", timeZone: "UTC" });
const dayFmt = new Intl.DateTimeFormat(LOCALE, { day: "numeric", month: "short", timeZone: "UTC" });
const dayLongFmt = new Intl.DateTimeFormat(LOCALE, { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

export const fmtInt = (x) => intFmt.format(x);

export function fmtPct(x, digits = 2) {
  if (!pctFmts.has(digits)) {
    pctFmts.set(digits, new Intl.NumberFormat(LOCALE, { style: "percent", minimumFractionDigits: digits, maximumFractionDigits: digits }));
  }
  return pctFmts.get(digits).format(x);
}

export function fmtDec(x, digits = 2) {
  if (!decFmts.has(digits)) {
    decFmts.set(digits, new Intl.NumberFormat(LOCALE, { minimumFractionDigits: digits, maximumFractionDigits: digits }));
  }
  return decFmts.get(digits).format(x);
}

export const fmtUsd = (x) => usdFmt.format(x);
export const fmtUsd0 = (x) => usd0Fmt.format(x);

// Compact axis labels: 1.200.000 -> "1,2 jt", 85.000 -> "85 rb".
export function fmtCompact(x) {
  const a = Math.abs(x);
  if (a >= 1e6) return fmtDec(x / 1e6, a >= 1e7 ? 0 : 1) + " jt";
  if (a >= 1e3) return fmtDec(x / 1e3, 0) + " rb";
  return fmtInt(x);
}

const toDate = (month) => new Date(`${month}-01T00:00:00Z`);
export const fmtMonth = (month) => monthLong.format(toDate(month)).replace(/^./, (c) => c.toUpperCase());
export const fmtMonthShort = (month) => monthShort.format(toDate(month));
export const fmtDay = (iso) => dayFmt.format(new Date(`${iso}T00:00:00Z`));
export const fmtDayLong = (iso) => dayLongFmt.format(new Date(`${iso}T00:00:00Z`));

// Signed relative change, e.g. "+6,12%" or "−50,16%" (true minus sign for readability).
export function fmtDelta(raw, after) {
  if (!raw) return "n/a";
  const d = (after - raw) / raw;
  const s = fmtPct(Math.abs(d), 2);
  return d > 0 ? "+" + s : d < 0 ? "−" + s : s;
}

export const DOW_SHORT = ["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"];
export const DOW_LONG = ["Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu", "Minggu"];
export const hourLabel = (h) => String(h).padStart(2, "0") + ".00";

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

// Violation rates span 0 to 35%; keep tiny non-zero rates visible instead of rounding to 0,000%.
export function fmtRate(x) {
  if (!x) return fmtPct(0, 0);
  if (x < 0.00001) return "<" + fmtPct(0.00001, 3);
  return fmtPct(x, x < 0.001 ? 3 : 2);
}
