from pydantic import BaseModel, Field


class CumulativeAccuracyPoint(BaseModel):
    date: str
    accuracy: float


class ModelMetricsResponse(BaseModel):
    total_predictions_evaluated: int
    correct_predictions: int
    accuracy: float
    brier_score: float
    model_version: str
    cumulative_accuracy: list[CumulativeAccuracyPoint] = Field(default_factory=list)
