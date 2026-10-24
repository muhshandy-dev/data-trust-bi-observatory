// Data Trust Observatory dashboard. Reads the JSON written by `data-trust build` from ./data/.
// Plain ES modules, no build step. All numbers shown here come straight from those files.
// User-facing text avoids engineering terms: "rule" is "pemeriksaan", error/warning severity is
// "masalah kritis" / "masalah ringan", a row is "perjalanan".
import { h, icon, showTip, hideTip, lineChart, stackedColumns, heatmap } from "./js/charts.js";
import {
  fmtInt, fmtPct, fmtDec, fmtUsd, fmtUsd0, fmtCompact, fmtMonth, fmtMonthShort, fmtDay, fmtDayLong,
  fmtDelta, fmtRate, DOW_SHORT, DOW_LONG, hourLabel, escapeHtml,
} from "./js/format.js";
import { RULES, SEVERITY, groupLabel } from "./js/rules.js";

const $ = (id) => document.getElementById(id);
const FILES = ["meta.json", "trust_report.json", "metrics_monthly.json", "daily.json", "hourly.json", "zones.json", "payments.json"];
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode: keep defaults */ } },
};

const state = {
  data: null,
  month: null,
  ruleFilter: "all",
  openRule: null, // only one check is open at a time, so the list stays short on phones
  zoneSearch: "",
  zoneBorough: "",
  zoneSort: { key: "trips_trusted", dir: -1 },
  zoneAll: false,
};

// ---------------------------------------------------------------------------------------- helpers
const byMonth = (rows) => Object.fromEntries(rows.map((r) => [r.month, r]));
const ruleTitle = (r) => RULES[r.id]?.title ?? r.description;
const tipLine = (cls, label, value) => `<span class="tip-row"><i class="sw ${cls}"></i>${label}<b>${value}</b></span>`;

function classify(report) {
  const clean = report.clean_rows;
  const warnOnly = report.trusted_rows - report.clean_rows;
  const failed = report.rows - report.trusted_rows;
  return [
    { key: "clean", cls: "ok", label: "Tanpa temuan", value: clean },
    { key: "warn", cls: "warn", label: "Masalah ringan saja", value: warnOnly },
    { key: "failed", cls: "bad", label: "Masalah kritis", value: failed },
  ];
}

function monthGroups(months) {
  // ["2024-01","2024-02","2024-03","2025-01"] -> [["2024-01".."2024-03"], ["2025-01"]]
  const idx = (m) => Number(m.slice(0, 4)) * 12 + Number(m.slice(5, 7));
  const groups = [];
  months.forEach((m, i) => {
    if (i && idx(m) === idx(months[i - 1]) + 1) groups.at(-1).push(m);
    else groups.push([m]);
  });
  return groups;
}

function periodText(months, long = false) {
  const f = long ? fmtMonth : fmtMonthShort;
  return monthGroups(months)
    .map((g) => (g.length === 1 ? f(g[0]) : `${f(g[0]).split(" ")[0]}–${f(g.at(-1))}`))
    .join(long ? " serta " : ", ");
}

function table(head, rows, opts = {}) {
  const t = h("table", { class: "table" + (opts.cls ? " " + opts.cls : "") });
  if (opts.caption) t.append(h("caption", { class: "sr-only", text: opts.caption }));
  t.append(h("thead", {}, h("tr", {}, head.map((c) => (c instanceof Node ? c : h("th", { scope: "col", class: c.cls, text: c.text ?? c }))))));
  const tb = h("tbody");
  rows.forEach((r) => tb.append(r instanceof Node ? r : h("tr", {}, r.map((c, i) => (c instanceof Node ? c : h(i === 0 ? "th" : "td", { scope: i === 0 ? "row" : null, class: head[i]?.cls, text: c }))))));
  t.append(tb);
  return h("div", { class: "table-wrap", tabindex: opts.scroll ? 0 : null, role: opts.scroll ? "region" : null, "aria-label": opts.scroll ? opts.caption : null }, t);
}

function infoButton(text, label) {
  const b = h("button", { type: "button", class: "info-btn", "aria-label": `Penjelasan: ${label}` }, icon("info", "icon icon-sm"));
  const show = () => { const r = b.getBoundingClientRect(); showTip(escapeHtml(text), r.left, r.bottom - 8, b); };
  b.addEventListener("mouseenter", show);
  b.addEventListener("focus", show);
  b.addEventListener("mouseleave", () => hideTip(b));
  b.addEventListener("blur", () => hideTip(b));
  b.addEventListener("click", (e) => { e.stopPropagation(); $("tip").hidden ? show() : hideTip(b); });
  return b;
}

function emptyState(title, body) {
  return h("div", { class: "empty" }, icon("search", "icon"), h("p", { class: "empty-title", text: title }), h("p", { text: body }));
}

