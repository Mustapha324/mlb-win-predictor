from __future__ import annotations

import logging
from collections import defaultdict, deque
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path
from typing import Any

import pandas as pd
from requests import RequestException

from app.services.data_fetcher import MLBDataFetcher

logger = logging.getLogger(__name__)


@dataclass
class TeamState:
    wins: int = 0
    losses: int = 0
    runs_for: int = 0
    runs_against: int = 0
    home_wins: int = 0
    home_losses: int = 0
    away_wins: int = 0
    away_losses: int = 0
    last_results: deque[int] = field(default_factory=lambda: deque(maxlen=10))
    batting_hits: int = 0
    batting_at_bats: int = 0
    batting_walks: int = 0
    batting_total_bases: int = 0
    pitching_earned_runs: int = 0
    pitching_innings: float = 0.0

    @property
    def games_played(self) -> int:
        return self.wins + self.losses

    def win_pct(self) -> float:
        if self.games_played == 0:
            return 0.5
        return self.wins / self.games_played

    def last10_win_pct(self) -> float:
        if not self.last_results:
            return 0.5
        return sum(self.last_results) / len(self.last_results)

    def runs_scored_per_game(self) -> float:
        if self.games_played == 0:
            return 0.0
        return self.runs_for / self.games_played

    def runs_allowed_per_game(self) -> float:
        if self.games_played == 0:
            return 0.0
        return self.runs_against / self.games_played

    def run_diff_per_game(self) -> float:
        return self.runs_scored_per_game() - self.runs_allowed_per_game()

    def home_split_win_pct(self) -> float:
        total = self.home_wins + self.home_losses
        if total == 0:
            return 0.5
        return self.home_wins / total

    def away_split_win_pct(self) -> float:
        total = self.away_wins + self.away_losses
        if total == 0:
            return 0.5
        return self.away_wins / total

    def batting_avg(self) -> float:
        if self.batting_at_bats == 0:
            return 0.0
        return self.batting_hits / self.batting_at_bats

    def obp(self) -> float:
        denominator = self.batting_at_bats + self.batting_walks
        if denominator == 0:
            return 0.0
        return (self.batting_hits + self.batting_walks) / denominator

    def slugging(self) -> float:
        if self.batting_at_bats == 0:
            return 0.0
        return self.batting_total_bases / self.batting_at_bats

    def era(self) -> float:
        if self.pitching_innings <= 0:
            return 0.0
        return (self.pitching_earned_runs * 9.0) / self.pitching_innings


@dataclass
class PitcherState:
    innings_pitched: float = 0.0
    earned_runs: int = 0
    hits_allowed: int = 0
    walks_allowed: int = 0

    def era(self) -> float | None:
        if self.innings_pitched <= 0:
            return None
        return (self.earned_runs * 9.0) / self.innings_pitched

    def whip(self) -> float | None:
        if self.innings_pitched <= 0:
            return None
        return (self.hits_allowed + self.walks_allowed) / self.innings_pitched


