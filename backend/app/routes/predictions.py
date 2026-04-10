from datetime import date
from functools import lru_cache
from pathlib import Path

import joblib
import numpy as np
import requests
from fastapi import APIRouter
from sqlalchemy import delete

from app.core.config import settings
from app.db.database import Base, SessionLocal, engine
from app.models.prediction import Prediction
from app.schemas.prediction import TeamPrediction, TodayPredictionsResponse
from app.services.mlb import fetch_upcoming_games_for_date

router = APIRouter(prefix="/predictions", tags=["predictions"])

Base.metadata.create_all(bind=engine)


@lru_cache(maxsize=1)
def load_model():
    model_path = Path(settings.model_path)
    if not model_path.exists():
        return None
    return joblib.load(model_path)


def fetch_todays_games(target_date: date) -> list[dict]:
    try:
        response = requests.get(
            f"{settings.mlb_stats_api_base}/schedule",
            params={"sportId": 1, "date": target_date.isoformat()},
            timeout=10,
        )
        response.raise_for_status()
    except requests.RequestException:
        return []

    payload = response.json()
    dates = payload.get("dates", [])
    if not dates:
        return []

    games = dates[0].get("games", [])
    upcoming_states = {"S", "P", "PW"}
    return [
        game
        for game in games
        if game.get("status", {}).get("codedGameState") in upcoming_states
    ]


def fetch_team_win_pct() -> dict[int, float]:
    try:
        response = requests.get(
            f"{settings.mlb_stats_api_base}/standings",
            params={"leagueId": "103,104", "standingsTypes": "regularSeason"},
            timeout=10,
        )
        response.raise_for_status()
    except requests.RequestException:
        return {}

    records = response.json().get("records", [])
    win_pct: dict[int, float] = {}
    for record in records:
        for team_record in record.get("teamRecords", []):
            team = team_record.get("team", {})
            team_id = team.get("id")
            pct = team_record.get("winningPercentage")
            if team_id is None:
                continue
            try:
                win_pct[team_id] = float(pct)
            except (TypeError, ValueError):
                win_pct[team_id] = 0.5
    return win_pct


def build_features(model, game: dict, team_win_pct: dict[int, float]) -> np.ndarray:
    home = game.get("teams", {}).get("home", {}).get("team", {})
    away = game.get("teams", {}).get("away", {}).get("team", {})

    home_id = home.get("id", 0)
    away_id = away.get("id", 0)
    home_pct = team_win_pct.get(home_id, 0.5)
    away_pct = team_win_pct.get(away_id, 0.5)

    context = {
        "home_team_id": float(home_id),
        "away_team_id": float(away_id),
        "home_win_pct": home_pct,
        "away_win_pct": away_pct,
        "win_pct_diff": home_pct - away_pct,
        "home_advantage": 1.0,
    }

    feature_names = list(getattr(model, "feature_names_in_", []))
    n_features = int(getattr(model, "n_features_in_", len(feature_names) or 1))

    if feature_names:
        values = [float(context.get(name, 0.0)) for name in feature_names]
        return np.array([values], dtype=float)

    fallback = [0.0] * n_features
    for idx, key in enumerate(["home_win_pct", "away_win_pct", "win_pct_diff", "home_advantage"]):
        if idx < n_features:
            fallback[idx] = context[key]
    return np.array([fallback], dtype=float)


@router.get("/today", response_model=TodayPredictionsResponse)
def get_today_predictions() -> TodayPredictionsResponse:
    today = date.today()
    games = fetch_todays_games(today)
    model = load_model()
    team_win_pct = fetch_team_win_pct()

    predictions: list[TeamPrediction] = []

    with SessionLocal() as session:
        session.execute(delete(Prediction).where(Prediction.game_date == today))

        for game in games:
            game_pk = game.get("gamePk")
            teams = game.get("teams", {})
            home_team = teams.get("home", {}).get("team", {}).get("name", "Unknown Home Team")
            away_team = teams.get("away", {}).get("team", {}).get("name", "Unknown Away Team")

            home_prob = 0.5
            if model is not None:
                try:
                    features = build_features(model, game, team_win_pct)
                    home_prob = float(model.predict_proba(features)[0][1])
                except Exception:
                    home_prob = 0.5

            home_prob = max(0.0, min(1.0, home_prob))
            away_prob = 1.0 - home_prob
            predicted_winner = home_team if home_prob >= away_prob else away_team

            prediction = TeamPrediction(
                game_id=str(game_pk),
                home_team=home_team,
                away_team=away_team,
                predicted_winner=predicted_winner,
                home_win_probability=home_prob,
                away_win_probability=away_prob,
            )
            predictions.append(prediction)

            session.add(
                Prediction(
                    game_id=prediction.game_id,
                    game_date=today,
                    home_team=home_team,
                    away_team=away_team,
                    predicted_winner=predicted_winner,
                    home_win_probability=home_prob,
                    away_win_probability=away_prob,
                )
            )

        session.commit()

    return TodayPredictionsResponse(date=today.isoformat(), predictions=predictions)
