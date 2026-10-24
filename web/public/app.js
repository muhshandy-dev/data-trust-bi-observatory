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

function showTip(html, x, y) {
  const tip = $("tip");
  tip.innerHTML = html;
  tip.hidden = false;
  const w = tip.offsetWidth;
  tip.style.left = Math.min(x + 14, window.innerWidth - w - 8) + "px";
  tip.style.top = y + 14 + "px";
}
const hideTip = () => { $("tip").hidden = true; };

function table(headers, rows) {
  const head = headers.map((h) => `<th>${h}</th>`).join("");
  const body = rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("");
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

function renderRules(report) {
  const rules = [...report.rules].sort((a, b) => b.rate - a.rate);
  const W = 720, rowH = 28, left = 270, right = 70, top = 4;
  const H = top + rules.length * rowH + 4;
  const max = Math.max(...rules.map((r) => r.rate), 1e-9);
  const root = $("rules-chart");
  root.innerHTML = "";
  const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": "Violation rate by rule" }, root);
  rules.forEach((r, i) => {
    const y = top + i * rowH;
    const w = Math.max((r.rate / max) * (W - left - right), r.violations ? 2 : 0);
    const warn = r.severity === "warning";
    el("text", { x: left - 8, y: y + 17, "text-anchor": "end" }, svg).textContent = `${r.id} ${r.name.replaceAll("_", " ")}${warn ? " (warning)" : ""}`;
    const bar = el("rect", { class: warn ? "bar warn" : "bar", x: left, y: y + 4, width: w, height: 18, rx: 4, tabindex: 0 }, svg);
    el("text", { x: left + w + 6, y: y + 17 }, svg).textContent = fmtPct(r.rate, 3);
    const tip = (e) => {
      const b = bar.getBoundingClientRect();
      showTip(`<strong>${r.id} ${r.name.replaceAll("_", " ")}</strong><br>${r.description}<br>${warn ? "Warning: reported, row stays trusted<br>" : ""}${fmtInt.format(r.violations)} rows (${fmtPct(r.rate, 3)})`, e.clientX || b.right, e.clientY || b.top);
    };
    bar.addEventListener("mousemove", tip);
    bar.addEventListener("focus", tip);
    bar.addEventListener("mouseleave", hideTip);
    bar.addEventListener("blur", hideTip);
  });
  $("rules-table").innerHTML = table(
    ["Rule", "Severity", "Description", "Violations", "Rate"],
    rules.map((r) => [`${r.id} ${r.name}`, r.severity, r.description, fmtInt.format(r.violations), fmtPct(r.rate, 3)]),
  );
}

function renderBreakdowns(report) {
  const rows = report.breakdowns.flatMap((b) =>
    b.groups.map((g) => [`${b.rule}`, b.by === "vendor_id" ? "Vendor" : "Payment type", label(b.by, g.key), fmtInt.format(g.rows), fmtPct(g.rate, 1)]),
  );
  $("breakdown-table").innerHTML = table(["Rule", "Split by", "Group", "Rows", "Violation rate"], rows);
}

function renderMetrics(m) {
  const rows = [
    ["Trips", "trips", fmtInt.format],
    ["Revenue (total_amount)", "revenue", (x) => "$" + fmtInt.format(Math.round(x))],
    ["Average fare", "avg_fare", fmtUsd],
    ["Average distance (mi)", "avg_distance_mi", (x) => x.toFixed(2)],
    ["Average duration (min)", "avg_duration_min", (x) => x.toFixed(1)],
    ["Average tip rate (card trips)", "avg_tip_rate", (x) => fmtPct(x, 1)],
  ].map(([label, key, f]) => {
    const raw = m.raw[key], tr = m.trusted[key];
    const delta = raw ? ((tr - raw) / raw) * 100 : null;
    const d = delta === null ? "n/a" : `${delta > 0 ? "+" : ""}${delta.toFixed(2)}%`;
    return [label, raw == null ? "n/a" : f(raw), tr == null ? "n/a" : f(tr), d];
  });
  $("metrics-table").innerHTML = table(["Metric", "Raw", "Trusted", "Change"], rows);
}

function renderDaily(days) {
  const W = 720, H = 280, L = 56, R = 16, T = 12, B = 28;
  const root = $("daily-chart");
  root.innerHTML = `<div class="legend"><span><i style="background:var(--series-2)"></i>Raw</span><span><i style="background:var(--series-1)"></i>Trusted</span></div>`;
  const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": "Daily trips, raw and trusted" }, root);
  const max = Math.max(...days.map((d) => d.trips_raw), 1);
  const x = (i) => L + (days.length > 1 ? (i / (days.length - 1)) * (W - L - R) : (W - L - R) / 2);
  const y = (v) => T + (1 - v / max) * (H - T - B);
  for (let g = 0; g <= 4; g++) {
    const v = (max * g) / 4, gy = y(v);
    el("line", { class: "grid", x1: L, x2: W - R, y1: gy, y2: gy }, svg);
    el("text", { x: L - 8, y: gy + 4, "text-anchor": "end" }, svg).textContent = fmtInt.format(Math.round(v));
  }
  [0, Math.floor((days.length - 1) / 2), days.length - 1].forEach((i) => {
    if (days[i]) el("text", { x: x(i), y: H - 8, "text-anchor": i === 0 ? "start" : i === days.length - 1 ? "end" : "middle" }, svg).textContent = days[i].date;
  });
  const path = (key) => days.map((d, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(d[key]).toFixed(1)}`).join("");
  el("path", { class: "line line-raw", d: path("trips_raw") }, svg);
  el("path", { class: "line line-trusted", d: path("trips_trusted") }, svg);
  const cross = el("line", { class: "cross", y1: T, y2: H - B, visibility: "hidden" }, svg);
  const hit = el("rect", { x: L, y: T, width: W - L - R, height: H - T - B, fill: "transparent" }, svg);
  hit.addEventListener("mousemove", (e) => {
    const box = svg.getBoundingClientRect();
    const px = ((e.clientX - box.left) / box.width) * W;
    const i = Math.min(days.length - 1, Math.max(0, Math.round(((px - L) / (W - L - R)) * (days.length - 1))));
    const d = days[i];
    cross.setAttribute("x1", x(i)); cross.setAttribute("x2", x(i)); cross.setAttribute("visibility", "visible");
    showTip(`<strong>${d.date}</strong><br>Raw: ${fmtInt.format(d.trips_raw)}<br>Trusted: ${fmtInt.format(d.trips_trusted)}`, e.clientX, e.clientY);
  });
  hit.addEventListener("mouseleave", () => { cross.setAttribute("visibility", "hidden"); hideTip(); });
  $("daily-table").innerHTML = table(["Date", "Raw trips", "Trusted trips", "Trusted revenue"], days.map((d) => [d.date, fmtInt.format(d.trips_raw), fmtInt.format(d.trips_trusted), "$" + fmtInt.format(Math.round(d.revenue_trusted))]));
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
  });

  let meta, reports, monthly, daily;
  try {
    [meta, reports, monthly, daily] = await Promise.all(["meta.json", "trust_report.json", "metrics_monthly.json", "daily.json"].map(load));
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
  const draw = () => {
    const m = select.value;
    renderTiles(reports.find((r) => r.month === m));
    renderRules(reports.find((r) => r.month === m));
    renderBreakdowns(reports.find((r) => r.month === m));
    renderMetrics(monthly.find((r) => r.month === m));
    renderDaily(daily.find((r) => r.month === m).days);
    renderMeta(meta, m);
  };
  select.addEventListener("change", draw);
  $("status").hidden = true;
  $("content").hidden = false;
  draw();
}
main();
