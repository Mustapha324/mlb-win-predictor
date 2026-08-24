# Game Brain factor experiments

Generated 2026-08-24 by `npm run backtest -- all --experiment`. Selection: greedy forward on validation log-loss (candidates tuned walk-forward on train only, measured frozen on validation; final holdout untouched).

## MLB — kept: injuryGap, formWinRate, restDay, weatherHome

| config | val games | brain acc % | base acc % | brain logloss | base logloss | Δ vs best |
|---|---|---|---|---|---|---|
| base (form/rest/weather/injury) | 2434 | 56.49 | 56.7 | 0.67897 | 0.67891 |  |
| + starterFip | 2434 | 55.59 | 56.7 | 0.67964 | 0.67891 | -0.00067 |
| + scoringForm | 2434 | 56.53 | 56.7 | 0.67906 | 0.67891 | -0.00008 |
| + homeSplit | 2434 | 56.41 | 56.7 | 0.67901 | 0.67891 | -0.00004 |
| + pythag | 2434 | 56.57 | 56.7 | 0.67941 | 0.67891 | -0.00043 |
| + density | 2434 | 56.49 | 56.7 | 0.67896 | 0.67891 | 0.00001 |
| + rosterChurn | 2434 | 56.24 | 56.7 | 0.67905 | 0.67891 | -0.00008 |

## NFL — kept: formWinRate, restDay, weatherHome, pythag, qbValue, divisionDamp

| config | val games | brain acc % | base acc % | brain logloss | base logloss | Δ vs best |
|---|---|---|---|---|---|---|
| base (form/rest/weather) | 272 | 66.91 | 66.54 | 0.61669 | 0.61627 |  |
| + qbValue | 272 | 66.91 | 66.54 | 0.61192 | 0.61627 | 0.00478 |
| + travel | 272 | 65.07 | 66.54 | 0.62003 | 0.61627 | -0.00334 |
| + shortWeek | 272 | 66.54 | 66.54 | 0.61658 | 0.61627 | 0.00012 |
| + scoringForm | 272 | 68.01 | 66.54 | 0.62123 | 0.61627 | -0.00454 |
| + homeSplit | 272 | 67.28 | 66.54 | 0.61595 | 0.61627 | 0.00074 |
| + pythag | 272 | 68.38 | 66.54 | 0.60922 | 0.61627 | 0.00747 |
| + divisionDamp | 272 | 66.91 | 66.54 | 0.61358 | 0.61627 | 0.00311 |
| + bye | 272 | 66.54 | 66.54 | 0.61836 | 0.61627 | -0.00167 |
| KEPT pythag | 272 | 68.38 | 66.54 | 0.60922 | 0.61627 |  |
| + qbValue | 272 | 68.75 | 66.54 | 0.60543 | 0.61627 | 0.0038 |
| + travel | 272 | 65.07 | 66.54 | 0.61797 | 0.61627 | -0.00875 |
| + shortWeek | 272 | 68.01 | 66.54 | 0.60913 | 0.61627 | 0.00009 |
| + scoringForm | 272 | 67.65 | 66.54 | 0.61355 | 0.61627 | -0.00433 |
| + homeSplit | 272 | 68.38 | 66.54 | 0.60931 | 0.61627 | -0.00009 |
| + divisionDamp | 272 | 67.65 | 66.54 | 0.60746 | 0.61627 | 0.00176 |
| + bye | 272 | 67.28 | 66.54 | 0.61339 | 0.61627 | -0.00416 |
| KEPT qbValue | 272 | 68.75 | 66.54 | 0.60543 | 0.61627 |  |
| + travel | 272 | 66.91 | 66.54 | 0.61348 | 0.61627 | -0.00806 |
| + shortWeek | 272 | 68.75 | 66.54 | 0.6053 | 0.61627 | 0.00013 |
| + scoringForm | 272 | 68.75 | 66.54 | 0.60564 | 0.61627 | -0.00021 |
| + homeSplit | 272 | 68.75 | 66.54 | 0.60545 | 0.61627 | -0.00003 |
| + divisionDamp | 272 | 68.01 | 66.54 | 0.60425 | 0.61627 | 0.00118 |
| + bye | 272 | 68.01 | 66.54 | 0.60693 | 0.61627 | -0.00151 |
| KEPT divisionDamp | 272 | 68.01 | 66.54 | 0.60425 | 0.61627 |  |
| + travel | 272 | 66.91 | 66.54 | 0.60693 | 0.61627 | -0.00268 |
| + shortWeek | 272 | 68.01 | 66.54 | 0.60512 | 0.61627 | -0.00087 |
| + scoringForm | 272 | 67.28 | 66.54 | 0.60754 | 0.61627 | -0.00329 |
| + homeSplit | 272 | 68.01 | 66.54 | 0.60425 | 0.61627 | 0 |
| + bye | 272 | 68.01 | 66.54 | 0.60583 | 0.61627 | -0.00158 |
