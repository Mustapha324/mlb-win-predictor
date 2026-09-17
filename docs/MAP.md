# MAP — SportIQ
<!-- refreshed: 2026-09-16 | baseline: c2825f5 + free/social completion -->
<!-- trust: orientation only — verify targets with a live read before editing -->
<!-- staleness: compare against the current tree after >30 days, >50 commits, or changes to unmapped directories -->

## Product boundary

The deployed product is `frontend/`, a self-contained Next.js 16 App Router app on Vercel. All MLB/NFL predictions, player picks, live information, explanations and results are public. Supabase accounts enable personal picks and social features. `backend/` is offline Python research/training, never imported by the product.

## Routes and UI

- `/`, `/nfl` → `components/Dashboard.tsx`: public slates, player picks and game cards.
- `/games/[id]`, `/nfl/games/[id]` → `GameDetailsView.tsx`; both details and `GameCard.tsx` include `social/UserPickControls.tsx`.
- `/player-picks`, `/history`, `/nfl/history`, `/metrics`, `/nfl/metrics`, `/model`: public boards/results/methodology.
- `/profile`, `/profile/[username]`, `/my-picks`, `/my-stats`, `/friends`, `/leaderboard` → `components/social/`.
- `/account` contains optional sign-in/up. `lib/authNavigation.ts` restricts post-login destinations to local paths; `proxy.ts` refreshes cookies.
- `/pro` and `/pro/success` only redirect old bookmarks. Checkout, billing, webhook and subscription code are retired.

## Domain map (paths relative to frontend/)

| Area | Files | Constraints |
| --- | --- | --- |
| MLB model | `lib/server/mlbModel.ts`, `data/model-snapshot.json` | Chronological replay; coefficients and holdout preserved |
| NFL model | `lib/server/nflModel.ts`, `data/nfl-model-v2.json` | Season-entry checkpoint trained only on earlier seasons |
| Served probabilities | `lib/servingPolicy.ts`, `lib/marketMath.ts` | Lab-derived 25/75 model/market logit blend when a quote exists |
| Sportsbook feeds | `lib/server/espnScoreboard.ts`, `sportsbookProps.ts`, `marketOdds.ts` | Distinguish captured market lines from model estimates |
| Player picks | `lib/server/playerPicks.ts`, `playerPickScoring.ts`, `pickEligibility.ts`, `nflRoster.ts` | Preserve real-line/live-tracking logic and historical TD alias |
| Player persistence | `lib/server/playerPickStore.ts` | Supabase optional; fail safely without admin credentials |
| Game Brain | `lib/server/brain/`, `/api/game-brain` | Shadow explanation endpoint; weights require backtests |
| Model snapshots | `lib/server/predictionSnapshots.ts` | Insert-only upsert; finals update result columns only |
| Social operations | `lib/server/social.ts`, `/api/social` | Verified actor; authoritative server game lookup before picks |
| Shared social types | `lib/social.ts`, `lib/socialClient.ts` | Explicit public DTOs; shared deadline clock in UI |
| Supabase | `lib/supabase/server.ts`, `admin.ts` | Admin key read/validated only in `admin.ts` |
| Refresh | `/api/cron/daily-refresh`, `lib/server/modelRefresh.ts` | CRON_SECRET required; grades player and user picks |

## Social database

Run `supabase/migrations/` in timestamp order. `202609140001_free_social_platform.sql` adds:

- `social_profiles`: random default usernames for existing/new accounts, editable identity/team preferences; no email/billing fields.
- `social_games`: authoritative game identity/start/status and registered model call.
- `user_picks`: unique user/sport/game selection, immutable model snapshot and independent tail attribution.
- `friendships`: canonical pair uniqueness, recipient-only acceptance/decline, participant removal.
- `social_stats`: cached aggregates refreshed after writes/grading; leaderboards require 20 decisive grades.

RLS is enabled; browser roles have no direct social-table access. Narrow security-definer RPCs return explicit public fields. `social_write` permits authenticated profile/friend actions; pick mutations require service role and an actor from server-verified auth. SQL locks the game row and checks `clock_timestamp()` before creating/updating/deleting a pick. Rescheduling later cannot reopen a deadline. Postponements void existing picks; missing results stay pending for retry.

Owners/accepted friends see pregame picks. Other viewers see locked picks; community consensus counts locked picks. Tails do not follow source changes. Historical account/billing tables remain; invite-redemption execution is revoked.

The follow-up `202609160001_social_profile_defaults.sql` creates/backfills safe default profiles and requires authentication for the private My Picks view. Apply it even if the original social migration is already installed.

`202609160002_social_tail_identity_and_cache.sql` groups tail records by stable internal identity and resolves current public names without exposing account IDs. Deleted sources retain an unlinked historical label. Already graded finals do not rebuild cached statistics.

## Scheduled work and verification

- `frontend/vercel.json`: daily refresh at 09:05 UTC. Social grading rotates up to 50 pending started games per sport regardless of age; failed results remain pending.
- `.github/workflows/live-capture.yml`: public pregame capture every two hours; data commits only on `live-snapshots`.
- `frontend/tests/*.test.mjs`: domain/API tests plus isolated PostgreSQL migration/RLS/locking/grading tests using PGlite.
- `frontend/tests/browser/`: Playwright UI contract tests with mocked social responses. Hosted auth/email delivery still requires staging verification.
- `backend/tests/`: dependency-free chronology/holdout/metrics safeguards.
- Full gate: `npm test`, `npm run lint`, `npx tsc --noEmit`, `npm run build`. Model changes additionally require backtests and the append-only experiment ledger.

## Publication and generated files

`frontend/.env.example` contains safe defaults. Missing accounts/odds keys must leave public predictions usable. Keep local env files and legacy `frontend/dist/`/`.wrangler/` out of Git. Historical credential exposure is documented in `docs/open-source-transition.md`; removal from HEAD is not history cleanup.

Do not hand-edit model artifacts, backtest HTML/JSON, Next-generated `frontend/AGENTS.md`, `next-env.d.ts`, or build caches. See root `AGENTS.md`, `README.md`, and `CONTRIBUTING.md` for protocols.
