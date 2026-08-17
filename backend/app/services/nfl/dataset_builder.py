from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pandas as pd

TEAM_ROLLING_COLUMNS = [
    "won",
    "points_for",
    "points_against",
    "pass_yards",
    "rush_yards",
    "turnovers",
    "sacks",
    "third_down_rate",
    "red_zone_rate",
    "qb_epa",
]

PLAYER_STAT_COLUMNS = [
    "passing_yards",
    "rushing_yards",
    "receiving_yards",
    "passing_tds",
    "rushing_tds",
    "receiving_tds",
    "interceptions",
    "completions",
    "attempts",
    "targets",
    "receptions",
]

REQUIRED_TEAM_COLUMNS = {
    "game_id",
    "season",
    "week",
    "gameday",
    "team",
    "opponent",
    "home",
    "won",
    "points_for",
    "points_against",
}

REQUIRED_PLAYER_COLUMNS = {
    "game_id",
    "season",
    "week",
    "gameday",
    "player_id",
    "player_name",
    "position",
    "team",
    "opponent",
}


@dataclass(frozen=True)
class NflDatasetPaths:
    team_games: Path
    player_games: Path
    output_games: Path
    output_players: Path


def _require_columns(frame: pd.DataFrame, required: set[str], name: str) -> None:
    missing = sorted(required.difference(frame.columns))
    if missing:
        raise ValueError(f"{name} is missing required columns: {missing}")


def _safe_rate(numerator: pd.Series, denominator: pd.Series) -> pd.Series:
    return numerator.div(denominator.replace(0, np.nan)).fillna(0.0)


def _rolling_pregame_features(team_games: pd.DataFrame) -> pd.DataFrame:
    """Create features using shifted windows, so the current result is never visible."""
    frame = team_games.sort_values(["team", "gameday", "game_id"]).copy()
    for column in TEAM_ROLLING_COLUMNS:
        if column not in frame:
            frame[column] = 0.0
        prior = frame.groupby("team", sort=False)[column].shift(1)
        frame[f"{column}_season"] = prior.groupby(frame["team"]).expanding().mean().reset_index(level=0, drop=True)
        frame[f"{column}_last5"] = prior.groupby(frame["team"]).rolling(5, min_periods=1).mean().reset_index(level=0, drop=True)

    prior_games = frame.groupby("team", sort=False).cumcount()
    prior_wins = frame.groupby("team", sort=False)["won"].cumsum() - frame["won"]
    frame["wins_pre_game"] = prior_wins
    frame["losses_pre_game"] = prior_games - prior_wins
    frame["win_pct_pre_game"] = _safe_rate(prior_wins, prior_games)

    home_prior = frame["won"].where(frame["home"].astype(bool)).groupby(frame["team"]).shift(1)
    away_prior = frame["won"].where(~frame["home"].astype(bool)).groupby(frame["team"]).shift(1)
    frame["home_win_pct_pre_game"] = home_prior.groupby(frame["team"]).expanding().mean().reset_index(level=0, drop=True)
    frame["away_win_pct_pre_game"] = away_prior.groupby(frame["team"]).expanding().mean().reset_index(level=0, drop=True)

    frame["rest_days"] = frame.groupby("team")["gameday"].diff().dt.days.clip(lower=0, upper=21).fillna(7)
    frame["point_differential_last5"] = frame["points_for_last5"] - frame["points_against_last5"]

    opponent_quality = frame[["game_id", "team", "win_pct_pre_game"]].rename(
        columns={"team": "opponent", "win_pct_pre_game": "opponent_win_pct_pre_game"}
    )
    frame = frame.merge(opponent_quality, on=["game_id", "opponent"], how="left")
    frame["strength_of_schedule"] = (
        frame.groupby("team")["opponent_win_pct_pre_game"]
        .transform(lambda values: values.shift(1).rolling(8, min_periods=1).mean())
        .fillna(0.5)
    )

    h2h_prior = frame.groupby(["team", "opponent"])["won"].shift(1)
    frame["head_to_head_win_pct"] = (
        h2h_prior.groupby([frame["team"], frame["opponent"]])
        .expanding().mean().reset_index(level=[0, 1], drop=True).fillna(0.5)
    )
    return frame


