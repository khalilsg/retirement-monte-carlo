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
- **Arrival range** (opt-in) — each rung is a forecast of a *future* forecast, so it can also carry the range its own answer
  lands in once the market has had its say: a band behind the dumbbell spanning where the rung resolves across
  the balances you might actually reach its date with, and a *low draw* column saying what a bad run would
  cost in years or in dollars a year — the mid-course correction behind the failure probability, rather than
  the probability itself
- **Analysis prompt** — a button that serializes the whole plan, the ladder and the sensitivity ranking
  into a ready-to-paste prompt asking Claude for the written reading the charts can't give: what the
  headline is worth as a thing to steer by, what the failure fraction costs, which assumption is
  carrying the plan. The app computes and the model interprets — a chat model can't run this engine,
  so every figure is shipped precomputed and the prompt forbids inventing the rest. Offered in a
  normalized variant that states everything as ratios, for a reading you can get without pasting real
  amounts into a third party
- **Glide corridor** (opt-in) — the same rung viewed over time, and the one view here that isn't a probability:
  the **balance you'd need at each age** between now and that rung's date to keep it alive, drawn over the balance
  you're actually projected to reach. A probability is guaranteed to move, so watching it year to year tells you
  little; a balance is something you can look up once a year and act on. The line assumes the plan keeps running —
  contributions continue to the date — so it reads *am I on track?* rather than *could I coast from here?*
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
    arrival.js        re-solves each rung at its own date, across the arrival distribution
    corridor.js       bisects on the starting balance for a rung's required track over time
  config/
    parameters.js     the parameter registry — single source of truth for every
                      tunable (DOM binding, live label, scenario codec, sweep meta)
    presets.js        built-in defaults + named presets
    codec.js          scenario <-> compact URL-safe share code
    prompt.js         the analysis prompt — pure serializer over everything computed
  charts/             one module per visualization (fan, sweep, tornado, heat,
                      sequence, ladder, corridor) + shared svg.js helpers
  ui/                 DOM glue: controls, outcome card, scenarios, orchestration
                      privacy.js — private-mode toggle, input masking, leak guards
                      ladder.js — the step-up ladder's tiers, scenarios, and editors
                      prompt.js — gathers the analysis bundle and owns its buttons
                      toast.js — the status line and the clipboard write behind it
  version.js          the version string shown in the footer
