# Diamond Dugout — MLB Win Predictor

Diamond Dugout is a production-ready MLB prediction dashboard. It combines a portable, chronologically trained baseball model with live schedule and probable-pitcher data from the public MLB Stats API.

## What changed

- Dark, responsive scoreboard-style interface with original team-color badges (no official club logos)
- Live daily slates, game status, probable pitchers, prediction factors, results history, and model details
- Self-contained web API routes, so the deployed app no longer depends on a backend running on `localhost`
- Reproducible five-season dataset: 12,171 completed regular-season games from 2021–2025
- Leakage-free Elo + live-form model with an untouched 2025 holdout
- Current-season chronological replay on every refresh, plus a small probable-pitcher adjustment
- Cloudflare Workers-compatible build and production hosting configuration

## Honest model performance

The portable model scores **56.4% accuracy** on 2,434 held-out 2025 games. The majority-class baseline (always choosing the home team) scores 54.3%. Baseball is noisy; these probabilities are context, not certainty or betting advice.

Signals include long-term Elo strength, season record, last-10 form, run differential, home/road splits, probable-starter ERA, and probable-starter WHIP. The model does not yet fully account for confirmed lineups, weather, injuries, or bullpen availability.

## Project layout

- `frontend/` — Vinext/React web app, API routes, live model replay, and Sites deployment files
- `backend/` — FastAPI/scikit-learn research backend and richer feature-engineering pipeline
- `backend/data/processed/recent_game_results.csv` — compact five-season source dataset
- `backend/scripts/build_recent_results_dataset.py` — reproducible dataset and portable model builder
- `frontend/data/model-snapshot.json` — versioned model coefficients, ratings, and holdout metrics

## Run locally

Requirements: Node.js 22.13+ and npm.

```bash
cd frontend
npm install
npm run dev
```

Open <http://localhost:3000>.

Production checks:

```bash
npm run lint
npm run build
npm run start
```

## Refresh the completed-season dataset

Run this after a season is complete. The end season must be earlier than the current year because current-season games are replayed live by the web app.

```bash
python backend/scripts/build_recent_results_dataset.py --start-season 2021 --end-season 2025
```

The script downloads one compact schedule payload per season, writes the CSV, tunes Elo parameters on a chronological validation season, trains the portable logistic layer, and evaluates the final model on the untouched last season.

## Optional research backend

The FastAPI backend remains available for experiments with richer team batting, pitching, and starter features.

```bash
cd backend
python -m venv .venv
# Windows: .venv\Scripts\activate
# macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

API documentation is available at <http://localhost:8000/docs>.

## Data and identity

Game results, schedules, team information, and probable pitchers come from the MLB Stats API. MLB data and trademarks remain the property of their respective owners. Diamond Dugout is independent and uses original text-and-color team badges rather than official logos.
