// The analysis prompt: everything the app has computed, serialized as text, wrapped
// in a request for the reading the app itself can't give.
//
// The division of labor is the whole design. A chat model cannot run this engine —
// it cannot bisect simSuccess, it cannot resample 98 years of returns — and asked
// for a figure it has no way to reach, it will produce one anyway. So every number
// worth having is computed here and shipped as data, and what's asked for is the
// interpretation: what the headline is worth as a thing to steer by, what the
// failure fraction actually costs, which assumption is carrying the plan. The
// preamble says this in the imperative because a general instruction not to invent
// numbers covers the sections that don't exist yet as well as the ones that do.
//
// This module is pure and DOM-free — a data bundle in, a string out — so the whole
// serializer is testable in Node (test/prompt.test.js) despite everything it
// describes being assembled by the UI layer. ui/prompt.js does the gathering.
import { PARAM_FIELDS } from "./parameters.js";
import { asRatio } from "../format.js";

// The two money renderers, both defined here rather than borrowed from format.js's
// fmtFull. That function switches on a module-level private-mode flag, and the whole
// point of the normalized variant is that it is chosen per call: a serializer that
// read the flag could emit ratios when asked for dollars, or dollars when asked for
// ratios, depending on a toggle nowhere near the call. Deriving the reference amount
// from the plan in hand (the same rule as setPrivacyUnit — balance today, falling
// back to annual spending for a plan starting from zero) keeps that self-contained
// too, rather than depending on when the page last re-anchored its own unit.
function moneyFmt(p, normalized) {
  if (!normalized) return x => "$" + Math.round(x).toLocaleString("en-US");
  const unit = p.start > 0 ? p.start : (p.spend > 0 ? p.spend : 1);
  return (x, flow) => asRatio(x, flow, unit, true);
}
function unitPhrase(p) {
  return p.start > 0 ? "your balance today" : "your annual spending";
}

// An income stream's sweep label carries its own units ("Bridge job ($/yr)"),
// baked in by streamMeta from the page's private-mode flag rather than from this
// variant. Normalizing the values while leaving that alone printed a dollar sign in
// the middle of a prompt whose whole claim is that it has none — a units annotation
// rather than an amount, but the promise doesn't have an asterisk. Rewriting it to
// the form private mode uses keeps label and column in the same units.
function metaLabel(meta, normalized) {
  return normalized ? meta.label.replace(" ($/yr)", " (/yr)") : meta.label;
}

// A sweep meta's value in its own units, without going through sweepFmt — same
// reason as above: sweepFmt's money branch reads the private-mode flag.
function metaFmt(meta, x, money) {
  if (meta.kind === "money") return money(x, meta.flow) + (meta.flow ? "/yr" : "");
  if (meta.kind === "pctDec") return x.toFixed(2) + "%";
  if (meta.kind === "pctInt") return Math.round(x) + "%";
  return String(Math.round(x));
}

// ---------- The plan block ----------
// Derived from PARAMS, never hand-listed. A hand-written block would quietly stop
// mentioning any tunable added after it was written, which is the exact failure the
// registry exists to prevent — and an assumption missing from the prompt is worse
// than one missing from a chart, because the reader can see a chart.
function planLines(p, money) {
  const out = [];
  for (const e of PARAM_FIELDS) {
    // Relevance: reuse the registry's own test where there is one (a glide-path
    // parameter under a fixed allocation is noise, not information), and let an
    // entry with no sweep block state its own.
    if (e.sweep && e.sweep.when && !e.sweep.when(p)) continue;
    if (e.promptWhen && !e.promptWhen(p)) continue;
    const name = e.promptLabel || (e.sweep && e.sweep.label) || e.param;
    const v = p[e.param];
    let text;
    if (e.repr === "money") text = money(v, !!(e.sweep && e.sweep.flow)) + (e.sweep && e.sweep.flow ? "/yr" : "");
    // A pct or int entry's own label formatter is already pure arithmetic — only
    // the money ones reach for a formatter that knows about private mode.
    else if (e.labelText) text = String(e.labelText(v)) + (e.repr === "pct" ? "%" : "");
    else text = String(v);
    out.push("- " + name + ": " + text);
  }
  return out;
}

