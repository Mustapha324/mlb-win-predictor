"""Service helpers for querying upcoming MLB games from the public Stats API."""

from __future__ import annotations

from datetime import datetime
from typing import Any

import requests

MLB_STATS_API_SCHEDULE_URL = "https://statsapi.mlb.com/api/v1/schedule"


def _extract_pitcher_name(team_payload: dict[str, Any]) -> str | None:
    """Return a probable pitcher name when present; otherwise ``None``.

    The Stats API can omit probable pitcher data for some games (e.g., long-range
    schedules, TBD starters, postponed games). This helper safely checks a few
    common keys and returns ``None`` when no pitcher name is available.
    """

    probable_pitcher = team_payload.get("probablePitcher") or team_payload.get("likelyPitcher")
    if not isinstance(probable_pitcher, dict):
        return None

    return probable_pitcher.get("fullName") or probable_pitcher.get("name")


def get_upcoming_games(date: str) -> list[dict[str, str | None]]:
    """Fetch upcoming MLB games for a given date.

    Args:
        date: Date in ``YYYY-MM-DD`` format.

    Returns:
        A list of dictionaries with normalized game details:
        - ``game_date``
        - ``away_team``
        - ``home_team``
        - ``probable_away_pitcher``
        - ``probable_home_pitcher``
        - ``game_status``

    Raises:
        ValueError: If ``date`` is not in ``YYYY-MM-DD`` format.
        requests.HTTPError: If the upstream API responds with an HTTP error.
    """

    # Validate the date format early to provide a clear local error message.
    try:
        datetime.strptime(date, "%Y-%m-%d")
    except ValueError as exc:
        raise ValueError("date must be in YYYY-MM-DD format") from exc

    # ``hydrate=probablePitcher`` asks the API to include pitcher projections
    # when available. Missing data is expected and handled downstream.
    response = requests.get(
        MLB_STATS_API_SCHEDULE_URL,
        params={"sportId": 1, "date": date, "hydrate": "probablePitcher"},
        timeout=15,
    )
    response.raise_for_status()

    payload = response.json()

    games: list[dict[str, str | None]] = []
    for day in payload.get("dates", []):
        for game in day.get("games", []):
            away_team_payload = game.get("teams", {}).get("away", {})
            home_team_payload = game.get("teams", {}).get("home", {})

            # Safely pull names/status with defaults for partial API responses.
            game_info: dict[str, str | None] = {
                "game_date": game.get("gameDate"),
                "away_team": away_team_payload.get("team", {}).get("name"),
                "home_team": home_team_payload.get("team", {}).get("name"),
                "probable_away_pitcher": _extract_pitcher_name(away_team_payload),
                "probable_home_pitcher": _extract_pitcher_name(home_team_payload),
                "game_status": game.get("status", {}).get("detailedState")
                or game.get("status", {}).get("abstractGameState"),
            }
            games.append(game_info)

    return games
