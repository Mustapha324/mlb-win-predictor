from pydantic import BaseModel


class ModelMetricsResponse(BaseModel):
    available: bool = False
    status: str = "unavailable"
    message: str | None = None
    model_name: str | None = None
    version: str | None = None
    total_predictions_evaluated: int | None = None
    correct_predictions: int | None = None
    accuracy: float | None = None
    brier_score: float | None = None
    precision: float | None = None
    recall: float | None = None
    roc_auc: float | None = None
    last_trained_at: str | None = None
    total_training_examples: int | None = None
    calibration_method: str | None = None
    calibrated_log_loss: float | None = None
    calibrated_brier_score: float | None = None
    last_results_sync: str | None = None
    unresolved_predictions_remaining: int | None = None
