// Scenarios: presets, save-as-default, and shareable link/code. Serialization is
// driven by the same PARAMS registry as everything else (SCENARIO_FIELDS), so a new
// tunable is saved and restored automatically.
import { el } from "../dom.js";
import { parseNum, commafy, inputVal, isPrivate } from "../format.js";
import { SCENARIO_FIELDS } from "../config/parameters.js";
import { encodeScenario, decodeScenario } from "../config/codec.js";
import { BUILTIN, PRESETS } from "../config/presets.js";
import {
  getStreams, setStreams, renderStreams, toggleModePanels,
  buildSweepOptions, fillSweepRange, buildHeatOptions, fillHeatRange,
} from "./controls.js";
import { recompute } from "./orchestrate.js";
import { clearMasks, refreshMasks } from "./privacy.js";

// Read the current form into a compact scenario object (short keys, whole percents).
export function readScenario() {
  const o = { v: 2 };
  for (const e of SCENARIO_FIELDS) o[e.scen] = e.scenFromDom(inputVal(el(e.el)));
  o.st = getStreams().map(s => ({ l: s.label, a: +s.amount || 0, f: String(s.from), t: s.to == null ? "" : String(s.to), c: s.cola ? 1 : 0, b: s.basis === "ret" ? 1 : 0 }));
  return o;
}

// Write a scenario object back onto the form and recompute.
export function applyScenario(o) {
  if (!o) return;
  if (o.ca == null) { // migrate v1 (retirement-relative years) -> age basis anchored at age 65
    const b = 65;
    o = Object.assign({}, o, {
      ca: b, ra: b, ea: b + (o.horizon || 30), ct: 0,
      st: (o.st || []).map(s => ({ l: s.l, a: s.a, c: s.c, f: String(b + (parseNum(s.f) || 0)), t: (s.t == null || s.t === "") ? "" : String(b + parseNum(s.t)) })),
    });
  }
  // Writing the form directly would leave stale masked values behind, so drop the
  // masks first and let renderStreams/syncLabels put them back.
  clearMasks();
  for (const e of SCENARIO_FIELDS) { const v = o[e.scen]; if (v == null) continue; el(e.el).value = e.domFromScen(v); }
  if (Array.isArray(o.st)) setStreams(o.st.map(s => ({ label: s.l != null ? s.l : "Income", amount: +s.a || 0, from: String(s.f != null ? s.f : ""), to: s.t == null ? "" : String(s.t), cola: !!s.c, basis: s.b ? "ret" : "age" })));
  renderStreams();
  toggleModePanels(); buildSweepOptions(); fillSweepRange(); buildHeatOptions(); fillHeatRange("x"); fillHeatRange("y");
  refreshMasks();
  recompute();
}

