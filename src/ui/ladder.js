// The step-up ladder's state and editor: the lifestyle tiers, the named comparison
// scenarios, and the two search settings. The solving lives in engine/ladder.js and
// the drawing in charts/ladder.js; this module owns the DOM in between.
//
// A tier holds *both* numbers at all times — the spend and the age — and its anchor
// only says which one is held while the other is solved for. Flipping the anchor
// back and forth therefore never loses a figure you typed, which is the opposite of
// how an income stream's basis behaves (there, "65" means different things on the
// two bases, so switching has to clear it).
import { el } from "../dom.js";
import { parseNum, commafy, escapeHtml, fmtMoney, inputVal, isPrivate } from "../format.js";
import { normStream, readParams, getStreams } from "./controls.js";
import { refreshMasks, setMoneyInput } from "./privacy.js";
import { SCEN_COLORS, MAX_ACTIVE } from "../charts/ladder.js";

const MAX_TIERS = 12, MAX_VARIANTS = 6;

let tiers = [];
let variants = [];

// Until the ladder is edited it is a suggestion rather than a plan: it re-derives
// from the current spending, so opening the card after changing your numbers shows
// rungs around them instead of around whatever they were at boot. The first edit
// makes it yours, and from then on it is left alone — and only from then on is it
// written into a shared code (see readScenario in ui/scenarios.js), so nobody who
// ignores this card pays for it in link length.
let touched = false;
export function isTouched() { return touched; }
function markTouched() { touched = true; }

// The proportions of current spending the seeded rungs sit at. Three is enough to
// show what a ladder is for; they are ordinary editable tiers, not fixed levels.
const SEED = [["Bare-bones", 0.6], ["Necessities", 0.85], ["Comfortable", 1.2]];

const round1k = v => Math.max(0, Math.round(v / 1000) * 1000);

function seedFrom(p) {
  const ra = Math.max(p.curAge, p.retAge);
  tiers = SEED.map(([label, f]) => ({ label, anchor: "spend", spend: round1k(p.spend * f), age: ra }));
  variants = [
    { label: "As planned", on: true, useplan: true, streams: [] },
    { label: "Full stop", on: true, useplan: false, streams: [] },
  ];
}

// A generous ceiling for the spend search: wide enough that a comfortable tier is
// inside it, and shown as a control rather than buried, because it is the figure
// that decides whether an answer reads "solved" or "over the cap".
function seedMaxSpend(p) { return Math.max(100000, round1k(p.spend * 3)); }

export function getTiers() {
  return tiers.map(t => ({ label: t.label, anchor: t.anchor === "age" ? "age" : "spend", spend: Math.max(0, +t.spend || 0), age: Math.round(+t.age || 0) }));
}
export function getVariants() {
  return variants.map(v => ({ label: v.label, on: !!v.on, useplan: !!v.useplan, streams: (v.streams || []).map(normStream) }));
}
export function ladderConfig() {
  return {
    target: Math.max(1, Math.min(100, parseNum(el("ld-target").value) || 85)),
    maxSpend: Math.max(1000, parseNum(inputVal(el("ld-max")))),
  };
}

// The whole ladder in one object, for the scenario codec.
export function getLadder() {
  const cfg = ladderConfig();
  return { target: cfg.target, maxSpend: cfg.maxSpend, tiers: getTiers(), scenarios: getVariants() };
}

