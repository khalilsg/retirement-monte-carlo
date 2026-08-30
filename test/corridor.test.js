// The glide corridor. Two things here are worth defending above the rest.
//
// The first is what the line MEANS: it is solved with the plan still running, so it
// reads "am I on track?" rather than "could I coast from here?". Those differ by
// however much your future contributions are worth, which on a saving plan is most
// of the answer — a reader who assumes the wrong one draws the opposite conclusion
// from the same picture. There is a test below that pins the difference directly.
//
// The second is that the ladder's three outcomes survive the trip: a rung with no
// crossing has no date to march toward, and must produce no corridor rather than one
// drawn to a boundary nobody solved.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildIndex } from "../src/engine/rng.js";
import { simSuccess } from "../src/engine/simulate.js";
import { solveLadder } from "../src/engine/ladder.js";
import { solveCorridor, corridorAges, corridorTarget, corridorCrossing } from "../src/engine/corridor.js";

const N = 600;
const plan = (over = {}) => ({
  curAge: 42, retAge: 58, endAge: 95, start: 1000000, spend: 70000, contribution: 30000,
  fee: 0.0015, tax: 0.15, spendMode: "fixed", gBand: 0.2, gStep: 0.1, gFloor: 0.8,
  gCeiling: 1.2, allocMode: "fixed", stock: 0.8, blockLen: 1, streams: [], ...over,
});
const cfg = { target: 85, maxSpend: 250000 };
const usePlan = { label: "As planned", on: true, useplan: true, streams: [] };
buildIndex(N, 1);

const rungOf = (p, tier) => solveLadder(p, N, cfg, [tier], [usePlan]).rows[0].cells[0];
const corridorOf = (p, tier) => solveCorridor(p, N, cfg, tier, usePlan, rungOf(p, tier));

// ---------- The ages solved at ----------
test("the corridor solves both ends and stays bounded in between", () => {
  const short = corridorAges(50, 55);
  assert.equal(short[0], 50);
  assert.equal(short[short.length - 1], 55);
  assert.equal(short.length, 6, "a short run is solved year by year");

  // A long runway is stepped rather than solved every year: each age is a bisection,
  // and thirty of them costs more than the whole ladder above it.
  const long = corridorAges(30, 90);
  assert.equal(long[0], 30);
  assert.equal(long[long.length - 1], 90, "the date itself is always solved");
  assert.ok(long.length <= 16, `stepped to ${long.length} points, expected at most 16`);
  for (let i = 1; i < long.length; i++) assert.ok(long[i] > long[i - 1], "ages out of order");

  // A date that is already here, or next year, is a point rather than a track.
  assert.equal(corridorAges(60, 60), null);
  assert.equal(corridorAges(60, 61), null);
});

// ---------- What is held fixed ----------
// Whichever half the ladder solved for is what the corridor asks you to sustain, so
// both anchors end up with a date to march toward and a spend to hold.
test("the corridor holds whatever the ladder ended up with", () => {
  const spendTier = { label: "t", anchor: "spend", spend: 62000, age: 58 };
  const ageCell = { solvedFor: "age", status: "solved", value: 54 };
  assert.deepEqual(corridorTarget(spendTier, ageCell), { date: 54, spend: 62000 },
    "a spend-anchored tier marches to the age the ladder found");

  const ageTier = { label: "t", anchor: "age", spend: 70000, age: 60 };
  const spendCell = { solvedFor: "spend", status: "solved", value: 96000 };
  assert.deepEqual(corridorTarget(ageTier, spendCell), { date: 60, spend: 96000 },
    "an age-anchored tier holds the spend the ladder found");
});

test("a rung with no crossing yields no corridor at all", () => {
  const tier = { label: "t", anchor: "spend", spend: 62000, age: 58 };
  for (const status of ["all", "none"]) {
    const cell = { solvedFor: "age", status, value: 42, lo: 42, hi: 94 };
    assert.equal(corridorTarget(tier, cell), null, `${status} produced a target`);
    assert.equal(solveCorridor(plan(), N, cfg, tier, usePlan, cell), null, `${status} produced a corridor`);
  }
});

