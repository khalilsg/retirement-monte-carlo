// The control layer: income-stream state, reading the DOM into an engine params
// object, syncing live value labels, and building the sensitivity-tool dropdowns.
// Everything numeric is driven by the PARAMS registry (see config/parameters.js).
import { el } from "../dom.js";
import { parseNum, commafy, escapeHtml, fmtMoney, inputVal, isPrivate, setPrivacyUnit } from "../format.js";
import { PARAM_FIELDS, LABEL_FIELDS, SWEEP_META, getMeta } from "../config/parameters.js";
import { debounced, scheduleTyping, recompute } from "./orchestrate.js";
import { setMoneyInput, refreshMasks, syncPrivacyNote } from "./privacy.js";
import { phaseOf } from "../engine/model.js";

// ---------- Income-stream state ----------
let streams = [{ label: "Pension", amount: 0, from: "65", to: "", cola: false, basis: "age" }];
export function getStreams() { return streams; }
export function setStreams(next) { streams = next; }

// The display name a screen reader should hear for stream `i`. Every stream's
// controls would otherwise announce identically ("Annual amount", "Remove income
// stream"), leaving no way to tell three pensions apart.
function streamName(s, i) { return s.label && s.label.trim() ? s.label.trim() : "Income " + (i + 1); }

// Put focus back after the list is rebuilt. innerHTML replacement destroys the
// focused node, which drops focus to <body> and sends a keyboard user back to the
// top of the form — so every caller that re-renders says where focus should land.
function refocus(sel, i) {
  const nodes = el("streams").querySelectorAll(sel);
  const target = nodes.length ? nodes[Math.max(0, Math.min(i, nodes.length - 1))] : el("add-stream");
  if (target) target.focus();
}

