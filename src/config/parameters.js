// The single source of truth for every tunable assumption.
//
// Each PARAMS entry describes one control end-to-end: which DOM element backs it,
// how it maps into the params object the engine consumes, how its live label
// renders, how it serializes into a shareable scenario, and — when it's a numeric
// assumption — its sweep / tornado / heatmap metadata. Adding a new tunable means
// adding one entry here plus its HTML control; readParams, syncLabels, the scenario
// codec, and the sensitivity tools all derive from this list automatically.
import { fmtMoney, fmtFull, parseNum, commafy } from "../format.js";

// How a control's four representations relate for a given value "kind":
//   read        raw DOM string  -> engine params value
//   scenFromDom raw DOM string  -> stored scenario value
//   domFromScen stored scenario -> DOM value to write back
//   label       engine value    -> default live-label text
// "pct" controls display/serialize as whole percents but the engine stores fractions.
const REPR = {
  money:  { read: raw => parseNum(raw), scenFromDom: raw => parseNum(raw), domFromScen: v => commafy(parseNum(v)), label: v => fmtMoney(v) },
  int:    { read: raw => +raw,          scenFromDom: raw => +raw,          domFromScen: v => v,                     label: v => v },
  pct:    { read: raw => +raw / 100,    scenFromDom: raw => +raw,          domFromScen: v => v,                     label: v => (v * 100).toFixed(0) },
  select: { read: raw => raw,           scenFromDom: raw => raw,           domFromScen: v => v,                     label: null },
};

// The registry. Order matters only in that the subsequence of entries carrying a
// `sweep` block defines the order options appear in the sweep/axis dropdowns.
const RAW_PARAMS = [
  { param: "curAge", el: "cur-age", repr: "int", scen: "ca", label: { id: "cur-age-v" } },

  { param: "spend", el: "spend", repr: "money", scen: "spend", label: { id: "spend-v" },
    sweep: { label: "Annual spending", kind: "money", apply: (pp, v) => pp.spend = v, cur: p => p.spend, min: 0, range: p => [Math.round(p.spend * .5 / 1000) * 1000, Math.round(p.spend * 1.6 / 1000) * 1000], tw: p => [p.spend * .85, p.spend * 1.15] } },

  { param: "start", el: "start", repr: "money", scen: "start", label: { id: "start-v" },
    sweep: { label: "Balance today", kind: "money", apply: (pp, v) => pp.start = v, cur: p => p.start, min: 0, range: p => [Math.round(p.start * .5 / 10000) * 10000, Math.round(p.start * 1.6 / 10000) * 10000], tw: p => [p.start * .85, p.start * 1.15] } },

  { param: "retAge", el: "ret-age", repr: "int", scen: "ra", label: { id: "ret-age-v" },
    sweep: { label: "Retirement age", kind: "int", int: true, apply: (pp, v) => pp.retAge = Math.round(v), cur: p => p.retAge, min: 30, max: 90, range: p => [30, Math.min(90, p.endAge - 1)], tw: p => [p.retAge - 3, p.retAge + 3] } },

  { param: "endAge", el: "end-age", repr: "int", scen: "ea", label: { id: "end-age-v" },
    sweep: { label: "Plan-through age", kind: "int", int: true, apply: (pp, v) => pp.endAge = Math.round(v), cur: p => p.endAge, min: 60, max: 110, range: p => [Math.max(p.retAge + 5, 80), 105], tw: p => [p.endAge - 5, p.endAge + 5] } },

  { param: "contribution", el: "contrib", repr: "money", scen: "ct", label: { id: "contrib-v" },
    sweep: { key: "contrib", label: "Annual contribution", kind: "money", apply: (pp, v) => pp.contribution = v, cur: p => p.contribution, min: 0, range: p => [0, Math.max(50000, Math.round(p.spend / 1000) * 1000)], when: p => p.retAge > p.curAge, tw: p => [p.contribution * .7, p.contribution * 1.3] } },

  { param: "fee", el: "fee", repr: "pct", scen: "fee", label: { id: "fee-v", fmt: v => (v * 100).toFixed(2).replace(/0$/, "") },
    sweep: { label: "Fees (%)", kind: "pctDec", apply: (pp, v) => pp.fee = v / 100, cur: p => p.fee * 100, min: 0, max: 3, range: () => [0, 2], tw: p => [p.fee * 100 - 0.3, p.fee * 100 + 0.3] } },

  { param: "tax", el: "tax", repr: "pct", scen: "tx", label: { id: "tax-v", fmt: v => Math.round(v * 100) },
    sweep: { label: "Effective tax (%)", kind: "pctInt", int: true, apply: (pp, v) => pp.tax = v / 100, cur: p => p.tax * 100, min: 0, max: 60, range: () => [0, 35], tw: p => [p.tax * 100 - 5, p.tax * 100 + 5] } },

  { param: "spendMode", el: "spend-mode", repr: "select", scen: "sm" },

  { param: "stock", el: "stock", repr: "pct", scen: "stk", label: { id: "stock-v" },
    sweep: { label: "Stock allocation (%)", kind: "pctInt", int: true, apply: (pp, v) => pp.stock = v / 100, cur: p => p.stock * 100, min: 0, max: 100, range: () => [0, 100], when: p => p.allocMode === "fixed", tw: p => [p.stock * 100 - 15, p.stock * 100 + 15] } },

  { param: "glideStart", el: "glide-start", repr: "pct", scen: "gsv", label: { id: "glide-start-v" },
    sweep: { label: "Starting stock (%)", kind: "pctInt", int: true, apply: (pp, v) => pp.glideStart = v / 100, cur: p => p.glideStart * 100, min: 0, max: 100, range: () => [0, 100], when: p => p.allocMode === "glide", tw: p => [p.glideStart * 100 - 15, p.glideStart * 100 + 15] } },

  { param: "glideEnd", el: "glide-end", repr: "pct", scen: "gev", label: { id: "glide-end-v" },
    sweep: { label: "Ending stock (%)", kind: "pctInt", int: true, apply: (pp, v) => pp.glideEnd = v / 100, cur: p => p.glideEnd * 100, min: 0, max: 100, range: () => [0, 100], when: p => p.allocMode === "glide", tw: p => [p.glideEnd * 100 - 15, p.glideEnd * 100 + 15] } },

  { param: "allocMode", el: "alloc-mode", repr: "select", scen: "am" },

  { param: "gFloor", el: "g-floor", repr: "pct", scen: "gf", label: { id: "g-floor-v" },
    sweep: { label: "Spending floor (%)", kind: "pctInt", int: true, apply: (pp, v) => pp.gFloor = v / 100, cur: p => p.gFloor * 100, min: 30, max: 100, range: () => [50, 100], when: p => p.spendMode === "guardrails", tw: p => [p.gFloor * 100 - 10, p.gFloor * 100 + 10] } },

  { param: "gCeiling", el: "g-ceiling", repr: "pct", scen: "gc", label: { id: "g-ceiling-v" },
    sweep: { label: "Spending ceiling (%)", kind: "pctInt", int: true, apply: (pp, v) => pp.gCeiling = v / 100, cur: p => p.gCeiling * 100, min: 100, max: 250, range: () => [100, 160], when: p => p.spendMode === "guardrails" } },

  { param: "gBand", el: "g-band", repr: "pct", scen: "gb", label: { id: "g-band-v" },
    sweep: { label: "Guardrail band (±%)", kind: "pctInt", int: true, apply: (pp, v) => pp.gBand = v / 100, cur: p => p.gBand * 100, min: 1, max: 60, range: () => [5, 40], when: p => p.spendMode === "guardrails" } },

  { param: "gStep", el: "g-step", repr: "pct", scen: "gs", label: { id: "g-step-v" } },

  { param: "sampleMode", el: "sample-mode", repr: "select", scen: "smp" },

  // blockLen only takes effect under "blocks" sampling; the label mirrors the raw
  // slider (handled in the UI), so it carries no generic label here.
  { param: "blockLen", el: "block-len", repr: "int", scen: "bl",
    readParam: get => get("sample-mode") === "blocks" ? +get("block-len") : 1,
    sweep: { label: "Block length (yrs)", kind: "int", int: true, apply: (pp, v) => pp.blockLen = Math.max(1, Math.round(v)), cur: p => p.blockLen, min: 1, max: 20, range: () => [1, 12], when: p => p.blockLen > 1, crn: true } },

  // Control-only fields: they serialize into scenarios but aren't part of the engine
  // params object (the sim count is passed separately to the simulators).
  { el: "sims", repr: "int", scen: "sims" },
];

