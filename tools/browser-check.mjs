// End-to-end check of the parts the Node suite can't reach: the control layer and
// the charts, which need a real DOM. Serves the repo on an ephemeral port, drives
// it with Playwright, and fails on the first bad assertion or console error.
//
//   node tools/browser-check.mjs
//
// Playwright is a dev-only convenience, not a dependency of the app — if it isn't
// installed this exits 0 with a note, so it can run opportunistically in a hook.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json" };

let chromium;
try { ({ chromium } = await import("playwright")); } catch { 
  console.log("skipped: playwright is not installed (npm i -D playwright, then npx playwright install chromium)");
  process.exit(0);
}

// A static server small enough to not be worth a dependency. Paths are normalized
// and re-joined under ROOT so a request can't climb out of the repo.
const server = createServer(async (req, res) => {
  const rel = normalize(decodeURIComponent(req.url.split("?")[0])).replace(/^(\.\.[/\\])+/, "");
  const file = join(ROOT, rel === "/" ? "index.html" : rel);
  try {
    const body = await readFile(file);
    res.writeHead(200, { "content-type": TYPES[extname(file)] || "application/octet-stream" });
    res.end(body);
  } catch { res.writeHead(404).end("not found"); }
});
await new Promise(r => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}/index.html`;

let failures = 0;
const ok = (cond, msg) => { console.log(`${cond ? "  ok  " : "  FAIL"}  ${msg}`); if (!cond) failures++; };
const eq = (actual, expected, msg) => ok(actual === expected, `${msg}${actual === expected ? "" : `  (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`}`);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 1100 } });
const noise = [];
page.on("pageerror", e => noise.push("pageerror: " + e.message));
page.on("console", m => { if (m.type() === "error") noise.push("console: " + m.text()); });

const note = () => page.$eval(".stream-note", n => n.hidden ? "" : n.textContent);
const settle = ms => page.waitForTimeout(ms);

await page.goto(base, { waitUntil: "networkidle" });

// --- the app boots and computes something ---
ok(/\d/.test(await page.textContent("#run-note")), "boots and reports a run");
eq(await page.$eval(".stream-note", n => n.hidden), true, "a fixed-age stream shows no resolved-age note");

// --- switching a stream to the retirement-relative basis ---
await page.fill("#cur-age-v", "55");
await page.fill("#ret-age-v", "60");
await page.fill("#end-age-v", "95");
await page.click("body");
await page.selectOption("#s-basis-0", "ret");
await settle(500);
ok((await page.$eval('label[for="s-from-0"]', l => l.firstChild.textContent)).includes("ret"), "the From label switches to a retirement offset");
eq(await page.inputValue("#s-from-0"), "0", "a newly relative stream starts at retirement");
eq(await page.$eval("#s-basis-0", s => s.getAttribute("aria-label")), "Pension: when it runs", "the basis select is named for its stream");

await page.fill(".s-amount", "40000");
await page.fill("#s-from-0", "0");
await page.fill("#s-to-0", "4");
await settle(600);
eq(await note(), "Retiring at 60: ages 60–64", "the note resolves the offsets to ages");

// --- the note follows the retirement age ---
await page.fill("#ret-age-v", "67");
await settle(700);
eq(await note(), "Retiring at 67: ages 67–71", "the note follows the retirement age");
await page.fill("#ret-age-v", "60");
await settle(700);

// --- offsets reaching before today are clamped, and said to be ---
await page.fill("#s-from-0", "-8");
await settle(600);
eq(await note(), "Retiring at 60: ages 55–64", "a window opening before today is clamped to today");
await page.fill("#s-from-0", "0");
await settle(500);

// --- the heatmap actually varies along retirement age ---
await page.selectOption("#hx-var", "retAge");
const incKey = await page.$$eval("#hy-var option", os => os.map(o => o.value).find(v => v.startsWith("inc")));
ok(!!incKey, "the stream is offered as a heatmap axis");
await page.selectOption("#hy-var", incKey);
await settle(400);
await page.fill("#hx-from", "55");
await page.fill("#hx-to", "70");
await settle(2500);
const row = await page.$$eval("#heat-table tbody tr:last-child td", td => td.map(c => parseFloat(c.textContent)));
ok(row.length > 2 && row[row.length - 1] > row[0] + 5,
  `success rises across the retirement-age axis (${row[0]}% -> ${row[row.length - 1]}%)`);

// --- a shared code carries the basis ---
await page.$eval("#scen-more", d => { d.open = true; });
await page.click("#copy-code");
await settle(300);
const code = await page.inputValue("#scen-code");
await page.selectOption("#s-basis-0", "age");
await settle(400);
await page.fill("#scen-code", code);
await page.click("#load-code");
await settle(800);
eq(await page.inputValue("#s-basis-0"), "ret", "the basis survives a share code");
eq(await page.inputValue("#s-from-0"), "0", "so does the offset");
eq(await page.inputValue("#s-to-0"), "4", "and its end");

// --- a code written before the basis existed still reads as fixed ages ---
await page.fill("#scen-code", "3~ca-55~st-Social_Security*30000*67**1");
await page.click("#load-code");
await settle(800);
eq(await page.inputValue("#s-basis-0"), "age", "a pre-basis code loads as fixed ages");
eq(await page.inputValue("#s-from-0"), "67", "with its age intact");

// --- the preset carries one stream of each basis ---
await page.selectOption("#preset", "p_bridge");
await settle(1200);
const bases = await page.$$eval(".stream .s-basis", ss => ss.map(s => s.value));
eq(JSON.stringify(bases), JSON.stringify(["ret", "age"]), "the bridge preset shows both bases");

// --- the step-up ladder ---
// The bridge preset is still loaded: two income streams and a retirement age of 60.
await settle(1800);
const ladderRows = () => page.$$eval("#ladder-table tbody tr",
  trs => trs.map(tr => [tr.querySelector("th").textContent, ...[...tr.querySelectorAll("td")].map(td => td.textContent)]));

const seeded = await ladderRows();
eq(JSON.stringify(seeded.map(r => r[0])), JSON.stringify(["Bare-bones", "Necessities", "Comfortable"]), "the ladder seeds a rung per tier");
eq(await page.inputValue(".ldtier:nth-of-type(2) .lt-spend"), "60,000", "an untouched ladder seeds off the plan's spending");
eq((await page.$$("#ld-legend .li-scen")).length, 2, "both seeded scenarios reach the legend");
eq(JSON.stringify(seeded.map(r => r[2])), JSON.stringify(["Earliest age", "Earliest age", "Earliest age"]), "spend-anchored tiers solve for an age");

// An untouched ladder must not lengthen the code — that is what keeps the feature
// free for everyone who never opens the card.
await page.click("#copy-code");
await settle(300);
const bare = await page.inputValue("#scen-code");

// Anchoring a tier on its age moves it to the other panel, solved the other way.
await page.selectOption(".ldtier:nth-of-type(3) .lt-anchor", "age");
await settle(400);
await page.fill(".ldtier:nth-of-type(3) .lt-age", "62");
await settle(2000);
const flipped = await ladderRows();
eq(flipped[2][2], "Max spend", "an age-anchored tier solves for a spend");
ok(/^\$[\d,]+$/.test(flipped[2][3]), `and reports one (${flipped[2][3]})`);
eq(flipped[2][1], "age 62", "holding the age it was given");

// --- an edited ladder rides in the share code ---
await page.click("#copy-code");
await settle(300);
const withLadder = await page.inputValue("#scen-code");
ok(withLadder.length > bare.length, `an edited ladder lengthens the code (${bare.length} -> ${withLadder.length})`);

await page.click(".ldtier:nth-of-type(1) .lt-del");
await settle(800);
eq((await ladderRows()).length, 2, "a removed tier leaves the ladder");
await page.fill("#scen-code", withLadder);
await page.click("#load-code");
await settle(2200);
eq((await ladderRows()).length, 3, "the tiers come back from the code");
eq(await page.inputValue(".ldtier:nth-of-type(3) .lt-age"), "62", "with the anchored figure intact");
eq(await page.$eval(".ldtier:nth-of-type(3) .lt-anchor", s => s.value), "age", "and the anchor it was saved on");

// --- a scenario's income stream can be removed again ---
await page.click(".ldscen:nth-of-type(2) .lv-add");
await settle(700);
eq((await page.$$(".ldscen:nth-of-type(2) .ldstream")).length, 1, "a scenario takes an income stream");
await page.click(".ldscen:nth-of-type(2) .vs-del");
await settle(900);
eq((await page.$$(".ldscen:nth-of-type(2) .ldstream")).length, 0, "and the stream's x removes it again");

// --- the legend names each drawn scenario, beside the chart it labels ---
const legend = await page.$$eval("#ld-legend .li-scen", ls => ls.map(l => l.textContent.trim()));
eq(JSON.stringify(legend), JSON.stringify(["As planned", "Full stop"]), "the legend names every drawn scenario");
eq(await page.$eval("#ld-legend", n => n.nextElementSibling.id), "ladder", "and sits directly above the chart, not up in the card head");

// --- scenarios that agree share one neutral marker, and the legend says so ---
// Two scenarios reaching the same answer land on the same pixel; drawn in their own
// colours, the last one wins and the legend then reads as a claim about that one
// scenario. Making the second scenario inherit the plan forces the case.
const legendNow = () => page.$$eval("#ld-legend .li", ls => ls.map(l => l.textContent.trim()));
await page.selectOption(".ldscen:nth-of-type(2) .lv-mode", "plan");
await settle(2200);
const agreed = await legendNow();
ok(agreed.includes("scenarios agree"), `identical scenarios collapse to one marker (${agreed.join(", ")})`);
await page.selectOption(".ldscen:nth-of-type(2) .lv-mode", "only");
await settle(2200);
ok(!(await legendNow()).includes("scenarios agree"), "and the note goes once they diverge again");

// --- the three income-source modes produce three different ladders ---
// Asserting that the select exists, or that it shows and hides the stream editor,
// would pass with the layer mode entirely unwired: both of those follow from
// `useplan` alone, which the old checkbox already drove. What has to be pinned is
// that "plus these" actually layers — so give the scenario a large stream of its
// own and read the solved age back off the table under each mode. The bridge
// preset's two plan streams are what "plus these" adds on top.
const modeOptions = await page.$$eval(".ldscen:nth-of-type(2) .lv-mode option", os => os.map(o => o.value));
eq(JSON.stringify(modeOptions), JSON.stringify(["plan", "layer", "only"]), "three income-source modes are offered");

await page.selectOption(".ldscen:nth-of-type(2) .lv-mode", "only");
await settle(400);
await page.click(".ldscen:nth-of-type(2) .lv-add");
await settle(500);
await page.fill(".ldscen:nth-of-type(2) .vs-amount", "30000");
await page.fill(".ldscen:nth-of-type(2) .vs-from", "0");
await page.fill(".ldscen:nth-of-type(2) .vs-to", "35");
await settle(2600);
// Read the answer off the age-anchored tier, which solves for a maximum spend:
// more income means more spend, with no ceiling short of the search cap. The
// spend-anchored tiers are the wrong probe here — a bridge this size clears them
// from the first age searched, so all three modes report "already, at 55" and
// nothing distinguishes them. Column 3 is the first scenario, column 4 the second.
const solvedSpend = async () => {
  const rows = await ladderRows();
  const row = rows.find(r => r[2] === "Max spend");
  return row ? +row[4].replace(/[$,]/g, "") : NaN;
};
const onlyOwn = await solvedSpend();

await page.selectOption(".ldscen:nth-of-type(2) .lv-mode", "layer");
await settle(2600);
const layered = await solvedSpend();
eq(await page.$(".ldscen:nth-of-type(2) .lv-copy"), null, "layer mode drops \"Copy from plan\", which would double-count");
ok(Number.isFinite(layered) && Number.isFinite(onlyOwn), `both modes solve to a spend (${onlyOwn}, ${layered})`);
ok(layered > onlyOwn, `"plus these" adds the plan's income on top of the scenario's ($${layered} vs $${onlyOwn} on the scenario's alone)`);

await page.selectOption(".ldscen:nth-of-type(2) .lv-mode", "plan");
await settle(2600);
eq(await page.$(".ldscen:nth-of-type(2) .ldstreams"), null, "\"use the plan's income\" hides the stream editor");
const planOnly = await solvedSpend();
ok(layered > planOnly, `and layering beats the plan's income alone ($${layered} vs $${planOnly})`);

// Back to a scenario with its own stream only, for the axis checks below.
await page.selectOption(".ldscen:nth-of-type(2) .lv-mode", "only");
ok(await page.$(".ldscen:nth-of-type(2) .ldstreams") !== null, "\"only these\" brings the stream editor back");
await page.click(".ldscen:nth-of-type(2) .vs-del");
await settle(2600);

// --- the age axis fits the answers, not the search bounds ---
// A long plan-through age searches far more years than the answers span. Drawn to
// the search bounds, every rung piles up against the left edge.
const slide = (id, v) => page.$eval(id, (e, val) => { e.value = val; e.dispatchEvent(new Event("input", { bubbles: true })); }, v);
await slide("#end-age", "110");
await settle(2600);
const ageTicks = await page.$$eval("#ladder .axis text", ts => ts.map(t => +t.textContent).filter(Number.isFinite));
const lastTick = Math.max(...ageTicks);
ok((await ladderRows()).some(r => /^\d+$/.test(r[3])), "there are solved ages for the axis to fit to");
ok(lastTick < 90, `the age axis fits the answers, not the 55-109 search range (ends at ${lastTick})`);

// --- the "Chart axis" toggle switches back to the full search range on request ---
// And does it without re-solving. The select cannot move an answer, so it repaints
// the solve already in hand rather than running the debounced recompute, which
// re-bisects every tier against every scenario to arrive at identical figures.
//
// The budget below is 120ms, and the number matters: this ladder is small and the
// check runs at the default 1,000 sims, so a re-solve here costs only ~40ms — but
// it cannot dodge the 200ms typing debounce in front of it. Anything under 200ms
// therefore proves the solve path was skipped, whatever the machine's speed, while
// the repaint itself lands in ~15ms. Waiting on the axis to actually change, rather
// than sleeping a fixed interval, is what lets the elapsed time mean anything.
const axisEnd = () => page.$$eval("#ladder .axis text",
  ts => Math.max(...ts.map(t => +t.textContent).filter(Number.isFinite)));
const t0 = Date.now();
await page.selectOption("#ld-domain", "full");
await page.waitForFunction(() => {
  const ts = [...document.querySelectorAll("#ladder .axis text")].map(t => +t.textContent).filter(Number.isFinite);
  return ts.length && Math.max(...ts) >= 100;
}, null, { timeout: 4000 }).catch(() => {});
const swapMs = Date.now() - t0;
ok(await axisEnd() >= 100, `"Show full search range" restores the search bounds (ends at ${await axisEnd()})`);
ok(swapMs < 120, `and repaints the existing solve rather than re-running it (${swapMs}ms)`);
await page.selectOption("#ld-domain", "fit");
await settle(600);
ok(await axisEnd() < 90, "and switching back re-fits to the answers");

// --- the arrival range ---
// engine/arrival.js is covered in Node (test/arrival.test.js). What needs a real
// page is that the band reaches the chart at all, that the table carries the figure
// behind it, and that the toggle takes the cheap path in the one direction where a
// cheap path exists.
const bands = () => page.$$eval("#ladder rect[rx]", rs => rs.length);
const tableText = () => page.$eval("#ladder-table", t => t.textContent);

await settle(600);
ok(await bands() > 0, `the arrival range draws a band behind the rungs (${await bands()})`);
ok((await tableText()).includes("low draw"), "and the table gains a low-draw column per scenario");
// A band is the largest shape on the chart and has no other label. Nothing else on
// the card would tell a first-time reader what it is.
ok((await page.$$("#ld-legend .li-band")).length === 1, "and the legend says what the band is");
ok((await page.$eval("#ladder-card", n => n.textContent)).includes("no crossing gets no band"),
  "and \"How to read this\" explains the band, including when there isn't one");

// Hiding is a repaint of figures already in hand, so it must not re-solve. Same
// budget and same reasoning as the axis toggle above: the 200ms typing debounce sits
// in front of the solve path, so anything under it proves the solve was skipped.
const tHide = Date.now();
await page.selectOption("#ld-fan", "off");
await page.waitForFunction(() => document.querySelectorAll("#ladder rect[rx]").length === 0,
  null, { timeout: 4000 }).catch(() => {});
const hideMs = Date.now() - tHide;
eq(await bands(), 0, "hiding the range takes the bands off the chart");
ok(!(await tableText()).includes("low draw"), "and the figure out of the table");
ok(hideMs < 120, `and repaints rather than re-solving to do it (${hideMs}ms)`);

// Showing it again cannot be a repaint — those figures were never solved for — so
// this exercises the fall-through to the full solve.
await page.selectOption("#ld-fan", "on");
await settle(2600);
ok(await bands() > 0, "showing it again re-solves and the bands come back");
ok((await tableText()).includes("low draw"), "with the table figure back too");

// --- the analysis prompt ---
// The Node suite covers the serializer itself (test/prompt.test.js). What it cannot
// reach is the wiring: which button builds which variant, and whether private mode
// actually shuts the dollars one down. Both of those are the privacy promise, and
// both would pass every unit test while being exactly backwards.
await page.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin: new URL(base).origin });
const clip = () => page.evaluate(() => navigator.clipboard.readText());