// Restore one from a shared code or a saved default. A ladder that arrives this way
// is by definition someone's deliberate ladder, so it counts as touched.
export function setLadder(L) {
  if (!L || !Array.isArray(L.tiers)) return;
  tiers = L.tiers.slice(0, MAX_TIERS).map(t => ({ label: t.label || "Tier", anchor: t.anchor === "age" ? "age" : "spend", spend: +t.spend || 0, age: +t.age || 0 }));
  variants = (L.scenarios || []).slice(0, MAX_VARIANTS).map(v => ({
    label: v.label || "Scenario", on: !!v.on, useplan: !!v.useplan,
    streams: (v.streams || []).map(s => ({ label: s.label || "Income", amount: +s.amount || 0, from: String(s.from == null ? "" : s.from), to: s.to == null ? "" : String(s.to), cola: !!s.cola, basis: s.basis === "ret" ? "ret" : "age" })),
  }));
  if (L.target) el("ld-target").value = String(L.target);
  if (L.maxSpend) setMoneyInput(el("ld-max"), commafy(L.maxSpend), "flow");
  touched = true;
  renderLadderControls();
}

// Re-derive an untouched ladder from the plan. Skipped while the pointer or the
// keyboard is inside the card: rebuilding the list under a focused field would drop
// focus mid-edit, and anyone editing has marked it touched anyway.
export function syncLadderSeed() {
  if (touched) return;
  const p = readParams();
  const want = SEED.map(([, f]) => round1k(p.spend * f)).join(",");
  const have = tiers.map(t => t.spend).join(",");
  const cap = seedMaxSpend(p);
  if (have === want && parseNum(inputVal(el("ld-max"))) === cap) return;
  if (el("ladder-card").contains(document.activeElement)) return;
  seedFrom(p);
  setMoneyInput(el("ld-max"), commafy(cap), "flow");
  renderLadderControls();
}

// ---------- Rendering the editors ----------
// Same idiom as the income-stream list in controls.js: innerHTML for the list, then
// listeners bound per node, then focus put back where the caller asked for it —
// a rebuild destroys the focused element, which otherwise dumps a keyboard user at
// the top of the page.
function refocus(host, sel, i) {
  const nodes = host.querySelectorAll(sel);
  const target = nodes.length ? nodes[Math.max(0, Math.min(i, nodes.length - 1))] : null;
  if (target) target.focus();
}

function tierName(t, i) { return t.label && t.label.trim() ? t.label.trim() : "Tier " + (i + 1); }
function variantName(v, i) { return v.label && v.label.trim() ? v.label.trim() : "Scenario " + (i + 1); }

function renderTiers(focus) {
  const host = el("ld-tiers");
  host.innerHTML = tiers.map((t, i) => {
    const name = escapeHtml(tierName(t, i)), byAge = t.anchor === "age";
    return `
    <div class="ldtier" role="group" aria-label="${name}">
      <input type="text" class="lt-label" data-i="${i}" value="${escapeHtml(t.label)}" aria-label="Name of tier ${i + 1}">
      <select class="lt-anchor" data-i="${i}" aria-label="${name}: what this tier is anchored on">
        <option value="spend"${byAge ? "" : " selected"}>Spend, solve age</option>
        <option value="age"${byAge ? " selected" : ""}>Age, solve spend</option>
      </select>
      ${byAge
        ? `<input type="text" inputmode="numeric" class="lt-age" data-i="${i}" value="${escapeHtml(String(t.age))}" aria-label="${name}: retirement age">`
        : `<div class="input-money"><input type="text" inputmode="numeric" class="money lt-spend" data-priv-kind="flow" data-i="${i}" value="${commafy(t.spend)}" aria-label="${name}: annual spend"></div>`}
      <button type="button" class="s-del lt-del" data-i="${i}" title="Remove" aria-label="Remove ${name}"><span aria-hidden="true">&times;</span></button>
    </div>`;
  }).join("");

  host.querySelectorAll(".lt-label").forEach(e => e.addEventListener("input", ev => {
    const i = +ev.target.dataset.i;
    tiers[i].label = ev.target.value; markTouched();
    // Renamed in place rather than re-rendering, so the field the user is typing in
    // survives; the accessible names on its siblings derive from it.
    const name = tierName(tiers[i], i), group = ev.target.closest(".ldtier");
    group.setAttribute("aria-label", name);
    group.querySelector(".lt-del").setAttribute("aria-label", "Remove " + name);
    group.querySelector(".lt-anchor").setAttribute("aria-label", name + ": what this tier is anchored on");
    scheduleLadder();
  }));
  host.querySelectorAll(".lt-anchor").forEach(e => e.addEventListener("change", ev => {
    const i = +ev.target.dataset.i;
    tiers[i].anchor = ev.target.value === "age" ? "age" : "spend"; markTouched();
    renderTiers({ sel: ".lt-anchor", i });
    scheduleLadder();
  }));
  host.querySelectorAll(".lt-spend").forEach(e => {
    e.addEventListener("input", ev => { tiers[+ev.target.dataset.i].spend = parseNum(ev.target.value); markTouched(); scheduleLadder(); });
    e.addEventListener("blur", ev => { if (!isPrivate()) ev.target.value = commafy(parseNum(ev.target.value)); });
  });
  host.querySelectorAll(".lt-age").forEach(e => e.addEventListener("input", ev => {
    tiers[+ev.target.dataset.i].age = Math.round(parseNum(ev.target.value)); markTouched(); scheduleLadder();
  }));
  host.querySelectorAll(".lt-del").forEach(e => e.addEventListener("click", ev => {
    const i = +ev.currentTarget.dataset.i;
    tiers.splice(i, 1); markTouched();
    renderTiers({ sel: ".lt-del", i });
    if (!tiers.length) el("ld-add-tier").focus();
    scheduleLadder();
  }));
  el("ld-add-tier").disabled = tiers.length >= MAX_TIERS;
  if (focus) refocus(host, focus.sel, focus.i);
}