// An income stream's two age bases read differently in prose, and the difference is
// the subtlest thing in the model: an "age" stream is pinned to a birthday, a "ret"
// one slides with every retirement age the ladder tries. Saying which in words is
// what stops a reader treating a solved age as if the stream had stayed put.
function streamLines(p, money) {
  if (!p.streams.length) return ["- none"];
  return p.streams.map(s => {
    const when = s.basis === "ret"
      ? "from " + (s.from === 0 ? "the year you retire" : s.from > 0 ? s.from + " years after retiring" : Math.abs(s.from) + " years before retiring") +
        (s.to == null ? " onward" : " to " + s.to + " years after retiring")
      : "from age " + s.from + (s.to == null ? " onward" : " to age " + s.to);
    return "- " + (s.label || "Income") + ": " + money(s.amount, true) + "/yr, " + when +
      ", " + (s.cola ? "inflation-adjusted" : "flat in nominal terms (so it erodes)") +
      ", dated " + (s.basis === "ret" ? "relative to retirement" : "by age");
  });
}

// ---------- The ladder block ----------
// The solver reports three outcomes and only one of them is a number (see
// engine/ladder.js). Spelling out the other two in full is the point: "not by 94"
// compressed into a chart label is fine next to a hollow dot that explains it, but
// a bare figure in a text block would read as an answer.
export function cellPhrase(c, money) {
  if (c.solvedFor === "age") {
    if (c.status === "solved") return "age " + c.value + " (" + c.success.toFixed(1) + "% there)";
    if (c.status === "all") return "clears it already at " + c.lo + ", the earliest age searched (" + c.sLo.toFixed(1) + "%) — no crossing to find";
    return "never clears it — " + c.sHi.toFixed(1) + "% even at " + c.hi + ", the latest age searched";
  }
  if (c.status === "solved") return money(c.value, true) + "/yr (" + c.success.toFixed(1) + "% there)";
  if (c.status === "all") return "still clears it at " + money(c.hi, true) + "/yr, the top of the search — the cap is binding, not the plan";
  return "misses the target even spending nothing (" + c.sLo.toFixed(1) + "%)";
}

// What a rung becomes on a low arrival, with the difference spelled out. The signed
// difference is the half that is a decision rather than a fact — "age 47" states
// something, "three years later" asks something of you — and it is withheld wherever
// either end isn't a figure, the same discipline cellPhrase keeps above.
export function fanPhrase(cell, fan, money) {
  if (!fan || !fan.points.length) return "—";
  const low = fan.points[0];
  const base = cellPhrase(low, money);
  if (low.status !== "solved" || cell.status !== "solved") return base;
  const d = low.value - cell.value;
  if (d === 0) return base + " — no change";
  const mag = Math.abs(d);
  return base + " — " + (low.solvedFor === "age"
    ? mag + (mag === 1 ? " year" : " years") + (d > 0 ? " later" : " earlier")
    : money(mag, true) + "/yr " + (d > 0 ? "more" : "less"));
}

function ladderBlock(ld, money) {
  if (!ld || !ld.rows.length || !ld.scenarios.length) return ["(no ladder tiers or no scenario switched on)"];
  const names = ld.scenarios.map((v, i) => v.label || "Scenario " + (i + 1));
  // The low-draw columns are grouped after the answers rather than interleaved, the
  // same layout the app's own data table uses — someone reading the two side by side
  // shouldn't have to re-learn the shape.
  const anyFan = ld.rows.some(r => r.fans && r.fans.some(Boolean));
  const head = ["Tier", "Held fixed", "Solving for"].concat(names)
    .concat(anyFan ? names.map(n => n + " — low draw") : []);
  const rows = ld.rows.map((r, i) => {
    const t = r.tier, byAge = t.anchor === "age";
    return [
      t.label || "Tier " + (i + 1),
      byAge ? "age " + t.age : money(t.spend, true) + "/yr",
      byAge ? "the most it could spend" : "the earliest age it could start",
    ].concat(r.cells.map(c => cellPhrase(c, money)))
     .concat(anyFan ? r.cells.map((c, j) => fanPhrase(c, r.fans && r.fans[j], money)) : []);
  });
  return mdTable(head, rows);
}