// ---------------------------------------------------------------------------------------- ringkasan
function renderKpis(report) {
  const kpis = [
    { tone: "neutral", ic: "database", label: "Total Data", value: fmtInt(report.rows),
      sub: "Perjalanan tercatat bulan ini.",
      info: "Semua perjalanan dalam data resmi TLC bulan ini, sebelum diperiksa." },
    { tone: "trusted", ic: "shield-check", label: "Lolos Pemeriksaan", value: fmtPct(report.trusted_rate),
      sub: `${fmtInt(report.trusted_rows)} perjalanan tanpa masalah kritis.`,
      info: "Perjalanan tanpa masalah kritis. Data inilah yang dipakai untuk analisis. Lolos tidak menjamin data pasti benar." },
    { tone: "ok", ic: "badge-check", label: "Tanpa Temuan", value: fmtPct(report.clean_rate),
      sub: `${fmtInt(report.clean_rows)} perjalanan tanpa masalah apa pun.`,
      info: "Perjalanan yang lolos seluruh 12 pemeriksaan, termasuk pemeriksaan masalah ringan." },
    { tone: "neutral", ic: "copy", label: "Data Duplikat", value: fmtInt(report.duplicate_rows),
      sub: "Perjalanan yang tercatat lebih dari sekali.",
      info: "Perjalanan yang seluruh isinya sama persis dengan perjalanan lain. Dihitung, tetapi belum dihapus." },
  ];
  $("kpis").replaceChildren(...kpis.map((k) =>
    h("article", { class: `kpi kpi-${k.tone}` },
      h("div", { class: "kpi-head" }, h("span", { class: "kpi-icon" }, icon(k.ic, "icon icon-sm")), h("h3", { class: "kpi-label", text: k.label }), infoButton(k.info, k.label)),
      h("p", { class: "kpi-value", text: k.value }),
      h("p", { class: "kpi-sub", text: k.sub }))));
}

function renderClassBar(report) {
  const parts = classify(report);
  const bar = h("div", { class: "stack", role: "img", "aria-label": parts.map((p) => `${p.label} ${fmtPct(p.value / report.rows)}`).join(", ") });
  parts.forEach((p) => {
    const seg = h("span", { class: `stack-seg ${p.cls}` });
    seg.style.width = (p.value / report.rows) * 100 + "%";
    bar.append(seg);
  });
  const list = h("ul", { class: "stack-legend" }, parts.map((p) =>
    h("li", {}, h("i", { class: `sw sw-${p.cls}` }), h("span", { class: "stack-label", text: p.label }),
      h("span", { class: "stack-pct", text: fmtPct(p.value / report.rows) }), h("span", { class: "stack-count", text: `${fmtInt(p.value)} perjalanan` }))));
  $("class-bar").replaceChildren(bar, list);
}

function renderFacts(report, metrics) {
  const crit = report.rules.filter((r) => r.severity === "error").sort((a, b) => b.rate - a.rate)[0];
  const warn = report.rules.filter((r) => r.severity === "warning").sort((a, b) => b.rate - a.rate)[0];
  const vendor = report.breakdowns.find((b) => b.rule === warn.id && b.by === "vendor_id");
  const topVendor = vendor?.groups.filter((g) => g.rows / report.rows >= 0.05).sort((a, b) => b.rate - a.rate)[0];
  const raw = metrics.raw, tr = metrics.trusted;
  const facts = [
    { ic: "octagon-alert", cls: "bad", head: "Masalah kritis terbanyak",
      html: `<b>${escapeHtml(ruleTitle(crit))}</b> pada ${fmtPct(crit.rate)} perjalanan.` },
    { ic: "circle-alert", cls: "warn", head: "Masalah ringan terbanyak",
      html: `<b>${escapeHtml(ruleTitle(warn))}</b> pada ${fmtPct(warn.rate)} perjalanan${topVendor ? `. Pada penyedia ${escapeHtml(groupLabel("vendor_id", topVendor.key))}, ${fmtPct(topVendor.rate, 1)} perjalanannya terdampak` : ""}.` },
    { ic: "map-pin", cls: "info", head: "Dampak pada rata-rata jarak",
      html: `Turun dari ${fmtDec(raw.avg_distance_mi)} menjadi <b>${fmtDec(tr.avg_distance_mi)} mil</b> (${fmtDelta(raw.avg_distance_mi, tr.avg_distance_mi)}) setelah data bermasalah dikeluarkan.` },
    { ic: "credit-card", cls: "info", head: "Dampak pada pendapatan",
      html: `Dari ${fmtUsd0(raw.revenue)} menjadi <b>${fmtUsd0(tr.revenue)}</b> (${fmtDelta(raw.revenue, tr.revenue)}).` },
  ];
  // distance can rise in other datasets; keep the verb honest
  if (tr.avg_distance_mi > raw.avg_distance_mi) facts[2].html = facts[2].html.replace("Turun dari", "Naik dari");
  $("facts").replaceChildren(...facts.map((f) => {
    const li = h("li", { class: `fact fact-${f.cls}` }, h("span", { class: "fact-icon" }, icon(f.ic, "icon icon-sm")));
    const p = h("p");
    p.innerHTML = `<span class="fact-head">${f.head}</span>${f.html}`;
    li.append(p);
    return li;
  }));
}