// ---------- Sharing ----------
// The code itself is `?s=` in a link and the same text in the paste box, so both
// forms are accepted wherever one is: pull the value out of an `s=` parameter if
// there is one, otherwise take the whole string as the code. What comes back is
// never URL-decoded — any percent-escapes in it belong to the code, not the URL.
const S_PARAM = /(?:^|[?&#])s=([^&#\s]*)/;
function extractCode(s) { const m = S_PARAM.exec(String(s).trim()); return m ? m[1] : String(s).trim(); }

// A shareable link to this page carrying the scenario. Only meaningful over http(s)
// — from a file:// copy there is no address worth sending anyone.
function shareLink(code) {
  if (!/^https?:$/.test(location.protocol)) return "";
  return location.origin + location.pathname + "?s=" + code;
}

let toastT = null;
function toast(msg) { const t = el("toast"); t.textContent = msg; t.classList.add("show"); if (toastT) clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("show"), 2800); }
async function copyText(txt, okMsg) { try { await navigator.clipboard.writeText(txt); toast(okMsg); } catch (e) { el("scen-code").value = txt; el("scen-more").open = true; toast("Copy it from the box below."); } }

// This page's query and hash, then the framing page's — when the tool is embedded,
// the link's parameters land on the outer URL rather than on this document's.
function urlParts() {
  const tryOne = fn => { try { return fn(); } catch (e) { return ""; } };
  return [
    tryOne(() => location.search + location.hash),
    tryOne(() => window.parent.location.search + window.parent.location.hash),
    tryOne(() => window.top.location.search + window.top.location.hash),
  ];
}

// Read a shared scenario out of the URL — "?s=CODE" or "#s=CODE".
function urlCode() {
  for (const part of urlParts()) { const m = S_PARAM.exec(part); if (m) return m[1]; }
  return "";
}

// "?demo" (or "#demo", or "?demo=1") opens the built-in defaults and leaves the
// saved default in storage untouched — a link to hand out for a walkthrough, while
// the bare URL still opens your own numbers. "?demo=0" is the same as leaving it off.
const DEMO_PARAM = /(?:^|[?&#])demo(?:=([^&#\s]*))?(?=[&#]|$)/;
export function isDemo() {
  for (const part of urlParts()) { const m = DEMO_PARAM.exec(part); if (m) return !/^(0|false|no|off)$/i.test(m[1] || ""); }
  return false;
}

function savedDefault() {
  try { const ls = localStorage.getItem("mc_default"); return ls ? JSON.parse(ls) : null; } catch (e) { return null; }
}

// Load from a shared link, then a saved default, else compute the built-in defaults.
export function loadInitial() {
  let o = null;
  const code = urlCode();
  // Say so either way: silently showing defaults would look like the sender's
  // numbers, and links do get truncated on their way through chat windows.
  if (code) { o = decodeScenario(code); toast(o ? "Loaded a shared scenario." : "That shared link looks incomplete."); }
  if (!o && isDemo()) {
    // Only worth a word if there was something to skip. Whoever you sent the demo
    // link to has no saved default of their own and would just be puzzled by it.
    if (savedDefault()) toast("Demo view — your saved default isn't loaded.");
  } else if (!o) {
    o = savedDefault();
  }
  if (o) applyScenario(o); else recompute();
}

// Wire up the preset dropdown and the save / copy / load / reset buttons.
export function initScenarios() {
  el("preset").addEventListener("change", e => { const k = e.target.value; if (PRESETS[k]) { applyScenario(PRESETS[k]); toast("Preset loaded."); } e.target.value = ""; });
  el("save-default").addEventListener("click", () => { try { localStorage.setItem("mc_default", JSON.stringify(readScenario())); toast("Saved — this browser opens with these numbers."); } catch (e) { toast("Storage is blocked here — use Copy link instead."); } });
  el("copy-link").addEventListener("click", () => {
    if (isPrivate()) { toast("Turn off private mode to share your numbers."); return; }
    const code = encodeScenario(readScenario()), link = shareLink(code);
    el("scen-code").value = link || code;
    if (!link) { el("scen-more").open = true; copyText(code, "No link from a local file — code copied instead."); return; }
    copyText(link, "Link copied — it opens with these numbers.");
  });
  el("copy-code").addEventListener("click", () => { if (isPrivate()) { toast("Turn off private mode to share your code."); return; } const code = encodeScenario(readScenario()); el("scen-code").value = code; el("scen-more").open = true; copyText(code, "Code copied — also shown below, ready to send."); });
  el("load-code").addEventListener("click", () => { const s = (el("scen-code").value || "").trim(); if (!s) { toast("Paste a link or code first."); return; } const o = decodeScenario(extractCode(s)); if (o) { applyScenario(o); toast("Scenario loaded."); } else toast("Couldn't read that link or code."); });
  el("reset-default").addEventListener("click", () => { try { localStorage.removeItem("mc_default"); } catch (e) {} if (/^https?:$/.test(location.protocol)) history.replaceState(null, "", location.pathname); applyScenario(BUILTIN); toast("Reset to built-in defaults."); });
}
