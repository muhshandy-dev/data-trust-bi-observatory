// Static dashboard: reads the JSON written by `data-trust build` from ./data/. No build step.
const $ = (id) => document.getElementById(id);
const NS = "http://www.w3.org/2000/svg";
const fmtInt = new Intl.NumberFormat("en-US");
const fmtPct = (x, d = 2) => (x * 100).toFixed(d) + "%";
const fmtUsd = (x) => "$" + x.toFixed(2);

// Labels from the TLC Yellow Taxi data dictionary; unknown codes fall back to "code N".
const VENDORS = { 1: "Creative Mobile Technologies", 2: "Curb Mobility", 6: "Myle Technologies", 7: "Helix" };
const PAYMENTS = { 0: "Flex fare", 1: "Credit card", 2: "Cash", 3: "No charge", 4: "Dispute", 5: "Unknown", 6: "Voided" };
const label = (by, key) => ((by === "vendor_id" ? VENDORS : PAYMENTS)[key] ?? "code " + key) + ` (${key})`;
const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

async function load(name) {
  const res = await fetch(`data/${name}`, { cache: "no-cache" });
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
  return res.json();
}

function el(tag, attrs = {}, parent) {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (parent) parent.appendChild(node);
  return node;
}

function html(tag, cls, parent, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  if (parent) parent.appendChild(node);
  return node;
}

function showTip(content, x, y) {
  const tip = $("tip");
  tip.innerHTML = content;
  tip.hidden = false;
  const w = tip.offsetWidth;
  tip.style.left = Math.max(8, Math.min(x + 14, window.innerWidth - w - 8)) + "px";
  tip.style.top = y + 14 + "px";
}
const hideTip = () => { $("tip").hidden = true; };

