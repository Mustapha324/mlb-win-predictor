from fastapi import APIRouter

from app.schemas.metrics import ModelMetricsResponse

router = APIRouter(tags=["metrics"])


@router.get("/metrics", response_model=ModelMetricsResponse)
def get_model_metrics() -> ModelMetricsResponse:
    """Temporary endpoint returning mock model metrics."""
    return ModelMetricsResponse(
        model_name="xgboost_baseline",
        version="0.1.0",
        accuracy=0.683,
        precision=0.671,
        recall=0.659,
        roc_auc=0.721,
        last_trained_at="2026-04-01T00:00:00Z",
    )
