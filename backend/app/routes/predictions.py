from datetime import date

from fastapi import APIRouter

from app.schemas.prediction import (
    PredictionHistoryItem,
    PredictionHistoryResponse,
    TeamPrediction,
    TodayPredictionsResponse,
)
from app.services import results

router = APIRouter(prefix="/predictions", tags=["predictions"])


@router.get("/today", response_model=TodayPredictionsResponse)
def get_today_predictions() -> TodayPredictionsResponse:
    """Return today's prediction slate."""
    predictions = [
        TeamPrediction(
            game_id=record.game_id,
            home_team=record.home_team,
            away_team=record.away_team,
            predicted_winner=record.predicted_winner,
            win_probability=record.home_win_probability,
        )
        for record in results.list_today_predictions()
    ]

    return TodayPredictionsResponse(date=date.today().isoformat(), predictions=predictions)


@router.get("/history", response_model=PredictionHistoryResponse)
def get_prediction_history() -> PredictionHistoryResponse:
    """Return historical model predictions with game outcomes when available."""
    history = [
        PredictionHistoryItem(
            date=record.game_date,
            matchup=f"{record.away_team} @ {record.home_team}",
            predicted_winner=record.predicted_winner,
            actual_winner=record.actual_winner,
            home_win_probability=record.home_win_probability,
            was_correct=record.was_correct,
        )
        for record in results.list_history()
    ]
    return PredictionHistoryResponse(predictions=history)

