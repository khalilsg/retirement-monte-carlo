// The Monte Carlo engine. These are behavioral claims about the whole recurrence
// rather than unit checks: that income arrives when the plan says it does, that
// common random numbers make runs comparable, and that the obvious levers move
// the result in the obvious direction.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildIndex } from "../src/engine/rng.js";
import { simSuccess, simFull, simSequence, safeYearFrom } from "../src/engine/simulate.js";

const N = 2000;
const plan = (over = {}) => ({
  curAge: 55, retAge: 60, endAge: 95, start: 900000, spend: 70000, contribution: 0,
  fee: 0.002, tax: 0, spendMode: "fixed", gBand: 0.2, gStep: 0.1, gFloor: 0.8,
  gCeiling: 1.2, allocMode: "fixed", stock: 0.7, blockLen: 1, streams: [], ...over,
});
const ret = (from, to, amount = 60000) => ({ label: "Bridge", amount, from, to, cola: true, basis: "ret" });
const age = (from, to, amount = 60000) => ({ label: "Pension", amount, from, to, cola: true, basis: "age" });

// One shared sampling matrix, rebuilt from the fixed seed, so every comparison
// below is against the same drawn futures.
const seeded = () => buildIndex(N, 1);
seeded();

test("common random numbers make a run reproducible", () => {
  const a = simSuccess(plan(), N);
  seeded();
  assert.equal(simSuccess(plan(), N), a, "same seed, same matrix, same answer");
});

test("income raises success, and more of it raises it further", () => {
  const none = simSuccess(plan(), N);
  const some = simSuccess(plan({ streams: [ret(0, 4, 30000)] }), N);
  const more = simSuccess(plan({ streams: [ret(0, 4, 60000)] }), N);
  assert.ok(some > none, `${some} should beat ${none}`);
  assert.ok(more > some, `${more} should beat ${some}`);
});

test("a retirement-relative stream tracks the retirement age", () => {
  // Identical money, identical five-year window — one pinned to retirement, one
  // pinned to ages 60-64. They must agree only where retirement is actually 60.
  const at = ra => [
    simSuccess(plan({ retAge: ra, streams: [ret(0, 4)] }), N),
    simSuccess(plan({ retAge: ra, streams: [age(60, 64)] }), N),
  ];
  const [rel60, abs60] = at(60);
  assert.equal(rel60, abs60, "at retirement 60 the two windows are the same years");

  const [rel58, abs58] = at(58);
  assert.notEqual(rel58, abs58, "at retirement 58 the relative window must have moved");
  assert.ok(rel58 > abs58, "income arriving at retirement beats income arriving two years later");
});

test("a fixed-age stream stays put as the retirement age moves", () => {
  // Same plan, same stream at ages 67+; only the years before retirement differ,
  // so the stream's own contribution must be anchored, not carried along.
  const S = ra => simSuccess(plan({ retAge: ra, endAge: 95, streams: [age(67, null, 30000)] }), N);
  const shifted = ra => simSuccess(plan({ retAge: ra, endAge: 95, streams: [ret(67 - ra, null, 30000)] }), N);
  for (const ra of [58, 60, 62]) {
    assert.equal(S(ra), shifted(ra), `at retirement ${ra} a fixed age 67 equals the same year expressed relatively`);
  }
});

test("a stream whose window already closed changes nothing", () => {
  // Regression: a finished pension used to pay out once in year 0, which a large
  // enough amount would make glaringly visible.
  const none = simSuccess(plan(), N);
  assert.equal(simSuccess(plan({ streams: [age(40, 45, 900000)] }), N), none, "a closed fixed-age window");
  assert.equal(simSuccess(plan({ streams: [ret(-15, -10, 900000)] }), N), none, "a closed relative window");
});

test("retiring later helps", () => {
  const early = simSuccess(plan({ retAge: 57 }), N);
  const late = simSuccess(plan({ retAge: 65 }), N);
  assert.ok(late > early, `${late} should beat ${early}`);
});

test("spending more hurts, and fees hurt", () => {
  assert.ok(simSuccess(plan({ spend: 100000 }), N) < simSuccess(plan({ spend: 50000 }), N));
  assert.ok(simSuccess(plan({ fee: 0.02 }), N) < simSuccess(plan({ fee: 0.001 }), N));
});

test("success probability stays a percentage", () => {
  for (const p of [plan(), plan({ spend: 1e7 }), plan({ start: 1e9 })]) {
    const v = simSuccess(p, N);
    assert.ok(v >= 0 && v <= 100, `got ${v}`);
  }
  assert.equal(simSuccess(plan({ start: 1e9, spend: 1000 }), N), 100, "an unspendable balance never fails");
  assert.equal(simSuccess(plan({ start: 1000, spend: 1e6 }), N), 0, "an impossible plan never succeeds");
});

test("simFull agrees with simSuccess and reports a coherent shape", () => {
  const p = plan({ streams: [ret(0, 4)] });
  seeded();
  const full = simFull(p, N);
  seeded();
  assert.ok(Math.abs(full.successPct - simSuccess(p, N)) < 1e-9, "the two simulators must agree");
  assert.equal(full.h, 40, "40 modeled years");
  assert.equal(full.A, 5);
  assert.equal(full.retAge, 60);
  assert.equal(full.retYears, 35);
  assert.equal(full.pcts.p50.length, full.h + 1, "a band point per year plus the start");
  for (let y = 0; y <= full.h; y++) {
    const { p10, p25, p50, p75, p90 } = full.pcts;
    assert.ok(p10[y] <= p25[y] && p25[y] <= p50[y] && p50[y] <= p75[y] && p75[y] <= p90[y], `percentiles out of order at year ${y}`);
  }
});

test("simSequence splits every failure into ordering or magnitude", () => {
  seeded();
  const s = simSequence(plan({ spend: 85000 }), N);
  assert.ok(s.failActual > 0, "this plan should fail sometimes");
  assert.ok(Math.abs(s.seqFail + s.magFail - s.failActual) < 1e-9, "attribution must account for every failure");
  assert.ok(Math.abs(s.successPct + s.failActual - 100) < 1e-9);
  assert.equal(s.cond.length, s.h + 1);
});

test("safeYearFrom finds the first durably-safe year, or nothing", () => {
  assert.equal(safeYearFrom([NaN, 70, 90, 95, 99], 85), 2);
  assert.equal(safeYearFrom([NaN, 70, 90, 80, 99], 85), 4, "a later dip disqualifies year 2; year 3 is itself below target");
  assert.equal(safeYearFrom([NaN, 10, 20, 30], 85), null);
});
