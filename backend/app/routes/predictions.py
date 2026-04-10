from datetime import date

from fastapi import APIRouter

from app.schemas.prediction import TodayPredictionsResponse
from app.services.prediction_pipeline import BaselinePredictionPipeline

router = APIRouter(prefix="/predictions", tags=["predictions"])


@router.get("/today", response_model=TodayPredictionsResponse)
def get_today_predictions() -> TodayPredictionsResponse:
    """Return today's predictions from the pipeline facade.

    TODO(scheduled daily prediction jobs): wire this route to read from
    precomputed daily snapshots produced by a scheduler instead of on-demand
    pipeline execution.
    """

    artifacts = BaselinePredictionPipeline().run()
    return TodayPredictionsResponse(
        date=date.today().isoformat(),
        predictions=artifacts.predictions,
    )
