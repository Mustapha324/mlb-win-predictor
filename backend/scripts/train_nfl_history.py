from __future__ import annotations

import argparse
import csv
import json
import math
import urllib.request
from dataclasses import dataclass, field
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Iterable


NFLVERSE_GAMES_URL = "https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv"
HOME_ADVANTAGE = 48.0
K_FACTOR = 22.0
SEASON_REGRESSION = 0.35
FEATURES = [
    "intercept",
    "elo_edge",
    "home_field",
    "record_edge",
    "recent_form_edge",
    "point_differential_edge",
    "rest_edge",
]
TEAM_ALIASES = {"OAK": "LV", "STL": "LA", "LAR": "LA", "SD": "LAC", "WSH": "WAS"}


@dataclass
class TeamState:
    games: int = 0
    wins: int = 0
    point_diff: float = 0.0
    recent: list[int] = field(default_factory=list)
    last_game: date | None = None


@dataclass(frozen=True)
class Game:
    season: int
    gameday: date
    home: str
    away: str
    home_score: int
    away_score: int
    home_rest: float
    away_rest: float
    home_field: float


def canonical_team(value: str) -> str:
    team = value.strip().upper()
    return TEAM_ALIASES.get(team, team)


def clamp(value: float, lower: float, upper: float) -> float:
    return max(lower, min(upper, value))


def rate(numerator: float, denominator: int, fallback: float = 0.5) -> float:
    return numerator / denominator if denominator else fallback


def sigmoid(value: float) -> float:
    if value >= 0:
        exponential = math.exp(-value)
        return 1.0 / (1.0 + exponential)
    exponential = math.exp(value)
    return exponential / (1.0 + exponential)


def parse_float(value: str | None, fallback: float) -> float:
    try:
        parsed = float(value or "")
        return parsed if math.isfinite(parsed) else fallback
    except ValueError:
        return fallback


def load_games(source: str, start_season: int, end_season: int) -> list[Game]:
    if source.startswith(("https://", "http://")):
        request = urllib.request.Request(source, headers={"User-Agent": "SportIQ-NFL-Trainer/2.0"})
        stream = urllib.request.urlopen(request, timeout=60)  # noqa: S310 - fixed/explicit training source
        rows: Iterable[dict[str, str]] = csv.DictReader(line.decode("utf-8") for line in stream)
    else:
        rows = csv.DictReader(Path(source).open("r", encoding="utf-8", newline=""))

    games: list[Game] = []
    for row in rows:
        try:
            season = int(row.get("season", ""))
            home_score = int(float(row.get("home_score", "")))
            away_score = int(float(row.get("away_score", "")))
            gameday = date.fromisoformat(row.get("gameday", ""))
        except (TypeError, ValueError):
            continue
        if not start_season <= season <= end_season or home_score == away_score:
            continue
        if row.get("game_type") not in {"REG", "POST"}:
            continue
        games.append(
            Game(
                season=season,
                gameday=gameday,
                home=canonical_team(row.get("home_team", "")),
                away=canonical_team(row.get("away_team", "")),
                home_score=home_score,
                away_score=away_score,
                home_rest=parse_float(row.get("home_rest"), 7.0),
                away_rest=parse_float(row.get("away_rest"), 7.0),
                home_field=0.0 if row.get("location", "Home").lower() == "neutral" else 1.0,
            )
        )
    games.sort(key=lambda game: (game.season, game.gameday, game.home, game.away))
    available = {game.season for game in games}
    missing = sorted(set(range(start_season, end_season + 1)).difference(available))
    if missing:
        raise ValueError(f"Historical source is missing required NFL seasons: {missing}")
    return games


def create_state() -> TeamState:
    return TeamState()


def feature_vector(game: Game, ratings: dict[str, float], teams: dict[str, TeamState]) -> list[float]:
    home = teams.get(game.home, create_state())
    away = teams.get(game.away, create_state())
    home_recent = rate(sum(home.recent), len(home.recent))
    away_recent = rate(sum(away.recent), len(away.recent))
    point_edge = clamp(rate(home.point_diff, home.games, 0.0) - rate(away.point_diff, away.games, 0.0), -28.0, 28.0) / 14.0
    return [
        1.0,
        clamp((ratings.get(game.home, 1500.0) - ratings.get(game.away, 1500.0)) / 400.0, -2.5, 2.5),
        game.home_field,
        rate(home.wins, home.games) - rate(away.wins, away.games),
        home_recent - away_recent,
        point_edge,
        clamp((game.home_rest - game.away_rest) / 7.0, -2.0, 2.0),
    ]


def elo_probability(game: Game, ratings: dict[str, float]) -> float:
    home = ratings.get(game.home, 1500.0)
    away = ratings.get(game.away, 1500.0)
    advantage = HOME_ADVANTAGE * game.home_field
    return 1.0 / (1.0 + 10.0 ** (-(home + advantage - away) / 400.0))


def update_state(game: Game, ratings: dict[str, float], teams: dict[str, TeamState]) -> None:
    home_won = int(game.home_score > game.away_score)
    expected = elo_probability(game, ratings)
    margin = abs(game.home_score - game.away_score)
    change = K_FACTOR * min(1.8, 1.0 + math.log1p(margin) / 4.5) * (home_won - expected)
    ratings[game.home] = ratings.get(game.home, 1500.0) + change
    ratings[game.away] = ratings.get(game.away, 1500.0) - change

    home = teams.setdefault(game.home, create_state())
    away = teams.setdefault(game.away, create_state())
    home.games += 1
    home.wins += home_won
    home.point_diff += game.home_score - game.away_score
    home.recent = [*home.recent[-4:], home_won]
    home.last_game = game.gameday
    away.games += 1
    away.wins += 1 - home_won
    away.point_diff += game.away_score - game.home_score
    away.recent = [*away.recent[-4:], 1 - home_won]
    away.last_game = game.gameday


