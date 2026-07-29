// Seeded RNG and the common-random-numbers (CRN) sampling matrix.
//
// Every simulation run reuses one fixed matrix of sampled year-sequences, so a
// change in an assumption reflects THAT assumption rather than simulation noise.
// The matrix is a circular block bootstrap: contiguous runs of `blockLen` years
// (blockLen === 1 gives independent years) drawn from the historical record.
import { N } from "../data/history.js";

// Maximum number of years any single simulated life can span.
export const MAXY = 100;

let seed = 0x9e3779b9;
let idx = null;
let idxSims = 0;
let idxBlock = 0;

// Small, fast, seedable PRNG (mulberry32). Returns a function yielding [0, 1).
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// (Re)build the sampling matrix: nSims lives × MAXY years of history indices.
export function buildIndex(nSims, blockLen) {
  const L = Math.max(1, blockLen);
  idx = new Uint8Array(nSims * MAXY);
  const rng = mulberry32(seed);
  for (let s = 0; s < nSims; s++) {
    const base = s * MAXY;
    let pos = 0;
    while (pos < MAXY) {
      const start = (rng() * N) | 0;
      for (let k = 0; k < L && pos < MAXY; k++) { idx[base + pos] = (start + k) % N; pos++; }
    }
  }
  idxSims = nSims;
  idxBlock = L;
}

// Ensure the matrix matches the requested size/block, rebuilding only if needed.
export function ensureIndex(nSims, blockLen) {
  const L = Math.max(1, blockLen);
  if (!idx || idxSims !== nSims || idxBlock !== L) buildIndex(nSims, L);
}

// Lighter guard used where the sim count is already correct and only the block
// length may have changed (the heatmap sweeps block-dependent parameters).
export function ensureIndexBlock(nSims, blockLen) {
  const L = Math.max(1, blockLen);
  if (idxBlock !== L) buildIndex(nSims, L);
}

// Advance the seed to draw a fresh, independent set of histories.
export function reshuffleSeed() {
  seed = (seed * 1664525 + 1013904223) >>> 0;
}

export function getIndex() { return idx; }
export function indexBlock() { return idxBlock; }
