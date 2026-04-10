from pydantic import BaseModel


class ModelMetricsResponse(BaseModel):
    model_version: str
    total_predictions_evaluated: int
    correct_predictions: int
    accuracy: float
    brier_score: float