// A scenario's stream editor. Deliberately a compact echo of the plan's stream
// controls rather than a shared renderer: those are bound to one module-level list
// and to #streams, and generalizing them to reach in here would mean rewriting the
// path every other view already depends on. The stream *shape* is identical, and
// normalization goes through the plan's own normStream, so the two cannot drift on
// anything the engine sees.
function streamRows(v, i) {
  return (v.streams || []).map((s, j) => {
    const rel = s.basis === "ret", nm = escapeHtml((s.label || "Income " + (j + 1)) + " in " + variantName(v, i));
    return `
    <div class="ldstream" role="group" aria-label="${nm}">
      <div class="stream-top">
        <input type="text" class="vs-label" data-i="${i}" data-j="${j}" value="${escapeHtml(s.label)}" aria-label="${nm}: name">
        <button type="button" class="s-del vs-del" data-i="${i}" data-j="${j}" title="Remove" aria-label="Remove ${nm}"><span aria-hidden="true">&times;</span></button>
      </div>
      <div class="input-money"><input type="text" inputmode="numeric" class="money vs-amount" data-priv-kind="flow" data-i="${i}" data-j="${j}" value="${commafy(s.amount)}" aria-label="${nm}: annual amount"></div>
      <div class="stream-grid">
        <label class="mini">Basis<select class="vs-basis" data-i="${i}" data-j="${j}" aria-label="${nm}: when it runs">
          <option value="age"${rel ? "" : " selected"}>Fixed ages</option>
          <option value="ret"${rel ? " selected" : ""}>Vs. retirement</option>
        </select></label>
        <label class="mini">${rel ? "From (ret &plusmn;yrs)" : "From age"}<input type="text" class="vs-from" data-i="${i}" data-j="${j}" value="${escapeHtml(s.from)}"></label>
        <label class="mini">${rel ? "To (ret &plusmn;yrs)" : "To age"}<input type="text" class="vs-to" data-i="${i}" data-j="${j}" value="${escapeHtml(s.to)}" placeholder="life"></label>
      </div>
      <label class="cola"><input type="checkbox" class="vs-cola" data-i="${i}" data-j="${j}" ${s.cola ? "checked" : ""}> Inflation-adjusted</label>
    </div>`;
  }).join("");
}