// ---------------------------------------------------------------------------------------- kualitas
function renderClassChart() {
  const { reports, months } = state.data;
  const gaps = [];
  monthGroups(months).reduce((acc, g) => { acc += g.length; if (acc < months.length) gaps.push(acc - 1); return acc; }, 0);
  $("class-legend").replaceChildren(...classify(reports[0]).map((p) => h("li", {}, h("i", { class: `sw sw-${p.cls}` }), p.label)));
  stackedColumns($("class-chart"), {
    items: months.map((m) => {
      const r = state.data.reportBy[m];
      const parts = classify(r);
      return { key: m, label: fmtMonthShort(m), total: r.rows, parts, aria: `${fmtMonth(m)}: ${parts.map((p) => `${p.label} ${fmtPct(p.value / r.rows)}`).join(", ")}. Tekan Enter untuk memilih bulan ini.` };
    }),
    selected: state.month,
    gaps,
    ariaLabel: "Komposisi kualitas data per bulan",
    tipBody: (it) => `<strong>${fmtMonth(it.key)}</strong>${it.parts.map((p) => tipLine(`sw-${p.cls}`, p.label, fmtPct(p.value / it.total))).join("")}<span class="tip-foot">${fmtInt(it.total)} perjalanan</span>`,
    onSelect: (m) => setMonth(m),
  });
  $("class-table").replaceChildren(table(
    ["Bulan", { text: "Total", cls: "num" }, { text: "Tanpa temuan", cls: "num" }, { text: "Masalah ringan", cls: "num" }, { text: "Masalah kritis", cls: "num" }],
    months.map((m) => { const r = state.data.reportBy[m]; return [fmtMonth(m), fmtInt(r.rows), ...classify(r).map((p) => `${fmtPct(p.value / r.rows)} (${fmtInt(p.value)})`)]; }),
    { caption: "Komposisi kualitas data per bulan", scroll: true }));
}

function renderPattern() {
  const { months, reportBy } = state.data;
  const ids = reportBy[months[0]].rules.map((r) => r.id);
  const head = [h("th", { scope: "col", class: "sticky-col", text: "Pemeriksaan" }),
    ...months.map((m) => h("th", { scope: "col", class: "num" + (m === state.month ? " is-selected" : ""), text: fmtMonthShort(m) }))];
  const rows = ids.map((id) => {
    const rates = months.map((m) => reportBy[m].rules.find((r) => r.id === id));
    const max = Math.max(...rates.map((r) => r.rate), 1e-9);
    const sev = rates[0].severity;
    return h("tr", {},
      h("th", { scope: "row", class: "sticky-col" }, h("span", { class: `dot dot-${sev === "error" ? "bad" : "warn"}`, title: `Masalah ${SEVERITY[sev].label.toLowerCase()}` }),
        h("span", { class: "rule-name", text: ruleTitle(rates[0]) })),
      ...rates.map((r, i) => {
        const td = h("td", { class: "num heat-td" + (months[i] === state.month ? " is-selected" : ""), text: fmtRate(r.rate) });
        td.style.setProperty("--v", String(r.rate ? Math.max(6, Math.round((r.rate / max) * 100)) : 0));
        td.classList.add(sev === "error" ? "heat-bad" : "heat-warn");
        return td;
      }));
  });
  $("pattern-table").replaceChildren(table(head, rows, { cls: "table-pattern", caption: "Persentase temuan per pemeriksaan dan bulan", scroll: true }));
}

// ---------------------------------------------------------------------------------------- pemeriksaan
// Where a check fires most, by provider and payment method. Each share is "flagged trips of that
// group / all trips of that group", so it is labelled per group, never as a share of the month.
function breakdownBlock(report, rule) {
  const blocks = report.breakdowns.filter((b) => b.rule === rule.id);
  if (!blocks.length) return null;
  const tables = blocks.map((b) => {
    const rows = [...b.groups].sort((x, y) => y.rate - x.rate);
    return h("div", { class: "breakdown" },
      h("p", { class: "breakdown-title", text: b.by === "vendor_id" ? "Per penyedia data" : "Per cara bayar" }),
      h("table", { class: "mini-table" },
        h("thead", {}, h("tr", {}, h("th", { scope: "col", text: b.by === "vendor_id" ? "Penyedia" : "Cara bayar" }), h("th", { scope: "col", class: "num", text: "Terdampak" }))),
        h("tbody", {}, rows.map((g) => h("tr", {},
          h("th", { scope: "row", text: groupLabel(b.by, g.key) }),
          h("td", { class: "num" }, h("b", { text: fmtPct(g.rate, 1) }), h("span", { class: "muted", text: ` dari ${fmtInt(g.rows)}` })))))));
  });
  return h("details", { class: "more" },
    h("summary", {}, icon("chevron-right", "icon icon-xs more-chev"), "Rincian per penyedia dan cara bayar"),
    h("p", { class: "more-note", text: "Persentase dihitung dari jumlah perjalanan masing-masing penyedia atau cara bayar." }),
    h("div", { class: "breakdowns" }, tables));
}

