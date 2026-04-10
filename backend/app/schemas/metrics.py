from pydantic import BaseModel


class ModelMetricsResponse(BaseModel):
    model_name: str
    version: str
    accuracy: float
    precision: float
    recall: float
    roc_auc: float
    last_trained_at: str
