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
  config/
    parameters.js     the parameter registry — single source of truth for every
                      tunable (DOM binding, live label, scenario codec, sweep meta)
    presets.js        built-in defaults + named presets
    codec.js          scenario <-> compact URL-safe share code
  charts/             one module per visualization (fan, sweep, tornado, heat,
                      sequence) + shared svg.js helpers
  ui/                 DOM glue: controls, outcome card, scenarios, orchestration
                      privacy.js — private-mode toggle, input masking, leak guards
  version.js          the version string shown in the footer
```

### Versioning
[`src/version.js`](src/version.js) holds the version shown in the footer, and is bumped on every push that changes the app:

- Same-day follow-up pushes → increment the third number (1.0 → 1.0.1)
- First push of the day, minor change → increment the second number (1.0 → 1.1)
- New features / major changes → increment the first number (1.x → 2.0)

Docs-only and CI-only changes don't bump the version.

A `pre-push` hook in [`.githooks/`](.githooks/pre-push) blocks a push that leaves `src/version.js` untouched. Enable it once per clone:

```bash
git config core.hooksPath .githooks
```

Use `git push --no-verify` for a genuine non-shipping push.

### Sharing a scenario
`Copy link` produces `…/?s=<code>`, which loads those assumptions on open (`#s=<code>` works too, as does pasting either form into the load box).

A code carries only the fields that differ from the built-in defaults, then goes out scrambled and base64url-encoded, so the numbers aren't legible in the address bar, a chat window, or a screen share. The Coast preset comes to 132 characters against 358 for the base64'd JSON the old format used. **The scrambling is obfuscation, not encryption** — the keystream is right there in [`src/config/codec.js`](src/config/codec.js) — so a scenario link is shared, not secret. Codes in the older format still load.

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
