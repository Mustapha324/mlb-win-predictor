"""Model-performance routes."""

import json
from pathlib import Path

from fastapi import APIRouter

from app.schemas.metrics import ModelMetricsResponse

router = APIRouter(tags=["metrics"])

BASE_DIR = Path(__file__).resolve().parents[2]
METRICS_PATH = BASE_DIR / "models" / "logistic_regression_metrics.json"


@router.get("/metrics", response_model=ModelMetricsResponse)
def get_model_metrics() -> ModelMetricsResponse:
    """Return the latest model metrics snapshot."""
    if not METRICS_PATH.exists():
        return ModelMetricsResponse(
            available=False,
            status="unavailable",
            message="Model not trained yet. Metrics are unavailable.",
        )

    try:
        raw_metrics = json.loads(METRICS_PATH.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return ModelMetricsResponse(
            available=False,
            status="invalid_metrics_artifact",
            message="Metrics artifact is unreadable. Re-run training to regenerate it.",
        )

    total_predictions_evaluated = _as_optional_int(raw_metrics.get("total_predictions_evaluated"))
    if total_predictions_evaluated is None:
        total_predictions_evaluated = _as_optional_int(raw_metrics.get("test_games"))

    correct_predictions = _as_optional_int(raw_metrics.get("correct_predictions"))
    if (
        total_predictions_evaluated is not None
        and correct_predictions is not None
        and correct_predictions > total_predictions_evaluated
    ):
        correct_predictions = total_predictions_evaluated

    has_any_metric = any(
        value is not None
        for value in [
            total_predictions_evaluated,
            correct_predictions,
            _as_optional_float(raw_metrics.get("accuracy")),
            _as_optional_float(raw_metrics.get("brier_score")),
            _as_optional_float(raw_metrics.get("precision")),
            _as_optional_float(raw_metrics.get("recall")),
            _as_optional_float(raw_metrics.get("roc_auc")),
        ]
    )
    if not has_any_metric:
        return ModelMetricsResponse(
            available=False,
            status="unavailable",
            message="Metrics artifact found, but no evaluation values are available yet.",
        )

    return ModelMetricsResponse(
        available=True,
        status="ok",
        model_name=_as_optional_str(raw_metrics.get("model_name")),
        version=_as_optional_str(raw_metrics.get("version")) or _as_optional_str(raw_metrics.get("model_version")),
        total_predictions_evaluated=total_predictions_evaluated,
        correct_predictions=correct_predictions,
        accuracy=_as_optional_float(raw_metrics.get("accuracy")),
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


def _as_optional_int(value: object) -> int | None:
    if value is None:
        return None
    return int(value)


def _as_optional_str(value: object) -> str | None:
    if value is None:
        return None
    return str(value)
