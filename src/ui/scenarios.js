// Scenarios: presets, save-as-default, and shareable link/code. Serialization is
// driven by the same PARAMS registry as everything else (SCENARIO_FIELDS), so a new
// tunable is saved and restored automatically.
import { el } from "../dom.js";
import { parseNum, commafy } from "../format.js";
import { SCENARIO_FIELDS } from "../config/parameters.js";
import { BUILTIN, PRESETS } from "../config/presets.js";
import {
  getStreams, setStreams, renderStreams, toggleModePanels,
  buildSweepOptions, fillSweepRange, buildHeatOptions, fillHeatRange,
} from "./controls.js";
import { recompute } from "./orchestrate.js";

// Read the current form into a compact scenario object (short keys, whole percents).
export function readScenario() {
  const o = { v: 2 };
  for (const e of SCENARIO_FIELDS) o[e.scen] = e.scenFromDom(el(e.el).value);
  o.st = getStreams().map(s => ({ l: s.label, a: +s.amount || 0, f: String(s.from), t: s.to == null ? "" : String(s.to), c: s.cola ? 1 : 0 }));
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
  for (const e of SCENARIO_FIELDS) { const v = o[e.scen]; if (v == null) continue; el(e.el).value = e.domFromScen(v); }
  if (Array.isArray(o.st)) setStreams(o.st.map(s => ({ label: s.l != null ? s.l : "Income", amount: +s.a || 0, from: String(s.f != null ? s.f : ""), to: s.t == null ? "" : String(s.t), cola: !!s.c })));
  renderStreams();
  toggleModePanels(); buildSweepOptions(); fillSweepRange(); buildHeatOptions(); fillHeatRange("x"); fillHeatRange("y");
  recompute();
}

// ---------- Encoding / sharing ----------
function encodeScenario(o) { try { return btoa(unescape(encodeURIComponent(JSON.stringify(o)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); } catch (e) { return ""; } }
function decodeScenario(s) { try { s = s.replace(/-/g, "+").replace(/_/g, "/"); return JSON.parse(decodeURIComponent(escape(atob(s)))); } catch (e) { return null; } }

let toastT = null;
function toast(msg) { const t = el("toast"); t.textContent = msg; t.classList.add("show"); if (toastT) clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("show"), 2800); }
async function copyText(txt, okMsg) { try { await navigator.clipboard.writeText(txt); toast(okMsg); } catch (e) { el("scen-code").value = txt; el("scen-more").open = true; toast("Copy it from the box below."); } }

// Read a scenario hash even when embedded in a framed context.
function readableHash() {
  const tryOne = fn => { try { const v = fn(); return v && v.indexOf("s=") >= 0 ? v : ""; } catch (e) { return ""; } };
  return tryOne(() => location.hash) || tryOne(() => window.parent.location.hash) || tryOne(() => window.top.location.hash) || "";
}

// Load from a shared hash, then a saved default, else compute the built-in defaults.
export function loadInitial() {
  let o = null;
  const h = readableHash(), idx = h.indexOf("s=");
  if (idx >= 0) o = decodeScenario(h.slice(idx + 2));
  if (!o) { try { const ls = localStorage.getItem("mc_default"); if (ls) o = JSON.parse(ls); } catch (e) {} }
  if (o) applyScenario(o); else recompute();
}

// Wire up the preset dropdown and the save / copy / load / reset buttons.
export function initScenarios() {
  el("preset").addEventListener("change", e => { const k = e.target.value; if (PRESETS[k]) { applyScenario(PRESETS[k]); toast("Preset loaded."); } e.target.value = ""; });
  el("save-default").addEventListener("click", () => { try { localStorage.setItem("mc_default", JSON.stringify(readScenario())); toast("Saved — this browser opens with these numbers."); } catch (e) { toast("Storage is blocked here — use Copy link instead."); } });
  el("copy-code").addEventListener("click", () => { const code = encodeScenario(readScenario()); el("scen-code").value = code; el("scen-more").open = true; copyText(code, "Code copied — also shown below, ready to send."); });
  el("load-code").addEventListener("click", () => { let s = (el("scen-code").value || "").trim(); if (!s) { toast("Paste a link or code first."); return; } const i = s.indexOf("s="); if (i >= 0) s = s.slice(i + 2); const o = decodeScenario(s); if (o) { applyScenario(o); toast("Scenario loaded."); } else toast("Couldn't read that code."); });
  el("reset-default").addEventListener("click", () => { try { localStorage.removeItem("mc_default"); } catch (e) {} if (/^https?:$/.test(location.protocol)) history.replaceState(null, "", location.pathname); applyScenario(BUILTIN); toast("Reset to built-in defaults."); });
}
