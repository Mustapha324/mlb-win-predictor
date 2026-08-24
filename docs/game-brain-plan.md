# Game Brain — matchup intelligence for MLB + NFL

*Plan drafted 2026-08-24. Status: Phase 1 in progress on `feat/game-brain`.*

## What it is

A per-game intelligence layer ("the brain") that assembles everything that matters about a matchup
before first pitch / kickoff — injuries and who is actually playing, weather and venue, recent form,
what each team is good and bad at — compares the two teams, and feeds a bounded adjustment into the
win probability while showing its reasoning in the UI. It also accumulates knowledge over time
(injury timelines, news, performance trends per team) so context gets richer as the season goes on.

## Prior art check (2026-08-24)

- **In this repo: not built.** The deployed models use team ratings, W/L, run differential,
  home/away splits, recent form, and probable-pitcher ERA/WHIP. Nothing reads injuries, weather,
  lineups, or news. The offline pipeline explicitly left hooks for this:
  `backend/docs/architecture-notes.md` lists "Lineup-aware features" and "Weather" as planned
  extensions with TODOs in `backend/app/services/prediction_pipeline.py`. The Game Brain implements
  that roadmap in the deployed product.
- **Open source: nothing adoptable.** Public projects (NFLForecast, mlb_game_predictor,
  baseball-predictions, etc.) are one-off research repos — batch ML pipelines, not a live context
  layer with graceful degradation. We borrow ideas (weather/rest features are worth ~2pp accuracy in
  published backtests), not code.

## Data sources — all verified live on 2026-08-24, all free, no keys

| Signal | Source | Endpoint (verified) |
|---|---|---|
| MLB injuries / IL | MLB StatsAPI | `/api/v1/teams/{id}/roster?rosterType=40Man` — `status.description` e.g. "Injured 10-Day" (verified: Juan Soto on Mets IL) |
| MLB transactions (IL moves, call-ups) | MLB StatsAPI | `/api/v1/transactions?startDate=&endDate=` |
| MLB starting lineups | MLB StatsAPI | `/api/v1/schedule?hydrate=lineups,probablePitcher` — posted ~1–3h pregame |
| MLB venue roof + coordinates | MLB StatsAPI | `/api/v1/venues/{id}?hydrate=location,fieldInfo` — `roofType` (Open/Dome/Retractable) + lat/lon |
| NFL injuries + designations | ESPN core API | `sports.core.api.espn.com/v2/sports/football/leagues/nfl/teams/{id}/injuries` — paginated refs → status (Out/Doubtful/Questionable/IR) + comment text |
| NFL venue indoor flag | ESPN site API | scoreboard `competitions[].venue.indoor` (coords from a 32-row static stadium table) |
| Weather | Open-Meteo | hourly temp/wind/gusts/precip/snow by lat/lon; free, keyless. ~10k req/day non-commercial tier — flag: product is paid, budget for their commercial plan or make the provider pluggable |
| Team form / results | Already in repo | existing schedule ingestion (MLB StatsAPI, ESPN NFL) |
| Team strengths | MLB StatsAPI team stats; ESPN NFL team stats | runs scored/allowed splits, pass/rush offense+defense → league percentile ranks |
| News | ESPN news API | `site.api.espn.com/apis/site/v2/sports/{sport}/{league}/news?team={abbr}` (verified with `?team=nyy`) |

## Architecture

New module family `frontend/lib/server/brain/` mirroring the repo's existing patterns
(`server-only` fetchers that fail to empty, pure logic split out for unit tests):

```
brain/
  venues.ts       venue coords + roof/dome resolution (MLB via API, NFL static table)
  weather.ts      Open-Meteo game-hour forecast, skipped for domes/closed roofs
  injuries.ts     per-team injury reports with an impact-weighted burden score
  lineups.ts      posted MLB lineups; star-player-missing detection; NFL designations
  teamProfile.ts  strengths/weaknesses as league percentiles + head-to-head matchup edges
  form.ts         last-10 trend, streak, rest days
  news.ts         team news headlines, tagged (injury/trade/return/scratch) for relevance
  gameBrain.ts    orchestrator: assemble GameBrainContext per game, compute bounded
                  probability adjustment, emit human-readable "why" factors
  brainScoring.ts pure scoring/weight math (unit-testable, no server-only import)
```

