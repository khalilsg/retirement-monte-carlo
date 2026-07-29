// The Monte Carlo engine: three pure simulators over the CRN sampling matrix.
//   simSuccess  — just the headline probability (cheap; used for sweeps/tornado).
//   simFull     — percentile bands + summary stats for the balance fan chart.
//   simSequence — sequence-of-returns attribution + conditional survival.
// All three share one accumulation/withdrawal recurrence; they differ only in what
// they record. Callers must ensure the sampling matrix is built (see rng.js).
import { RS, RB, INF } from "../data/history.js";
import { getIndex, MAXY } from "./rng.js";
import { phaseOf, allocFor, streamArrays } from "./model.js";

// Linear-interpolated quantile of a pre-sorted array.
export function q(a, p) {
  const i = p * (a.length - 1), lo = i | 0, f = i - lo;
  return lo + 1 < a.length ? a[lo] * (1 - f) + a[lo + 1] * f : a[lo];
}

// Headline success probability only.
export function simSuccess(p, nSims) {
  const IDX = getIndex();
  const w = allocFor(p), fee = p.fee, start = p.start, base = p.spend, txf = 1 - (p.tax || 0), contrib = p.contribution || 0;
  const ph = phaseOf(p), A = ph.A, T = ph.T;
  const guard = p.spendMode === "guardrails", gBand = p.gBand, step = p.gStep, floor = base * p.gFloor, ceil = base * p.gCeiling;
  const S = streamArrays(p), sn = S.n, sAmt = S.amt, sFrom = S.from, sTo = S.to, sCola = S.cola, sf = S.sf;
  let succ = 0;
  for (let s = 0; s < nSims; s++) {
    let bal = start, spend = base, alive = true, cumInf = 1, upper = Infinity, lower = 0;
    const bx = s * MAXY;
    for (let y = 0; y < T; y++) {
      const retired = y >= A;
      if (retired) {
        if (y === A) { const iwr = bal > 0 ? base / bal : 0; upper = iwr * (1 + gBand); lower = iwr * (1 - gBand); }
        else if (guard) {
          const wr = bal > 0 ? spend / bal : Infinity;
          if (wr > upper) { spend *= (1 - step); if (spend < floor) spend = floor; }
          else if (wr < lower) { spend *= (1 + step); if (spend > ceil) spend = ceil; }
        }
      }
      let inc = 0;
      for (let i = 0; i < sn; i++) if (y >= sFrom[i] && y <= sTo[i]) {
        if (sCola[i]) inc += sAmt[i];
        else { if (y === sFrom[i]) sf[i] = cumInf; inc += sAmt[i] * sf[i] / cumInf; }
      }
      const net = (retired ? spend : 0) - inc - (retired ? 0 : contrib);
      bal -= net > 0 ? net / txf : net;
      if (retired && bal <= 0) { alive = false; break; }
      const j = IDX[bx + y], ww = w[y];
      bal *= 1 + (ww * RS[j] + (1 - ww) * RB[j] - fee);
      cumInf *= INF[j];
    }
    if (alive && bal > 0) succ++;
  }
  return (succ / nSims) * 100;
}

