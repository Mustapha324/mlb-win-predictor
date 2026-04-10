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
from app.schemas.prediction import (
    LiveGamePredictionInputs,
    LiveTeamPregameStats,
    PredictionHistoryItem,
    TeamPrediction,
    TodayPredictionsResponse,
)

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

DEFAULT_TEAM_STATS = {
    "win_pct": 0.5,
    "runs_scored_per_game": 4.4,
    "runs_allowed_per_game": 4.4,
    "run_diff_per_game": 0.0,
    "last_10_win_pct": 0.5,
    "home_win_pct": 0.5,
    "away_win_pct": 0.5,
    "batting_avg": 0.245,
    "on_base_pct": 0.315,
    "slugging_pct": 0.390,
    "era": 4.10,
}

DEFAULT_PITCHER_STATS = {
    "era": 4.20,
    "whip": 1.30,
    "kbb": 2.50,
}


@lru_cache(maxsize=1)
def load_model():
    model_path = Path(settings.model_path)
    if not model_path.exists():
        return None
    return joblib.load(model_path)


def _to_float(value: Any, default: float) -> float:
    try:
        if value is None:
            return default
        return float(value)
    except (ValueError, TypeError):
        return default


def _safe_divide(numerator: float, denominator: float, default: float = 0.0) -> float:
    if not denominator:
        return default
    return numerator / denominator


def _normalize_ratio(value: float, lower: float, upper: float, default: float = 0.5) -> float:
    if upper <= lower:
        return default
    bounded = max(lower, min(upper, value))
    return (bounded - lower) / (upper - lower)


def _logistic(score: float, floor: float = 0.12, ceiling: float = 0.88) -> float:
    probability = 1.0 / (1.0 + math.exp(-score))
    return max(floor, min(ceiling, probability))


def _extract_split_win_pct(team_record: dict[str, Any], split_type: str, default: float = 0.5) -> float:
    split_records = team_record.get("records", {}).get("splitRecords", [])
    for split in split_records:
        if split.get("type") != split_type:
            continue

        wins = _to_float(split.get("wins"), 0.0)
        losses = _to_float(split.get("losses"), 0.0)
        total = wins + losses
        return _safe_divide(wins, total, default)

    return default


