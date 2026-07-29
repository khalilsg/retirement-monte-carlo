// Number/string formatting shared across the config, chart, and UI layers.
//
// Private mode (see ui/privacy.js) makes every rendered dollar amount relative
// instead of absolute, so the app can be screen-shared without exposing real
// figures. Balances become a multiple of the reference amount ("1.84×") and
// annual flows become a percentage of it ("4.7%") — which for spending is just
// the withdrawal rate. Shapes, ratios, and probabilities survive intact.

let priv = false;
let unit = 1;        // the reference amount every private figure is relative to
let unitIsSpend = false;

export function isPrivate() { return priv; }
export function setPrivate(on) { priv = !!on; }

// Re-anchor the reference amount. Balance today is the natural unit; if the plan
// starts from zero (pure accumulation) fall back to annual spending.
export function setPrivacyUnit(start, spend) {
  unitIsSpend = !(start > 0);
  unit = unitIsSpend ? (spend > 0 ? spend : 1) : start;
}
export function unitLabel() { return unitIsSpend ? "your annual spending" : "your balance today"; }

// A private figure: `flow` amounts (per-year) read as a percent of the unit,
// balances as a multiple of it. `full` asks for the higher-precision variant.
function relative(x, flow, full) {
  const neg = x < 0; x = Math.abs(x) / unit;
  if (x === 0) return flow ? "0%" : "0";
  let s;
  if (flow) {
    const v = x * 100;
    s = (v >= 10 ? v.toFixed(full ? 1 : 0) : v >= 1 ? v.toFixed(full ? 2 : 1) : v.toFixed(2)) + "%";
  } else {
    s = (x >= 10 ? x.toFixed(full ? 2 : 1) : x.toFixed(full ? 3 : 2)) + "×";
  }
  return (neg ? "−" : "") + s;
}

// Compact money for chart labels and stat tiles: $1.5M, $70k, $420.
export function fmtMoney(x, flow) {
  if (priv) return relative(x, flow, false);
  const neg = x < 0; x = Math.abs(x); let s;
  if (x >= 1e6) s = "$" + (x / 1e6).toFixed(x >= 1e7 ? 1 : 2).replace(/\.?0+$/, "") + "M";
  else if (x >= 1e3) s = "$" + Math.round(x / 1e3) + "k";
  else s = "$" + Math.round(x);
  return (neg ? "−" : "") + s;
}

// Full money with thousands separators, e.g. $1,500,000.
export function fmtFull(x, flow) { return priv ? relative(x, flow, true) : "$" + Math.round(x).toLocaleString("en-US"); }

// Parse a user-typed number, tolerating $, commas, and stray characters.
export function parseNum(str) { const n = parseFloat(String(str).replace(/[^0-9.\-]/g, "")); return isFinite(n) ? n : 0; }

// Round and group with thousands separators (for text inputs).
export function commafy(n) { return Math.round(n).toLocaleString("en-US"); }

// The true contents of a text input. Private mode overwrites the visible value of
// money fields with their relative form and parks the real one in a data
// attribute, so every read of a money input must go through this.
export function inputVal(elm) { return elm.dataset.privReal != null ? elm.dataset.privReal : elm.value; }

// Escape user-provided text before interpolating into innerHTML.
export function escapeHtml(s) { return String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
