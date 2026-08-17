from __future__ import annotations

import json
from pathlib import Path

import joblib
import pandas as pd
from sklearn.calibration import CalibratedClassifierCV
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, brier_score_loss, log_loss, mean_absolute_error
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler


def _chronological_split(frame: pd.DataFrame, date_column: str) -> tuple[pd.DataFrame, pd.DataFrame]:
    ordered = frame.sort_values(date_column)
    seasons = sorted(ordered["season"].dropna().unique())
    if len(seasons) < 2:
        cutoff = max(1, int(len(ordered) * 0.8))
        return ordered.iloc[:cutoff], ordered.iloc[cutoff:]
    holdout = seasons[-1]
    return ordered[ordered["season"] < holdout], ordered[ordered["season"] == holdout]


def train_nfl_game_model(dataset_path: Path, output_dir: Path) -> dict[str, float | int | str]:
    frame = pd.read_csv(dataset_path, parse_dates=["gameday"])
    train, test = _chronological_split(frame, "gameday")
    target = "home_team_won"
    excluded = {target, "game_id", "season", "week", "gameday", "home_team", "away_team"}
    features = [column for column in frame.columns if column not in excluded and pd.api.types.is_numeric_dtype(frame[column])]
    if train.empty or test.empty or not features:
        raise ValueError("NFL game dataset needs numeric features and a non-empty chronological holdout.")
    base = Pipeline([("imputer", SimpleImputer(strategy="median")), ("scaler", StandardScaler()), ("model", LogisticRegression(max_iter=2000))])
    model = CalibratedClassifierCV(base, method="sigmoid", cv=3)
    model.fit(train[features], train[target].astype(int))
    probability = model.predict_proba(test[features])[:, 1]
    prediction = probability >= 0.5
    metrics: dict[str, float | int | str] = {
        "model_name": "nfl_calibrated_logistic",
        "version": "nfl-team-v1",
        "train_games": len(train),
        "holdout_games": len(test),
        "holdout_season": int(test["season"].iloc[0]),
        "accuracy": float(accuracy_score(test[target], prediction)),
        "brier_score": float(brier_score_loss(test[target], probability)),
        "log_loss": float(log_loss(test[target], probability)),
    }
    output_dir.mkdir(parents=True, exist_ok=True)
    joblib.dump(model, output_dir / "nfl_game_model.pkl")
    (output_dir / "nfl_game_features.json").write_text(json.dumps(features, indent=2), encoding="utf-8")
    (output_dir / "nfl_game_metrics.json").write_text(json.dumps(metrics, indent=2), encoding="utf-8")
    return metrics


def train_nfl_player_models(dataset_path: Path, output_dir: Path) -> dict[str, dict[str, float | int]]:
    frame = pd.read_csv(dataset_path, parse_dates=["gameday"])
    train, test = _chronological_split(frame, "gameday")
    targets = ["passing_yards", "rushing_yards", "receiving_yards", "receptions", "passing_tds", "rushing_tds", "receiving_tds"]
    excluded = {"game_id", "season", "week", "gameday", "player_id", "player_name", "position", "team", "opponent", *targets}
    features = [column for column in frame.columns if column not in excluded and pd.api.types.is_numeric_dtype(frame[column])]
    output_dir.mkdir(parents=True, exist_ok=True)
    metrics: dict[str, dict[str, float | int]] = {}
    for target in targets:
        eligible_train = train.dropna(subset=[target])
        eligible_test = test.dropna(subset=[target])
        if len(eligible_train) < 100 or eligible_test.empty:
            continue
        model = Pipeline([("imputer", SimpleImputer(strategy="median")), ("model", HistGradientBoostingRegressor(max_iter=180, learning_rate=0.05, l2_regularization=1.0))])
        model.fit(eligible_train[features], eligible_train[target])
        predictions = model.predict(eligible_test[features])
        metrics[target] = {"train_rows": len(eligible_train), "holdout_rows": len(eligible_test), "mae": float(mean_absolute_error(eligible_test[target], predictions))}
        joblib.dump(model, output_dir / f"nfl_player_{target}.pkl")
    (output_dir / "nfl_player_features.json").write_text(json.dumps(features, indent=2), encoding="utf-8")
    (output_dir / "nfl_player_metrics.json").write_text(json.dumps(metrics, indent=2), encoding="utf-8")
    return metrics
