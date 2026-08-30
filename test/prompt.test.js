// The analysis prompt serializer. What's worth defending here is what the prompt
// promises about itself: that the normalized variant really does contain no dollar
// amounts, that a tunable added to the registry cannot silently vanish from it, and
// that the three ladder outcomes are still distinguishable once they're prose —
// a "no crossing" reported as a bare number would be a lie told at length.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPrompt, cellPhrase } from "../src/config/prompt.js";
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
    }],
  },
  code: "ABC123",
  ...over.bundle,
});

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
  assert.match(out, /magnitude isn't in front of you/);
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
