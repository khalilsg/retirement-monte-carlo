# Retirement Monte Carlo — Longevity of a Portfolio

An interactive retirement simulator. It bootstraps **real annual market history (1928–2025)** — S&P 500, 10-year Treasuries, and CPI inflation together — to estimate the probability that a portfolio lasts, in today's dollars.

**Live:** https://khalilsg.github.io/retirement-monte-carlo/

## Features
- **Full lifecycle** — accumulation (saving) and drawdown (retirement), on an age basis
- **Historical bootstrap** with independent-year or block sampling (preserves clustered downturns)
- **Spending strategies** — fixed real, or Guyton-Klinger-style guardrails
- **Allocation** — fixed mix or a lifecycle glide path
- **Income streams** — pensions / Social Security, COLA or nominal, dated either at fixed ages or *relative to retirement*, so a bridge job pinned to "the year I stop working" slides with the retirement-age slider (and with every point of a sweep or heatmap over it)
- **Taxes** — effective-rate gross-up on withdrawals
- **Analysis** — sensitivity sweep, two-parameter success-surface heatmap, a tornado chart ranking your biggest levers, and sequence-of-returns risk attribution
- **Step-up ladder** — retirement as a series of lifestyle tiers rather than one yes/no number: per tier, the earliest age you could stop at a given spend, or the most you could spend at a given age, solved by bisecting the simulation against a fixed target success rate — and compared side by side across named income scenarios
- **Scenarios** — presets, save-as-default, shareable links (`?s=…`) that open straight into someone else's numbers, and a `?demo` view that opens the built-in example instead of your saved default
- **Monte Carlo confidence interval** on the headline result
- **Private mode** — hides every dollar amount for screen sharing: balances render as a multiple (×) of your balance today, annual amounts as a percentage of it, so charts and ratios stay fully readable

## Tech
No build step, no dependencies, no backend — plain HTML, CSS, and native ES modules. Because it uses ES modules, serve it over HTTP (e.g. `python3 -m http.server`) rather than opening `index.html` via `file://`.

## Project layout
```
index.html            markup only; links styles/app.css and src/main.js
styles/app.css        all styles
src/
  main.js             entry point — boots the app
  data/history.js     1928–2025 return/inflation series + real-return precompute
  engine/             pure, DOM-free simulation core
    rng.js            seeded RNG + common-random-numbers sampling matrix
    model.js          timeline phases, allocation glide, income-stream flattening (both age bases)
    simulate.js       simSuccess / simFull / simSequence
    ladder.js         bisects simSuccess for the step-up ladder's age / spend answers
  config/
    parameters.js     the parameter registry — single source of truth for every
                      tunable (DOM binding, live label, scenario codec, sweep meta)
    presets.js        built-in defaults + named presets
    codec.js          scenario <-> compact URL-safe share code
  charts/             one module per visualization (fan, sweep, tornado, heat,
                      sequence, ladder) + shared svg.js helpers
  ui/                 DOM glue: controls, outcome card, scenarios, orchestration
                      privacy.js — private-mode toggle, input masking, leak guards
                      ladder.js — the step-up ladder's tiers, scenarios, and editors
  version.js          the version string shown in the footer
test/                 node --test suite over the engine, config, and codec
tools/                dev scripts (browser-check.mjs — end-to-end via Playwright)
```

### Testing
The engine, the parameter registry, and the scenario codec are pure and DOM-free, so they import straight into Node. No test framework, no build, no dependencies:

```bash
node --test test/*.test.js                        # ~40 assertions, about a second
node --test --test-reporter=spec test/*.test.js   # readable output when something fails
```

`test/` covers timeline phases and income-stream flattening on both age bases, scenario round-trips and backward compatibility with older share codes, the behavior of the three simulators, and the ladder solver — that a reported crossing really is one (a step to the worse side misses the target, the figure itself clears it) and that the two no-crossing cases come back labelled rather than as a boundary dressed up as an answer. Bare `node --test` sweeps every file under `test/`, so keep anything that isn't a test out of that directory — that's what `tools/` is for.

The control layer and the charts need a real DOM, so those are checked end-to-end against the actual page:

```bash
npm i -D playwright && npx playwright install chromium   # once
node tools/browser-check.mjs
```

It serves the repo on an ephemeral port, drives the page, and fails on a bad assertion or any console error. Playwright is a dev convenience rather than a dependency of the app — with it absent the script exits 0 with a note. Run it by hand before anything that touches the UI or the charts.

