// Small dependency-free chart helpers. Charts are drawn at the container's pixel width (so text stays
// 12px on phones) and redrawn by the caller on resize. Every chart is reachable by keyboard.
const NS = "http://www.w3.org/2000/svg";

export function svgEl(tag, attrs = {}, parent) {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (parent) parent.appendChild(node);
  return node;
}

export function h(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v == null) continue;
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) if (c != null) node.append(c);
  return node;
}

export function icon(name, cls = "icon") {
  const svg = svgEl("svg", { class: cls, "aria-hidden": "true", focusable: "false" });
  svgEl("use", { href: `assets/icons.svg#i-${name}` }, svg);
  return svg;
}

// --- shared floating tooltip -------------------------------------------------------------------
const tip = () => document.getElementById("tip");
let tipOwner = null;

export function showTip(content, x, y, owner) {
  const t = tip();
  t.innerHTML = content;
  t.hidden = false;
  tipOwner = owner ?? null;
  const { offsetWidth: w, offsetHeight: hgt } = t;
  const left = Math.max(8, Math.min(x + 14, window.innerWidth - w - 8));
  const top = y + 16 + hgt > window.innerHeight - 8 ? Math.max(8, y - hgt - 12) : y + 16;
  t.style.left = left + "px";
  t.style.top = top + "px";
}

export function hideTip(owner) {
  if (owner && tipOwner && owner !== tipOwner) return;
  tip().hidden = true;
  tipOwner = null;
}

function anchorTip(content, target, owner) {
  const r = target.getBoundingClientRect();
  showTip(content, r.left + r.width / 2 - 14, r.top + r.height / 2, owner);
}

// --- line chart -----------------------------------------------------------------------------------
// series: [{ name, cls, values }]; labels: x categories; tipRow(i) returns the tooltip body.
export function lineChart(root, { labels, series, yMax, yFmt, xFmt, tipTitle, tipRow, ariaLabel }) {
  root.replaceChildren();
  const W = Math.max(280, root.clientWidth), H = W < 480 ? 220 : 260, L = 56, R = 12, T = 12, B = 30;
  const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: "img", "aria-label": ariaLabel, tabindex: 0, class: "line-chart" }, root);
  const n = labels.length;
  const x = (i) => L + (n > 1 ? (i / (n - 1)) * (W - L - R) : (W - L - R) / 2);
  const y = (v) => T + (1 - v / yMax) * (H - T - B);
  for (let g = 0; g <= 4; g++) {
    const v = (yMax * g) / 4, gy = y(v);
    svgEl("line", { class: "grid", x1: L, x2: W - R, y1: gy, y2: gy }, svg);
    svgEl("text", { class: "axis", x: L - 8, y: gy + 4, "text-anchor": "end" }, svg).textContent = yFmt(v);
  }
  const ticks = W < 480 ? [0, Math.floor((n - 1) / 2), n - 1] : [0, 7, 14, 21, n - 1].filter((i) => i < n);
  [...new Set(ticks)].forEach((i) => {
    const anchor = i === 0 ? "start" : i === n - 1 ? "end" : "middle";
    svgEl("text", { class: "axis", x: x(i), y: H - 8, "text-anchor": anchor }, svg).textContent = xFmt(labels[i]);
  });
  for (const s of series) {
    const d = s.values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
    if (s.area) svgEl("path", { class: `area ${s.cls}`, d: `${d}L${x(n - 1)},${y(0)}L${x(0)},${y(0)}Z` }, svg);
    svgEl("path", { class: `line ${s.cls}`, d }, svg);
  }
  const cross = svgEl("line", { class: "cross", y1: T, y2: H - B, visibility: "hidden" }, svg);
  const dots = series.map((s) => svgEl("circle", { class: `dot ${s.cls}`, r: 4, visibility: "hidden" }, svg));
  const hit = svgEl("rect", { x: L, y: T, width: W - L - R, height: H - T - B, fill: "transparent" }, svg);
  let current = -1, touchedAt = 0;
  const select = (i, clientX, clientY) => {
    current = i;
    cross.setAttribute("x1", x(i)); cross.setAttribute("x2", x(i)); cross.setAttribute("visibility", "visible");
    series.forEach((s, k) => { dots[k].setAttribute("cx", x(i)); dots[k].setAttribute("cy", y(s.values[i])); dots[k].setAttribute("visibility", "visible"); });
    const body = `<strong>${tipTitle(labels[i])}</strong>${tipRow(i)}`;
    if (clientX == null) {
      const box = svg.getBoundingClientRect();
      showTip(body, box.left + (x(i) / W) * box.width, box.top + (y(series[0].values[i]) / H) * box.height, svg);
    } else showTip(body, clientX, clientY, svg);
  };
  const clear = () => { current = -1; cross.setAttribute("visibility", "hidden"); dots.forEach((d) => d.setAttribute("visibility", "hidden")); hideTip(svg); };
  const indexAt = (clientX) => {
    const box = svg.getBoundingClientRect();
    const px = ((clientX - box.left) / box.width) * W;
    return Math.min(n - 1, Math.max(0, Math.round(((px - L) / (W - L - R)) * (n - 1))));
  };
  hit.addEventListener("mousemove", (e) => select(indexAt(e.clientX), e.clientX, e.clientY));
  hit.addEventListener("touchstart", (e) => { touchedAt = Date.now(); const t = e.touches[0]; select(indexAt(t.clientX), t.clientX, t.clientY); }, { passive: true });
  hit.addEventListener("mouseleave", () => { if (Date.now() - touchedAt > 1000) clear(); });
  svg.addEventListener("keydown", (e) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
    e.preventDefault();
    const next = e.key === "Home" ? 0 : e.key === "End" ? n - 1 : Math.min(n - 1, Math.max(0, (current < 0 ? 0 : current) + (e.key === "ArrowRight" ? 1 : -1)));
    select(next);
  });
  svg.addEventListener("focus", () => select(current < 0 ? n - 1 : current));
  svg.addEventListener("blur", clear);
}

