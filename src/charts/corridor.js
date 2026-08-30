// The glide corridor: one rung's required balance track, drawn over the balance you
// are actually projected to follow.
//
// Every other view here answers "how likely is this?" This one answers "am I above
// the line?", which is the same question in a form you can check once a year without
// re-running anything. The corridor line is the finding; the percentile bands behind
// it are what you check against.
//
// The two are drawn from one solve (engine/corridor.js) against one sampling matrix,
// so a gap between them is the plan rather than two different sets of dice.
import { el } from "../dom.js";
import { escapeHtml, fmtMoney, fmtFull, isPrivate } from "../format.js";
import { svgEl, tooltip, placeTooltip, attachReadout, textScale, heightScale } from "./svg.js";
import { renderTable, describeChart } from "./table.js";
import { readParams, currentSims } from "../ui/controls.js";
import { solveLadder } from "../engine/ladder.js";
import { solveCorridor, corridorCrossing } from "../engine/corridor.js";

// The band the crossing is reported against. Not the median: a rung is defined as
// the point where the plan hits its target, so the median clears the corridor
// essentially by construction and saying so is no news. The 10th percentile is where
// the reading has content — see the note on corridorCrossing.
const WATCH = "p10";

let corridorState = null;

// `which` is the index of the tier to draw, or -1 for none. One at a time: a
// corridor is a bisection per age, which on a long runway is more work than the
// whole ladder, and four of them overlaid would be unreadable anyway.
export function renderCorridor(cfg, tiers, variants, which) {
  const svg = el("corridor");
  const active = variants.filter(v => v.on);
  // The card stays on the page even with nothing picked, because the picker lives in
  // it: hiding the card would hide the only control that un-hides it. Empty state is
  // a word in the frame instead, which is also how the ladder handles having nothing
  // to draw.
  if (which < 0) { empty(svg, "Pick a tier above to draw its corridor."); return; }

  const p = readParams(), nSims = currentSims();
  const tier = tiers[which];
  if (!tier || !active.length) { empty(svg, "Pick a tier to draw its corridor."); return; }

  // Solved against the first active scenario. The corridor is a single-rung, single-
  // assumption view by design — the ladder above is where scenarios are compared, and
  // stacking four corridors would bury the one line the chart is about.
  const variant = active[0];
  const out = solveLadder(p, nSims, cfg, [tier], [variant]);
  const cell = out.rows[0].cells[0];
  const c = solveCorridor(p, nSims, cfg, tier, variant, cell);
  if (!c) {
    // The ladder's three outcomes reach all the way here: a rung with no crossing has
    // no date to march toward, so there is no corridor to draw rather than an empty
    // one. Saying which case it is beats a blank panel.
    empty(svg, cell.status === "solved"
      ? "That rung's date is less than two years out — too short a run to draw a corridor."
      : "That rung has no crossing to march toward, so there's no corridor to draw.");
    return;
  }
  draw(svg, c, tier, variant, cfg);
}

function empty(svg, msg) {
  svg.innerHTML = "";
  svg.setAttribute("viewBox", "0 0 760 100");
  const t = svgEl("text", { x: 380, y: 52, "text-anchor": "middle", class: "axis-title" });
  t.textContent = msg; svg.appendChild(t);
  el("corridor-legend").innerHTML = "";
  el("corridor-note").textContent = "";
  describeChart("corridor", msg);
  renderTable("corridor-table", { caption: msg, cols: ["Age"], rows: [] });
  corridorState = null;
}