def build_historical_dataset(
    start_date: date,
    end_date: date,
    output_path: str | Path = "backend/data/processed/historical_games.csv",
) -> pd.DataFrame:
    """
    Build one row per completed game using only pregame or prior-game aggregates.
    """
    fetcher = MLBDataFetcher()
    games = fetcher.fetch_completed_games(start_date=start_date, end_date=end_date)

    team_state: dict[str, TeamState] = defaultdict(TeamState)
    pitcher_state: dict[int, PitcherState] = defaultdict(PitcherState)
    rows: list[dict[str, object]] = []
    missing_probable_counts = {"home": 0, "away": 0}

    for game in games:
        feed_payload: dict[str, Any] = {}
        try:
            feed_payload = fetcher.fetch_game_feed(game.game_pk)
        except RequestException:
            logger.warning("Could not fetch live feed for game_pk=%s", game.game_pk)

        home_state = team_state[game.home_team]
        away_state = team_state[game.away_team]
        probable_home_pitcher_id, probable_away_pitcher_id = _extract_probable_pitchers(feed_payload)

        if probable_home_pitcher_id is None:
            missing_probable_counts["home"] += 1
        if probable_away_pitcher_id is None:
            missing_probable_counts["away"] += 1

        home_probable_state = pitcher_state.get(probable_home_pitcher_id) if probable_home_pitcher_id else None
        away_probable_state = pitcher_state.get(probable_away_pitcher_id) if probable_away_pitcher_id else None

        home_team_won = int(game.home_score > game.away_score)
        rows.append(
            {
                "game_date": game.game_date,
                "home_team": game.home_team,
                "away_team": game.away_team,
                "home_team_won": home_team_won,
                "home_team_win_pct_pre_game": home_state.win_pct(),
                "away_team_win_pct_pre_game": away_state.win_pct(),
                "home_last10_win_pct": home_state.last10_win_pct(),
                "away_last10_win_pct": away_state.last10_win_pct(),
                "home_runs_scored_per_game": home_state.runs_scored_per_game(),
                "away_runs_scored_per_game": away_state.runs_scored_per_game(),
                "home_runs_allowed_per_game": home_state.runs_allowed_per_game(),
                "away_runs_allowed_per_game": away_state.runs_allowed_per_game(),
                "home_run_diff_per_game": home_state.run_diff_per_game(),
                "away_run_diff_per_game": away_state.run_diff_per_game(),
                "home_home_split_win_pct": home_state.home_split_win_pct(),
                "away_away_split_win_pct": away_state.away_split_win_pct(),
                "home_team_batting_avg": home_state.batting_avg(),
                "away_team_batting_avg": away_state.batting_avg(),
                "home_team_obp": home_state.obp(),
                "away_team_obp": away_state.obp(),
                "home_team_slugging": home_state.slugging(),
                "away_team_slugging": away_state.slugging(),
                "home_team_era": home_state.era(),
                "away_team_era": away_state.era(),
                "home_probable_pitcher_era": home_probable_state.era() if home_probable_state else None,
                "away_probable_pitcher_era": away_probable_state.era() if away_probable_state else None,
                "home_probable_pitcher_whip": home_probable_state.whip() if home_probable_state else None,
                "away_probable_pitcher_whip": away_probable_state.whip() if away_probable_state else None,
                "home_field_indicator": 1,
            }
        )

        _update_team_outcome(home_state, runs_scored=game.home_score, runs_allowed=game.away_score, is_home=True)
        _update_team_outcome(away_state, runs_scored=game.away_score, runs_allowed=game.home_score, is_home=False)

        _update_team_boxscore_stats(feed_payload, home_team_name=game.home_team, away_team_name=game.away_team, team_state=team_state)
        _update_pitcher_states(feed_payload, pitcher_state)

    logger.info("Missing probable pitcher ids (home): %s", missing_probable_counts["home"])
    logger.info("Missing probable pitcher ids (away): %s", missing_probable_counts["away"])

    dataset = pd.DataFrame(rows)
    if not dataset.empty:
        dataset["game_date"] = pd.to_datetime(dataset["game_date"], utc=True).dt.date

    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    dataset.to_csv(output_path, index=False)
    logger.info("Saved dataset to %s with %s rows", output_path, len(dataset))
    return dataset


def _extract_probable_pitchers(feed_payload: dict[str, Any]) -> tuple[int | None, int | None]:
    probable = feed_payload.get("gameData", {}).get("probablePitchers", {})
    home_id = probable.get("home", {}).get("id")
    away_id = probable.get("away", {}).get("id")
    return _safe_int(home_id), _safe_int(away_id)


def _update_team_outcome(state: TeamState, runs_scored: int, runs_allowed: int, is_home: bool) -> None:
    won = int(runs_scored > runs_allowed)
    if won:
        state.wins += 1
    else:
        state.losses += 1

    if is_home:
        if won:
            state.home_wins += 1
        else:
            state.home_losses += 1
    else:
        if won:
            state.away_wins += 1
        else:
            state.away_losses += 1

    state.runs_for += runs_scored
    state.runs_against += runs_allowed
    state.last_results.append(won)


