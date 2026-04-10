"""Model-performance routes."""

import json
from pathlib import Path

from fastapi import APIRouter

from app.schemas.metrics import ModelMetricsResponse
from app.services.results import compute_metrics_snapshot

router = APIRouter(tags=["metrics"])

BASE_DIR = Path(__file__).resolve().parents[2]
METRICS_PATH = BASE_DIR / "models" / "logistic_regression_metrics.json"


@router.get("/metrics", response_model=ModelMetricsResponse)
def get_model_metrics() -> ModelMetricsResponse:
    """Return the latest metrics computed from finalized prediction outcomes."""
    derived = compute_metrics_snapshot()

    model_name: str | None = None
    version: str | None = None
    last_trained_at: str | None = None

    if METRICS_PATH.exists():
        try:
            raw_metrics = json.loads(METRICS_PATH.read_text(encoding="utf-8"))
            model_name = _as_optional_str(raw_metrics.get("model_name"))
            version = _as_optional_str(raw_metrics.get("version")) or _as_optional_str(raw_metrics.get("model_version"))
            last_trained_at = _as_optional_str(raw_metrics.get("last_trained_at"))
        except json.JSONDecodeError:
            pass

    has_data = (derived["total_predictions_evaluated"] or 0) > 0
    return ModelMetricsResponse(
        available=has_data,
        status="ok" if has_data else "unavailable",
        message=None if has_data else "No finalized predictions available yet.",
        model_name=model_name,
        version=version,
        total_predictions_evaluated=derived["total_predictions_evaluated"],
        correct_predictions=derived["correct_predictions"],
        accuracy=derived["accuracy"],
        brier_score=derived["brier_score"],
        last_trained_at=last_trained_at,
        last_results_sync=derived["last_results_sync"],
    )


def _as_optional_str(value: object) -> str | None:
    if value is None:
        return None
    return str(value)
