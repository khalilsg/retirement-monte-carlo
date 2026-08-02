// Success-surface heatmap: success probability across two chosen assumptions, with
// a target-frontier contour and a "now" marker.
import { el } from "../dom.js";
import { parseNum, escapeHtml, inputVal } from "../format.js";
import { svgEl, textScale } from "./svg.js";
import { renderGridTable, strideIndices, describeChart } from "./table.js";
import { getMeta, sweepFmt } from "../config/parameters.js";
import { readParams, currentSims } from "../ui/controls.js";
import { ensureIndexBlock } from "../engine/rng.js";
import { simSuccess } from "../engine/simulate.js";
import { tooltip, placeTooltip, attachReadout } from "./svg.js";

// The heatmap ramp diverges around the target: neutral white at the target success
// rate, warm below it, cool above it. Both ends adapt to the active theme.
function isDark() { const t = document.documentElement.getAttribute("data-theme"); return t ? t === "dark" : matchMedia("(prefers-color-scheme: dark)").matches; }
function heatRamp() {
  return isDark()
    ? { lo: [176, 60, 48], mid: [237, 240, 247], hi: [92, 112, 214] }
    : { lo: [154, 42, 33], mid: [255, 255, 255], hi: [33, 44, 102] };
}
function lerpCol(a, b, t) { t = t < 0 ? 0 : t > 1 ? 1 : t; return `rgb(${Math.round(a[0] + (b[0] - a[0]) * t)},${Math.round(a[1] + (b[1] - a[1]) * t)},${Math.round(a[2] + (b[2] - a[2]) * t)})`; }
// v and pivot are percentages; white sits exactly on the pivot.
function heatCol(ramp, v, pivot) {
  if (v <= pivot) return lerpCol(ramp.lo, ramp.mid, pivot <= 0 ? 1 : v / pivot);
  return lerpCol(ramp.mid, ramp.hi, pivot >= 100 ? 0 : (v - pivot) / (100 - pivot));
}

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
  // The axis gutter, the tick gaps and the legend strip below the grid all hold
  // text, so they scale with it; H grows to match rather than letting the legend
  // slide off the bottom of a fixed viewBox.
  const k = textScale(), W = 760, pt = 16, pl = 66 * k, pr = 18, iw = W - pl - pr;
  // On a phone the gutter widens with the text, so iw shrinks while a fixed ih of
  // 300 stays put — which left the cells about twice as wide as they were tall.
  // Tracking iw squares them up; the cap keeps the grid from outgrowing the screen.
  const ih = k > 1 ? Math.min(iw, 560) : 300;
  // Everything below the grid is text, so the room it needs grows with it. The 94
  // is the legend block plus fixed breathing room; at k=1 and ih=300 this is
  // exactly the original 470, so desktop geometry is untouched.
  const H = Math.round(ih + 76 * k + 94);
  svg.setAttribute("viewBox", "0 0 " + W + " " + Math.round(H));
  if (xk === yk) {
    const t = svgEl("text", { x: W / 2, y: 150, "text-anchor": "middle", class: "axis-title" }); t.textContent = "Pick two different parameters for the X and Y axes."; svg.appendChild(t);
    describeChart("heat", "Pick two different parameters for the X and Y axes.");
    renderGridTable("heat-table", { caption: "Pick two different parameters for the X and Y axes.", corner: "", colHeads: [], rowHeads: [], cells: [] });
    return;
  }
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
    cg.appendChild(svgEl("rect", { x: xpx(i), y: ypxRow(j), width: cellW + .6, height: cellH + .6, fill: heatCol(ramp, grid[j][i], target) }));
  let fd = "";
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const a = grid[j][i] >= target;
    if (i + 1 < cols && a !== (grid[j][i + 1] >= target)) { const x = xpx(i + 1), yt = ypxRow(j); fd += `M${x},${yt}L${x},${yt + cellH}`; }
    if (j + 1 < rows && a !== (grid[j + 1][i] >= target)) { const y = ypxRow(j), xl = xpx(i); fd += `M${xl},${y}L${xl + cellW},${y}`; }
  }
  if (fd) svg.appendChild(svgEl("path", { d: fd, stroke: "var(--warn)", "stroke-width": 2.5, fill: "none", "stroke-linecap": "round", opacity: .95 }));
  const ax = svgEl("g", { class: "axis" }); svg.appendChild(ax);
  const nx = Math.min(k > 1.5 ? 3 : 6, cols - 1);
  for (let t = 0; t <= nx; t++) { const i = Math.round(t / nx * (cols - 1)); const tx = svgEl("text", { x: xpx(i) + cellW / 2, y: pt + ih + 16 * k, "text-anchor": "middle" }); tx.textContent = sweepFmt(xm, xs[i], false); ax.appendChild(tx); }
  const ny = Math.min(k > 1.5 ? 4 : 6, rows - 1);
  for (let t = 0; t <= ny; t++) { const j = Math.round(t / ny * (rows - 1)); const ty = svgEl("text", { x: pl - 8 * k, y: ypxRow(j) + cellH / 2 + 3.5 * k, "text-anchor": "end" }); ty.textContent = sweepFmt(ym, ys[j], false); ax.appendChild(ty); }
  const xt = svgEl("text", { class: "axis-title", x: pl + iw / 2, y: pt + ih + 34 * k, "text-anchor": "middle" }); xt.textContent = xm.label; svg.appendChild(xt);
  const yt = svgEl("text", { class: "axis-title", transform: `translate(${15 * k},${pt + ih / 2}) rotate(-90)`, "text-anchor": "middle" }); yt.textContent = ym.label; svg.appendChild(yt);
  const cxv = xm.cur(p), cyv = ym.cur(p);
  if (cxv >= xs[0] && cxv <= xs[cols - 1] && cyv >= ys[0] && cyv <= ys[rows - 1]) {
    const fi = (cxv - xs[0]) / (xs[cols - 1] - xs[0]) * (cols - 1), fj = (cyv - ys[0]) / (ys[rows - 1] - ys[0]) * (rows - 1);
    const mx = pl + fi * cellW + cellW / 2, my = pt + (rows - 1 - fj) * cellH + cellH / 2;
    svg.appendChild(svgEl("circle", { cx: mx, cy: my, r: 6, fill: "none", stroke: "var(--ink)", "stroke-width": 2 }));
    svg.appendChild(svgEl("circle", { cx: mx, cy: my, r: 2, fill: "var(--ink)" }));
  }
  const defs = svgEl("defs", {}), grad = svgEl("linearGradient", { id: "hg", x1: "0", x2: "1", y1: "0", y2: "0" });
  grad.appendChild(svgEl("stop", { offset: "0", "stop-color": heatCol(ramp, 0, target) }));
  grad.appendChild(svgEl("stop", { offset: String(Math.max(0, Math.min(1, target / 100))), "stop-color": `rgb(${ramp.mid.join(",")})` }));
  grad.appendChild(svgEl("stop", { offset: "1", "stop-color": heatCol(ramp, 100, target) }));
  defs.appendChild(grad); svg.appendChild(defs);
  // Cap the ramp's width: at full scale a 200*k bar pushes the "target" caption
  // off the right edge of the viewBox.
  const lx = pl, lw = Math.min(200 * k, 340), ly = pt + ih + 52 * k;
  const ltt = svgEl("text", { class: "axis-title", x: lx, y: ly - 6 * k }); ltt.textContent = "Success probability"; svg.appendChild(ltt);
  svg.appendChild(svgEl("rect", { x: lx, y: ly, width: lw, height: 11 * k, fill: "url(#hg)", rx: 2, stroke: "var(--hairline)", "stroke-width": 1 }));
  const la = svgEl("g", { class: "axis" }); svg.appendChild(la);
  [0, 50, 100].forEach(v => { const t = svgEl("text", { x: lx + lw * v / 100, y: ly + 24 * k, "text-anchor": "middle" }); t.textContent = v + "%"; la.appendChild(t); });
  const tmx = lx + lw * target / 100;
  svg.appendChild(svgEl("path", { d: `M${tmx},${ly - 2}L${tmx - 4 * k},${ly - 8 * k}L${tmx + 4 * k},${ly - 8 * k}Z`, fill: "var(--warn)" }));
  const ftl = svgEl("text", { class: "axis-title", x: lx + lw + 16, y: ly + 9 * k }); ftl.setAttribute("fill", "var(--warn)"); ftl.textContent = "— target " + target + "%"; svg.appendChild(ftl);
  const hi = svgEl("rect", { fill: "none", stroke: "var(--ink)", "stroke-width": 1.5, opacity: 0 }); svg.appendChild(hi);
  const rect = svgEl("rect", { x: pl, y: pt, width: iw, height: ih, fill: "transparent", stroke: "var(--hairline)", "stroke-width": 1 }); svg.appendChild(rect);
  heatState = { svg, W, H, pl, pt, iw, ih, cols, rows, cellW, cellH, xs, ys, grid, xm, ym, hi, rect }; attachHeatHover();
  describeHeat(grid, xs, ys, xm, ym, cols, rows, target);
}

