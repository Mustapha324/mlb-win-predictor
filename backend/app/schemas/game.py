from pydantic import BaseModel


class Teams(BaseModel):
    away: str
    home: str


class ProbablePitchers(BaseModel):
    away: str
    home: str


class PredictedProbabilities(BaseModel):
    away_win: float
    home_win: float


class ActualResult(BaseModel):
    status: str
    winner: str | None = None
    away_runs: int | None = None
    home_runs: int | None = None


class GamePredictionDetail(BaseModel):
    game_id: str
    game_time: str
    teams: Teams
    probable_pitchers: ProbablePitchers
    predicted_probabilities: PredictedProbabilities
    actual_result: ActualResult | None = None
    feature_values: dict[str, float | int | str | None]
