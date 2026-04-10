"""Prediction routes exposed by the API."""

from datetime import date
from functools import lru_cache
from pathlib import Path
from typing import Any

import joblib
import math
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
    "home_team_run_diff_per_game",
    "away_team_run_diff_per_game",
    "home_team_batting_avg",
    "away_team_batting_avg",
    "home_team_era",
    "away_team_era",
    "home_field_advantage",
    "home_probable_pitcher_present",
    "away_probable_pitcher_present",
]


@lru_cache(maxsize=1)
def load_model():
    model_path = Path(settings.model_path)
    if not model_path.exists():
        return None
    return joblib.load(model_path)


def _to_float(value, default):
    try:
        if value is None:
            return default
        return float(value)
    except (ValueError, TypeError):
        return default


def fetch_todays_games(target_date: date) -> list[dict]:
    try:
        response = requests.get(
            f"{settings.mlb_stats_api_base}/schedule",
            params={"sportId": 1, "date": target_date.isoformat(), "hydrate": "probablePitcher,team"},
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


def _resolve_probable_pitcher_name(probable_pitcher_payload: dict) -> str | None:
    full_name = probable_pitcher_payload.get("fullName") or probable_pitcher_payload.get("name")
    if full_name:
        return full_name

    pitcher_id = probable_pitcher_payload.get("id")
    if not isinstance(pitcher_id, int):
        return None

    try:
        response = requests.get(
            f"{settings.mlb_stats_api_base}/people/{pitcher_id}",
            timeout=10,
        )
        response.raise_for_status()
    except requests.RequestException:
        return None

    people = response.json().get("people", [])
    if not people:
        return None

    person = people[0]
    return person.get("fullName") or person.get("fullFMLName") or person.get("name")


def _extract_last10_win_pct(team_record: dict) -> float:
    for split in team_record.get("records", {}).get("splitRecords", []):
        if split.get("type") == "lastTen":
            wins = split.get("wins", 0)
            losses = split.get("losses", 0)
            total = wins + losses
            return (wins / total) if total else 0.5
    return 0.5


def fetch_team_pregame_stats(game_date: date) -> dict[int, dict[str, float]]:
    try:
        response = requests.get(
            f"{settings.mlb_stats_api_base}/standings",
            params={
                "leagueId": "103,104",
                "standingsTypes": "regularSeason",
                "date": game_date.isoformat(),
            },
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

            win_pct = _to_float(team_record.get("winningPercentage"), 0.5)
            run_diff_per_game = ((runs_scored - runs_allowed) / games_played) if games_played else 0.0

            stats[int(team_id)] = {
                "win_pct": win_pct,
                "run_diff_per_game": float(run_diff_per_game),
                "runs_scored_per_game": (runs_scored / games_played) if games_played else 4.0,
                "runs_allowed_per_game": (runs_allowed / games_played) if games_played else 4.0,
                "batting_avg": 0.245,
                "era": 4.10,
            }

    return stats


def fetch_team_rate_stats(game_date: date) -> dict[int, dict[str, float]]:
    try:
        response = requests.get(
            f"{settings.mlb_stats_api_base}/teams/stats",
            params={
                "sportId": 1,
                "season": game_date.year,
                "stats": "season",
                "group": "hitting,pitching",
                "date": game_date.isoformat(),
            },
            timeout=10,
        )
        response.raise_for_status()
    except requests.RequestException:
        return {}

    team_rates: dict[int, dict[str, float]] = {}
    for stats_set in response.json().get("stats", []):
        group_name = (stats_set.get("group") or {}).get("displayName", "").lower()
        for split in stats_set.get("splits", []):
            team_id = split.get("team", {}).get("id")
            if team_id is None:
                continue
            team_id_int = int(team_id)
            team_rates.setdefault(team_id_int, {})
            stat_block = split.get("stat", {})

            if group_name == "hitting":
                team_rates[team_id_int]["batting_avg"] = _to_float(stat_block.get("avg"), 0.245)
            elif group_name == "pitching":
                team_rates[team_id_int]["era"] = _to_float(stat_block.get("era"), 4.10)

    return team_rates


def merge_team_stats(base_stats: dict[int, dict[str, float]], rates: dict[int, dict[str, float]]) -> dict[int, dict[str, float]]:
    merged = dict(base_stats)
    for team_id, rate_values in rates.items():
        existing = merged.get(
            team_id,
            {
                "win_pct": 0.5,
                "run_diff_per_game": 0.0,
                "runs_scored_per_game": 4.0,
                "runs_allowed_per_game": 4.0,
                "batting_avg": 0.245,
                "era": 4.10,
            },
        )
        existing.update(rate_values)
        merged[team_id] = existing
    return merged


def probable_pitcher_name(game: dict, side: str) -> str | None:
    return game.get("teams", {}).get(side, {}).get("probablePitcher", {}).get("fullName")


def build_features(game: dict, team_stats: dict[int, dict[str, float]]) -> pd.DataFrame:
    home = game.get("teams", {}).get("home", {}).get("team", {})
    away = game.get("teams", {}).get("away", {}).get("team", {})

    home_id = int(home.get("id", 0) or 0)
    away_id = int(away.get("id", 0) or 0)

    home_stats = team_stats.get(
        home_id,
        {"win_pct": 0.5, "run_diff_per_game": 0.0, "batting_avg": 0.245, "era": 4.10},
    )
    away_stats = team_stats.get(
        away_id,
        {"win_pct": 0.5, "run_diff_per_game": 0.0, "batting_avg": 0.245, "era": 4.10},
    )

    return pd.DataFrame(
        [
            {
                "home_team_win_pct_pre_game": home_stats["win_pct"],
                "away_team_win_pct_pre_game": away_stats["win_pct"],
                "home_team_run_diff_per_game": home_stats["run_diff_per_game"],
                "away_team_run_diff_per_game": away_stats["run_diff_per_game"],
                "home_team_batting_avg": home_stats["batting_avg"],
                "away_team_batting_avg": away_stats["batting_avg"],
                "home_team_era": home_stats["era"],
                "away_team_era": away_stats["era"],
                "home_field_advantage": 1.0,
                "home_probable_pitcher_present": 1.0 if probable_pitcher_name(game, "home") else 0.0,
                "away_probable_pitcher_present": 1.0 if probable_pitcher_name(game, "away") else 0.0,
            }
        ]
    )[FEATURE_COLUMNS]


def weighted_home_probability(game: dict, team_stats: dict[int, dict[str, float]]) -> float:
    teams = game.get("teams", {})
    home_id = teams.get("home", {}).get("team", {}).get("id")
    away_id = teams.get("away", {}).get("team", {}).get("id")

    home_stats = team_stats.get(home_id, {})
    away_stats = team_stats.get(away_id, {})

    home_win_pct = home_stats.get("win_pct", 0.5)
    away_win_pct = away_stats.get("win_pct", 0.5)
    home_run_diff = home_stats.get("run_diff_per_game", 0.0)
    away_run_diff = away_stats.get("run_diff_per_game", 0.0)
    home_ba = home_stats.get("batting_avg", 0.245)
    away_ba = away_stats.get("batting_avg", 0.245)
    home_era = home_stats.get("era", 4.10)
    away_era = away_stats.get("era", 4.10)

    has_home_pitcher = 1.0 if probable_pitcher_name(game, "home") else 0.0
    has_away_pitcher = 1.0 if probable_pitcher_name(game, "away") else 0.0

    score = (
        2.6 * (home_win_pct - away_win_pct)
        + 0.45 * (home_run_diff - away_run_diff)
        + 24.0 * (home_ba - away_ba)
        - 0.35 * (home_era - away_era)
        + 0.16  # home field advantage
        + 0.05 * (has_home_pitcher - has_away_pitcher)
    )

    probability = 1.0 / (1.0 + math.exp(-score))
    return max(0.15, min(0.85, probability))


def can_use_model(model: Any) -> bool:
    if model is None or not hasattr(model, "predict_proba"):
        return False
    expected = set(FEATURE_COLUMNS)
    model_features = set(getattr(model, "feature_names_in_", []))
    return model_features == expected


@router.get("/today", response_model=TodayPredictionsResponse)
def get_today_predictions() -> TodayPredictionsResponse:
    today = date.today()
    games = fetch_todays_games(today)
    model = load_model()
    standings_stats = fetch_team_pregame_stats(today)
    rate_stats = fetch_team_rate_stats(today)
    team_stats = merge_team_stats(standings_stats, rate_stats)
    model_is_compatible = can_use_model(model)

    predictions: list[TeamPrediction] = []

    with SessionLocal() as session:
        session.execute(delete(Prediction).where(Prediction.game_date == today))

        for game in games:
            game_pk = game.get("gamePk")
            teams = game.get("teams", {})
            home_team_data = teams.get("home", {})
            away_team_data = teams.get("away", {})
            home_team = home_team_data.get("team", {}).get("name", "Unknown Home Team")
            away_team = away_team_data.get("team", {}).get("name", "Unknown Away Team")
            away_probable_pitcher = _resolve_probable_pitcher_name(away_team_data.get("probablePitcher", {}))
            home_probable_pitcher = _resolve_probable_pitcher_name(home_team_data.get("probablePitcher", {}))

            prediction_source = "live_weighted_stats"
            home_prob = weighted_home_probability(game, team_stats)
            if model_is_compatible:
                try:
                    features = build_features(game, team_stats)
                    home_prob = float(model.predict_proba(features)[0][1])
                    prediction_source = "trained_model"
                except Exception:
                    home_prob = weighted_home_probability(game, team_stats)
                    prediction_source = "live_weighted_stats"

            home_prob = max(0.0, min(1.0, home_prob))
            away_prob = 1.0 - home_prob
            predicted_winner = home_team if home_prob >= away_prob else away_team

            prediction = TeamPrediction(
                game_id=str(game_pk),
                home_team=home_team,
                away_team=away_team,
                game_time_utc=game.get("gameDate"),
                away_probable_pitcher=away_probable_pitcher,
                home_probable_pitcher=home_probable_pitcher,
                awayProbablePitcher=away_probable_pitcher,
                homeProbablePitcher=home_probable_pitcher,
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