def _update_team_boxscore_stats(
    feed_payload: dict[str, Any],
    home_team_name: str,
    away_team_name: str,
    team_state: dict[str, TeamState],
) -> None:
    boxscore_teams = feed_payload.get("liveData", {}).get("boxscore", {}).get("teams", {})
    home_boxscore = boxscore_teams.get("home", {})
    away_boxscore = boxscore_teams.get("away", {})

    _apply_team_stats(team_state[home_team_name], home_boxscore)
    _apply_team_stats(team_state[away_team_name], away_boxscore)


def _apply_team_stats(state: TeamState, team_boxscore: dict[str, Any]) -> None:
    batting_stats = team_boxscore.get("teamStats", {}).get("batting", {})
    pitching_stats = team_boxscore.get("teamStats", {}).get("pitching", {})

    state.batting_hits += _safe_int(batting_stats.get("hits")) or 0
    state.batting_at_bats += _safe_int(batting_stats.get("atBats")) or 0
    state.batting_walks += _safe_int(batting_stats.get("baseOnBalls")) or 0
    state.batting_total_bases += _safe_int(batting_stats.get("totalBases")) or 0

    state.pitching_earned_runs += _safe_int(pitching_stats.get("earnedRuns")) or 0
    state.pitching_innings += _innings_to_float(pitching_stats.get("inningsPitched"))


def _update_pitcher_states(feed_payload: dict[str, Any], pitcher_state: dict[int, PitcherState]) -> None:
    teams = feed_payload.get("liveData", {}).get("boxscore", {}).get("teams", {})
    for side in ("home", "away"):
        team_boxscore = teams.get(side, {})
        starter = _extract_starter_line(team_boxscore)
        if starter is None:
            continue

        pitcher_id, stat_line = starter
        state = pitcher_state[pitcher_id]
        state.innings_pitched += _innings_to_float(stat_line.get("inningsPitched"))
        state.earned_runs += _safe_int(stat_line.get("earnedRuns")) or 0
        state.hits_allowed += _safe_int(stat_line.get("hits")) or 0
        state.walks_allowed += _safe_int(stat_line.get("baseOnBalls")) or 0


def _extract_starter_line(team_boxscore: dict[str, Any]) -> tuple[int, dict[str, Any]] | None:
    pitcher_ids = team_boxscore.get("pitchers", [])
    players = team_boxscore.get("players", {})
    fallback: tuple[int, dict[str, Any]] | None = None

    for pitcher_id in pitcher_ids:
        player_payload = players.get(f"ID{pitcher_id}", {})
        pitching_stats = player_payload.get("stats", {}).get("pitching", {})
        numeric_pitcher_id = _safe_int(pitcher_id)
        if numeric_pitcher_id is None or not pitching_stats:
            continue
        if fallback is None:
            fallback = (numeric_pitcher_id, pitching_stats)
        if _safe_int(pitching_stats.get("gamesStarted")) == 1:
            return numeric_pitcher_id, pitching_stats

    return fallback


def _safe_int(value: Any) -> int | None:
    if value is None or value == "":
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _innings_to_float(value: Any) -> float:
    if value is None:
        return 0.0
    if isinstance(value, (int, float)):
        return float(value)
    if not isinstance(value, str):
        return 0.0

    if "." not in value:
        try:
            return float(value)
        except ValueError:
            return 0.0

    whole, outs = value.split(".", maxsplit=1)
    try:
        whole_innings = int(whole)
        outs_recorded = int(outs)
    except ValueError:
        return 0.0
    return whole_innings + (outs_recorded / 3.0)


if __name__ == "__main__":
    build_historical_dataset(start_date=date(2025, 3, 1), end_date=date(2025, 11, 1))
