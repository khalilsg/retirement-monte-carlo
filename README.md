# Retirement Monte Carlo — Longevity of a Portfolio

An interactive, single-file retirement simulator. It bootstraps **real annual market history (1928–2025)** — S&P 500, 10-year Treasuries, and CPI inflation together — to estimate the probability that a portfolio lasts, in today's dollars.

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
No build step, no dependencies, no backend — one self-contained `index.html` with inline CSS/JS and embedded data. Just open it.

*Educational model, not personalized financial advice. Data: NYU Stern (Damodaran) for stock/bond returns; BLS CPI for inflation.*
