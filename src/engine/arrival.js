// Re-solving each rung at its own date: what the ladder's answer becomes once the
// market has had its say between now and then.
//
// A rung is currently a point — "this tier, earliest age 44" — and that hides the
// thing a reader most needs, which is that 44 is a forecast of a future forecast.
// The balance you actually arrive with at 44 spans a wide range, and the ladder's
// answer moves with it.
//
// The cheap way to get the whole distribution rests on one property: success is
// monotone in the balance you start from (verified across guardrails, a glide path
// and both income-stream bases — unlike the age search in ladder.js, which cannot
// promise monotonicity and says so). Monotone means a quantile of the arrival
// balance IS a quantile of the answer, so the fan comes from one solve per quantile
// rather than a Monte Carlo nested inside a Monte Carlo.
//
// What each quantile is re-solved for is the same quantity the tier itself solves
// for, which is what lets the result be drawn as a band on the panel's own axis: a
// spend-anchored tier re-solves for the age it could actually stop at, an
// age-anchored one for the spend it could actually afford.
//
// ---------------------------------------------------------------------------
// The caveat, measured rather than assumed.
//
// Standing at the date with balance B and re-simulating forward treats the years
// after the date as independent of the years before it. Under independent-year
// sampling that is exactly true, so the method is exact. Under block sampling it is
// not: arriving low correlates with sitting inside a bad run that has further to go,
// so a fresh-draw re-solve reads slightly optimistic in the left tail.
//
// Measured on a 15-year runway at 85% equities, 80,000 paths, comparing the true
// conditional success rate of paths arriving in a band against the re-solve at that
// band's median balance: the gap at the 5th percentile is +3.3 points under 5-year
// blocks against +1.8 for the identical measurement under independent years. That
// second figure is a measurement artifact, not an error — comparing a band average
// against a point estimate where the success curve is steepest — so the effect
// attributable to blocks is the difference, about 1.5 points, in the direction of
// making a bad draw look slightly better than it is.
//
// That is small enough to note rather than design around. The alternative — continue
// each arriving path with its own remaining draws, which preserves the correlation
// exactly — costs about the same, but measured in the units this feature actually
// reports (a spend, a number of years) the two agreed to within the noise of the
// available band sizes, so there was no evidence it was the better estimator.
import { simSuccess } from "./simulate.js";
import { solveAge, solveSpend, applyVariant } from "./ladder.js";
import { getIndex, MAXY } from "./rng.js";
import { RS, RB, INF } from "../data/history.js";
import { phaseOf, allocFor, streamArrays } from "./model.js";
import { q } from "./simulate.js";

// The quantiles the fan is solved at. The outer pair bounds the band drawn behind
// each dumbbell; the median is what the band is read against. Three is a deliberate
// ceiling — every extra one is a full bisection per tier per scenario, and the
// ladder is already the most expensive thing on the settle path.
export const FAN_PCTS = [0.10, 0.50, 0.90];

// Balances on the retirement date, one per simulated path, sorted.
//
// The accumulation phase only: the fan asks what you arrive with, and simulating
// the retirement years as well would be most of the cost of simFull for a number it
// throws away. Income streams still matter here — a scenario that replaces the
// plan's streams can remove one that was paying before the date.
export function simArrival(p, nSims) {
  const IDX = getIndex();
  const w = allocFor(p), fee = p.fee, txf = 1 - (p.tax || 0), contrib = p.contribution || 0;
  const A = phaseOf(p).A;
  const S = streamArrays(p), sn = S.n, sAmt = S.amt, sFrom = S.from, sTo = S.to, sCola = S.cola, sf = S.sf;
  const out = new Float64Array(nSims);
  for (let s = 0; s < nSims; s++) {
    let bal = p.start, cumInf = 1;
    const bx = s * MAXY;
    for (let y = 0; y < A; y++) {
      let inc = 0;
      for (let i = 0; i < sn; i++) if (y >= sFrom[i] && y <= sTo[i]) {
        if (sCola[i]) inc += sAmt[i];
        else { if (y === sFrom[i]) sf[i] = cumInf; inc += sAmt[i] * sf[i] / cumInf; }
      }
      // Nothing is being withdrawn yet, so the whole flow is inbound: the gross-up
      // applies only to a net withdrawal, exactly as in the simulators.
      const net = -inc - contrib;
      bal -= net > 0 ? net / txf : net;
      const j = IDX[bx + y];
      bal *= 1 + (w[y] * RS[j] + (1 - w[y]) * RB[j] - fee);
      cumInf *= INF[j];
    }
    out[s] = bal;
  }
  out.sort();
  return out;
}

// The date a cell's answer lands on, or null when there isn't one.
//
// A tier anchored on an age names its own date. One anchored on a spend gets its
// date from the solve — which is only a date when the solve actually crossed. The
// two no-crossing cases have nothing to arrive at: "already, at 55" means the date
// is today and the arrival distribution is a single point, and "not by 94" never
// arrives at all. Returning null for both is what keeps a band off a rung that has
// no answer to put one around.
export function fanDate(tier, cell) {
  if (tier.anchor === "age") return cell.status === "solved" ? tier.age : null;
  return cell.status === "solved" ? cell.value : null;
}

// Re-solve one cell at each arrival quantile.
//
// Returns null where there is no date to arrive at, otherwise one point per
// quantile carrying the balance and the full tagged solve. The solves keep
// ladder.js's three outcomes rather than flattening them: a bad draw that still
// clears from the first age searched, and one that never clears at all, are both
// real answers and neither is a number.
export function solveFan(p, nSims, cfg, tier, variant, cell) {
  const date = fanDate(tier, cell);
  if (date == null) return null;
  const base = applyVariant(p, variant);
  // The arrival distribution is measured on the way to this cell's own date, which
  // for a spend-anchored tier is the age that cell solved for — not the plan's
  // retirement age. A tier answering "earliest age 44" needs its fan at 44.
  const arriving = Object.assign({}, base, { retAge: date });
  const nests = simArrival(arriving, nSims);
  const points = FAN_PCTS.map(pct => {
    const balance = q(nests, pct);
    // Standing at the date with that balance: the plan's remaining life, re-asked.
    const at = Object.assign({}, base, { curAge: date, start: balance });
    const solved = tier.anchor === "age"
      ? Object.assign({ solvedFor: "spend" }, solveSpend(at, nSims, cfg.target, date, cfg.maxSpend))
      : Object.assign({ solvedFor: "age" }, solveAge(at, nSims, cfg.target, tier.spend));
    return Object.assign({ pct, balance }, solved);
  });
  return { date, points };
}

// Every cell's fan, shaped to sit alongside a solveLadder result: rows in the same
// order, cells in the same order, null where a rung has no date.
export function solveArrivals(p, nSims, cfg, out) {
  return out.rows.map(row => row.cells.map((cell, i) => solveFan(p, nSims, cfg, row.tier, out.scenarios[i], cell)));
}

// What arriving at the low end of the fan costs, against the cell's own answer.
//
// This is the decision content of the whole feature: a 15% failure probability is
// not ruin, it is a mid-course correction you can see coming, and this says how big
// the correction is. `delta` is signed in the axis's own units — years for an age
// solve, dollars per year for a spend solve — and is null when either end of the
// comparison isn't a figure.
export function fanCost(cell, fan, pct) {
  if (!fan) return null;
  const pt = fan.points.find(o => o.pct === pct);
  if (!pt) return null;
  if (pt.status !== "solved" || cell.status !== "solved") return { pt, delta: null };
  return { pt, delta: pt.value - cell.value };
}
