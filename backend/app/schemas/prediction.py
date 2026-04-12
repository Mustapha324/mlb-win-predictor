"""Prediction response schemas."""

from pydantic import BaseModel


class LiveTeamPregameStats(BaseModel):
    win_pct: float
    runs_scored_per_game: float
    runs_allowed_per_game: float
    run_diff_per_game: float
    last_10_win_pct: float
    home_win_pct: float
    away_win_pct: float
    batting_avg: float
    on_base_pct: float
    slugging_pct: float
    era: float
    probable_pitcher_era: float
    probable_pitcher_whip: float
    probable_pitcher_kbb: float


class LiveGamePredictionInputs(BaseModel):
    home: LiveTeamPregameStats
    away: LiveTeamPregameStats


class TeamPrediction(BaseModel):
    """Prediction for a single MLB game."""

    game_id: str
    gameId: str | None = None
    home_team: str
    away_team: str
    homeTeam: str | None = None
    awayTeam: str | None = None
    game_time_utc: str | None = None
    gameTime: str | None = None
    status: str | None = None
    home_probable_pitcher: str | None = None
    away_probable_pitcher: str | None = None
    homeProbablePitcher: str | None = None
    awayProbablePitcher: str | None = None
    predicted_winner: str
    home_win_probability: float
    away_win_probability: float
    homeWinProbability: float | None = None
    awayWinProbability: float | None = None
    prediction_source: str
    predictionSource: str | None = None
    live_stats_used: LiveGamePredictionInputs | None = None


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
    awayScore: int | None = None
    homeScore: int | None = None
    status: str | None = None


class PredictionHistoryResponse(BaseModel):
    predictions: list[PredictionHistoryItem]


class ResultsUpdateResponse(BaseModel):
    checked_predictions: int
    updated_predictions: int
    unresolved_predictions: int
    updated_metrics: dict
    retraining: dict | None = None