// `focus` is an optional { sel, i } describing where to leave focus afterwards.
export function renderStreams(focus) {
  const host = el("streams");
  host.innerHTML = streams.map((s, i) => {
    const name = escapeHtml(streamName(s, i));
    const rel = s.basis === "ret";
    return `
    <div class="stream" role="group" aria-label="${name}">
      <div class="stream-top">
        <input type="text" class="s-label" data-i="${i}" value="${escapeHtml(s.label)}" aria-label="Name of income stream ${i + 1}">
        <button type="button" class="s-del" data-i="${i}" title="Remove" aria-label="Remove ${name}"><span aria-hidden="true">&times;</span></button>
      </div>
      <div class="input-money"><input type="text" inputmode="numeric" class="money s-amount" data-priv-kind="flow" data-i="${i}" value="${commafy(s.amount)}" aria-label="${name}: annual amount"></div>
      <label class="mini s-basis-field" for="s-basis-${i}">When it runs
        <select class="s-basis" id="s-basis-${i}" data-i="${i}" aria-label="${name}: when it runs">
          <option value="age"${rel ? "" : " selected"}>At fixed ages</option>
          <option value="ret"${rel ? " selected" : ""}>Relative to retirement</option>
        </select>
      </label>
      <div class="stream-grid">
        <label class="mini" for="s-from-${i}">${rel ? "From (ret &plusmn;yrs)" : "From age"}<input type="text" inputmode="${rel ? "text" : "numeric"}" class="s-from" id="s-from-${i}" data-i="${i}" value="${escapeHtml(s.from)}" placeholder="${rel ? "0" : ""}"></label>
        <label class="mini" for="s-to-${i}">${rel ? "To (ret &plusmn;yrs)" : "To age"}<input type="text" inputmode="${rel ? "text" : "numeric"}" class="s-to" id="s-to-${i}" data-i="${i}" value="${escapeHtml(s.to)}" placeholder="life"></label>
      </div>
      <p class="stream-note" data-i="${i}"${rel ? "" : " hidden"}></p>
      <label class="cola"><input type="checkbox" class="s-cola" data-i="${i}" ${s.cola ? "checked" : ""}> Inflation-adjusted</label>
    </div>`;
  }).join("");
  host.querySelectorAll(".s-label").forEach(e => {
    e.addEventListener("input", ev => { streams[+ev.target.dataset.i].label = ev.target.value; });
    e.addEventListener("change", ev => {
      // Rename in place rather than re-rendering: the accessible names derive from
      // this field, and a rebuild here would destroy the node the user just left.
      const i = +ev.target.dataset.i, name = streamName(streams[i], i), group = ev.target.closest(".stream");
      group.setAttribute("aria-label", name);
      group.querySelector(".s-amount").setAttribute("aria-label", name + ": annual amount");
      group.querySelector(".s-del").setAttribute("aria-label", "Remove " + name);
      group.querySelector(".s-basis").setAttribute("aria-label", name + ": when it runs");
      buildSweepOptions();
    });
  });
  host.querySelectorAll(".s-amount").forEach(e => {
    e.addEventListener("input", ev => { streams[+ev.target.dataset.i].amount = parseNum(ev.target.value); scheduleTyping(); });
    e.addEventListener("blur", ev => { if (!isPrivate()) ev.target.value = commafy(parseNum(ev.target.value)); });
  });
  host.querySelectorAll(".s-from").forEach(e => e.addEventListener("input", ev => { streams[+ev.target.dataset.i].from = ev.target.value; scheduleTyping(); }));
  host.querySelectorAll(".s-to").forEach(e => e.addEventListener("input", ev => { streams[+ev.target.dataset.i].to = ev.target.value; scheduleTyping(); }));
  // Switching basis rewrites the From/To labels, so the list is rebuilt — and the
  // old numbers are dropped, because "65" means an age on one basis and 65 years
  // after retiring on the other. Retirement-relative streams start at 0 (the year
  // you retire); fixed-age ones fall back to the current retirement age.
  host.querySelectorAll(".s-basis").forEach(e => e.addEventListener("change", ev => {
    const i = +ev.target.dataset.i, rel = ev.target.value === "ret";
    streams[i].basis = rel ? "ret" : "age";
    streams[i].from = rel ? "0" : el("ret-age").value;
    streams[i].to = "";
    renderStreams({ sel: ".s-basis", i });
    recompute();
  }));
  host.querySelectorAll(".s-cola").forEach(e => e.addEventListener("change", ev => { streams[+ev.target.dataset.i].cola = ev.target.checked; debounced(); }));
  host.querySelectorAll(".s-del").forEach(e => e.addEventListener("click", ev => {
    const i = +ev.currentTarget.dataset.i;
    streams.splice(i, 1);
    if (el("sweep-var").value.startsWith("inc")) el("sweep-var").value = "spend";
    if (el("hx-var").value.startsWith("inc")) el("hx-var").value = "spend";
    if (el("hy-var").value.startsWith("inc")) el("hy-var").value = "start";
    // Land on the delete button that slid into this slot, so a run of removals
    // works without reaching for the mouse; refocus() falls back to "+ Add income
    // stream" once the list is empty.
    renderStreams({ sel: ".s-del", i });
    buildSweepOptions(); fillSweepRange(); buildHeatOptions(); fillHeatRange("x"); fillHeatRange("y"); recompute();
  }));
  refreshMasks();
  if (focus) refocus(focus.sel, focus.i);
}

// Normalize the raw stream inputs into the numeric shape the engine expects.
// On the "ret" basis from/to are offsets in years from retirement, so negatives are
// meaningful ("two years before I retire") and the floor at zero doesn't apply —
// streamArrays clamps the resolved year instead.
export function normStreams() {
  return streams.map(s => {
    const rel = s.basis === "ret";
    const blank = v => v == null || String(v).trim() === "";
    const yr = v => Math.round(parseNum(v)) || 0;
    return {
      label: s.label, amount: +s.amount || 0, basis: rel ? "ret" : "age",
      from: rel ? yr(s.from) : Math.max(0, yr(s.from)),
      to: blank(s.to) ? null : (rel ? yr(s.to) : Math.max(0, yr(s.to))),
      cola: !!s.cola,
    };
  });
}

