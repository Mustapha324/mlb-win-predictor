from __future__ import annotations

from datetime import date
from pathlib import Path
from tempfile import NamedTemporaryFile

import pandas as pd

from app.services.dataset_builder import build_historical_dataset
from app.services.model_trainer import train_model


DEFAULT_DATASET_PATH = Path("backend/data/processed/historical_games.csv")


def append_completed_games_to_dataset(
    start_date: date,
    end_date: date,
    dataset_path: Path = DEFAULT_DATASET_PATH,
) -> int:
    """Append newly completed games into the persisted historical dataset."""
    with NamedTemporaryFile(suffix=".csv") as tmp_file:
        incremental_df = build_historical_dataset(start_date=start_date, end_date=end_date, output_path=tmp_file.name)
    if incremental_df.empty:
        return 0

    incremental_df["game_date"] = pd.to_datetime(incremental_df["game_date"], errors="coerce").dt.date
    dataset_path.parent.mkdir(parents=True, exist_ok=True)

    existing_rows = 0
    if dataset_path.exists():
        existing_df = pd.read_csv(dataset_path)
        existing_rows = len(existing_df)
        if not existing_df.empty:
            existing_df["game_date"] = pd.to_datetime(existing_df["game_date"], errors="coerce").dt.date
            combined_df = pd.concat([existing_df, incremental_df], ignore_index=True)
        else:
            combined_df = incremental_df
    else:
        combined_df = incremental_df

    deduped_df = (
        combined_df.sort_values(by=["game_date", "home_team", "away_team"])
        .drop_duplicates(subset=["game_date", "home_team", "away_team"], keep="last")
        .reset_index(drop=True)
    )
    deduped_df.to_csv(dataset_path, index=False)
    return max(0, len(deduped_df) - existing_rows)


def run_training_pipeline(
    start_date: date,
    end_date: date,
    dataset_path: Path = DEFAULT_DATASET_PATH,
) -> dict[str, float | str]:
    append_completed_games_to_dataset(start_date=start_date, end_date=end_date, dataset_path=dataset_path)
    return train_model(data_path=dataset_path)


if __name__ == "__main__":
    run_training_pipeline(start_date=date(2024, 3, 20), end_date=date(2025, 11, 1))
