"""Prediction response schemas."""

from pydantic import BaseModel


class TeamPrediction(BaseModel):
    """Prediction for a single MLB game."""

    game_id: str
    home_team: str
    away_team: str
    game_time_utc: str | None = None
    home_probable_pitcher: str | None = None
    away_probable_pitcher: str | None = None
    predicted_winner: str
    home_win_probability: float
    away_win_probability: float
    prediction_source: str


class TodayPredictionsResponse(BaseModel):
    """Payload containing daily game predictions."""

    date: str
    predictions: list[TeamPrediction]


class PredictionHistoryItem(BaseModel):
    gameId: str
    date: str
    awayTeam: str
    homeTeam: str
    predictedWinner: str
    actualWinner: str | None
    homeWinProbability: float
    awayWinProbability: float
    wasCorrect: bool | None


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
