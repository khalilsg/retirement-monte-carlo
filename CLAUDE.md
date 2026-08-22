# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
python3 -m http.server            # serve — native ES modules need HTTP, not file://
node --test test/*.test.js        # the Node suite (~1s)
node --test test/codec.test.js    # a single file
node --test --test-reporter=spec test/*.test.js   # readable output when something fails
node tools/browser-check.mjs      # end-to-end via Playwright; exits 0 with a note if absent
git config core.hooksPath .githooks   # once per clone — enables the pre-push gate
```

There is no build step, no bundler, no runtime dependency. Playwright is a dev-only
convenience installed with `npm i -D playwright`; the `package.json` and lockfile that
creates are gitignored and must never be committed — the app has no manifest of its own.

**In the Claude Code cloud container** the bundled Chromium (build 1194) mismatches the
npm Playwright version, so `chromium.launch()` fails. Run a patched copy rather than
editing the committed file:

```bash
sed 's|chromium.launch()|chromium.launch({ executablePath: "/opt/pw-browsers/chromium" })|' \
  tools/browser-check.mjs > tools/_bc.mjs && node tools/_bc.mjs; rm -f tools/_bc.mjs
```

## Architecture

**`src/config/parameters.js` is the spine.** Each `PARAMS` entry describes one tunable
end-to-end: its DOM element, how the raw string becomes an engine value, how its live
label renders, its short key in the scenario codec, and its sweep/tornado/heatmap
metadata. `readParams`, `syncLabels`, the codec, and every sensitivity tool derive from
that list. **Adding a tunable is one entry here plus its HTML control** — touching the
consumers individually means you've done it wrong.

**One sampling matrix, reused everywhere.** `engine/rng.js` builds a seeded
`nSims × MAXY` matrix of historical-year indices (common random numbers). Every
simulator and every sweep point reads the same matrix, so a difference between two runs
reflects the assumption that changed rather than fresh dice. Anything that varies
`blockLen` must rebuild it and restore it afterwards — see `meta.crn` handling in
`charts/sweep.js`.

**Income streams have two age bases**, and this is the subtlest thing in the model.
`basis: "age"` pins a stream to fixed ages; `basis: "ret"` measures years from
retirement, so the stream slides with `retAge` — including at every point of a sweep,
and at every candidate age the ladder solver probes. `model.js:streamArrays` resolves
both against the same `phaseOf().A` the simulation loops use, so a note in the UI can't
drift from what the engine did.

**The scenario codec is layered and back-compatible.** `config/codec.js` writes a v3
body carrying only fields that differ from a frozen `BASE`, then wraps it in a v4
XOR-scrambled base64url envelope. `BASE` is a deliberate snapshot, **kept separate from
`BUILTIN` and never updated** — a code someone copied months ago must keep meaning what
it meant then. The ladder rides in one `ld` field as its own sub-body, base64'd into an
alphabet (`[A-Za-z0-9.-]`) that survives the outer grammar's escaper untouched. Extend
the format by appending, never by repurposing an existing field, and check
`test/codec.test.js` — compatibility is what it defends.

**Two recompute paths.** `ui/orchestrate.js` splits cheap from expensive:
`recomputeLight` (headline + fan) runs every animation frame during a slider drag;
`recomputeHeavy` (sequence, sweep, tornado, heatmap, ladder) runs once the inputs
settle, and is also where the screen-reader summary is flushed so the live region isn't
flooded mid-drag.

**Private mode is cross-cutting.** `format.js` renders balances as multiples and annual
flows as percentages of a reference amount; `ui/privacy.js` masks the money *inputs* by
parking the true value in `dataset.privReal`. **Every read of a money input must go
through `inputVal()`**, and every write through `setMoneyInput()`.

**Charts are one module each** in `src/charts/`, drawing into a fixed 760-unit viewBox.
`svg.js:textScale()` reports how much larger chart text is at the current width, and
anything reserving room for text multiplies by it — **its breakpoints must stay in step
with the `@media` rules in `styles/app.css`**, which is easy to forget when adding a new
chart's text classes. Every chart also pairs with a data table and a `describeChart()`
label, because an `<svg role="img">` exposes nothing else to a screen reader.

**The ladder** (`engine/ladder.js`) bisects `simSuccess` against a target probability:
spend-anchored tiers solve for the earliest age, age-anchored tiers for the highest
spend. It returns a tagged result — `solved`, `all`, or `none` — so a tier that clears
everywhere, or nowhere, is reported as such rather than as a boundary dressed up as an
answer. `charts/ladder.js` takes tiers and scenarios as arguments rather than importing
`ui/ladder.js`, which would create a cycle with the palette it exports.

## Conventions

**Comments explain why, at length.** This codebase's comments carry reasoning, rejected
alternatives, and the failure a line prevents — not restatements of the code. Match the
surrounding density; sparser comments read as a regression here.

**Versioning.** `src/version.js` is bumped on every push that changes the app: third
number for a same-day follow-up, second for the first minor push of a day, first for new
features. Docs-only and CI-only changes don't bump. The `pre-push` hook blocks a push
whose tests fail or that leaves the file untouched; `--no-verify` is for a genuine
non-shipping push.

American English throughout.

## Ground rules

- **`main` is production.** It deploys to retirement.khalilsg.dev via GitHub Pages.
  The repo ships by pushing straight to main — no PR has ever been opened. Ask before
  pushing.
- **The repo is public, and the owner's plan contains real finances.** Analysis written
  into issues, commits, or comments must use the ratio form private mode already renders
  — multiples of balance, percentages of it — never absolute amounts.
- **The Node suite doesn't cover the UI.** The control layer and the charts need a real
  DOM, so run the browser check by hand before anything touching either. When you add an
  assertion to it, confirm it *fails* with its fix reverted — an assertion that passes
  either way is worse than none.
