from datetime import date

from fastapi import APIRouter

from app.schemas.prediction import TeamPrediction, TodayPredictionsResponse

router = APIRouter(prefix="/predictions", tags=["predictions"])


@router.get("/today", response_model=TodayPredictionsResponse)
def get_today_predictions() -> TodayPredictionsResponse:
    """Temporary endpoint returning mock prediction data."""
    predictions = [
        TeamPrediction(
            game_id="20260410-nyy-bos",
            home_team="Boston Red Sox",
            away_team="New York Yankees",
            predicted_winner="New York Yankees",
            win_probability=0.57,
        ),
        TeamPrediction(
            game_id="20260410-lad-sf",
            home_team="San Francisco Giants",
            away_team="Los Angeles Dodgers",
            predicted_winner="Los Angeles Dodgers",
            win_probability=0.62,
        ),
    ]

    return TodayPredictionsResponse(date=date.today().isoformat(), predictions=predictions)
