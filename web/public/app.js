// Data Trust & BI Observatory dashboard. Reads the JSON written by `data-trust build` from ./data/.
// Plain ES modules, no build step. All numbers shown here come straight from those files.
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
  ruleSearch: "",
  ruleSort: { key: "rate", dir: -1 },
  openRules: new Set(),
  zoneSearch: "",
  zoneBorough: "",
  zoneSort: { key: "trips_trusted", dir: -1 },
  zoneAll: false,
};

// ---------------------------------------------------------------------------------------- helpers
const byMonth = (rows) => Object.fromEntries(rows.map((r) => [r.month, r]));
const ruleTitle = (r) => RULES[r.id]?.title ?? r.name.replaceAll("_", " ");
const tipLine = (cls, label, value) => `<span class="tip-row"><i class="sw ${cls}"></i>${label}<b>${value}</b></span>`;

function classify(report) {
  const clean = report.clean_rows;
  const warnOnly = report.trusted_rows - report.clean_rows;
  const failed = report.rows - report.trusted_rows;
  return [
    { key: "clean", cls: "ok", label: "Tanpa temuan aturan", value: clean },
    { key: "warn", cls: "warn", label: "Hanya peringatan", value: warnOnly },
    { key: "failed", cls: "bad", label: "Gagal pemeriksaan kritis", value: failed },
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
    { tone: "neutral", ic: "database", label: "Total Baris Data", value: fmtInt(report.rows),
      sub: "Seluruh baris file Parquet bulan ini, sebelum pemeriksaan.",
      info: "Jumlah baris di file resmi TLC untuk bulan terpilih. Belum ada baris yang dikeluarkan." },
    { tone: "trusted", ic: "shield-check", label: "Lolos Pemeriksaan Kritis", value: fmtPct(report.trusted_rate),
      sub: `${fmtInt(report.trusted_rows)} baris tanpa pelanggaran aturan kritis.`,
      info: "Persentase baris yang tidak melanggar satu pun aturan kritis (R01 sampai R09, R11). Baris ini dipakai untuk metrik lolos kritis. Lolos tidak berarti datanya pasti benar." },
    { tone: "ok", ic: "badge-check", label: "Tanpa Temuan Aturan", value: fmtPct(report.clean_rate),
      sub: `${fmtInt(report.clean_rows)} baris tidak memicu aturan apa pun.`,
      info: "Persentase baris yang tidak memicu ke-12 aturan, termasuk aturan peringatan R10 dan R12. Indikator ini lebih ketat daripada Lolos Pemeriksaan Kritis." },
    { tone: "neutral", ic: "copy", label: "Baris Duplikat", value: fmtInt(report.duplicate_rows),
      sub: "Salinan persis baris lain. Dihitung, belum dikeluarkan.",
      info: "Baris yang seluruh kolomnya sama persis dengan baris lain di file yang sama." },
  ];
  $("kpis").replaceChildren(...kpis.map((k) =>
    h("article", { class: `kpi kpi-${k.tone}` },
      h("div", { class: "kpi-head" }, h("span", { class: "kpi-icon" }, icon(k.ic)), h("h3", { class: "kpi-label", text: k.label }), infoButton(k.info, k.label)),
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
      h("span", { class: "stack-pct", text: fmtPct(p.value / report.rows) }), h("span", { class: "stack-count", text: `${fmtInt(p.value)} baris` }))));
  $("class-bar").replaceChildren(bar, list);
}

