"""Model-performance routes."""

from fastapi import APIRouter

from app.schemas.metrics import ModelMetricsResponse
from app.services import results

router = APIRouter(tags=["metrics"])


_PLACEHOLDER_METRICS = ModelMetricsResponse(
    model_version="unavailable",
    total_predictions_evaluated=0,
    correct_predictions=0,
    accuracy=0.0,
    brier_score=0.0,
)


@router.get("/metrics", response_model=ModelMetricsResponse)
def get_model_metrics() -> ModelMetricsResponse:
    """Return the latest model metrics snapshot."""
    try:
        metric = results.get_latest_metric()
    except IndexError:
        return _PLACEHOLDER_METRICS

    total_predictions_evaluated = max(metric.wins + metric.losses, 0)

    return ModelMetricsResponse(
        model_version=metric.version,
        total_predictions_evaluated=total_predictions_evaluated,
        correct_predictions=max(metric.wins, 0),
        accuracy=metric.accuracy,
        brier_score=0.0,
    )
