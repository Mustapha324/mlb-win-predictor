"""FastAPI application entrypoint."""

import logging
import threading
from time import sleep

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import inspect, text

from app.core.config import settings
from app.db.database import Base, engine
from app.routes import games, health, metrics, predictions, results
from app.services import results as results_service

logger = logging.getLogger(__name__)
_sync_stop_event = threading.Event()
_sync_thread: threading.Thread | None = None

app = FastAPI(title=settings.app_name)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def create_tables() -> None:
    if engine is not None:
        Base.metadata.create_all(bind=engine)

        # Lightweight compatibility migration for existing local SQLite DBs.
        with engine.begin() as conn:
            inspector = inspect(conn)
            existing_columns = {col["name"] for col in inspector.get_columns("predictions")}
            if "actual_winner" not in existing_columns:
                conn.execute(text("ALTER TABLE predictions ADD COLUMN actual_winner VARCHAR(128)"))
            if "away_score" not in existing_columns:
                conn.execute(text("ALTER TABLE predictions ADD COLUMN away_score INTEGER"))
            if "home_score" not in existing_columns:
                conn.execute(text("ALTER TABLE predictions ADD COLUMN home_score INTEGER"))
            if "was_correct" not in existing_columns:
                conn.execute(text("ALTER TABLE predictions ADD COLUMN was_correct BOOLEAN"))
            if "status" not in existing_columns:
                conn.execute(text("ALTER TABLE predictions ADD COLUMN status VARCHAR(64) DEFAULT 'Scheduled'"))
            if "results_synced_at" not in existing_columns:
                conn.execute(text("ALTER TABLE predictions ADD COLUMN results_synced_at DATETIME"))

    # Startup catch-up sync for recent unresolved games so metrics are fresh on first load.
    try:
        summary = results_service.update_pending_results(recent_days=settings.results_sync_catchup_days)
        logger.info("startup catch-up results sync: %s", summary)
    except Exception:
        logger.exception("startup catch-up results sync failed")

    global _sync_thread
    if _sync_thread is None or not _sync_thread.is_alive():
        _sync_stop_event.clear()
        _sync_thread = threading.Thread(target=_run_periodic_results_sync, daemon=True)
        _sync_thread.start()


@app.on_event("shutdown")
def stop_background_sync() -> None:
    _sync_stop_event.set()
    if _sync_thread is not None and _sync_thread.is_alive():
        _sync_thread.join(timeout=2)


def _run_periodic_results_sync() -> None:
    """Background sync loop for local development runtime."""
    interval_seconds = max(1, settings.results_sync_interval_hours) * 60 * 60
    while not _sync_stop_event.is_set():
        sleep(interval_seconds)
        if _sync_stop_event.is_set():
            break
        try:
            summary = results_service.update_pending_results(recent_days=settings.results_sync_catchup_days)
            logger.info("periodic results sync: %s", summary)
        except Exception:
            logger.exception("periodic results sync failed")


app.include_router(health.router)
app.include_router(predictions.router, prefix=settings.api_prefix)
app.include_router(metrics.router, prefix=settings.api_prefix)
app.include_router(results.router, prefix=settings.api_prefix)
app.include_router(games.router, prefix=settings.api_prefix)
