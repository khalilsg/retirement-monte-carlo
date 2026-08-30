// The transient status line at the bottom of the page, and the clipboard write that
// is almost always what raised one.
//
// Extracted from ui/scenarios.js once a second copy button (the analysis prompt)
// needed the same pair. Sharing them through a leaf module rather than importing
// scenarios.js keeps ui/prompt.js out of the scenarios ⇄ orchestrate cycle.
import { el } from "../dom.js";

let toastT = null;
export function toast(msg) {
  const t = el("toast");
  t.textContent = msg;
  t.classList.add("show");
  if (toastT) clearTimeout(toastT);
  toastT = setTimeout(() => t.classList.remove("show"), 2800);
}

// Copy `txt`, announcing either way. The clipboard API fails on an insecure origin
// and wherever the browser judges the click too far from the write, so `onFail` is
// required rather than optional: a copy button that silently does nothing is the
// worst of the three outcomes. The caller supplies its own fallback because where
// the text should be parked for hand-copying depends on what the text is — a
// scenario code belongs in the code box, a multi-kilobyte prompt does not.
export async function copyText(txt, okMsg, onFail) {
  try {
    await navigator.clipboard.writeText(txt);
    toast(okMsg);
  } catch (e) {
    onFail(txt);
  }
}
