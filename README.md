# Sport IQ

Sport IQ is a black/dark multi-sport prediction platform for MLB and NFL. It keeps every pregame prediction locked separately from live probability movement, optional sportsbook consensus, and the verified final winner.

## Product features

- MLB daily and NFL weekly modes with one shared interface
- Separate chronological MLB and NFL models, metrics, history, teams, game detail, and final results
- Immutable pregame prediction snapshots in Supabase; live updates cannot overwrite the original call
- Live score-based win probabilities for Pro and optional live moneyline consensus through The Odds API
- Top 20 MLB/NFL Player Picks ranked by confidence
  - MLB: hits, total bases, home runs, RBIs, and pitcher strikeouts
  - NFL: passing/rushing/receiving yards, receptions, and touchdowns when official leader feeds expose them
- Secure Supabase email/password accounts and profiles
- Stripe Checkout subscription prepared at $3.99/month, verified webhooks, and customer billing portal
- Five one-time Friends & Family codes stored only as SHA-256 hashes and redeemed atomically in Postgres
- Responsive, true-black UI with cyan MLB and lime NFL accents

## Free and Pro

| Capability | Free | Pro ($3.99/month) |
|---|---|---|
| Team predictions | Half-slate preview; remaining cards redacted and blurred | Entire slate |
| Pregame call | Visible on preview games | Visible on every game |
| Live win probability | Not returned by the API | 30-second updates during live games |
| Live market consensus | Not returned by the API | Available when `THE_ODDS_API_KEY` is configured |
| Player Picks | Top 5 | Top 20 with confidence, supporting stats, and explanation |
| History and final winners | Included | Included |
| Billing management | N/A | Stripe customer portal |

Entitlements are applied in server routes. Anonymous/free responses have live fields removed, locked predictions redacted, and Player Picks 6–20 redacted before JSON reaches the browser.

## Architecture

```text
frontend/
  app/                         Next.js App Router pages and server routes
  components/                  Shared sport-neutral dashboard and cards
  lib/server/mlbModel.ts       MLB chronological replay/model
  lib/server/nflModel.ts       Separate NFL Elo + form replay/model
  lib/server/playerPicks.ts    MLB/NFL Player Picks ranking
  lib/server/marketOdds.ts     Optional live moneyline consensus
  lib/server/predictionSnapshots.ts  Immutable Supabase pregame writes
  lib/server/entitlements.ts   Free/Pro server-side redaction
  lib/supabase/                Cookie-aware and service-role clients
backend/
  app/services/                Existing MLB research pipeline
  app/services/nfl/            Leakage-safe NFL team/player pipelines
  scripts/build_nfl_dataset.py NFL dataset and training entrypoint
supabase/migrations/           Database, RLS, invite redemption, initial hashes
```

The production Next.js app is self-contained and continues to deploy on Vercel. The FastAPI backend is an offline/research pipeline and is not required by the deployed dashboard.

## Local development

Requirements: Node.js 22.13+ and npm.

```bash
cd frontend
npm install
copy .env.example .env.local
npm run dev
```

Open <http://localhost:3000>. With no external credentials the live MLB/NFL public-data experience still loads, while accounts, durable snapshots, billing, and sportsbook consensus show their safe unconfigured states.

Production checks:

```bash
cd frontend
npm run lint
npx tsc --noEmit
npm run build
```

## Environment variables

Copy `frontend/.env.example` to `frontend/.env.local`. Never commit the populated file.

| Variable | Required for | Visibility |
|---|---|---|
| `NEXT_PUBLIC_APP_URL` | Auth redirects and Stripe return URLs | Public |
| `CRON_SECRET` | Authorizes the daily model/picks refresh | Server secret |
| `NEXT_PUBLIC_SUPABASE_URL` | Accounts and database | Public |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Browser/server user session | Public |
| `SUPABASE_SERVICE_ROLE_KEY` | Webhooks and immutable snapshot writes | Server secret |
| `STRIPE_SECRET_KEY` | Checkout and customer portal | Server secret |
| `STRIPE_WEBHOOK_SECRET` | Signature verification | Server secret |
| `STRIPE_PRO_PRICE_ID` | $3.99/month recurring price | Server config |
| `THE_ODDS_API_KEY` | Live bookmaker consensus | Server secret, optional |
| `THE_ODDS_API_BASE_URL` | Odds provider base URL | Server config, optional |
| `ODDS_REGIONS` | Market region (default `us`) | Server config, optional |