// One line on where a warning check concentrates: the group (provider or payment method holding at
// least 1% of the month's trips) with the highest rate, shown only when it clearly stands out.
function hotspot(report, rule) {
  const cands = report.breakdowns.filter((b) => b.rule === rule.id).flatMap((b) =>
    b.groups.filter((g) => g.rows / report.rows >= 0.01).map((g) => ({ ...g, by: b.by })));
  const g = cands.sort((x, y) => y.rate - x.rate)[0];
  if (!g || g.rate < rule.rate * 1.5) return null;
  const who = g.by === "vendor_id" ? `perjalanan dari ${groupLabel("vendor_id", g.key)}` : `pembayaran ${groupLabel("payment_type", g.key).toLowerCase()}`;
  return `Paling sering pada ${who}: ${fmtPct(g.rate, 1)} di antaranya terdampak.`;
}

// One accordion item per check, largest share first. Name, level, trips affected and share come
// first; the explanation, the internal code and the breakdown sit inside.
function renderChecks(report) {
  const rules = report.rules.filter((r) => state.ruleFilter === "all" || r.severity === state.ruleFilter).sort((a, b) => b.rate - a.rate);
  const max = Math.max(...report.rules.map((r) => r.rate), 1e-9);
  $("checks-note").textContent = `Persentase dihitung dari ${fmtInt(report.rows)} perjalanan pada ${fmtMonth(state.month)}. Temuan berarti data perlu diperhatikan, belum tentu salah.`;
  $("checks").replaceChildren(...rules.map((r) => {
    const open = state.openRule === r.id;
    const sev = r.severity === "error" ? "bad" : "warn";
    const panelId = `check-${r.id}`;
    const fill = h("span", { class: `check-fill ${sev}` });
    fill.style.width = (r.violations ? Math.max((r.rate / max) * 100, 1.5) : 0) + "%";
    const toggle = () => {
      state.openRule = open ? null : r.id;
      renderChecks(report);
      const btn = $(`btn-${r.id}`);
      btn?.focus({ preventScroll: true });
      // keep the tapped row in view below the sticky header after the list re-renders
      if (btn && btn.getBoundingClientRect().top < document.querySelector(".topbar").offsetHeight) btn.scrollIntoView({ block: "start" });
    };
    const head = h("button", { type: "button", class: "check-head", id: `btn-${r.id}`, "aria-expanded": String(open), "aria-controls": panelId, onclick: toggle },
      h("span", { class: "check-main" },
        h("span", { class: "check-title", text: ruleTitle(r) }),
        h("span", { class: "check-meta" },
          h("span", { class: `badge badge-${sev}`, text: SEVERITY[r.severity].label }),
          h("span", { text: r.violations ? `${fmtInt(r.violations)} perjalanan` : "Tidak ditemukan" }))),
      h("span", { class: "check-value" },
        h("span", { class: "check-pct", text: fmtRate(r.rate) }),
        h("span", { class: "check-track", "aria-hidden": "true" }, fill)),
      icon("chevron-down", "icon icon-sm chev"));
    const item = h("li", { class: "check" + (open ? " is-open" : "") }, head);
    if (open) {
      const spot = r.severity === "warning" ? hotspot(report, r) : null;
      item.append(h("div", { class: "check-body", id: panelId },
        h("p", { text: RULES[r.id]?.detail ?? r.description }),
        h("p", { class: `check-impact ${sev}`, text: SEVERITY[r.severity].impact }),
        spot ? h("p", { text: spot }) : null,
        breakdownBlock(report, r),
        h("p", { class: "check-code", text: `Kode pemeriksaan ${r.id}` })));
    }
    return item;
  }));
}

