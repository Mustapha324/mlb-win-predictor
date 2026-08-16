"""Build a compact, reproducible MLB results dataset and portable Elo snapshot.

The script intentionally uses only the public MLB schedule endpoint.  That keeps
the refresh fast (one request per season) and avoids thousands of game-feed
requests while still producing leakage-free, pregame Elo ratings.
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import time
from collections import defaultdict, deque
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Any
from urllib.error import URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


SCHEDULE_URL = "https://statsapi.mlb.com/api/v1/schedule"
DEFAULT_START_SEASON = 2021
DEFAULT_END_SEASON = 2025
DEFAULT_DATASET = Path("backend/data/processed/recent_game_results.csv")
DEFAULT_SNAPSHOT = Path("frontend/data/model-snapshot.json")
DEFAULT_RATING = 1500.0

TEAM_PRESENTATION: dict[int, tuple[str, str, str]] = {
    108: ("LAA", "#ba0021", "#ffffff"),
    109: ("AZ", "#a71930", "#e3d4ad"),
    110: ("BAL", "#df4601", "#000000"),
    111: ("BOS", "#bd3039", "#0c2340"),
    112: ("CHC", "#0e3386", "#cc3433"),
    113: ("CIN", "#c6011f", "#ffffff"),
    114: ("CLE", "#e31937", "#0c2340"),
    115: ("COL", "#333366", "#c4ced4"),
    116: ("DET", "#0c2340", "#fa4616"),
    117: ("HOU", "#002d62", "#eb6e1f"),
    118: ("KC", "#004687", "#bd9b60"),
    119: ("LAD", "#005a9c", "#ef3e42"),
    120: ("WSH", "#ab0003", "#14225a"),
    121: ("NYM", "#002d72", "#ff5910"),
    133: ("ATH", "#003831", "#efb21e"),
    134: ("PIT", "#27251f", "#fdb827"),
    135: ("SD", "#2f241d", "#ffc425"),
    136: ("SEA", "#0c2c56", "#005c5c"),
    137: ("SF", "#fd5a1e", "#27251f"),
    138: ("STL", "#c41e3a", "#0c2340"),
    139: ("TB", "#092c5c", "#8fbce6"),
    140: ("TEX", "#003278", "#c0111f"),
    141: ("TOR", "#134a8e", "#e8291c"),
    142: ("MIN", "#002b5c", "#d31145"),
    143: ("PHI", "#e81828", "#002d72"),
    144: ("ATL", "#ce1141", "#13274f"),
    145: ("CWS", "#27251f", "#c4ced4"),
    146: ("MIA", "#00a3e0", "#ef3340"),
    147: ("NYY", "#0c2340", "#c4ced3"),
    158: ("MIL", "#12284b", "#ffc52f"),
}


@dataclass(frozen=True)
class GameResult:
    game_id: int
    game_date: str
    season: int
    away_team_id: int
    away_team: str
    home_team_id: int
    home_team: str
    away_score: int
    home_score: int

    @property
    def home_won(self) -> int:
        return int(self.home_score > self.away_score)


def fetch_json(url: str, params: dict[str, str | int], retries: int = 3) -> dict[str, Any]:
    request_url = f"{url}?{urlencode(params)}"
    request = Request(request_url, headers={"User-Agent": "mlb-win-predictor/1.0"})
    last_error: Exception | None = None
    for attempt in range(retries):
        try:
            with urlopen(request, timeout=90) as response:  # noqa: S310 - fixed HTTPS origin
                payload = json.load(response)
            if not isinstance(payload, dict):
                raise ValueError("MLB Stats API returned a non-object payload")
            return payload
        except (TimeoutError, URLError, ValueError) as exc:
            last_error = exc
            if attempt + 1 < retries:
                time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(f"Unable to fetch MLB data after {retries} attempts: {last_error}")


def fetch_season(season: int) -> list[GameResult]:
    payload = fetch_json(
        SCHEDULE_URL,
        {
            "sportId": 1,
            "season": season,
            "gameTypes": "R",
            "hydrate": "team",
        },
    )
    results: list[GameResult] = []
    for day in payload.get("dates", []):
        for game in day.get("games", []):
            status = game.get("status", {})
            if status.get("abstractGameState") != "Final":
                continue
            teams = game.get("teams", {})
            away = teams.get("away", {})
            home = teams.get("home", {})
            away_team = away.get("team", {})
            home_team = home.get("team", {})
            required = (
                game.get("gamePk"),
                game.get("officialDate"),
                away_team.get("id"),
                away_team.get("name"),
                home_team.get("id"),
                home_team.get("name"),
                away.get("score"),
                home.get("score"),
            )
            if any(value is None for value in required):
                continue
            if int(away["score"]) == int(home["score"]):
                continue
            results.append(
                GameResult(
                    game_id=int(game["gamePk"]),
                    game_date=str(game["officialDate"]),
                    season=season,
                    away_team_id=int(away_team["id"]),
                    away_team=str(away_team["name"]),
                    home_team_id=int(home_team["id"]),
                    home_team=str(home_team["name"]),
                    away_score=int(away["score"]),
                    home_score=int(home["score"]),
                )
            )
    return sorted(results, key=lambda item: (item.game_date, item.game_id))


def win_probability(home_rating: float, away_rating: float, home_advantage: float) -> float:
    rating_edge = home_rating + home_advantage - away_rating
    return 1.0 / (1.0 + 10.0 ** (-rating_edge / 400.0))


def update_ratings(
    ratings: dict[int, float], game: GameResult, probability: float, k_factor: float
) -> None:
    outcome = float(game.home_won)
    margin = abs(game.home_score - game.away_score)
    margin_multiplier = min(1.75, 1.0 + math.log1p(margin) / 5.0)
    change = k_factor * margin_multiplier * (outcome - probability)
    ratings[game.home_team_id] += change
    ratings[game.away_team_id] -= change


def regress_ratings(ratings: dict[int, float], regression: float) -> None:
    for team_id, rating in list(ratings.items()):
        ratings[team_id] = DEFAULT_RATING + (rating - DEFAULT_RATING) * (1.0 - regression)


def evaluate(
    games: list[GameResult],
    k_factor: float,
    home_advantage: float,
    regression: float,
    evaluate_season: int,
) -> dict[str, float | int]:
    ratings: dict[int, float] = defaultdict(lambda: DEFAULT_RATING)
    previous_season: int | None = None
    probabilities: list[float] = []
    outcomes: list[int] = []

    for game in games:
        if previous_season is not None and game.season != previous_season:
            regress_ratings(ratings, regression)
        previous_season = game.season
        probability = win_probability(
            ratings[game.home_team_id], ratings[game.away_team_id], home_advantage
        )
        if game.season == evaluate_season:
            probabilities.append(probability)
            outcomes.append(game.home_won)
        update_ratings(ratings, game, probability, k_factor)

    if not probabilities:
        raise ValueError(f"No games found for evaluation season {evaluate_season}")

    correct = sum(int((probability >= 0.5) == bool(outcome)) for probability, outcome in zip(probabilities, outcomes))
    brier = sum((probability - outcome) ** 2 for probability, outcome in zip(probabilities, outcomes)) / len(outcomes)
    log_loss = -sum(
        outcome * math.log(max(probability, 1e-9))
        + (1 - outcome) * math.log(max(1.0 - probability, 1e-9))
        for probability, outcome in zip(probabilities, outcomes)
    ) / len(outcomes)
    home_wins = sum(outcomes)
    home_baseline_correct = max(home_wins, len(outcomes) - home_wins)
    return {
        "games": len(outcomes),
        "correct": correct,
        "accuracy": round(correct / len(outcomes), 6),
        "brier_score": round(brier, 6),
        "log_loss": round(log_loss, 6),
        "home_win_rate": round(home_wins / len(outcomes), 6),
        "majority_baseline_accuracy": round(home_baseline_correct / len(outcomes), 6),
    }


def select_hyperparameters(games: list[GameResult], validation_season: int) -> dict[str, float]:
    candidates: list[tuple[float, float, float, float]] = []
    for k_factor in (12.0, 16.0, 20.0, 24.0, 28.0):
        for home_advantage in (20.0, 30.0, 40.0, 50.0, 60.0):
            for regression in (0.15, 0.25, 0.35, 0.45):
                metrics = evaluate(
                    games,
                    k_factor=k_factor,
                    home_advantage=home_advantage,
                    regression=regression,
                    evaluate_season=validation_season,
                )
                candidates.append(
                    (float(metrics["brier_score"]), k_factor, home_advantage, regression)
                )
    _, k_factor, home_advantage, regression = min(candidates)
    return {
        "k_factor": k_factor,
        "home_advantage": home_advantage,
        "season_regression": regression,
    }


def _team_feature_state() -> dict[str, Any]:
    return {
        "games": 0,
        "wins": 0,
        "run_diff": 0,
        "home_games": 0,
        "home_wins": 0,
        "away_games": 0,
        "away_wins": 0,
        "recent": deque(maxlen=10),
    }


def _rate(numerator: int, denominator: int, default: float = 0.5) -> float:
    return numerator / denominator if denominator else default


def build_pregame_rows(
    games: list[GameResult], hyperparameters: dict[str, float]
) -> list[tuple[int, list[float], int]]:
    """Create leakage-free features using state available before each game."""
    ratings: dict[int, float] = defaultdict(lambda: DEFAULT_RATING)
    season_state: dict[int, dict[str, Any]] = defaultdict(_team_feature_state)
    previous_season: int | None = None
    rows: list[tuple[int, list[float], int]] = []

    for game in games:
        if previous_season is not None and game.season != previous_season:
            regress_ratings(ratings, hyperparameters["season_regression"])
            season_state = defaultdict(_team_feature_state)
        previous_season = game.season
        home = season_state[game.home_team_id]
        away = season_state[game.away_team_id]
        elo_probability = win_probability(
            ratings[game.home_team_id],
            ratings[game.away_team_id],
            hyperparameters["home_advantage"],
        )
        elo_logit = math.log(elo_probability / (1.0 - elo_probability))
        home_recent = _rate(sum(home["recent"]), len(home["recent"]))
        away_recent = _rate(sum(away["recent"]), len(away["recent"]))
        features = [
            elo_logit,
            _rate(home["wins"], home["games"]) - _rate(away["wins"], away["games"]),
            home_recent - away_recent,
            _rate(home["run_diff"], home["games"], 0.0)
            - _rate(away["run_diff"], away["games"], 0.0),
            _rate(home["home_wins"], home["home_games"])
            - _rate(away["away_wins"], away["away_games"]),
        ]
        rows.append((game.season, features, game.home_won))

        update_ratings(ratings, game, elo_probability, hyperparameters["k_factor"])
        for state, won, run_diff, side in (
            (home, game.home_won, game.home_score - game.away_score, "home"),
            (away, 1 - game.home_won, game.away_score - game.home_score, "away"),
        ):
            state["games"] += 1
            state["wins"] += won
            state["run_diff"] += run_diff
            state["recent"].append(won)
            state[f"{side}_games"] += 1
            state[f"{side}_wins"] += won
    return rows


def _solve_linear_system(matrix: list[list[float]], vector: list[float]) -> list[float]:
    size = len(vector)
    augmented = [row[:] + [vector[index]] for index, row in enumerate(matrix)]
    for column in range(size):
        pivot = max(range(column, size), key=lambda row: abs(augmented[row][column]))
        augmented[column], augmented[pivot] = augmented[pivot], augmented[column]
        divisor = augmented[column][column]
        if abs(divisor) < 1e-10:
            continue
        for entry in range(column, size + 1):
            augmented[column][entry] /= divisor
        for row in range(size):
            if row == column:
                continue
            factor = augmented[row][column]
            for entry in range(column, size + 1):
                augmented[row][entry] -= factor * augmented[column][entry]
    return [augmented[index][size] for index in range(size)]


def fit_portable_logistic_model(
    rows: list[tuple[int, list[float], int]], train_through_season: int
) -> dict[str, Any]:
    training = [(features, outcome) for season, features, outcome in rows if season <= train_through_season]
    feature_count = len(training[0][0])
    means = [sum(item[0][index] for item in training) / len(training) for index in range(feature_count)]
    scales = []
    for index in range(feature_count):
        variance = sum((item[0][index] - means[index]) ** 2 for item in training) / len(training)
        scales.append(max(math.sqrt(variance), 1e-6))

    standardized = [
        ([1.0, *[(features[index] - means[index]) / scales[index] for index in range(feature_count)]], outcome)
        for features, outcome in training
    ]
    weights = [0.0] * (feature_count + 1)
    regularization = 0.45
    for _ in range(18):
        gradient = [0.0] * len(weights)
        information = [[0.0] * len(weights) for _ in weights]
        for features, outcome in standardized:
            score = sum(weight * value for weight, value in zip(weights, features))
            probability = 1.0 / (1.0 + math.exp(-max(-30.0, min(30.0, score))))
            residual = outcome - probability
            curvature = max(probability * (1.0 - probability), 1e-8)
            for row_index, row_value in enumerate(features):
                gradient[row_index] += row_value * residual
                for column_index, column_value in enumerate(features):
                    information[row_index][column_index] += row_value * column_value * curvature
        for index in range(1, len(weights)):
            gradient[index] -= regularization * weights[index]
            information[index][index] += regularization
        change = _solve_linear_system(information, gradient)
        weights = [weight + delta for weight, delta in zip(weights, change)]
        if max(abs(delta) for delta in change) < 1e-7:
            break

    return {
        "feature_names": [
            "elo_logit",
            "season_win_pct_edge",
            "last_10_win_pct_edge",
            "season_run_diff_per_game_edge",
            "home_away_split_edge",
        ],
        "means": [round(value, 8) for value in means],
        "scales": [round(value, 8) for value in scales],
        "weights": [round(value, 8) for value in weights],
        "trained_through_season": train_through_season,
    }


def evaluate_portable_model(
    rows: list[tuple[int, list[float], int]], model: dict[str, Any], evaluate_season: int
) -> dict[str, float | int]:
    probabilities: list[float] = []
    outcomes: list[int] = []
    for season, raw_features, outcome in rows:
        if season != evaluate_season:
            continue
        features = [
            1.0,
            *[
                (raw_features[index] - model["means"][index]) / model["scales"][index]
                for index in range(len(raw_features))
            ],
        ]
        score = sum(weight * value for weight, value in zip(model["weights"], features))
        probability = 1.0 / (1.0 + math.exp(-max(-30.0, min(30.0, score))))
        probabilities.append(max(0.2, min(0.8, probability)))
        outcomes.append(outcome)

    correct = sum(int((probability >= 0.5) == bool(outcome)) for probability, outcome in zip(probabilities, outcomes))
    brier = sum((probability - outcome) ** 2 for probability, outcome in zip(probabilities, outcomes)) / len(outcomes)
    log_loss = -sum(
        outcome * math.log(probability) + (1 - outcome) * math.log(1.0 - probability)
        for probability, outcome in zip(probabilities, outcomes)
    ) / len(outcomes)
    home_wins = sum(outcomes)
    return {
        "games": len(outcomes),
        "correct": correct,
        "accuracy": round(correct / len(outcomes), 6),
        "brier_score": round(brier, 6),
        "log_loss": round(log_loss, 6),
        "home_win_rate": round(home_wins / len(outcomes), 6),
        "majority_baseline_accuracy": round(max(home_wins, len(outcomes) - home_wins) / len(outcomes), 6),
    }


def build_snapshot(games: list[GameResult], start_season: int, end_season: int) -> dict[str, Any]:
    validation_season = max(start_season + 1, end_season - 1)
    hyperparameters = select_hyperparameters(games, validation_season)
    evaluation_args = {
        "k_factor": hyperparameters["k_factor"],
        "home_advantage": hyperparameters["home_advantage"],
        "regression": hyperparameters["season_regression"],
    }
    pregame_rows = build_pregame_rows(games, hyperparameters)
    portable_model = fit_portable_logistic_model(
        pregame_rows, train_through_season=end_season - 1
    )
    holdout_metrics = evaluate_portable_model(
        pregame_rows, portable_model, evaluate_season=end_season
    )
    validation_metrics = evaluate(
        games,
        **evaluation_args,
        evaluate_season=validation_season,
    )

    ratings: dict[int, float] = defaultdict(lambda: DEFAULT_RATING)
    recent_results: dict[int, deque[tuple[int, int]]] = defaultdict(lambda: deque(maxlen=30))
    team_names: dict[int, str] = {}
    previous_season: int | None = None
    for game in games:
        if previous_season is not None and game.season != previous_season:
            regress_ratings(ratings, hyperparameters["season_regression"])
            recent_results = defaultdict(lambda: deque(maxlen=30))
        previous_season = game.season
        probability = win_probability(
            ratings[game.home_team_id],
            ratings[game.away_team_id],
            hyperparameters["home_advantage"],
        )
        update_ratings(ratings, game, probability, hyperparameters["k_factor"])
        team_names[game.home_team_id] = game.home_team
        team_names[game.away_team_id] = game.away_team
        recent_results[game.home_team_id].append(
            (game.home_won, game.home_score - game.away_score)
        )
        recent_results[game.away_team_id].append(
            (1 - game.home_won, game.away_score - game.home_score)
        )

    teams: dict[str, Any] = {}
    for team_id in sorted(team_names):
        presentation = TEAM_PRESENTATION.get(team_id, (team_names[team_id][:3].upper(), "#334155", "#e2e8f0"))
        recent = list(recent_results[team_id])
        teams[str(team_id)] = {
            "name": team_names[team_id],
            "abbreviation": presentation[0],
            "primary": presentation[1],
            "accent": presentation[2],
            "rating": round(ratings[team_id], 2),
            "last_30_win_pct": round(sum(item[0] for item in recent) / len(recent), 4) if recent else 0.5,
            "last_30_run_diff_per_game": round(sum(item[1] for item in recent) / len(recent), 3) if recent else 0.0,
        }

    return {
        "model_name": "Diamond Elo + live form",
        "version": "diamond-elo-v4",
        "description": "Leakage-free Elo, season form, last-10 form, run differential, and home/away splits trained chronologically on completed regular-season games, then adjusted with live probable-pitcher form.",
        "training_start": games[0].game_date,
        "trained_through": games[-1].game_date,
        "seasons": list(range(start_season, end_season + 1)),
        "games_trained": len(games),
        "validation_season": validation_season,
        "validation_metrics": validation_metrics,
        "holdout_season": end_season,
        "holdout_metrics": holdout_metrics,
        "hyperparameters": hyperparameters,
        "portable_model": portable_model,
        "teams": teams,
    }


def write_dataset(path: Path, games: list[GameResult]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle)
        writer.writerow(
            [
                "game_id",
                "game_date",
                "season",
                "away_team_id",
                "away_team",
                "home_team_id",
                "home_team",
                "away_score",
                "home_score",
                "home_team_won",
            ]
        )
        for game in games:
            writer.writerow(
                [
                    game.game_id,
                    game.game_date,
                    game.season,
                    game.away_team_id,
                    game.away_team,
                    game.home_team_id,
                    game.home_team,
                    game.away_score,
                    game.home_score,
                    game.home_won,
                ]
            )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--start-season", type=int, default=DEFAULT_START_SEASON)
    parser.add_argument("--end-season", type=int, default=DEFAULT_END_SEASON)
    parser.add_argument("--output", type=Path, default=DEFAULT_DATASET)
    parser.add_argument("--snapshot", type=Path, default=DEFAULT_SNAPSHOT)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if args.start_season >= args.end_season:
        raise SystemExit("Use at least two seasons so validation and holdout remain chronological.")
    if args.end_season >= date.today().year:
        raise SystemExit("The end season must be completed; current-season games are replayed live.")

    games: list[GameResult] = []
    for season in range(args.start_season, args.end_season + 1):
        season_games = fetch_season(season)
        print(f"Fetched {len(season_games):,} completed regular-season games for {season}.")
        games.extend(season_games)

    games.sort(key=lambda item: (item.game_date, item.game_id))
    write_dataset(args.output, games)
    snapshot = build_snapshot(games, args.start_season, args.end_season)
    args.snapshot.parent.mkdir(parents=True, exist_ok=True)
    args.snapshot.write_text(json.dumps(snapshot, indent=2) + "\n", encoding="utf-8")
    print(
        f"Saved {len(games):,} games to {args.output} and model snapshot to {args.snapshot}."
    )
    print(json.dumps(snapshot["holdout_metrics"], indent=2))


if __name__ == "__main__":
    main()
