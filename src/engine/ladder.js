// The step-up ladder solver: for each lifestyle tier, the precise point at which a
// plan crosses a target success probability.
//
// The heatmap answers this by colouring a grid and drawing a contour through it, so
// its frontier is only ever as precise as the cell size. Here the free variable is
// bisected directly against simSuccess, which converges to the crossing itself.
//
// Two directions, because a tier is anchored on whichever of the pair you actually
// have an opinion about:
//   anchor "spend" — the annual spend is given; solve for the earliest retirement age
//   anchor "age"   — the retirement age is given; solve for the highest annual spend
//
// Everything here is pure and DOM-free: it takes an engine params object, the tier
// and scenario descriptions as plain data, and returns plain data. The caller owns
// the CRN sampling matrix (see rng.js) — none of the variables searched over here
// change the block length, so the matrix never needs rebuilding mid-solve.
import { simSuccess } from "./simulate.js";

// A solve reports one of three things, and the difference matters: a tier that
// clears the target everywhere in range, or nowhere in it, has no crossing to
// report, and printing the boundary as though it were an answer would be a lie.
//   "solved" — a crossing inside the range; `value` is it
//   "all"    — every value in the range clears the target
//   "none"   — no value in the range clears it
// `value` is still filled in for "all"/"none" (the end of the range that came
// closest to being informative), so a caller can place a marker without inventing
// a number to print.

// Spending is searched to the nearest few hundred dollars and then reported down to
// a round hundred: rounding *down* keeps the answer on the side that still clears
// the target, which is the whole point of the figure.
const SPEND_TOL = 250;
const SPEND_ROUND = 100;

// Clone deeply enough that a probe can rewrite spend, retAge, and the stream list
// without touching the caller's params.
function clone(p) {
  const q = Object.assign({}, p);
  q.streams = (p.streams || []).map(s => Object.assign({}, s));
  return q;
}

// Lay a scenario's income assumptions over the plan. A scenario that inherits the
// plan's streams (`useplan`) is the baseline you compare the others against.
export function applyVariant(p, variant) {
  const q = clone(p);
  if (variant && !variant.useplan && Array.isArray(variant.streams)) {
    q.streams = variant.streams.map(s => Object.assign({}, s));
  }
  return q;
}

// The searchable retirement ages: no earlier than today, and at least one year of
// retirement to fund. phaseOf clamps anything outside this anyway; naming the
// bounds here is what lets the caller distinguish "retire now" from "solved at 55".
export function ageBounds(p) {
  const lo = p.curAge;
  return [lo, Math.max(lo, p.endAge - 1)];
}

// A memoized probe. Bisection re-visits the endpoints, and each visit is a full
// Monte Carlo run, so the cache is worth its four lines.
function prober(p, nSims, mutate) {
  const seen = new Map();
  return v => {
    if (seen.has(v)) return seen.get(v);
    const q = clone(p);
    mutate(q, v);
    const s = simSuccess(q, nSims);
    seen.set(v, s);
    return s;
  };
}

// Earliest retirement age that still clears `target`, for a fixed annual spend.
//
// Success generally rises with a later retirement age — more years contributing,
// fewer to fund — so the bisection walks down from a passing age to the first one
// that still passes. That relationship is not guaranteed monotone (a
// retirement-relative income stream slides with the age being searched, and
// guardrails reset off the balance at retirement), so what this finds is *a*
// crossing rather than provably the earliest one. With common random numbers the
// surface is at least deterministic, so the answer is stable rather than noisy.
export function solveAge(p, nSims, target, spend) {
  const base = clone(p);
  base.spend = spend;
  const [lo, hi] = ageBounds(base);
  const at = prober(base, nSims, (q, a) => { q.retAge = a; });
  const sLo = at(lo), sHi = at(hi);
  if (sLo >= target) return { status: "all", value: lo, success: sLo, sLo, sHi, lo, hi };
  if (sHi < target) return { status: "none", value: hi, success: sHi, sLo, sHi, lo, hi };
  // Invariant: at(a) < target, at(b) >= target.
  let a = lo, b = hi;
  while (b - a > 1) {
    const mid = (a + b) >> 1;
    if (at(mid) >= target) b = mid; else a = mid;
  }
  return { status: "solved", value: b, success: at(b), sLo, sHi, lo, hi };
}

// Highest annual spend that still clears `target`, for a fixed retirement age.
//
// The direction is reversed — spending less can only help — so the bisection keeps
// a passing low end and a failing high end and closes the gap between them.
export function solveSpend(p, nSims, target, age, maxSpend) {
  const base = clone(p);
  base.retAge = age;
  const lo = 0, hi = Math.max(SPEND_TOL * 4, maxSpend);
  const at = prober(base, nSims, (q, v) => { q.spend = v; });
  const sLo = at(lo), sHi = at(hi);
  // Spending nothing is the friendliest case there is. If even that misses the
  // target, no amount of belt-tightening reaches it — the plan is short elsewhere.
  if (sLo < target) return { status: "none", value: lo, success: sLo, sLo, sHi, lo, hi };
  // Still clearing at the top of the range means the search cap is what's binding,
  // not the plan. Say so rather than reporting the cap as a finding.
  if (sHi >= target) return { status: "all", value: hi, success: sHi, sLo, sHi, lo, hi };
  let a = lo, b = hi;
  while (b - a > SPEND_TOL) {
    const mid = (a + b) / 2;
    if (at(mid) >= target) a = mid; else b = mid;
  }
  const value = Math.floor(a / SPEND_ROUND) * SPEND_ROUND;
  return { status: "solved", value, success: at(a), sLo, sHi, lo, hi };
}

// Solve one tier under one scenario. A tier carries both numbers at all times so
// flipping its anchor doesn't discard the other one; only the anchor decides which
// is held and which is searched for.
export function solveTier(p, nSims, cfg, tier, variant) {
  const q = applyVariant(p, variant);
  return tier.anchor === "age"
    ? Object.assign({ solvedFor: "spend" }, solveSpend(q, nSims, cfg.target, tier.age, cfg.maxSpend))
    : Object.assign({ solvedFor: "age" }, solveAge(q, nSims, cfg.target, tier.spend));
}

// The whole grid: every tier against every active scenario.
//   cfg = { target, maxSpend }
// Returns one row per tier, each carrying one cell per scenario in the order given.
export function solveLadder(p, nSims, cfg, tiers, scenarios) {
  const active = scenarios.filter(s => s.on);
  return {
    scenarios: active,
    rows: tiers.map(tier => ({
      tier,
      cells: active.map(variant => solveTier(p, nSims, cfg, tier, variant)),
    })),
  };
}