// A 20×20 surface read by cell colour is unreachable without a mouse and unreadable
// without colour vision. The table samples it down to a scannable grid — the whole
// 400 cells would be noise, and the frontier is what the chart is actually for.
function describeHeat(grid, xs, ys, xm, ym, cols, rows, target) {
  describeChart("heat", `Heatmap of success probability across ${xm.label.toLowerCase()} on the horizontal axis ` +
    `(${sweepFmt(xm, xs[0], false)} to ${sweepFmt(xm, xs[cols - 1], false)}) and ${ym.label.toLowerCase()} on the vertical ` +
    `(${sweepFmt(ym, ys[0], false)} to ${sweepFmt(ym, ys[rows - 1], false)}), with a frontier drawn at ${target} percent. ` +
    `Corner values run from ${grid[0][0].toFixed(0)} to ${grid[rows - 1][cols - 1].toFixed(0)} percent. ` +
    `A sampled grid is in the data table below.`);
  const ci = strideIndices(cols, 8), ri = strideIndices(rows, 8).slice().reverse();  // top row first, as drawn
  renderGridTable("heat-table", {
    caption: `Success probability for each combination of ${xm.label.toLowerCase()} (columns) and ${ym.label.toLowerCase()} (rows), sampled from the full grid. Your target frontier is ${target}%.`,
    corner: `${ym.label} \\ ${xm.label}`,
    colHeads: ci.map(i => sweepFmt(xm, xs[i], false)),
    rowHeads: ri.map(j => sweepFmt(ym, ys[j], false)),
    cells: ri.map(j => ci.map(i => grid[j][i].toFixed(1) + "%")),
  });
}

