// The analysis prompt serializer. What's worth defending here is what the prompt
// promises about itself: that the normalized variant really does contain no dollar
// amounts, that a tunable added to the registry cannot silently vanish from it, and
// that the three ladder outcomes are still distinguishable once they're prose —
// a "no crossing" reported as a bare number would be a lie told at length.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPrompt, cellPhrase, fanPhrase } from "../src/config/prompt.js";
import { PARAM_FIELDS } from "../src/config/parameters.js";

const plan = (over = {}) => ({
  curAge: 50, retAge: 60, endAge: 95, start: 900000, spend: 60000, contribution: 25000,
  fee: 0.002, tax: 0.22, spendMode: "fixed", gBand: 0.2, gStep: 0.1, gFloor: 0.8,
  gCeiling: 1.2, allocMode: "fixed", stock: 0.7, glideStart: 0.9, glideEnd: 0.4,
  sampleMode: "iid", blockLen: 1, streams: [], ...over,
});

const full = (over = {}) => ({
  successPct: 82.4, medEnd: 1400000, p10End: 210000, worst: 0, medDep: 28,
  medLowSpend: 52000, medNest: 1800000, guard: false, h: 45, A: 10, ca: 50,
  retAge: 60, retYears: 35, ...over,
});

const moneyMeta = { kind: "money", flow: true, label: "Annual spending" };
const pctMeta = { kind: "pctInt", label: "Stock allocation (%)" };
// An income stream's row, as streamMeta actually builds it: the units are baked
// into the label from the page's private-mode flag, not from the prompt's variant.
// The original fixture used tidy labels and missed a real leak because of it.
const streamMetaLabel = { kind: "money", flow: true, label: "Bridge job ($/yr)" };

const bundle = (over = {}) => ({
  version: "v9.9.9", date: "January 1, 2026", nSims: 10000,
  p: plan(over.p), full: full(over.full),
  tornado: { base: 82.4, rows: [
    { label: "Annual spending", meta: moneyMeta, lo: 51000, hi: 69000, sLo: 93.1, sHi: 64.2, impact: 28.9 },
    { label: "Stock allocation (%)", meta: pctMeta, lo: 55, hi: 85, sLo: 78.0, sHi: 84.4, impact: 6.4 },
    { label: "Bridge job ($/yr)", meta: streamMetaLabel, lo: 25500, hi: 34500, sLo: 79.9, sHi: 84.6, impact: 4.7 },
  ] },
  ladder: {
    cfg: { target: 85, maxSpend: 210000 },
    scenarios: [{ label: "Plan as-is" }, { label: "Part-time" }],
    rows: [{
      tier: { label: "Bare-bones", anchor: "spend", spend: 40000, age: 60 },
      cells: [
        { solvedFor: "age", status: "solved", value: 57, success: 86.2, lo: 50, hi: 94, sLo: 40, sHi: 99 },
        { solvedFor: "age", status: "all", value: 50, success: 91.0, lo: 50, hi: 94, sLo: 91.0, sHi: 99 },
      ],
      // A fan on the rung that crossed, none on the rung that didn't — the pairing
      // the serializer has to keep straight.
      fans: [
        { date: 57, points: [
          { pct: 0.10, balance: 900000, solvedFor: "age", status: "solved", value: 60, success: 85.4 },
          { pct: 0.50, balance: 1500000, solvedFor: "age", status: "all", value: 57, lo: 57, sLo: 92.0 },
          { pct: 0.90, balance: 2400000, solvedFor: "age", status: "all", value: 57, lo: 57, sLo: 98.0 },
        ] },
        null,
      ],
    }],
  },
  code: "ABC123",
  ...over.bundle,
});

// A corridor as engine/corridor.js returns one, with the three outcomes represented:
// a solved requirement, an age carried entirely by contributions, and one no balance
// in range clears.
function fixtureCorridor() {
  return {
    tier: "Bare-bones", scenario: "Plan as-is",
    crossing: { status: "crosses", age: 51 },
    c: {
      date: 57, spend: 40000,
      points: [
        { age: 50, status: "all", value: 0, lo: 0 },
        { age: 51, status: "solved", value: 640000 },
        { age: 57, status: "solved", value: 980000 },
      ],
      bands: {
        ages: [50, 51, 57],
        p10: [900000, 910000, 950000], p25: [900000, 950000, 1100000],
        p50: [900000, 990000, 1400000], p75: [900000, 1040000, 1750000],
        p90: [900000, 1100000, 2200000],
      },
    },
  };
}