**The context object** (per scheduled game, assembled pregame only):

```ts
GameBrainContext {
  gameId, sport, assembledAt,
  injuries: { home: TeamInjuryReport, away: TeamInjuryReport },   // burden 0–1 + named key absences
  lineup:   { home: LineupStatus, away: LineupStatus },           // posted? stars missing?
  venue:    { name, indoor/roof, coordinates },
  weather:  { tempF, windMph, gustMph, precipProb, snow } | null, // null when dome/closed
  form:     { home: TeamForm, away: TeamForm },                   // last10, streak, restDays, diff trend
  profile:  { home: TeamProfile, away: TeamProfile },             // percentile strengths
  edges:    MatchupEdge[],                                        // e.g. "NYJ pass rush (92nd) vs weak OL (14th)"
  news:     NewsFlag[],                                           // tagged pregame headlines
  adjustment: { logitDelta, homeWinProbabilityDelta, factors: string[] }
}
```

**Probability adjustment is bounded and evidence-based** (logit-space, clamped to ±0.35 ≈ ±8pp):

- NFL QB Out/Doubtful: the single biggest term (books move lines multiple points; classic Elo
  treatments dock a QB-out team the equivalent of ~2–3 points).
- Non-QB NFL injuries: position-weighted burden (QB ≫ OL/edge/WR1 > others), small per-player caps.
- MLB: probable-pitcher scratch detection > star hitter absences (each worth only ~1–2pp) >
  aggregate IL burden.
- Weather: mostly a totals effect, so tiny win-prob terms — only extreme cases move sides
  (sustained wind 20+ mph, <25°F for pass-heavy road teams; published data: moderate rain ≈ −4
  combined points, heavy snow ≈ −25% passing).
- Form/rest: small nudges (rest-day edge, extreme streaks) — most of this is already in team ratings,
  so the brain must not double count; weights start near zero and earn their size in shadow mode.

## Trust model: shadow mode first

Pregame snapshots are immutable product promises — we do not change the model's called winner until
the brain proves out. Rollout:

1. **Shadow (Phase 1–2):** brain context is displayed ("Why this pick" factors + Game Brain panel)
   and logged alongside the baseline probability. `brain_adjusted_probability` is stored next to the
   baseline in the snapshot payload but does NOT change `predicted_winner`.
2. **Evaluation gate:** after ≥150 graded games per sport, compare Brier/log-loss of adjusted vs
   baseline. Ship the adjustment only where it wins.
3. **Live (Phase 3+):** adjustment folds into the pregame probability at generation time (never
   after snapshot), behind `BRAIN=off` env escape hatch.

## Daily automations

Vercel cron today: `daily-refresh` at 09:05 UTC. Add a second cron:

- **`/api/cron/brain-refresh` at ~16:30 UTC** (~12:30pm ET): assemble contexts for today's slate
  when injury reports and weather forecasts are meaningful, persist snapshots, refresh team intel.
- **On-demand reassembly** at request time (cached 15–30 min) keeps late-breaking changes (posted
  MLB lineups ~1–3h pregame, NFL Sunday actives) flowing into the UI between crons without extra
  cron slots.
- Each run also: pulls transactions/news since last run, updates rolling team dossiers, and checks
  posted lineups against expected stars → emits "scratch" flags.

## Knowledge accumulation ("growing understanding")

Supabase tables (insert-only, mirroring the snapshot ethos):

- `team_intel_snapshots` — (sport, team, date) → injuries jsonb, profile jsonb, form jsonb.
  A queryable season-long timeline per team.
- `team_news_items` — deduped tagged headlines per team with published_at (pregame-stamped).
- `game_brain_contexts` — full context + adjustment per game, written pregame; joins to graded
  results later so we can measure which factors actually predicted outcomes (the learning loop).

The measurement loop is the real "getting smarter": every factor the brain cites is stored pregame
and graded postgame, so factor weights are periodically re-fit from our own logged history — same
philosophy as the existing player-pick result tracking. Optional later: LLM summarization of each
team's dossier into a narrative scouting report (env-gated; no key in repo today).