function attachHeatHover() {
  const st = heatState, tt = tooltip();
  attachReadout(st.rect, {
    show: ev => {
      const box = st.svg.getBoundingClientRect();
      const sx = (ev.clientX - box.left) / box.width * st.W, sy = (ev.clientY - box.top) / box.height * st.H;
      let i = Math.floor((sx - st.pl) / st.cellW); i = Math.max(0, Math.min(st.cols - 1, i));
      let rf = Math.floor((sy - st.pt) / st.cellH); rf = Math.max(0, Math.min(st.rows - 1, rf)); const j = st.rows - 1 - rf;
      st.hi.setAttribute("x", st.pl + i * st.cellW); st.hi.setAttribute("y", st.pt + rf * st.cellH); st.hi.setAttribute("width", st.cellW); st.hi.setAttribute("height", st.cellH); st.hi.setAttribute("opacity", 1);
      tt.style.opacity = 1;
      tt.innerHTML = `<div class="tt-t">${st.grid[j][i].toFixed(1)}% success</div>${escapeHtml(st.xm.label)}: <b>${sweepFmt(st.xm, st.xs[i], false)}</b><br>${escapeHtml(st.ym.label)}: <b>${sweepFmt(st.ym, st.ys[j], false)}</b>`;
      placeTooltip(tt, ev);
    },
    hide: () => { st.hi.setAttribute("opacity", 0); tt.style.opacity = 0; },
  });
}
