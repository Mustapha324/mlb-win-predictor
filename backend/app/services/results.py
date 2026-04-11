from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime, timezone
from typing import Any

import requests
from sqlalchemy import select

from app.core.config import settings
from app.db.database import SessionLocal
from app.models.prediction import Prediction
from app.services.training_pipeline import run_training_pipeline

FINAL_STATES = {"F", "O"}
POSTPONED_STATES = {"D", "S", "C"}


def _normalize_team(value: str | None) -> str:
    return (value or "").strip().lower()



def _fetch_schedule_for_date(target_date: date) -> list[dict[str, Any]]:
    """Return all games for a date from the MLB Stats API schedule endpoint."""
    try:
        response = requests.get(
            f"{settings.mlb_stats_api_base}/schedule",
            params={"sportId": 1, "date": target_date.isoformat()},
            timeout=15,
        )
        response.raise_for_status()
    except requests.RequestException:
        return []

    dates = response.json().get("dates", [])
    if not dates:
        return []
    return dates[0].get("games", [])


def _extract_result_payload(game: dict[str, Any]) -> dict[str, Any]:
    teams = game.get("teams", {})
    away = teams.get("away", {})
    home = teams.get("home", {})

    away_score = away.get("score")
    home_score = home.get("score")

    away_team = away.get("team", {}).get("name")
    home_team = home.get("team", {}).get("name")

    status = game.get("status", {})
    coded_state = status.get("codedGameState")
    detailed_state = status.get("detailedState") or status.get("abstractGameState") or "Unknown"

    winner: str | None = None
    if isinstance(home_score, int) and isinstance(away_score, int):
        if home_score > away_score:
            winner = home_team
        elif away_score > home_score:
            winner = away_team

    return {
        "game_id": str(game.get("gamePk")),
        "game_date": game.get("officialDate"),
        "away_team": away_team,
        "home_team": home_team,
        "away_score": away_score if isinstance(away_score, int) else None,
        "home_score": home_score if isinstance(home_score, int) else None,
        "actual_winner": winner,
        "status": detailed_state,
        "coded_state": coded_state,
    }


def _build_results_index(games: list[dict[str, Any]]) -> tuple[dict[str, dict[str, Any]], dict[tuple[str, str, str], dict[str, Any]]]:
    by_game_id: dict[str, dict[str, Any]] = {}
    by_teams: dict[tuple[str, str, str], dict[str, Any]] = {}

    for game in games:
        payload = _extract_result_payload(game)
        game_id = payload["game_id"]
        by_game_id[game_id] = payload

        game_date = payload.get("game_date")
        if not isinstance(game_date, str):
            continue
        team_key = (
            game_date,
            _normalize_team(payload.get("away_team")),
            _normalize_team(payload.get("home_team")),
        )
        by_teams[team_key] = payload

    return by_game_id, by_teams


def _is_final(coded_state: str | None, status: str | None) -> bool:
    if coded_state in FINAL_STATES:
        return True
    return bool(status and status.lower() == "final")


def _is_non_playable(coded_state: str | None, status: str | None) -> bool:
    if coded_state in POSTPONED_STATES:
        return True
    return bool(status and status.lower() in {"postponed", "suspended", "cancelled"})


def _prediction_needs_update(prediction: Prediction, result: dict[str, Any]) -> bool:
    return any(
        [
            prediction.actual_winner != result.get("actual_winner"),
            prediction.away_score != result.get("away_score"),
            prediction.home_score != result.get("home_score"),
            prediction.status != result.get("status"),
        ]
    )


