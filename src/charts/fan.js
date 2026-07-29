// Balance-over-time fan chart: percentile bands (10–90 / 25–75) and the median line,
// with a retirement marker and a hover readout.
import { el } from "../dom.js";
import { fmtMoney } from "../format.js";
import { svgEl, niceMax, tooltip, placeTooltip } from "./svg.js";

let fanState = null;

export function renderFan(r) {
  const svg = el("fan"); svg.innerHTML = "";
  const W = 760, H = 380, m = { t: 14, r: 16, b: 34, l: 62 };
  const iw = W - m.l - m.r, ih = H - m.t - m.b, h = r.h, ymax = niceMax(r.ymax);
  const xOf = y => m.l + (h === 0 ? 0 : (y / h) * iw), yOf = v => m.t + ih - (Math.min(v, ymax) / ymax) * ih;
  const g = svgEl("g", { class: "grid" }); svg.appendChild(g);
  const ax = svgEl("g", { class: "axis" }); svg.appendChild(ax);
  for (let i = 0; i <= 5; i++) { const v = (ymax / 5) * i, yy = yOf(v); g.appendChild(svgEl("line", { x1: m.l, y1: yy, x2: W - m.r, y2: yy })); const t = svgEl("text", { x: m.l - 8, y: yy + 3.5, "text-anchor": "end" }); t.textContent = fmtMoney(v); ax.appendChild(t); }
  const xstep = h <= 35 ? 5 : 10;
  for (let y = 0; y <= h; y += xstep) { const t = svgEl("text", { x: xOf(y), y: H - m.b + 16, "text-anchor": "middle" }); t.textContent = r.ca + y; ax.appendChild(t); }
  const band = (top, bot) => { let d = "M" + xOf(0) + "," + yOf(top[0]); for (let y = 1; y <= h; y++) d += "L" + xOf(y) + "," + yOf(top[y]); for (let y = h; y >= 0; y--) d += "L" + xOf(y) + "," + yOf(bot[y]); return d + "Z"; };
  svg.appendChild(svgEl("path", { d: band(r.pcts.p90, r.pcts.p10), fill: "var(--band-outer)", opacity: .75 }));
  svg.appendChild(svgEl("path", { d: band(r.pcts.p75, r.pcts.p25), fill: "var(--band-mid)", opacity: .8 }));
  let md = "M" + xOf(0) + "," + yOf(r.pcts.p50[0]); for (let y = 1; y <= h; y++) md += "L" + xOf(y) + "," + yOf(r.pcts.p50[y]);
  svg.appendChild(svgEl("path", { d: md, fill: "none", stroke: "var(--band-line)", "stroke-width": 2.2, "stroke-linejoin": "round" }));
  if (r.A > 0) { const rx = xOf(r.A); svg.appendChild(svgEl("line", { x1: rx, x2: rx, y1: m.t, y2: m.t + ih, stroke: "var(--ink)", "stroke-width": 1.2, "stroke-dasharray": "4 3", opacity: .5 })); const rl = svgEl("text", { x: rx + 4, y: m.t + 10, class: "axis-title" }); rl.setAttribute("font-weight", "600"); rl.textContent = "retires at " + r.retAge; svg.appendChild(rl); }
  const xt = svgEl("text", { class: "axis-title", x: m.l + iw / 2, y: H - 3, "text-anchor": "middle" }); xt.textContent = "Age"; svg.appendChild(xt);
  const at = svgEl("text", { class: "axis-title", transform: `translate(14,${m.t + ih / 2}) rotate(-90)`, "text-anchor": "middle" }); at.textContent = "Balance (today's $)"; svg.appendChild(at);
  const hoverLine = svgEl("line", { y1: m.t, y2: m.t + ih, stroke: "var(--ink)", "stroke-width": 1, "stroke-dasharray": "3 3", opacity: 0 }); svg.appendChild(hoverLine);
  const dot = svgEl("circle", { r: 3.5, fill: "var(--band-line)", stroke: "var(--surface)", "stroke-width": 1.5, opacity: 0 }); svg.appendChild(dot);
  const rect = svgEl("rect", { x: m.l, y: m.t, width: iw, height: ih, fill: "transparent" }); svg.appendChild(rect);
  fanState = { svg, W, m, iw, ih, h, xOf, yOf, r, hoverLine, dot, rect }; attachFanHover();
}

function attachFanHover() {
  const st = fanState, tt = tooltip();
  st.rect.addEventListener("mousemove", ev => {
    const box = st.svg.getBoundingClientRect(), sx = (ev.clientX - box.left) / box.width * st.W;
    let y = Math.round((sx - st.m.l) / st.iw * st.h); y = Math.max(0, Math.min(st.h, y));
    const xx = st.xOf(y);
    st.hoverLine.setAttribute("x1", xx); st.hoverLine.setAttribute("x2", xx); st.hoverLine.setAttribute("opacity", 1);
    st.dot.setAttribute("cx", xx); st.dot.setAttribute("cy", st.yOf(st.r.pcts.p50[y])); st.dot.setAttribute("opacity", 1);
    tt.style.opacity = 1;
    tt.innerHTML = `<div class="tt-t">Age ${st.r.ca + y}</div>90th <b>${fmtMoney(st.r.pcts.p90[y])}</b><br>Median <b>${fmtMoney(st.r.pcts.p50[y])}</b><br>10th <b>${fmtMoney(st.r.pcts.p10[y])}</b>`;
    placeTooltip(tt, ev);
  });
  st.rect.addEventListener("mouseleave", () => { st.hoverLine.setAttribute("opacity", 0); st.dot.setAttribute("opacity", 0); tt.style.opacity = 0; });
}
