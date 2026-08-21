// The conductor: turns control changes into recomputes, schedules cheap vs. heavy
// work while sliders move, and wires every event listener. `init()` boots the app.
import { el } from "../dom.js";
import { commafy, parseNum, isPrivate } from "../format.js";
import {
  syncLabels, readParams, currentSims, toggleModePanels, renderStreams, getStreams,
  buildSweepOptions, fillSweepRange, buildHeatOptions, fillHeatRange, initValueInputs,
} from "./controls.js";
import { renderOutcome } from "./outcome.js";
import { flushSummary } from "./announce.js";
import { renderFan } from "../charts/fan.js";
import { renderSequence, drawSequence } from "../charts/sequence.js";
import { renderTornado } from "../charts/tornado.js";
import { renderSweep } from "../charts/sweep.js";
import { renderHeat } from "../charts/heat.js";
import { renderLadder } from "../charts/ladder.js";
import { ensureIndex, buildIndex, reshuffleSeed } from "../engine/rng.js";
import { simFull } from "../engine/simulate.js";
import { loadInitial, initScenarios } from "./scenarios.js";
import { initLadder, ladderConfig, getTiers, getVariants, syncLadderSeed, syncLadderNote, renderLadderControls } from "./ladder.js";
import { initPrivacy, swapInputs } from "./privacy.js";
import { initFooter } from "./footer.js";

// Light path: the headline success number + balance fan. Cheap enough to run live
// while dragging a slider.
function recomputeLight() {
  syncLabels();
  const p = readParams(), nSims = currentSims();
  ensureIndex(nSims, p.blockLen);
  const r = simFull(p, nSims);
  el("run-note").textContent = nSims.toLocaleString("en-US") + " sims · " + (p.blockLen > 1 ? p.blockLen + "-yr blocks" : "iid") + " · 1928–2025";
  renderOutcome(r); renderFan(r);
}

// Heavy path: the sequence card, sensitivity sweep, tornado, heatmap, and step-up
// ladder — dozens/hundreds of extra simulation runs. This is also the settle point,
// so it's where the screen-reader summary is released: it runs once inputs stop,
// never on the per-frame path, which keeps the live region from being flooded
// mid-drag with figures that are obsolete before they finish being spoken.
function recomputeHeavy() { renderSequence(); renderTornado(); renderSweep(); renderHeat(); drawLadder(); flushSummary(); }

// The ladder bisects the simulation once per tier per active scenario — roughly 60
// runs at the seeded three-by-two, against the heatmap's 400 for a default grid, so
// it sits on the settle path with everything else. That ratio is a function of how
// many rungs and scenarios you define, though: a full twelve tiers against four
// scenarios is heatmap-scale on its own, and if the settle starts to drag this is
// the call to move behind a button.
function drawLadder() {
  syncLadderSeed();
  syncLadderNote();
  renderLadder(ladderConfig(), getTiers(), getVariants());
}

export function recompute() { recomputeLight(); recomputeHeavy(); }

// Trailing debounce: run `fn` once, `ms` after the last call. A trailing timeout is
// what actually waits for a pause in input — requestAnimationFrame only coalesces
// sub-frame bursts, so at human typing speed every keystroke still fires. The cancel
// handle lets a committing action (blur) pre-empt a pending run.
const HEAVY_MS = 150;   // defer heavy charts this long after a slider settles
const TYPING_MS = 200;  // wait this long after the last keystroke before simulating
function debounce(fn, ms) {
  let t = null;
  const g = () => { if (t) clearTimeout(t); t = setTimeout(() => { t = null; fn(); }, ms); };
  g.cancel = () => { if (t) { clearTimeout(t); t = null; } };
  return g;
}

// Sliders: update the cheap headline + fan every frame while dragging, deferring the
// heavy charts until the drag settles. Continuous motion makes the per-frame
// simulation worth it for the live feedback.
let liveRAF = null, heavyTimer = null, pending = null;
export function scheduleLive() {
  if (liveRAF) cancelAnimationFrame(liveRAF);
  liveRAF = requestAnimationFrame(() => { liveRAF = null; recomputeLight(); });
  if (heavyTimer) clearTimeout(heavyTimer);
  heavyTimer = setTimeout(() => { heavyTimer = null; recomputeHeavy(); }, HEAVY_MS);
}

// Text entry (money + income-stream fields): echo the value labels instantly — cheap,
// no simulation — but debounce the whole recompute so a full re-render (a 1,000-path
// simFull + chart rebuild) doesn't run on every character. commitTyping() runs it now,
// cancelling any pending debounce, when a field is committed on blur.
const debouncedRecompute = debounce(recompute, TYPING_MS);
export function scheduleTyping() { syncLabels(); debouncedRecompute(); }
export function commitTyping() { debouncedRecompute.cancel(); recompute(); }