// ---------- Reading params from the DOM ----------
export function readParams() {
  const getVal = id => inputVal(el(id));
  const p = {};
  for (const e of PARAM_FIELDS) p[e.param] = e.readParam ? e.readParam(getVal) : e.read(getVal(e.el));
  p.streams = normStreams();
  return p;
}
export function currentSims() { return +el("sims").value; }

// ---------- Live value labels ----------
// Most slider readouts are themselves number inputs (see initValueInputs), so a
// "label" write is either textContent or a value — with one exception: never
// rewrite the box that currently has focus. Reformatting mid-entry ("1" becoming
// "1.00") moves the caret and makes the field impossible to type into.
function setVal(elm, text) {
  if (!elm) return;
  if (elm.tagName !== "INPUT") { elm.textContent = text; return; }
  if (elm !== document.activeElement) elm.value = text;
}

// The spoken form of a slider's value, assembled from its readout in DOM order so
// units and prefixes land where they belong — "±20%", "60% / 40% bonds", "5 yrs".
// Without this a screen reader reads the bare number off aria-valuenow.
function readoutText(box) {
  let s = "";
  for (const n of box.childNodes) s += (n.nodeType === 1 && n.tagName === "INPUT") ? n.value : n.textContent;
  return s.replace(/\s+/g, " ").trim();
}

function syncValueText() {
  for (const num of document.querySelectorAll("input.val-num[data-range]")) {
    const range = el(num.dataset.range), box = num.closest(".val");
    if (range && box) range.setAttribute("aria-valuetext", readoutText(box));
  }
}

export function syncLabels() {
  const p = readParams();
  // Anchor private mode's reference amount before anything formats a figure.
  setPrivacyUnit(p.start, p.spend);
  syncPrivacyNote();
  for (const e of LABEL_FIELDS) setVal(el(e.label.id), e.labelText(p[e.param]));
  // Derived / non-generic labels:
  el("bond-v").textContent = (100 - p.stock * 100).toFixed(0);
  setVal(el("block-len-v"), el("block-len").value);
  syncValueText();
  const A = Math.max(0, p.retAge - p.curAge), R = Math.max(1, Math.max(p.retAge, p.curAge) + 1 <= p.endAge ? p.endAge - Math.max(p.curAge, p.retAge) : 1);
  el("ret-age-hint").textContent = A > 0 ? `${A} yrs saving, then ${R} yrs retired` : `Already retired — ${R} yrs to fund`;
  const tot = streams.reduce((a, s) => a + (+s.amount || 0), 0);
  el("inc-sum").textContent = tot > 0 ? fmtMoney(tot, true) + "/yr" : "";
  syncStreamNotes(p);
  refreshMasks();
}

// Retirement-relative streams read as offsets ("ret +2"), which says nothing about
// when the money actually arrives. Each one carries a note with the ages it resolves
// to right now, so the offsets stay checkable as the retirement age moves. The
// anchor is phaseOf's A — the same year the simulation switches to retired — so the
// note can't drift from what the engine did.
function syncStreamNotes(p) {
  const ra = p.curAge + phaseOf(p).A;
  for (const note of el("streams").querySelectorAll(".stream-note")) {
    const s = p.streams[+note.dataset.i];
    if (!s || s.basis !== "ret") { note.hidden = true; continue; }
    // The engine can't pay a stream before today, so the note shows the clamp too.
    const f = Math.max(p.curAge, ra + s.from), t = s.to == null ? null : ra + s.to;
    note.hidden = false;
    note.textContent = "Retiring at " + ra + ": " +
      (t == null ? "age " + f + " onward" : t < f ? "never — “to” lands before “from”" : "ages " + f + "–" + t);
  }
}