// Augment each entry with resolved read/label/scenario functions from its repr.
export const PARAMS = RAW_PARAMS.map(e => {
  const r = REPR[e.repr];
  return {
    ...e,
    read: e.read || r.read,
    scenFromDom: r.scenFromDom,
    domFromScen: r.domFromScen,
    labelText: e.label ? (e.label.fmt || r.label) : null,
  };
});

// Params that feed the engine (excludes control-only fields like `sims`).
export const PARAM_FIELDS = PARAMS.filter(e => e.param);
// Params with a serialized scenario key.
export const SCENARIO_FIELDS = PARAMS.filter(e => e.scen);
// Params with a live value label.
export const LABEL_FIELDS = PARAMS.filter(e => e.label);

// Sweep/tornado/heatmap registry, keyed as before and ordered by the registry.
export const SWEEP_META = {};
for (const e of PARAMS) if (e.sweep) SWEEP_META[e.sweep.key || e.param] = e.sweep;

// Sweep metadata for one income stream (streams are a dynamic, per-item family).
export function streamMeta(i, streams) {
  const s = streams[i], label = (s && s.label ? s.label : "Income " + (i + 1)) + " ($/yr)";
  return {
    label, kind: "money", min: 0,
    apply: (pp, v) => { if (pp.streams[i]) { pp.streams[i].amount = v; pp.streams[i].cola = true; } },
    cur: p => p.streams[i] ? p.streams[i].amount : 0,
    range: p => { const cur = p.streams[i] ? p.streams[i].amount : 0; return [0, Math.max(50000, Math.round(Math.max(p.spend, cur * 2) / 1000) * 1000)]; },
  };
}

// Resolve a sweep key (static param or "incN" stream) to its metadata.
export function getMeta(key, streams) {
  return key.indexOf("inc") === 0 ? streamMeta(+key.slice(3), streams) : SWEEP_META[key];
}

// Format a sweep value for a given parameter kind.
export function sweepFmt(meta, x, full) {
  if (meta.kind === "money") return full ? fmtFull(x) : fmtMoney(x);
  if (meta.kind === "pctDec") return x.toFixed(2) + "%";
  if (meta.kind === "pctInt") return Math.round(x) + "%";
  return String(Math.round(x));
}