// One-shot select changes can recompute on the next frame; the sweep and heatmap
// range inputs redraw only their own chart, debounced so multi-digit entry doesn't
// re-run it on every keystroke.
export function debounced() { if (pending) cancelAnimationFrame(pending); pending = requestAnimationFrame(recompute); }
const debouncedSweep = debounce(renderSweep, HEAVY_MS);
const debouncedHeat = debounce(renderHeat, HEAVY_MS);
const debouncedLadder = debounce(drawLadder, TYPING_MS);

function attachEvents() {
  const attachMoney = id => { const e = el(id); e.addEventListener("blur", () => { if (isPrivate()) return; e.value = commafy(parseNum(e.value)); commitTyping(); }); e.addEventListener("input", scheduleTyping); };
  ["start", "spend", "contrib"].forEach(attachMoney);
  ["stock", "fee", "tax", "g-band", "g-step", "g-floor", "g-ceiling", "glide-start", "glide-end", "block-len"].forEach(id => el(id).addEventListener("input", scheduleLive));
  ["cur-age", "ret-age", "end-age"].forEach(id => el(id).addEventListener("input", () => { toggleModePanels(); scheduleLive(); }));
  el("sims").addEventListener("change", debounced);
  ["spend-mode", "alloc-mode", "sample-mode"].forEach(id => el(id).addEventListener("change", () => { toggleModePanels(); buildSweepOptions(); fillSweepRange(); buildHeatOptions(); fillHeatRange("x"); fillHeatRange("y"); debounced(); }));
  el("hx-var").addEventListener("change", () => { fillHeatRange("x"); renderHeat(); });
  el("hy-var").addEventListener("change", () => { fillHeatRange("y"); renderHeat(); });
  el("heat-swap").addEventListener("click", () => {
    [["hx-var", "hy-var"], ["hx-from", "hy-from"], ["hx-to", "hy-to"], ["hx-steps", "hy-steps"]]
      .forEach(([a, b]) => swapInputs(el(a), el(b)));
    renderHeat();
  });
  ["hx-from", "hx-to", "hx-steps", "hy-from", "hy-to", "hy-steps", "h-target"].forEach(id => el(id).addEventListener("input", debouncedHeat));
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => renderHeat());
  new MutationObserver(() => renderHeat()).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  el("reshuffle").addEventListener("click", () => { reshuffleSeed(); buildIndex(currentSims(), readParams().blockLen); recompute(); });
  el("sweep-var").addEventListener("change", () => { fillSweepRange(); renderSweep(); });
  ["sweep-from", "sweep-to", "sweep-steps"].forEach(id => el(id).addEventListener("input", debouncedSweep));
  el("seq-target").addEventListener("input", () => { if (pending) cancelAnimationFrame(pending); pending = requestAnimationFrame(drawSequence); });
  el("add-stream").addEventListener("click", () => {
    const streams = getStreams();
    streams.push({ label: streams.length === 0 ? "Pension" : "Income " + (streams.length + 1), amount: 0, from: el("ret-age").value, to: "", cola: false, basis: "age" });
    // Focus the new stream's name field: it's the first thing you'd fill in, and
    // without this the rebuild drops focus to <body>.
    renderStreams({ sel: ".s-label", i: streams.length - 1 });
    buildSweepOptions(); buildHeatOptions(); recompute();
  });
  // The controls are a <form> so they expose a form landmark, which means Enter in
  // a text field would otherwise try to submit and reload the page, losing the plan.
  el("controls").addEventListener("submit", ev => ev.preventDefault());
}

// Boot: attach listeners, wire scenario controls, seed the dropdowns, and load the
// initial scenario (shared hash > saved default > built-in).
export function init() {
  initFooter();
  attachEvents();
  initValueInputs(scheduleLive);
  initScenarios();
  // Before loadInitial, so a shared code carrying a ladder has one to overwrite.
  initLadder(debouncedLadder);
  // Toggling privacy changes how every figure renders, including the income-stream
  // option labels, so the dropdowns are rebuilt alongside the recompute.
  initPrivacy(() => { buildSweepOptions(); buildHeatOptions(); renderLadderControls(); recompute(); });
  renderStreams();
  toggleModePanels();
  buildSweepOptions();
  fillSweepRange();
  buildHeatOptions();
  fillHeatRange("x");
  fillHeatRange("y");
  // A 20x20 surface is ~13px per cell on a phone — too fine to read, and far too
  // fine to tap. Start coarser there; the Columns/Rows inputs still say what's
  // being drawn, so this changes the default rather than overriding the control.
  if (window.innerWidth < 620) { el("hx-steps").value = "12"; el("hy-steps").value = "12"; }
  loadInitial();
}