// Full run: percentile bands over time plus end-balance / nest-egg / spend stats.
export function simFull(p, nSims) {
  const IDX = getIndex();
  const w = allocFor(p), fee = p.fee, start = p.start, base = p.spend, txf = 1 - (p.tax || 0), contrib = p.contribution || 0;
  const ph = phaseOf(p), A = ph.A, T = ph.T, ca = ph.ca;
  const guard = p.spendMode === "guardrails", gBand = p.gBand, step = p.gStep, floor = base * p.gFloor, ceil = base * p.gCeiling;
  const S = streamArrays(p), sn = S.n, sAmt = S.amt, sFrom = S.from, sTo = S.to, sCola = S.cola, sf = S.sf;
  const cols = new Array(T + 1);
  for (let y = 0; y <= T; y++) cols[y] = new Float64Array(nSims);
  const depYear = [], minSpendArr = new Float64Array(nSims), nestArr = new Float64Array(nSims);
  let succ = 0;
  for (let s = 0; s < nSims; s++) {
    let bal = start, spend = base, minSpend = base, alive = true, depY = 0, cumInf = 1, upper = Infinity, lower = 0;
    cols[0][s] = start;
    const bx = s * MAXY;
    for (let y = 0; y < T; y++) {
      const retired = y >= A;
      if (retired) {
        if (y === A) { const iwr = bal > 0 ? base / bal : 0; upper = iwr * (1 + gBand); lower = iwr * (1 - gBand); }
        else if (guard) {
          const wr = bal > 0 ? spend / bal : Infinity;
          if (wr > upper) { spend *= (1 - step); if (spend < floor) spend = floor; }
          else if (wr < lower) { spend *= (1 + step); if (spend > ceil) spend = ceil; }
          if (spend < minSpend) minSpend = spend;
        }
      }
      let inc = 0;
      for (let i = 0; i < sn; i++) if (y >= sFrom[i] && y <= sTo[i]) {
        if (sCola[i]) inc += sAmt[i];
        else { if (y === sFrom[i]) sf[i] = cumInf; inc += sAmt[i] * sf[i] / cumInf; }
      }
      const net = (retired ? spend : 0) - inc - (retired ? 0 : contrib);
      bal -= net > 0 ? net / txf : net;
      if (retired && bal <= 0) { for (let k = y + 1; k <= T; k++) cols[k][s] = 0; alive = false; depY = y + 1; break; }
      const j = IDX[bx + y], ww = w[y];
      bal *= 1 + (ww * RS[j] + (1 - ww) * RB[j] - fee);
      cumInf *= INF[j];
      cols[y + 1][s] = bal;
    }
    nestArr[s] = cols[A][s];
    minSpendArr[s] = minSpend;
    if (alive && bal > 0) succ++; else depYear.push(depY || T);
  }
  const pcts = { p10: [], p25: [], p50: [], p75: [], p90: [] };
  let ymax = 0;
  for (let y = 0; y <= T; y++) {
    const arr = cols[y]; arr.sort();
    pcts.p10.push(q(arr, 0.10)); pcts.p25.push(q(arr, 0.25)); pcts.p50.push(q(arr, 0.50));
    pcts.p75.push(q(arr, 0.75)); pcts.p90.push(q(arr, 0.90));
    if (pcts.p90[y] > ymax) ymax = pcts.p90[y];
  }
  const ending = cols[T];
  const medEnd = q(ending, 0.50), p10End = q(ending, 0.10), worst = ending[0];
  const medLowSpend = q(Float64Array.from(minSpendArr).sort(), 0.50);
  const medNest = q(Float64Array.from(nestArr).sort(), 0.50);
  let medDep = null;
  if (depYear.length) { depYear.sort((a, b) => a - b); medDep = depYear[(depYear.length * 0.5) | 0]; }
  return { successPct: (succ / nSims) * 100, pcts, ymax, medEnd, p10End, worst, medDep, medLowSpend, medNest, guard, h: T, A, ca, retAge: ca + A, retYears: T - A };
}

