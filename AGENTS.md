# AGENTS.md — mlb-win-predictor (Sport IQ)

Rules for any agent or human working in this repo. **Orientation: read docs/MAP.md first** — it routes you to the right area in ~2k tokens; honor its staleness header and verify targets with a live read before editing.

## Repo facts

- The deployed product is `frontend/` (Next.js 16 App Router on Vercel), and it is self-contained. `backend/` (FastAPI + scikit-learn) is offline research/training — never imported by the product, never deployed.
- This is Mustapha324's repo; collaborators contribute via branches and PRs to `main`. The `codex/*` branches are Mustapha's agent lanes — never push to them.
- Data written by the live-capture GitHub Action lands only on the `live-snapshots` branch. Code branches never receive data commits.

## Commands (from `frontend/`, Node >= 22.13)

- `npm run dev` — local app at :3000; the public-data experience works with zero keys configured
- `npm test` — node:test suites in tests/*.test.mjs
- `npm run lint` && `npx tsc --noEmit` && `npm run build` — the pre-PR gate; all three must be green
- `npm run backtest` — walk-forward brain backtest (required evidence for model changes)
- `npm run capture` — one live pregame capture, locally

Backend research (from `backend/`, in a venv): `uvicorn app.main:app --reload`; `python -m app.services.training_pipeline`; `python scripts/train_nfl_history.py --end-season <yr> --seasons 15` regenerates `frontend/data/nfl-model-v2.json`.

## Definition of done (prove-it-works)

- "The build passed" is not evidence. Match proof to the change: UI/route work → walk the flow against `npm run dev` and read the JSON back; logic → tests; model work → backtest numbers.
- Run the full pre-PR gate (test, lint, tsc, build) before claiming done — run, not assumed.
- Report numbers and failures verbatim. A hedged claim ("should work") means unverified — say unverified instead.

## Model & brain changes (the house protocol)

- Chronology is sacred: no future information may leak into earlier predictions — pregame-only features, shifted windows, frozen holdouts.
- Every factor or weight change goes through the lab: `npm run backtest` against the in-config baseline, holdout non-degradation required, decision appended to `docs/backtests/experiments.md`. That ledger is append-only history — rejected ideas stay recorded so they aren't retried.
- `DEFAULT_BRAIN_WEIGHTS` in brainScoring.ts are tuner output — never hand-tweak them inside a feature PR.
- Grading compatibility: the "Anytime touchdown" → "Rush+Rec TDs" alias in playerPicks.ts must survive while pre-rename rows exist in Supabase.

## Entitlement & security invariants

- Free/Pro redaction happens server-side (entitlements.ts, playerPickAccess.ts) before JSON leaves a route. Never move gating, live fields, or the premium Top 5 into client code.
- Pregame snapshots are write-once (`ignoreDuplicates` upsert in predictionSnapshots.ts); the finals pass may update only the final-result columns. Never widen either.
- The Supabase service-role key is read only in `lib/supabase/admin.ts`; new admin operations import that client rather than reading the env var.
- Modules under `lib/server/` start with `import "server-only"` — new ones do too.
- Tier changes flow only through the Stripe webhook or the invite-redemption SQL function; RLS lets users update `display_name` and nothing else.

## Env & secrets

- The variable list lives in `frontend/.env.example`. Every key is optional at dev time — absent keys must degrade to labeled safe states, never crash.
- Never commit a populated `.env.local`. Known debt: one is currently tracked on main — treat its values as compromised, do not add to it; untracking + rotation is a pending chore.
- DFS board fetches cost paid Odds-API credits per event: `DFS_BOARDS=off` is the kill switch, `DFS_BOARD_MAX_EVENTS` the throttle.

## Generated files — never hand-edit

`frontend/AGENTS.md` (the Next.js dev server rewrites its block), `next-env.d.ts`, `tsconfig.tsbuildinfo`, `frontend/dist/` + `frontend/.wrangler/` (legacy committed build experiment), `frontend/data/*.json` (backend training output), `docs/backtests/*.html` + `*.json` (backtest output).

## Git etiquette

- Branch from `main`, PR to `main`. Keep diffs scoped to the change — no drive-by reformatting.
- Never commit `.claude/`, `node_modules/`, or local env files; never rewrite someone else's branch.
