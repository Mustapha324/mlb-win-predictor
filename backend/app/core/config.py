"""Application configuration utilities."""

import os

from dotenv import load_dotenv

load_dotenv()


class AppSettings:
    """Runtime settings loaded from environment variables."""

    app_name: str = os.getenv("APP_NAME", "MLB Win Predictor API")
    api_prefix: str = os.getenv("API_PREFIX", "/api")


settings = AppSettings()
