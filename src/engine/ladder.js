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

// Every solve here reports one of three outcomes — "solved", "all", "none" — and the
// difference matters enough that it is documented on bisect() below, which is where
// the distinction is actually made.

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

// Lay a scenario's income assumptions over the plan. Three ways to do that:
//   useplan: true         — inherit the plan's streams verbatim; the baseline you
//                            compare the others against. `streams`/`layer` are unused.
//   useplan: false, layer  — append the scenario's own streams to the plan's, so
//                            "the plan, plus a side gig" doesn't have to drop the
//                            plan's Social Security to add one line of part-time pay.
//   useplan: false         — replace the plan's streams with the scenario's own,
//                            for "full stop" and other clean-slate scenarios.
export function applyVariant(p, variant) {
  const q = clone(p);
  if (!variant || variant.useplan) return q;
  const own = Array.isArray(variant.streams) ? variant.streams.map(s => Object.assign({}, s)) : [];
  q.streams = variant.layer ? q.streams.concat(own) : own;
  return q;
}

// The searchable retirement ages: no earlier than today, and at least one year of
// retirement to fund. phaseOf clamps anything outside this anyway; naming the
// bounds here is what lets the caller distinguish "retire now" from "solved at 55".
export function ageBounds(p) {
  const lo = p.curAge;
  return [lo, Math.max(lo, p.endAge - 1)];
}

// The bisection itself, over any monotone free variable.
//
// This was two hand-written copies until the glide corridor (corridor.js) needed a
// third direction. They differed only in which way success runs and how finely the
// variable divides, and both had their own copy of the three-outcome bookkeeping —
// which is exactly the part worth having once.
//
//   rising  — success climbs with the variable, so the answer is the LOWEST value
//             that still clears (a retirement age; a starting balance)
//   falling — success falls with it, so the answer is the HIGHEST that clears
//             (an annual spend)
//
// The three outcomes are the reason this returns a tagged object rather than a
// number: a variable that clears the target across its whole range, or nowhere in
// it, has no crossing, and printing the boundary as though it were one would be a
// lie. `value` is still filled in for those, at whichever end came closest to being
// informative, so a caller can place a marker without inventing a figure.
export function bisect(at, lo, hi, target, tol, rising, int) {
  const sLo = at(lo), sHi = at(hi);
  const frame = { sLo, sHi, lo, hi };
  const clears = s => s >= target;
  // An integer variable has to stay one: a fractional retirement age would reach
  // phaseOf and make the accumulation phase a fraction of a year long.
  const midOf = (a, b) => int ? (a + b) >> 1 : (a + b) / 2;
  let a = lo, b = hi;
  if (rising) {
    if (clears(sLo)) return Object.assign({ status: "all", value: lo, success: sLo }, frame);
    if (!clears(sHi)) return Object.assign({ status: "none", value: hi, success: sHi }, frame);
    // Invariant: at(a) < target, at(b) >= target.
    while (b - a > tol) { const m = midOf(a, b); if (clears(at(m))) b = m; else a = m; }
    return Object.assign({ status: "solved", value: b, success: at(b) }, frame);
  }
  if (!clears(sLo)) return Object.assign({ status: "none", value: lo, success: sLo }, frame);
  if (clears(sHi)) return Object.assign({ status: "all", value: hi, success: sHi }, frame);
  while (b - a > tol) { const m = midOf(a, b); if (clears(at(m))) a = m; else b = m; }
  return Object.assign({ status: "solved", value: a, success: at(a) }, frame);
}

// A memoized probe. Bisection re-visits the endpoints, and each visit is a full
// Monte Carlo run, so the cache is worth its four lines. Exported for corridor.js,
// which probes a different free variable against the same simulator.
export function prober(p, nSims, mutate) {
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
  return bisect(prober(base, nSims, (q, a) => { q.retAge = a; }), lo, hi, target, 1, true, true);
}

// Highest annual spend that still clears `target`, for a fixed retirement age.
//
// The direction is reversed — spending less can only help — so the bisection keeps
// a passing low end and a failing high end and closes the gap between them.
export function solveSpend(p, nSims, target, age, maxSpend) {
  const base = clone(p);
  base.retAge = age;
  const lo = 0, hi = Math.max(SPEND_TOL * 4, maxSpend);
  // Falling: spending nothing is the friendliest case there is, so "none" here means
  // even that misses the target and the plan is short somewhere other than lifestyle,
  // while "all" means the search cap is what's binding rather than the plan.
  const r = bisect(prober(base, nSims, (q, v) => { q.spend = v; }), lo, hi, target, SPEND_TOL, false, false);
  // Reported down to a round hundred, and rounded *down* on purpose: that keeps the
  // figure on the side that still clears the target, which is the whole point of it.
  // `success` stays the one measured at the unrounded crossing.
  return r.status === "solved" ? Object.assign({}, r, { value: Math.floor(r.value / SPEND_ROUND) * SPEND_ROUND }) : r;
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
