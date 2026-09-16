# Game Brain factor experiments

Generated 2026-08-24 by `npm run backtest -- all --experiment`. Selection: greedy forward on validation log-loss (candidates tuned walk-forward on train only, measured frozen on validation; final holdout untouched).

## MLB — kept: injuryGap, formWinRate, restDay, weatherHome

| config | val games | brain acc % | base acc % | brain logloss | base logloss | Δ vs best |
|---|---|---|---|---|---|---|
| base (form/rest/weather/injury) | 2434 | 56.53 | 56.7 | 0.67898 | 0.67891 |  |
| + starterFip | 2434 | 55.79 | 56.7 | 0.67962 | 0.67891 | -0.00064 |
| + platoon | 2434 | 56.41 | 56.7 | 0.68051 | 0.67891 | -0.00154 |
| + scoringForm | 2434 | 56.49 | 56.7 | 0.67906 | 0.67891 | -0.00008 |
| + homeSplit | 2434 | 56.53 | 56.7 | 0.67897 | 0.67891 | 0.00001 |
| + pythag | 2434 | 56.53 | 56.7 | 0.67941 | 0.67891 | -0.00044 |
| + density | 2434 | 56.45 | 56.7 | 0.67896 | 0.67891 | 0.00001 |
| + rosterChurn | 2434 | 56.24 | 56.7 | 0.67906 | 0.67891 | -0.00008 |

## NFL — kept: formWinRate, restDay, weatherHome, pythag, divisionDamp, qbValue, unitMatchup, yardsMargin

