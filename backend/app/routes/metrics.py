"""Model-performance routes."""

from fastapi import APIRouter

from app.schemas.metrics import ModelMetricsResponse
from app.services import results

router = APIRouter(tags=["metrics"])


@router.get("/metrics", response_model=ModelMetricsResponse)
def get_model_metrics() -> ModelMetricsResponse:
    """Return the latest model metrics snapshot."""
    metric = results.get_latest_metric()
    total_predictions_evaluated = metric.wins + metric.losses

    return ModelMetricsResponse(
        model_version=metric.version,
        total_predictions_evaluated=total_predictions_evaluated,
        correct_predictions=metric.wins,
        accuracy=metric.accuracy,
        brier_score=0.0,
    )
