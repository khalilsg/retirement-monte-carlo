// The step-up ladder: for each lifestyle tier, the age you could stop at (or the
// spending you could afford), at a fixed target success probability, drawn as a
// dumbbell — one dot per comparison scenario, joined by the gap between them.
//
// Tiers can be anchored either way, and an age and a dollar figure cannot share an
// axis, so the chart is up to two stacked panels: spend-anchored tiers (solved for
// age) over an age axis, age-anchored tiers (solved for spend) over a money axis.
// Either panel is omitted when nothing is anchored that way.
import { el } from "../dom.js";
import { escapeHtml, fmtMoney, fmtFull } from "../format.js";
import { svgEl, tooltip, placeTooltip, attachReadout, textScale } from "./svg.js";
import { renderTable, describeChart } from "./table.js";
import { readParams, currentSims } from "../ui/controls.js";
import { solveLadder } from "../engine/ladder.js";

// One colour per comparison scenario, in the order they're defined. The first two
// are the tornado chart's pair, so a two-scenario ladder reads as the same family.
// Four is the cap: past that the dumbbells stop being readable as pairs, and the
// solve count starts to rival a full heatmap.
export const SCEN_COLORS = ["var(--brand)", "var(--warn)", "var(--good)", "var(--muted)"];
export const MAX_ACTIVE = SCEN_COLORS.length;

// A cell's figure, in words when there is no figure to give. The two no-crossing
// cases mean opposite things in the two directions, so each gets its own wording
// rather than a shared "out of range" that would read as a failure in both.
export function cellText(c, full) {
  const money = v => (full ? fmtFull : fmtMoney)(v, true);
  if (c.solvedFor === "age") {
    if (c.status === "solved") return String(c.value);
    return c.status === "all" ? "already, at " + c.lo : "not by " + c.hi;
  }
  if (c.status === "solved") return money(c.value);
  return c.status === "all" ? "over " + money(c.hi) : "not at any spend";
}

// The longer form, for the tooltip and the table caption — a bare "already" doesn't
// say what it's already clearing.
function cellWhy(c, target) {
  if (c.status === "solved") return "clears " + target + "% (" + c.success.toFixed(1) + "%)";
  if (c.solvedFor === "age") {
    return c.status === "all"
      ? "retiring today already clears " + target + "%"
      : "still short at " + c.hi + " — " + c.sHi.toFixed(1) + "%";
  }
  return c.status === "all"
    ? "the search cap is what's binding, not the plan"
    : "misses " + target + "% even spending nothing";
}

let ladderState = null;

// The tiers and scenarios are passed in rather than read from ui/ladder.js: that
// module draws this palette on its scenario swatches, and having the two import
// each other would leave whichever loaded second holding an uninitialized binding.
export function renderLadder(cfg, tiers, variants) {
  const svg = el("ladder"); svg.innerHTML = "";
  const p = readParams(), nSims = currentSims();
  const active = variants.filter(v => v.on).slice(0, MAX_ACTIVE);
  if (!tiers.length || !active.length) {
    renderLegend(active, false);
    const msg = !tiers.length ? "Add a tier to build the ladder." : "Switch on a scenario to compare.";
    empty(svg, msg);
    return;
  }
  const out = solveLadder(p, nSims, cfg, tiers, active);
  // A tier's anchor decides which panel it lands in: spend-anchored tiers were
  // solved for an age, age-anchored ones for a dollar figure.
  const panels = [
    { key: "age", title: "Earliest retirement age", rows: out.rows.filter(r => r.cells[0].solvedFor === "age") },
    { key: "spend", title: "Maximum annual spend", rows: out.rows.filter(r => r.cells[0].solvedFor === "spend") },
  ].filter(pn => pn.rows.length);
  renderLegend(active, draw(svg, panels, active, cfg));
  describeLadder(panels, active, cfg);
  buildLadderTable(panels, active, cfg);
}

function empty(svg, msg) {
  svg.setAttribute("viewBox", "0 0 760 120");
  const t = svgEl("text", { x: 380, y: 60, "text-anchor": "middle", class: "axis-title" });
  t.textContent = msg; svg.appendChild(t);
  describeChart("ladder", msg);
  renderTable("ladder-table", { caption: msg, cols: ["Tier"], rows: [] });
}

// The legend is markup rather than SVG so it reuses the fan chart's .legend styling
// and stays readable at any text size without competing for viewBox room.
function renderLegend(active, agreed) {
  const items = active.map((v, i) =>
    `<span class="li"><span class="swatch" style="background:${SCEN_COLORS[i]}"></span>${escapeHtml(v.label)}</span>`);
  if (agreed) items.push('<span class="li li-agree"><span class="swatch" style="background:var(--muted)"></span>scenarios agree</span>');
  el("ld-legend").innerHTML = items.join("");
}

