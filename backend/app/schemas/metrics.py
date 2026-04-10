from pydantic import BaseModel


class ModelMetricsResponse(BaseModel):
    model_name: str
    version: str
    total_predictions_evaluated: int
    correct_predictions: int
    accuracy: float
    brier_score: float | None = None
    precision: float | None = None
    recall: float | None = None
    roc_auc: float | None = None
    last_trained_at: str | None = None
