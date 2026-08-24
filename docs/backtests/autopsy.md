# Confident-loss autopsy — generated 2026-08-24 by npm run backtest -- all --autopsy

What actually decided the games the brain was most confident about and lost — from inning-by-inning MLB linescores and NFL team stats — and whether any pregame-knowable signal pointed the right way.

## MLB — confident-loss autopsy (pick >= 60%)

Confident losses: 1545 · confident wins: 2628 (win rate 63.0%)

### What actually happened in the losses

- other: **391** (25%)
- one-run margin (variance): **386** (25%)
- our bats blanked (<=1 run): **348** (23%)
- our starter shelled early (<=3 innings, 4+ runs): **289** (19%)
- late-inning flip (bullpen): **131** (8%)

### Pregame signal alignment (mean, positive = pointed at our pick)

| signal | in losses | in wins |
|---|---|---|
| scoring-margin gap (toward pick) | 1.586 | 1.754 |
| pythag gap (toward pick) | 0.124 | 0.140 |

### Ten most confident losses

| date | matchup | pick | conf | final | phase |
|---|---|---|---|---|---|
| 2022-07-25 | Washington Nationals @ Los Angeles Dodgers | home | 0.803 | 4-1 | train |
| 2022-07-26 | Washington Nationals @ Los Angeles Dodgers | home | 0.793 | 8-3 | train |
| 2024-09-04 | Chicago White Sox @ Baltimore Orioles | home | 0.792 | 8-1 | train |
| 2022-10-02 | Colorado Rockies @ Los Angeles Dodgers | home | 0.791 | 4-1 | train |
| 2026-03-30 | Colorado Rockies @ Toronto Blue Jays | home | 0.79 | 14-5 | holdout |
| 2023-06-24 | Kansas City Royals @ Tampa Bay Rays | home | 0.785 | 9-4 | train |
| 2022-05-31 | Pittsburgh Pirates @ Los Angeles Dodgers | home | 0.78 | 5-3 | train |
| 2025-06-29 | Colorado Rockies @ Milwaukee Brewers | home | 0.775 | 4-3 | validation |
| 2022-10-04 | Colorado Rockies @ Los Angeles Dodgers | home | 0.775 | 5-2 | train |
| 2026-07-24 | Colorado Rockies @ Milwaukee Brewers | home | 0.774 | 5-2 | holdout |
## NFL — confident-loss autopsy (pick >= 60%)

Confident losses: 215 · confident wins: 515 (win rate 70.5%)

### What actually happened in the losses

- turnover swing against our pick (2+): **81** (38%)
- other: **57** (27%)
- one-score finish (variance): **50** (23%)
- our pick no-showed (14+ blowout): **27** (13%)

### Pregame signal alignment (mean, positive = pointed at our pick)

| signal | in losses | in wins |
|---|---|---|
| season TO margin gap (toward pick) | 0.385 | 0.399 |
| pythag gap (toward pick) | 0.111 | 0.155 |
| QB value gap (toward pick) | 0.610 | 0.989 |

### Ten most confident losses

| date | matchup | pick | conf | final | phase |
|---|---|---|---|---|---|
| 2025-01-05 | Buffalo Bills @ New England Patriots | away | 0.936 | 16-23 | validation |
| 2025-12-21 | Kansas City Chiefs @ Tennessee Titans | away | 0.928 | 9-26 | holdout |
| 2025-11-02 | Carolina Panthers @ Green Bay Packers | home | 0.92 | 16-13 | holdout |
| 2023-10-29 | Kansas City Chiefs @ Denver Broncos | away | 0.911 | 9-24 | train |
| 2025-10-10 | Philadelphia Eagles @ New York Giants | away | 0.91 | 17-34 | holdout |
| 2023-12-31 | Arizona Cardinals @ Philadelphia Eagles | home | 0.895 | 35-31 | train |
| 2025-10-06 | New England Patriots @ Buffalo Bills | home | 0.894 | 23-20 | holdout |
| 2025-01-05 | Chicago Bears @ Green Bay Packers | home | 0.885 | 24-22 | validation |
| 2024-10-06 | Arizona Cardinals @ San Francisco 49ers | home | 0.873 | 24-23 | validation |
| 2023-11-14 | Denver Broncos @ Buffalo Bills | home | 0.862 | 24-22 | train |

## Verdicts (what the autopsy changed, 2026-08-24)

**Researched narratives behind the marquee misses:**
- *Bills @ Patriots, week 18 (93.6% miss — our worst ever):* Bills publicly planned a starter/backup "blend" with their seed locked; Allen played only briefly. Fully knowable from Friday news.
- *Chiefs @ Titans, Dec 2025 (92.8% miss):* Mahomes already out for the season, Chiefs eliminated, nine more ruled out the Friday before; the backup got hurt and a practice-squad QB finished. Fully knowable from injury reports.
- *Chiefs @ Broncos 2023 (91.1% miss):* five-turnover meltdown — the archetype of the 38% turnover-loss bucket. Not knowable pregame.

**Adopted:**
- `lateSeasonDamp` 0.15 (NFL weeks 17–18 favorite shrink): improves holdout log-loss (0.65639 → 0.65537) with flat accuracy — prices the rest/motivation trap honestly.
- `qbOut` prior raised 0.25 → 0.35: books move 4–6 points for star QB outs; this is the live factor that catches Chiefs-type cases (backtests never can — no historical injury reports).

**Rejected:**
- `toMargin` (season turnover-margin gap): turnovers cause 38% of confident losses but season margin doesn't predict game-day swings (alignment 0.385 losses vs 0.399 wins; frozen test −1.9pp in 2022, worse log-loss). Turnover upsets are luck — do not re-chase.

**Standing conclusions:** MLB confident losses are ~48% pure variance (one-run games, blanked bats) and 19% starter blowups that real FIP data cannot predict — temperature calibration is the correct treatment, and the remaining MLB/NFL headroom lives in pregame LIVE information (injuries, announced rest, lineups), which the live-capture ledger now accumulates.
