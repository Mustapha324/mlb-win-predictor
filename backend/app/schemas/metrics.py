"""Model metrics response schemas."""

from pydantic import BaseModel


class ModelMetricsResponse(BaseModel):
    """Aggregated quality metrics for the active model release."""

    model_name: str
    version: str
    accuracy: float
    precision: float
    recall: float
    roc_auc: float
    last_trained_at: str