def fetch_todays_games(target_date: date) -> list[dict[str, Any]]:
    try:
        response = requests.get(
            f"{settings.mlb_stats_api_base}/schedule",
            params={
                "sportId": 1,
                "date": target_date.isoformat(),
                "hydrate": "probablePitcher,team",
            },
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
    return [game for game in games if game.get("status", {}).get("codedGameState") in upcoming_states]


def _resolve_probable_pitcher_name(probable_pitcher_payload: dict[str, Any]) -> str | None:
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

            wins = _to_float(team_record.get("wins"), 0.0)
            losses = _to_float(team_record.get("losses"), 0.0)
            games_played = wins + losses

            runs_scored = _to_float(team_record.get("runsScored"), 0.0)
            runs_allowed = _to_float(team_record.get("runsAllowed"), 0.0)

            win_pct = _to_float(team_record.get("winningPercentage"), 0.5)

            stats[int(team_id)] = {
                "win_pct": win_pct,
                "runs_scored_per_game": _safe_divide(runs_scored, games_played, DEFAULT_TEAM_STATS["runs_scored_per_game"]),
                "runs_allowed_per_game": _safe_divide(runs_allowed, games_played, DEFAULT_TEAM_STATS["runs_allowed_per_game"]),
                "run_diff_per_game": _safe_divide(runs_scored - runs_allowed, games_played, 0.0),
                "last_10_win_pct": _extract_split_win_pct(team_record, "lastTen", 0.5),
                "home_win_pct": _extract_split_win_pct(team_record, "home", 0.5),
                "away_win_pct": _extract_split_win_pct(team_record, "away", 0.5),
                "batting_avg": DEFAULT_TEAM_STATS["batting_avg"],
                "on_base_pct": DEFAULT_TEAM_STATS["on_base_pct"],
                "slugging_pct": DEFAULT_TEAM_STATS["slugging_pct"],
                "era": DEFAULT_TEAM_STATS["era"],
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
                team_rates[team_id_int]["batting_avg"] = _to_float(stat_block.get("avg"), DEFAULT_TEAM_STATS["batting_avg"])
                team_rates[team_id_int]["on_base_pct"] = _to_float(stat_block.get("obp"), DEFAULT_TEAM_STATS["on_base_pct"])
                team_rates[team_id_int]["slugging_pct"] = _to_float(stat_block.get("slg"), DEFAULT_TEAM_STATS["slugging_pct"])
            elif group_name == "pitching":
                team_rates[team_id_int]["era"] = _to_float(stat_block.get("era"), DEFAULT_TEAM_STATS["era"])

    return team_rates


def merge_team_stats(base_stats: dict[int, dict[str, float]], rates: dict[int, dict[str, float]]) -> dict[int, dict[str, float]]:
    merged: dict[int, dict[str, float]] = {}
    team_ids = set(base_stats) | set(rates)

    for team_id in team_ids:
        combined = dict(DEFAULT_TEAM_STATS)
        combined.update(base_stats.get(team_id, {}))
        combined.update(rates.get(team_id, {}))
        merged[team_id] = combined

    return merged


def fetch_probable_pitcher_stats(games: list[dict[str, Any]], game_date: date) -> dict[int, dict[str, float]]:
    pitcher_ids: set[int] = set()

    for game in games:
        teams = game.get("teams", {})
        for side in ("home", "away"):
            pitcher_payload = teams.get(side, {}).get("probablePitcher", {})
            pitcher_id = pitcher_payload.get("id")
            if isinstance(pitcher_id, int):
                pitcher_ids.add(pitcher_id)

    pitcher_stats: dict[int, dict[str, float]] = {}

    for pitcher_id in pitcher_ids:
        try:
            response = requests.get(
                f"{settings.mlb_stats_api_base}/people/{pitcher_id}/stats",
                params={
                    "stats": "season",
                    "group": "pitching",
                    "season": game_date.year,
                },
                timeout=10,
            )
            response.raise_for_status()
        except requests.RequestException:
            pitcher_stats[pitcher_id] = dict(DEFAULT_PITCHER_STATS)
            continue

        payload = response.json()
        if not isinstance(payload, dict):
            pitcher_stats[pitcher_id] = dict(DEFAULT_PITCHER_STATS)
            continue
        stats_list = payload.get("stats", [])
        if not stats_list:
            pitcher_stats[pitcher_id] = dict(DEFAULT_PITCHER_STATS)
            continue

        stat_block_wrapper = stats_list[0] if isinstance(stats_list[0], dict) else {}
        splits = stat_block_wrapper.get("splits", [])
        if not splits:
            pitcher_stats[pitcher_id] = dict(DEFAULT_PITCHER_STATS)
            continue

        stat_block = splits[0].get("stat", {}) if isinstance(splits[0], dict) else {}

        kbb_raw = stat_block.get("strikeoutWalkRatio")
        if kbb_raw in (None, ""):
            strikeouts = _to_float(stat_block.get("strikeOuts"), 0.0)
            walks = _to_float(stat_block.get("baseOnBalls"), 0.0)
            kbb_raw = _safe_divide(strikeouts, walks, DEFAULT_PITCHER_STATS["kbb"])

        pitcher_stats[pitcher_id] = {
            "era": _to_float(stat_block.get("era"), DEFAULT_PITCHER_STATS["era"]),
            "whip": _to_float(stat_block.get("whip"), DEFAULT_PITCHER_STATS["whip"]),
            "kbb": _to_float(kbb_raw, DEFAULT_PITCHER_STATS["kbb"]),
        }

    return pitcher_stats


def _team_stats_for(team_id: int | None, team_stats: dict[int, dict[str, float]]) -> dict[str, float]:
    if team_id is None:
        return dict(DEFAULT_TEAM_STATS)
    merged = dict(DEFAULT_TEAM_STATS)
    merged.update(team_stats.get(team_id, {}))
    return merged


def _pitcher_stats_for(pitcher_id: int | None, pitcher_stats: dict[int, dict[str, float]]) -> dict[str, float]:
    if pitcher_id is None:
        return dict(DEFAULT_PITCHER_STATS)
    merged = dict(DEFAULT_PITCHER_STATS)
    merged.update(pitcher_stats.get(pitcher_id, {}))
    return merged


def build_live_feature_snapshot(
    game: dict[str, Any],
    team_stats: dict[int, dict[str, float]],
    pitcher_stats: dict[int, dict[str, float]],
) -> dict[str, dict[str, float]]:
    teams = game.get("teams", {})

    home_payload = teams.get("home", {})
    away_payload = teams.get("away", {})

    home_team_id = home_payload.get("team", {}).get("id")
    away_team_id = away_payload.get("team", {}).get("id")

    home_pitcher_id = home_payload.get("probablePitcher", {}).get("id")
    away_pitcher_id = away_payload.get("probablePitcher", {}).get("id")

    home_team_stats = _team_stats_for(home_team_id, team_stats)
    away_team_stats = _team_stats_for(away_team_id, team_stats)
    home_pitcher_stats = _pitcher_stats_for(home_pitcher_id, pitcher_stats)
    away_pitcher_stats = _pitcher_stats_for(away_pitcher_id, pitcher_stats)

    home_snapshot = {
        **home_team_stats,
        "probable_pitcher_era": home_pitcher_stats["era"],
        "probable_pitcher_whip": home_pitcher_stats["whip"],
        "probable_pitcher_kbb": home_pitcher_stats["kbb"],
    }
    away_snapshot = {
        **away_team_stats,
        "probable_pitcher_era": away_pitcher_stats["era"],
        "probable_pitcher_whip": away_pitcher_stats["whip"],
        "probable_pitcher_kbb": away_pitcher_stats["kbb"],
    }

    return {"home": home_snapshot, "away": away_snapshot}


def build_features(
    game: dict[str, Any],
    team_stats: dict[int, dict[str, float]],
    pitcher_stats: dict[int, dict[str, float]],
) -> pd.DataFrame:
    snapshot = build_live_feature_snapshot(game, team_stats, pitcher_stats)
    home_stats = snapshot["home"]
    away_stats = snapshot["away"]

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
                "home_probable_pitcher_present": 1.0 if game.get("teams", {}).get("home", {}).get("probablePitcher") else 0.0,
                "away_probable_pitcher_present": 1.0 if game.get("teams", {}).get("away", {}).get("probablePitcher") else 0.0,
            }
        ]
    )[FEATURE_COLUMNS]