test/                 node --test suite over the engine, config, and codec
tools/                dev scripts (browser-check.mjs — end-to-end via Playwright)
```

### Testing
The engine, the parameter registry, and the scenario codec are pure and DOM-free, so they import straight into Node. No test framework, no build, no dependencies:

```bash
node --test test/*.test.js                        # 96 tests, about a second
node --test --test-reporter=spec test/*.test.js   # readable output when something fails
```

`test/` covers timeline phases and income-stream flattening on both age bases, scenario round-trips and backward compatibility with older share codes, the behavior of the three simulators, and the ladder solver — that a reported crossing really is one (a step to the worse side misses the target, the figure itself clears it) and that the two no-crossing cases come back labelled rather than as a boundary dressed up as an answer. It also covers the analysis prompt's serializer — that the normalized variant contains no dollar amount anywhere (including the units baked into a stream's own sensitivity label, which is where a real leak was found), that the plan block is derived from the registry rather than hand-listed, and that the ladder's three outcomes stay distinguishable once they're prose. For the arrival range it pins the property the whole cheap method rests on — that success is monotone in the balance you start from, checked under guardrails, a glide path and both income-stream bases at once — along with the rule that a rung with no crossing gets no fan rather than a fabricated one. The corridor's tests pin what its line *means*: solved with contributions still running, so stopping them raises the bar at every age, which is the difference between "am I on track?" and "could I coast?". Bare `node --test` sweeps every file under `test/`, so keep anything that isn't a test out of that directory — that's what `tools/` is for.

The control layer and the charts need a real DOM, so those are checked end-to-end against the actual page:

```bash
npm i -D playwright && npx playwright install chromium   # once
node tools/browser-check.mjs
```

It serves the repo on an ephemeral port, drives the page, and fails on a bad assertion or any console error. Playwright is a dev convenience rather than a dependency of the app — with it absent the script exits 0 with a note. Run it by hand before anything that touches the UI or the charts.

### Versioning
[`src/version.js`](src/version.js) holds the version shown in the footer, and is bumped on every push that changes the app:

- **Third number** — a follow-up push later the same day (1.2.0 → 1.2.1)
- **Second number** — the day's first push: fixes, polish, and features that extend a view
  that already exists (1.2 → 1.3)
- **First number** — a new capability large enough to change what the tool is: a new card,
  a new way of expressing an input, or anything that would make an existing share code
  decode to a different plan (1.x → 2.0)

The line between the last two is what the tool can answer, not how much code moved.
v2.0 was income streams gaining a second age basis and v3.0 was the step-up ladder —
both new questions you could ask it. The ladder's chart-axis toggle and its layered
income mode took v3.1.0 between them, because they gave an existing card more to say
rather than adding a card.

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

**The arrival range.** A rung says "earliest age 44" as of today, and that is a forecast of a forecast: the balance
you actually reach 44 with spans a wide range, and the rung's answer moves with it. Switch **Arrival range** to *Show* and each
rung gains a band spanning where its answer lands across that distribution, plus a **low draw** column in the table
saying what reaching the date with a 10th-percentile balance would cost — three years later, or twenty-odd thousand a
year less. That figure is the honest content of a failure probability: not ruin, but a mid-course correction you can
see coming and act on.

The whole thing is cheap because success is monotone in the balance you start from, so a quantile of the arrival
balance is a quantile of the answer and one solve per quantile replaces a Monte Carlo nested inside a Monte Carlo.
Two things follow from how it is asked. The band is **one-sided on an age panel** — you cannot stop earlier than the
date you asked about, so a good draw pins to the dot and only a bad one moves. And a rung with no crossing gets **no
band at all**: "already, at 55" has nothing to arrive at and "not by 94" never arrives.

One caveat, measured rather than assumed. Standing at the date and re-simulating treats the years after it as
independent of the years before, which is exactly true under independent-year sampling and slightly optimistic in the
left tail under blocks — arriving low correlates with sitting inside a bad run that has further to go. Measured against
the true conditional rate over 80,000 paths, the effect attributable to blocks is about 1.5 points at the 5th
percentile, in the direction of making a bad draw look marginally better than it is. Small enough to note; the
reasoning and the numbers are in `src/engine/arrival.js`.

Solving the range roughly doubles the cost of drawing the ladder, and it is a good deal of extra ink on a chart whose
point is the gap between scenarios — so **Arrival range** is set to *Hide* until you ask for it. Hiding it again is a
repaint of figures already in hand; showing it needs a solve that was never run.

The analysis prompt carries these figures either way. That setting is about chart ink and about a solve that re-runs on
every settle; the prompt is a text artifact built once, on a click, where nothing competes for space — so turning the
band off to unclutter the chart should not quietly delete a section of the written reading.

Tiers and scenarios travel in the share code, but only once you've edited them — an untouched ladder re-derives its
rungs from the plan's own spending, so it reconstructs itself at the far end and costs nothing. Editing it roughly
doubles a typical code (132 characters to about 335 for the bridge preset), which is the price of a comparison you
can actually send someone.

### Glide corridor
Every other view answers "how likely is this?". The corridor answers **"am I above the line?"**, which is the same
question in a form you can check without re-running anything. Pick a tier in the **Glide corridor** card and it
solves, for each age between now and that rung's date, the balance that would hold the tier at your target rate — then
draws your projected percentile bands behind it.

It has its own card, directly under the Step-up ladder. It is derived from a ladder rung and reads only in that
context, so it sits adjacent — but it asks a different question (*am I on track?* rather than *when could I stop?*)
and answers it on different axes, balance against age, the same shape as **Balance over time** rather than a dumbbell.
The tiers and the target success rate come from the ladder above; the corridor has to solve to the same target, or the
two cards would be answering to different bars without saying so.

**What the line assumes decides what it means.** It is solved with the plan still running: contributions continue from
each age through to the date. So it reads *am I on track?*, not *could I coast from here?*. On a plan that saves
heavily those differ by most of the answer, which is why the line can sit well below your balance early on and
converge toward the date — the gap is what your future contributions are worth.

The reading watches the **10th percentile**, not the median. A rung is defined as the point where the plan hits its
target, so by the tower property the median clears its own corridor essentially by construction — it reports "above"
for any rung the ladder managed to solve, which is no news. The lower band is where the content is: the age at which a
bad run stops being something you ride out and starts being something you act on.

Two things carry over from the ladder. A rung with **no crossing gets no corridor** — there is no date to march
toward. And the vertical axis is **fitted rather than anchored at zero**, because the whole reading is the distance
between two lines that sit close together and a zero-based axis flattens it to nothing; the axis label says where it
starts, and the data table carries the unscaled figures.

It is a bisection per age on top of everything else in the card, so it is off until you pick a tier, and it draws one
tier against one scenario at a time.

### Analysis prompt
Under the ladder chart, two buttons build a ready-to-paste prompt asking Claude for a written reading of the loaded
plan — where it sits against your target, what the ladder actually says, what the failure fraction would cost you,
which assumption is carrying it.

The division of labor is the design. A chat model cannot run this engine: it cannot bisect `simSuccess`, and asked
for a figure it has no way to reach it will produce one anyway. So the prompt carries every number precomputed —
the plan (derived from the parameter registry, so a tunable added later cannot silently drop out of it), the solved
ladder with its no-crossing cases spelled out in words, the tornado's ranking, both the Monte Carlo confidence
interval and the expected drift of the headline before the outcome resolves — and asks only for the interpretation.
A ground rule at the top forbids estimating anything that isn't in the block, which is what covers the sections that
don't exist yet as much as the ones that do.

**On privacy, since this pastes into a third party.** *With amounts* sends your real balance, spending and income,
where it may be stored or logged. *Ratios only* renders everything the way private mode renders the page — balances
as a multiple of your balance today, annual flows as a percentage of it — and drops the share code, which would
decode straight back to the figures it just withheld. The whole analysis works in those terms; nothing in it needs
dollars. It is not anonymous, though: the ratio form still carries your ages, your retirement date and the shape of
your income. Private mode disables the amounts variant outright, the same way it disables `Copy code`.

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
