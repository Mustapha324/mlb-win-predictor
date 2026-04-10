from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Any

import requests


@dataclass
class HistoricalGame:
    """Normalized representation of a completed MLB game."""

    game_pk: int
    game_date: str
    home_team: str
    away_team: str
    home_score: int
    away_score: int


class MLBDataFetcher:
    """Fetches completed MLB regular-season games from MLB Stats API."""

    BASE_URL = "https://statsapi.mlb.com/api/v1/schedule"
    FEED_URL_TEMPLATE = "https://statsapi.mlb.com/api/v1.1/game/{game_pk}/feed/live"

    def __init__(self, timeout_seconds: int = 30) -> None:
        self.timeout_seconds = timeout_seconds

    def fetch_completed_games(
        self,
        start_date: date,
        end_date: date,
    ) -> list[HistoricalGame]:
        params = {
            "sportId": 1,
            "gameType": "R",
            "startDate": start_date.isoformat(),
            "endDate": end_date.isoformat(),
        }
        response = requests.get(self.BASE_URL, params=params, timeout=self.timeout_seconds)
        response.raise_for_status()

        payload = response.json()
        return self._parse_games(payload)

    def _parse_games(self, payload: dict[str, Any]) -> list[HistoricalGame]:
        games: list[HistoricalGame] = []
        for game_day in payload.get("dates", []):
            for game in game_day.get("games", []):
                status = game.get("status", {}).get("detailedState")
                if status != "Final":
                    continue

                teams = game.get("teams", {})
                home = teams.get("home", {})
                away = teams.get("away", {})
                home_team = home.get("team", {}).get("name")
                away_team = away.get("team", {}).get("name")
                home_score = home.get("score")
                away_score = away.get("score")

                if not all(
                    [
                        game.get("gamePk"),
                        game.get("gameDate"),
                        home_team,
                        away_team,
                        home_score is not None,
                        away_score is not None,
                    ]
                ):
                    continue

                games.append(
                    HistoricalGame(
                        game_pk=int(game["gamePk"]),
                        game_date=str(game["gameDate"]),
                        home_team=str(home_team),
                        away_team=str(away_team),
                        home_score=int(home_score),
                        away_score=int(away_score),
                    )
                )

        return sorted(games, key=lambda g: (g.game_date, g.game_pk))

    def fetch_game_feed(self, game_pk: int) -> dict[str, Any]:
        response = requests.get(
            self.FEED_URL_TEMPLATE.format(game_pk=game_pk),
            timeout=self.timeout_seconds,
        )
        response.raise_for_status()
        payload = response.json()
        if not isinstance(payload, dict):
            return {}
        return payload