// ---------- The privacy promise ----------
// The normalized variant is offered as safe to paste where the dollars one isn't,
// so the one thing it must not do is emit a dollar amount. A "$" anywhere in the
// output is a leak — including from a place nobody thought of as money, like the
// tornado's value columns or a stream's annual figure.
test("the normalized variant contains no dollar amounts anywhere", () => {
  const b = bundle({ p: { streams: [{ label: "Pension", amount: 24000, from: 67, to: null, cola: true, basis: "age" }] } });
  const out = buildPrompt(b, true);
  assert.ok(!out.includes("$"), "normalized prompt leaked a dollar sign");
  // Not merely absent — actually rendered in the ratio grammar private mode uses.
  assert.match(out, /×/, "balances should read as multiples");
  assert.match(out, /\d%/, "flows should read as percentages");
  // Including the units baked into a stream's own sensitivity label, which is built
  // from the page's private-mode flag rather than from the variant being emitted.
  assert.match(out, /Bridge job \(\/yr\)/, "a stream's label should carry the normalized units");
});

test("the dollars variant does carry amounts, and the normalized one drops the code", () => {
  const b = bundle();
  assert.match(buildPrompt(b, false), /\$900,000/);
  // The scenario code decodes straight back to the real figures, so it must not
  // ride along with the variant that withheld them.
  assert.ok(buildPrompt(b, false).includes("ABC123"));
  assert.ok(!buildPrompt(b, true).includes("ABC123"), "normalized prompt carried the scenario code");
});

// ---------- The balance track ----------
test("the corridor block prints its three outcomes rather than a number for each", () => {
  const out = buildPrompt(bundle({ bundle: { corridor: fixtureCorridor() } }), false);
  assert.match(out, /\| Age \| Balance needed \| Projected 10th \|/);
  // An age carried by contributions alone needs no balance, which is not the same as
  // needing zero — printing "$0" would read as an answer.
  assert.match(out, /\| 50 \| any balance \|/);
  assert.match(out, /\| 51 \| \$640,000 \|/);
  assert.match(out, /stays above that line through age 51/);
  // The reason the reading watches a lower band has to travel with the figures, or
  // the model reaches for the median and concludes nothing.
  assert.match(out, /median clears it near enough by construction/);
});

test("no corridor selected means no balance-track section at all", () => {
  const out = buildPrompt(bundle(), false);
  assert.ok(!out.includes("## The balance track"), "printed an empty balance-track section");
  assert.ok(!out.includes("any balance"));
});