def weighted_home_probability(
    game: dict[str, Any],
    team_stats: dict[int, dict[str, float]],
    pitcher_stats: dict[int, dict[str, float]],
) -> float:
    snapshot = build_live_feature_snapshot(game, team_stats, pitcher_stats)
    home = snapshot["home"]
    away = snapshot["away"]

    win_pct_edge = home["win_pct"] - away["win_pct"]
    last_10_edge = home["last_10_win_pct"] - away["last_10_win_pct"]
    split_edge = home["home_win_pct"] - away["away_win_pct"]

    run_diff_edge = home["run_diff_per_game"] - away["run_diff_per_game"]
    matchup_run_edge = (home["runs_scored_per_game"] - away["runs_allowed_per_game"]) - (
        away["runs_scored_per_game"] - home["runs_allowed_per_game"]
    )

    batting_edge = home["batting_avg"] - away["batting_avg"]
    obp_edge = home["on_base_pct"] - away["on_base_pct"]
    slg_edge = home["slugging_pct"] - away["slugging_pct"]
    team_era_edge = away["era"] - home["era"]

    pitcher_era_edge = away["probable_pitcher_era"] - home["probable_pitcher_era"]
    pitcher_whip_edge = away["probable_pitcher_whip"] - home["probable_pitcher_whip"]
    pitcher_kbb_edge = home["probable_pitcher_kbb"] - away["probable_pitcher_kbb"]

    score = (
        2.25 * win_pct_edge
        + 1.25 * last_10_edge
        + 1.10 * split_edge
        + 0.80 * _normalize_ratio(run_diff_edge, -3.0, 3.0, 0.5)
        - 0.40
        + 0.72 * _normalize_ratio(matchup_run_edge, -4.0, 4.0, 0.5)
        - 0.36
        + 20.0 * batting_edge
        + 16.0 * obp_edge
        + 10.0 * slg_edge
        + 0.36 * team_era_edge
        + 0.42 * pitcher_era_edge
        + 0.32 * pitcher_whip_edge
        + 0.14 * pitcher_kbb_edge
        + 0.14
    )

    return _logistic(score)


def can_use_model(model: Any) -> bool:
    if model is None or not hasattr(model, "predict_proba"):
        return False
    expected = set(FEATURE_COLUMNS)
    model_features = set(getattr(model, "feature_names_in_", []))
    return model_features == expected


def _build_live_stats_payload(game_snapshot: dict[str, dict[str, float]]) -> LiveGamePredictionInputs:
    home_stats = game_snapshot["home"]
    away_stats = game_snapshot["away"]

    return LiveGamePredictionInputs(
        home=LiveTeamPregameStats(**home_stats),
        away=LiveTeamPregameStats(**away_stats),
    )


@router.get("/today", response_model=TodayPredictionsResponse)
def get_today_predictions() -> TodayPredictionsResponse:
    today = date.today()
    games = fetch_todays_games(today)
    model = load_model()

    standings_stats = fetch_team_pregame_stats(today)
    rate_stats = fetch_team_rate_stats(today)
    team_stats = merge_team_stats(standings_stats, rate_stats)
    probable_pitcher_stats = fetch_probable_pitcher_stats(games, today)
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

            live_snapshot = build_live_feature_snapshot(game, team_stats, probable_pitcher_stats)

            prediction_source = "live_weighted_stats_v2"
            home_prob = weighted_home_probability(game, team_stats, probable_pitcher_stats)
            if model_is_compatible:
                try:
                    features = build_features(game, team_stats, probable_pitcher_stats)
                    home_prob = float(model.predict_proba(features)[0][1])
                    prediction_source = "trained_model_live_features"
                except Exception:
                    home_prob = weighted_home_probability(game, team_stats, probable_pitcher_stats)
                    prediction_source = "live_weighted_stats_v2"

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
                predictionSource=prediction_source,
                live_stats_used=_build_live_stats_payload(live_snapshot),
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
                awayScore=5,
                homeScore=3,
                status="Final",
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
                awayScore=4,
                homeScore=2,
                status="Final",
            ),
        ]

    return [
        PredictionHistoryItem(
            gameId=row.game_id,
            date=row.game_date.isoformat(),
            awayTeam=row.away_team,
            homeTeam=row.home_team,
            predictedWinner=row.predicted_winner,
            actualWinner=row.actual_winner,
            homeWinProbability=row.home_win_probability,
            awayWinProbability=row.away_win_probability,
            wasCorrect=row.was_correct,
            awayScore=row.away_score,
            homeScore=row.home_score,
            status=row.status,
        )
        for row in rows
    ]