function renderMetrics(m, report) {
  const defs = [
    ["Jumlah perjalanan", "trips", fmtInt, "outside"],
    ["Total pendapatan", "revenue", fmtUsd0, "Termasuk tip, pajak, dan biaya tambahan."],
    ["Rata-rata tarif", "avg_fare", fmtUsd, "Tarif dasar, belum termasuk tip."],
    ["Rata-rata jarak", "avg_distance_mi", (x) => `${fmtDec(x)} mil`, "Paling terpengaruh data jarak ekstrem."],
    ["Rata-rata durasi", "avg_duration_min", (x) => `${fmtDec(x, 1)} menit`, null],
    ["Rata-rata tip", "avg_tip_rate", (x) => fmtPct(x, 1), "Persentase dari tarif, kartu kredit saja."],
  ];
  $("metrics").replaceChildren(h("div", { class: "metric-grid" }, defs.map(([label, key, f, note0]) => {
    let note = note0;
    const raw = m.raw[key], tr = m.trusted[key];
    const d = raw ? (tr - raw) / raw : 0;
    if (note === "outside") {
      const n = report.rows - m.raw.trips;
      note = n ? `Tidak termasuk ${fmtInt(n)} perjalanan dengan waktu jemput kosong atau di luar bulan ini.` : null;
    }
    return h("div", { class: "metric" },
      h("p", { class: "metric-label", text: label }),
      h("div", { class: "metric-values" },
        h("div", {}, h("span", { class: "metric-tag", text: "Semua data" }), h("span", { class: "metric-raw", text: raw == null ? "Tidak ada" : f(raw) })),
        h("div", {}, h("span", { class: "metric-tag tag-trusted", text: "Lolos pemeriksaan" }), h("span", { class: "metric-trusted", text: tr == null ? "Tidak ada" : f(tr) }))),
      h("p", { class: "metric-foot" },
        h("span", { class: "delta", title: "Perubahan dibanding semua data" }, icon(d > 0 ? "arrow-up" : "arrow-down", "icon icon-xs"), fmtDelta(raw, tr)),
        note ? h("span", { class: "muted", text: note }) : null));
  })));
}

function renderDaily(days) {
  lineChart($("daily-chart"), {
    labels: days.map((d) => d.date),
    series: [
      { name: "Semua data", cls: "raw", values: days.map((d) => d.trips_raw) },
      { name: "Lolos pemeriksaan", cls: "trusted", values: days.map((d) => d.trips_trusted), area: true },
    ],
    yMax: Math.max(...days.map((d) => d.trips_raw), 1) * 1.05,
    yFmt: fmtCompact,
    xFmt: fmtDay,
    tipTitle: fmtDayLong,
    ariaLabel: `Perjalanan per hari, ${fmtMonth(state.month)}. Gunakan tombol panah kiri dan kanan untuk berpindah hari.`,
    tipRow: (i) => tipLine("sw-raw", "Semua data", fmtInt(days[i].trips_raw)) + tipLine("sw-trusted", "Lolos pemeriksaan", fmtInt(days[i].trips_trusted)),
  });
  $("daily-table").replaceChildren(table(
    ["Tanggal", { text: "Semua data", cls: "num" }, { text: "Lolos pemeriksaan", cls: "num" }, { text: "Pendapatan (lolos)", cls: "num" }],
    days.map((d) => [fmtDay(d.date), fmtInt(d.trips_raw), fmtInt(d.trips_trusted), fmtUsd0(d.revenue_trusted)]),
    { caption: "Perjalanan per hari", scroll: true }));
}

function renderHeatmap(cells) {
  const at = new Map(cells.map((c) => [`${c.iso_dow}-${c.hour}`, c]));
  const get = (i, j) => at.get(`${i + 1}-${j}`);
  heatmap($("heatmap"), {
    rows: DOW_SHORT,
    cols: Array.from({ length: 24 }, (_, j) => String(j).padStart(2, "0")),
    value: (i, j) => get(i, j)?.trips_trusted ?? 0,
    ariaLabel: "Jumlah perjalanan menurut hari dan jam. Rincian tersedia di tabel jam tersibuk.",
    cellLabel: (i, j) => {
      const c = get(i, j);
      return `<strong>${DOW_LONG[i]}, ${hourLabel(j)}</strong>${tipLine("sw-trusted", "Perjalanan", fmtInt(c?.trips_trusted ?? 0))}${c ? tipLine("sw-raw", "Rata-rata tarif", fmtUsd(c.avg_fare)) : ""}`;
    },
  });
  const top = [...cells].sort((a, b) => b.trips_trusted - a.trips_trusted).slice(0, 8);
  $("heatmap-table").replaceChildren(table(
    ["Hari dan jam", { text: "Perjalanan", cls: "num" }, { text: "Rata-rata tarif", cls: "num" }],
    top.map((c) => [`${DOW_LONG[c.iso_dow - 1]}, ${hourLabel(c.hour)}`, fmtInt(c.trips_trusted), fmtUsd(c.avg_fare)]),
    { caption: "Delapan jam tersibuk", scroll: true }));
}