// Sequence-of-returns analysis: a smoothed-returns counterfactual attributes each
// failure to bad ordering vs. inadequate magnitude, and tracks conditional survival
// for paths still at or above their retirement-date nest egg.
export function simSequence(p, nSims) {
  const IDX = getIndex();
  const w = allocFor(p), fee = p.fee, start = p.start, base = p.spend, txf = 1 - (p.tax || 0), contrib = p.contribution || 0;
  const ph = phaseOf(p), A = ph.A, T = ph.T, ca = ph.ca;
  const guard = p.spendMode === "guardrails", gBand = p.gBand, step = p.gStep, floor = base * p.gFloor, ceil = base * p.gCeiling;
  const St = streamArrays(p), sn = St.n, sAmt = St.amt, sFrom = St.from, sTo = St.to, sCola = St.cola;
  const sfA = new Float64Array(sn), sfS = new Float64Array(sn), balN = new Float64Array(T + 1);
  const onCnt = new Float64Array(T + 1), onSucc = new Float64Array(T + 1);
  let failActual = 0, magFail = 0, seqFail = 0, lucky = 0, succCount = 0;
  for (let s = 0; s < nSims; s++) {
    const bx = s * MAXY;
    // --- actual ordered path ---
    let bal = start, spend = base, cumInf = 1, aliveA = true, prod = 1, upper = Infinity, lower = 0, nest = start;
    balN[0] = start;
    for (let y = 0; y < T; y++) {
      const j = IDX[bx + y], r = w[y] * RS[j] + (1 - w[y]) * RB[j] - fee, retired = y >= A;
      prod *= (1 + r);
      if (aliveA) {
        if (retired) {
          if (y === A) { nest = bal; const iwr = bal > 0 ? base / bal : 0; upper = iwr * (1 + gBand); lower = iwr * (1 - gBand); }
          else if (guard) { const wr = bal > 0 ? spend / bal : Infinity; if (wr > upper) { spend *= (1 - step); if (spend < floor) spend = floor; } else if (wr < lower) { spend *= (1 + step); if (spend > ceil) spend = ceil; } }
        }
        let inc = 0;
        for (let i = 0; i < sn; i++) if (y >= sFrom[i] && y <= sTo[i]) { if (sCola[i]) inc += sAmt[i]; else { if (y === sFrom[i]) sfA[i] = cumInf; inc += sAmt[i] * sfA[i] / cumInf; } }
        const net = (retired ? spend : 0) - inc - (retired ? 0 : contrib);
        bal -= net > 0 ? net / txf : net;
        if (retired && bal <= 0) { aliveA = false; balN[y + 1] = 0; } else { bal *= (1 + r); cumInf *= INF[j]; balN[y + 1] = bal; }
      } else balN[y + 1] = 0;
    }
    const successA = aliveA && bal > 0;
    if (successA) succCount++;
    // on-track during retirement, referenced to that path's nest egg at retirement
    for (let Nn = A; Nn <= T; Nn++) if (balN[Nn] >= nest && balN[Nn] > 0) { onCnt[Nn]++; if (successA) onSucc[Nn]++; }
    // --- smoothed counterfactual ---
    const gmean = T > 0 ? Math.pow(prod, 1 / T) - 1 : 0;
    let bals = start, spends = base, cumInfS = 1, aliveS = true, upS = Infinity, loS = 0;
    for (let y = 0; y < T; y++) {
      const j = IDX[bx + y], retired = y >= A;
      if (retired) {
        if (y === A) { const iwr = bals > 0 ? base / bals : 0; upS = iwr * (1 + gBand); loS = iwr * (1 - gBand); }
        else if (guard) { const wr = bals > 0 ? spends / bals : Infinity; if (wr > upS) { spends *= (1 - step); if (spends < floor) spends = floor; } else if (wr < loS) { spends *= (1 + step); if (spends > ceil) spends = ceil; } }
      }
      let inc = 0;
      for (let i = 0; i < sn; i++) if (y >= sFrom[i] && y <= sTo[i]) { if (sCola[i]) inc += sAmt[i]; else { if (y === sFrom[i]) sfS[i] = cumInfS; inc += sAmt[i] * sfS[i] / cumInfS; } }
      const net = (retired ? spends : 0) - inc - (retired ? 0 : contrib);
      bals -= net > 0 ? net / txf : net;
      if (retired && bals <= 0) { aliveS = false; break; }
      bals *= (1 + gmean); cumInfS *= INF[j];
    }
    const successS = aliveS && bals > 0;
    if (!successA) { failActual++; if (successS) seqFail++; else magFail++; } else if (!successS) lucky++;
  }
  const cond = new Float64Array(T + 1), onFrac = new Float64Array(T + 1);
  for (let Nn = 0; Nn <= T; Nn++) { cond[Nn] = onCnt[Nn] > 0 ? onSucc[Nn] / onCnt[Nn] * 100 : NaN; onFrac[Nn] = onCnt[Nn] / nSims * 100; }
  return { h: T, A, ca, nSims, start, successPct: succCount / nSims * 100, failActual: failActual / nSims * 100,
    magFail: magFail / nSims * 100, seqFail: seqFail / nSims * 100, lucky: lucky / nSims * 100,
    seqShare: failActual > 0 ? seqFail / failActual * 100 : NaN, cond, onFrac };
}

// First retirement year from which conditional success stays at/above `target`.
export function safeYearFrom(cond, target) {
  const h = cond.length - 1;
  for (let N = 1; N <= h; N++) {
    let ok = !isNaN(cond[N]) && cond[N] >= target;
    for (let k = N; k <= h && ok; k++) if (!isNaN(cond[k]) && cond[k] < target) ok = false;
    if (ok) return N;
  }
  return null;
}
