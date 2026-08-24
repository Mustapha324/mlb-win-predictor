# Improvement roadmap — every remaining way to raise the score (2026-08-24)

Produced by a 7-agent research workflow (six domains + a completeness critic), with data
availability **verified by live fetches**, not assumed. Current level: NFL 64.9% / 0.636
log-loss over four seasons (market ≈ 66–67%); MLB 56.1% on the current season (market ≈ 57–58%).

## The three headline discoveries

1. **Free historical NFL closing odds exist.** nflverse's `games.csv` (verified row-by-row)
   carries closing **moneylines**, spreads, and totals for every game 2021–2025 — data we
   believed was paywalled. This unlocks exact market benchmarking, a market-blend model, and
   closing-line-value (CLV) grading, all fully backtestable.
2. **Pre-aggregated EPA/CPOE per team-week is a 230KB-per-season download.** nflverse
   `stats_team_week_{year}.csv` (verified columns: passing_epa, passing_cpoe, rushing_epa…) —
   the best-documented public NFL team-strength signal, and genuinely *orthogonal* to our
   MOV-Elo + Pythagorean stack because EPA strips garbage time, field position, and turnover
   luck that point margins keep.
3. **Historical NFL injury reports and weekly depth charts exist** (nflverse
   `injuries_{year}.csv`, `depth_charts_{year}.csv`, 2021–2025) — our live-only injury/qbOut
   logic becomes backtestable for the first time.

## Top 10, ranked by (expected gain × confidence) ÷ effort

| # | Item | Gain (honest) | Effort | Backtestable |
|---|---|---|---|---|
| 1 | **NFL market anchor + blend** (games.csv closing lines; nfelo-style reversion keeping non-market signal) | +1.0–1.5pp | small | fully |
| 2 | **Selective prediction + confidence tiers** (surface only picks above a fitted floor; ~70% accuracy at ~half coverage) | product-level jump | small | fully |
| 3 | **MLB market anchor + blend** (SBR archive) | +0.5–1.0pp | medium | fully |
| 4 | **$0 gate test: 538's archived MLB pitcher-adjusted vs team-only Elo columns** — read the answer off their data before building any pitcher pipeline | decision value | tiny | yes |
| 5 | **Formalize the two-engine ensemble** (walk-forward-fitted blend weight; the 50/50 version already posted our best NFL holdout: 65.7% / 0.6330) | +0.3–0.8pp | small | fully |
| 6 | **Rolling opponent-adjusted EPA + CPOE** (stats_team weekly) | +0.3–0.8pp | small | fully — flag: passing-efficiency family adjacency (ANY/A was rejected); one lab run, drop fast if flat |
| 7 | **Backtest the injury/qbOut weights on historical injuries + depth charts** (validate the 0.35 prior with data for the first time) | calibration value | medium | fully |
| 8 | **MLB confirmed-lineup quality scoring** (hydrate verified live + historically; the gated first step toward lineup-vs-starter simulation, +1–2pp potential) | +0.5–2pp (gated) | large | mostly |
| 9 | **QB draft-position rookie/backup priors** (538-style; concentrated value on debut/backup starts) | small, targeted | small | fully |
| 10 | **CLV grading + market-disagreement surfacing** (the professional loop: grade picks vs the close; make model-vs-market divergence the Pro feature) | evaluation revolution | small | NFL retro; live both |

## Critic's additions nobody else caught

- **Start archiving NFL odds snapshots immediately** — free Odds API tier covers 2
  snapshots × 16 games/week; this history cannot be bought later. Needs `THE_ODDS_API_KEY`
  as a repo Action secret (Mustapha's call).
- **A significance harness** (paired bootstrap on per-game log-loss) as a standard lab gate —
  with 25 rejections, both false-ships and false-rejects are live risks.
- **NFL wind** (existing weather pipe, never tested as a side effect on underdogs), **MLB OAA
  team defense** (free Savant leaderboard), **MLB September motivation asymmetry** (the MLB
  analogue of our biggest autopsy fix), **free model consensus** (ESPN FPI etc.) — all cheap.

## Verified-and-deprioritized (so we never re-litigate)

- **Architecture swaps don't pay**: best published Kalman filter beat plain Elo by 0.001
  log-loss (Szczecinski & Tihon 2022). XGBoost/Glicko/Bayesian MCMC: no documented
  out-of-sample edge at n≈270/season. Our Elo+factors stack is the right shape.
- **MLB micro-factors are totals-only or decaying**: umpire zones (symmetric; ABS is erasing
  them), catcher framing (halved since 2008, −20% more in 2026), park factors for moneyline
  (Coors-only HFA prior worth one cheap test). Bullpen fatigue: verified buildable from
  per-pitcher pitch counts; expect ≈0 but one cheap test is fair.
- **FanGraphs is Cloudflare-blocked for automation; Retrosheet adds nothing over StatsAPI**
  for our window; FTN charting overlaps the rejected sack-rate family.

## Recommended sequence

**Week 1:** #1 + #2 + #10-NFL (one workstream: join games.csv to stored predictions → market
benchmark, blend, CLV, tiers) and #4 (an afternoon). Start the odds snapshot archive.
**Week 2:** #5, #6, #9 through the lab under the hardened protocol; #7 in parallel.
**Then:** MLB market anchor (#3); the lineup simulation (#8) only if #4's verdict is positive.

The strategic shift item #1 forces: once the market benchmark exists, every future factor must
add value **on top of the market-blended baseline** — a far harder and more honest bar than
beating our own model.