## Player-picks tie-in (after PR #55)

The brain's lineup/injury layer also guards the DFS board: skip player picks for anyone not in the
posted MLB lineup, flagged Out/Doubtful in the NFL, or facing extreme weather — fewer voided and
doomed picks.

## Backtest harness, factor lab + tuned weights (2026-08-24, v2)

`frontend/scripts/brain-backtest.mjs` (`npm run backtest`; `--experiment` runs the factor lab,
`--frozen` evaluates current production weights untouched) replays 2021–2026 walk-forward
against a margin-of-victory Elo baseline: burn-in → train → validation → untouched holdout,
per-loss diagnosis (coin-flip / signal-missed / rating-gap / fluke — flukes are logged but
excluded from tuning), bounded coordinate-descent on trailing log-loss. New candidate factors
are admitted by greedy forward selection on VALIDATION log-loss only; the final holdout is
never used for selection. Charts land in `docs/backtests/{mlb,nfl}-backtest.html`, the factor
ledger in `docs/backtests/experiments.md` — internal, not linked from the site.

Factor-lab verdicts (v2) and the frozen evaluation of shipped `DEFAULT_BRAIN_WEIGHTS`:

- **NFL** (train 2022–23, validation 2024, holdout 2025): KEPT **Pythagorean expectation**
  (weight ~0.69) and **division-game dampening** (~0.27); REJECTED scoring form, home/road
  splits, bye flag. Shipped weights, frozen: validation **66.2% vs 65.4%** (logloss 0.6083 vs
  0.6178), holdout **64.9% vs 64.2%** (0.6563 vs 0.6602) — genuine gains on two unseen seasons.
  Injury/QB stay research priors (no free historical injury reports to tune against).
- **MLB** (train 2022–24, validation 2025, holdout 2026-to-date): ALL record candidates
  (starter form, scoring form, splits, pythag, density) rejected — a margin-aware baseline
  already carries that information — and an ablation showed form/injury/rest add nothing
  measurable either. MLB ships display-grade weights (weather ~0.06 is the one consistent
  survivor): frozen evaluation is dead even with baseline (56.1% = 56.1%), honest and harmless.
  The real MLB upgrade path stays Phase 2/4: importance-weighted injuries and probable-pitcher
  scratch detection — information no ratings baseline carries.

## News ingestion (2026-08-24) — no database required

`brain/news.ts` feeds each game's brain context with tagged headlines (pure classifier
`tagNewsText`: injury / trade / activation / call-up / suspension / pitching / milestone) from two
sources: ESPN team news (both sports) and MLB transactions — the one news feed with a real
archive. That archive made news *backtestable*: a roster-churn factor (disruption on the
transaction wire, last 14 days) was lab-tested like every other candidate and **rejected**
(Δ validation logloss −0.00008), so news ships as displayed context with zero probability
weight — exactly what the evidence supports. Everything is fetched live and framework-cached;
no Supabase or any account is involved.

## Research round 3 (2026-08-24): QB value, FIP, HFA re-sweep

Grounded in the QB-adjustment literature (QB is the largest single NFL factor) and the
documented league-wide home-edge decline:

- **NFL home advantage re-swept on validation: 48 → 28 Elo** (~54% home), matching the modern
  era; improves baseline and brain on validation and holdout log-loss.
- **qbValue KEPT (shipped 0.05)**: rolling projected-starter composite (yards/att + TD−INT)
  from 1,355 real box scores; starter = last game's starter, week 1 excluded. Top validation
  gain (+0.0038); helps 3 of 4 frozen seasons; the seasons disagree on size, so it ships
  shrunk to 0.05 where holdout log-loss beats baseline. Production wiring:
  `getNflQbContext` (regular-season summaries, 21-day stale guard).
- **REJECTED after testing**: real per-start FIP for MLB starters (−0.0007 — even genuine
  K/BB/HR logs add nothing over a margin-aware baseline), NFL travel distance, short-week
  flag, and (again) scoring form, splits, bye.

## Round 4 (2026-08-24): live capture automation, calibration, ensemble

