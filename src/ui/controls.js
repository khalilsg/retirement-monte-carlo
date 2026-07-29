// The control layer: income-stream state, reading the DOM into an engine params
// object, syncing live value labels, and building the sensitivity-tool dropdowns.
// Everything numeric is driven by the PARAMS registry (see config/parameters.js).
import { el } from "../dom.js";
import { parseNum, commafy, escapeHtml, fmtMoney } from "../format.js";
import { PARAM_FIELDS, LABEL_FIELDS, SWEEP_META, getMeta } from "../config/parameters.js";
import { debounced, scheduleTyping, recompute } from "./orchestrate.js";

// ---------- Income-stream state ----------
let streams = [{ label: "Pension", amount: 0, from: "65", to: "", cola: false }];
export function getStreams() { return streams; }
export function setStreams(next) { streams = next; }

export function renderStreams() {
  const host = el("streams");
  host.innerHTML = streams.map((s, i) => `
    <div class="stream">
      <div class="stream-top">
        <input type="text" class="s-label" data-i="${i}" value="${escapeHtml(s.label)}" aria-label="Income label">
        <button class="s-del" data-i="${i}" title="Remove" aria-label="Remove income stream">&times;</button>
      </div>
      <div class="input-money"><input type="text" inputmode="numeric" class="money s-amount" data-i="${i}" value="${commafy(s.amount)}" aria-label="Annual amount"></div>
      <div class="stream-grid">
        <label class="mini">From age<input type="text" inputmode="numeric" class="s-from" data-i="${i}" value="${escapeHtml(s.from)}"></label>
        <label class="mini">To age<input type="text" inputmode="numeric" class="s-to" data-i="${i}" value="${escapeHtml(s.to)}" placeholder="life"></label>
      </div>
      <label class="cola"><input type="checkbox" class="s-cola" data-i="${i}" ${s.cola ? "checked" : ""}> Inflation-adjusted</label>
    </div>`).join("");
  host.querySelectorAll(".s-label").forEach(e => {
    e.addEventListener("input", ev => { streams[+ev.target.dataset.i].label = ev.target.value; });
    e.addEventListener("change", () => { buildSweepOptions(); });
  });
  host.querySelectorAll(".s-amount").forEach(e => {
    e.addEventListener("input", ev => { streams[+ev.target.dataset.i].amount = parseNum(ev.target.value); scheduleTyping(); });
    e.addEventListener("blur", ev => { ev.target.value = commafy(parseNum(ev.target.value)); });
  });
  host.querySelectorAll(".s-from").forEach(e => e.addEventListener("input", ev => { streams[+ev.target.dataset.i].from = ev.target.value; scheduleTyping(); }));
  host.querySelectorAll(".s-to").forEach(e => e.addEventListener("input", ev => { streams[+ev.target.dataset.i].to = ev.target.value; scheduleTyping(); }));
  host.querySelectorAll(".s-cola").forEach(e => e.addEventListener("change", ev => { streams[+ev.target.dataset.i].cola = ev.target.checked; debounced(); }));
  host.querySelectorAll(".s-del").forEach(e => e.addEventListener("click", ev => {
    streams.splice(+ev.target.dataset.i, 1);
    if (el("sweep-var").value.startsWith("inc")) el("sweep-var").value = "spend";
    if (el("hx-var").value.startsWith("inc")) el("hx-var").value = "spend";
    if (el("hy-var").value.startsWith("inc")) el("hy-var").value = "start";
    renderStreams(); buildSweepOptions(); fillSweepRange(); buildHeatOptions(); fillHeatRange("x"); fillHeatRange("y"); recompute();
  }));
}

// Normalize the raw stream inputs into the numeric shape the engine expects.
export function normStreams() {
  return streams.map(s => ({
    label: s.label, amount: +s.amount || 0,
    from: Math.max(0, Math.round(parseNum(s.from)) || 0),
    to: (s.to == null || String(s.to).trim() === "") ? null : Math.max(0, Math.round(parseNum(s.to))),
    cola: !!s.cola,
  }));
}

// ---------- Reading params from the DOM ----------
export function readParams() {
  const getVal = id => el(id).value;
  const p = {};
  for (const e of PARAM_FIELDS) p[e.param] = e.readParam ? e.readParam(getVal) : e.read(getVal(e.el));
  p.streams = normStreams();
  return p;
}
export function currentSims() { return +el("sims").value; }

// ---------- Live value labels ----------
export function syncLabels() {
  const p = readParams();
  for (const e of LABEL_FIELDS) el(e.label.id).textContent = e.labelText(p[e.param]);
  // Derived / non-generic labels:
  el("bond-v").textContent = (100 - p.stock * 100).toFixed(0);
  el("block-len-v").textContent = el("block-len").value;
  const A = Math.max(0, p.retAge - p.curAge), R = Math.max(1, Math.max(p.retAge, p.curAge) + 1 <= p.endAge ? p.endAge - Math.max(p.curAge, p.retAge) : 1);
  el("ret-age-hint").textContent = A > 0 ? `${A} yrs saving, then ${R} yrs retired` : `Already retired — ${R} yrs to fund`;
  const tot = streams.reduce((a, s) => a + (+s.amount || 0), 0);
  el("inc-sum").textContent = tot > 0 ? fmtMoney(tot) + "/yr" : "";
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
  el("sweep-from").value = meta.kind === "money" ? commafy(a) : a;
  el("sweep-to").value = meta.kind === "money" ? commafy(b) : b;
}
export function buildHeatOptions() {
  const p = readParams(), keys = optionKeys(p);
  fillSelect(el("hx-var"), keys, p.streams, "spend");
  fillSelect(el("hy-var"), keys, p.streams, "start");
}
export function fillHeatRange(axis) {
  const p = readParams(), meta = getMeta(el("h" + axis + "-var").value, p.streams), [a, b] = meta.range(p);
  el("h" + axis + "-from").value = meta.kind === "money" ? commafy(a) : a;
  el("h" + axis + "-to").value = meta.kind === "money" ? commafy(b) : b;
}