| config | val games | brain acc % | base acc % | brain logloss | base logloss | Δ vs best |
|---|---|---|---|---|---|---|
| base (form/rest/weather) | 272 | 67.28 | 66.54 | 0.61642 | 0.61627 |  |
| + qbValue | 272 | 66.18 | 66.54 | 0.6119 | 0.61627 | 0.00452 |
| + unitMatchup | 272 | 66.18 | 66.54 | 0.61739 | 0.61627 | -0.00096 |
| + yardsMargin | 272 | 66.18 | 66.54 | 0.61739 | 0.61627 | -0.00096 |
| + toMargin | 272 | 67.28 | 66.54 | 0.61551 | 0.61627 | 0.00091 |
| + lateSeasonDamp | 272 | 66.91 | 66.54 | 0.61521 | 0.61627 | 0.00121 |
| + travel | 272 | 65.07 | 66.54 | 0.62016 | 0.61627 | -0.00374 |
| + shortWeek | 272 | 66.91 | 66.54 | 0.61627 | 0.61627 | 0.00016 |
| + scoringForm | 272 | 67.28 | 66.54 | 0.62087 | 0.61627 | -0.00444 |
| + homeSplit | 272 | 67.28 | 66.54 | 0.61564 | 0.61627 | 0.00078 |
| + pythag | 272 | 68.38 | 66.54 | 0.60878 | 0.61627 | 0.00764 |
| + divisionDamp | 272 | 66.91 | 66.54 | 0.61307 | 0.61627 | 0.00336 |
| + bye | 272 | 66.18 | 66.54 | 0.61835 | 0.61627 | -0.00193 |
| KEPT pythag | 272 | 68.38 | 66.54 | 0.60878 | 0.61627 |  |
| + qbValue | 272 | 67.28 | 66.54 | 0.60883 | 0.61627 | -0.00004 |
| + unitMatchup | 272 | 66.91 | 66.54 | 0.61302 | 0.61627 | -0.00423 |
| + yardsMargin | 272 | 66.91 | 66.54 | 0.61302 | 0.61627 | -0.00423 |
| + toMargin | 272 | 67.65 | 66.54 | 0.60919 | 0.61627 | -0.00041 |
| + lateSeasonDamp | 272 | 68.01 | 66.54 | 0.60843 | 0.61627 | 0.00035 |
| + travel | 272 | 65.07 | 66.54 | 0.61765 | 0.61627 | -0.00886 |
| + shortWeek | 272 | 68.38 | 66.54 | 0.60878 | 0.61627 | 0 |
| + scoringForm | 272 | 67.65 | 66.54 | 0.61336 | 0.61627 | -0.00458 |
| + homeSplit | 272 | 68.38 | 66.54 | 0.60887 | 0.61627 | -0.00008 |
| + divisionDamp | 272 | 67.28 | 66.54 | 0.60721 | 0.61627 | 0.00157 |
| + bye | 272 | 67.28 | 66.54 | 0.61248 | 0.61627 | -0.00369 |
| KEPT divisionDamp | 272 | 67.28 | 66.54 | 0.60721 | 0.61627 |  |
| + qbValue | 272 | 67.28 | 66.54 | 0.60525 | 0.61627 | 0.00196 |
| + unitMatchup | 272 | 67.28 | 66.54 | 0.60847 | 0.61627 | -0.00126 |
| + yardsMargin | 272 | 67.28 | 66.54 | 0.60847 | 0.61627 | -0.00126 |
| + toMargin | 272 | 67.65 | 66.54 | 0.60734 | 0.61627 | -0.00013 |
| + lateSeasonDamp | 272 | 67.28 | 66.54 | 0.60661 | 0.61627 | 0.0006 |
| + travel | 272 | 65.81 | 66.54 | 0.61159 | 0.61627 | -0.00438 |
| + shortWeek | 272 | 67.65 | 66.54 | 0.60802 | 0.61627 | -0.00081 |
| + scoringForm | 272 | 66.91 | 66.54 | 0.61152 | 0.61627 | -0.00431 |
| + homeSplit | 272 | 67.28 | 66.54 | 0.60662 | 0.61627 | 0.00059 |
| + bye | 272 | 67.28 | 66.54 | 0.60885 | 0.61627 | -0.00164 |
| KEPT qbValue | 272 | 67.28 | 66.54 | 0.60525 | 0.61627 |  |
| + unitMatchup | 272 | 68.75 | 66.54 | 0.60379 | 0.61627 | 0.00147 |
| + yardsMargin | 272 | 68.75 | 66.54 | 0.60379 | 0.61627 | 0.00147 |
| + toMargin | 272 | 66.54 | 66.54 | 0.60506 | 0.61627 | 0.00019 |
| + lateSeasonDamp | 272 | 67.28 | 66.54 | 0.60475 | 0.61627 | 0.0005 |
| + travel | 272 | 67.28 | 66.54 | 0.60624 | 0.61627 | -0.00098 |
| + shortWeek | 272 | 67.28 | 66.54 | 0.60545 | 0.61627 | -0.00019 |
| + scoringForm | 272 | 66.91 | 66.54 | 0.60819 | 0.61627 | -0.00294 |
| + homeSplit | 272 | 67.28 | 66.54 | 0.60525 | 0.61627 | 0 |
| + bye | 272 | 67.28 | 66.54 | 0.6067 | 0.61627 | -0.00144 |
| KEPT unitMatchup | 272 | 68.75 | 66.54 | 0.60379 | 0.61627 |  |
| + yardsMargin | 272 | 68.38 | 66.54 | 0.60193 | 0.61627 | 0.00186 |
| + toMargin | 272 | 68.75 | 66.54 | 0.60388 | 0.61627 | -0.0001 |
| + lateSeasonDamp | 272 | 68.75 | 66.54 | 0.60264 | 0.61627 | 0.00114 |
| + travel | 272 | 67.65 | 66.54 | 0.6077 | 0.61627 | -0.00391 |
| + shortWeek | 272 | 68.01 | 66.54 | 0.60424 | 0.61627 | -0.00045 |
| + scoringForm | 272 | 66.91 | 66.54 | 0.60851 | 0.61627 | -0.00472 |
| + homeSplit | 272 | 68.75 | 66.54 | 0.60388 | 0.61627 | -0.0001 |
| + bye | 272 | 68.38 | 66.54 | 0.60506 | 0.61627 | -0.00127 |
| KEPT yardsMargin | 272 | 68.38 | 66.54 | 0.60193 | 0.61627 |  |
| + toMargin | 272 | 68.38 | 66.54 | 0.60387 | 0.61627 | -0.00194 |
| + lateSeasonDamp | 272 | 68.75 | 66.54 | 0.60248 | 0.61627 | -0.00055 |
| + travel | 272 | 67.65 | 66.54 | 0.60902 | 0.61627 | -0.00709 |
| + shortWeek | 272 | 68.01 | 66.54 | 0.60383 | 0.61627 | -0.0019 |
| + scoringForm | 272 | 67.65 | 66.54 | 0.60842 | 0.61627 | -0.00649 |
| + homeSplit | 272 | 68.75 | 66.54 | 0.60424 | 0.61627 | -0.00231 |
| + bye | 272 | 68.01 | 66.54 | 0.6055 | 0.61627 | -0.00357 |

