from __future__ import annotations

import json
import logging
import pickle
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (
    accuracy_score,
    brier_score_loss,
    log_loss,
    precision_score,
    recall_score,
    roc_auc_score,
)
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s - %(message)s")

BASE_DIR = Path(__file__).resolve().parents[2]
DATA_PATH = BASE_DIR / "data" / "processed" / "historical_games.csv"
MODEL_PATH = BASE_DIR / "models" / "logistic_regression.pkl"
METRICS_PATH = BASE_DIR / "models" / "logistic_regression_metrics.json"
FEATURES_PATH = BASE_DIR / "models" / "logistic_regression_features.json"

TARGET_COLUMN = "home_team_won"
DATE_COLUMN = "game_date"
FEATURE_COLUMNS = [
    "home_team_win_pct_pre_game",
    "away_team_win_pct_pre_game",
    "home_last10_win_pct",
    "away_last10_win_pct",
    "home_runs_scored_per_game",
    "away_runs_scored_per_game",
    "home_runs_allowed_per_game",
    "away_runs_allowed_per_game",
    "home_run_diff_per_game",
    "away_run_diff_per_game",
    "home_home_split_win_pct",
    "away_away_split_win_pct",
    "home_team_batting_avg",
    "away_team_batting_avg",
    "home_team_obp",
    "away_team_obp",
    "home_team_slugging",
    "away_team_slugging",
    "home_team_era",
    "away_team_era",
    "home_probable_pitcher_era",
    "away_probable_pitcher_era",
    "home_probable_pitcher_whip",
    "away_probable_pitcher_whip",
    "home_field_indicator",
]
TRAIN_SPLIT_RATIO = 0.8


def _build_model() -> Pipeline:
    return Pipeline(
        steps=[
            ("imputer", SimpleImputer(strategy="median")),
            ("scaler", StandardScaler()),
            ("classifier", LogisticRegression(max_iter=1000)),
        ]
    )


def _split_train_test_by_date(df: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame]:
    unique_dates = sorted(df[DATE_COLUMN].dropna().unique())
    if len(unique_dates) < 2:
        raise ValueError("Need at least 2 unique game dates for date-based train/test split.")

    split_idx = int(len(unique_dates) * TRAIN_SPLIT_RATIO)
    split_idx = min(max(split_idx, 1), len(unique_dates) - 1)
    split_date = unique_dates[split_idx]

    train_df = df[df[DATE_COLUMN] < split_date]
    test_df = df[df[DATE_COLUMN] >= split_date]

    if train_df.empty or test_df.empty:
        raise ValueError("Date split produced empty train or test set.")

    return train_df, test_df


def _save_metrics(metrics: dict[str, float | str]) -> None:
    METRICS_PATH.parent.mkdir(parents=True, exist_ok=True)
    METRICS_PATH.write_text(json.dumps(metrics, indent=2), encoding="utf-8")


def _save_feature_columns() -> None:
    FEATURES_PATH.parent.mkdir(parents=True, exist_ok=True)
    FEATURES_PATH.write_text(json.dumps(FEATURE_COLUMNS, indent=2), encoding="utf-8")


def train_model(data_path: Path = DATA_PATH) -> dict[str, float | str]:
    if not data_path.exists():
        raise FileNotFoundError(f"Training data not found: {data_path}")

    df = pd.read_csv(data_path)
    required_columns = [DATE_COLUMN, TARGET_COLUMN, *FEATURE_COLUMNS]
    missing_columns = [column for column in required_columns if column not in df.columns]
    if missing_columns:
        raise ValueError(f"Missing required columns in dataset: {missing_columns}")

    df[DATE_COLUMN] = pd.to_datetime(df[DATE_COLUMN], errors="coerce")
    df = df.dropna(subset=[DATE_COLUMN, TARGET_COLUMN]).sort_values(by=DATE_COLUMN)
    if len(df) < 2:
        raise ValueError("Not enough rows to train and evaluate model.")

    train_df, test_df = _split_train_test_by_date(df)

    x_train = train_df[FEATURE_COLUMNS]
    y_train = train_df[TARGET_COLUMN].astype(int)
    x_test = test_df[FEATURE_COLUMNS]
    y_test = test_df[TARGET_COLUMN].astype(int)

    model = _build_model()
    missing_train = x_train.isna().sum().to_dict()
    missing_test = x_test.isna().sum().to_dict()
    logger.info("Train missing feature counts: %s", missing_train)
    logger.info("Test missing feature counts: %s", missing_test)
    model.fit(x_train, y_train)

    probabilities = model.predict_proba(x_test)[:, 1]
    predictions = (probabilities >= 0.5).astype(int)

    accuracy = accuracy_score(y_test, predictions)
    precision = precision_score(y_test, predictions, zero_division=0)
    recall = recall_score(y_test, predictions, zero_division=0)
    roc_auc = roc_auc_score(y_test, probabilities)
    model_log_loss = log_loss(y_test, probabilities)
    brier = brier_score_loss(y_test, probabilities)
    now_iso = datetime.now(timezone.utc).isoformat()

    metrics: dict[str, float | str] = {
        "accuracy": float(accuracy),
        "precision": float(precision),
        "recall": float(recall),
        "roc_auc": float(roc_auc),
        "log_loss": float(model_log_loss),
        "brier_score": float(brier),
        "train_games": float(len(train_df)),
        "test_games": float(len(test_df)),
        "correct_predictions": float((predictions == y_test).sum()),
        "total_predictions_evaluated": float(len(test_df)),
        "model_name": "logistic_regression_baseline",
        "version": "logreg-baseline-v1",
        "last_trained_at": now_iso,
    }

    MODEL_PATH.parent.mkdir(parents=True, exist_ok=True)
    with MODEL_PATH.open("wb") as model_file:
        pickle.dump(model, model_file)

    _save_metrics(metrics)
    _save_feature_columns()

    logger.info("Saved trained model to %s", MODEL_PATH)
    logger.info("Saved feature columns to %s", FEATURES_PATH)
    logger.info("Model evaluation metrics: %s", metrics)
    print(f"accuracy: {metrics['accuracy']:.6f}")
    print(f"log_loss: {metrics['log_loss']:.6f}")
    print(f"brier_score: {metrics['brier_score']:.6f}")

    return metrics


if __name__ == "__main__":
    train_model()
