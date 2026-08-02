// Small SVG + tooltip helpers shared by every chart.
import { el } from "../dom.js";

export const NS = "http://www.w3.org/2000/svg";

// Create an SVG element with the given attributes.
export function svgEl(tag, attrs) {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  return e;
}

// How much bigger chart text is than its 10px desktop size at the current width.
//
// Every chart draws into a fixed 760-wide viewBox that scales to its container, so
// on a phone (~0.38x) 10px labels land on screen at under 4px. app.css bumps the
// SVG font sizes back up on the same three breakpoints — but bigger glyphs need
// proportionally bigger gutters, or the axis labels run straight through the
// rotated axis title. Anything that reserves room for text multiplies by this.
// Keep the breakpoints here in step with the ones in app.css.
export function textScale() {
  const w = window.innerWidth;
  return w <= 400 ? 2.5 : w <= 520 ? 1.9 : w <= 700 ? 1.4 : 1;
}

// Round a value up to a "nice" axis maximum (1, 2, 2.5, 5, 10 × 10^k).
export function niceMax(v) {
  if (v <= 0) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(v))), n = v / mag;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * mag;
}

// The single shared floating tooltip element.
export function tooltip() { return el("tt"); }

// Position the tooltip near the cursor, flipping left if it would overflow.
export function placeTooltip(tt, ev) {
  const tb = tt.getBoundingClientRect();
  let lx = ev.clientX + 14;
  if (lx + tb.width > window.innerWidth - 8) lx = ev.clientX - tb.width - 14;
  tt.style.left = lx + "px";
  tt.style.top = (ev.clientY - tb.height - 6) + "px";
}
