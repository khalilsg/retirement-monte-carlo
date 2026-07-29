// Sequence-of-returns card: the attribution split (survives / magnitude / sequence)
// and the conditional-success-by-age chart with a "breathe easy" threshold.
import { el } from "../dom.js";
import { parseNum } from "../format.js";
import { svgEl, tooltip, placeTooltip } from "./svg.js";
import { readParams, currentSims } from "../ui/controls.js";
import { simSequence, safeYearFrom } from "../engine/simulate.js";

let seqData = null, seqChartState = null;

export function renderSequence() { seqData = simSequence(readParams(), currentSims()); drawSequence(); }

// Redraw from cached data (used when only the safe-threshold input changes).
export function drawSequence() {
  if (!seqData) return;
  const d = seqData;
  el("seq-start").textContent = "your balance at retirement";
  const shareEl = el("seq-share"), labEl = shareEl.nextElementSibling;
  if (isNaN(d.seqShare) || d.failActual <= 0) { shareEl.textContent = "0"; labEl.innerHTML = "failures in these runs — nothing to attribute"; }
  else { shareEl.textContent = Math.round(d.seqShare) + "%"; labEl.innerHTML = "of failures are caused by the <b>order</b> of returns"; }
  const succ = d.successPct, mag = d.magFail, seq = d.seqFail;
  el("seq-bar").innerHTML = `<div style="width:${succ}%;background:var(--good)"></div><div style="width:${mag}%;background:var(--faint)"></div><div style="width:${seq}%;background:var(--warn)"></div>`;
  el("seq-legend").innerHTML =
    `<span class="li"><span class="sw" style="background:var(--good)"></span>Survives <b>${succ.toFixed(1)}%</b></span>` +
    `<span class="li"><span class="sw" style="background:var(--faint)"></span>Magnitude failure <b>${mag.toFixed(1)}%</b></span>` +
    `<span class="li"><span class="sw" style="background:var(--warn)"></span>Sequence failure <b>${seq.toFixed(1)}%</b></span>`;
  const target = Math.max(1, Math.min(100, parseNum(el("seq-target").value) || 95));
  const safeYear = safeYearFrom(d.cond, target);
  drawSeqChart(d, target, safeYear);
  if (d.failActual <= 0) el("seq-summary").textContent = "No failures in these runs, so there's no sequence risk to isolate — try higher spending, retiring earlier, or Blocks sampling to surface it.";
  else if (safeYear != null) el("seq-summary").innerHTML = `Reach <b>age ${d.ca + safeYear}</b> with your inflation-adjusted balance still at or above what you had at retirement, and success is at least ${target}% (it's ${Math.round(d.cond[safeYear])}% there) — your breathe-easy point. Meanwhile ${Math.round(d.seqShare)}% of the failure risk comes purely from the order of returns.`;
  else el("seq-summary").innerHTML = `Even holding at or above your retirement balance, success doesn't reach ${target}% before age ${d.ca + d.h} — the plan stays return-sensitive throughout.${isNaN(d.seqShare) ? "" : " " + Math.round(d.seqShare) + "% of failures trace to return order."}`;
  const p = readParams();
  el("seq-note").innerHTML = p.blockLen > 1 ? `Using ${p.blockLen}-year blocks — clustered downturns are included.` : `Tip: sequence risk is about clustered downturns. Switch <b>Return sampling</b> to Blocks (in Nerd stuff) for realistic recession clustering.`;
}