// --- 100% stacked columns, one per month ----------------------------------------------------------
// items: [{ key, label, total, parts: [{ cls, value }] }]; gaps: indexes after which the time axis
// jumps (drawn as a break so missing months are not implied to be continuous).
export function stackedColumns(root, { items, selected, gaps = [], tipBody, onSelect, ariaLabel }) {
  root.replaceChildren();
  const W = Math.max(280, root.clientWidth), H = W < 480 ? 236 : 276, L = 44, R = 8, T = 10, B = 42;
  const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: "group", "aria-label": ariaLabel }, root);
  const n = items.length, gapW = gaps.length ? 22 : 0;
  const slot = (W - L - R - gapW * gaps.length) / n;
  const barW = Math.min(64, slot * 0.62);
  const y = (f) => T + (1 - f) * (H - T - B);
  [0, 0.25, 0.5, 0.75, 1].forEach((f) => {
    svgEl("line", { class: "grid", x1: L, x2: W - R, y1: y(f), y2: y(f) }, svg);
    svgEl("text", { class: "axis", x: L - 8, y: y(f) + 4, "text-anchor": "end" }, svg).textContent = `${Math.round(f * 100)}%`;
  });
  let offset = L;
  items.forEach((it, i) => {
    const cx = offset + slot / 2;
    const g = svgEl("g", { class: "col" + (it.key === selected ? " is-selected" : ""), tabindex: 0, role: "button", "aria-label": it.aria, "aria-pressed": String(it.key === selected) }, svg);
    svgEl("rect", { class: "col-hit", x: offset + 2, y: T, width: slot - 4, height: H - T - B + 4, rx: 6 }, g);
    let acc = 0;
    for (const p of it.parts) {
      const f = p.value / it.total;
      if (f <= 0) continue;
      svgEl("rect", { class: `seg ${p.cls}`, x: cx - barW / 2, y: y(acc + f), width: barW, height: Math.max(0, y(acc) - y(acc + f)) }, g);
      acc += f;
    }
    // two-line label (month, then year) so six columns fit on a 320 px screen
    const label = svgEl("text", { class: "axis" + (it.key === selected ? " axis-strong" : ""), x: cx, y: H - 24, "text-anchor": "middle" }, g);
    const [mon, year] = it.label.split(" ");
    svgEl("tspan", { x: cx, dy: 0 }, label).textContent = mon;
    svgEl("tspan", { x: cx, dy: 14, class: "axis-sub" }, label).textContent = year ?? "";
    const show = (e) => (e && e.clientX ? showTip(tipBody(it), e.clientX, e.clientY, g) : anchorTip(tipBody(it), g, g));
    g.addEventListener("mousemove", show);
    g.addEventListener("mouseleave", () => hideTip(g));
    g.addEventListener("focus", () => show());
    g.addEventListener("blur", () => hideTip(g));
    g.addEventListener("click", () => onSelect?.(it.key));
    g.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect?.(it.key); } });
    offset += slot;
    if (gaps.includes(i)) {
      const gx = offset + gapW / 2;
      svgEl("path", { class: "axis-break", d: `M${gx - 4},${H - B + 2}l4,-8M${gx},${H - B + 2}l4,-8` }, svg);
      offset += gapW;
    }
  });
}

// --- weekday x hour heatmap (HTML grid; hover, touch and a table fallback) -------------------------
export function heatmap(root, { rows, cols, value, cellLabel, ariaLabel }) {
  root.replaceChildren();
  const grid = h("div", { class: "heat", role: "img", "aria-label": ariaLabel });
  grid.append(h("span", { class: "heat-corner" }));
  cols.forEach((c, j) => grid.append(h("span", { class: "heat-col", text: j % 3 === 0 ? c : "" })));
  let max = 1;
  rows.forEach((_, i) => cols.forEach((_, j) => { max = Math.max(max, value(i, j)); }));
  rows.forEach((r, i) => {
    grid.append(h("span", { class: "heat-row", text: r }));
    cols.forEach((_, j) => {
      const v = value(i, j);
      const cell = h("span", { class: "heat-cell", "data-i": i, "data-j": j });
      cell.style.setProperty("--v", String(Math.round((v / max) * 100)));
      grid.append(cell);
    });
  });
  const body = (cell) => cellLabel(Number(cell.dataset.i), Number(cell.dataset.j));
  let touchedAt = 0;
  grid.addEventListener("mousemove", (e) => {
    const cell = e.target.closest(".heat-cell");
    if (cell) showTip(body(cell), e.clientX, e.clientY, grid); else if (Date.now() - touchedAt > 1000) hideTip(grid);
  });
  grid.addEventListener("touchstart", (e) => {
    const cell = e.target.closest(".heat-cell");
    if (!cell) return;
    touchedAt = Date.now();
    showTip(body(cell), e.touches[0].clientX, e.touches[0].clientY, grid);
  }, { passive: true });
  grid.addEventListener("mouseleave", () => { if (Date.now() - touchedAt > 1000) hideTip(grid); });
  root.append(grid);
  const scale = h("div", { class: "heat-scale", "aria-hidden": "true" },
    h("span", { text: "Sedikit" }), h("span", { class: "heat-ramp" }), h("span", { text: "Banyak" }));
  root.append(scale);
}
