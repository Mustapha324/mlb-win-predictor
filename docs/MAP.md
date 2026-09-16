# MAP — mlb-win-predictor (Sport IQ)
<!-- generated: 2026-08-27 | commit: 37d6351 | files: 255 | by: trust-map -->
<!-- trust: orientation only — verify targets with a live read before editing -->
<!-- staleness: git diff --stat 37d6351..HEAD — drift into unmapped dirs, >30d, or >50 commits → refresh; sha unreachable (squash/rebase) → judge by this file's own last-commit date -->

## What this is

Sport IQ: a multi-sport (MLB + NFL) win-prediction platform. Pregame predictions are snapshotted immutably in Supabase so live movement can never overwrite the original call, and the free/Pro split ($3.99/mo via Stripe) is enforced by server-side redaction before JSON reaches the browser. The deployed product is the Next.js app in `frontend/` alone — `backend/` is offline research.

## Codemap

```
frontend/            — the deployed product: Next.js 16 App Router on Vercel (hot)
  app/               — pages (dashboard, auth, pro, legal…) + all server routes
  app/api/           — endpoints: predictions/{today,history}, games/[id], player-picks,
                       game-brain, metrics, cron/daily-refresh, webhooks/stripe, account/access
  components/        — sport-neutral UI: Dashboard, GameCard, PlayerPicksSection, MetricsView…
  lib/               — client side: api.ts (fetch layer + types), sports.ts, stripe.ts
  lib/server/        — server-only domain logic: models, picks, odds, entitlements, snapshots
  lib/server/brain/  — Game Brain factors: injuries, weather, venues, form, news, scoring
  lib/supabase/      — Supabase clients: browser, server (cookie-aware), admin (service role)
  scripts/           — brain-backtest.mjs, capture-live.mjs (node --experimental-strip-types)
  tests/             — node:test suites (npm test runs tests/*.test.mjs)
  data/              — (generated) model artifacts: nfl-model-v2.json, model-snapshot.json
  dist/, .wrangler/  — (legacy — don't extend) committed vinext/wrangler build experiment
backend/             — offline FastAPI + scikit-learn research; never deployed, never imported
  app/services/      — MLB training pipeline
  app/services/nfl/  — leakage-safe NFL team/player research pipelines
  scripts/           — dataset builders; train_nfl_history.py writes frontend's NFL artifact
supabase/migrations/ — schema, RLS, hashed invite codes, atomic redemption (run in order)
docs/                — game-brain-plan.md + backtests/ experiment ledgers (hot)
.github/workflows/   — live-capture.yml: 2-hourly pregame git-scrape
```

## Entry points & wiring