function renderPayments(rows) {
  const total = rows.reduce((s, r) => s + r.trips_trusted, 0) || 1;
  const sorted = [...rows].sort((a, b) => b.trips_trusted - a.trips_trusted);
  const max = sorted[0]?.trips_trusted || 1;
  $("payments").replaceChildren(h("ul", { class: "hbars hbars-compact", "aria-label": "Perjalanan per cara bayar" }, sorted.map((r) => {
    const fill = h("span", { class: "hbar-fill trusted" });
    fill.style.width = (r.trips_trusted / max) * 100 + "%";
    return h("li", { class: "hbar" },
      h("span", { class: "hbar-label" }, h("span", { text: groupLabel("payment_type", r.payment_type) })),
      h("span", { class: "hbar-track" }, fill),
      h("span", { class: "hbar-value" }, h("b", { text: fmtPct(r.trips_trusted / total, 1) }), h("span", { class: "muted", text: fmtInt(r.trips_trusted) })));
  })));
}

function renderZones(all) {
  const q = state.zoneSearch.trim().toLowerCase();
  const ranked = [...all].sort((a, b) => b.trips_trusted - a.trips_trusted).map((z, i) => ({ ...z, rank: i + 1 }));
  let rows = ranked.filter((z) => (!state.zoneBorough || z.borough === state.zoneBorough) && (!q || `${z.zone ?? ""} ${z.borough ?? ""} ${z.zone_id}`.toLowerCase().includes(q)));
  const { key, dir } = state.zoneSort;
  rows.sort((a, b) => {
    const va = a[key], vb = b[key];
    if (typeof va === "string" || typeof vb === "string") return String(va ?? "").localeCompare(String(vb ?? ""), "id") * dir;
    return ((va ?? -Infinity) - (vb ?? -Infinity)) * dir;
  });
  const filtered = Boolean(q || state.zoneBorough);
  const shown = state.zoneAll || filtered ? rows : rows.slice(0, 10);
  $("zone-count").textContent = `Menampilkan ${fmtInt(shown.length)} dari ${fmtInt(rows.length)} zona`;
  const more = $("zone-more");
  more.hidden = filtered || rows.length <= 10;
  more.textContent = state.zoneAll ? "Tampilkan 10 teratas" : `Tampilkan semua ${fmtInt(rows.length)} zona`;
  if (!shown.length) {
    $("zones-table").replaceChildren(emptyState("Zona tidak ditemukan", "Coba kata kunci lain atau pilih semua wilayah."));
    return;
  }
  const max = ranked[0].trips_trusted || 1;
  const sortTh = (k, text, cls) => {
    const active = key === k;
    const th = h("th", { scope: "col", class: cls, "aria-sort": active ? (dir > 0 ? "ascending" : "descending") : "none" });
    th.append(h("button", { type: "button", class: "sort-btn", onclick: () => { state.zoneSort = { key: k, dir: active ? -dir : ["zone", "borough"].includes(k) ? 1 : -1 }; renderZones(all); } },
      text, icon(active ? (dir > 0 ? "arrow-up" : "arrow-down") : "chevrons-up-down", "icon icon-xs")));
    return th;
  };
  const head = [sortTh("rank", "#", "num col-rank"), sortTh("zone", "Zona"), sortTh("borough", "Wilayah"), sortTh("trips_trusted", "Perjalanan", "num col-bar"), sortTh("avg_fare", "Rata-rata tarif", "num"), sortTh("avg_tip_rate", "Rata-rata tip", "num")];
  const body = shown.map((z) => {
    const fill = h("span", { class: "cell-bar-fill trusted" });
    fill.style.width = (z.trips_trusted / max) * 100 + "%";
    return h("tr", {},
      h("td", { class: "num col-rank muted", text: String(z.rank) }),
      h("th", { scope: "row", text: z.zone ?? `Zona ${z.zone_id}` }),
      h("td", { text: z.borough ?? "Tidak diketahui" }),
      h("td", { class: "num col-bar" }, h("span", { class: "cell-bar" }, h("span", { class: "cell-bar-track" }, fill), h("span", { text: fmtInt(z.trips_trusted) }))),
      h("td", { class: "num", text: fmtUsd(z.avg_fare) }),
      h("td", { class: "num", text: z.avg_tip_rate == null ? "Tidak ada" : fmtPct(z.avg_tip_rate, 1) }));
  });
  $("zones-table").replaceChildren(table(head, body, { cls: "table-zones", caption: "Zona penjemputan", scroll: true }));
}

// ---------------------------------------------------------------------------------------- orchestration
function renderMonth() {
  const m = state.month;
  const report = state.data.reportBy[m];
  const metrics = state.data.metricsBy[m];
  document.querySelectorAll(".month-label").forEach((n) => { n.textContent = fmtMonth(m); });
  renderKpis(report);
  renderSpark();
  renderClassBar(report);
  renderFacts(report, metrics);
  renderClassChart();
  renderPattern();
  renderChecks(report);
  renderMetrics(metrics, report);
  renderDaily(state.data.dailyBy[m].days);
  renderHeatmap(state.data.hourlyBy[m].cells);
  renderPayments(state.data.paymentsBy[m].payments);
  renderZones(state.data.zones.filter((z) => z.month === m));
}