function mdTable(head, rows) {
  return [
    "| " + head.join(" | ") + " |",
    "|" + head.map(() => " --- ").join("|") + "|",
  ].concat(rows.map(r => "| " + r.join(" | ") + " |"));
}

// ---------- The whole thing ----------
// `bundle` is assembled by ui/prompt.js: { version, date, p, nSims, full, tornado,
// ladder, corridor, code }. Ladder rows carry their own `fans` (see engine/arrival.js);
// `corridor` is present only when a tier is selected for one (see engine/corridor.js). `normalized` swaps every money figure for its ratio form.
export function buildPrompt(bundle, normalized) {
  const { p, nSims, full, tornado, ladder, corridor, version, date, code } = bundle;
  const money = moneyFmt(p, normalized);
  const target = ladder && ladder.cfg ? ladder.cfg.target : null;
  const ph = full.successPct / 100;

  // Two different uncertainties, and conflating them is the obvious misreading, so
  // both are labeled for what they are. The Wilson interval is sampling error — how
  // much of this figure is the dice rather than the plan, and it shrinks with more
  // sims. The RMS drift is not error at all: a probability that will resolve to 0 or
  // 1 is a martingale, so its expected total movement between now and then is
  // sqrt(p(1-p)) whether or not the model is right. That is the one that matters for
  // "is this a number to steer by", and no number of extra sims touches it.
  const z = 1.96, denom = 1 + z * z / nSims;
  const cen = (ph + z * z / (2 * nSims)) / denom;
  const hw = (z / denom) * Math.sqrt(ph * (1 - ph) / nSims + z * z / (4 * nSims * nSims));
  const ciLo = Math.max(0, cen - hw) * 100, ciHi = Math.min(1, cen + hw) * 100;
  const drift = Math.sqrt(ph * (1 - ph)) * 100;

  const L = [];
  const push = (...xs) => { for (const x of xs) L.push(x); };

  push(
    "I run a Monte Carlo retirement simulator against the 1928–2025 historical record, and I want",
    "a written reading of what it found — not more arithmetic. Everything numeric below was computed",
    "by the simulator.",
    "",
    "**Ground rule: use only the numbers in this message.** You can't run this model, so anything you'd",
    "have to compute — a success rate under assumptions I haven't given you, a rung or a scenario I",
    "haven't listed, anything at a date the figures below don't cover — is not available to you. Where a question",
    "below needs a figure that isn't here, say what's missing and what it would take to get it. Don't",
    "estimate it. A confident invented number is the one failure mode that makes this whole exercise",
    "worse than useless.",
    "",
    "Please cover these, in this order, with a heading each:",
    "",
    "1. **Where this sits.** The headline against my target, stated plainly, in a couple of sentences.",
    "2. **The ladder as it stands.** What the tiers below actually say, including which rungs have no",
    "   crossing to report and what that means. Say which scenario differences are doing real work.",
    "3. **How much this number is worth.** A single success probability is a poor thing to steer by:",
    "   it's guaranteed to move as the years resolve, and the drift figure below says how far. Explain",
    "   what that implies about treating the headline as a target versus as one reading.",
    "4. **What the failure fraction actually costs.** Not ruin — a mid-course correction you would see",
    "   coming, and the ladder below now prices it: each rung carries a *low draw* figure, which is what",
    "   that rung becomes if I reach its date with a 10th-percentile balance. Read those as the cost of a",
    "   bad run, in years or in spending. Say which rungs absorb it and which don't, and what that means",
    "   for which rung is actually the safe one to aim at.",
    "5. **The balance track**, if one is included below. Say what the requirement at each age means in practice —",
    "   what I would actually check, and when a shortfall would be worth acting on rather than riding out.",
    "6. **Which assumption is carrying the plan.** Read the sensitivity ranking below — what it means",
    "   that this particular assumption tops it, and which entries are ones I control versus ones I'm",
    "   just exposed to.",
    "7. **The sampling caveat.** Read the note at the end and say what it means for *this* plan given",
    "   where its success rate sits.",
    "8. **What to check at the next review.** A short list, each item a thing I could actually observe.",
    "",
    "Be direct and skeptical. If the plan looks fragile, say so. If a figure below undercuts something",
    "else in it, point at the tension rather than smoothing it over.",
    "",
    "---",
    "",
    "## The plan",
    ""
  );

  if (normalized) push(
    "Amounts here are deliberately relative, not dollars: balances as a multiple of " + unitPhrase(p) + " (\"1.84×\"),",
    "annual flows as a percentage of it (\"4.7%\" — which for spending is just the withdrawal rate). Every ratio,",
    "probability and age is exact and unchanged; only the scale is withheld. Answer in the same terms.",
    ""
  );

  push(...planLines(p, money), "", "### Income streams", "", ...streamLines(p, money), "",
    "## What the simulator found", "",
    "- Success probability: **" + full.successPct.toFixed(1) + "%**" + (target != null ? " (my target is " + target + "%)" : ""),
    "- Monte Carlo sampling error: 95% CI " + ciLo.toFixed(1) + "–" + ciHi.toFixed(1) + "% over " + nSims.toLocaleString("en-US") + " simulated paths",
    "- Expected total drift of this probability before the outcome is settled: **±" + drift.toFixed(0) + " points**",
    "  (RMS movement of a martingale that ends at 0 or 1, = sqrt(p(1−p)); this is not sampling error and more",
    "  simulations do not shrink it)",
    "- Retirement lasts " + full.retYears + " years in the plan (retire at " + full.retAge + ", plan through " + p.endAge + ")");

  if (full.A > 0) push("- Median balance at retirement: " + money(full.medNest));
  push(
    "- Median ending balance: " + money(full.medEnd),
    "- 10th-percentile ending balance: " + money(full.p10End));
  if (full.guard) push("- Median worst-year spending under the guardrails: " + money(full.medLowSpend, true) + "/yr");
  else push("- Worst ending balance across all paths: " + money(full.worst));
  push(full.medDep
    ? "- Among the paths that fail, the median one runs out at age " + (full.ca + full.medDep)
    : "- No path ran out of money");

  push("", "## The step-up ladder", "",
    "Each rung fixes the target success rate of " + (target != null ? target + "%" : "the plan") + " and solves for the other half by",
    "bisecting the simulation itself. A tier anchored on a spend gives the earliest age; one anchored on an age",
    "gives the highest spend. The columns are alternative assumptions about income after stopping.",
    "");
  push(...ladderBlock(ladder, money));
  if (ladder && ladder.rows && ladder.rows.some(r => r.fans && r.fans.some(Boolean))) push("",
    "The **low draw** columns re-solve each rung as if I reach its date with a 10th-percentile balance — the",
    "answer a bad run would leave me with, rather than today's central forecast. Two things about them. They are",
    "one-sided on an age solve: I cannot stop earlier than the date the rung already names, so a good draw leaves",
    "the answer where it is and only a bad one moves it later. And a rung with no crossing has no date to arrive",
    "at, so it has no low draw either — those read as a dash, not as a zero cost.");

  if (corridor) {
    push("", "## The balance track for the " + corridor.tier + " tier", "",
      "One rung, viewed over time. This is the balance I would need at each age between now and " + corridor.c.date + " to keep",
      "that tier at the target rate — the checkable form of the probability, since a balance is something I can look up",
      "once a year and a probability is not. It assumes the plan keeps running: contributions continue to the date, so",
      "the line reads \"am I on track?\" rather than \"could I coast from here?\". Beside it is where the plan is actually",
      "projected to be, so the reading is whether the projection clears the requirement and by how much.",
      "");
    push(...mdTable(
      ["Age", "Balance needed", "Projected 10th", "Projected median", "Projected 90th"],
      corridor.c.points.map(o => {
        const i = corridor.c.bands.ages.indexOf(o.age);
        // The same three outcomes once more. "0" would read as "you need nothing" in
        // one case and as an answer in the other, and only one of those is true.
        const need = o.status === "all" ? "any balance"
          : o.status === "none" ? "no balance in range clears it"
          : money(o.value);
        return [o.age, need, money(corridor.c.bands.p10[i]), money(corridor.c.bands.p50[i]), money(corridor.c.bands.p90[i])];
      })));
    const x = corridor.crossing;
    if (x) push("",
      x.status === "above" ? "Even a 10th-percentile run stays above that line the whole way."
        : x.status === "below" ? "A 10th-percentile run is already below that line today."
        : "A 10th-percentile run stays above that line through age " + x.age + ", and falls behind after.",
      "The median clears it near enough by construction — the rung is defined as the point where the plan hits the",
      "target — so the lower band is the one worth reading.");
  }

  push("", "## Which assumption moves the answer most", "",
    "Each row moves one assumption across a plausible range with everything else held at the plan above,",
    "and reports the success probability at each end. Ranked by the swing between them.",
    "");
  push(...mdTable(
    ["Assumption", "Low end", "Success", "High end", "Success", "Swing"],
    tornado.rows.map(r => [
      metaLabel(r.meta, normalized),
      metaFmt(r.meta, r.lo, money), r.sLo.toFixed(1) + "%",
      metaFmt(r.meta, r.hi, money), r.sHi.toFixed(1) + "%",
      r.impact.toFixed(1) + " pts",
    ])));

  push("", "## Method, and the one caveat that bites", "",
    "Returns aren't modeled with a formula. Each simulated year replays a real calendar year from 1928–2025 —",
    "that year's S&P 500 total return, 10-year Treasury return and CPI inflation together — so inflation carries",
    "its actual effect on real bond returns. Everything is in today's dollars.",
    "",
    p.blockLen > 1
      ? "This run uses **" + p.blockLen + "-year block sampling**: contiguous runs drawn from the record, preserving real"
        + " sequences like 1929–33 or 1973–74."
      : "This run uses **independent-year sampling**: each year drawn at random, with no memory.",
    "",
    "It is tempting to call block sampling the conservative choice. This model does not bear that out. What blocks",
    "mostly preserve is the record's mild mean reversion, which independent years destroy — a bad run is somewhat",
    "more likely to be followed by a good one. Over a long horizon that narrows the spread of outcomes without",
    "moving the middle. So a tighter distribution *helps* a plan whose middle path survives and *hurts* one relying",
    "on a lucky tail. The crossover is near 50% success: above it blocks read roughly two to four points friendlier",
    "than independent years, below it one to two points harsher. The caveat on all of it is that this mean reversion",
    "is a property of a single 98-year record — a plan that only clears its target under blocks is leaning on the",
    "next fifty years reverting the way the last hundred did. Neither mode is the safe one; the gap between them is",
    "the thing worth looking at.",
    "",
    "---",
    "");

  // The code goes last and is labeled for what it is: not something to interpret,
  // and useless to a model with no access to codec.js. It is here so a reading can
  // be reproduced against the exact plan that produced it months later.
  //
  // The normalized variant drops it, for the same reason Copy code is disabled in
  // private mode: the code decodes straight back to the real amounts, so shipping it
  // alongside carefully withheld figures would hand over everything that was
  // withheld. The check is here rather than only in the caller that gathers the
  // bundle because this is the module that makes the promise — a variant that
  // withholds dollars has to withhold them whatever it was handed.
  if (code && !normalized) push("Scenario code for this plan (paste into the app to reproduce it exactly — not something you need to read): `" + code + "`", "");
  push("Simulator " + version + ", run " + date + ".");

  return L.join("\n");
}