function draw(svg, panels, active, cfg) {
  // Set by the row loop when two or more scenarios shared a marker.
  let agreed = false;
  // Row height and the tier-name gutter both hold text, so both scale with it, and
  // the viewBox height is derived — a taller row makes a taller chart rather than
  // crowding the one below it. Same scheme as the tornado chart.
  const k = textScale(), W = 760;
  // Both margins hold text, so both grow with it — but the viewBox does not, and at
  // phone text scale an uncapped 132k gutter plus a 78k value margin left barely a
  // third of the 760 for the dumbbells themselves. The caps are the widest a tier
  // name and a value label actually need at the largest text size.
  const m = { l: Math.min(132 * k, 236), r: Math.min(78 * k, 128) };
  // Dots and connectors are shapes, not glyphs, so they don't need the full text
  // scale — but at 1x on a phone they shrink to specks beside 19px labels.
  const sc = Math.min(k, 1.8);
  // Rows are tall enough to take a value label above a dot as well as beside it —
  // see label() for when that happens.
  const rowH = 36 * k, headH = 26 * k, axisH = 30 * k, gap = 18 * k, top = 10;
  const iw = W - m.l - m.r;
  let H = top;
  for (const pn of panels) { pn.y = H + headH; H += headH + pn.rows.length * rowH + axisH + gap; }
  H -= gap;
  svg.setAttribute("viewBox", "0 0 " + W + " " + Math.round(H));

  const hits = [];
  for (const pn of panels) {
    const [lo, hi] = domainOf(pn.rows, pn.key === "age");
    // Clamping is what keeps the two no-crossing cases on the chart: their markers
    // sit at a search bound, which the fitted domain usually excludes, so they pin
    // to the edge — which is exactly what a hollow dashed dot should mean.
    const xOf = v => m.l + (hi === lo ? 0 : (Math.max(lo, Math.min(hi, v)) - lo) / (hi - lo) * iw);
    pn.xOf = xOf; pn.lo = lo; pn.hi = hi; pn.rowH = rowH;

    const ttl = svgEl("text", { class: "axis-title", x: 0, y: pn.y - 8 * k });
    ttl.setAttribute("font-weight", "600");
    ttl.textContent = pn.title + " at " + cfg.target + "% success";
    svg.appendChild(ttl);

    const bottom = pn.y + pn.rows.length * rowH;
    const g = svgEl("g", { class: "grid" }); svg.appendChild(g);
    const ax = svgEl("g", { class: "axis" }); svg.appendChild(ax);
    const nx = k > 1.5 ? 3 : k > 1 ? 4 : 6;
    for (const v of ticks(lo, hi, nx, pn.key === "age")) {
      const x = xOf(v);
      g.appendChild(svgEl("line", { x1: x, y1: pn.y, x2: x, y2: bottom }));
      const t = svgEl("text", { x, y: bottom + 16 * k, "text-anchor": "middle" });
      t.textContent = pn.key === "age" ? String(v) : fmtMoney(v, true);
      ax.appendChild(t);
    }

    pn.rows.forEach((row, j) => {
      const cy = pn.y + j * rowH + rowH / 2;
      const nm = svgEl("text", { x: m.l - 10 * k, y: cy + 3.5 * k, "text-anchor": "end", class: "ld-name" });
      nm.textContent = row.tier.label; svg.appendChild(nm);
      const xs = row.cells.map(c => xOf(c.value));
      const x0 = Math.min(...xs), x1 = Math.max(...xs);
      // The connector is the finding: how far the scenarios' answers sit apart.
      if (x1 - x0 > 1) svg.appendChild(svgEl("line", { x1: x0, y1: cy, x2: x1, y2: cy, stroke: "var(--edge)", "stroke-width": 3 * sc, "stroke-linecap": "round" }));
      // Scenarios that reach the same answer land on the same pixel, and the last
      // one drawn hides the rest — which, now that a legend names the colours, reads
      // as "only the green one is already achievable" when in fact they all agree.
      // Nesting them as rings turns a stack of dashed markers into speckle, so a
      // stack is drawn once instead, in neutral grey, with a legend entry saying
      // what grey means. The tooltip and the table still name every scenario.
      const stack = {};
      for (const x of xs) { const key = Math.round(x); stack[key] = (stack[key] || 0) + 1; }
      const drawn = {};
      row.cells.forEach((c, i) => {
        const key = Math.round(xs[i]), shared = stack[key] > 1;
        if (shared && drawn[key]) return;
        drawn[key] = true;
        if (shared) agreed = true;
        // A stack counts as solved only if every scenario in it actually crossed.
        const solved = shared
          ? row.cells.every((o, j) => Math.round(xs[j]) !== key || o.status === "solved")
          : c.status === "solved";
        const col = shared ? "var(--muted)" : SCEN_COLORS[i];
        // A hollow marker for the two no-crossing cases: it sits at the boundary
        // that was probed, and reads as "the answer is past here", not as a figure.
        svg.appendChild(svgEl("circle", {
          cx: xs[i], cy, r: 6 * sc, fill: solved ? col : "var(--surface)",
          stroke: solved ? "var(--surface)" : col, "stroke-width": (solved ? 2 : 2.2) * sc,
          "stroke-dasharray": solved ? "" : 3 * sc + " " + 2 * sc,
        }));
      });
      // Values at the two ends, the way the tornado chart labels its bars — which
      // degrades sensibly at three or four dots, where inline labels would collide.
      // A dot pinned to an edge has no room outside it, and "already at 65" drawn
      // leftwards from the left edge lands straight on top of the tier's name, so
      // each label flips to the inside when the margin can't hold it.
      const iL = xs.indexOf(x0), iR = xs.indexOf(x1);
      label(svg, row.cells[iL], x0, cy, k, sc, "left", m, W);
      if (iR !== iL) label(svg, row.cells[iR], x1, cy, k, sc, "right", m, W);
    });
    hits.push({ pn, top: pn.y, bottom });
  }
  const rect = svgEl("rect", { x: 0, y: 0, width: W, height: H, fill: "transparent" }); svg.appendChild(rect);
  ladderState = { svg, W, H, hits, active, cfg, rect }; attachLadderHover();
  return agreed;
}

