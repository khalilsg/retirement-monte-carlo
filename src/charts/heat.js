// Success-surface heatmap: success probability across two chosen assumptions, with
// a target-frontier contour and a "now" marker.
import { el } from "../dom.js";
import { parseNum, escapeHtml, inputVal } from "../format.js";
import { svgEl } from "./svg.js";
import { getMeta, sweepFmt } from "../config/parameters.js";
import { readParams, currentSims } from "../ui/controls.js";
import { ensureIndexBlock } from "../engine/rng.js";
import { simSuccess } from "../engine/simulate.js";
import { tooltip, placeTooltip } from "./svg.js";

// The heatmap ramp adapts to the active theme.
function isDark() { const t = document.documentElement.getAttribute("data-theme"); return t ? t === "dark" : matchMedia("(prefers-color-scheme: dark)").matches; }
function heatRamp() { return isDark() ? [[24, 34, 54], [150, 163, 240]] : [[234, 237, 249], [33, 44, 102]]; }
function lerpCol(a, b, t) { t = t < 0 ? 0 : t > 1 ? 1 : t; return `rgb(${Math.round(a[0] + (b[0] - a[0]) * t)},${Math.round(a[1] + (b[1] - a[1]) * t)},${Math.round(a[2] + (b[2] - a[2]) * t)})`; }

function axisValues(meta, fromEl, toEl, steps) {
  let from = parseNum(inputVal(el(fromEl))), to = parseNum(inputVal(el(toEl)));
  if (meta.min != null) from = Math.max(meta.min, from);
  if (meta.max != null) to = Math.min(meta.max, to);
  if (to <= from) to = from + (meta.kind === "money" ? 1000 : 1);
  const vals = [];
  for (let i = 0; i < steps; i++) { let v = from + (to - from) * (i / (steps - 1)); if (meta.int) v = Math.round(v); vals.push(v); }
  return vals;
}

