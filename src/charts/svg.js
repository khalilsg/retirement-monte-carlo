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

// Multiplier on a chart's desktop height, for the same widths textScale() steps at.
//
// Charts are a fixed 760 units wide and scale to fit, so their height *is* their
// rendered aspect ratio: at 1x they come out 2:1, which suits a wide screen and
// collapses to a strip on a portrait phone — the conditional-success curve had
// 0–100% to draw in 69px. Taller boxes cost nothing horizontally and buy the
// vertical resolution back. Independent of textScale because one is about how big
// the glyphs are and the other about the shape of the plot.
export function heightScale() {
  const w = window.innerWidth;
  return w <= 400 ? 1.65 : w <= 520 ? 1.55 : w <= 700 ? 1.25 : 1;
}

// Round a value up to a "nice" axis maximum (1, 2, 2.5, 5, 10 × 10^k).
export function niceMax(v) {
  if (v <= 0) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(v))), n = v / mag;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * mag;
}

// The single shared floating tooltip element.
export function tooltip() { return el("tt"); }

// Position the tooltip near the pointer, flipping if it would overflow.
//
// A fingertip covers roughly 44px and sits over the very point being read, so on a
// coarse pointer the tooltip centres on the touch and clears it by a fingertip
// instead of tucking to the right, where a thumb would be.
export function placeTooltip(tt, ev) {
  const tb = tt.getBoundingClientRect();
  const coarse = matchMedia("(pointer: coarse)").matches;
  const gap = coarse ? 44 : 6;
  let lx = coarse ? ev.clientX - tb.width / 2 : ev.clientX + 14;
  if (lx + tb.width > window.innerWidth - 8) lx = coarse ? window.innerWidth - 8 - tb.width : ev.clientX - tb.width - 14;
  if (lx < 8) lx = 8;
  // Flip below the point rather than off the top of the viewport.
  let ly = ev.clientY - tb.height - gap;
  if (ly < 8) ly = ev.clientY + gap;
  tt.style.left = lx + "px";
  tt.style.top = ly + "px";
}

// Wire a chart's hit rect to its readout.
//
// A fine pointer scrubs: the readout tracks the cursor and clears when it leaves.
// A coarse pointer has no hover, and a drag across a full-width chart is how you
// scroll the page — so touch gets tap-to-pin instead. Tap and scroll are told apart
// by how far the pointer travelled, which is why this needs no `touch-action`
// override and so cannot interfere with scrolling. Devices reporting both (a touch
// laptop) get both paths; they don't conflict, since a mouse click that pins is
// immediately overwritten by the next move.
let activeHide = null, dismissBound = false;

function bindDismiss() {
  if (dismissBound) return;
  dismissBound = true;
  document.addEventListener("pointerdown", ev => {
    if (!activeHide) return;
    if (!(ev.target instanceof Element) || !ev.target.closest("svg")) { activeHide(); activeHide = null; }
  }, true);
}

export function attachReadout(rect, { show, hide }) {
  if (matchMedia("(any-hover: hover)").matches) {
    rect.addEventListener("pointermove", show);
    rect.addEventListener("pointerleave", hide);
  }
  if (matchMedia("(any-pointer: coarse)").matches) {
    bindDismiss();
    let from = null;
    rect.addEventListener("pointerdown", ev => { from = { x: ev.clientX, y: ev.clientY }; });
    rect.addEventListener("pointercancel", () => { from = null; });
    rect.addEventListener("pointerup", ev => {
      if (!from) return;
      const moved = Math.hypot(ev.clientX - from.x, ev.clientY - from.y);
      from = null;
      if (moved > 10) return;                                // a scroll, not a tap
      if (activeHide && activeHide !== hide) activeHide();    // pinned on another chart
      show(ev);
      activeHide = hide;
    });
  }
}