- frontend/app/page.tsx → components/Dashboard.tsx; client code fetches same-origin `/api` via lib/api.ts
- frontend/app/api/*/route.ts — all server endpoints; frontend/proxy.ts (Next middleware) refreshes Supabase session cookies on every request
- frontend/vercel.json — Vercel cron hits /api/cron/daily-refresh daily at 09:05 UTC
- .github/workflows/live-capture.yml — every 2h runs scripts/capture-live.mjs; data commits land on the live-snapshots branch only
- Env: frontend/.env.local; full list in frontend/.env.example. Absent keys must degrade to labeled safe states (DFS_BOARDS=off is the odds-credit kill switch)
- Backend research server: `uvicorn app.main:app --reload` from backend/ (not part of the product)

## Where do I change X

| change | go to | gotcha |
|---|---|---|
| MLB win model | frontend/lib/server/mlbModel.ts | chronological replay — future results must never leak into earlier predictions |
| NFL win model | frontend/lib/server/nflModel.ts | reads data/nfl-model-v2.json; regenerate via backend/scripts/train_nfl_history.py |
| brain factors & weights | frontend/lib/server/brain/brainScoring.ts | DEFAULT_BRAIN_WEIGHTS are backtest-lab output, not hand-tweaks; MAX_BRAIN_LOGIT caps influence |
| player picks | frontend/lib/server/playerPicks.ts, playerPickScoring.ts | keep the "Anytime touchdown"→"Rush+Rec TDs" alias while pre-rename Supabase rows exist |
| served game probability (market anchor) | frontend/lib/servingPolicy.ts, lib/marketMath.ts | MARKET_ANCHOR_MODEL_WEIGHT is lab output (docs/backtests/ensemble.md), not a hand-tweak; model-only when no pregame line |
| real sportsbook prop lines | frontend/lib/server/sportsbookProps.ts, lib/sportsbookPropParsing.ts, lib/server/espnScoreboard.ts | ESPN republishes DraftKings lines keyed by ESPN athlete id (MLB matches by name); DraftKings prices are best-effort; SPORTSBOOK_PROPS=off kill switch |
| NFL starters-only pick gating | frontend/lib/server/nflRoster.ts, lib/nflRosterParsing.ts, lib/server/pickEligibility.ts | roster group decides status (offense/defense/specialTeam = active); depth-chart receivers live in wr1–wr3 slots |
| MLB pick eligibility | frontend/lib/server/pickEligibility.ts, playerPicks.ts (active rosters, lineups) | stats use playerPool=ALL now; eligibility rules, not the stat pool, keep part-timers out |
| live pick pace / top-5 tracker | frontend/lib/server/playerPickScoring.ts (livePace, summarizeLive), components/PlayerPicksSection.tsx | pace is recomputed per request from box scores; only status/actual/result are stored |
| DFS board pinning | frontend/lib/server/dfsBoards.ts, propBoardCatalog.ts | us_dfs standard lines sit in main market keys; demons/goblins in `_alternate`; only used when no sportsbook line exists |
| free/Pro gating | frontend/lib/server/entitlements.ts, playerPickAccess.ts, access.ts | redaction is server-side; never move gating into client code |
| pregame snapshots | frontend/lib/server/predictionSnapshots.ts | insert-only upsert; finals update writes only actual_winner/scores/final_at |
| live market odds | frontend/lib/server/marketOdds.ts, espnScoreboard.ts | Odds API consensus when keyed, else ESPN's DraftKings moneyline (no key); an empty map means "no line", never an error |
| daily refresh cron | frontend/app/api/cron/daily-refresh/route.ts, lib/server/modelRefresh.ts | CRON_SECRET bearer required; status recorded in model_refresh_runs |
| billing | frontend/app/pro/actions.ts, app/api/webhooks/stripe/route.ts, lib/stripe.ts | the webhook is the only pro-granting path; signature-verified |
| DB schema | supabase/migrations/ | append new timestamped files, run in order; RLS lives here |
| dashboard UI | frontend/components/Dashboard.tsx, GameCard.tsx | hottest UI files; sport-neutral by design |
| live capture | .github/workflows/live-capture.yml, frontend/scripts/capture-live.mjs | writes to live-snapshots branch; code branches never receive data |
| backtests | frontend/scripts/brain-backtest.mjs, docs/backtests/ | npm run backtest; the decision ledger is docs/backtests/experiments.md |

## Core flows

**Prediction request**
1. Dashboard fetches via lib/api.ts → same-origin /api
2. app/api/predictions/today/route.ts validates sport + date
3. getPredictions / getNflPredictions build the slate (models + brain factors)
4. preservePregameSnapshots inserts missing pregame rows (never overwrites)
5. applyPredictionEntitlements redacts per access tier
6. JSON returned with `Cache-Control: private, no-store`

**Daily refresh**
1. Vercel cron (vercel.json) hits /api/cron/daily-refresh at 09:05 UTC
2. hasValidBearer(CRON_SECRET) gates the route — 401 otherwise
3. modelRefresh replays completed finals, refreshes MLB/NFL current state + player features
4. Player picks rebuilt (up to 40); pregame snapshots preserved
5. Run status recorded in model_refresh_runs

## Invariants & boundaries

- Pregame snapshots are write-once: upsert with `{ onConflict: "sport,game_id", ignoreDuplicates: true }`; the finals pass updates only actual_winner/away_score/home_score/final_at. [grep: ignoreDuplicates → 1 hit in frontend/lib/server/predictionSnapshots.ts]
- Free/Pro redaction happens in server routes before JSON leaves. [grep: applyPredictionEntitlements → frontend/app/api/predictions/today/route.ts; applyGameEntitlement → frontend/app/api/games/[id]/route.ts]
- The daily-refresh route rejects requests without the CRON_SECRET bearer. [grep: hasValidBearer → frontend/app/api/cron/daily-refresh/route.ts]
- The service-role key's value is read in exactly one file; everywhere else only presence-checks it. [grep: SUPABASE_SERVICE_ROLE_KEY → 4 files, value read only in frontend/lib/supabase/admin.ts]
- Server domain modules are guarded against client bundling. [grep: "server-only" → 20 files under frontend/lib]
- Pure, unit-tested modules (marketMath, servingPolicy, sportsbookPropParsing, nflRosterParsing, pickEligibility, playerPickScoring, propBoardCatalog, brainScoring) never import "server-only" and never fetch. [grep: node --test → package.json "test"]
- Users cannot self-upgrade: authenticated role may update only profiles.display_name; tier changes flow through the Stripe webhook (admin client) or the security-definer invite redemption. [grep: grant update (display_name) → supabase/migrations/202608160001_sport_iq_accounts_pro.sql]
- Invite codes exist only as SHA-256 hashes, redeemed atomically in Postgres. [grep: sha256 → 1 hit in supabase/migrations/202608160001_sport_iq_accounts_pro.sql]
- frontend never imports backend — the deployed app is self-contained. [grep: from ".*backend → 0 hits in frontend/]
- Capture data lands only on the live-snapshots branch, so captures never trigger Vercel deploys. [grep: live-snapshots → .github/workflows/live-capture.yml]

## Lies & gotchas

- frontend/dist/ and frontend/.wrangler/ are a committed one-off vinext/wrangler build experiment — Vercel builds from source; don't edit, extend, or trust them.
- Generated files are tracked and churn: next-env.d.ts, tsconfig.tsbuildinfo (git switch can fail over it — delete the local copy), and frontend/AGENTS.md's Next.js block is auto-rewritten by `next dev`.
- frontend/.env.local is tracked on main with real-looking values — treat everything in it as compromised; never park new secrets there.
- lib/api.ts, despite the name, calls same-origin Next routes (BACKEND_BASE_URL defaults to ""); NEXT_PUBLIC_API_BASE_URL can point it at FastAPI but production doesn't use it.
- proxy.ts is Next 16's renamed middleware (Supabase session-cookie refresh), not a network proxy.
- docs/backtests/*.html and *.json are generated outputs; only the .md ledgers are hand-written history — except docs/backtests/ensemble.md, which `npm run backtest -- nfl --ensemble` regenerates.
- Pure lib modules that need runtime imports use relative `.ts` paths (tsconfig `allowImportingTsExtensions`): `node --test` has no `@/` alias and `server-only` throws outside Next, so a pure module that reaches for either breaks the test suite.
- The NFL ensemble lab needs per-season v2 checkpoints in frontend/scripts/.brain-backtest-cache/nfl-v2/ (gitignored); regenerate them with backend/scripts/train_nfl_history.py per season before re-running it.
