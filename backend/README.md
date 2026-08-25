# Sport IQ research backend (FastAPI)

## Run locally

1. Create and activate a virtual environment:
   - macOS/Linux: `python -m venv .venv && source .venv/bin/activate`
   - Windows (PowerShell): `python -m venv .venv; .venv\\Scripts\\Activate.ps1`
2. Install dependencies: `pip install -r requirements.txt`
3. Start server: `uvicorn app.main:app --reload`
4. Open API docs: <http://localhost:8000/docs>

## Train the baseline logistic regression model

Run from the `backend` directory:

```bash
cd backend
python -m app.services.training_pipeline
```

This will:
- build a historical one-row-per-game dataset at `backend/data/processed/historical_games.csv`
- train a `LogisticRegression` model with richer pregame features (team form, splits, run production/prevention, batting/pitching rates, probable-pitcher ERA/WHIP, and home-field indicator)
- calibrate probabilities (isotonic when enough training rows, otherwise Platt/sigmoid)
- save the calibrated model to `backend/models/logistic_regression.pkl`
- print accuracy, log loss, and Brier score
- store metrics at `backend/models/logistic_regression_metrics.json`
- store feature columns used at `backend/models/logistic_regression_features.json`

## Daily retraining after results update

When `POST /api/results/update` finalizes completed games, the backend now:
1. appends newly completed games into `backend/data/processed/historical_games.csv`
2. retrains the baseline model on the expanded dataset
3. persists:
   - model artifact
   - feature column list
   - evaluation metrics (including calibration-aware metrics)
   - `last_trained_at` timestamp

You can also run retraining manually from `backend/`:

```bash
python -c "from datetime import date; from app.services.training_pipeline import run_training_pipeline; print(run_training_pipeline(start_date=date(2026,4,10), end_date=date(2026,4,10)))"
```

## NFL team and player models

NFL is kept separate from MLB under `app/services/nfl/`. The dataset builder creates shifted, pregame-only rolling features for team form, scoring, passing/rushing, turnovers, sacks, third-down/red-zone rates, rest, strength of schedule, home/away performance, QB EPA, and head-to-head history. Player features include recent and career-vs-opponent passing, rushing, receiving, touchdown, interception, completion, target, and reception history.

```bash
python scripts/build_nfl_dataset.py --team-games path/to/team_games.csv --player-games path/to/player_games.csv --start-season 2011 --end-season 2025
```

At least 15 complete seasons are required; the builder stops if either source is missing a season. The newest season is reserved as a chronological holdout. Game outputs include calibrated accuracy, Brier score, and log loss; player projection outputs include per-market MAE.

The production Next.js model uses a compact, versioned artifact generated from the public nflverse schedule/results file. Regenerate it after each completed season with:

```bash
python scripts/train_nfl_history.py --end-season 2025 --seasons 15
```

The artifact stores only learned coefficients, season-entry franchise ratings, training metadata, and holdout metrics—never raw provider credentials.