def build_team_matchup_dataset(team_games: pd.DataFrame) -> pd.DataFrame:
    _require_columns(team_games, REQUIRED_TEAM_COLUMNS, "team_games")
    frame = team_games.copy()
    frame["gameday"] = pd.to_datetime(frame["gameday"], utc=True, errors="raise")
    features = _rolling_pregame_features(frame)
    home = features[features["home"].astype(bool)].copy()
    away = features[~features["home"].astype(bool)].copy()
    feature_columns = [
        column for column in features.columns
        if column.endswith(("_season", "_last5", "_pre_game"))
        or column in {"wins_pre_game", "losses_pre_game", "rest_days", "point_differential_last5", "strength_of_schedule", "head_to_head_win_pct"}
    ]
    home_columns = ["game_id", "season", "week", "gameday", "team", "opponent", "won", *feature_columns]
    away_columns = ["game_id", "team", *feature_columns]
    dataset = home[home_columns].rename(columns={"team": "home_team", "opponent": "away_team", "won": "home_team_won"})
    away_features = away[away_columns].rename(columns={"team": "away_team", **{column: f"away_{column}" for column in feature_columns}})
    dataset = dataset.rename(columns={column: f"home_{column}" for column in feature_columns})
    dataset = dataset.merge(away_features, on=["game_id", "away_team"], how="inner")
    dataset["home_field_advantage"] = 1
    return dataset.sort_values(["gameday", "game_id"]).reset_index(drop=True)


def build_player_opponent_dataset(player_games: pd.DataFrame) -> pd.DataFrame:
    """Build player prop features with shifted recent and opponent-specific history."""
    _require_columns(player_games, REQUIRED_PLAYER_COLUMNS, "player_games")
    frame = player_games.copy()
    frame["gameday"] = pd.to_datetime(frame["gameday"], utc=True, errors="raise")
    frame = frame.sort_values(["player_id", "gameday", "game_id"])
    for column in PLAYER_STAT_COLUMNS:
        if column not in frame:
            frame[column] = 0.0
        prior = frame.groupby("player_id")[column].shift(1)
        frame[f"{column}_last3"] = prior.groupby(frame["player_id"]).rolling(3, min_periods=1).mean().reset_index(level=0, drop=True)
        frame[f"{column}_last8"] = prior.groupby(frame["player_id"]).rolling(8, min_periods=1).mean().reset_index(level=0, drop=True)
        opponent_prior = frame.groupby(["player_id", "opponent"])[column].shift(1)
        frame[f"{column}_vs_opponent"] = (
            opponent_prior.groupby([frame["player_id"], frame["opponent"]])
            .expanding().mean().reset_index(level=[0, 1], drop=True)
        )

    frame["completion_pct_last8"] = _safe_rate(frame["completions_last8"], frame["attempts_last8"])
    frame["catch_rate_last8"] = _safe_rate(frame["receptions_last8"], frame["targets_last8"])
    frame["games_vs_opponent"] = frame.groupby(["player_id", "opponent"]).cumcount()
    return frame.reset_index(drop=True)


def _filter_and_validate_seasons(frame: pd.DataFrame, start_season: int, end_season: int, name: str) -> pd.DataFrame:
    if "season" not in frame:
        raise ValueError(f"{name} must include a season column")
    frame = frame[frame["season"].between(start_season, end_season)].copy()
    expected = set(range(start_season, end_season + 1))
    available = set(frame["season"].dropna().astype(int).unique())
    missing = sorted(expected.difference(available))
    if missing:
        raise ValueError(f"{name} is missing required NFL seasons: {missing}")
    return frame


def build_nfl_datasets(paths: NflDatasetPaths, start_season: int = 2006, end_season: int = 2025) -> tuple[pd.DataFrame, pd.DataFrame]:
    if end_season - start_season + 1 < 20:
        raise ValueError("NFL training requires at least 20 complete seasons.")
    team_games = pd.read_csv(paths.team_games)
    player_games = pd.read_csv(paths.player_games)
    team_games = _filter_and_validate_seasons(team_games, start_season, end_season, "team_games")
    player_games = _filter_and_validate_seasons(player_games, start_season, end_season, "player_games")
    games = build_team_matchup_dataset(team_games)
    players = build_player_opponent_dataset(player_games)
    paths.output_games.parent.mkdir(parents=True, exist_ok=True)
    paths.output_players.parent.mkdir(parents=True, exist_ok=True)
    games.to_csv(paths.output_games, index=False)
    players.to_csv(paths.output_players, index=False)
    return games, players