## Daily model and picks refresh

`frontend/vercel.json` schedules `/api/cron/daily-refresh` every day at 09:05 UTC. The secured job replays completed results, refreshes current MLB/NFL state and player features, produces the latest Top 20 Player Picks, preserves immutable pregame snapshots, and records its status in `model_refresh_runs`. Set `CRON_SECRET` in Vercel so only the scheduler can invoke the route.

Sport IQ retrains the larger offline research models when a new validated historical dataset is published; the deployed inference state and current-player features update daily without mixing future results into earlier predictions.

## Supabase setup

1. Create a Supabase project.
2. Open the SQL Editor and run `supabase/migrations/202608160001_sport_iq_accounts_pro.sql`.
3. Copy the project URL, anon key, and service role key into local/Vercel environment variables.
4. In Authentication → URL Configuration, set the Site URL to the deployed URL and add `https://YOUR_DOMAIN/auth/callback` as a redirect URL.
5. Keep email confirmation enabled for production.

The migration creates profiles, favorite teams, saved predictions, immutable prediction snapshots, hashed promo codes, row-level security, and a security-definer redemption function. Users cannot update their own access tier.

## Stripe setup summary

Create one recurring monthly Stripe Price for **$3.99 USD**, then set its `price_...` value as `STRIPE_PRO_PRICE_ID`. Add a webhook endpoint at:

```text
https://YOUR_DOMAIN/api/webhooks/stripe
```

Subscribe it to `checkout.session.completed`, `customer.subscription.updated`, and `customer.subscription.deleted`. Put its `whsec_...` signing secret in `STRIPE_WEBHOOK_SECRET`. Detailed dashboard steps are included in the implementation handoff.

## Live odds

Set `THE_ODDS_API_KEY` to enable de-vigged consensus from available US moneyline books. The market layer is displayed separately from Sport IQ's model. Without a key, Pro still receives the clearly labeled score/clock/inning-based live win probability.

## NFL training pipeline

The runtime NFL model is a separate lightweight chronological Elo/form model. The full offline pipeline requires **20 complete seasons (2006–2025)** and reserves 2025 as the untouched chronological holdout. Normalize source data into:

- Team-game CSV: `game_id, season, week, gameday, team, opponent, home, won, points_for, points_against`; optional pass/rush yards, turnovers, sacks, third-down rate, red-zone rate, QB EPA, injuries, and weather columns are supported.
- Player-game CSV: `game_id, season, week, gameday, player_id, player_name, position, team, opponent`; include passing/rushing/receiving yards, touchdowns, interceptions, completions, attempts, targets, and receptions.

Run:

```bash
cd backend
pip install -r requirements.txt
python scripts/build_nfl_dataset.py \
  --team-games path/to/team_games.csv \
  --player-games path/to/player_games.csv \
  --start-season 2006 \
  --end-season 2025
```

The builder refuses to train when any of the 20 seasons is missing. It uses shifted rolling windows for recent form and season performance, shifted player-vs-opponent history, strength of schedule, rest, home/away splits, point differential, and head-to-head records. The latest season is held out chronologically. It writes calibrated win probabilities plus accuracy, Brier score, log loss, player-projection MAE, artifacts, and feature lists under `backend/models/nfl/`.

## MLB data refresh

The portable MLB snapshot is produced from completed seasons, with the current season replayed live:

```bash
python backend/scripts/build_recent_results_dataset.py --start-season 2006 --end-season 2025
```

## Data and trademarks

Schedules, scores, player statistics, team information, and probable pitchers come from public MLB and ESPN endpoints. Sports data and trademarks remain the property of their respective owners. Sport IQ is independent and uses original text-and-color identifiers. Predictions and player picks are informational—not betting advice.