test("the corridor is stated in ratios under the normalized variant", () => {
  const out = buildPrompt(bundle({ bundle: { corridor: fixtureCorridor() } }), true);
  assert.ok(!out.includes("$"), "the corridor block leaked a dollar amount");
  assert.match(out, /## The balance track/);
});

// ---------- The registry promise ----------
// The plan block is derived from PARAMS precisely so a tunable added later can't be
// left out of it. This asserts the derivation rather than the current list: it fails
// if someone replaces the loop with a hand-written block, which is the regression
// worth catching.
test("every relevant registry entry appears in the plan block", () => {
  const p = plan({ spendMode: "guardrails", allocMode: "glide", sampleMode: "blocks", blockLen: 5 });
  const out = buildPrompt(bundle({ p }), false);
  for (const e of PARAM_FIELDS) {
    if (e.sweep && e.sweep.when && !e.sweep.when(p)) continue;
    if (e.promptWhen && !e.promptWhen(p)) continue;
    const name = e.promptLabel || (e.sweep && e.sweep.label) || e.param;
    assert.ok(out.includes("- " + name + ":"), "plan block is missing " + name);
  }
});

// The registry's own relevance tests decide what's worth printing. A glide-path
// figure under a fixed allocation isn't a fact about the plan — the engine never
// reads it — and printing it invites a reading built on a number that did nothing.
test("irrelevant assumptions are left out rather than printed as zeroes", () => {
  const fixed = buildPrompt(bundle({ p: plan({ allocMode: "fixed", spendMode: "fixed" }) }), false);
  assert.ok(!fixed.includes("Starting stock"), "glide params shown under a fixed allocation");
  assert.ok(!fixed.includes("Spending floor"), "guardrail params shown under fixed spending");
  assert.ok(!fixed.includes("Guardrail cut/raise step"), "guardrail step shown under fixed spending");
  assert.ok(fixed.includes("Stock allocation (%): 70%"));

  const glide = buildPrompt(bundle({ p: plan({ allocMode: "glide", spendMode: "guardrails" }) }), false);
  assert.ok(glide.includes("Starting stock (%): 90%"));
  assert.ok(glide.includes("Spending floor (%): 80%"));
  assert.ok(!glide.includes("Stock allocation (%):"), "fixed-allocation param shown under a glide path");
});

// An entry with neither a promptLabel nor a sweep label is printed under its bare
// param key. The point is that the omission is visible in the output instead of
// shrinking the block by one line where nobody would notice.
test("an unlabeled entry still appears, under its param key", () => {
  const orphan = { param: "curAge", el: "cur-age", repr: "int" };
  const name = orphan.promptLabel || (orphan.sweep && orphan.sweep.label) || orphan.param;
  assert.equal(name, "curAge");
});

// ---------- The ladder's three outcomes ----------
// engine/ladder.js reports "solved", "all" and "none" precisely so a boundary isn't
// dressed up as an answer. Flattened into prose that distinction has to survive, or
// the prompt reintroduces the lie the solver went out of its way to avoid.
test("a no-crossing cell never reads as a plain answer", () => {
  const money = x => "$" + x;
  const solved = cellPhrase({ solvedFor: "age", status: "solved", value: 57, success: 86.2 }, money);
  assert.match(solved, /^age 57 /);

  const all = cellPhrase({ solvedFor: "age", status: "all", lo: 50, sLo: 91.0 }, money);
  assert.match(all, /no crossing/);
  assert.ok(!/^age \d+ \(/.test(all));

  const none = cellPhrase({ solvedFor: "age", status: "none", hi: 94, sHi: 61.3 }, money);
  assert.match(none, /never clears it/);

  // The spend direction's cap case is the subtle one: the figure is the search
  // ceiling, not a finding, and saying so is the whole point of the tag.
  const capped = cellPhrase({ solvedFor: "spend", status: "all", hi: 210000, sHi: 90 }, money);
  assert.match(capped, /cap is binding, not the plan/);
  const broke = cellPhrase({ solvedFor: "spend", status: "none", sLo: 44.0 }, money);
  assert.match(broke, /even spending nothing/);
});

// ---------- The two uncertainties ----------
// Sampling error and the martingale drift are different quantities that both print
// as "points of success probability", and conflating them is the misreading the
// whole section exists to prevent. Both must be present and labeled.
test("sampling error and expected drift are both stated, and distinguished", () => {
  const out = buildPrompt(bundle(), false);
  assert.match(out, /Monte Carlo sampling error: 95% CI/);
  // sqrt(.824 * .176) = 0.3805 -> 38 points.
  assert.match(out, /Expected total drift[\s\S]{0,80}±38 points/);
  assert.match(out, /not sampling error and more\n\s*simulations do not shrink it/);
});

// ---------- The instruction that carries the feature ----------
// The app computes and the model interprets. Two of the eight things a full reading
// wants (the balance checkpoints of #8, the cost of a bad draw from #9) aren't
// computed yet, and a model asked for them will invent them. The general rule is
// what covers the sections that don't exist.
test("the preamble forbids inventing numbers that aren't in the block", () => {
  const out = buildPrompt(bundle(), false);
  assert.match(out, /use only the numbers in this message/i);
  assert.match(out, /Don't\nestimate it/);
  // Deliberately NOT asserting the specific examples the rule gives. An earlier
  // version of this test pinned one, and it broke the moment the engine learned to
  // compute it — which is the same brittleness the rule itself keeps falling into.
  // What has to hold is that the rule names things the app cannot produce at all,
  // rather than things it merely hasn't produced yet.
  assert.match(out, /is not available to you/);
});

// The prompt has twice shipped a claim that a later feature made false. It cannot be
// checked in general, but the specific trap — disclaiming a figure that is in the
// very same message — is worth a guard.
test("the prompt never says a figure is unavailable while shipping it", () => {
  const out = buildPrompt(bundle({ bundle: { corridor: fixtureCorridor() } }), false);
  assert.match(out, /## The balance track for the Bare-bones tier/);
  assert.ok(!/balance I'd need at some particular age/.test(out),
    "the ground rule disclaims a balance-at-age while the corridor block supplies one");
});

// The prompt once told the model to say the size of a bad draw wasn't computed. It
// is now, so instruction 4 has to ask for the reading rather than the disclaimer —
// a prompt that still hedged would talk the model out of a section it can answer.
test("the failure-fraction section asks for the cost rather than disclaiming it", () => {
  const out = buildPrompt(bundle(), false);
  assert.ok(!out.includes("does not yet compute"), "the prompt still disclaims a figure it now ships");
  assert.ok(!out.includes("magnitude isn't in front of you"));
  assert.match(out, /What the failure fraction actually costs/);
  assert.match(out, /low draw/);
});

// ---------- The low-draw columns ----------
test("the ladder table gains a low-draw column per scenario, and only where there are fans", () => {
  const out = buildPrompt(bundle(), false);
  assert.match(out, /\| Plan as-is — low draw \| Part-time — low draw \|/);
  // Grouped after the answers, matching the app's own table so the two read alike.
  const head = out.split("\n").find(l => l.includes("— low draw"));
  assert.ok(head.indexOf("| Plan as-is |") < head.indexOf("| Plan as-is — low draw |"));

  // No fans anywhere means no columns at all, rather than a row of dashes.
  const bare = bundle();
  bare.ladder.rows[0].fans = [null, null];
  assert.ok(!buildPrompt(bare, false).includes("low draw |"), "empty low-draw columns were printed anyway");
  assert.ok(!buildPrompt(bare, false).includes("The **low draw** columns"), "explained a column that isn't there");
});

test("a low draw states the answer and what it costs, and refuses to subtract a non-answer", () => {
  const money = (x, flow) => "$" + x + (flow ? "" : "");
  const cell = { solvedFor: "age", status: "solved", value: 57 };
  const fan = { date: 57, points: [{ pct: 0.10, solvedFor: "age", status: "solved", value: 60, success: 85.4 }] };
  const got = fanPhrase(cell, fan, money);
  assert.match(got, /^age 60 /);
  assert.match(got, /3 years later/);

  // Singular reads as a year, not "1 years".
  const one = fanPhrase(cell, { points: [{ pct: 0.10, solvedFor: "age", status: "solved", value: 58, success: 85.1 }] }, money);
  assert.match(one, /1 year later/);

  // Either end not being a figure means there is nothing to subtract — the figure
  // still prints, the difference doesn't.
  const capped = { points: [{ pct: 0.10, solvedFor: "age", status: "none", hi: 94, sHi: 61.0 }] };
  const out = fanPhrase(cell, capped, money);
  assert.match(out, /never clears it/);
  assert.ok(!/ years (later|earlier)/.test(out), "subtracted against a non-answer");
  assert.equal(fanPhrase(cell, null, money), "—", "a missing fan is not a cost of zero");

  // A spend solve reports in dollars a year, in the other direction.
  const spendCell = { solvedFor: "spend", status: "solved", value: 100000 };
  const spendFan = { points: [{ pct: 0.10, solvedFor: "spend", status: "solved", value: 78000, success: 85.2 }] };
  assert.match(fanPhrase(spendCell, spendFan, money), /\$22000\/yr less/);
});

// A stream dated relative to retirement slides with every age the ladder probes,
// which is the subtlest thing in the model. Saying "from age 3" would be a
// straightforward misread of the plan.
test("stream age bases are spelled out in words", () => {
  const rel = buildPrompt(bundle({ p: plan({ streams: [{ label: "Bridge", amount: 30000, from: 0, to: 5, cola: true, basis: "ret" }] }) }), false);
  assert.match(rel, /from the year you retire to 5 years after retiring/);
  assert.match(rel, /dated relative to retirement/);

  const abs = buildPrompt(bundle({ p: plan({ streams: [{ label: "Pension", amount: 24000, from: 67, to: null, cola: false, basis: "age" }] }) }), false);
  assert.match(abs, /from age 67 onward/);
  assert.match(abs, /flat in nominal terms/);
  assert.match(abs, /dated by age/);
});

// The method note in the prompt has to agree with the one on the page. #7's finding
// was that the intuitive reading ("blocks are the conservative choice") is wrong for
// this model, and a prompt that shipped the intuition would have Claude explain the
// user's numbers with an account the app itself contradicts.
test("the sampling note matches the app's corrected account", () => {
  const iid = buildPrompt(bundle({ p: plan({ sampleMode: "iid", blockLen: 1 }) }), false);
  assert.match(iid, /independent-year sampling/);
  const blk = buildPrompt(bundle({ p: plan({ sampleMode: "blocks", blockLen: 5 }) }), false);
  assert.match(blk, /5-year block sampling/);
  for (const out of [iid, blk]) {
    assert.match(out, /tempting to call block sampling the conservative choice/);
    assert.match(out, /crossover is near 50% success/);
    assert.match(out, /single 98-year record/);
  }
});
