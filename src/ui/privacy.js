// Private mode: show the whole plan without showing a single dollar amount.
//
// The rendered figures are handled in format.js — everything here is the chrome
// around it: the toggle, the explanatory note, masking the money *inputs* (whose
// values are the one place a real number must survive), and shutting down the
// paths that would put real numbers back on screen (the preset labels, which name
// amounts, and the scenario code, which encodes them).
import { el } from "../dom.js";
import { isPrivate, setPrivate, fmtMoney, parseNum, unitLabel } from "../format.js";

const KEY = "mc_private";

// ---------- Money inputs ----------
// A money input keeps its true value in dataset.privReal while masked, so reads go
// through format.js's inputVal(). Anything writing one must use setMoneyInput.

// Write a value into a text input, declaring whether it currently holds money
// ("stock" for a balance, "flow" for a per-year amount, null for a plain number).
export function setMoneyInput(elm, realText, kind) {
  if (kind) elm.dataset.privKind = kind; else delete elm.dataset.privKind;
  delete elm.dataset.privReal;
  elm.readOnly = false;
  elm.value = realText;
  refreshMasks();
}

// Re-derive every masked display from its true value. Cheap, and called on each
// recompute so masks track both edits and a change of reference unit.
export function refreshMasks() {
  for (const inp of document.querySelectorAll("[data-priv-kind]")) {
    if (isPrivate()) {
      if (inp.dataset.privReal == null) inp.dataset.privReal = inp.value;
      inp.value = fmtMoney(parseNum(inp.dataset.privReal), inp.dataset.privKind === "flow");
      inp.readOnly = true;
    } else if (inp.dataset.privReal != null) {
      inp.value = inp.dataset.privReal;
      delete inp.dataset.privReal;
      inp.readOnly = false;
    }
  }
}

// Exchange two inputs' contents *including* their masking state. Swapping bare
// `.value` would leave a masked display pointing at the other field's true value,
// so any transpose (the heatmap's swap-axes) has to go through this.
export function swapInputs(a, b) {
  const grab = e => ({ v: e.value, real: e.dataset.privReal, kind: e.dataset.privKind });
  const put = (e, s) => {
    e.value = s.v;
    if (s.kind == null) { delete e.dataset.privKind; delete e.dataset.privReal; e.readOnly = false; }
    else { e.dataset.privKind = s.kind; if (s.real == null) delete e.dataset.privReal; else e.dataset.privReal = s.real; }
  };
  const sa = grab(a), sb = grab(b);
  put(a, sb); put(b, sa);
  refreshMasks();
}

// Restore true values everywhere — for code that writes money inputs directly and
// then calls refreshMasks() to re-mask (see applyScenario).
export function clearMasks() {
  for (const inp of document.querySelectorAll("[data-priv-real]")) {
    inp.value = inp.dataset.privReal;
    delete inp.dataset.privReal;
    inp.readOnly = false;
  }
}

// ---------- Chrome ----------
function applyChrome() {
  const on = isPrivate();
  document.body.classList.toggle("private", on);
  const btn = el("priv-toggle");
  btn.setAttribute("aria-pressed", String(on));
  // The padlock is decoration; left bare a screen reader reads "locked, Private
  // mode" on a control whose state is already carried by aria-pressed.
  btn.innerHTML = '<span aria-hidden="true">🔒</span> ' + (on ? "Private — showing ratios" : "Private mode");
  el("priv-note").hidden = !on;
  el("priv-unit").textContent = unitLabel();

  // Preset names carry amounts ("Balanced — $1.5M, $70k"); keep just the name.
  for (const opt of el("preset").options) {
    if (opt.dataset.full == null) opt.dataset.full = opt.textContent;
    opt.textContent = on ? opt.dataset.full.split(" — ")[0] : opt.dataset.full;
  }

  // The scenario code encodes the real numbers, so copying it mid-share would
  // paint them into the box below. Loading someone else's code stays available.
  const copy = el("copy-code");
  copy.disabled = on;
  copy.title = on ? "Disabled in private mode — the code contains your real amounts" : "";
  if (on) el("scen-code").value = "";

  refreshMasks();
}

export function initPrivacy(onChange) {
  let saved = false;
  try { saved = localStorage.getItem(KEY) === "1"; } catch (e) {}
  setPrivate(saved);
  applyChrome();
  el("priv-toggle").addEventListener("click", () => {
    setPrivate(!isPrivate());
    try { localStorage.setItem(KEY, isPrivate() ? "1" : "0"); } catch (e) {}
    applyChrome();
    onChange();
  });
}

// The note names the reference amount, which can change as the plan changes.
export function syncPrivacyNote() { if (isPrivate()) el("priv-unit").textContent = unitLabel(); }
