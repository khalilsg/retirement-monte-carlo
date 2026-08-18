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

ok(noise.length === 0, `no console errors or page exceptions${noise.length ? ": " + noise.join(" | ") : ""}`);

await browser.close();
server.close();
console.log(failures ? `\n${failures} browser check(s) failed` : "\nall browser checks passed");
process.exit(failures ? 1 : 0);
