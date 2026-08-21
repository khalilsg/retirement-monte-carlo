// The step-up ladder solver. What's worth defending here is that the answer means
// what it says: a "solved" figure really is the crossing point (one step to the
// worse side misses the target, the figure itself clears it), and the two
// no-crossing cases are reported as such rather than as a boundary dressed up as a
// finding.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildIndex } from "../src/engine/rng.js";
import { simSuccess } from "../src/engine/simulate.js";
import { solveAge, solveSpend, solveTier, solveLadder, applyVariant, ageBounds } from "../src/engine/ladder.js";

const N = 1000;
const plan = (over = {}) => ({
  curAge: 50, retAge: 60, endAge: 95, start: 900000, spend: 60000, contribution: 25000,
  fee: 0.002, tax: 0, spendMode: "fixed", gBand: 0.2, gStep: 0.1, gFloor: 0.8,
  gCeiling: 1.2, allocMode: "fixed", stock: 0.7, blockLen: 1, streams: [], ...over,
});
const ret = (from, to, amount) => ({ label: "Bridge", amount, from, to, cola: true, basis: "ret" });

// One shared sampling matrix from the fixed seed: every probe the solver makes has
// to see the same drawn futures, or bisection is chasing noise instead of a curve.
const seeded = () => buildIndex(N, 1);
seeded();

const at = (p, over) => simSuccess({ ...p, ...over }, N);

test("solving for age brackets the crossing exactly", () => {
  const p = plan(), target = 85;
  const r = solveAge(p, N, target, 60000);
  assert.equal(r.status, "solved");
  assert.ok(at(p, { spend: 60000, retAge: r.value }) >= target, "the answer itself clears the target");
  assert.ok(at(p, { spend: 60000, retAge: r.value - 1 }) < target, "one year earlier does not");
});

test("solving for spend brackets the crossing exactly", () => {
  const p = plan(), target = 85;
  const r = solveSpend(p, N, target, 65, 200000);
  assert.equal(r.status, "solved");
  assert.ok(at(p, { retAge: 65, spend: r.value }) >= target, "the answer itself clears the target");
  // Reported down to a round hundred, so the next figure up is a tolerance away.
  assert.ok(at(p, { retAge: 65, spend: r.value + 2000 }) < target, "spending meaningfully more does not");
});

test("a tier that clears the target from the first allowed age says so", () => {
  // Vast portfolio, trivial spending: there is no crossing to find, because
  // retiring today already works.
  const p = plan({ start: 12000000, spend: 30000 });
  const r = solveAge(p, N, 85, 30000);
  assert.equal(r.status, "all");
  assert.equal(r.value, ageBounds(p)[0], "the marker sits at the earliest allowed age");
});

test("a tier that never clears the target in range says so", () => {
  // Nothing saved and two years left to plan through: waiting cannot rescue it,
  // so there is no earliest age to report.
  const p = plan({ curAge: 64, endAge: 66, start: 1000, contribution: 0 });
  const r = solveAge(p, N, 85, 200000);
  assert.equal(r.status, "none");
  assert.equal(r.value, ageBounds(p)[1], "the marker sits at the last allowed age");
});

test("spending nothing and still missing the target is not a spend answer", () => {
  // Nothing saved and nothing going in: the plan fails even spending nothing, so
  // there is no maximum spend to report — printing $0 would be a false finding.
  const p = plan({ start: 0, contribution: 0, curAge: 64 });
  const r = solveSpend(p, N, 95, 65, 200000);
  assert.equal(r.status, "none");
  assert.equal(r.value, 0);
});

test("clearing the target at the search cap blames the cap, not the plan", () => {
  const p = plan({ start: 20000000, contribution: 0 });
  const r = solveSpend(p, N, 85, 65, 50000);
  assert.equal(r.status, "all");
  assert.equal(r.value, 50000, "the marker sits at the cap that was actually binding");
});

test("a cheaper tier retires no later than a dearer one", () => {
  const p = plan(), target = 85;
  const lean = solveAge(p, N, target, 45000);
  const rich = solveAge(p, N, target, 90000);
  assert.equal(lean.status, "solved");
  assert.equal(rich.status, "solved");
  assert.ok(lean.value <= rich.value, `${lean.value} should be no later than ${rich.value}`);
});

test("a later retirement age affords no less spending", () => {
  const p = plan(), target = 85;
  const early = solveSpend(p, N, target, 60, 250000);
  const late = solveSpend(p, N, target, 68, 250000);
  assert.ok(late.value >= early.value, `${late.value} should be at least ${early.value}`);
});

test("a scenario replaces the plan's streams, and inheriting leaves them alone", () => {
  const p = plan({ streams: [ret(0, 4, 40000)] });
  const inherit = applyVariant(p, { useplan: true, streams: [] });
  const replace = applyVariant(p, { useplan: false, streams: [] });
  assert.equal(inherit.streams.length, 1);
  assert.equal(replace.streams.length, 0);
  // A clone, not the same array: a probe must not be able to edit the caller's plan.
  assert.notEqual(inherit.streams, p.streams);
  assert.notEqual(inherit.streams[0], p.streams[0]);
});

test("a bridge income lets a spend-anchored tier retire earlier", () => {
  const p = plan(), target = 85, tier = { label: "Comfortable", anchor: "spend", spend: 70000, age: 65 };
  const cfg = { target, maxSpend: 200000 };
  const stop = solveTier(p, N, cfg, tier, { useplan: false, streams: [] });
  // Four years off, then part-time for six — dated relative to retirement, so it
  // slides with every age the solver probes. That sliding is the whole reason a
  // ladder can be solved at all rather than re-derived per age.
  const bridge = solveTier(p, N, cfg, tier, { useplan: false, streams: [ret(4, 9, 35000)] });
  assert.equal(stop.solvedFor, "age");
  assert.ok(bridge.value <= stop.value, `bridge ${bridge.value} should not be later than full stop ${stop.value}`);
});

test("the grid covers every tier and only the active scenarios", () => {
  const tiers = [
    { label: "Bare-bones", anchor: "spend", spend: 40000, age: 65 },
    { label: "Comfortable", anchor: "age", spend: 90000, age: 67 },
  ];
  const scenarios = [
    { label: "As planned", on: true, useplan: true, streams: [] },
    { label: "Full stop", on: true, useplan: false, streams: [] },
    { label: "Off", on: false, useplan: false, streams: [] },
  ];
  const out = solveLadder(plan(), N, { target: 85, maxSpend: 200000 }, tiers, scenarios);
  assert.equal(out.scenarios.length, 2, "the inactive scenario is not solved");
  assert.equal(out.rows.length, 2);
  assert.equal(out.rows[0].cells.length, 2);
  assert.equal(out.rows[0].cells[0].solvedFor, "age", "a spend-anchored tier solves for age");
  assert.equal(out.rows[1].cells[0].solvedFor, "spend", "an age-anchored tier solves for spend");
});