let heatState = null;
export function renderHeat() {
  const svg = el("heat"); svg.innerHTML = "";
  const p = readParams(), nSims = currentSims();
  const xk = el("hx-var").value, yk = el("hy-var").value, xm = getMeta(xk, p.streams), ym = getMeta(yk, p.streams);
  const W = 760, H = 470, pt = 16, pl = 66, pr = 18, ih = 300, iw = W - pl - pr;
  if (xk === yk) { const t = svgEl("text", { x: W / 2, y: 150, "text-anchor": "middle", class: "axis-title" }); t.textContent = "Pick two different parameters for the X and Y axes."; svg.appendChild(t); return; }
  const cols = Math.max(3, Math.min(50, Math.round(parseNum(el("hx-steps").value)) || 20));
  const rows = Math.max(3, Math.min(36, Math.round(parseNum(el("hy-steps").value)) || 20));
  const target = Math.max(0, Math.min(100, parseNum(el("h-target").value) || 0));
  const xs = axisValues(xm, "hx-from", "hx-to", cols), ys = axisValues(ym, "hy-from", "hy-to", rows);
  const needCrn = xm.crn || ym.crn, grid = [];
  for (let j = 0; j < rows; j++) {
    grid[j] = new Float64Array(cols);
    for (let i = 0; i < cols; i++) {
      const pp = Object.assign({}, p); pp.streams = p.streams.map(o => Object.assign({}, o));
      xm.apply(pp, xs[i]); ym.apply(pp, ys[j]);
      if (needCrn) ensureIndexBlock(nSims, pp.blockLen);
      grid[j][i] = simSuccess(pp, nSims);
    }
  }
  if (needCrn) ensureIndexBlock(nSims, p.blockLen);
  const ramp = heatRamp(), cellW = iw / cols, cellH = ih / rows;
  const xpx = i => pl + i * cellW, ypxRow = j => pt + (rows - 1 - j) * cellH;
  const cg = svgEl("g", {}); svg.appendChild(cg);
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++)
    cg.appendChild(svgEl("rect", { x: xpx(i), y: ypxRow(j), width: cellW + .6, height: cellH + .6, fill: lerpCol(ramp[0], ramp[1], grid[j][i] / 100) }));
  let fd = "";
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const a = grid[j][i] >= target;
    if (i + 1 < cols && a !== (grid[j][i + 1] >= target)) { const x = xpx(i + 1), yt = ypxRow(j); fd += `M${x},${yt}L${x},${yt + cellH}`; }
    if (j + 1 < rows && a !== (grid[j + 1][i] >= target)) { const y = ypxRow(j), xl = xpx(i); fd += `M${xl},${y}L${xl + cellW},${y}`; }
  }
  if (fd) svg.appendChild(svgEl("path", { d: fd, stroke: "var(--warn)", "stroke-width": 2.5, fill: "none", "stroke-linecap": "round", opacity: .95 }));
  const ax = svgEl("g", { class: "axis" }); svg.appendChild(ax);
  const nx = Math.min(6, cols - 1);
  for (let t = 0; t <= nx; t++) { const i = Math.round(t / nx * (cols - 1)); const tx = svgEl("text", { x: xpx(i) + cellW / 2, y: pt + ih + 16, "text-anchor": "middle" }); tx.textContent = sweepFmt(xm, xs[i], false); ax.appendChild(tx); }
  const ny = Math.min(6, rows - 1);
  for (let t = 0; t <= ny; t++) { const j = Math.round(t / ny * (rows - 1)); const ty = svgEl("text", { x: pl - 8, y: ypxRow(j) + cellH / 2 + 3.5, "text-anchor": "end" }); ty.textContent = sweepFmt(ym, ys[j], false); ax.appendChild(ty); }
  const xt = svgEl("text", { class: "axis-title", x: pl + iw / 2, y: pt + ih + 34, "text-anchor": "middle" }); xt.textContent = xm.label; svg.appendChild(xt);
  const yt = svgEl("text", { class: "axis-title", transform: `translate(15,${pt + ih / 2}) rotate(-90)`, "text-anchor": "middle" }); yt.textContent = ym.label; svg.appendChild(yt);
  const cxv = xm.cur(p), cyv = ym.cur(p);
  if (cxv >= xs[0] && cxv <= xs[cols - 1] && cyv >= ys[0] && cyv <= ys[rows - 1]) {
    const fi = (cxv - xs[0]) / (xs[cols - 1] - xs[0]) * (cols - 1), fj = (cyv - ys[0]) / (ys[rows - 1] - ys[0]) * (rows - 1);
    const mx = pl + fi * cellW + cellW / 2, my = pt + (rows - 1 - fj) * cellH + cellH / 2;
    svg.appendChild(svgEl("circle", { cx: mx, cy: my, r: 6, fill: "none", stroke: "var(--ink)", "stroke-width": 2 }));
    svg.appendChild(svgEl("circle", { cx: mx, cy: my, r: 2, fill: "var(--ink)" }));
  }
  const defs = svgEl("defs", {}), grad = svgEl("linearGradient", { id: "hg", x1: "0", x2: "1", y1: "0", y2: "0" });
  grad.appendChild(svgEl("stop", { offset: "0", "stop-color": lerpCol(ramp[0], ramp[1], 0) }));
  grad.appendChild(svgEl("stop", { offset: "1", "stop-color": lerpCol(ramp[0], ramp[1], 1) }));
  defs.appendChild(grad); svg.appendChild(defs);
  const lx = pl, lw = 200, ly = pt + ih + 52;
  const ltt = svgEl("text", { class: "axis-title", x: lx, y: ly - 6 }); ltt.textContent = "Success probability"; svg.appendChild(ltt);
  svg.appendChild(svgEl("rect", { x: lx, y: ly, width: lw, height: 11, fill: "url(#hg)", rx: 2 }));
  const la = svgEl("g", { class: "axis" }); svg.appendChild(la);
  [0, 50, 100].forEach(v => { const t = svgEl("text", { x: lx + lw * v / 100, y: ly + 24, "text-anchor": "middle" }); t.textContent = v + "%"; la.appendChild(t); });
  const tmx = lx + lw * target / 100;
  svg.appendChild(svgEl("path", { d: `M${tmx},${ly - 2}L${tmx - 4},${ly - 8}L${tmx + 4},${ly - 8}Z`, fill: "var(--warn)" }));
  const ftl = svgEl("text", { class: "axis-title", x: lx + lw + 16, y: ly + 9 }); ftl.setAttribute("fill", "var(--warn)"); ftl.textContent = "— target " + target + "%"; svg.appendChild(ftl);
  const hi = svgEl("rect", { fill: "none", stroke: "var(--ink)", "stroke-width": 1.5, opacity: 0 }); svg.appendChild(hi);
  const rect = svgEl("rect", { x: pl, y: pt, width: iw, height: ih, fill: "transparent" }); svg.appendChild(rect);
  heatState = { svg, W, H, pl, pt, iw, ih, cols, rows, cellW, cellH, xs, ys, grid, xm, ym, hi, rect }; attachHeatHover();
}

function attachHeatHover() {
  const st = heatState, tt = tooltip();
  st.rect.addEventListener("mousemove", ev => {
    const box = st.svg.getBoundingClientRect();
    const sx = (ev.clientX - box.left) / box.width * st.W, sy = (ev.clientY - box.top) / box.height * st.H;
    let i = Math.floor((sx - st.pl) / st.cellW); i = Math.max(0, Math.min(st.cols - 1, i));
    let rf = Math.floor((sy - st.pt) / st.cellH); rf = Math.max(0, Math.min(st.rows - 1, rf)); const j = st.rows - 1 - rf;
    st.hi.setAttribute("x", st.pl + i * st.cellW); st.hi.setAttribute("y", st.pt + rf * st.cellH); st.hi.setAttribute("width", st.cellW); st.hi.setAttribute("height", st.cellH); st.hi.setAttribute("opacity", 1);
    tt.style.opacity = 1;
    tt.innerHTML = `<div class="tt-t">${st.grid[j][i].toFixed(1)}% success</div>${escapeHtml(st.xm.label)}: <b>${sweepFmt(st.xm, st.xs[i], false)}</b><br>${escapeHtml(st.ym.label)}: <b>${sweepFmt(st.ym, st.ys[j], false)}</b>`;
    placeTooltip(tt, ev);
  });
  st.rect.addEventListener("mouseleave", () => { st.hi.setAttribute("opacity", 0); tt.style.opacity = 0; });
}
