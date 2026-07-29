// Sensitivity sweep: vary one assumption across a range (holding the rest fixed),
// plot the resulting success curve with a "now" marker, and offer a data table.
import { el } from "../dom.js";
import { parseNum, escapeHtml, inputVal } from "../format.js";
import { svgEl, tooltip, placeTooltip } from "./svg.js";
import { getMeta, sweepFmt } from "../config/parameters.js";
import { readParams, currentSims } from "../ui/controls.js";
import { ensureIndex } from "../engine/rng.js";
import { simSuccess } from "../engine/simulate.js";

export function renderSweep() {
  const key = el("sweep-var").value, p = readParams(), meta = getMeta(key, p.streams), nSims = currentSims();
  let from = parseNum(inputVal(el("sweep-from"))), to = parseNum(inputVal(el("sweep-to")));
  let steps = Math.max(3, Math.min(120, Math.round(parseNum(el("sweep-steps").value)) || 41));
  if (meta.min != null) from = Math.max(meta.min, from);
  if (meta.max != null) to = Math.min(meta.max, to);
  if (to <= from) to = from + (meta.kind === "money" ? 1000 : 1);
  const xs = [], ys = [];
  for (let i = 0; i < steps; i++) {
    let val = from + (to - from) * (i / (steps - 1));
    if (meta.int) val = Math.round(val);
    const pp = Object.assign({}, p); pp.streams = p.streams.map(o => Object.assign({}, o)); meta.apply(pp, val);
    if (meta.crn) ensureIndex(nSims, pp.blockLen);
    xs.push(val); ys.push(simSuccess(pp, nSims));
  }
  if (meta.crn) ensureIndex(nSims, p.blockLen); // restore matrix to current
  drawSweep(xs, ys, meta, meta.cur(p));
  buildSweepTable(xs, ys, meta);
}

