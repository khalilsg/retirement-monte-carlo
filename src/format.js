// Number/string formatting shared across the config, chart, and UI layers.

// Compact money for chart labels and stat tiles: $1.5M, $70k, $420.
export function fmtMoney(x) {
  const neg = x < 0; x = Math.abs(x); let s;
  if (x >= 1e6) s = "$" + (x / 1e6).toFixed(x >= 1e7 ? 1 : 2).replace(/\.?0+$/, "") + "M";
  else if (x >= 1e3) s = "$" + Math.round(x / 1e3) + "k";
  else s = "$" + Math.round(x);
  return (neg ? "−" : "") + s;
}

// Full money with thousands separators, e.g. $1,500,000.
export function fmtFull(x) { return "$" + Math.round(x).toLocaleString("en-US"); }

// Parse a user-typed number, tolerating $, commas, and stray characters.
export function parseNum(str) { const n = parseFloat(String(str).replace(/[^0-9.\-]/g, "")); return isFinite(n) ? n : 0; }

// Round and group with thousands separators (for text inputs).
export function commafy(n) { return Math.round(n).toLocaleString("en-US"); }

// Escape user-provided text before interpolating into innerHTML.
export function escapeHtml(s) { return String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