// `textCols` lists the column indexes that hold prose and are left-aligned.
function table(headers, rows, textCols = []) {
  const cls = (i) => (i === 0 || textCols.includes(i) ? ' class="text"' : "");
  const head = headers.map((h, i) => `<th${cls(i)}>${h}</th>`).join("");
  const body = rows.map((r) => `<tr>${r.map((c, i) => `<td${cls(i)}>${c}</td>`).join("")}</tr>`).join("");
  return `<div class="table-wrap"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

function renderTiles(report) {
  const tiles = [
    ["Rows in file", fmtInt.format(report.rows), "all rows, before any filtering"],
    ["Trusted rows", fmtPct(report.trusted_rate), `${fmtInt.format(report.trusted_rows)} rows break no error rule`],
    ["Fully clean rows", fmtPct(report.clean_rate), `${fmtInt.format(report.clean_rows)} rows trip no rule, warnings included`],
    ["Duplicate rows", fmtInt.format(report.duplicate_rows), "exact copies; reported, not yet excluded"],
  ];
  $("tiles").innerHTML = tiles
    .map(([l, v, h]) => `<div class="tile"><div class="label">${l}</div><div class="value">${v}</div><div class="hint">${h}</div></div>`)
    .join("");
}

// Horizontal bars as plain HTML so they reflow on narrow screens (label above the bar on phones).
function renderRules(report) {
  const rules = [...report.rules].sort((a, b) => b.rate - a.rate);
  const max = Math.max(...rules.map((r) => r.rate), 1e-9);
  const root = $("rules-chart");
  root.innerHTML = "";
  const list = html("div", "bars", root);
  list.setAttribute("role", "list");
  list.setAttribute("aria-label", "Violation rate by rule");
  for (const r of rules) {
    const warn = r.severity === "warning";
    const name = `${r.id} ${r.name.replaceAll("_", " ")}`;
    const row = html("div", "bar-row", list);
    row.setAttribute("role", "listitem");
    row.tabIndex = 0;
    html("span", "lbl", row, name + (warn ? " (warning)" : ""));
    const track = html("span", "track", row);
    const fill = html("span", warn ? "fill warn" : "fill", track);
    fill.style.width = (r.violations ? Math.max((r.rate / max) * 100, 0.4) : 0) + "%";
    html("span", "val", row, fmtPct(r.rate, 3));
    const tip = (e) => {
      const b = row.getBoundingClientRect();
      showTip(`<strong>${name}</strong><br>${r.description}<br>${warn ? "Warning: reported, row stays trusted<br>" : ""}${fmtInt.format(r.violations)} rows (${fmtPct(r.rate, 3)})`, e.clientX || b.right, e.clientY || b.top);
    };
    row.addEventListener("mousemove", tip);
    row.addEventListener("focus", tip);
    row.addEventListener("mouseleave", hideTip);
    row.addEventListener("blur", hideTip);
  }
  $("rules-table").innerHTML = table(
    ["Rule", "Severity", "Description", "Violations", "Rate"],
    rules.map((r) => [`${r.id} ${r.name}`, r.severity, r.description, fmtInt.format(r.violations), fmtPct(r.rate, 3)]),
    [1, 2],
  );
}

function renderBreakdowns(report) {
  const rows = report.breakdowns.flatMap((b) =>
    b.groups.map((g) => [b.rule, b.by === "vendor_id" ? "Vendor" : "Payment type", label(b.by, g.key), fmtInt.format(g.rows), fmtPct(g.rate, 1)]),
  );
  $("breakdown-table").innerHTML = table(["Rule", "Split by", "Group", "Rows", "Violation rate"], rows, [1, 2]);
}

function renderMetrics(m) {
  const rows = [
    ["Trips", "trips", fmtInt.format],
    ["Revenue (total_amount)", "revenue", (x) => "$" + fmtInt.format(Math.round(x))],
    ["Average fare", "avg_fare", fmtUsd],
    ["Average distance (mi)", "avg_distance_mi", (x) => x.toFixed(2)],
    ["Average duration (min)", "avg_duration_min", (x) => x.toFixed(1)],
    ["Average tip rate (card trips)", "avg_tip_rate", (x) => fmtPct(x, 1)],
  ].map(([lab, key, f]) => {
    const raw = m.raw[key], tr = m.trusted[key];
    const delta = raw ? ((tr - raw) / raw) * 100 : null;
    const d = delta === null ? "n/a" : `${delta > 0 ? "+" : ""}${delta.toFixed(2)}%`;
    return [lab, raw == null ? "n/a" : f(raw), tr == null ? "n/a" : f(tr), d];
  });
  $("metrics-table").innerHTML = table(["Metric", "Raw", "Trusted", "Change"], rows);
}

// Generic line chart sized to its container. series: [{name, cls, values}]; labels: x categories.
function lineChart(root, { labels, series, yMax, yFmt, tipRow, ariaLabel, markers = false }) {
  const W = Math.max(300, root.clientWidth), H = 260, L = 52, R = 14, T = 12, B = 28;
  root.innerHTML = `<div class="legend">${series.map((s) => `<span><i class="sw ${s.cls}"></i>${s.name}</span>`).join("")}</div>`;
  const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: "img", "aria-label": ariaLabel }, root);
  const n = labels.length;
  const x = (i) => L + (n > 1 ? (i / (n - 1)) * (W - L - R) : (W - L - R) / 2);
  const y = (v) => T + (1 - v / yMax) * (H - T - B);
  for (let g = 0; g <= 4; g++) {
    const v = (yMax * g) / 4, gy = y(v);
    el("line", { class: "grid", x1: L, x2: W - R, y1: gy, y2: gy }, svg);
    el("text", { x: L - 8, y: gy + 4, "text-anchor": "end" }, svg).textContent = yFmt(v);
  }
  // Few categories: label every k-th one counted back from the latest so labels never touch.
  const pitch = n > 1 ? (W - L - R) / (n - 1) : W;
  const step = Math.max(1, Math.ceil(84 / pitch));
  const ticks = n <= 8
    ? labels.map((_, i) => i).filter((i) => (n - 1 - i) % step === 0)
    : [0, Math.floor((n - 1) / 2), n - 1];
  ticks.forEach((i) => {
    const anchor = i === n - 1 ? "end" : i === 0 && n > 8 ? "start" : "middle";
    el("text", { x: x(i), y: H - 8, "text-anchor": anchor }, svg).textContent = labels[i];
  });
  for (const s of series) {
    el("path", { class: `line ${s.cls}`, d: s.values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("") }, svg);
    if (markers) s.values.forEach((v, i) => el("circle", { class: `dot ${s.cls}`, cx: x(i), cy: y(v), r: 4 }, svg));
  }
  const cross = el("line", { class: "cross", y1: T, y2: H - B, visibility: "hidden" }, svg);
  const hit = el("rect", { class: "hit", x: L, y: T, width: W - L - R, height: H - T - B, fill: "transparent" }, svg);
  const at = (clientX, clientY) => {
    const box = svg.getBoundingClientRect();
    const px = ((clientX - box.left) / box.width) * W;
    const i = Math.min(n - 1, Math.max(0, Math.round(((px - L) / (W - L - R)) * (n - 1))));
    cross.setAttribute("x1", x(i)); cross.setAttribute("x2", x(i)); cross.setAttribute("visibility", "visible");
    showTip(`<strong>${labels[i]}</strong><br>${tipRow(i)}`, clientX, clientY);
  };
  // Browsers emulate mouse events after a tap, ending with mouseleave; keep the tooltip for touch.
  let touchedAt = 0;
  hit.addEventListener("mousemove", (e) => at(e.clientX, e.clientY));
  hit.addEventListener("touchstart", (e) => { touchedAt = Date.now(); at(e.touches[0].clientX, e.touches[0].clientY); }, { passive: true });
  hit.addEventListener("mouseleave", () => {
    if (Date.now() - touchedAt < 1000) return;
    cross.setAttribute("visibility", "hidden");
    hideTip();
  });
}

function renderDaily(days) {
  lineChart($("daily-chart"), {
    labels: days.map((d) => d.date),
    series: [
      { name: "Raw", cls: "s2", values: days.map((d) => d.trips_raw) },
      { name: "Trusted", cls: "s1", values: days.map((d) => d.trips_trusted) },
    ],
    yMax: Math.max(...days.map((d) => d.trips_raw), 1),
    yFmt: (v) => fmtInt.format(Math.round(v)),
    ariaLabel: "Daily trips, raw and trusted",
    tipRow: (i) => `Raw: ${fmtInt.format(days[i].trips_raw)}<br>Trusted: ${fmtInt.format(days[i].trips_trusted)}`,
  });
  $("daily-table").innerHTML = table(
    ["Date", "Raw trips", "Trusted trips", "Trusted revenue"],
    days.map((d) => [d.date, fmtInt.format(d.trips_raw), fmtInt.format(d.trips_trusted), "$" + fmtInt.format(Math.round(d.revenue_trusted))]),
  );
}

function renderTrend(reports) {
  lineChart($("trend-chart"), {
    labels: reports.map((r) => r.month),
    series: [
      { name: "Trusted (no error rule)", cls: "s1", values: reports.map((r) => r.trusted_rate * 100) },
      { name: "Fully clean (no rule)", cls: "s2", values: reports.map((r) => r.clean_rate * 100) },
    ],
    yMax: 100,
    yFmt: (v) => v.toFixed(0) + "%",
    ariaLabel: "Trusted and fully clean share of rows by month",
    tipRow: (i) => `Trusted: ${fmtPct(reports[i].trusted_rate)}<br>Fully clean: ${fmtPct(reports[i].clean_rate)}`,
    markers: true,
  });
  $("trend-table").innerHTML = table(
    ["Month", "Rows", "Trusted", "Fully clean"],
    reports.map((r) => [r.month, fmtInt.format(r.rows), fmtPct(r.trusted_rate), fmtPct(r.clean_rate)]),
  );
}

// 7 x 24 grid of trusted trips by pickup weekday and hour; plain HTML so it reflows.
function renderHeatmap(cells) {
  const root = $("heatmap");
  root.innerHTML = "";
  const byKey = new Map(cells.map((c) => [`${c.iso_dow}-${c.hour}`, c]));
  const max = Math.max(...cells.map((c) => c.trips_trusted), 1);
  const grid = html("div", "heat", root);
  grid.setAttribute("role", "img");
  grid.setAttribute("aria-label", "Trusted trips by weekday and pickup hour");
  html("span", "corner", grid);
  for (let h = 0; h < 24; h++) html("span", "hh", grid, h % 3 === 0 ? String(h) : "");
  for (let d = 1; d <= 7; d++) {
    html("span", "dd", grid, DOW[d - 1]);
    for (let h = 0; h < 24; h++) {
      const c = byKey.get(`${d}-${h}`);
      const cell = html("span", "cell", grid);
      const v = c ? c.trips_trusted : 0;
      cell.style.setProperty("--v", String(Math.round((v / max) * 100)));
      cell.title = `${DOW[d - 1]} ${String(h).padStart(2, "0")}:00 — ${fmtInt.format(v)} trusted trips`;
    }
  }
  const top = [...cells].sort((a, b) => b.trips_trusted - a.trips_trusted).slice(0, 8);
  $("heatmap-table").innerHTML = table(
    ["Busiest slots", "Trusted trips", "Avg fare"],
    top.map((c) => [`${DOW[c.iso_dow - 1]} ${String(c.hour).padStart(2, "0")}:00`, fmtInt.format(c.trips_trusted), fmtUsd(c.avg_fare)]),
  );
}

function renderZones(rows) {
  const top = [...rows].sort((a, b) => b.trips_trusted - a.trips_trusted).slice(0, 10);
  $("zones-table").innerHTML = table(
    ["Pickup zone", "Borough", "Trusted trips", "Avg fare", "Avg tip (card)"],
    top.map((z) => [z.zone ?? `zone ${z.zone_id}`, z.borough ?? "n/a", fmtInt.format(z.trips_trusted), fmtUsd(z.avg_fare), z.avg_tip_rate == null ? "n/a" : fmtPct(z.avg_tip_rate, 1)]),
    [1],
  );
}

function renderMeta(meta, month) {
  const src = meta.sources[`yellow_tripdata_${month}.parquet`];
  $("meta").innerHTML = src
    ? `Source file <code>yellow_tripdata_${month}.parquet</code>: ${fmtInt.format(src.rows)} rows, ${fmtInt.format(src.bytes)} bytes, SHA-256 <code>${src.sha256}</code>. Pipeline v${meta.pipeline_version}.`
    : `Pipeline v${meta.pipeline_version}.`;
}

async function main() {
  const themeBtn = $("theme");
  themeBtn.addEventListener("click", () => {
    const root = document.documentElement;
    const dark = root.dataset.theme ? root.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
    root.dataset.theme = dark ? "light" : "dark";
    themeBtn.setAttribute("aria-pressed", String(!dark));
  });

  document.addEventListener("touchstart", (e) => { if (!e.target.closest(".chart")) hideTip(); }, { passive: true });

  let meta, reports, monthly, daily, hourly, zones;
  try {
    [meta, reports, monthly, daily, hourly, zones] = await Promise.all(
      ["meta.json", "trust_report.json", "metrics_monthly.json", "daily.json", "hourly.json", "zones.json"].map(load),
    );
  } catch (err) {
    $("status").classList.add("error");
    $("status").textContent = "No data published yet. Run `data-trust run --months YYYY-MM …` to generate web/public/data/. (" + err.message + ")";
    return;
  }
  if (!meta.months.length) {
    $("status").textContent = "The pipeline ran but produced no months.";
    return;
  }
  const select = $("month");
  select.innerHTML = meta.months.map((m) => `<option>${m}</option>`).join("");
  select.disabled = meta.months.length < 2;
  select.value = meta.months[meta.months.length - 1];
  const sortedReports = [...reports].sort((a, b) => a.month.localeCompare(b.month));
  const draw = () => {
    const m = select.value;
    const report = reports.find((r) => r.month === m);
    renderTiles(report);
    renderRules(report);
    renderBreakdowns(report);
    renderMetrics(monthly.find((r) => r.month === m));
    renderDaily(daily.find((r) => r.month === m).days);
    renderHeatmap(hourly.find((r) => r.month === m).cells);
    renderZones(zones.filter((z) => z.month === m));
    renderMeta(meta, m);
    document.querySelectorAll(".month-label").forEach((n) => { n.textContent = m; });
  };
  select.addEventListener("change", draw);
  $("status").hidden = true;
  $("content").hidden = false;
  draw();
  renderTrend(sortedReports);
  // Line charts are drawn at the container's pixel width, so redraw when it changes.
  let lastWidth = $("daily-chart").clientWidth, timer;
  new ResizeObserver(() => {
    const w = $("daily-chart").clientWidth;
    if (w === lastWidth) return;
    lastWidth = w;
    clearTimeout(timer);
    timer = setTimeout(() => {
      renderDaily(daily.find((r) => r.month === select.value).days);
      renderTrend(sortedReports);
    }, 120);
  }).observe($("daily-chart"));
}
main();
