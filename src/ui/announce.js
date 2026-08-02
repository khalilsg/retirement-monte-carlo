// The screen-reader channel for results that change without a page load.
//
// The visible outcome card can't itself be the live region: recomputeLight() runs
// on every animation frame of a slider drag, and a live region wired to that would
// queue dozens of half-finished utterances. So the region is a separate off-screen
// node, written only once the inputs settle (see orchestrate.js), with a summary
// composed for listening rather than scraped from the layout.
import { el } from "../dom.js";

let pending = "", last = "";

// Stage the summary the next settle should announce. Called on every recompute —
// cheap, and it keeps the text in step with whatever the card is showing.
export function stageSummary(text) { pending = text; }

// Speak the staged summary. Repeats are dropped: a live region only announces when
// its text *changes*, so rewriting identical text is silent anyway, and skipping it
// explicitly keeps that from reading like a bug.
export function flushSummary() {
  if (!pending || pending === last) return;
  last = pending;
  el("a11y-status").textContent = pending;
}