// ---------- The line itself ----------
test("the required balance rises toward the date", () => {
  const tier = { label: "Core", anchor: "age", spend: 70000, age: 58 };
  const c = corridorOf(plan(), tier);
  assert.ok(c, "fixture should produce a corridor");
  assert.equal(c.date, 58);
  const solved = c.points.filter(o => o.status === "solved");
  assert.ok(solved.length > 3, "expected several solved ages");
  // Every year closer to the date is a year less of contributions and compounding to
  // make up a shortfall, so the bar can only rise.
  for (let i = 1; i < solved.length; i++) {
    assert.ok(solved[i].value >= solved[i - 1].value,
      `the line fell from ${solved[i - 1].value} at ${solved[i - 1].age} to ${solved[i].value} at ${solved[i].age}`);
  }
});

// The property the bisection rests on, checked where the corridor actually uses it:
// more money at a given age can only help, under every rule the model has.
test("success is monotone in the balance the corridor bisects on", () => {
  const p = plan({
    curAge: 50, retAge: 58, spendMode: "guardrails", allocMode: "glide", glideStart: 0.9, glideEnd: 0.4,
    streams: [
      { label: "SS", amount: 26000, from: 67, to: null, cola: true, basis: "age" },
      { label: "Bridge", amount: 15000, from: 0, to: 4, cola: true, basis: "ret" },
    ],
  });
  let prev = -Infinity;
  for (let b = 0; b <= 4000000; b += 250000) {
    const s = simSuccess({ ...p, start: b }, N);
    assert.ok(s >= prev - 1e-9, `success fell from ${prev} to ${s} at a balance of ${b}`);
    prev = s;
  }
});

// ---------- What the line assumes ----------
// The load-bearing design decision, pinned directly. The corridor keeps contributing
// from each age through to the date, so it answers "am I on track?". Stop the
// contributions and the same rung demands a great deal more at every age — which is
// the other question, and not the one this chart is drawn to answer.
test("the line assumes the plan keeps running, and that is worth a lot", () => {
  const tier = { label: "Core", anchor: "age", spend: 70000, age: 58 };
  const saving = corridorOf(plan({ contribution: 30000 }), tier);
  const coasting = corridorOf(plan({ contribution: 0 }), tier);
  assert.ok(saving && coasting, "both fixtures should produce corridors");

  const early = a => {
    const s = saving.points.find(o => o.age === a), c = coasting.points.find(o => o.age === a);
    return s && c && s.status === "solved" && c.status === "solved" ? [s.value, c.value] : null;
  };
  const at = early(saving.points[0].age);
  assert.ok(at, "the first age should solve under both");
  assert.ok(at[1] > at[0],
    `stopping contributions should raise the bar, got ${at[1]} against ${at[0]}`);
});

// ---------- The bands drawn behind it ----------
test("the projected bands cover the same ages, in order, and widen", () => {
  const c = corridorOf(plan(), { label: "Core", anchor: "age", spend: 70000, age: 58 });
  assert.equal(c.bands.ages[0], 42, "the bands start today");
  assert.equal(c.bands.ages[c.bands.ages.length - 1], c.date, "and run to the date");
  for (const k of ["p10", "p25", "p50", "p75", "p90"]) assert.equal(c.bands[k].length, c.bands.ages.length);
  for (let i = 0; i < c.bands.ages.length; i++) {
    assert.ok(c.bands.p10[i] <= c.bands.p50[i] && c.bands.p50[i] <= c.bands.p90[i], "percentiles out of order");
  }
  const w = i => c.bands.p90[i] - c.bands.p10[i];
  assert.ok(w(c.bands.ages.length - 1) > w(1), "the fan should widen with time");
});

// ---------- The reading ----------
// Tagged, because "never falls below" and "below from the start" are opposite
// findings that a bare age would both report as null.
test("the crossing distinguishes clearing throughout from never clearing", () => {
  const c = corridorOf(plan(), { label: "Core", anchor: "age", spend: 70000, age: 58 });

  // The median clears essentially by construction — the rung is defined as the point
  // where the plan hits its target — which is exactly why the chart watches a lower
  // band instead. Asserting it here is what documents that the choice is deliberate.
  assert.equal(corridorCrossing(c, "p50").status, "above");

  const synth = (p10) => ({
    date: 58,
    points: [{ age: 42, status: "solved", value: 100 }, { age: 43, status: "solved", value: 200 }],
    bands: { ages: [42, 43], p10, p50: p10, p90: p10 },
  });
  assert.deepEqual(corridorCrossing(synth([150, 250]), "p10"), { status: "above" });
  assert.deepEqual(corridorCrossing(synth([50, 60]), "p10"), { status: "below" });
  assert.deepEqual(corridorCrossing(synth([150, 60]), "p10"), { status: "crosses", age: 42 });
  assert.equal(corridorCrossing(null), null);
});
