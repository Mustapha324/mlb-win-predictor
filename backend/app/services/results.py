from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
import logging
from typing import Any

import requests
from sqlalchemy import select

from app.core.config import settings
from app.db.database import SessionLocal
from app.models.prediction import Prediction
from app.services.training_pipeline import run_training_pipeline

FINAL_STATES = {"F", "O"}
POSTPONED_STATES = {"D", "S", "C"}
logger = logging.getLogger(__name__)


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


def _is_prediction_finalized(prediction: Prediction) -> bool:
    if prediction.actual_winner is None:
        return False
    return prediction.actual_winner in {prediction.home_team, prediction.away_team}


def compute_metrics_snapshot() -> dict[str, Any]:
    """Compute metrics from finalized predictions and expose unresolved sync status."""
    with SessionLocal() as session:
        all_predictions = session.execute(select(Prediction)).scalars().all()

    finalized_predictions = [p for p in all_predictions if _is_prediction_finalized(p)]
    total = len(finalized_predictions)
    correct = sum(1 for p in finalized_predictions if p.was_correct is True)
    accuracy = (correct / total) if total else 0.0

    brier_score: float | None = None
    usable_for_brier = [
        p
        for p in finalized_predictions
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

    latest_updated = max((p.results_synced_at for p in all_predictions if p.results_synced_at), default=None)
    unresolved_predictions_remaining = sum(1 for p in all_predictions if not _is_prediction_finalized(p))

    return {
        "total_predictions_evaluated": total,
        "correct_predictions": correct,
        "accuracy": round(accuracy, 4),
        "brier_score": round(brier_score, 4) if brier_score is not None else None,
        "last_results_sync": latest_updated.isoformat() if latest_updated else None,
        "unresolved_predictions_remaining": unresolved_predictions_remaining,
    }


def _match_result(
    prediction: Prediction,
    by_game_id: dict[str, dict[str, Any]],
    by_teams: dict[tuple[str, str, str], dict[str, Any]],
) -> dict[str, Any] | None:
    result = by_game_id.get(str(prediction.game_id))
    if result is not None:
        return result

    team_key = (
        prediction.game_date.isoformat(),
        _normalize_team(prediction.away_team),
        _normalize_team(prediction.home_team),
    )
    return by_teams.get(team_key)


def _apply_result_update(prediction: Prediction, result: dict[str, Any], now: datetime) -> None:
    prediction.actual_winner = result.get("actual_winner")
    prediction.away_score = result.get("away_score")
    prediction.home_score = result.get("home_score")
    prediction.status = result.get("status")
    prediction.was_correct = prediction.actual_winner == prediction.predicted_winner
    prediction.results_synced_at = now


def update_pending_results(recent_days: int | None = None, include_correction_checks: bool = True) -> dict[str, Any]:
    """Sync unresolved predictions, optionally checking recent finalized rows for score corrections."""
    lookback_start: date | None = None
    if recent_days is not None and recent_days > 0:
        lookback_start = date.today() - timedelta(days=recent_days)

    with SessionLocal() as session:
        all_predictions = session.execute(select(Prediction)).scalars().all()
        total_history_records = len(all_predictions)

        unresolved_stmt = select(Prediction).where(Prediction.actual_winner.is_(None))
        if lookback_start is not None:
            unresolved_stmt = unresolved_stmt.where(Prediction.game_date >= lookback_start)
        unresolved_predictions = session.execute(unresolved_stmt).scalars().all()

        by_date: dict[date, list[Prediction]] = defaultdict(list)
        for prediction in unresolved_predictions:
            by_date[prediction.game_date].append(prediction)

        correction_candidates: list[Prediction] = []
        if include_correction_checks and by_date:
            correction_stmt = select(Prediction).where(
                Prediction.actual_winner.is_not(None),
                Prediction.game_date.in_(list(by_date.keys())),
            )
            correction_candidates = session.execute(correction_stmt).scalars().all()
            for prediction in correction_candidates:
                by_date[prediction.game_date].append(prediction)

        if not by_date:
            metrics = compute_metrics_snapshot()
            return {
                "total_history_records": total_history_records,
                "unresolved_records_checked": 0,
                "dates_queried": 0,
                "newly_updated_records": 0,
                "already_final_records": 0,
                "unmatched_records": 0,
                "postponed_or_suspended_records": 0,
                "updated_metrics": metrics,
                "retraining": None,
            }

        newly_updated_records = 0
        unmatched_records = 0
        postponed_or_suspended_records = 0
        already_final_records = 0
        finalized_dates: set[date] = set()
        now = datetime.now(timezone.utc)

        for game_date, predictions in by_date.items():
            schedule_games = _fetch_schedule_for_date(game_date)
            if not schedule_games:
                logger.info("results.sync no schedule data for %s", game_date.isoformat())
                unmatched_records += len(predictions)
                continue

            by_game_id, by_teams = _build_results_index(schedule_games)

            for prediction in predictions:
                result = _match_result(prediction, by_game_id, by_teams)
                if result is None:
                    unmatched_records += 1
                    continue

                coded_state = result.get("coded_state")
                status = result.get("status")

                if _is_non_playable(coded_state, status):
                    if prediction.status != status:
                        prediction.status = status
                        prediction.results_synced_at = now
                        newly_updated_records += 1
                    postponed_or_suspended_records += 1
                    continue

                if not _is_final(coded_state, status):
                    continue

                if not _prediction_needs_update(prediction, result):
                    already_final_records += 1
                    continue

                _apply_result_update(prediction, result, now)
                newly_updated_records += 1
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
        "total_history_records": total_history_records,
        "unresolved_records_checked": len(unresolved_predictions),
        "dates_queried": len(by_date),
        "newly_updated_records": newly_updated_records,
        "already_final_records": already_final_records,
        "unmatched_records": unmatched_records,
        "postponed_or_suspended_records": postponed_or_suspended_records,
        "updated_metrics": metrics,
        "retraining": retraining_summary,
    }