function setMonth(m) {
  if (m === state.month) return;
  state.month = m;
  $("month").value = m;
  hideTip();
  const content = $("content");
  content.classList.remove("is-updating");
  void content.offsetWidth;
  content.classList.add("is-updating");
  renderMonth();
}

function renderSpark() {
  const { months, reportBy } = state.data;
  $("spark").replaceChildren(...months.map((m) => {
    const r = reportBy[m];
    const bar = h("span", { class: "spark-fill" });
    bar.style.height = r.trusted_rate * 100 + "%";
    return h("button", { type: "button", class: "spark-col" + (m === state.month ? " is-selected" : ""), "aria-pressed": String(m === state.month), "aria-label": `${fmtMonth(m)}: ${fmtPct(r.trusted_rate)} lolos pemeriksaan. Pilih bulan ini.`, onclick: () => setMonth(m) },
      h("span", { class: "spark-val", text: fmtPct(r.trusted_rate, 1) }), h("span", { class: "spark-track" }, bar), h("span", { class: "spark-label" }, h("span", { text: fmtMonthShort(m).split(" ")[0] }), h("span", { class: "spark-year", text: m.slice(0, 4) })));
  }));
}

function renderHeader() {
  const { meta, months } = state.data;
  const totalRows = Object.values(meta.sources).reduce((s, x) => s + x.rows, 0);
  $("chip-period").textContent = periodText(months, true);
  $("scope-rows").textContent = fmtInt(totalRows);
  $("scope-months").textContent = String(months.length);
  $("scope-rules").textContent = String(state.data.reportBy[months[0]].rules.length);
  $("period-text").textContent = periodText(months, true);
  const select = $("month");
  select.replaceChildren(...months.map((m) => h("option", { value: m, text: fmtMonth(m) })));
  select.disabled = months.length < 2;
  select.value = state.month;
}

function showError(err) {
  console.error(err);
  const box = $("status");
  box.className = "state state-error";
  box.replaceChildren(
    h("div", { class: "empty" }, icon("triangle-alert", "icon"),
      h("p", { class: "empty-title", text: "Data belum dapat dimuat" }),
      h("p", { text: "Periksa koneksi internet, lalu coba lagi." }),
      h("button", { type: "button", class: "btn", onclick: () => { box.className = "state"; load(); } }, "Coba lagi")));
}

async function fetchJson(name) {
  const res = await fetch(`data/${name}`, { cache: "no-cache" });
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
  return res.json();
}

