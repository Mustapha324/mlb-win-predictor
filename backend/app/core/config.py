import os

from dotenv import load_dotenv

load_dotenv()


class Settings:
    app_name: str = os.getenv("APP_NAME", "MLB Win Predictor API")
    api_prefix: str = os.getenv("API_PREFIX", "/api")
    database_url: str = os.getenv("DATABASE_URL", "sqlite:///./mlb_predictor.db")


settings = Settings()