function renderVariants(focus) {
  const host = el("ld-scens");
  const activeCount = variants.filter(v => v.on).length;
  host.innerHTML = variants.map((v, i) => {
    const name = escapeHtml(variantName(v, i));
    const idx = variants.slice(0, i).filter(x => x.on).length;
    const col = v.on && idx < MAX_ACTIVE ? SCEN_COLORS[idx] : "var(--edge)";
    const over = v.on && idx >= MAX_ACTIVE;
    return `
    <div class="ldscen${v.on ? " on" : ""}" role="group" aria-label="${name}">
      <div class="ldscen-top">
        <span class="ldscen-dot" style="background:${col}" aria-hidden="true"></span>
        <input type="text" class="lv-label" data-i="${i}" value="${escapeHtml(v.label)}" aria-label="Name of scenario ${i + 1}">
        <button type="button" class="s-del lv-del" data-i="${i}" title="Remove" aria-label="Remove ${name}"><span aria-hidden="true">&times;</span></button>
      </div>
      <label class="cola"><input type="checkbox" class="lv-on" data-i="${i}" ${v.on ? "checked" : ""}> Show on the ladder</label>
      ${over ? `<p class="hint">Not drawn — only ${MAX_ACTIVE} scenarios fit on one ladder.</p>` : ""}
      <label class="cola"><input type="checkbox" class="lv-useplan" data-i="${i}" ${v.useplan ? "checked" : ""}> Use the plan's income streams</label>
      ${v.useplan ? "" : `<div class="ldstreams">${streamRows(v, i)}</div>
      <div class="ldscen-acts">
        <button type="button" class="btn small lv-add" data-i="${i}">+ Add income</button>
        <button type="button" class="btn small lv-copy" data-i="${i}">Copy from plan</button>
      </div>`}
    </div>`;
  }).join("");

  const on = (sel, ev, fn) => host.querySelectorAll(sel).forEach(e => e.addEventListener(ev, fn));
  const S = e => variants[+e.dataset.i].streams[+e.dataset.j];

  on(".lv-label", "input", ev => {
    const i = +ev.target.dataset.i;
    variants[i].label = ev.target.value; markTouched();
    const name = variantName(variants[i], i), group = ev.target.closest(".ldscen");
    group.setAttribute("aria-label", name);
    group.querySelector(".lv-del").setAttribute("aria-label", "Remove " + name);
    scheduleLadder();
  });
  on(".lv-on", "change", ev => {
    const i = +ev.target.dataset.i;
    variants[i].on = ev.target.checked; markTouched();
    renderVariants({ sel: ".lv-on", i });
    scheduleLadder();
  });
  on(".lv-useplan", "change", ev => {
    const i = +ev.target.dataset.i;
    variants[i].useplan = ev.target.checked; markTouched();
    renderVariants({ sel: ".lv-useplan", i });
    scheduleLadder();
  });
  on(".lv-del", "click", ev => {
    const i = +ev.currentTarget.dataset.i;
    variants.splice(i, 1); markTouched();
    renderVariants({ sel: ".lv-del", i });
    if (!variants.length) el("ld-add-scen").focus();
    scheduleLadder();
  });
  on(".lv-add", "click", ev => {
    const i = +ev.currentTarget.dataset.i, list = variants[i].streams;
    list.push({ label: "Part-time", amount: 0, from: "0", to: "", cola: true, basis: "ret" });
    markTouched();
    renderVariants({ sel: ".vs-label", i: 0 });
    // Land in the new stream's name field, wherever the rebuild put it.
    const fields = host.querySelectorAll(`.ldscen:nth-of-type(${i + 1}) .vs-label`);
    if (fields.length) fields[fields.length - 1].focus();
    scheduleLadder();
  });
  on(".lv-copy", "click", ev => {
    const i = +ev.currentTarget.dataset.i;
    variants[i].streams = getStreams().map(s => Object.assign({}, s));
    markTouched();
    renderVariants({ sel: ".lv-copy", i });
    scheduleLadder();
  });
  on(".vs-label", "input", ev => { S(ev.target).label = ev.target.value; markTouched(); scheduleLadder(); });
  on(".vs-amount", "input", ev => { S(ev.target).amount = parseNum(ev.target.value); markTouched(); scheduleLadder(); });
  on(".vs-amount", "blur", ev => { if (!isPrivate()) ev.target.value = commafy(parseNum(ev.target.value)); });
  on(".vs-from", "input", ev => { S(ev.target).from = ev.target.value; markTouched(); scheduleLadder(); });
  on(".vs-to", "input", ev => { S(ev.target).to = ev.target.value; markTouched(); scheduleLadder(); });
  on(".vs-cola", "change", ev => { S(ev.target).cola = ev.target.checked; markTouched(); scheduleLadder(); });
  on(".vs-basis", "change", ev => {
    const s = S(ev.target), rel = ev.target.value === "ret";
    // Same reasoning as the plan's stream editor: "65" is an age on one basis and
    // 65 years after retiring on the other, so the old numbers can't carry over.
    s.basis = rel ? "ret" : "age";
    s.from = rel ? "0" : String(readParams().retAge);
    s.to = "";
    markTouched();
    renderVariants({ sel: ".vs-basis", i: 0 });
    scheduleLadder();
  });
  el("ld-add-scen").disabled = variants.length >= MAX_VARIANTS;
  el("ld-scen-note").textContent = activeCount > MAX_ACTIVE
    ? `Showing the first ${MAX_ACTIVE} of ${activeCount} scenarios switched on.` : "";
  refreshMasks();
  if (focus) refocus(host, focus.sel, focus.i);
}