- **Live pregame capture, fully automated, no accounts**: `.github/workflows/live-capture.yml`
  runs `frontend/scripts/capture-live.mjs` every two hours across game windows (git-scraping
  pattern). Each run snapshots the live information backtests can never see — posted probables
  and lineups, current IL/injury reports, projected starting QBs with rolling value, game-hour
  weather forecasts, tagged transactions — plus the brain's probabilities at capture time, and
  commits JSON to the `live-snapshots` branch (never triggers deploys). Next morning it grades
  the last pregame capture of every game against the final score into
  `data/live-snapshots/ledger-{sport}.json` — the cumulative forward test. Verified end-to-end
  on the 2026-08-24 slate (capture + grading against real finals). Local: `npm run capture`.
  NOTE: the Action starts running once this lands on the default branch.
- **Temperature calibration SHIPPED** (`MODEL_TEMPERATURE`: MLB 1.30, NFL 1.45, fit on train
  seasons): both engines ran overconfident; dividing the final logit by τ improves log-loss
  everywhere it was measured (NFL holdout 0.6564 → 0.6401, MLB 0.6887 → 0.6865) and cannot
  change picks. Applied at serving time (harness outputs + live captures).
- **K-factor sweeps: incumbents kept** (MLB 4, NFL 20) — validation split logloss vs accuracy
  at noise level, and hyperparameters only move on clear evidence.
- **50/50 logit ensemble (GitHub model + NEW)**: best NFL holdout of any configuration
  (65.7%, logloss 0.6332) though NEW remains better on the 4-season average — documented in
  faceoff.md as the recommended serving strategy once both engines run side by side.

## Round 5 (2026-08-24): confident-loss autopsy → two changes, one anti-lesson

`npm run backtest -- all --autopsy` dissects every confident loss (≥60% picks) using MLB
inning-by-inning linescores and NFL team stats, then marquee misses were researched online.
Findings in `docs/backtests/autopsy.md`; memory of the patterns persisted for future sessions.
Adopted: `lateSeasonDamp` 0.15 (weeks 17–18 favorite shrink — our worst-ever miss was a
seed-locked week-18 rest spot) and `qbOut` 0.25→0.35 (Chiefs@Titans-type cases; live-only).
Rejected: turnover-margin factor — 38% of confident losses are turnover swings but they are
game-day luck, unpredictable from season data. MLB: ~48% of confident losses are irreducible
variance; calibration is the correct treatment.

## Faceoff vs the deployed GitHub models (2026-08-24)

`npm run backtest -- all --faceoff` replays the deployed models faithfully (exact
hyperparameters, snapshot logistic weights for MLB, self-contained constants for NFL) against
the new model (MOV-Elo + frozen brain weights) on identical games. Full table in
`docs/backtests/faceoff.md`:

- **MLB — new model wins.** On the only window that is out-of-sample for both (2026 to date,
  1,965 games): **new 56.1% vs GitHub 54.3%** with better log-loss; the new model also wins
  overall across 11,699 games even though 2022–2025 were in-sample for the GitHub logistic.
  (Caveat: the replayed GitHub pitcher adjustment uses a runs-allowed proxy, not live ERA/WHIP.)
- **NFL — new model better on balance.** After round 3 (HFA 28 + qbValue): overall 65.0% /
  0.6435 vs 63.5% / 0.6520 across four seasons, decisive wins in 2022–23; GitHub keeps a
  2025-specific accuracy edge, within noise and traceable to qbValue's one adverse season.

## Phases

- **Phase 1 (this branch):** `venues` + `weather` + `injuries` + `form` + pure scoring; `gameBrain`
  assembly in shadow mode; `/api/game-brain` per-game endpoint; unit tests. No DB, no cron changes.
  ✅ Plus the backtest harness above (Phase 5's re-weighting loop, delivered early as offline tooling).
- **Phase 2:** Supabase migration (3 tables above), `brain-refresh` cron + vercel.json entry,
  news ingestion + tagging, team dossiers.
- **Phase 3:** shadow evaluation report; enable bounded adjustment where it wins; UI "Game Brain"
  panel on game details pages.
- **Phase 4:** lineup-posted + scratch detection wired into player picks; NFL near-kickoff actives.
- **Phase 5:** factor re-weighting from logged history; optional LLM dossier summaries.