def regress_season(ratings: dict[str, float], teams: dict[str, TeamState]) -> None:
    for team, rating in ratings.items():
        ratings[team] = 1500.0 + (rating - 1500.0) * (1.0 - SEASON_REGRESSION)
    teams.clear()


def build_examples(games: list[Game]) -> tuple[list[list[float]], list[int], dict[int, dict[str, float]]]:
    ratings: dict[str, float] = {}
    teams: dict[str, TeamState] = {}
    examples: list[list[float]] = []
    targets: list[int] = []
    start_ratings: dict[int, dict[str, float]] = {}
    previous_season: int | None = None
    for game in games:
        if previous_season is not None and game.season != previous_season:
            regress_season(ratings, teams)
        if game.season not in start_ratings:
            start_ratings[game.season] = dict(ratings)
        previous_season = game.season
        examples.append(feature_vector(game, ratings, teams))
        targets.append(int(game.home_score > game.away_score))
        update_state(game, ratings, teams)
    regress_season(ratings, teams)
    start_ratings[max(game.season for game in games) + 1] = dict(ratings)
    return examples, targets, start_ratings


def fit_logistic(features: list[list[float]], targets: list[int], epochs: int = 900) -> list[float]:
    coefficients = [0.0] * len(FEATURES)
    count = max(1, len(features))
    regularization = 0.012
    for epoch in range(epochs):
        gradients = [0.0] * len(coefficients)
        for row, target in zip(features, targets, strict=True):
            probability = sigmoid(sum(weight * value for weight, value in zip(coefficients, row, strict=True)))
            error = probability - target
            for index, value in enumerate(row):
                gradients[index] += error * value
        learning_rate = 0.42 / math.sqrt(1.0 + epoch / 80.0)
        for index in range(len(coefficients)):
            penalty = 0.0 if index == 0 else regularization * coefficients[index]
            coefficients[index] -= learning_rate * (gradients[index] / count + penalty)
    return coefficients


def metrics(features: list[list[float]], targets: list[int], coefficients: list[float]) -> dict[str, float | int]:
    probabilities = [
        clamp(sigmoid(sum(weight * value for weight, value in zip(coefficients, row, strict=True))), 0.01, 0.99)
        for row in features
    ]
    count = max(1, len(targets))
    correct = sum(int((probability >= 0.5) == bool(target)) for probability, target in zip(probabilities, targets, strict=True))
    home_wins = sum(targets)
    brier = sum((probability - target) ** 2 for probability, target in zip(probabilities, targets, strict=True)) / count
    log_loss = -sum(
        target * math.log(probability) + (1 - target) * math.log(1 - probability)
        for probability, target in zip(probabilities, targets, strict=True)
    ) / count
    return {
        "games": len(targets),
        "correct": correct,
        "accuracy": correct / count,
        "brierScore": brier,
        "logLoss": log_loss,
        "homeWinBaseline": home_wins / count,
        "liftOverBaseline": correct / count - home_wins / count,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Train the production NFL team model on 15 leakage-safe seasons.")
    parser.add_argument("--source", default=NFLVERSE_GAMES_URL, help="nflverse games.csv URL or a local CSV path")
    parser.add_argument("--end-season", type=int, default=2025, help="Most recent completed season")
    parser.add_argument("--seasons", type=int, default=15, help="Number of complete seasons (minimum 15)")
    parser.add_argument(
        "--output",
        type=Path,
        default=Path(__file__).resolve().parents[2] / "frontend" / "data" / "nfl-model-v2.json",
    )
    args = parser.parse_args()
    if args.seasons < 15:
        raise ValueError("Production NFL training requires at least 15 complete seasons.")
    start_season = args.end_season - args.seasons + 1
    games = load_games(args.source, start_season, args.end_season)
    examples, targets, start_ratings = build_examples(games)
    holdout_start = next(index for index, game in enumerate(games) if game.season == args.end_season)
    train_features = examples[:holdout_start]
    train_targets = targets[:holdout_start]
    holdout_features = examples[holdout_start:]
    holdout_targets = targets[holdout_start:]
    holdout_coefficients = fit_logistic(train_features, train_targets)
    production_coefficients = fit_logistic(examples, targets)
    holdout_metrics = metrics(holdout_features, holdout_targets, holdout_coefficients)

    artifact = {
        "modelVersion": "nfl-history-logit-v2",
        "trainedAt": datetime.now(timezone.utc).isoformat(),
        "source": NFLVERSE_GAMES_URL,
        "features": FEATURES,
        "trainingStart": start_season,
        "trainedThrough": args.end_season,
        "seasons": list(range(start_season, args.end_season + 1)),
        "trainingGames": len(games),
        "holdoutSeason": args.end_season,
        "holdoutMetrics": holdout_metrics,
        "checkpoints": {
            str(args.end_season): {
                "coefficients": [round(value, 10) for value in holdout_coefficients],
                "ratings": {team: round(value, 6) for team, value in sorted(start_ratings[args.end_season].items())},
            },
            str(args.end_season + 1): {
                "coefficients": [round(value, 10) for value in production_coefficients],
                "ratings": {team: round(value, 6) for team, value in sorted(start_ratings[args.end_season + 1].items())},
            },
        },
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(artifact, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"output": str(args.output), **holdout_metrics, "seasons": args.seasons}, indent=2))


if __name__ == "__main__":
    main()
