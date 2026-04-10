from __future__ import annotations

from datetime import date
from pathlib import Path

from app.services.dataset_builder import build_historical_dataset
from app.services.model_trainer import train_model


DEFAULT_DATASET_PATH = Path("backend/data/processed/historical_games.csv")


def run_training_pipeline(
    start_date: date,
    end_date: date,
    dataset_path: Path = DEFAULT_DATASET_PATH,
) -> dict[str, float]:
    build_historical_dataset(start_date=start_date, end_date=end_date, output_path=dataset_path)
    return train_model(data_path=dataset_path)


if __name__ == "__main__":
    run_training_pipeline(start_date=date(2024, 3, 20), end_date=date(2025, 11, 1))
