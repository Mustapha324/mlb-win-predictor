import requests
from fastapi import APIRouter, HTTPException
from sqlalchemy import select

from app.core.config import settings
from app.db.database import SessionLocal
from app.models.prediction import Prediction
from app.schemas.game import GamePredictionDetail

router = APIRouter(prefix="/games", tags=["games"])


def _format_record(team_payload: dict) -> str:
    record = team_payload.get("record") or team_payload.get("leagueRecord") or {}
    wins = record.get("wins")
    losses = record.get("losses")
    if wins is None or losses is None:
        return "N/A"
    return f"{wins}-{losses}"


def _to_float(value: object) -> float | None:
    if value is None:
        return None
    try:
        return float(str(value).strip())
    except (TypeError, ValueError):
        return None


def _extract_stat(records: list[dict], group_name: str, stat_name: str) -> float | None:
    for record in records:
        if record.get("group", {}).get("displayName") != group_name:
            continue
        splits = record.get("splits", [])
        if not splits:
            continue
        value = splits[0].get("stat", {}).get(stat_name)
        if value is None:
            return None
        return _to_float(value)
    return None


def _fetch_team_season_stats(team_id: int, season: int) -> tuple[float | None, float | None]:
    try:
        response = requests.get(
            f"{settings.mlb_stats_api_base}/teams/{team_id}/stats",
            params={"stats": "season", "group": "hitting,pitching", "season": season, "sportIds": 1},
            timeout=10,
        )
        response.raise_for_status()
        stats_payload = response.json()
    except requests.RequestException:
        return None, None

    records = stats_payload.get("stats", [])
    batting_avg = _extract_stat(records, "hitting", "avg")
    era = _extract_stat(records, "pitching", "era")
    return batting_avg, era


def _fetch_person_name(person_id: int) -> str | None:
    try:
        response = requests.get(
            f"{settings.mlb_stats_api_base}/people/{person_id}",
            timeout=10,
        )
        response.raise_for_status()
    except requests.RequestException:
        return None

    people = response.json().get("people", [])
    if not people:
        return None

    person = people[0]
    return person.get("fullName") or person.get("fullFMLName") or person.get("name")


def _resolve_probable_pitcher_name(probable_pitcher_payload: dict) -> str | None:
    full_name = probable_pitcher_payload.get("fullName") or probable_pitcher_payload.get("name")
    if full_name:
        return full_name

    pitcher_id = probable_pitcher_payload.get("id")
    if isinstance(pitcher_id, int):
        return _fetch_person_name(pitcher_id)

    return None


def _as_int(value: object) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


@router.get("/{game_id}", response_model=GamePredictionDetail)
def get_game_by_id(game_id: str) -> GamePredictionDetail:
    """Return game details enriched with live MLB API metadata."""
    prediction: Prediction | None = None
    with SessionLocal() as session:
        prediction = session.execute(
            select(Prediction).where(Prediction.game_id == str(game_id))
        ).scalar_one_or_none()

    if prediction is None:
        raise HTTPException(status_code=404, detail=f"Game '{game_id}' not found")

    away_team = prediction.away_team
    home_team = prediction.home_team
    game_date = prediction.game_date.isoformat()
    status = "Scheduled"
    away_probable_pitcher = "TBD"
    home_probable_pitcher = "TBD"
    away_record = "N/A"
    home_record = "N/A"
    away_batting_avg: float | None = None
    home_batting_avg: float | None = None
    away_era: float | None = None
    home_era: float | None = None

    try:
        response = requests.get(
            f"{settings.mlb_stats_api_base}/game/{game_id}/feed/live",
            timeout=10,
        )
        response.raise_for_status()
        payload = response.json()
    except requests.RequestException:
        payload = {}

    game_data = payload.get("gameData", {})
    teams_data = game_data.get("teams", {})
    probable_pitchers_data = game_data.get("probablePitchers", {})
    datetime_data = game_data.get("datetime", {})
    status_data = game_data.get("status", {})
    away_team_data = teams_data.get("away", {})
    home_team_data = teams_data.get("home", {})

    away_team = away_team_data.get("name") or away_team
    home_team = home_team_data.get("name") or home_team
    away_probable_pitcher = _resolve_probable_pitcher_name(probable_pitchers_data.get("away", {})) or away_probable_pitcher
    home_probable_pitcher = _resolve_probable_pitcher_name(probable_pitchers_data.get("home", {})) or home_probable_pitcher
    game_date = datetime_data.get("officialDate") or game_date
    status = status_data.get("detailedState") or status
    away_record = _format_record(away_team_data)
    home_record = _format_record(home_team_data)

    season = prediction.game_date.year
    away_team_id = _as_int(away_team_data.get("id"))
    home_team_id = _as_int(home_team_data.get("id"))

    if away_team_id is not None:
        away_batting_avg, away_era = _fetch_team_season_stats(away_team_id, season)
    if home_team_id is not None:
        home_batting_avg, home_era = _fetch_team_season_stats(home_team_id, season)

    away_win_probability = prediction.away_win_probability
    home_win_probability = prediction.home_win_probability
    predicted_winner = prediction.predicted_winner

    return GamePredictionDetail(
        gameId=prediction.game_id,
        date=game_date,
        status=status,
        awayTeam=away_team,
        homeTeam=home_team,
        awayProbablePitcher=away_probable_pitcher,
        homeProbablePitcher=home_probable_pitcher,
        awayWinProbability=away_win_probability,
        homeWinProbability=home_win_probability,
        predictedWinner=predicted_winner,
        awayTeamRecord=away_record,
        homeTeamRecord=home_record,
        awayTeamBattingAverage=away_batting_avg,
        homeTeamBattingAverage=home_batting_avg,
        awayTeamEra=away_era,
        homeTeamEra=home_era,
    )
