# Retirement Monte Carlo — Longevity of a Portfolio

An interactive retirement simulator. It bootstraps **real annual market history (1928–2025)** — S&P 500, 10-year Treasuries, and CPI inflation together — to estimate the probability that a portfolio lasts, in today's dollars.

**Live:** https://khalilsg.github.io/retirement-monte-carlo/

## Features
- **Full lifecycle** — accumulation (saving) and drawdown (retirement), on an age basis
- **Historical bootstrap** with independent-year or block sampling (preserves clustered downturns)
- **Spending strategies** — fixed real, or Guyton-Klinger-style guardrails
- **Allocation** — fixed mix or a lifecycle glide path
- **Income streams** — pensions / Social Security, age-based, COLA or nominal
- **Taxes** — effective-rate gross-up on withdrawals
- **Analysis** — sensitivity sweep, two-parameter success-surface heatmap, a tornado chart ranking your biggest levers, and sequence-of-returns risk attribution
- **Scenarios** — presets, save-as-default, and shareable codes/links
- **Monte Carlo confidence interval** on the headline result

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
    model.js          timeline phases, allocation glide, income-stream flattening
    simulate.js       simSuccess / simFull / simSequence
  config/
    parameters.js     the parameter registry — single source of truth for every
                      tunable (DOM binding, live label, scenario codec, sweep meta)
    presets.js        built-in defaults + named presets
  charts/             one module per visualization (fan, sweep, tornado, heat,
                      sequence) + shared svg.js helpers
  ui/                 DOM glue: controls, outcome card, scenarios, orchestration
```

### Adding a tunable assumption
Add one entry to the `PARAMS` list in [`src/config/parameters.js`](src/config/parameters.js) and its control to `index.html`. `readParams`, the live labels, the scenario save/share codec, and the sensitivity sweep / tornado / heatmap all derive from that registry automatically.

*Educational model, not personalized financial advice. Data: NYU Stern (Damodaran) for stock/bond returns; BLS CPI for inflation.*