// ---------- Typed entry for every slider ----------
// A range input is a poor primary control for anyone with a tremor, limited fine
// motor control, or a trackpad they'd rather not drag: it demands a sustained,
// pixel-accurate gesture and gives no way to state an exact figure. Each slider's
// readout is therefore a real number input that writes back to it, so the value can
// be typed or arrow-stepped instead. The range stays the single source of truth —
// readParams and the scenario codec still read it — and this only steers it.
export function initValueInputs(onCommit) {
  for (const num of document.querySelectorAll("input.val-num[data-range]")) {
    const range = el(num.dataset.range);
    if (!range) continue;
    num.addEventListener("input", () => {
      const v = parseFloat(num.value);
      // Deliberately no clamping here. Typing "95" into a 60–110 field passes
      // through "9", and snapping that to 60 mid-keystroke makes the box unusable.
      // An out-of-range value just doesn't drive the slider yet; CSS :out-of-range
      // flags it, and blur resolves it.
      if (!isFinite(v) || v < +range.min || v > +range.max) return;
      range.value = v;
      onCommit();
    });
    num.addEventListener("blur", () => {
      const v = parseFloat(num.value);
      if (!isFinite(v)) { num.value = range.value; return; }
      range.value = Math.max(+range.min, Math.min(+range.max, v));
      num.value = range.value;  // echo back whatever the slider's step snapped to
      onCommit();
    });
    // Enter means "I'm done with this figure" — commit it rather than submitting.
    num.addEventListener("keydown", ev => { if (ev.key === "Enter") { ev.preventDefault(); num.blur(); } });
  }
}

// Show/hide the panels tied to the current mode selects.
export function toggleModePanels() {
  el("contrib-field").hidden = !(+el("ret-age").value > +el("cur-age").value);
  el("guardrail-fields").hidden = el("spend-mode").value !== "guardrails";
  const glide = el("alloc-mode").value === "glide";
  el("glide-alloc").hidden = !glide; el("fixed-alloc").hidden = glide;
  el("block-field").hidden = el("sample-mode").value !== "blocks";
}

// ---------- Sensitivity-tool dropdowns ----------
function optionKeys(p) {
  const staticKeys = Object.keys(SWEEP_META).filter(k => !SWEEP_META[k].when || SWEEP_META[k].when(p));
  return staticKeys.concat(streams.map((s, i) => "inc" + i));
}
function fillSelect(sel, keys, streamsForLabels, fallback) {
  const prev = sel.value;
  sel.innerHTML = keys.map(k => `<option value="${k}">${escapeHtml(getMeta(k, streamsForLabels).label)}</option>`).join("");
  sel.value = keys.includes(prev) ? prev : fallback;
}
export function buildSweepOptions() {
  const p = readParams();
  fillSelect(el("sweep-var"), optionKeys(p), p.streams, "spend");
}
export function fillSweepRange() {
  const p = readParams(), meta = getMeta(el("sweep-var").value, p.streams), [a, b] = meta.range(p);
  const money = meta.kind === "money", kind = money ? (meta.flow ? "flow" : "stock") : null;
  setMoneyInput(el("sweep-from"), String(money ? commafy(a) : a), kind);
  setMoneyInput(el("sweep-to"), String(money ? commafy(b) : b), kind);
}
export function buildHeatOptions() {
  const p = readParams(), keys = optionKeys(p);
  fillSelect(el("hx-var"), keys, p.streams, "spend");
  fillSelect(el("hy-var"), keys, p.streams, "start");
}
export function fillHeatRange(axis) {
  const p = readParams(), meta = getMeta(el("h" + axis + "-var").value, p.streams), [a, b] = meta.range(p);
  const money = meta.kind === "money", kind = money ? (meta.flow ? "flow" : "stock") : null;
  setMoneyInput(el("h" + axis + "-from"), String(money ? commafy(a) : a), kind);
  setMoneyInput(el("h" + axis + "-to"), String(money ? commafy(b) : b), kind);
}
