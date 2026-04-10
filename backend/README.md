# Backend (FastAPI)

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
- save the model to `backend/models/logistic_regression.pkl`
- print accuracy, log loss, and Brier score
- store metrics at `backend/models/logistic_regression_metrics.json`
- store feature columns used at `backend/models/logistic_regression_features.json`