## 2026-09-08 — Serving-layer lab (NFL): production v2 vs brain stack vs closing market

Generated by `npm run backtest -- nfl --ensemble` (full tables in `docs/backtests/ensemble.md`, a generated file). 1,084 games, 2022–2025, every column out-of-sample: per-season v2 checkpoints trained only on earlier seasons, brain frozen at shipped weights on the MOV-Elo baseline, nflverse closing moneyline with the vig removed, blend weights fit leave-one-season-out on log-loss.

| candidate | all seasons (acc · log-loss) | 2025 holdout |
|---|---|---|
| v2 production | 62.5% · 0.6460 | 64.6% · 0.6338 |
| brain (full) | 64.9% · 0.6364 | 63.8% · 0.6398 |
| v2⊕brain (LOSO weight) | 64.5% · 0.6376 | 63.8% · 0.6398 |
| v2⊕brain-lite (LOSO weight) | 64.2% · 0.6390 | 64.6% · 0.6399 |
| closing market | 67.5% · 0.6082 | 65.3% · 0.6094 |
| 25/75 model⊕market (fixed, no fitting) | 68.2% · 0.6116 | — |

Paired bootstrap (3,000 resamples): closing market vs v2 production −0.0379 log-loss [−0.0492, −0.0271], +5.1pp [3.8, 7.3], P(market better) = 100%; on the 2025 holdout −0.0244 [−0.0500, −0.0053], P = 99%. Fitted model share in the model⊕market blend on all four seasons: **0.00**. The fixed 25/75 anchor vs pure market: +0.0034 log-loss [0.0011, 0.0067] (worse, significant but tiny), +0.6pp accuracy [−0.2, 1.4] (not significant). Model-vs-market disagreements: 179 games, market right 106, ensemble right 73.

**Decision (shipped):** the served game probability is a logit blend of the production model (25%) and the pregame DraftKings no-vig moneyline (75%) whenever a pregame line exists; the model stands alone otherwise. Constant: `MARKET_ANCHOR_MODEL_WEIGHT` in `frontend/lib/marketMath.ts`, policy in `frontend/lib/servingPolicy.ts`. The small model share is kept for hit rate and for lines captured days before kickoff (the lab used closing lines; live lines are earlier and softer). Lines come from ESPN's scoreboard (no key) with The Odds API consensus preferred when configured.

**Rejected:** v2⊕brain in the served path — +2.0pp over all seasons but −0.7pp on the 2025 holdout (P = 37%), and the anchor leaves the model only 25% of the logit anyway; the brain stays in shadow (`/api/game-brain`). Brain-lite (record-only factors) — P = 36% on the holdout.

**MLB caveat:** no free historical odds archive exists, so the MLB anchor ships on the NFL evidence plus the well-documented efficiency of MLB closing lines, and is measured forward: `scripts/capture-live.mjs` now archives the ESPN DraftKings moneyline with every capture and the ledger grades `market` and `anchored` picks beside the brain. Revisit once the ledger holds a season.
