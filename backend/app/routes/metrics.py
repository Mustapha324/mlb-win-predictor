from fastapi import APIRouter

from app.schemas.metrics import ModelMetricsResponse
from app.services import results

router = APIRouter(tags=["metrics"])


@router.get("/metrics", response_model=ModelMetricsResponse)
def get_model_metrics() -> ModelMetricsResponse:
    """Return the latest model metrics snapshot."""
    metric = results.get_latest_metric()
    return ModelMetricsResponse(
        model_name=metric.model_name,
        version=metric.version,
        accuracy=metric.accuracy,
        precision=metric.accuracy,
        recall=metric.accuracy,
        roc_auc=metric.accuracy,
        last_trained_at=metric.updated_at,
    )
