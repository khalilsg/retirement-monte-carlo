// Re-solving each rung at its own date. What's worth defending here is the property
// the whole cheap method rests on — that success is monotone in the balance you
// start from, so a quantile of the arrival balance is a quantile of the answer — and
// that a rung with no date to arrive at gets no fan rather than a fabricated one.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildIndex } from "../src/engine/rng.js";
import { simSuccess } from "../src/engine/simulate.js";
import { solveLadder } from "../src/engine/ladder.js";
import { simArrival, solveFan, solveArrivals, fanDate, fanCost, FAN_PCTS } from "../src/engine/arrival.js";

const N = 1000;
const plan = (over = {}) => ({
  curAge: 45, retAge: 60, endAge: 95, start: 800000, spend: 58000, contribution: 30000,
  fee: 0.0015, tax: 0.15, spendMode: "fixed", gBand: 0.2, gStep: 0.1, gFloor: 0.8,
  gCeiling: 1.2, allocMode: "fixed", stock: 0.8, blockLen: 1, streams: [], ...over,
});
const cfg = { target: 85, maxSpend: 250000 };
const usePlan = { label: "As planned", on: true, useplan: true, streams: [] };
const seeded = () => buildIndex(N, 1);
seeded();

// ---------- The property the method rests on ----------
// If success weren't monotone in the starting balance, a quantile of the arrival
// distribution would not be a quantile of the answer, and the whole fan would have
// to be a Monte Carlo nested inside a Monte Carlo. Worth checking under the awkward
// combination — guardrails reset off the balance at retirement, a glide path moves
// the allocation, and a retirement-relative stream slides with the age being solved.
test("success is monotone in the balance you start from", () => {
  const p = plan({
    spendMode: "guardrails", allocMode: "glide", glideStart: 0.9, glideEnd: 0.4,
    streams: [
      { label: "SS", amount: 28000, from: 67, to: null, cola: true, basis: "age" },
      { label: "Bridge", amount: 18000, from: 0, to: 5, cola: true, basis: "ret" },
    ],
  });
  let prev = -Infinity;
  for (let b = 0; b <= 3000000; b += 150000) {
    const s = simSuccess({ ...p, start: b }, N);
    assert.ok(s >= prev - 1e-9, `success fell from ${prev} to ${s} as the balance rose to ${b}`);
    prev = s;
  }
  assert.ok(prev > 90, "the top of the range should comfortably clear");
});

// ---------- The arrival distribution ----------
test("arrival balances are sorted, positive, and span a real range", () => {
  const p = plan();
  const nests = simArrival(p, N);
  assert.equal(nests.length, N);
  for (let i = 1; i < nests.length; i++) assert.ok(nests[i] >= nests[i - 1], "not sorted");
  assert.ok(nests[0] > 0, "a plan that only contributes should never arrive at zero");
  // Fifteen years of an 80% equity portfolio is not a point estimate.
  assert.ok(nests[N - 1] > nests[0] * 2, "the arrival distribution is implausibly tight");
});

// Only the accumulation phase runs, so the retirement assumptions cannot reach it.
// This is what makes the fan cheap: simFull would simulate forty years to report a
// number it reads off year fifteen.
test("the arrival distribution ignores what happens after the date", () => {
  const a = simArrival(plan({ spend: 58000 }), N);
  const b = simArrival(plan({ spend: 200000 }), N);
  assert.deepEqual(Array.from(a), Array.from(b), "spending after the date moved the arrival balance");
});

// A stream paying before the date is part of accumulation and must count; one
// starting at retirement is not.
test("a pre-date income stream moves the arrival balance, a post-date one does not", () => {
  const bare = simArrival(plan(), N);
  const early = simArrival(plan({ streams: [{ label: "Rent", amount: 20000, from: 50, to: 58, cola: true, basis: "age" }] }), N);
  const late = simArrival(plan({ streams: [{ label: "SS", amount: 30000, from: 67, to: null, cola: true, basis: "age" }] }), N);
  assert.ok(early[0] > bare[0], "income before the date should raise the arrival balance");
  assert.deepEqual(Array.from(late), Array.from(bare), "income after the date reached the accumulation phase");
});

// ---------- No date, no fan ----------
// The ladder reports three outcomes and only one is a crossing. "Already, at 45"
// means the date is today and there is nothing to arrive at; "not by 94" never
// arrives at all. Putting a band around either would be inventing a range for an
// answer that doesn't exist.
test("a rung with no crossing gets no date and no fan", () => {
  const solved = { solvedFor: "age", status: "solved", value: 57 };
  const all = { solvedFor: "age", status: "all", value: 45, lo: 45 };
  const none = { solvedFor: "age", status: "none", value: 94, hi: 94 };
  const spendTier = { label: "t", anchor: "spend", spend: 58000, age: 60 };
  assert.equal(fanDate(spendTier, solved), 57, "a solved rung's date is the age it solved for");
  assert.equal(fanDate(spendTier, all), null);
  assert.equal(fanDate(spendTier, none), null);

  // An age-anchored tier names its own date, but still only where the spend solve
  // actually crossed — "not at any spend" is not a plan you can arrive at.
  const ageTier = { label: "t", anchor: "age", spend: 58000, age: 62 };
  assert.equal(fanDate(ageTier, { solvedFor: "spend", status: "solved", value: 90000 }), 62);
  assert.equal(fanDate(ageTier, { solvedFor: "spend", status: "none", value: 0 }), null);

  assert.equal(solveFan(plan(), N, cfg, spendTier, usePlan, all), null, "a fan was built with no date");
});

