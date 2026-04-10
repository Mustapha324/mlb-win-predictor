import requests
from fastapi import APIRouter, HTTPException
from sqlalchemy import select

from app.core.config import settings
from app.db.database import SessionLocal
from app.models.prediction import Prediction
from app.schemas.game import ActualResult, GamePredictionDetail, PredictedProbabilities, ProbablePitchers, Teams

router = APIRouter(prefix="/games", tags=["games"])


MOCK_GAMES: dict[str, GamePredictionDetail] = {
    "20260410-nyy-bos": GamePredictionDetail(
        game_id="20260410-nyy-bos",
        game_time="2026-04-10T19:05:00-04:00",
        teams=Teams(away="New York Yankees", home="Boston Red Sox"),
        probable_pitchers=ProbablePitchers(away="Gerrit Cole", home="Brayan Bello"),
        predicted_probabilities=PredictedProbabilities(away_win=0.62, home_win=0.38),
        actual_result=None,
        feature_values={
            "away_team_elo": 1562,
            "home_team_elo": 1504,
            "elo_diff": 58,
            "away_starter_era": 3.19,
            "home_starter_era": 4.27,
            "starter_era_diff": -1.08,
            "away_bullpen_fip_last14": 3.74,
            "home_bullpen_fip_last14": 4.18,
            "bullpen_fip_diff": -0.44,
            "away_wrc_plus_last30": 121,
            "home_wrc_plus_last30": 103,
            "wrc_plus_diff": 18,
            "park_factor_runs": 1.04,
            "away_travel_miles_last3d": 210,
            "home_travel_miles_last3d": 0,
        },
    ),
    "20260410-lad-sf": GamePredictionDetail(
        game_id="20260410-lad-sf",
        game_time="2026-04-10T21:45:00-07:00",
        teams=Teams(away="Los Angeles Dodgers", home="San Francisco Giants"),
        probable_pitchers=ProbablePitchers(away="Tyler Glasnow", home="Logan Webb"),
        predicted_probabilities=PredictedProbabilities(away_win=0.54, home_win=0.46),
        actual_result=ActualResult(status="final", winner="Los Angeles Dodgers", away_runs=6, home_runs=4),
        feature_values={
            "away_team_elo": 1581,
            "home_team_elo": 1546,
            "elo_diff": 35,
            "away_starter_era": 3.48,
            "home_starter_era": 3.62,
            "starter_era_diff": -0.14,
            "away_bullpen_fip_last14": 3.82,
            "home_bullpen_fip_last14": 3.79,
            "bullpen_fip_diff": 0.03,
            "away_wrc_plus_last30": 129,
            "home_wrc_plus_last30": 112,
            "wrc_plus_diff": 17,
            "park_factor_runs": 0.90,
            "away_travel_miles_last3d": 337,
            "home_travel_miles_last3d": 0,
        },
    ),
}


@router.get("/{game_id}", response_model=GamePredictionDetail)
def get_game_by_id(game_id: str) -> GamePredictionDetail:
    """Return detailed prediction context for a single game."""
    game = MOCK_GAMES.get(game_id)
    if game:
        return game

    prediction: Prediction | None = None
    with SessionLocal() as session:
        prediction = session.execute(
            select(Prediction).where(Prediction.game_id == str(game_id))
        ).scalar_one_or_none()

    if prediction is None:
        raise HTTPException(status_code=404, detail=f"Game '{game_id}' not found")

    try:
        response = requests.get(
            f"{settings.mlb_stats_api_base}/game/{game_id}/feed/live",
            timeout=10,
        )
        response.raise_for_status()
        payload = response.json()
    except requests.RequestException:
        payload = {}

    game_data = payload.get("gameData", {})
    probable_pitchers_data = game_data.get("probablePitchers", {})
    datetime_data = game_data.get("datetime", {})
    status_data = game_data.get("status", {})

    away_pitcher = probable_pitchers_data.get("away", {}).get("fullName") or "TBD"
    home_pitcher = probable_pitchers_data.get("home", {}).get("fullName") or "TBD"
    game_time = datetime_data.get("officialDate") or prediction.game_date.isoformat()
    game_status = status_data.get("detailedState") or "Scheduled"

    return GamePredictionDetail(
        game_id=prediction.game_id,
        game_time=game_time,
        teams=Teams(away=prediction.away_team, home=prediction.home_team),
        probable_pitchers=ProbablePitchers(away=away_pitcher, home=home_pitcher),
        predicted_probabilities=PredictedProbabilities(
            away_win=prediction.away_win_probability,
            home_win=prediction.home_win_probability,
        ),
        actual_result=ActualResult(status=game_status),
        feature_values={},
    )
