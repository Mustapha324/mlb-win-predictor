# Game Brain factor experiments

Generated 2026-08-24 by `npm run backtest -- all --experiment`. Selection: greedy forward on validation log-loss (candidates tuned walk-forward on train only, measured frozen on validation; final holdout untouched).

## MLB — kept: injuryGap, formWinRate, restDay, weatherHome

| config | val games | brain acc % | base acc % | brain logloss | base logloss | Δ vs best |
|---|---|---|---|---|---|---|
| base (form/rest/weather/injury) | 2434 | 56.37 | 56.7 | 0.67901 | 0.67891 |  |
| + pitcherForm | 2434 | 56.29 | 56.7 | 0.67938 | 0.67891 | -0.00037 |
| + scoringForm | 2434 | 56.61 | 56.7 | 0.67901 | 0.67891 | 0 |
| + homeSplit | 2434 | 56.45 | 56.7 | 0.67898 | 0.67891 | 0.00003 |
| + pythag | 2434 | 56.41 | 56.7 | 0.67956 | 0.67891 | -0.00055 |
| + density | 2434 | 56.49 | 56.7 | 0.67899 | 0.67891 | 0.00002 |

## NFL — kept: formWinRate, restDay, weatherHome, pythag, divisionDamp

| config | val games | brain acc % | base acc % | brain logloss | base logloss | Δ vs best |
|---|---|---|---|---|---|---|
| base (form/rest/weather) | 272 | 65.07 | 65.44 | 0.61831 | 0.61776 |  |
| + scoringForm | 272 | 66.54 | 65.44 | 0.62197 | 0.61776 | -0.00365 |
| + homeSplit | 272 | 64.71 | 65.44 | 0.61777 | 0.61776 | 0.00054 |
| + pythag | 272 | 65.07 | 65.44 | 0.61412 | 0.61776 | 0.00419 |
| + divisionDamp | 272 | 65.07 | 65.44 | 0.6148 | 0.61776 | 0.00351 |
| + bye | 272 | 65.44 | 65.44 | 0.61995 | 0.61776 | -0.00164 |
| KEPT pythag | 272 | 65.07 | 65.44 | 0.61412 | 0.61776 |  |
| + scoringForm | 272 | 65.81 | 65.44 | 0.62173 | 0.61776 | -0.00761 |
| + homeSplit | 272 | 65.44 | 65.44 | 0.61441 | 0.61776 | -0.00029 |
| + divisionDamp | 272 | 65.07 | 65.44 | 0.6099 | 0.61776 | 0.00422 |
| + bye | 272 | 65.07 | 65.44 | 0.61498 | 0.61776 | -0.00086 |
| KEPT divisionDamp | 272 | 65.07 | 65.44 | 0.6099 | 0.61776 |  |
| + scoringForm | 272 | 64.71 | 65.44 | 0.61401 | 0.61776 | -0.00411 |
| + homeSplit | 272 | 65.07 | 65.44 | 0.60988 | 0.61776 | 0.00002 |
| + bye | 272 | 65.44 | 65.44 | 0.61156 | 0.61776 | -0.00166 |