function draw(svg, c, tier, variant, cfg) {
  svg.innerHTML = "";
  const k = textScale(), W = 760, H = Math.round(320 * heightScale());
  svg.setAttribute("viewBox", "0 0 " + W + " " + H);
  const m = { t: 16, r: (k > 1 ? 26 : 16) * k, b: 34 * k, l: 62 * k };
  const iw = W - m.l - m.r, ih = H - m.t - m.b;
  const a0 = c.bands.ages[0], a1 = c.bands.ages[c.bands.ages.length - 1];
  // The corridor can run above the 90th percentile on a rung the plan is behind on,
  // so the scale has to take both series or the line leaves the chart.
  const solved = c.points.filter(o => o.status === "solved").map(o => o.value);
  const [ymin, ymax] = yRange(c, solved);
  const xOf = a => m.l + (a1 === a0 ? 0 : (a - a0) / (a1 - a0) * iw);
  const yOf = v => m.t + ih - (Math.min(Math.max(v, ymin), ymax) - ymin) / (ymax - ymin) * ih;

  const g = svgEl("g", { class: "grid" }); svg.appendChild(g);
  const ax = svgEl("g", { class: "axis" }); svg.appendChild(ax);
  for (let i = 0; i <= 5; i++) {
    const v = ymin + ((ymax - ymin) / 5) * i, yy = yOf(v);
    g.appendChild(svgEl("line", { x1: m.l, y1: yy, x2: W - m.r, y2: yy }));
    const t = svgEl("text", { x: m.l - 8 * k, y: yy + 3.5 * k, "text-anchor": "end" });
    t.textContent = fmtMoney(v); ax.appendChild(t);
  }
  const span = a1 - a0, xstep = Math.max(1, Math.ceil(span / (k > 1.5 ? 4 : 8)));
  for (let a = a0; a <= a1; a += xstep) {
    const t = svgEl("text", { x: xOf(a), y: H - m.b + 16 * k, "text-anchor": "middle" });
    t.textContent = String(a); ax.appendChild(t);
  }

  // Bands first: they are the context, the corridor is the claim.
  const band = (top, bot) => {
    let d = "M" + xOf(c.bands.ages[0]) + "," + yOf(top[0]);
    for (let i = 1; i < c.bands.ages.length; i++) d += "L" + xOf(c.bands.ages[i]) + "," + yOf(top[i]);
    for (let i = c.bands.ages.length - 1; i >= 0; i--) d += "L" + xOf(c.bands.ages[i]) + "," + yOf(bot[i]);
    return d + "Z";
  };
  svg.appendChild(svgEl("path", { d: band(c.bands.p90, c.bands.p10), fill: "var(--band-outer)", opacity: .75 }));
  svg.appendChild(svgEl("path", { d: band(c.bands.p75, c.bands.p25), fill: "var(--band-mid)", opacity: .8 }));
  const line = (xs, ys, attrs) => {
    let d = "M" + xOf(xs[0]) + "," + yOf(ys[0]);
    for (let i = 1; i < xs.length; i++) d += "L" + xOf(xs[i]) + "," + yOf(ys[i]);
    svg.appendChild(svgEl("path", Object.assign({ d, fill: "none", "stroke-linejoin": "round" }, attrs)));
  };
  line(c.bands.ages, c.bands.p50, { stroke: "var(--band-line)", "stroke-width": 2.2 });

  // The corridor itself, over the top and in the warning colour: it is a threshold,
  // not another projection, and drawing it in the band palette would read as a sixth
  // percentile. Points that found no crossing are left out of the path rather than
  // pinned to a bound, which would bend the line toward a figure nobody solved.
  const pts = c.points.filter(o => o.status !== "none");
  if (pts.length > 1) line(pts.map(o => o.age), pts.map(o => o.value),
    { stroke: "var(--warn)", "stroke-width": 2.6, "stroke-dasharray": "6 3" });
  for (const o of pts) svg.appendChild(svgEl("circle", {
    cx: xOf(o.age), cy: yOf(o.value), r: 3 * Math.min(k, 1.8),
    fill: "var(--warn)", stroke: "var(--surface)", "stroke-width": 1.4,
  }));

  const xt = svgEl("text", { class: "axis-title", x: m.l + iw / 2, y: H - 3 * k, "text-anchor": "middle" });
  xt.textContent = "Age"; svg.appendChild(xt);
  const yt = svgEl("text", { class: "axis-title", transform: `translate(${14 * k},${m.t + ih / 2}) rotate(-90)`, "text-anchor": "middle" });
  // A truncated baseline is stated on the axis, not left to be noticed. It is the
  // right scale here — the whole reading is the gap between two lines that sit close
  // together, and a zero-based axis flattens that gap to nothing — but a balance
  // chart that silently starts partway up is exactly how a small difference gets sold
  // as a large one, so the label says where it starts.
  yt.textContent = (isPrivate() ? "Balance (× today's" : "Balance (today's $")
    + (ymin > 0 ? ", from " + fmtMoney(ymin) : "") + ")";
  svg.appendChild(yt);

  const hoverLine = svgEl("line", { y1: m.t, y2: m.t + ih, stroke: "var(--ink)", "stroke-width": 1, "stroke-dasharray": "3 3", opacity: 0 });
  svg.appendChild(hoverLine);
  const rect = svgEl("rect", { x: m.l, y: m.t, width: iw, height: ih, fill: "transparent" });
  svg.appendChild(rect);
  corridorState = { svg, W, m, iw, c, xOf, hoverLine, rect, a0, a1 };
  attachCorridorHover();

  renderLegend();
  note(c, tier, variant, cfg);
  describeCorridor(c, tier, cfg);
  buildTable(c, tier, cfg);
}