function drawSeqChart(d, target, safeYear) {
  const svg = el("seq-chart"); svg.innerHTML = "";
  const W = 760, H = 300, m = { t: 16, r: 18, b: 40, l: 46 }, iw = W - m.l - m.r, ih = H - m.t - m.b;
  const A = d.A, T = d.h, ca = d.ca, span = Math.max(1, T - A);
  const xOf = y => m.l + (y - A) / span * iw, yOf = v => m.t + ih - (v / 100) * ih;
  const g = svgEl("g", { class: "grid" }); svg.appendChild(g);
  const ax = svgEl("g", { class: "axis" }); svg.appendChild(ax);
  for (let i = 0; i <= 5; i++) { const yv = i * 20, yy = yOf(yv); g.appendChild(svgEl("line", { x1: m.l, y1: yy, x2: W - m.r, y2: yy })); const t = svgEl("text", { x: m.l - 8, y: yy + 3.5, "text-anchor": "end" }); t.textContent = yv + "%"; ax.appendChild(t); }
  const xstep = span <= 35 ? 5 : 10;
  for (let y = A; y <= T; y += xstep) { const t = svgEl("text", { x: xOf(y), y: H - m.b + 16, "text-anchor": "middle" }); t.textContent = ca + y; ax.appendChild(t); }
  svg.appendChild(svgEl("line", { x1: m.l, x2: W - m.r, y1: yOf(target), y2: yOf(target), stroke: "var(--good)", "stroke-width": 1, "stroke-dasharray": "3 3", opacity: .7 }));
  const tl = svgEl("text", { class: "axis-title", x: W - m.r, y: yOf(target) - 4, "text-anchor": "end" }); tl.setAttribute("fill", "var(--good)"); tl.textContent = target + "% target"; svg.appendChild(tl);
  let dp = "", started = false;
  for (let N = A; N <= T; N++) { const v = d.cond[N]; if (isNaN(v)) { started = false; continue; } dp += (started ? "L" : "M") + xOf(N) + "," + yOf(v); started = true; }
  svg.appendChild(svgEl("path", { d: dp, fill: "none", stroke: "var(--brand)", "stroke-width": 2.4, "stroke-linejoin": "round" }));
  if (safeYear != null) {
    const cx = xOf(safeYear);
    svg.appendChild(svgEl("line", { x1: cx, x2: cx, y1: m.t, y2: m.t + ih, stroke: "var(--ink)", "stroke-width": 1.2, "stroke-dasharray": "4 3", opacity: .55 }));
    svg.appendChild(svgEl("circle", { cx, cy: yOf(d.cond[safeYear]), r: 5, fill: "var(--ink)", stroke: "var(--surface)", "stroke-width": 2 }));
    const lbl = svgEl("text", { x: cx + (cx > W / 2 ? -8 : 8), y: m.t + 8, "text-anchor": cx > W / 2 ? "end" : "start", class: "axis-title" }); lbl.setAttribute("font-weight", "600"); lbl.textContent = "safe from age " + (ca + safeYear); svg.appendChild(lbl);
  }
  const yt = svgEl("text", { class: "axis-title", transform: `translate(13,${m.t + ih / 2}) rotate(-90)`, "text-anchor": "middle" }); yt.textContent = "Success if on track"; svg.appendChild(yt);
  const xt = svgEl("text", { class: "axis-title", x: m.l + iw / 2, y: H - 4, "text-anchor": "middle" }); xt.textContent = "Age (still at or above your retirement balance)"; svg.appendChild(xt);
  const dot = svgEl("circle", { r: 4, fill: "var(--brand)", stroke: "var(--surface)", "stroke-width": 1.5, opacity: 0 }); svg.appendChild(dot);
  const rect = svgEl("rect", { x: m.l, y: m.t, width: iw, height: ih, fill: "transparent" }); svg.appendChild(rect);
  seqChartState = { svg, W, m, iw, ih, A, T, span, ca, xOf, yOf, d, dot, rect }; attachSeqHover();
}

function attachSeqHover() {
  const st = seqChartState, tt = tooltip();
  st.rect.addEventListener("mousemove", ev => {
    const box = st.svg.getBoundingClientRect(), sx = (ev.clientX - box.left) / box.width * st.W;
    let N = st.A + Math.round((sx - st.m.l) / st.iw * st.span); N = Math.max(st.A, Math.min(st.T, N));
    const v = st.d.cond[N];
    if (isNaN(v)) { st.dot.setAttribute("opacity", 0); tt.style.opacity = 0; return; }
    st.dot.setAttribute("cx", st.xOf(N)); st.dot.setAttribute("cy", st.yOf(v)); st.dot.setAttribute("opacity", 1);
    tt.style.opacity = 1;
    tt.innerHTML = `<div class="tt-t">Age ${st.ca + N}</div>Success if on track <b>${v.toFixed(1)}%</b><br>${st.d.onFrac[N].toFixed(0)}% of paths on track`;
    placeTooltip(tt, ev);
  });
  st.rect.addEventListener("mouseleave", () => { st.dot.setAttribute("opacity", 0); tt.style.opacity = 0; });
}
