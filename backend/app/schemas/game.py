from pydantic import BaseModel


class GamePredictionDetail(BaseModel):
    gameId: str
    date: str
    status: str
    awayTeam: str
    homeTeam: str
    awayProbablePitcher: str
    homeProbablePitcher: str
    awayWinProbability: float | None
    homeWinProbability: float | None
    predictedWinner: str
    awayTeamRecord: str
    homeTeamRecord: str
    awayTeamBattingAverage: float | None
    homeTeamBattingAverage: float | None
    awayTeamEra: float | None
    homeTeamEra: float | None
