from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timezone


@dataclass
class PredictionRecord:
    game_id: str
    game_date: str
    home_team: str
    away_team: str
    predicted_winner: str
    home_win_probability: float
    was_final_when_predicted: bool
    actual_winner: str | None = None
    was_correct: bool | None = None


@dataclass
class ModelMetric:
    model_name: str
    version: str
    wins: int
    losses: int
    accuracy: float
    updated_at: str


# Simulated persisted records.
_PREDICTIONS: list[PredictionRecord] = [
    PredictionRecord(
        game_id="20260409-chc-mil",
        game_date="2026-04-09",
        away_team="Chicago Cubs",
        home_team="Milwaukee Brewers",
        predicted_winner="Milwaukee Brewers",
        home_win_probability=0.61,
        was_final_when_predicted=False,
    ),
    PredictionRecord(
        game_id="20260408-sea-hou",
        game_date="2026-04-08",
        away_team="Seattle Mariners",
        home_team="Houston Astros",
        predicted_winner="Houston Astros",
        home_win_probability=0.57,
        was_final_when_predicted=False,
    ),
    PredictionRecord(
        game_id="20260407-cle-min",
        game_date="2026-04-07",
        away_team="Cleveland Guardians",
        home_team="Minnesota Twins",
        predicted_winner="Cleveland Guardians",
        home_win_probability=0.46,
        was_final_when_predicted=False,
    ),
    PredictionRecord(
        game_id="20260410-nyy-bos",
        game_date=date.today().isoformat(),
        away_team="New York Yankees",
        home_team="Boston Red Sox",
        predicted_winner="New York Yankees",
        home_win_probability=0.43,
        was_final_when_predicted=False,
    ),
    PredictionRecord(
        game_id="20260410-lad-sf",
        game_date=date.today().isoformat(),
        away_team="Los Angeles Dodgers",
        home_team="San Francisco Giants",
        predicted_winner="Los Angeles Dodgers",
        home_win_probability=0.38,
        was_final_when_predicted=False,
    ),
]

_MODEL_METRICS: list[ModelMetric] = [
    ModelMetric(
        model_name="xgboost_baseline",
        version="0.1.0",
        wins=0,
        losses=0,
        accuracy=0.0,
        updated_at="2026-04-01T00:00:00Z",
    )
]


# Simulated external game-status API response.
def _fetch_game_result(game_id: str) -> dict[str, object] | None:
    game_status = {
        "20260409-chc-mil": {"status": "Final", "home_score": 6, "away_score": 3},
        "20260408-sea-hou": {"status": "Final", "home_score": 4, "away_score": 2},
        "20260407-cle-min": {"status": "Final", "home_score": 1, "away_score": 5},
        "20260410-nyy-bos": {"status": "In Progress", "home_score": 2, "away_score": 4},
        "20260410-lad-sf": {"status": "Scheduled", "home_score": None, "away_score": None},
    }
    return game_status.get(game_id)


def _determine_winner(record: PredictionRecord, home_score: int, away_score: int) -> str:
    return record.home_team if home_score > away_score else record.away_team


def list_history() -> list[PredictionRecord]:
    return sorted(_PREDICTIONS, key=lambda p: p.game_date, reverse=True)


def list_today_predictions() -> list[PredictionRecord]:
    today = date.today().isoformat()
    return [record for record in _PREDICTIONS if record.game_date == today]


def update_pending_results() -> dict[str, float | int | str]:
    updated_count = 0
    for record in _PREDICTIONS:
        if record.was_final_when_predicted or record.actual_winner is not None:
            continue

        game_result = _fetch_game_result(record.game_id)
        if not game_result or game_result.get("status") != "Final":
            continue

        home_score = int(game_result["home_score"])
        away_score = int(game_result["away_score"])
        actual_winner = _determine_winner(record, home_score=home_score, away_score=away_score)

        record.actual_winner = actual_winner
        record.was_correct = actual_winner == record.predicted_winner
        updated_count += 1

    finalized_predictions = [record for record in _PREDICTIONS if record.actual_winner is not None]
    correct_count = sum(1 for record in finalized_predictions if record.was_correct)
    total_count = len(finalized_predictions)
    accuracy = (correct_count / total_count) if total_count else 0.0

    latest = _MODEL_METRICS[-1]
    refreshed_metric = ModelMetric(
        model_name=latest.model_name,
        version=latest.version,
        wins=correct_count,
        losses=total_count - correct_count,
        accuracy=accuracy,
        updated_at=datetime.now(timezone.utc).isoformat(),
    )
    _MODEL_METRICS.append(refreshed_metric)

    return {
        "updated_predictions": updated_count,
        "finalized_predictions": total_count,
        "correct_predictions": correct_count,
        "accuracy": round(accuracy, 3),
        "model_name": refreshed_metric.model_name,
        "version": refreshed_metric.version,
        "updated_at": refreshed_metric.updated_at,
    }


def get_latest_metric() -> ModelMetric:
    return _MODEL_METRICS[-1]