### Versioning
[`src/version.js`](src/version.js) holds the version shown in the footer, and is bumped on every push that changes the app:

- Same-day follow-up pushes → increment the third number (1.0 → 1.0.1)
- First push of the day, minor change → increment the second number (1.0 → 1.1)
- New features / major changes → increment the first number (1.x → 2.0)

Docs-only and CI-only changes don't bump the version.

A `pre-push` hook in [`.githooks/`](.githooks/pre-push) blocks a push whose tests fail or that leaves `src/version.js` untouched. It runs the Node suite only — the browser check needs Playwright and a few seconds of real page, so it stays manual. Enable the hook once per clone:

```bash
git config core.hooksPath .githooks
```

Use `git push --no-verify` for a genuine non-shipping push.

### Sharing a scenario
`Copy link` produces `…/?s=<code>`, which loads those assumptions on open (`#s=<code>` works too, as does pasting either form into the load box).

A code carries only the fields that differ from the built-in defaults, then goes out scrambled and base64url-encoded, so the numbers aren't legible in the address bar, a chat window, or a screen share. The Coast preset comes to 132 characters against 358 for the base64'd JSON the old format used. **The scrambling is obfuscation, not encryption** — the keystream is right there in [`src/config/codec.js`](src/config/codec.js) — so a scenario link is shared, not secret. Codes in the older format still load.

### Step-up ladder
The other views all answer "how likely is *this* plan to work?" The ladder inverts it: you fix the success
probability you want and it solves for the plan.

Each **tier** is a rung — bare-bones, necessities, comfortable, whatever you call yours — anchored on whichever half
you actually have an opinion about:

- anchored on **spend** → *at this lifestyle, what's the earliest age I could stop and still clear the target?*
- anchored on **age** → *if I stop then, what's the most I could spend?*

Both are found by bisecting `simSuccess` directly, so a figure is exact to the year or to a few hundred dollars,
rather than to the width of a heatmap cell. A tier holds both numbers at once, so switching its anchor never discards
one you typed. Where there is no crossing to find, the ladder says which way it ran out — *already at 55*,
*not by 94*, *over $210k*, *not at any spend* — instead of printing a boundary as though it were a finding.

**Scenarios** are named variants on what you earn after stopping, drawn as a second dot per rung with the gap between
them: the length of that line is how much those assumptions are worth to that tier. A scenario is a replacement set
of income streams, which is all it needs to be — a stream dated *relative to retirement* slides with every age the
solver tries, so "four years off, then part-time for six" is one line on the chart instead of one chart per age.

One caveat, spelled out on the card as well: the age search assumes retiring later doesn't make things worse. That is
almost always true and occasionally isn't — a retirement-relative stream moves with the age being searched, and
guardrails reset off the balance on the day you stop — so where the curve doubles back, the search finds *a* crossing
rather than provably the earliest. Common random numbers keep it deterministic, so the same plan always gives the
same answer; the sensitivity sweep over retirement age is the place to check the shape if a rung looks wrong.

Tiers and scenarios travel in the share code, but only once you've edited them — an untouched ladder re-derives its
rungs from the plan's own spending, so it reconstructs itself at the far end and costs nothing. Editing it roughly
doubles a typical code (132 characters to about 335 for the bridge preset), which is the price of a comparison you
can actually send someone.

### Demo view
`Save as my default` means the bare URL opens with your own numbers, which is the wrong first screen when you're showing the tool to someone else. Adding `demo` to the address opens the built-in example instead:

```
https://khalilsg.github.io/retirement-monte-carlo/?demo
```

`#demo` and `?demo=1` work the same way; `?demo=0` is the same as leaving it off. Nothing is written or cleared — your saved default stays exactly where it is, and the plain URL keeps opening it. A visitor who has never saved a default sees the built-in example either way, so the link is safe to hand out.

Order of precedence on load: a shared `?s=` code first, then your saved default (unless `?demo` is set), then the built-in defaults. `?s=…&demo` therefore still opens the shared scenario — the flag only ever suppresses the saved default.

### Adding a tunable assumption
Add one entry to the `PARAMS` list in [`src/config/parameters.js`](src/config/parameters.js) and its control to `index.html`. `readParams`, the live labels, the scenario save/share codec, and the sensitivity sweep / tornado / heatmap all derive from that registry automatically.

*Educational model, not personalized financial advice. Data: NYU Stern (Damodaran) for stock/bond returns; BLS CPI for inflation.*
