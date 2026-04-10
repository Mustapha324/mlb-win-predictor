from fastapi import APIRouter

from app.schemas.metrics import ModelMetricsResponse

router = APIRouter(tags=["metrics"])


@router.get("/metrics", response_model=ModelMetricsResponse)
def get_model_metrics() -> ModelMetricsResponse:
    """Temporary endpoint returning mock model metrics."""
    return ModelMetricsResponse(
        total_predictions_evaluated=248,
        correct_predictions=168,
        accuracy=0.6774,
        brier_score=0.212,
        model_version="v0.2.3",
        cumulative_accuracy=[
            {"date": "2026-04-01", "accuracy": 0.625},
            {"date": "2026-04-02", "accuracy": 0.634},
            {"date": "2026-04-03", "accuracy": 0.646},
            {"date": "2026-04-04", "accuracy": 0.652},
            {"date": "2026-04-05", "accuracy": 0.661},
            {"date": "2026-04-06", "accuracy": 0.669},
            {"date": "2026-04-07", "accuracy": 0.6774},
        ],
    )
