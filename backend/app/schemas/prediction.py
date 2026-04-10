from pydantic import BaseModel


class TeamPrediction(BaseModel):
    game_id: str
    home_team: str
    away_team: str
    predicted_winner: str
    home_win_probability: float
    away_win_probability: float


class TodayPredictionsResponse(BaseModel):
    date: str
    predictions: list[TeamPrediction]