// How much of the axis a panel actually shows.
//
// The search bounds are the obvious domain and the wrong one. Someone retiring in
// their thirties and planning through 110 searches seventy-eight years to answer
// within about twelve of them, and every rung lands in the first sixth of the axis
// — five dots in a heap against the left edge. So the domain fits the answers
// instead, padded a little, and never wider than what was actually searched. The
// hint under the controls still states the full search range in words.
function domainOf(rows, whole) {
  const bounds = rows[0].cells[0];
  let lo = Infinity, hi = -Infinity;
  for (const r of rows) for (const c of r.cells) if (c.status === "solved") {
    if (c.value < lo) lo = c.value;
    if (c.value > hi) hi = c.value;
  }
  // Nothing crossed anywhere in this panel, so there are no answers to fit to —
  // fall back to the range that was searched, which is the finding in that case.
  if (lo > hi) return [bounds.lo, bounds.hi];
  // Enough padding that a dot never sits on the axis line, and that a panel whose
  // answers all agree still gets a sane span rather than a zero-width one.
  const pad = Math.max((hi - lo) * 0.12, (bounds.hi - bounds.lo) * 0.02, whole ? 1 : 1000);
  const a = Math.max(bounds.lo, whole ? Math.floor(lo - pad) : lo - pad);
  const b = Math.min(bounds.hi, whole ? Math.ceil(hi + pad) : hi + pad);
  return b > a ? [a, b] : [bounds.lo, bounds.hi];
}

// Even divisions of an age range give ticks like 65, 70, 75, 80, 84, 89, 94 — the
// axis stops looking like ages partway along. Ages therefore step by a round number
// of years instead; the money axis is already rounded by fmtMoney, so it divides
// evenly and keeps both ends of the range on the axis.
function ticks(lo, hi, n, whole) {
  if (!whole) return Array.from({ length: n + 1 }, (_, i) => lo + (hi - lo) * i / n);
  const raw = (hi - lo) / n;
  const step = [1, 2, 5, 10, 20, 50].find(v => v >= raw) || Math.ceil(raw / 10) * 10;
  // Both ends of the range always get a tick — they're the search bounds, and an
  // axis that stops short implies the search did. Stepped ticks land between them,
  // dropping any that would crowd an endpoint.
  const out = [lo];
  for (let v = Math.ceil((lo + step / 2) / step) * step; v < hi - step / 2; v += step) out.push(v);
  out.push(hi);
  return out;
}

// SVG has no cheap way to measure text before it is laid out, so the flip decision
// runs on an estimate: the value font is monospaced, at roughly 0.58em per glyph.
const GLYPH = 5.6;

