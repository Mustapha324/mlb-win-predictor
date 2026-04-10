from __future__ import annotations

from collections import defaultdict, deque
from dataclasses import dataclass
from datetime import date
from pathlib import Path

import pandas as pd

from app.services.data_fetcher import MLBDataFetcher


@dataclass
class TeamState:
    wins: int = 0
    losses: int = 0
    runs_for: int = 0
    runs_against: int = 0
    last_results: deque[int] | None = None

    def __post_init__(self) -> None:
        if self.last_results is None:
            self.last_results = deque(maxlen=10)

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

    def run_diff_per_game(self) -> float:
        if self.games_played == 0:
            return 0.0
        return (self.runs_for - self.runs_against) / self.games_played


def build_historical_dataset(
    start_date: date,
    end_date: date,
    output_path: str | Path = "backend/data/processed/historical_games.csv",
) -> pd.DataFrame:
    """
    Build one row per completed game with pre-game team features only.
    """
    fetcher = MLBDataFetcher()
    games = fetcher.fetch_completed_games(start_date=start_date, end_date=end_date)

    team_state: dict[str, TeamState] = defaultdict(TeamState)
    rows: list[dict[str, object]] = []

    for game in games:
        home_state = team_state[game.home_team]
        away_state = team_state[game.away_team]

        home_team_won = int(game.home_score > game.away_score)

        rows.append(
            {
                "game_date": game.game_date,
                "home_team": game.home_team,
                "away_team": game.away_team,
                "home_team_won": home_team_won,
                "home_team_win_pct_pre_game": home_state.win_pct(),
                "away_team_win_pct_pre_game": away_state.win_pct(),
                "home_team_last10_win_pct": home_state.last10_win_pct(),
                "away_team_last10_win_pct": away_state.last10_win_pct(),
                "home_team_run_diff_per_game": home_state.run_diff_per_game(),
                "away_team_run_diff_per_game": away_state.run_diff_per_game(),
            }
        )

        _update_team_state(home_state, runs_scored=game.home_score, runs_allowed=game.away_score)
        _update_team_state(away_state, runs_scored=game.away_score, runs_allowed=game.home_score)

    dataset = pd.DataFrame(rows)
    if not dataset.empty:
        dataset["game_date"] = pd.to_datetime(dataset["game_date"], utc=True).dt.date

    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    dataset.to_csv(output_path, index=False)
    return dataset


def _update_team_state(state: TeamState, runs_scored: int, runs_allowed: int) -> None:
    won = int(runs_scored > runs_allowed)
    if won:
        state.wins += 1
    else:
        state.losses += 1

    state.runs_for += runs_scored
    state.runs_against += runs_allowed
    state.last_results.append(won)


if __name__ == "__main__":
    # Example range spanning full 2025 regular season.
    build_historical_dataset(start_date=date(2025, 3, 1), end_date=date(2025, 11, 1))
