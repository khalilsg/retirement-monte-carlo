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
export function streamArrays(p) {
  const st = p.streams || [];
  const n = st.length;
  const ca = p.curAge;
  const amt = new Float64Array(n);
  const from = new Int32Array(n);
  const to = new Int32Array(n);
  const cola = new Uint8Array(n);
  const sf = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    amt[i] = st[i].amount || 0;
    from[i] = Math.max(0, (st[i].from == null ? ca : st[i].from) - ca);
    to[i] = st[i].to == null ? 1e9 : Math.max(0, st[i].to - ca);
    cola[i] = st[i].cola ? 1 : 0;
  }
  return { n, amt, from, to, cola, sf };
}
