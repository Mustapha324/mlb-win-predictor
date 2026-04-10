"""Prediction routes exposed by the API."""

from datetime import date
from functools import lru_cache
from pathlib import Path

import joblib
import pandas as pd
import requests
from fastapi import APIRouter
from sqlalchemy import delete, select

from app.core.config import settings
from app.db.database import Base, SessionLocal, engine
from app.models.prediction import Prediction
from app.schemas.prediction import PredictionHistoryItem, TeamPrediction, TodayPredictionsResponse

router = APIRouter(prefix="/predictions", tags=["predictions"])

Base.metadata.create_all(bind=engine)

FEATURE_COLUMNS = [
    "home_team_win_pct_pre_game",
    "away_team_win_pct_pre_game",
    "home_team_last10_win_pct",
    "away_team_last10_win_pct",
    "home_team_run_diff_per_game",
    "away_team_run_diff_per_game",
]


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


def _extract_last10_win_pct(team_record: dict) -> float:
    for split in team_record.get("records", {}).get("splitRecords", []):
        if split.get("type") == "lastTen":
            wins = split.get("wins", 0)
            losses = split.get("losses", 0)
            total = wins + losses
            return (wins / total) if total else 0.5
    return 0.5


def fetch_team_pregame_stats() -> dict[int, dict[str, float]]:
    try:
        response = requests.get(
            f"{settings.mlb_stats_api_base}/standings",
            params={"leagueId": "103,104", "standingsTypes": "regularSeason"},
            timeout=10,
        )
        response.raise_for_status()
    except requests.RequestException:
        return {}

    stats: dict[int, dict[str, float]] = {}
    for record in response.json().get("records", []):
        for team_record in record.get("teamRecords", []):
            team_id = team_record.get("team", {}).get("id")
            if team_id is None:
                continue

            wins = team_record.get("wins", 0) or 0
            losses = team_record.get("losses", 0) or 0
            games_played = wins + losses

            runs_scored = team_record.get("runsScored", 0) or 0
            runs_allowed = team_record.get("runsAllowed", 0) or 0

            win_pct = float(team_record.get("winningPercentage") or 0.5)
            last10_win_pct = _extract_last10_win_pct(team_record)
            run_diff_per_game = ((runs_scored - runs_allowed) / games_played) if games_played else 0.0

            stats[int(team_id)] = {
                "win_pct": win_pct,
                "last10_win_pct": float(last10_win_pct),
                "run_diff_per_game": float(run_diff_per_game),
            }

    return stats


def build_features(game: dict, team_stats: dict[int, dict[str, float]]) -> pd.DataFrame:
    home = game.get("teams", {}).get("home", {}).get("team", {})
    away = game.get("teams", {}).get("away", {}).get("team", {})

    home_id = int(home.get("id", 0) or 0)
    away_id = int(away.get("id", 0) or 0)

    home_stats = team_stats.get(home_id, {"win_pct": 0.5, "last10_win_pct": 0.5, "run_diff_per_game": 0.0})
    away_stats = team_stats.get(away_id, {"win_pct": 0.5, "last10_win_pct": 0.5, "run_diff_per_game": 0.0})

    return pd.DataFrame(
        [
            {
                "home_team_win_pct_pre_game": home_stats["win_pct"],
                "away_team_win_pct_pre_game": away_stats["win_pct"],
                "home_team_last10_win_pct": home_stats["last10_win_pct"],
                "away_team_last10_win_pct": away_stats["last10_win_pct"],
                "home_team_run_diff_per_game": home_stats["run_diff_per_game"],
                "away_team_run_diff_per_game": away_stats["run_diff_per_game"],
            }
        ]
    )[FEATURE_COLUMNS]


def placeholder_home_probability(game: dict, team_stats: dict[int, dict[str, float]]) -> float:
    """Intermediate fallback based on standings win percentage.

    TODO(model-serving): replace this fallback once the production feature
    pipeline is implemented and we can always call model.predict_proba with
    fully aligned training features.
    """

    teams = game.get("teams", {})
    home_id = teams.get("home", {}).get("team", {}).get("id")
    away_id = teams.get("away", {}).get("team", {}).get("id")

    home_pct = team_stats.get(home_id, {}).get("win_pct", 0.5)
    away_pct = team_stats.get(away_id, {}).get("win_pct", 0.5)
    total = home_pct + away_pct

    if total <= 0:
        return 0.5

    return home_pct / total


@router.get("/today", response_model=TodayPredictionsResponse)
def get_today_predictions() -> TodayPredictionsResponse:
    today = date.today()
    games = fetch_todays_games(today)
    model = load_model()
    team_stats = fetch_team_pregame_stats()

    predictions: list[TeamPrediction] = []

    with SessionLocal() as session:
        session.execute(delete(Prediction).where(Prediction.game_date == today))

        for game in games:
            game_pk = game.get("gamePk")
            teams = game.get("teams", {})
            home_team = teams.get("home", {}).get("team", {}).get("name", "Unknown Home Team")
            away_team = teams.get("away", {}).get("team", {}).get("name", "Unknown Away Team")

            prediction_source = "placeholder"
            home_prob = placeholder_home_probability(game, team_stats)
            if model is not None:
                try:
                    # TODO(model-serving): keep this as the primary path once we
                    # guarantee training/serving feature parity across the stack.
                    features = build_features(game, team_stats)
                    home_prob = float(model.predict_proba(features)[0][1])
                    prediction_source = "model"
                except Exception:
                    home_prob = placeholder_home_probability(game, team_stats)
                    prediction_source = "placeholder"

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
                prediction_source=prediction_source,
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


@router.get("/history", response_model=list[PredictionHistoryItem])
def get_prediction_history() -> list[PredictionHistoryItem]:
    with SessionLocal() as session:
        rows = (
            session.execute(
                select(Prediction).order_by(Prediction.game_date.desc(), Prediction.id.desc()).limit(100)
            )
            .scalars()
            .all()
        )

    if not rows:
        return [
            PredictionHistoryItem(
                gameId="mock-game-001",
                date="2026-04-08",
                awayTeam="New York Yankees",
                homeTeam="Boston Red Sox",
                predictedWinner="New York Yankees",
                actualWinner="Boston Red Sox",
                homeWinProbability=0.44,
                awayWinProbability=0.56,
                wasCorrect=False,
            ),
            PredictionHistoryItem(
                gameId="mock-game-002",
                date="2026-04-07",
                awayTeam="Los Angeles Dodgers",
                homeTeam="San Diego Padres",
                predictedWinner="Los Angeles Dodgers",
                actualWinner="Los Angeles Dodgers",
                homeWinProbability=0.45,
                awayWinProbability=0.55,
                wasCorrect=True,
            ),
        ]

    return [
        PredictionHistoryItem(
            gameId=row.game_id,
            date=row.game_date.isoformat(),
            awayTeam=row.away_team,
            homeTeam=row.home_team,
            predictedWinner=row.predicted_winner,
            actualWinner=None,
            homeWinProbability=row.home_win_probability,
            awayWinProbability=row.away_win_probability,
            wasCorrect=None,
        )
        for row in rows
    ]