function renderFacts(report, metrics) {
  const crit = report.rules.filter((r) => r.severity === "error").sort((a, b) => b.rate - a.rate)[0];
  const warn = report.rules.filter((r) => r.severity === "warning").sort((a, b) => b.rate - a.rate)[0];
  const vendor = report.breakdowns.find((b) => b.rule === warn.id && b.by === "vendor_id");
  const topVendor = vendor?.groups.filter((g) => g.rows / report.rows >= 0.05).sort((a, b) => b.rate - a.rate)[0];
  const raw = metrics.raw, tr = metrics.trusted;
  const facts = [
    { ic: "octagon-alert", cls: "bad", html: `Aturan kritis dengan pelanggaran terbanyak adalah <b>${crit.id} ${escapeHtml(ruleTitle(crit))}</b>, ${fmtPct(crit.rate)} baris.` },
    { ic: "circle-alert", cls: "warn", html: `Aturan peringatan terbesar adalah <b>${warn.id} ${escapeHtml(ruleTitle(warn))}</b>, ${fmtPct(warn.rate)} baris${topVendor ? `. Pada vendor ${escapeHtml(groupLabel("vendor_id", topVendor.key))}, angkanya ${fmtPct(topVendor.rate, 1)}` : ""}.` },
    { ic: "map-pin", cls: "info", html: `Rata-rata jarak mentah <b>${fmtDec(raw.avg_distance_mi)} mil</b>, setelah pemeriksaan kritis <b>${fmtDec(tr.avg_distance_mi)} mil</b> (${fmtDelta(raw.avg_distance_mi, tr.avg_distance_mi)}).` },
    { ic: "credit-card", cls: "info", html: `Pendapatan (total_amount) lolos kritis <b>${fmtUsd0(tr.revenue)}</b> dari ${fmtUsd0(raw.revenue)} mentah (${fmtDelta(raw.revenue, tr.revenue)}).` },
  ];
  $("facts").replaceChildren(...facts.map((f) => {
    const li = h("li", { class: `fact fact-${f.cls}` }, h("span", { class: "fact-icon" }, icon(f.ic, "icon icon-sm")));
    const p = h("p");
    p.innerHTML = f.html;
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
    ariaLabel: "Proporsi kategori kualitas baris per bulan",
    tipBody: (it) => `<strong>${fmtMonth(it.key)}</strong>${it.parts.map((p) => tipLine(`sw-${p.cls}`, p.label, fmtPct(p.value / it.total))).join("")}<span class="tip-foot">${fmtInt(it.total)} baris</span>`,
    onSelect: (m) => setMonth(m),
  });
  $("class-table").replaceChildren(table(
    ["Bulan", { text: "Total baris", cls: "num" }, { text: "Tanpa temuan", cls: "num" }, { text: "Hanya peringatan", cls: "num" }, { text: "Gagal kritis", cls: "num" }],
    months.map((m) => { const r = state.data.reportBy[m]; return [fmtMonth(m), fmtInt(r.rows), ...classify(r).map((p) => `${fmtPct(p.value / r.rows)} (${fmtInt(p.value)})`)]; }),
    { caption: "Kategori kualitas per bulan", scroll: true }));
}

function renderPattern() {
  const { months, reportBy } = state.data;
  const ids = reportBy[months[0]].rules.map((r) => r.id);
  const head = [h("th", { scope: "col", class: "sticky-col", text: "Aturan" }),
    ...months.map((m) => h("th", { scope: "col", class: "num" + (m === state.month ? " is-selected" : ""), text: fmtMonthShort(m) }))];
  const rows = ids.map((id) => {
    const rates = months.map((m) => reportBy[m].rules.find((r) => r.id === id));
    const max = Math.max(...rates.map((r) => r.rate), 1e-9);
    const sev = rates[0].severity;
    return h("tr", {},
      h("th", { scope: "row", class: "sticky-col" }, h("span", { class: `dot dot-${sev === "error" ? "bad" : "warn"}`, title: SEVERITY[sev].label }),
        h("span", { class: "rule-id", text: id }), h("span", { class: "rule-name", text: ruleTitle(rates[0]) })),
      ...rates.map((r, i) => {
        const td = h("td", { class: "num heat-td" + (months[i] === state.month ? " is-selected" : ""), text: fmtRate(r.rate) });
        td.style.setProperty("--v", String(r.rate ? Math.max(6, Math.round((r.rate / max) * 100)) : 0));
        td.classList.add(sev === "error" ? "heat-bad" : "heat-warn");
        return td;
      }));
  });
  $("pattern-table").replaceChildren(table(head, rows, { cls: "table-pattern", caption: "Persentase pelanggaran per aturan dan bulan", scroll: true }));
}

// ---------------------------------------------------------------------------------------- aturan
function renderRulesChart(report) {
  const rules = [...report.rules].sort((a, b) => b.rate - a.rate);
  const max = Math.max(...rules.map((r) => r.rate), 1e-9);
  const list = h("ul", { class: "hbars", "aria-label": "Persentase pelanggaran per aturan" });
  rules.forEach((r) => {
    const sev = r.severity === "error" ? "bad" : "warn";
    const fill = h("span", { class: `hbar-fill ${sev}` });
    fill.style.width = (r.violations ? Math.max((r.rate / max) * 100, 0.6) : 0) + "%";
    const li = h("li", { class: "hbar", tabindex: 0, "aria-label": `${r.id} ${ruleTitle(r)}, ${SEVERITY[r.severity].label}: ${fmtPct(r.rate, 3)}, ${fmtInt(r.violations)} baris` },
      h("span", { class: "hbar-label" }, h("span", { class: "rule-id", text: r.id }), h("span", { text: ruleTitle(r) })),
      h("span", { class: "hbar-track" }, fill),
      h("span", { class: "hbar-value", text: fmtRate(r.rate) }));
    const body = `<strong>${r.id} ${escapeHtml(ruleTitle(r))}</strong>${tipLine(`sw-${sev}`, SEVERITY[r.severity].label, fmtPct(r.rate, 3))}<span class="tip-foot">${fmtInt(r.violations)} baris melanggar</span>`;
    li.addEventListener("mousemove", (e) => showTip(body, e.clientX, e.clientY, li));
    li.addEventListener("mouseleave", () => hideTip(li));
    li.addEventListener("focus", () => { const b = li.getBoundingClientRect(); showTip(body, b.left + b.width / 2, b.top + 4, li); });
    li.addEventListener("blur", () => hideTip(li));
    list.append(li);
  });
  $("rules-chart").replaceChildren(list);
}

function breakdownBlock(report, rule) {
  const blocks = report.breakdowns.filter((b) => b.rule === rule.id);
  if (!blocks.length) {
    return h("p", { class: "muted", text: "Rincian per vendor dan jenis pembayaran dihitung khusus untuk aturan peringatan, karena pelanggarannya terkonsentrasi pada sumber tertentu." });
  }
  return h("div", { class: "breakdowns" }, blocks.map((b) =>
    h("div", { class: "breakdown" },
      h("p", { class: "breakdown-title", text: b.by === "vendor_id" ? "Per vendor" : "Per jenis pembayaran" }),
      h("ul", { class: "mini-bars" }, [...b.groups].sort((x, y) => y.rate - x.rate).map((g) => {
        const fill = h("span", { class: "mini-fill warn" });
        fill.style.width = g.rate * 100 + "%";
        return h("li", {}, h("span", { class: "mini-label", text: `${groupLabel(b.by, g.key)} (${g.key})` }),
          h("span", { class: "mini-track" }, fill),
          h("span", { class: "mini-value", text: fmtPct(g.rate, 1) }),
          h("span", { class: "mini-rows", text: `${fmtInt(g.violations)} dari ${fmtInt(g.rows)}` }));
      })))));
}

function renderRulesTable(report) {
  const q = state.ruleSearch.trim().toLowerCase();
  let rules = report.rules.filter((r) => state.ruleFilter === "all" || r.severity === state.ruleFilter);
  if (q) rules = rules.filter((r) => `${r.id} ${r.name} ${ruleTitle(r)}`.toLowerCase().includes(q));
  const { key, dir } = state.ruleSort;
  rules.sort((a, b) => (key === "id" ? a.id.localeCompare(b.id) : a[key] - b[key]) * dir);
  $("rule-count").textContent = `${rules.length} dari ${report.rules.length} aturan`;

  const sortTh = (k, text, cls) => {
    const active = state.ruleSort.key === k;
    const th = h("th", { scope: "col", class: cls, "aria-sort": active ? (state.ruleSort.dir > 0 ? "ascending" : "descending") : "none" });
    th.append(h("button", { type: "button", class: "sort-btn", onclick: () => { state.ruleSort = { key: k, dir: active ? -state.ruleSort.dir : k === "id" ? 1 : -1 }; renderRulesTable(report); } },
      text, icon(active ? (state.ruleSort.dir > 0 ? "arrow-up" : "arrow-down") : "chevrons-up-down", "icon icon-xs")));
    return th;
  };
  const head = [sortTh("id", "Aturan"), h("th", { scope: "col", text: "Tingkat" }), sortTh("violations", "Baris melanggar", "num"), sortTh("rate", "Persentase", "num col-bar"), h("th", { scope: "col", class: "col-action" }, h("span", { class: "sr-only", text: "Detail" }))];
  if (!rules.length) {
    $("rules-table").replaceChildren(emptyState("Tidak ada aturan yang cocok", "Ubah kata kunci atau filter tingkat aturan."));
    return;
  }
  const max = Math.max(...report.rules.map((r) => r.rate), 1e-9);
  const rows = [];
  rules.forEach((r) => {
    const open = state.openRules.has(r.id);
    const detailId = `rule-detail-${r.id}`;
    const sev = r.severity === "error" ? "bad" : "warn";
    const toggle = () => { open ? state.openRules.delete(r.id) : state.openRules.add(r.id); renderRulesTable(report); $(`btn-${r.id}`)?.focus(); };
    const fill = h("span", { class: `cell-bar-fill ${sev}` });
    fill.style.width = (r.violations ? Math.max((r.rate / max) * 100, 1) : 0) + "%";
    const status = r.violations === 0
      ? h("span", { class: "badge badge-ok" }, icon("circle-check", "icon icon-xs"), "Nihil")
      : h("span", { class: `badge badge-${sev}` }, icon(sev === "bad" ? "octagon-alert" : "circle-alert", "icon icon-xs"), SEVERITY[r.severity].label);
    rows.push(h("tr", { class: "row-main" + (open ? " is-open" : "") },
      h("th", { scope: "row" }, h("span", { class: "rule-id", text: r.id }), h("span", { class: "rule-title", text: ruleTitle(r) }), h("code", { class: "rule-tech", text: r.name })),
      h("td", {}, status, r.violations === 0 ? h("span", { class: "sev-note", text: SEVERITY[r.severity].label }) : null),
      h("td", { class: "num", text: fmtInt(r.violations) }),
      h("td", { class: "num col-bar" }, h("span", { class: "cell-bar" }, h("span", { class: "cell-bar-track" }, fill), h("span", { text: fmtRate(r.rate) }))),
      h("td", { class: "col-action" }, h("button", { type: "button", class: "icon-btn icon-btn-sm", id: `btn-${r.id}`, "aria-expanded": String(open), "aria-controls": detailId, "aria-label": `${open ? "Tutup" : "Buka"} detail ${r.id}`, onclick: toggle }, icon("chevron-down", "icon icon-sm chev")))));
    if (open) {
      rows.push(h("tr", { class: "row-detail", id: detailId },
        h("td", { colspan: 5 },
          h("div", { class: "detail" },
            h("div", { class: "detail-def" },
              h("p", { class: "detail-label", text: "Definisi" }), h("p", { text: RULES[r.id]?.detail ?? r.description }),
              h("p", { class: "detail-label", text: "Tingkat" }), h("p", { text: `${SEVERITY[r.severity].long}. ${SEVERITY[r.severity].hint}` }),
              h("p", { class: "detail-label", text: "Definisi asli di pipeline" }), h("p", { class: "muted", text: r.description })),
            h("div", { class: "detail-break" }, breakdownBlock(report, r))))));
    }
  });
  $("rules-table").replaceChildren(table(head, rows, { cls: "table-rules", caption: "Ringkasan aturan validasi" }));
}

// ---------------------------------------------------------------------------------------- perjalanan
function renderMetrics(m) {
  const defs = [
    ["Jumlah perjalanan", "trips", fmtInt, "Perjalanan dengan waktu jemput di dalam bulan."],
    ["Pendapatan (total_amount)", "revenue", fmtUsd0, "Termasuk tip, pajak, dan surcharge."],
    ["Rata-rata tarif", "avg_fare", fmtUsd, "Rata-rata fare_amount."],
    ["Rata-rata jarak", "avg_distance_mi", (x) => `${fmtDec(x)} mil`, "Sangat dipengaruhi pencilan jarak ekstrem."],
    ["Rata-rata durasi", "avg_duration_min", (x) => `${fmtDec(x, 1)} menit`, "Selisih waktu turun dan jemput."],
    ["Rata-rata tip (kartu kredit)", "avg_tip_rate", (x) => fmtPct(x, 1), "Tip dibagi tarif, hanya pembayaran kartu."],
  ];
  $("metrics").replaceChildren(h("div", { class: "metric-grid" }, defs.map(([label, key, f, note]) => {
    const raw = m.raw[key], tr = m.trusted[key];
    const d = raw ? (tr - raw) / raw : 0;
    return h("div", { class: "metric" },
      h("p", { class: "metric-label", text: label }),
      h("div", { class: "metric-values" },
        h("div", {}, h("span", { class: "metric-tag", text: "Mentah" }), h("span", { class: "metric-raw", text: raw == null ? "n/a" : f(raw) })),
        h("div", {}, h("span", { class: "metric-tag tag-trusted", text: "Lolos kritis" }), h("span", { class: "metric-trusted", text: tr == null ? "n/a" : f(tr) }))),
      h("p", { class: "metric-foot" },
        h("span", { class: "delta" }, icon(d > 0 ? "arrow-up" : "arrow-down", "icon icon-xs"), fmtDelta(raw, tr)),
        h("span", { class: "muted", text: note })));
  })));
}

function renderDaily(days) {
  lineChart($("daily-chart"), {
    labels: days.map((d) => d.date),
    series: [
      { name: "Mentah", cls: "raw", values: days.map((d) => d.trips_raw) },
      { name: "Lolos kritis", cls: "trusted", values: days.map((d) => d.trips_trusted), area: true },
    ],
    yMax: Math.max(...days.map((d) => d.trips_raw), 1) * 1.05,
    yFmt: fmtCompact,
    xFmt: fmtDay,
    tipTitle: fmtDayLong,
    ariaLabel: `Perjalanan harian ${fmtMonth(state.month)}, mentah dan lolos kritis. Gunakan tombol panah kiri dan kanan untuk berpindah hari.`,
    tipRow: (i) => tipLine("sw-raw", "Mentah", fmtInt(days[i].trips_raw)) + tipLine("sw-trusted", "Lolos kritis", fmtInt(days[i].trips_trusted)),
  });
  $("daily-table").replaceChildren(table(
    ["Tanggal", { text: "Mentah", cls: "num" }, { text: "Lolos kritis", cls: "num" }, { text: "Pendapatan lolos kritis", cls: "num" }],
    days.map((d) => [fmtDay(d.date), fmtInt(d.trips_raw), fmtInt(d.trips_trusted), fmtUsd0(d.revenue_trusted)]),
    { caption: "Perjalanan harian", scroll: true }));
}

function renderHeatmap(cells) {
  const at = new Map(cells.map((c) => [`${c.iso_dow}-${c.hour}`, c]));
  const get = (i, j) => at.get(`${i + 1}-${j}`);
  heatmap($("heatmap"), {
    rows: DOW_SHORT,
    cols: Array.from({ length: 24 }, (_, j) => String(j).padStart(2, "0")),
    value: (i, j) => get(i, j)?.trips_trusted ?? 0,
    ariaLabel: "Peta panas perjalanan lolos kritis menurut hari dan jam. Rincian tersedia di tabel jam tersibuk.",
    cellLabel: (i, j) => {
      const c = get(i, j);
      return `<strong>${DOW_LONG[i]}, ${hourLabel(j)}</strong>${tipLine("sw-trusted", "Perjalanan", fmtInt(c?.trips_trusted ?? 0))}${c ? tipLine("sw-raw", "Rata-rata tarif", fmtUsd(c.avg_fare)) : ""}`;
    },
  });
  const top = [...cells].sort((a, b) => b.trips_trusted - a.trips_trusted).slice(0, 8);
  $("heatmap-table").replaceChildren(table(
    ["Hari dan jam", { text: "Perjalanan", cls: "num" }, { text: "Rata-rata tarif", cls: "num" }],
    top.map((c) => [`${DOW_LONG[c.iso_dow - 1]}, ${hourLabel(c.hour)}`, fmtInt(c.trips_trusted), fmtUsd(c.avg_fare)]),
    { caption: "Delapan jam tersibuk" }));
}

function renderPayments(rows) {
  const total = rows.reduce((s, r) => s + r.trips_trusted, 0) || 1;
  const sorted = [...rows].sort((a, b) => b.trips_trusted - a.trips_trusted);
  const max = sorted[0]?.trips_trusted || 1;
  $("payments").replaceChildren(h("ul", { class: "hbars hbars-compact", "aria-label": "Perjalanan lolos kritis per jenis pembayaran" }, sorted.map((r) => {
    const fill = h("span", { class: "hbar-fill trusted" });
    fill.style.width = (r.trips_trusted / max) * 100 + "%";
    return h("li", { class: "hbar" },
      h("span", { class: "hbar-label" }, h("span", { text: groupLabel("payment_type", r.payment_type) }), h("span", { class: "rule-id", text: `kode ${r.payment_type}` })),
      h("span", { class: "hbar-track" }, fill),
      h("span", { class: "hbar-value" }, h("b", { text: fmtPct(r.trips_trusted / total, 1) }), h("span", { class: "muted", text: fmtInt(r.trips_trusted) })));
  })), h("p", { class: "card-note", text: "Hanya perjalanan lolos pemeriksaan kritis. Flex fare (kode 0) adalah tarif yang disepakati di muka." }));
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
    $("zones-table").replaceChildren(emptyState("Zona tidak ditemukan", "Coba kata kunci lain atau pilih semua borough."));
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
  const head = [sortTh("rank", "#", "num col-rank"), sortTh("zone", "Zona"), sortTh("borough", "Borough"), sortTh("trips_trusted", "Perjalanan", "num col-bar"), sortTh("avg_fare", "Rata-rata tarif", "num"), sortTh("avg_tip_rate", "Rata-rata tip", "num")];
  const body = shown.map((z) => {
    const fill = h("span", { class: "cell-bar-fill trusted" });
    fill.style.width = (z.trips_trusted / max) * 100 + "%";
    return h("tr", {},
      h("td", { class: "num col-rank muted", text: String(z.rank) }),
      h("th", { scope: "row", text: z.zone ?? `Zona ${z.zone_id}` }),
      h("td", { text: z.borough ?? "n/a" }),
      h("td", { class: "num col-bar" }, h("span", { class: "cell-bar" }, h("span", { class: "cell-bar-track" }, fill), h("span", { text: fmtInt(z.trips_trusted) }))),
      h("td", { class: "num", text: fmtUsd(z.avg_fare) }),
      h("td", { class: "num", text: z.avg_tip_rate == null ? "n/a" : fmtPct(z.avg_tip_rate, 1) }));
  });
  $("zones-table").replaceChildren(table(head, body, { cls: "table-zones", caption: "Zona penjemputan", scroll: true }));
}

function renderSources() {
  const { meta } = state.data;
  $("sources-table").replaceChildren(table(
    ["Bulan", "File", { text: "Baris", cls: "num" }, { text: "Ukuran", cls: "num" }, "SHA-256"],
    meta.months.map((m) => {
      const file = `yellow_tripdata_${m}.parquet`;
      const s = meta.sources[file];
      return [fmtMonth(m), h("td", {}, h("code", { text: file })), fmtInt(s.rows), `${fmtDec(s.bytes / 1048576, 1)} MiB`, h("td", {}, h("code", { class: "hash", title: s.sha256, text: `${s.sha256.slice(0, 12)}…` }))];
    }),
    { caption: "File sumber dan checksum", scroll: true }));
}

// ---------------------------------------------------------------------------------------- orchestration
function renderMonth() {
  const m = state.month;
  const report = state.data.reportBy[m];
  const metrics = state.data.metricsBy[m];
  document.querySelectorAll(".month-label").forEach((n) => { n.textContent = fmtMonth(m); });
  renderKpis(report);
  renderJourney(report, metrics);
  renderSpark();
  renderClassBar(report);
  renderFacts(report, metrics);
  renderClassChart();
  renderPattern();
  renderRulesChart(report);
  renderRulesTable(report);
  renderMetrics(metrics);
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

function renderJourney(report, metrics) {
  const top = [...report.rules].sort((a, b) => b.rate - a.rate)[0];
  $("j1").textContent = `${fmtPct(report.trusted_rate)} lolos kritis, ${fmtPct(report.clean_rate)} tanpa temuan`;
  $("j2").textContent = `${top.id} ${ruleTitle(top)}: ${fmtRate(top.rate)}`;
  $("j3").textContent = `Rata-rata jarak ${fmtDelta(metrics.raw.avg_distance_mi, metrics.trusted.avg_distance_mi)}, pendapatan ${fmtDelta(metrics.raw.revenue, metrics.trusted.revenue)}`;
}

function renderSpark() {
  const { months, reportBy } = state.data;
  $("spark").replaceChildren(...months.map((m) => {
    const r = reportBy[m];
    const bar = h("span", { class: "spark-fill" });
    bar.style.height = r.trusted_rate * 100 + "%";
    return h("button", { type: "button", class: "spark-col" + (m === state.month ? " is-selected" : ""), "aria-pressed": String(m === state.month), "aria-label": `${fmtMonth(m)}: ${fmtPct(r.trusted_rate)} lolos pemeriksaan kritis. Pilih bulan ini.`, onclick: () => setMonth(m) },
      h("span", { class: "spark-val", text: fmtPct(r.trusted_rate, 1) }), h("span", { class: "spark-track" }, bar), h("span", { class: "spark-label" }, h("span", { text: fmtMonthShort(m).split(" ")[0] }), h("span", { class: "spark-year", text: m.slice(0, 4) })));
  }));
}

function renderHeader() {
  const { meta, months } = state.data;
  const totalRows = Object.values(meta.sources).reduce((s, x) => s + x.rows, 0);
  $("chip-period").textContent = `Periode ${periodText(months)}`;
  $("scope-rows").textContent = fmtInt(totalRows);
  $("scope-months").textContent = String(months.length);
  $("scope-rules").textContent = String(state.data.reportBy[months[0]].rules.length);
  $("chip-status").textContent = `Hasil pipeline v${meta.pipeline_version}, ${Object.keys(meta.sources).length} file sumber dengan checksum SHA-256`;
  $("period-text").textContent = periodText(months, true);
  const select = $("month");
  select.replaceChildren(...months.map((m) => h("option", { value: m, text: fmtMonth(m) })));
  select.disabled = months.length < 2;
  select.value = state.month;
}

function showError(err) {
  const box = $("status");
  box.className = "state state-error";
  box.replaceChildren(
    h("div", { class: "empty" }, icon("triangle-alert", "icon"),
      h("p", { class: "empty-title", text: "Data dashboard gagal dimuat" }),
      h("p", { text: "File hasil pipeline tidak dapat dibaca. Periksa koneksi lalu coba lagi. Jika situs dijalankan lokal, jalankan data-trust run terlebih dahulu." }),
      h("p", { class: "muted", text: `Detail teknis: ${err.message}` }),
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
  $("zone-borough").replaceChildren(h("option", { value: "", text: "Semua borough" }), ...boroughs.map((b) => h("option", { value: b, text: b })));
  renderHeader();
  renderSources();
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
  $("rule-search").addEventListener("input", (e) => { state.ruleSearch = e.target.value; renderRulesTable(state.data.reportBy[state.month]); });
  $("rule-filter").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-value]");
    if (!b) return;
    state.ruleFilter = b.dataset.value;
    $("rule-filter").querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    renderRulesTable(state.data.reportBy[state.month]);
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
