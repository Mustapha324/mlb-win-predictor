# Game Brain factor experiments

Generated 2026-08-24 by `npm run backtest -- all --experiment`. Selection: greedy forward on validation log-loss (candidates tuned walk-forward on train only, measured frozen on validation; final holdout untouched).

## MLB — kept: injuryGap, formWinRate, restDay, weatherHome

| config | val games | brain acc % | base acc % | brain logloss | base logloss | Δ vs best |
|---|---|---|---|---|---|---|
| base (form/rest/weather/injury) | 2434 | 56.53 | 56.7 | 0.67894 | 0.67891 |  |
| + pitcherForm | 2434 | 56.49 | 56.7 | 0.67937 | 0.67891 | -0.00042 |
| + scoringForm | 2434 | 56.49 | 56.7 | 0.67904 | 0.67891 | -0.00009 |
| + homeSplit | 2434 | 56.53 | 56.7 | 0.67894 | 0.67891 | 0 |
| + pythag | 2434 | 56.53 | 56.7 | 0.67938 | 0.67891 | -0.00044 |
| + density | 2434 | 56.49 | 56.7 | 0.67894 | 0.67891 | 0 |
| + rosterChurn | 2434 | 56.2 | 56.7 | 0.67904 | 0.67891 | -0.00009 |

## NFL — kept: formWinRate, restDay, weatherHome, pythag, divisionDamp

| config | val games | brain acc % | base acc % | brain logloss | base logloss | Δ vs best |
|---|---|---|---|---|---|---|
| base (form/rest/weather) | 272 | 65.07 | 65.44 | 0.61816 | 0.61776 |  |
| + scoringForm | 272 | 66.18 | 65.44 | 0.62197 | 0.61776 | -0.00382 |
| + homeSplit | 272 | 64.71 | 65.44 | 0.61776 | 0.61776 | 0.00039 |
| + pythag | 272 | 65.81 | 65.44 | 0.61082 | 0.61776 | 0.00734 |
| + divisionDamp | 272 | 65.07 | 65.44 | 0.61469 | 0.61776 | 0.00346 |
| + bye | 272 | 65.44 | 65.44 | 0.61963 | 0.61776 | -0.00147 |
| KEPT pythag | 272 | 65.81 | 65.44 | 0.61082 | 0.61776 |  |
| + scoringForm | 272 | 66.54 | 65.44 | 0.61304 | 0.61776 | -0.00222 |
| + homeSplit | 272 | 65.44 | 65.44 | 0.6104 | 0.61776 | 0.00042 |
| + divisionDamp | 272 | 65.07 | 65.44 | 0.60791 | 0.61776 | 0.00291 |
| + bye | 272 | 65.44 | 65.44 | 0.61346 | 0.61776 | -0.00264 |
| KEPT divisionDamp | 272 | 65.07 | 65.44 | 0.60791 | 0.61776 |  |
| + scoringForm | 272 | 65.07 | 65.44 | 0.61255 | 0.61776 | -0.00464 |
| + homeSplit | 272 | 65.07 | 65.44 | 0.60791 | 0.61776 | 0 |
| + bye | 272 | 65.07 | 65.44 | 0.61055 | 0.61776 | -0.00264 |