// ---------- The fan itself ----------
test("a spend-anchored rung fans over ages, at its own solved date", () => {
  const p = plan();
  const tier = { label: "Core", anchor: "spend", spend: 58000, age: 60 };
  const out = solveLadder(p, N, cfg, [tier], [usePlan]);
  const cell = out.rows[0].cells[0];
  assert.equal(cell.status, "solved", "fixture should produce a crossing to fan around");

  const fan = solveFan(p, N, cfg, tier, usePlan, cell);
  // The date is the rung's own answer, not the plan's retirement age — a tier
  // answering "earliest age 57" needs its arrival distribution measured at 57.
  assert.equal(fan.date, cell.value);
  assert.notEqual(fan.date, p.retAge, "fixture should exercise a date away from the plan's retAge");
  assert.equal(fan.points.length, FAN_PCTS.length);
  fan.points.forEach(pt => assert.equal(pt.solvedFor, "age", "an age panel's fan must stay on the age axis"));

  // Monotone in the arrival balance means monotone in the answer: a richer arrival
  // can only bring the age you could stop at forward, never push it back.
  for (let i = 1; i < fan.points.length; i++) {
    assert.ok(fan.points[i].balance > fan.points[i - 1].balance, "quantiles out of order");
    assert.ok(fan.points[i].value <= fan.points[i - 1].value,
      `a better arrival gave a later age (${fan.points[i - 1].value} -> ${fan.points[i].value})`);
  }
  // The band is one-sided on an age panel, and that is the finding rather than a
  // defect: you cannot stop earlier than the date you asked about, so a good draw
  // pins to the date and only a bad one moves.
  assert.ok(fan.points[0].value >= fan.date, "a low draw should not retire before the date");
});

test("an age-anchored rung fans over spends", () => {
  const p = plan();
  const tier = { label: "At 62", anchor: "age", spend: 58000, age: 62 };
  const out = solveLadder(p, N, cfg, [tier], [usePlan]);
  const cell = out.rows[0].cells[0];
  const fan = solveFan(p, N, cfg, tier, usePlan, cell);
  assert.equal(fan.date, 62, "an age-anchored tier arrives on the age it names");
  fan.points.forEach(pt => assert.equal(pt.solvedFor, "spend"));
  // More money on the date can only buy more spending.
  for (let i = 1; i < fan.points.length; i++) {
    assert.ok(fan.points[i].value >= fan.points[i - 1].value,
      `a better arrival afforded less spending (${fan.points[i - 1].value} -> ${fan.points[i].value})`);
  }
});

// ---------- Shape, and the cost figure ----------
test("solveArrivals lines up with the ladder it was solved against", () => {
  const p = plan();
  const tiers = [
    { label: "Lean", anchor: "spend", spend: 44000, age: 60 },
    { label: "At 62", anchor: "age", spend: 58000, age: 62 },
  ];
  const scenarios = [usePlan, {
    label: "Part-time", on: true, useplan: false, layer: true,
    streams: [{ label: "PT", amount: 24000, from: 0, to: 6, cola: true, basis: "ret" }],
  }];
  const out = solveLadder(p, N, cfg, tiers, scenarios);
  const fans = solveArrivals(p, N, cfg, out);
  assert.equal(fans.length, out.rows.length);
  fans.forEach((row, r) => assert.equal(row.length, out.rows[r].cells.length));
});

// The signed difference is what makes the figure a decision rather than a fact, and
// it must refuse to subtract where either end isn't a number — the same discipline
// the ladder's own Gap column keeps.
test("the cost of a low arrival is signed, and declines to subtract a non-answer", () => {
  const cell = { solvedFor: "age", status: "solved", value: 57 };
  const fan = { date: 57, points: [{ pct: FAN_PCTS[0], balance: 1, status: "solved", value: 60, solvedFor: "age" }] };
  assert.equal(fanCost(cell, fan, FAN_PCTS[0]).delta, 3, "three years later on a low draw");

  const capped = { date: 57, points: [{ pct: FAN_PCTS[0], balance: 1, status: "none", value: 94, solvedFor: "age" }] };
  assert.equal(fanCost(cell, capped, FAN_PCTS[0]).delta, null, "subtracted against a non-answer");
  assert.equal(fanCost({ ...cell, status: "all" }, fan, FAN_PCTS[0]).delta, null);
  assert.equal(fanCost(cell, null, FAN_PCTS[0]), null, "a missing fan is not a cost of zero");
});

// The fan is a different question from the ladder's own answer, so it must not
// quietly restate it: a low arrival should cost something on a plan with real
// dispersion, or the feature is drawing bands around nothing.
test("a low arrival actually costs something", () => {
  const p = plan();
  const tier = { label: "Core", anchor: "spend", spend: 58000, age: 60 };
  const out = solveLadder(p, N, cfg, [tier], [usePlan]);
  const cell = out.rows[0].cells[0];
  const fan = solveFan(p, N, cfg, tier, usePlan, cell);
  const cost = fanCost(cell, fan, FAN_PCTS[0]);
  assert.ok(cost.delta === null || cost.delta > 0,
    `a 10th-percentile arrival should not be free (got ${cost.delta})`);
});