async function load() {
  let files;
  try {
    files = await Promise.all(FILES.map(fetchJson));
  } catch (err) {
    showError(err);
    return;
  }
  const [meta, reports, monthly, daily, hourly, zones, payments] = files;
  if (!meta.months?.length) {
    showError(new Error("meta.json tidak berisi bulan apa pun"));
    return;
  }
  const months = [...meta.months].sort();
  state.data = {
    meta, months, zones,
    reports: [...reports].sort((a, b) => a.month.localeCompare(b.month)),
    reportBy: byMonth(reports), metricsBy: byMonth(monthly), dailyBy: byMonth(daily),
    hourlyBy: byMonth(hourly), paymentsBy: byMonth(payments),
  };
  state.month = months.at(-1);
  const boroughs = [...new Set(zones.map((z) => z.borough).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  $("zone-borough").replaceChildren(h("option", { value: "", text: "Semua wilayah" }), ...boroughs.map((b) => h("option", { value: b, text: b })));
  renderHeader();
  renderMonth();
  $("status").hidden = true;
  $("content").hidden = false;
  setupScrollSpy();
  if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView();
}

// ---------------------------------------------------------------------------------------- shell
function setupTheme() {
  const root = document.documentElement;
  const btn = $("theme");
  const media = matchMedia("(prefers-color-scheme: dark)");
  const apply = (t) => {
    root.dataset.theme = t;
    btn.setAttribute("aria-pressed", String(t === "dark"));
    btn.setAttribute("aria-label", t === "dark" ? "Ganti ke tema terang" : "Ganti ke tema gelap");
    btn.title = btn.getAttribute("aria-label");
  };
  apply(store.get("theme") || (media.matches ? "dark" : "light"));
  media.addEventListener("change", (e) => { if (!store.get("theme")) apply(e.matches ? "dark" : "light"); });
  btn.addEventListener("click", () => {
    const next = root.dataset.theme === "dark" ? "light" : "dark";
    store.set("theme", next);
    apply(next);
    if (state.data) { renderClassChart(); renderDaily(state.data.dailyBy[state.month].days); }
  });
}

function setupSidebar() {
  const shell = $("shell");
  const collapse = $("collapse");
  const menu = $("menu");
  const scrim = $("scrim");
  const mobile = matchMedia("(max-width: 1023px)");
  const setCollapsed = (c) => {
    shell.classList.toggle("is-collapsed", c);
    collapse.setAttribute("aria-expanded", String(!c));
    collapse.title = c ? "Lebarkan sidebar" : "Ciutkan sidebar";
    collapse.querySelector(".nav-text").textContent = c ? "Lebarkan" : "Ciutkan";
    collapse.querySelector("use").setAttribute("href", `assets/icons.svg#i-${c ? "panel-left-open" : "panel-left-close"}`);
  };
  setCollapsed(store.get("sidebar") === "collapsed");
  collapse.addEventListener("click", () => {
    const c = !shell.classList.contains("is-collapsed");
    store.set("sidebar", c ? "collapsed" : "expanded");
    setCollapsed(c);
  });
  const sidebar = $("sidebar");
  const setOpen = (open) => {
    shell.classList.toggle("nav-open", open);
    menu.setAttribute("aria-expanded", String(open));
    scrim.hidden = !open;
    if (mobile.matches) sidebar.toggleAttribute("inert", !open);
    if (open) sidebar.querySelector(".nav-link")?.focus();
  };
  const syncMode = () => { shell.classList.remove("nav-open"); scrim.hidden = true; menu.setAttribute("aria-expanded", "false"); sidebar.toggleAttribute("inert", mobile.matches); };
  syncMode();
  mobile.addEventListener("change", syncMode);
  menu.addEventListener("click", () => setOpen(true));
  $("sidebar-close").addEventListener("click", () => { setOpen(false); menu.focus(); });
  scrim.addEventListener("click", () => setOpen(false));
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    hideTip();
    if (shell.classList.contains("nav-open")) { setOpen(false); menu.focus(); }
  });
  sidebar.querySelectorAll("a.nav-link[data-section]").forEach((a) => a.addEventListener("click", () => { if (mobile.matches) setOpen(false); }));
}

function setupScrollSpy() {
  const links = [...document.querySelectorAll("a.nav-link[data-section]")];
  const sections = links.map((a) => document.getElementById(a.dataset.section));
  let current = null, queued = false;
  const update = () => {
    queued = false;
    // Active section: the last one whose top has passed a line just below the sticky top bar.
    const line = 140;
    let active = sections[0];
    for (const s of sections) if (s.getBoundingClientRect().top <= line) active = s;
    if (innerHeight + scrollY >= document.documentElement.scrollHeight - 4) active = sections.at(-1);
    if (active === current) return;
    current = active;
    links.forEach((a) => (a.dataset.section === active.id ? a.setAttribute("aria-current", "true") : a.removeAttribute("aria-current")));
    $("crumb").textContent = links.find((a) => a.dataset.section === active.id).textContent.trim();
  };
  window.addEventListener("scroll", () => { if (!queued) { queued = true; requestAnimationFrame(update); } }, { passive: true });
  update();
}

function setupControls() {
  $("month").addEventListener("change", (e) => setMonth(e.target.value));
  $("rule-filter").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-value]");
    if (!b) return;
    state.ruleFilter = b.dataset.value;
    $("rule-filter").querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    renderChecks(state.data.reportBy[state.month]);
  });
  const zones = () => state.data.zones.filter((z) => z.month === state.month);
  $("zone-search").addEventListener("input", (e) => { state.zoneSearch = e.target.value; renderZones(zones()); });
  $("zone-borough").addEventListener("change", (e) => { state.zoneBorough = e.target.value; renderZones(zones()); });
  $("zone-more").addEventListener("click", () => { state.zoneAll = !state.zoneAll; renderZones(zones()); });
  document.addEventListener("click", (e) => { if (!e.target.closest(".info-btn, .chart, .hbar")) hideTip(); });
  document.addEventListener("touchstart", (e) => { if (!e.target.closest(".chart, .info-btn, .hbar")) hideTip(); }, { passive: true });
  window.addEventListener("scroll", () => { if (!document.activeElement?.closest?.(".info-btn, .hbar, .line-chart, .col")) hideTip(); }, { passive: true });
  // Charts are drawn at container width; redraw when it changes.
  let width = 0, timer;
  new ResizeObserver(([entry]) => {
    const w = Math.round(entry.contentRect.width);
    if (!state.data || w === width) return;
    width = w;
    clearTimeout(timer);
    timer = setTimeout(() => { renderClassChart(); renderDaily(state.data.dailyBy[state.month].days); }, 120);
  }).observe($("main"));
}

setupTheme();
setupSidebar();
setupControls();
load();
