from pydantic import BaseModel


class TeamPrediction(BaseModel):
    game_id: str
    home_team: str
    away_team: str
    predicted_winner: str
    win_probability: float


class TodayPredictionsResponse(BaseModel):
    date: str
    predictions: list[TeamPrediction]


class PredictionHistoryItem(BaseModel):
    date: str
    matchup: str
    predicted_winner: str
    actual_winner: str | None
    home_win_probability: float
    was_correct: bool | None


class PredictionHistoryResponse(BaseModel):
    predictions: list[PredictionHistoryItem]


class ResultsUpdateResponse(BaseModel):
    updated_predictions: int
    finalized_predictions: int
    correct_predictions: int
    accuracy: float
    model_name: str
    version: str
    updated_at: str
