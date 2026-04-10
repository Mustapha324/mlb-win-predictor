"""Prediction response schemas."""

from pydantic import BaseModel


class TeamPrediction(BaseModel):
    """Prediction for a single MLB game."""

    game_id: str
    home_team: str
    away_team: str
    predicted_winner: str
    win_probability: float


class TodayPredictionsResponse(BaseModel):
    """Payload containing daily game predictions."""

    date: str
    predictions: list[TeamPrediction]