export function renderLadderControls() { renderTiers(); renderVariants(); }

// ---------- Wiring ----------
// Set by initLadder so this module can ask for a redraw without importing the
// orchestrator, which imports this module — a cycle with no upside. The
// orchestrator supplies a debounced redraw, because every keystroke in the editors
// below lands here and a redraw is a full solve of every tier.
let scheduleLadder = () => {};

export function initLadder(onChange) {
  scheduleLadder = onChange;
  const p = readParams();
  seedFrom(p);
  setMoneyInput(el("ld-max"), commafy(seedMaxSpend(p)), "flow");
  renderLadderControls();
  el("ld-add-tier").addEventListener("click", () => {
    if (tiers.length >= MAX_TIERS) return;
    const cur = readParams();
    tiers.push({ label: "Tier " + (tiers.length + 1), anchor: "spend", spend: round1k(cur.spend), age: Math.max(cur.curAge, cur.retAge) });
    markTouched();
    renderTiers({ sel: ".lt-label", i: tiers.length - 1 });
    scheduleLadder();
  });
  el("ld-add-scen").addEventListener("click", () => {
    if (variants.length >= MAX_VARIANTS) return;
    variants.push({ label: "Scenario " + (variants.length + 1), on: variants.filter(v => v.on).length < MAX_ACTIVE, useplan: false, streams: [] });
    markTouched();
    renderVariants({ sel: ".lv-label", i: variants.length - 1 });
    scheduleLadder();
  });
  ["ld-target", "ld-max"].forEach(id => el(id).addEventListener("input", () => { markTouched(); scheduleLadder(); }));
  el("ld-max").addEventListener("blur", () => { if (!isPrivate()) el("ld-max").value = commafy(parseNum(el("ld-max").value)); });
}

// The card's one-line summary of what it's solving against, kept in step with the
// plan the way the income-stream notes are.
export function syncLadderNote() {
  const p = readParams(), cfg = ladderConfig();
  el("ld-note").textContent = `Searching ages ${p.curAge}–${p.endAge - 1} and spending up to ` +
    `${fmtMoney(cfg.maxSpend, true)}/yr, at ${cfg.target}% success.`;
}
