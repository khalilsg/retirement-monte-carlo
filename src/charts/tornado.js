// Tornado chart: rank each assumption by how far success swings over a plausible
// ± range, everything else held at the current plan.
import { el } from "../dom.js";
import { escapeHtml } from "../format.js";
import { svgEl, tooltip, placeTooltip } from "./svg.js";
import { SWEEP_META, streamMeta, sweepFmt } from "../config/parameters.js";
import { readParams, currentSims } from "../ui/controls.js";
import { simSuccess } from "../engine/simulate.js";

function tornadoData() {
  const p = readParams(), n = currentSims(), base = simSuccess(p, n), rows = [];
  const evalRow = (meta, lo, hi) => {
    if (meta.min != null) { lo = Math.max(meta.min, lo); hi = Math.max(meta.min, hi); }
    if (meta.max != null) { lo = Math.min(meta.max, lo); hi = Math.min(meta.max, hi); }
    if (Math.abs(hi - lo) < 1e-9) return;
    const pLo = Object.assign({}, p); pLo.streams = p.streams.map(o => Object.assign({}, o)); meta.apply(pLo, lo);
    const pHi = Object.assign({}, p); pHi.streams = p.streams.map(o => Object.assign({}, o)); meta.apply(pHi, hi);
    const sLo = simSuccess(pLo, n), sHi = simSuccess(pHi, n);
    rows.push({ label: meta.label, meta, lo, hi, sLo, sHi, impact: Math.abs(sHi - sLo) });
  };
  for (const key of Object.keys(SWEEP_META)) {
    const meta = SWEEP_META[key];
    if (!meta.tw || (meta.when && !meta.when(p))) continue;
    const [lo, hi] = meta.tw(p); evalRow(meta, lo, hi);
  }
  p.streams.forEach((s, i) => { const cur = p.streams[i] ? p.streams[i].amount : 0; if (cur > 0) evalRow(streamMeta(i, p.streams), cur * .85, cur * 1.15); });
  rows.sort((a, b) => b.impact - a.impact);
  return { base, rows };
}

let tornadoState = null;
export function renderTornado() {
  const svg = el("tornado"); svg.innerHTML = "";
  const { base, rows } = tornadoData();
  const W = 760, m = { t: 26, r: 20, b: 30, l: 150 }, rowH = 30, iw = W - m.l - m.r;
  const H = m.t + rows.length * rowH + m.b;
  svg.setAttribute("viewBox", "0 0 " + W + " " + H);
  if (!rows.length) { const t = svgEl("text", { x: W / 2, y: 40, "text-anchor": "middle", class: "axis-title" }); t.textContent = "No adjustable assumptions to rank."; svg.appendChild(t); return; }
  const xOf = v => m.l + v / 100 * iw, plotBottom = m.t + rows.length * rowH;
  const ax = svgEl("g", { class: "axis" }); svg.appendChild(ax);
  for (let v = 0; v <= 100; v += 25) { const x = xOf(v); ax.appendChild(svgEl("line", { x1: x, y1: m.t, x2: x, y2: plotBottom, stroke: "var(--hairline)", "stroke-width": 1 })); const t = svgEl("text", { x, y: plotBottom + 16, "text-anchor": "middle" }); t.textContent = v + "%"; ax.appendChild(t); }
  const bx = xOf(base);
  svg.appendChild(svgEl("line", { x1: bx, y1: m.t - 6, x2: bx, y2: plotBottom, stroke: "var(--ink)", "stroke-width": 1.4, "stroke-dasharray": "4 3", opacity: .6 }));
  const nowl = svgEl("text", { x: bx, y: m.t - 10, "text-anchor": "middle", class: "tor-val" }); nowl.setAttribute("fill", "var(--ink)"); nowl.setAttribute("font-weight", "600"); nowl.textContent = "now " + base.toFixed(0) + "%"; svg.appendChild(nowl);
  const barH = 13;
  rows.forEach((row, i) => {
    const cy = m.t + i * rowH + rowH / 2, s0 = Math.min(row.sLo, row.sHi), s1 = Math.max(row.sLo, row.sHi);
    const x0 = xOf(s0), x1 = xOf(s1), xb = Math.max(x0, Math.min(x1, bx));
    if (xb > x0 + .5) svg.appendChild(svgEl("rect", { x: x0, y: cy - barH / 2, width: xb - x0, height: barH, fill: "var(--warn)", opacity: .72, rx: 2 }));
    if (x1 > xb + .5) svg.appendChild(svgEl("rect", { x: xb, y: cy - barH / 2, width: x1 - xb, height: barH, fill: "var(--brand)", opacity: .72, rx: 2 }));
    const nm = svgEl("text", { x: m.l - 10, y: cy + 3.5, "text-anchor": "end", class: "tor-name" }); nm.textContent = row.label; svg.appendChild(nm);
    const lowerIn = row.sLo <= row.sHi ? row.lo : row.hi, higherIn = row.sLo <= row.sHi ? row.hi : row.lo;
    const lv = svgEl("text", { x: x0 - 4, y: cy + 3.5, "text-anchor": "end", class: "tor-val" }); lv.textContent = sweepFmt(row.meta, lowerIn, false); svg.appendChild(lv);
    const rv = svgEl("text", { x: x1 + 4, y: cy + 3.5, "text-anchor": "start", class: "tor-val" }); rv.textContent = sweepFmt(row.meta, higherIn, false); svg.appendChild(rv);
  });
  const rect = svgEl("rect", { x: 0, y: m.t, width: W, height: rows.length * rowH, fill: "transparent" }); svg.appendChild(rect);
  tornadoState = { svg, W, H, m, rowH, rows, base, xOf, rect }; attachTornadoHover();
}

function attachTornadoHover() {
  const st = tornadoState, tt = tooltip();
  st.rect.addEventListener("mousemove", ev => {
    const box = st.svg.getBoundingClientRect(), sy = (ev.clientY - box.top) / box.height * st.H;
    let i = Math.floor((sy - st.m.t) / st.rowH);
    if (i < 0 || i >= st.rows.length) { tt.style.opacity = 0; return; }
    const r = st.rows[i], worse = r.sLo <= r.sHi ? { in: r.lo, s: r.sLo } : { in: r.hi, s: r.sHi }, better = r.sLo <= r.sHi ? { in: r.hi, s: r.sHi } : { in: r.lo, s: r.sLo };
    tt.style.opacity = 1;
    tt.innerHTML = `<div class="tt-t">${escapeHtml(r.label)}</div>${sweepFmt(r.meta, worse.in, false)} → <b>${worse.s.toFixed(1)}%</b><br>${sweepFmt(r.meta, better.in, false)} → <b>${better.s.toFixed(1)}%</b><br>swing <b>${r.impact.toFixed(1)} pts</b>`;
    placeTooltip(tt, ev);
  });
  st.rect.addEventListener("mouseleave", () => { tt.style.opacity = 0; });
}
