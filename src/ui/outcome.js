// The headline outcome card: success probability, verdict, confidence interval,
// the risk meter, and the summary stat tiles.
import { el } from "../dom.js";
import { fmtMoney } from "../format.js";
import { currentSims } from "./controls.js";
import { stageSummary } from "./announce.js";

export function renderOutcome(r) {
  el("prob").textContent = r.successPct.toFixed(1) + "%";
  let color, label;
  if (r.successPct >= 90) { color = "var(--good)"; label = "Very likely to last"; }
  else if (r.successPct >= 80) { color = "var(--good)"; label = "Likely to last"; }
  else if (r.successPct >= 65) { color = "var(--warn)"; label = "Uncertain — worth tightening"; }
  else { color = "var(--danger)"; label = "At risk of depletion"; }
  el("prob").style.color = color; el("verdict").textContent = label; el("verdict").style.color = color;
  // The phone-only pinned copy (hidden by CSS on desktop).
  el("mini-prob").textContent = r.successPct.toFixed(1) + "%";
  el("mini-prob").style.color = color;
  el("mini-verdict").textContent = label;
  el("mini-verdict").style.color = color;
  // Wilson 95% confidence interval for the success proportion (Monte Carlo sampling error)
  const n = currentSims(), z = 1.96, ph = r.successPct / 100, denom = 1 + z * z / n;
  const cen = (ph + z * z / (2 * n)) / denom, hw = (z / denom) * Math.sqrt(ph * (1 - ph) / n + z * z / (4 * n * n));
  const ciLo = Math.max(0, cen - hw) * 100, ciHi = Math.min(1, cen + hw) * 100;
  el("prob-ci").textContent = "95% CI " + ciLo.toFixed(1) + "–" + ciHi.toFixed(1) + "%";
  el("meter-mk").style.left = "calc(" + Math.max(0, Math.min(100, r.successPct)) + "% - 1.5px)";
  el("hz-label").textContent = r.retYears;
  const stats = [];
  if (r.A > 0) stats.push({ k: "Median nest egg at retirement", v: fmtMoney(r.medNest), sm: true });
  stats.push({ k: "Median end balance", v: fmtMoney(r.medEnd) }, { k: "10th-pct end balance", v: fmtMoney(r.p10End) });
  if (r.guard) stats.push({ k: "Median lean-year spend", v: fmtMoney(r.medLowSpend, true), sm: true });
  else stats.push({ k: "Worst case", v: fmtMoney(r.worst) });
  stats.push({ k: r.medDep ? "Median fail age" : "Failures", v: r.medDep ? ("Age " + (r.ca + r.medDep)) : "0", sm: true });
  el("stats").innerHTML = stats.map(s => `<div class="stat"><div class="k">${s.k}</div><div class="v${s.sm ? " sm" : ""}">${s.v}</div></div>`).join("");

  // Spelled out for listening: "87.3%" is read inconsistently across screen
  // readers, and the en-dash in the CI gets read as a hyphen or skipped.
  stageSummary(
    `Success probability ${r.successPct.toFixed(1)} percent — ${label.replace("—", ",").toLowerCase()}. ` +
    `95 percent confidence interval ${ciLo.toFixed(1)} to ${ciHi.toFixed(1)} percent, ` +
    `from ${n.toLocaleString("en-US")} simulations over a ${r.retYears}-year retirement. ` +
    stats.map(s => `${s.k}: ${s.v}`).join(". ") + ".");
}
