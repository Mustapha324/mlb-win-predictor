"""Application configuration utilities."""

import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()


class AppSettings:
    """Runtime settings loaded from environment variables."""

    app_name: str = os.getenv("APP_NAME", "MLB Win Predictor API")
    api_prefix: str = os.getenv("API_PREFIX", "/api")
    model_path: str = os.getenv(
        "MODEL_PATH",
        str(Path(__file__).resolve().parents[2] / "models" / "logistic_regression.pkl"),
    )
    mlb_stats_api_base: str = os.getenv("MLB_STATS_API_BASE", "https://statsapi.mlb.com/api/v1")

    database_url: str = os.getenv("DATABASE_URL", "sqlite:///./mlb_predictor.db")

    # TODO(scheduled daily prediction jobs): use these placeholders when
    # introducing a scheduler/worker to materialize predictions daily.
    daily_job_enabled: bool = os.getenv("DAILY_JOB_ENABLED", "false").lower() == "true"
    daily_job_cron: str = os.getenv("DAILY_JOB_CRON", "0 14 * * *")
    results_sync_interval_hours: int = int(os.getenv("RESULTS_SYNC_INTERVAL_HOURS", "6"))
    results_sync_catchup_days: int = int(os.getenv("RESULTS_SYNC_CATCHUP_DAYS", "7"))


settings = AppSettings()
