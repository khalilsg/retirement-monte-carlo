// The "hand this to Claude" buttons: gather everything the engine knows about the
// loaded plan, hand it to the serializer in config/prompt.js, and put the result on
// the clipboard.
//
// Two variants, and the difference is privacy rather than content. The dollars
// variant carries real amounts; the normalized one emits balances as multiples of
// the reference amount and flows as percentages of it, exactly as private mode
// renders the page. Nothing in the analysis needs absolute dollars — every ratio,
// probability and age survives normalization intact — so the normalized variant is
// not a degraded copy, it is the same reading with the scale withheld.
//
// The gathering re-runs the engine rather than reading whatever the last heavy
// recompute left behind. That path is debounced (see orchestrate.js), so a click
// landing shortly after a slider moves would otherwise serialize a headline from
// the new plan next to a ladder from the old one — a snapshot of two different
// plans, with nothing in the text to say so.
import { el } from "../dom.js";
import { isPrivate } from "../format.js";
import { readParams, currentSims } from "./controls.js";
import { ladderConfig, getTiers, getVariants } from "./ladder.js";
import { ensureIndex } from "../engine/rng.js";
import { simFull } from "../engine/simulate.js";
import { solveLadder } from "../engine/ladder.js";
import { solveArrivals } from "../engine/arrival.js";
import { solveCorridor, corridorCrossing } from "../engine/corridor.js";
import { tornadoData } from "../charts/tornado.js";
import { encodeScenario } from "../config/codec.js";
import { buildPrompt } from "../config/prompt.js";
import { VERSION } from "../version.js";
import { toast, copyText } from "./toast.js";

// Supplied by orchestrate.js at init. Reading the form is ui/scenarios.js's job, but
// importing it here would pull ui/prompt.js into the scenarios ⇄ orchestrate import
// cycle for the sake of one function, so it is passed in instead.
let readScenario = null;

function gather(normalized) {
  const p = readParams(), nSims = currentSims();
  ensureIndex(nSims, p.blockLen);
  const cfg = ladderConfig();
  const ladder = solveLadder(p, nSims, cfg, getTiers(), getVariants());
  // The arrival fans ride along whatever the ladder card's own Arrival range setting
  // says, and deliberately so. That setting is about chart ink and about a solve
  // that reruns on every settle; this is a text artifact built once, on a click, and
  // what a bad draw costs is one of the things the analysis is for. Turning the band
  // off because it crowds the chart shouldn't quietly delete a section of the
  // reading. It does roughly double the time behind the button — hence the toast.
  const fans = solveArrivals(p, nSims, cfg, ladder);
  ladder.rows.forEach((row, r) => { row.fans = fans[r]; });
  // The corridor rides along only for the tier the card is actually showing one for.
  // Unlike the fans this is not cheap enough to do unconditionally — it is a
  // bisection per age per tier — and unlike the fans it is a single-rung view by
  // nature, so there is no "all of them" to fall back on.
  const tiers = getTiers(), variants = getVariants(), active = variants.filter(v => v.on);
  let corridor = null;
  if (cfg.corridor >= 0 && tiers[cfg.corridor] && active.length) {
    const tier = tiers[cfg.corridor];
    const one = solveLadder(p, nSims, cfg, [tier], [active[0]]);
    const c = solveCorridor(p, nSims, cfg, tier, active[0], one.rows[0].cells[0]);
    if (c) corridor = { tier: tier.label, scenario: active[0].label, c, crossing: corridorCrossing(c) };
  }
  return {
    version: VERSION,
    date: new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }),
    p, nSims,
    full: simFull(p, nSims),
    tornado: tornadoData(),
    ladder: Object.assign({ cfg }, ladder),
    corridor,
    // The code decodes straight back to the real amounts, so it rides along only
    // with the variant that was already carrying them.
    code: normalized ? "" : encodeScenario(readScenario()),
  };
}

// Failing to reach the clipboard, park the text where it can be selected by hand.
// Not the scenario code box: this is kilobytes of Markdown and a one-line input is
// the wrong shape for it.
function intoBox(txt) {
  el("prompt-out").value = txt;
  el("prompt-more").open = true;
  toast("Couldn't reach the clipboard — copy it from the box below.");
}

function run(normalized) {
  // Both buttons rebuild the ladder, which bisects the simulation once per tier per
  // scenario. On a big ladder that is a visible pause on the click, so say what is
  // happening before the main thread goes away rather than after.
  toast("Building the prompt…");
  // A frame's grace so the toast actually paints before the solve blocks on it.
  requestAnimationFrame(() => {
    const text = buildPrompt(gather(normalized), normalized);
    copyText(text, normalized
      ? "Copied — ratios only, no dollar amounts. Paste it into Claude."
      : "Copied — this contains your real amounts. Paste it into Claude.", intoBox);
  });
}

export function initPrompt(readScenarioFn) {
  readScenario = readScenarioFn;
  el("copy-prompt").addEventListener("click", () => {
    // Mirrors Copy code: private mode is a statement that real numbers should not be
    // leaving this page, and a button that quietly unmasked them would undo it.
    if (isPrivate()) { toast("Private mode is on — use the ratios button instead."); return; }
    run(false);
  });
  el("copy-prompt-rel").addEventListener("click", () => run(true));
  syncPromptChrome();
}

// Private mode disables the dollars variant, the same way it disables Copy code.
export function syncPromptChrome() {
  const b = el("copy-prompt"), on = isPrivate();
  b.disabled = on;
  b.title = on ? "Disabled in private mode — this variant contains your real amounts" : "";
}
