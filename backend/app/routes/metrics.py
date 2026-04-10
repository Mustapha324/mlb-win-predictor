"""Model-performance routes."""

import json
from pathlib import Path

from fastapi import APIRouter

from app.schemas.metrics import ModelMetricsResponse

router = APIRouter(tags=["metrics"])

BASE_DIR = Path(__file__).resolve().parents[2]
METRICS_PATH = BASE_DIR / "models" / "logistic_regression_metrics.json"


_PLACEHOLDER_METRICS = ModelMetricsResponse(
    model_name="MLB Win Predictor",
    version="unavailable",
    total_predictions_evaluated=0,
    correct_predictions=0,
    accuracy=0.0,
    brier_score=None,
    precision=None,
    recall=None,
    roc_auc=None,
    last_trained_at=None,
)


@router.get("/metrics", response_model=ModelMetricsResponse)
def get_model_metrics() -> ModelMetricsResponse:
    """Return the latest model metrics snapshot."""
    if not METRICS_PATH.exists():
        return _PLACEHOLDER_METRICS

    raw_metrics = json.loads(METRICS_PATH.read_text(encoding="utf-8"))

    total_predictions_evaluated = int(raw_metrics.get("total_predictions_evaluated", raw_metrics.get("test_games", 0)))
    correct_predictions = int(raw_metrics.get("correct_predictions", 0))
    if correct_predictions > total_predictions_evaluated:
        correct_predictions = total_predictions_evaluated

    return ModelMetricsResponse(
        model_name=str(raw_metrics.get("model_name", "MLB Win Predictor")),
        version=str(raw_metrics.get("version", "logreg-baseline-v1")),
        total_predictions_evaluated=total_predictions_evaluated,
        correct_predictions=correct_predictions,
        accuracy=float(raw_metrics.get("accuracy", 0.0)),
        brier_score=_as_optional_float(raw_metrics.get("brier_score")),
        precision=_as_optional_float(raw_metrics.get("precision")),
        recall=_as_optional_float(raw_metrics.get("recall")),
        roc_auc=_as_optional_float(raw_metrics.get("roc_auc")),
        last_trained_at=_as_optional_str(raw_metrics.get("last_trained_at")),
    )


def _as_optional_float(value: object) -> float | None:
    if value is None:
        return None
    return float(value)


def _as_optional_str(value: object) -> str | None:
    if value is None:
        return None
    return str(value)
