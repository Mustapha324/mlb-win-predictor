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

## 2026-10-19 — NBA initial rating and market policy

Source: [Fixture Download 2024–25 results](https://fixturedownload.com/results/nba-2024) and [2025–26 results](https://fixturedownload.com/results/nba-2025), 1,231 completed rows per season. Games were replayed in timestamp order; ratings updated only after each final. The first 150 games of 2024–25 warmed up team ratings. K = {10, 20, 30}, home Elo edge = {40, 55, 65, 80}, and rating multiplier = {0.5, 0.65, 0.8, 1} were compared on the remaining 1,081 training games by log loss. The selected K = 30, home edge = 40, multiplier = 1 was frozen before evaluating 2025–26.

| Policy | 2024–25 selection (1,081) | 2025–26 holdout (1,231) |
| --- | --- | --- |
| Selected NBA Elo | 66.2% accuracy · 0.6132 log loss · 0.2128 Brier | 68.1% accuracy · 0.6099 log loss · 0.2104 Brier |
| Constant home rate (54.35% from 2024–25) | — | 55.5% accuracy · 0.6874 log loss · 0.2471 Brier |
| Initial K = 20, home edge = 65, multiplier = 0.65 | 63.5% accuracy · 0.6335 log loss · 0.2217 Brier | 66.3% accuracy · 0.6188 log loss · 0.2145 Brier |

**Decision:** use a current no-vig sportsbook moneyline as the served NBA probability when available; otherwise use the selected Elo rating. The market policy is conservative because this test did not include historical NBA odds, so it does not establish model versus market performance. The rating is a fallback, not a betting edge claim. The live ESPN adapter reads completed regular and postseason games before the selected day, excludes preseason games, and never serves a refreshed live/final price as the original pregame call. No NBA player props or social picks are offered until separate validation and persistence exist.

## 2026-10-20 — NBA margin-of-victory rating; shared market input validation

Reproduce: `npm run backtest -- nba`. Fixture Download NBA 2024 and 2025 JSON feeds; completed games sorted by start timestamp, ratings updated only after each result. Warm up on the first 150 games of 2024–25, select margin-of-victory K from {10,15,20,25,30} on the remaining 1,081 games by log loss, then freeze K=10 and home advantage=40 before the 1,231-game 2025–26 holdout. Both policies use the same 10–90% output bounds and full prior-season starting ratings. The deployed rating update is imported directly by the replay.

| Policy | Selection accuracy / log loss / Brier | Holdout accuracy / log loss / Brier |
| --- | --- | --- |
| Existing win/loss Elo, K=30 | 66.23497% / 0.61342561 / 0.21286639 | 68.07474% / 0.60932231 / 0.21028412 |
| Margin-of-victory Elo, K=10 | 66.97502% / 0.60811698 / 0.21038678 | 68.96832% / 0.60286564 / 0.20736280 |

Decision: ship the NBA rating fallback with margin scaling `log1p(margin) * 2.2 / max(1, 2.2 + .001 * winnerRatingGap)`. The gap includes home advantage and follows the winning side. Keep NBA's existing current no-vig market priority. This is a historical fallback-model improvement, not proof of superiority to sportsbook prices or future performance. The baseline numbers differ slightly from the earlier ledger because this reproducible runner applies the production probability bounds to every evaluated game.

Also reject duplicate/malformed NBA result rows, withhold nonfinite ratings, and use midnight rather than noon as the selected-day history cutoff. Shared MLB/NFL/NBA moneyline parsing now refuses embedded labels, suspended-price strings and numbers below American-odds magnitude 100; valid-price probabilities and learned MLB/NFL weights are unchanged. These are input-quality safeguards, not measured MLB/NFL accuracy improvements. NBA personal picks are explicitly device-local and excluded from social stats; historical views do not attach current roster previews to past games.

NBA player-board rollout: `/nba#player-picks` now reuses `PlayerPicksSection` through the public `sport=nba` API. ESPN DraftKings prop types 1/2/3/4 and 87/88/89/90 map to points, assists, rebounds, threes and combinations. Reject post-tipoff/future-dated quotes, injury flags, fewer than ten appearances, and less than 20 mean minutes. The initial experimental player baseline uses up to twenty prior appearances, an empirical hit rate with two pseudo-counts per side, and a 72% cap; this is explicitly not calibrated on historical prop prices, and no player-model accuracy gain is claimed. Real listed prices, a -160 headline floor, distinct-player headlines, and no synthetic props apply.

Player validation covers pregame-only logs, made threes rather than attempts, eligibility, frozen lines/projections despite refreshed book prices, exact box-score grades, explicit DNP voids, missing-stat retries, public NBA routing, and unchanged private snapshot grants. Apply `supabase/migrations/202610200001_nba_player_picks.sql` before permanent NBA snapshots can be stored. Without configured working persistence, the UI reports process-only board retention and device-only personal selections. The daily refresh grades pending NBA dates. Compact NBA history rows are cached instead of oversized monthly scoreboard payloads.

## 2026-10-21 — Results parity and data-quality release

NBA game results now distinguish frozen pregame snapshots from clearly labeled prior-games-only rating replays. Player Results refresh pending prior slates on read, and the scheduled job grades both NBA games and props. Current-month NBA finals refresh every two minutes; closed months remain cached daily. Two idempotent production-build migrations extend only the existing sport constraints to NBA, under a transaction/advisory lock; failed migrations stop the release. The production refresh authorization setting is corrected to `CRON_SECRET`.

No hand-tuned MLB/NFL factor or anchor weights were changed. MLB starter inputs now use a `byDateRange` ending the day before the requested prediction, removing cumulative-season future leakage from historical requests. NFL state/evaluation reject invalid, negative and tied scores. A chronological 70/30 temperature trial on captured shadow-model calls selected tau=0.8 on training data: MLB 146-game holdout log loss 0.67288270 -> 0.66980550, NFL 28-game holdout 0.68102530 -> 0.68513693. **Rejected for serving:** these captures are shadow Elo probabilities, not the served logistic model, and NFL degraded; do not transfer these fitted values to production models. Existing MLB frozen-brain replay: 2026 holdout 56.1% accuracy, log loss 0.68868 (base 56.2%, 0.68857); existing calibration reports 0.68651. NBA's separately validated margin rating from the previous entry remains the only learned rating change in this release.

The complete frozen NFL replay also finished: 2025 holdout accuracy 63.8% (base 64.6%), log loss 0.65537 (base 0.65823); existing tau=1.45 calibration reports 0.63980. No new factor weights were promoted. The 40 original NBA pregame preview player calls from October 20 were recovered intact and graded against official finals: 22 correct, 18 incorrect; Top 5 3–2. The production migration imports all 40, including losses, with duplicate-ignore semantics and no replacement of existing production rows. This is a small, correlated one-game sample, not a calibration claim.
