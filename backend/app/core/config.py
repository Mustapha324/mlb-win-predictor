import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()


class Settings:
    app_name: str = os.getenv("APP_NAME", "MLB Win Predictor API")
    api_prefix: str = os.getenv("API_PREFIX", "/api")
    database_url: str = os.getenv("DATABASE_URL", "sqlite:///./mlb_predictions.db")
    model_path: str = os.getenv(
        "MODEL_PATH",
        str(Path(__file__).resolve().parents[2] / "models" / "logistic_regression.pkl"),
    )
    mlb_stats_api_base: str = os.getenv("MLB_STATS_API_BASE", "https://statsapi.mlb.com/api/v1")


settings = Settings()
