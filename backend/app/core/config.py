import os

from dotenv import load_dotenv

load_dotenv()


class Settings:
    app_name: str = os.getenv("APP_NAME", "MLB Win Predictor API")
    api_prefix: str = os.getenv("API_PREFIX", "/api")

    # TODO(PostgreSQL migration): replace sqlite/local-file assumptions with a
    # dedicated DATABASE_URL and migration tooling once persistent storage lands.
    database_url: str = os.getenv("DATABASE_URL", "sqlite:///./mlb_predictor.db")

    # TODO(scheduled daily prediction jobs): use these placeholders when
    # introducing a scheduler/worker to materialize predictions daily.
    daily_job_enabled: bool = os.getenv("DAILY_JOB_ENABLED", "false").lower() == "true"
    daily_job_cron: str = os.getenv("DAILY_JOB_CRON", "0 14 * * *")


settings = Settings()
