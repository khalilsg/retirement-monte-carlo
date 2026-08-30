// The glide corridor: the balance you need at each age between now and a rung's
// date to keep that rung alive.
//
// The ladder answers as of today — "at this lifestyle, the earliest you could stop
// is 58" — and the arrival range (arrival.js) says how far that answer travels. Both
// are probabilities, and a probability is an awkward thing to steer by: it is
// guaranteed to move, so watching it jitter year over year tells you very little.
//
// This converts it into something checkable. For each age on the way to the date,
// bisect on the STARTING BALANCE for the point where the rung's success rate hits
// the target. String those together and you have one line, and one question you can
// answer once a year and act on: am I above it?
//
// ---------------------------------------------------------------------------
// What the line assumes, which decides what it means.
//
// The balance at age `a` is solved with the plan still running: contributions
// continue from `a` to the date, and every income stream still arrives. So the line
// reads "the balance that keeps this rung ON TRACK", not "the balance that would
// carry it if I stopped saving today". On a contribution-heavy plan those are wildly
// different — fifteen years of contributions can be most of what gets you there, so
// the on-track line sits far below your balance and converges toward the date, while
// a stop-saving line would start above it. The chart says which one it is, because a
// reader who assumes the other one draws the opposite conclusion from the same line.
//
// Bisecting on the balance is on firmer ground than the ladder's own age search:
// success is genuinely monotone in the money you start with (checked directly in
// test/corridor.test.js, under guardrails and a glide path and both stream bases),
// whereas solveAge can only promise it finds *a* crossing.
import { simFull } from "./simulate.js";
import { applyVariant, bisect, prober } from "./ladder.js";
import { fanDate } from "./arrival.js";

// Solved to the nearest thousand. Finer than the chart can draw and finer than the
// figure deserves — this is a number you check a balance against once a year, not a
// threshold to land on exactly.
const START_TOL = 1000;

// The search ceiling for the balance. Sixty years of spending is far past what any
// plan of this shape needs (a 4% rule wants twenty-five), so a rung that fails to
// cross even here is failing for a reason other than the size of the pot.
function startCap(p, spend) {
  return Math.max(spend * 60, p.start * 10, 1e6);
}

// At most this many solved ages. A thirty-year runway solved year by year is thirty
// bisections, each a full Monte Carlo per step, which puts a single corridor past
// what the whole ladder costs. Stepping keeps it bounded; the line is a smooth curve
// and reads no differently for it.
const MAX_POINTS = 16;

// The ages the corridor is solved at: both ends always, evenly stepped between.
export function corridorAges(from, to) {
  const span = to - from;
  if (span < 2) return null;
  const step = Math.max(1, Math.ceil(span / (MAX_POINTS - 1)));
  const out = [];
  for (let a = from; a < to; a += step) out.push(a);
  out.push(to);
  return out;
}

// What the corridor holds fixed, read off the rung the ladder already solved.
//
// The pairing is the same either way round: whatever the ladder ended up with is
// what the corridor asks you to sustain. A spend-anchored tier names the spend and
// the ladder found the date; an age-anchored tier names the date and the ladder
// found the spend. Both then have a date to march toward and a spend to hold.
export function corridorTarget(tier, cell) {
  const date = fanDate(tier, cell);
  if (date == null) return null;
  return { date, spend: cell.solvedFor === "spend" ? cell.value : tier.spend };
}

// The corridor for one rung under one scenario, plus the balance percentiles you are
// actually projected to follow on the way there — the line is only useful against
// something, and "am I above it?" needs both drawn together.
//
// Returns null where there is nothing to draw: a rung with no crossing has no date
// (the ladder's three outcomes again), and a date less than two years out is a point
// rather than a track.
export function solveCorridor(p, nSims, cfg, tier, variant, cell) {
  const t = corridorTarget(tier, cell);
  if (!t) return null;
  const ages = corridorAges(p.curAge, t.date);
  if (!ages) return null;

  const base = applyVariant(p, variant);
  // Held for every probe: retiring on this rung's date, at this rung's spend. Only
  // the age we are standing at and the balance we are standing on will vary.
  const held = Object.assign({}, base, { retAge: t.date, spend: t.spend });
  const hi = startCap(p, t.spend);

  const points = ages.map(age => {
    // Standing at `age` with some balance, still contributing through to the date.
    const at = prober(Object.assign({}, held, { curAge: age }), nSims, (q, v) => { q.start = v; });
    // Rising: more money can only help, so the answer is the lowest balance that
    // still clears. "all" means even arriving at this age with nothing still clears
    // — contributions and income carry the rung on their own — and "none" means no
    // balance in range does, which is a plan that is short somewhere else entirely.
    return Object.assign({ age }, bisect(at, 0, hi, cfg.target, START_TOL, true, false));
  });

  // The projected track, from the same plan and the same sampling matrix, so the two
  // lines are comparable rather than two separate stories about the same years.
  const r = simFull(held, nSims);
  const bands = { ages: [], p10: [], p25: [], p50: [], p75: [], p90: [] };
  for (let i = 0; i <= r.A; i++) {
    bands.ages.push(p.curAge + i);
    for (const k of ["p10", "p25", "p50", "p75", "p90"]) bands[k].push(r.pcts[k][i]);
  }
  return { date: t.date, spend: t.spend, points, bands };
}

// Where a projected percentile sits against the corridor.
//
// The percentile is a parameter, and choosing it is the whole subtlety. Comparing
// the MEDIAN against the line looks like the obvious reading and is nearly vacuous:
// the rung is defined as the point where the plan hits the target, so by the tower
// property the median arrival clears it essentially by construction — it comes back
// "above" for any rung the ladder managed to solve, which tells you nothing you
// didn't already know from the ladder.
//
// The reading with content is the lower band. A plan whose median sails above the
// corridor can still have its 10th percentile duck under it early, and the age where
// that happens is the one worth writing down: it is when a bad run stops being
// something you ride out and starts being something you act on.
//
// Tagged rather than a bare age, for the same reason every solve here is: "never
// falls below" and "below from the very start" are opposite findings that would both
// come back as a null age.
//   "above"   — clears the corridor at every solved age
//   "below"   — short from the first age, so there is no crossing to name
//   "crosses" — clears through `age` and falls behind after
export function corridorCrossing(c, key = "p10") {
  if (!c || !c.points.length || !c.bands[key]) return null;
  const need = a => {
    const pt = c.points.find(o => o.age === a);
    // "none" means no balance in range clears the rung at that age, so there is no
    // line to be above; skip it rather than treat it as a threshold of zero.
    return pt && pt.status !== "none" ? pt.value : null;
  };
  let lastAbove = null, sawAny = false;
  for (let i = 0; i < c.bands.ages.length; i++) {
    const n = need(c.bands.ages[i]);
    if (n == null) continue;
    sawAny = true;
    if (c.bands[key][i] >= n) lastAbove = c.bands.ages[i];
    else return lastAbove == null ? { status: "below" } : { status: "crosses", age: lastAbove };
  }
  return sawAny ? { status: "above" } : null;
}