def compute_metrics_snapshot() -> dict[str, Any]:
    """Compute metrics from finalized predictions only."""
    with SessionLocal() as session:
        finalized = (
            session.execute(
                select(Prediction).where(Prediction.actual_winner.is_not(None))
            )
            .scalars()
            .all()
        )

    total = len(finalized)
    correct = sum(1 for p in finalized if p.was_correct is True)
    accuracy = (correct / total) if total else 0.0

    brier_score: float | None = None
    usable_for_brier = [
        p
        for p in finalized
        if p.home_win_probability is not None
        and p.away_win_probability is not None
        and p.actual_winner in {p.home_team, p.away_team}
    ]
    if usable_for_brier:
        total_sq_err = 0.0
        for p in usable_for_brier:
            actual_home = 1.0 if p.actual_winner == p.home_team else 0.0
            total_sq_err += (float(p.home_win_probability) - actual_home) ** 2
        brier_score = total_sq_err / len(usable_for_brier)

    latest_updated = max((p.results_synced_at for p in finalized if p.results_synced_at), default=None)

    return {
        "total_predictions_evaluated": total,
        "correct_predictions": correct,
        "accuracy": round(accuracy, 4),
        "brier_score": round(brier_score, 4) if brier_score is not None else None,
        "last_results_sync": latest_updated.isoformat() if latest_updated else None,
    }


def update_pending_results() -> dict[str, Any]:
    """Sync unresolved predictions with final MLB scores and refresh derived metrics."""
    with SessionLocal() as session:
        unresolved_predictions = (
            session.execute(
                select(Prediction).where(Prediction.actual_winner.is_(None))
            )
            .scalars()
            .all()
        )

        if not unresolved_predictions:
            metrics = compute_metrics_snapshot()
            return {
                "checked_predictions": 0,
                "updated_predictions": 0,
                "unresolved_predictions": 0,
                "updated_metrics": metrics,
            }

        by_date: dict[date, list[Prediction]] = defaultdict(list)
        for prediction in unresolved_predictions:
            by_date[prediction.game_date].append(prediction)

        updated_predictions = 0
        still_unresolved = 0
        finalized_dates: set[date] = set()

        for game_date, predictions in by_date.items():
            schedule_games = _fetch_schedule_for_date(game_date)
            if not schedule_games:
                still_unresolved += len(predictions)
                continue

            by_game_id, by_teams = _build_results_index(schedule_games)

            for prediction in predictions:
                result = by_game_id.get(str(prediction.game_id))
                if result is None:
                    team_key = (
                        prediction.game_date.isoformat(),
                        _normalize_team(prediction.away_team),
                        _normalize_team(prediction.home_team),
                    )
                    result = by_teams.get(team_key)

                if result is None:
                    still_unresolved += 1
                    continue

                coded_state = result.get("coded_state")
                status = result.get("status")

                if _is_non_playable(coded_state, status):
                    prediction.status = status
                    prediction.results_synced_at = datetime.now(timezone.utc)
                    updated_predictions += 1
                    continue

                if not _is_final(coded_state, status):
                    still_unresolved += 1
                    continue

                if not _prediction_needs_update(prediction, result):
                    continue

                prediction.actual_winner = result.get("actual_winner")
                prediction.away_score = result.get("away_score")
                prediction.home_score = result.get("home_score")
                prediction.status = result.get("status")
                prediction.was_correct = prediction.actual_winner == prediction.predicted_winner
                prediction.results_synced_at = datetime.now(timezone.utc)
                updated_predictions += 1
                finalized_dates.add(prediction.game_date)

        session.commit()

    metrics = compute_metrics_snapshot()
    retraining_summary: dict[str, Any] | None = None
    if finalized_dates:
        start_date = min(finalized_dates)
        end_date = max(finalized_dates)
        try:
            training_metrics = run_training_pipeline(start_date=start_date, end_date=end_date)
            retraining_summary = {
                "status": "ok",
                "start_date": start_date.isoformat(),
                "end_date": end_date.isoformat(),
                "last_trained_at": training_metrics.get("last_trained_at"),
                "total_training_examples": training_metrics.get("total_training_examples"),
                "calibration_method": training_metrics.get("calibration_method"),
            }
        except Exception as exc:
            retraining_summary = {
                "status": "failed",
                "start_date": start_date.isoformat(),
                "end_date": end_date.isoformat(),
                "error": str(exc),
            }

    return {
        "checked_predictions": len(unresolved_predictions),
        "updated_predictions": updated_predictions,
        "unresolved_predictions": still_unresolved,
        "updated_metrics": metrics,
        "retraining": retraining_summary,
    }