let sweepState = null;
function drawSweep(xs, ys, meta, curVal) {
  const svg = el("sweep"); svg.innerHTML = "";
  const W = 760, H = 340, m = { t: 16, r: 18, b: 40, l: 52 };
  const iw = W - m.l - m.r, ih = H - m.t - m.b, xmin = xs[0], xmax = xs[xs.length - 1];
  const xOf = x => m.l + (xmax === xmin ? 0 : (x - xmin) / (xmax - xmin) * iw), yOf = y => m.t + ih - (y / 100) * ih;
  const g = svgEl("g", { class: "grid" }); svg.appendChild(g);
  const ax = svgEl("g", { class: "axis" }); svg.appendChild(ax);
  for (let i = 0; i <= 5; i++) { const yv = i * 20, yy = yOf(yv); g.appendChild(svgEl("line", { x1: m.l, y1: yy, x2: W - m.r, y2: yy })); const t = svgEl("text", { x: m.l - 8, y: yy + 3.5, "text-anchor": "end" }); t.textContent = yv + "%"; ax.appendChild(t); }
  for (let i = 0; i <= 6; i++) { const xv = xmin + (xmax - xmin) * i / 6, xx = xOf(xv); const t = svgEl("text", { x: xx, y: H - m.b + 16, "text-anchor": "middle" }); t.textContent = sweepFmt(meta, xv, false); ax.appendChild(t); }
  svg.appendChild(svgEl("line", { x1: m.l, x2: W - m.r, y1: yOf(80), y2: yOf(80), stroke: "var(--good)", "stroke-width": 1, "stroke-dasharray": "2 4", opacity: .5 }));
  let ad = "M" + xOf(xs[0]) + "," + yOf(0); for (let i = 0; i < xs.length; i++) ad += "L" + xOf(xs[i]) + "," + yOf(ys[i]); ad += "L" + xOf(xs[xs.length - 1]) + "," + yOf(0) + "Z";
  svg.appendChild(svgEl("path", { d: ad, fill: "var(--brand-soft)", opacity: .7 }));
  let d = "M" + xOf(xs[0]) + "," + yOf(ys[0]); for (let i = 1; i < xs.length; i++) d += "L" + xOf(xs[i]) + "," + yOf(ys[i]);
  svg.appendChild(svgEl("path", { d, fill: "none", stroke: "var(--brand)", "stroke-width": 2.4, "stroke-linejoin": "round" }));
  if (curVal >= xmin && curVal <= xmax) {
    const cx = xOf(curVal);
    svg.appendChild(svgEl("line", { x1: cx, x2: cx, y1: m.t, y2: m.t + ih, stroke: "var(--ink)", "stroke-width": 1.2, "stroke-dasharray": "4 3", opacity: .55 }));
    let cy = ys[0]; for (let i = 1; i < xs.length; i++) if (curVal >= xs[i - 1] && curVal <= xs[i]) { const f = (curVal - xs[i - 1]) / (xs[i] - xs[i - 1]); cy = ys[i - 1] + f * (ys[i] - ys[i - 1]); break; }
    svg.appendChild(svgEl("circle", { cx, cy: yOf(cy), r: 5, fill: "var(--ink)", stroke: "var(--surface)", "stroke-width": 2 }));
    const lbl = svgEl("text", { x: cx, y: m.t - 3, "text-anchor": "middle", class: "axis-title" }); lbl.setAttribute("font-weight", "600"); lbl.textContent = "now: " + cy.toFixed(0) + "%"; svg.appendChild(lbl);
  }
  const at = svgEl("text", { class: "axis-title", x: m.l + iw / 2, y: H - 4, "text-anchor": "middle" }); at.textContent = meta.label; svg.appendChild(at);
  const yt = svgEl("text", { class: "axis-title", transform: `translate(13,${m.t + ih / 2}) rotate(-90)`, "text-anchor": "middle" }); yt.textContent = "Success probability"; svg.appendChild(yt);
  const dot = svgEl("circle", { r: 4, fill: "var(--brand)", stroke: "var(--surface)", "stroke-width": 1.5, opacity: 0 }); svg.appendChild(dot);
  const rect = svgEl("rect", { x: m.l, y: m.t, width: iw, height: ih, fill: "transparent" }); svg.appendChild(rect);
  sweepState = { svg, W, m, iw, ih, xs, ys, xOf, yOf, meta, dot, rect }; attachSweepHover();
}

function attachSweepHover() {
  const st = sweepState, tt = tooltip();
  st.rect.addEventListener("mousemove", ev => {
    const box = st.svg.getBoundingClientRect(), sx = (ev.clientX - box.left) / box.width * st.W;
    let best = 0, bd = Infinity; for (let i = 0; i < st.xs.length; i++) { const dx = Math.abs(st.xOf(st.xs[i]) - sx); if (dx < bd) { bd = dx; best = i; } }
    st.dot.setAttribute("cx", st.xOf(st.xs[best])); st.dot.setAttribute("cy", st.yOf(st.ys[best])); st.dot.setAttribute("opacity", 1);
    tt.style.opacity = 1;
    tt.innerHTML = `<div class="tt-t">${escapeHtml(st.meta.label)}</div>${sweepFmt(st.meta, st.xs[best], false)} → <b>${st.ys[best].toFixed(1)}%</b>`;
    placeTooltip(tt, ev);
  });
  st.rect.addEventListener("mouseleave", () => { st.dot.setAttribute("opacity", 0); tt.style.opacity = 0; });
}

function buildSweepTable(xs, ys, meta) {
  let rows = "<tr><th>" + escapeHtml(meta.label) + "</th><th>Success</th></tr>";
  const stride = Math.max(1, Math.round(xs.length / 20));
  for (let i = 0; i < xs.length; i += stride) rows += `<tr><td>${sweepFmt(meta, xs[i], true)}</td><td>${ys[i].toFixed(1)}%</td></tr>`;
  el("sweep-table").innerHTML = rows;
}
