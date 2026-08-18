// Deriving the fixed, per-plan shape of a simulation from a params object:
// the timeline phases, the year-by-year equity allocation, and flattened income
// streams. These are cheap, pure helpers the hot simulation loops build on.
import { MAXY } from "./rng.js";

// Timeline phases on an age basis.
//   A = accumulation years (until retirement); retirement runs years A..T-1.
//   T = total years modeled (capped at MAXY).
export function phaseOf(p) {
  const ca = p.curAge;
  const ra = Math.max(ca, p.retAge);
  const ea = Math.max(ra + 1, p.endAge);
  const T = Math.max(1, Math.min(MAXY, ea - ca));
  const A = Math.min(Math.max(0, ra - ca), T - 1);
  return { ca, A, T };
}

// Equity share for each modeled year. A glide path moves linearly from start to
// end across the whole lifecycle; otherwise the fixed mix is held throughout.
export function allocFor(p) {
  const T = phaseOf(p).T;
  const a = new Float64Array(T);
  if (p.allocMode === "glide") {
    for (let y = 0; y < T; y++) a[y] = T <= 1 ? p.glideStart : p.glideStart + (p.glideEnd - p.glideStart) * (y / (T - 1));
  } else {
    a.fill(p.stock);
  }
  return a;
}

// Flatten income streams into typed arrays keyed to year offsets from today, ready
// for the hot loop. `sf` holds the per-stream inflation snapshot captured when a
// non-COLA stream begins (so its real value can erode thereafter).
//
// A stream's from/to are read on one of two bases. "age" is a fixed age, so the
// stream sits still while everything else moves. "ret" measures years from
// retirement (0 = the year you retire, negative = before it), so the stream slides
// with retAge — which is what makes "retire at X and take a job paying Y" a single
// heatmap rather than one chart per retirement age.
export function streamArrays(p) {
  const st = p.streams || [];
  const n = st.length;
  const ca = p.curAge;
  // The same retirement offset the simulation loops use for `retired = y >= A`, so
  // a stream anchored at retirement starts exactly when retirement does.
  const A = phaseOf(p).A;
  const amt = new Float64Array(n);
  const from = new Int32Array(n);
  const to = new Int32Array(n);
  const cola = new Uint8Array(n);
  const sf = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const s = st[i], rel = s.basis === "ret";
    const f = rel ? A + (s.from || 0) : (s.from == null ? ca : s.from) - ca;
    const t = s.to == null ? 1e9 : (rel ? A + s.to : s.to - ca);
    amt[i] = s.amount || 0;
    // A window that opened before today starts today instead. One that already
    // closed pays nothing — clamping its end up to 0 as well would squeeze a
    // finished pension into a single payment in year 0.
    from[i] = Math.max(0, f);
    to[i] = t < 0 ? -1 : t;
    cola[i] = s.cola ? 1 : 0;
  }
  return { n, amt, from, to, cola, sf };
}