function label(svg, cell, x, cy, k, sc, side, m, W) {
  const text = cellText(cell, false), w = text.length * GLYPH * k, pad = 6 * sc + 5 * k;
  // Beside the dot, pointing outward, whenever the margin on that side can hold it.
  const fits = side === "left" ? x - pad - w > m.l - 2 : x + pad + w < W - 2;
  // When it can't — a dot pinned to an edge, which is exactly where the wordy
  // "already, at 55" cases sit — the label goes above the dot rather than flipping
  // inward, where on a tight pair it would be drawn straight through the connector
  // and the other scenario's dot.
  const attrs = fits
    ? { x: side === "left" ? x - pad : x + pad, y: cy + 3.5 * k, "text-anchor": side === "left" ? "end" : "start" }
    : { x: Math.max(w / 2, Math.min(W - w / 2, x)), y: cy - pad, "text-anchor": "middle" };
  const t = svgEl("text", Object.assign({ class: "ld-val" }, attrs));
  t.textContent = text;
  svg.appendChild(t);
}

function attachLadderHover() {
  const st = ladderState, tt = tooltip();
  attachReadout(st.rect, {
    show: ev => {
      const box = st.svg.getBoundingClientRect(), sy = (ev.clientY - box.top) / box.height * st.H;
      const hit = st.hits.find(h => sy >= h.top && sy < h.bottom);
      if (!hit) { tt.style.opacity = 0; return; }
      const j = Math.floor((sy - hit.top) / hit.pn.rowH), row = hit.pn.rows[j];
      if (!row) { tt.style.opacity = 0; return; }
      const anchored = row.tier.anchor === "age"
        ? "retiring at " + row.tier.age
        : "spending " + fmtMoney(row.tier.spend, true) + "/yr";
      tt.style.opacity = 1;
      tt.innerHTML = `<div class="tt-t">${escapeHtml(row.tier.label)} — ${escapeHtml(anchored)}</div>` +
        row.cells.map((c, i) =>
          `<span style="color:${SCEN_COLORS[i]}">■</span> ${escapeHtml(st.active[i].label)}: ` +
          `<b>${escapeHtml(cellText(c, false))}</b><br><span style="opacity:.7">${escapeHtml(cellWhy(c, st.cfg.target))}</span>`
        ).join("<br>");
      placeTooltip(tt, ev);
    },
    hide: () => { tt.style.opacity = 0; },
  });
}

// The gap between two scenarios is the reason the chart is a dumbbell, so it gets
// its own column — but only where both ends are real figures to subtract.
function gapText(row, panelKey) {
  if (row.cells.length !== 2) return "";
  const [a, b] = row.cells;
  if (a.status !== "solved" || b.status !== "solved") return "—";
  const d = b.value - a.value;
  if (d === 0) return "no change";
  const sign = d > 0 ? "+" : "−", mag = Math.abs(d);
  return panelKey === "age"
    ? sign + mag + (mag === 1 ? " yr" : " yrs")
    : sign + fmtFull(mag, true);
}

function buildLadderTable(panels, active, cfg) {
  const rows = [];
  for (const pn of panels) for (const row of pn.rows) {
    const held = row.tier.anchor === "age" ? "age " + row.tier.age : fmtFull(row.tier.spend, true) + "/yr";
    rows.push([row.tier.label, held, pn.key === "age" ? "Earliest age" : "Max spend"]
      .concat(row.cells.map(c => cellText(c, true)))
      .concat(active.length === 2 ? [gapText(row, pn.key)] : []));
  }
  renderTable("ladder-table", {
    caption: `For each tier, the earliest retirement age or highest annual spend that still clears ${cfg.target}% success, ` +
      `under each scenario. "Already" means the target is met from the first age searched; "not by"/"not at any spend" ` +
      `means no value in range meets it.`,
    cols: ["Tier", "Held fixed", "Solved for"].concat(active.map(v => v.label)).concat(active.length === 2 ? ["Gap"] : []),
    rows,
  });
}

// The finding is the spread between scenarios, and it's encoded purely in dot
// position — so the label leads with the widest gap rather than naming the genre.
function describeLadder(panels, active, cfg) {
  const n = panels.reduce((a, pn) => a + pn.rows.length, 0);
  let lead = "";
  if (active.length === 2) {
    let best = null;
    for (const pn of panels) for (const row of pn.rows) {
      const [a, b] = row.cells;
      if (a.status !== "solved" || b.status !== "solved") continue;
      const d = Math.abs(b.value - a.value);
      if (!best || d > best.d) best = { d, row, pn };
    }
    lead = best
      ? `The widest gap between "${active[0].label}" and "${active[1].label}" is at the ${best.row.tier.label} tier, ` +
        `at ${gapText(best.row, best.pn.key).replace(/^[+−]/, "")}. `
      : "No tier has a figure under both scenarios. ";
  }
  describeChart("ladder", `Step-up ladder: ${n} lifestyle ${n === 1 ? "tier" : "tiers"} across ${active.length} ` +
    `${active.length === 1 ? "scenario" : "scenarios"}, each solved to a ${cfg.target} percent success probability. ` +
    lead + `Full figures in the data table below.`);
}
