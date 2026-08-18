// Timeline phases, the allocation glide, and income-stream flattening.
//
// streamArrays is where the two age bases are resolved, so most of this file is
// about which years a stream actually pays in. The rule under test throughout:
// a window that opens before today starts today, and one that already closed
// pays nothing at all.
import { test } from "node:test";
import assert from "node:assert/strict";
import { phaseOf, allocFor, streamArrays } from "../src/engine/model.js";

// A plan with no streams; each test supplies its own.
const plan = (over = {}) => ({
  curAge: 55, retAge: 60, endAge: 95, allocMode: "fixed", stock: 0.7,
  glideStart: 0.8, glideEnd: 0.3, streams: [], ...over,
});
const ret = (from, to, over = {}) => ({ label: "Bridge", amount: 40000, from, to, cola: true, basis: "ret", ...over });
const age = (from, to, over = {}) => ({ label: "SS", amount: 30000, from, to, cola: true, basis: "age", ...over });
const years = (p, s) => { const S = streamArrays({ ...p, streams: [s] }); return [S.from[0], S.to[0]]; };

test("phaseOf splits the plan at retirement", () => {
  const { ca, A, T } = phaseOf(plan());
  assert.equal(ca, 55);
  assert.equal(A, 5);   // ages 55-59 accumulate
  assert.equal(T, 40);  // ages 55-94 modeled
});

test("phaseOf clamps a retirement age below today to today", () => {
  assert.equal(phaseOf(plan({ retAge: 40 })).A, 0);
});

test("phaseOf always leaves at least one retired year", () => {
  const { A, T } = phaseOf(plan({ retAge: 94, endAge: 95 }));
  assert.ok(A < T, "accumulation must not swallow the whole timeline");
});

test("allocFor holds a fixed mix and walks a glide path end to end", () => {
  const fixed = allocFor(plan());
  assert.ok(fixed.every(v => v === 0.7));

  const glide = allocFor(plan({ allocMode: "glide" }));
  // The interpolation lands a hair off the endpoint in binary floating point.
  assert.ok(Math.abs(glide[0] - 0.8) < 1e-9);
  assert.ok(Math.abs(glide[glide.length - 1] - 0.3) < 1e-9);
  assert.ok(glide.every((v, i) => i === 0 || v <= glide[i - 1]), "a falling glide must fall monotonically");
});

test("a fixed-age stream resolves to an offset from today", () => {
  assert.deepEqual(years(plan(), age(67, 70)), [12, 15]);
});

test("an open-ended stream runs past any horizon", () => {
  assert.deepEqual(years(plan(), age(67, null)), [12, 1e9]);
});

test("a retirement-relative stream resolves against the retirement year", () => {
  assert.deepEqual(years(plan(), ret(0, 4)), [5, 9]);
});

test("a retirement-relative stream moves when the retirement age moves", () => {
  const p = plan();
  assert.deepEqual(years(p, ret(0, 4)), [5, 9]);
  assert.deepEqual(years({ ...p, retAge: 67 }, ret(0, 4)), [12, 16]);
  assert.deepEqual(years({ ...p, retAge: 56 }, ret(0, 4)), [1, 5]);
});

test("a fixed-age stream does NOT move when the retirement age moves", () => {
  const p = plan();
  assert.deepEqual(years(p, age(67, null)), years({ ...p, retAge: 67 }, age(67, null)));
});

test("a negative offset starts the stream before retirement", () => {
  assert.deepEqual(years(plan(), ret(-2, 1)), [3, 6]);
});

test("a window that opened before today starts today", () => {
  // Retiring at 56, starting three years earlier: age 53 is already behind us.
  assert.deepEqual(years(plan({ retAge: 56 }), ret(-3, 0)), [0, 1]);
  assert.deepEqual(years(plan(), age(40, 70)), [0, 15]);
});

test("a window that already closed pays nothing", () => {
  // Regression: both ends used to clamp up to 0, which squeezed a finished
  // pension into a single payment in year 0.
  const [f, t] = years(plan(), age(40, 45));
  assert.ok(t < f, `a closed window must not pay (got years ${f}..${t})`);

  const [rf, rt] = years(plan(), ret(-15, -10));
  assert.ok(rt < rf, `a closed relative window must not pay (got years ${rf}..${rt})`);
});

test("an end before the start never pays", () => {
  const [f, t] = years(plan(), ret(4, 0));
  assert.ok(t < f);
});

test("a stream with no basis is read as fixed ages", () => {
  // Scenarios saved before the basis existed carry no `basis` key at all.
  assert.deepEqual(years(plan(), { amount: 1, from: 67, to: null, cola: 1 }), [12, 1e9]);
});

test("amount, COLA flag, and count survive flattening", () => {
  const S = streamArrays(plan({ streams: [ret(0, 4), age(67, null, { cola: false })] }));
  assert.equal(S.n, 2);
  assert.deepEqual([...S.amt], [40000, 30000]);
  assert.deepEqual([...S.cola], [1, 0]);
  assert.equal(S.sf.length, 2, "inflation snapshots are allocated per stream");
});

test("a plan with no streams flattens to nothing", () => {
  assert.equal(streamArrays(plan()).n, 0);
  assert.equal(streamArrays({ ...plan(), streams: undefined }).n, 0);
});