await page.click("#copy-prompt");
await settle(1200);
const dollars = await clip();
ok(dollars.includes("## The step-up ladder"), "the dollars prompt carries the ladder");
ok(/\$[\d,]+/.test(dollars), "and states amounts in dollars");
ok(/Scenario code for this plan/.test(dollars), "and carries the scenario code to reproduce it");

await page.click("#copy-prompt-rel");
await settle(1200);
const ratios = await clip();
ok(ratios.includes("## The step-up ladder"), "the ratios prompt carries the same ladder");
// The whole claim the second button makes about itself. A wiring mistake that sent
// both buttons to the same variant leaves every other assertion here passing.
ok(!ratios.includes("$"), "and contains no dollar amount anywhere");
ok(/×/.test(ratios) && /Amounts here are deliberately relative/.test(ratios), "stating balances as multiples instead");
ok(!/Scenario code for this plan/.test(ratios), "and drops the code, which would decode back to the amounts");

// The warning has to be in the flow and legible, not parked in a title attribute
// where nobody who has already decided to click will ever see it.
eq(await page.$eval(".prompt-warn", n => n.offsetParent !== null && n.textContent.includes("third-party service")), true,
  "the privacy warning is visible text, not a tooltip");

// Private mode is a statement that real numbers aren't leaving the page. The
// dollars variant has to go with it, exactly as Copy code does; the ratios one is
// the whole reason there are two buttons, so it has to stay.
await page.click("#priv-toggle");
await settle(1500);
eq(await page.$eval("#copy-prompt", b => b.disabled), true, "private mode disables the dollars prompt");
eq(await page.$eval("#copy-prompt-rel", b => b.disabled), false, "and leaves the ratios prompt available");
await page.click("#copy-prompt-rel");
await settle(1200);
ok(!(await clip()).includes("$"), "which still copies, still without amounts");
await page.click("#priv-toggle");
await settle(1200);
eq(await page.$eval("#copy-prompt", b => b.disabled), false, "and leaving private mode restores it");

// --- typing an age into a slider's box still toggles the panels it gates ---
// initValueInputs steers the range by assigning range.value, which fires no input
// event — so the range's own listener, the only other caller of toggleModePanels,
// never runs. Retiring at the current age hides the contribution field; the check
// is that typing a later age into the box beside the slider brings it back.
await slide("#cur-age", "40");
await slide("#ret-age", "40");
await settle(600);
eq(await page.$eval("#contrib-field", n => n.hidden), true, "retiring today hides the contribution field");
await page.fill("#ret-age-v", "55");
await settle(600);
eq(await page.$eval("#contrib-field", n => n.hidden), false, "and typing a later retirement age brings it back");

ok(noise.length === 0, `no console errors or page exceptions${noise.length ? ": " + noise.join(" | ") : ""}`);

await browser.close();
server.close();
console.log(failures ? `\n${failures} browser check(s) failed` : "\nall browser checks passed");
process.exit(failures ? 1 : 0);
