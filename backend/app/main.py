"""FastAPI application entrypoint."""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import inspect, text

from app.core.config import settings
from app.db.database import Base, engine
from app.routes import games, health, metrics, predictions, results

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


app.include_router(health.router)
app.include_router(predictions.router, prefix=settings.api_prefix)
app.include_router(metrics.router, prefix=settings.api_prefix)
app.include_router(results.router, prefix=settings.api_prefix)
app.include_router(games.router, prefix=settings.api_prefix)
