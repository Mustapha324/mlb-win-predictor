from __future__ import annotations

from datetime import date

import requests
from requests import RequestException

MLB_SCHEDULE_URL = "https://statsapi.mlb.com/api/v1/schedule"


def fetch_upcoming_games_for_date(game_date: date) -> list[dict]:
    """Fetch upcoming MLB games for a given date from MLB Stats API."""
    params = {
        "sportId": 1,
        "date": game_date.isoformat(),
        "hydrate": "probablePitcher",
    }

    try:
        response = requests.get(MLB_SCHEDULE_URL, params=params, timeout=10)
        response.raise_for_status()
        payload = response.json()
    except RequestException:
        return []

    dates = payload.get("dates", [])
    if not dates:
        return []

    games = dates[0].get("games", [])
    upcoming_games: list[dict] = []

    for game in games:
        status = game.get("status", {})
        if status.get("abstractGameState") != "Preview":
            continue

        away_team = game.get("teams", {}).get("away", {})
        home_team = game.get("teams", {}).get("home", {})

        away_probable = away_team.get("probablePitcher", {})
        home_probable = home_team.get("probablePitcher", {})

        upcoming_games.append(
            {
                "game_id": str(game.get("gamePk")),
                "game_time_utc": game.get("gameDate"),
                "away_team": away_team.get("team", {}).get("name", ""),
                "home_team": home_team.get("team", {}).get("name", ""),
                "away_probable_pitcher": away_probable.get("fullName"),
                "home_probable_pitcher": home_probable.get("fullName"),
            }
        )

    return upcoming_games
