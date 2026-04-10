from datetime import date

from fastapi import APIRouter

from app.schemas.prediction import TeamPrediction, TodayPredictionsResponse
from app.services.mlb import fetch_upcoming_games_for_date

router = APIRouter(prefix="/predictions", tags=["predictions"])


@router.get("/today", response_model=TodayPredictionsResponse)
def get_today_predictions() -> TodayPredictionsResponse:
    """Return today's upcoming MLB games with placeholder win probabilities."""
    games = fetch_upcoming_games_for_date(date.today())

    predictions = [
        TeamPrediction(
            game_id=game["game_id"],
            home_team=game["home_team"],
            away_team=game["away_team"],
            game_time_utc=game.get("game_time_utc"),
            home_probable_pitcher=game.get("home_probable_pitcher"),
            away_probable_pitcher=game.get("away_probable_pitcher"),
            predicted_winner="TBD",
            home_win_probability=0.50,
            away_win_probability=0.50,
        )
        for game in games
    ]

    return TodayPredictionsResponse(date=date.today().isoformat(), predictions=predictions)