// The vertical range, and its tick step.
//
// Fitted to the two series rather than anchored at zero: the reading is how much room
// there is between your projection and the line, and on a plan with a balance already
// both sit in the top of a zero-based axis with the gap squeezed to a few pixels.
//
// niceMax() is deliberately not used here. It rounds a maximum up to the next 1 / 2 /
// 2.5 / 5 / 10, which turns $5.1M into $10M and hands half the chart to empty space —
// tolerable on the fan chart, which is about a shape, and not here, where the whole
// point is the distance between two lines. This picks the tick step first and snaps
// both ends onto it, so the axis is round without being twice the size of its data.
//
// Anchored at zero anyway when the floor lands near it, so a plan starting from
// nothing isn't given a baseline it never had, and so the truncation only happens
// where it actually buys legibility.
function yRange(c, solved) {
  const lo = Math.min(...c.bands.p10, ...(solved.length ? solved : [Infinity]));
  const hi = Math.max(...c.bands.p90, ...(solved.length ? solved : [0]));
  const span = (hi - lo) || hi || 1;
  const raw = span / 5, mag = Math.pow(10, Math.floor(Math.log10(raw))), n = raw / mag;
  const step = (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * mag;
  const top = Math.ceil(hi / step) * step;
  const floor = Math.floor(lo / step) * step;
  return [floor < top * 0.15 ? 0 : Math.max(0, floor), top];
}

function renderLegend() {
  el("corridor-legend").innerHTML =
    '<span class="li"><span class="swatch" style="background:var(--warn)"></span>balance needed to hold the tier</span>' +
    '<span class="li"><span class="swatch" style="background:var(--band-line)"></span>your projected balance (median)</span>' +
    '<span class="li"><span class="swatch" style="background:var(--band-outer)"></span>10th–90th percentile</span>';
}

// The sentence under the chart, which is where the reading actually lands for anyone
// not inclined to interpret two lines. It names what is held fixed — a corridor is
// meaningless without knowing which spend and which date it is a corridor *for*.
function note(c, tier, variant, cfg) {
  const held = `Holding ${fmtMoney(c.spend, true)}/yr and retiring at ${c.date}, ` +
    `at ${cfg.target}% success, under "${variant.label}".`;
  const x = corridorCrossing(c, WATCH);
  let read;
  if (!x) read = "";
  else if (x.status === "above") read = " Even a 10th-percentile run stays above the line the whole way.";
  else if (x.status === "below") read = " A 10th-percentile run is already below the line today — this rung is not on track in a bad case.";
  else read = ` A 10th-percentile run stays above the line through age ${x.age}, and falls behind after that.`;
  el("corridor-note").textContent = held + read;
}

function describeCorridor(c, tier, cfg) {
  const last = c.points[c.points.length - 1];
  const x = corridorCrossing(c, WATCH);
  const tail = !x ? ""
    : x.status === "above" ? "The 10th percentile stays above the line throughout. "
    : x.status === "below" ? "The 10th percentile is below the line from the start. "
    : `The 10th percentile stays above the line through age ${x.age}. `;
  describeChart("corridor", `Glide corridor for the ${tier.label} tier: the balance needed at each age from ` +
    `${c.bands.ages[0]} to ${c.date} to hold ${fmtMoney(c.spend, true)} a year at ${cfg.target} percent success, ` +
    `drawn over the balance the plan is projected to reach. ` +
    (last.status === "solved" ? `By ${c.date} the line reaches ${fmtMoney(last.value)}. ` : "") +
    tail + `Full figures in the data table below.`);
}

function buildTable(c, tier, cfg) {
  const need = a => {
    const o = c.points.find(q => q.age === a);
    if (!o) return "";
    // The two no-crossing cases again, in words: "0" would read as "you need nothing"
    // in one case and as an answer in the other, and only one of those is true.
    if (o.status === "all") return "any balance";
    if (o.status === "none") return "no balance in range";
    return fmtFull(o.value);
  };
  renderTable("corridor-table", {
    caption: `The balance needed at each age to hold ${fmtFull(c.spend, true)}/yr from age ${c.date} at ` +
      `${cfg.target}% success, beside the balance the plan is projected to reach. The corridor assumes the plan ` +
      `keeps running — contributions continue to the date — so it reads "am I on track?", not "could I coast ` +
      `from here?". "Any balance" means contributions and income carry the tier on their own from that age. ` +
      `The chart's vertical axis is fitted to these figures rather than anchored at zero, so that the gap between ` +
      `the two is readable; the numbers here are the unscaled ones.`,
    cols: ["Age", "Balance needed", "10th", "Median", "90th"],
    rows: c.points.map(o => {
      const i = c.bands.ages.indexOf(o.age);
      return [o.age, need(o.age), fmtMoney(c.bands.p10[i]), fmtMoney(c.bands.p50[i]), fmtMoney(c.bands.p90[i])];
    }),
  });
}

function attachCorridorHover() {
  const st = corridorState, tt = tooltip();
  attachReadout(st.rect, {
    show: ev => {
      const box = st.svg.getBoundingClientRect(), sx = (ev.clientX - box.left) / box.width * st.W;
      let a = Math.round(st.a0 + (sx - st.m.l) / st.iw * (st.a1 - st.a0));
      a = Math.max(st.a0, Math.min(st.a1, a));
      const i = st.c.bands.ages.indexOf(a);
      if (i < 0) { tt.style.opacity = 0; return; }
      const xx = st.xOf(a);
      st.hoverLine.setAttribute("x1", xx); st.hoverLine.setAttribute("x2", xx); st.hoverLine.setAttribute("opacity", 1);
      const o = st.c.points.find(q => q.age === a);
      const needTxt = !o ? "—" : o.status === "all" ? "any balance"
        : o.status === "none" ? "no balance in range" : fmtMoney(o.value);
      tt.style.opacity = 1;
      tt.innerHTML = `<div class="tt-t">Age ${a}</div>` +
        `<span style="color:var(--warn)">■</span> needed <b>${escapeHtml(needTxt)}</b><br>` +
        `Median <b>${fmtMoney(st.c.bands.p50[i])}</b><br>10th <b>${fmtMoney(st.c.bands.p10[i])}</b>`;
      placeTooltip(tt, ev);
    },
    hide: () => { st.hoverLine.setAttribute("opacity", 0); tt.style.opacity = 0; },
  });
}
