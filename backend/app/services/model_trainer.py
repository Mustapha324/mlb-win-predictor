import logging
import pickle
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, brier_score_loss, log_loss
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler
from sqlalchemy import Column, DateTime, Float, Integer, String, create_engine
from sqlalchemy.orm import Session, declarative_base

logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s - %(message)s")

BASE_DIR = Path(__file__).resolve().parents[2]
DATA_PATH = BASE_DIR / "data" / "processed" / "historical_games.csv"
MODEL_PATH = BASE_DIR / "models" / "logistic_regression.pkl"
DATABASE_PATH = BASE_DIR / "app.db"
DATABASE_URL = f"sqlite:///{DATABASE_PATH}"

TARGET_COLUMN = "home_team_won"
DATE_COLUMN_CANDIDATES = ["game_date", "date", "game_datetime", "game_day"]
TRAIN_SPLIT_RATIO = 0.8

Base = declarative_base()


class ModelMetric(Base):
    __tablename__ = "model_metrics"

    id = Column(Integer, primary_key=True, autoincrement=True)
    model_name = Column(String(128), nullable=False)
    accuracy = Column(Float, nullable=False)
    log_loss = Column(Float, nullable=False)
    brier_score = Column(Float, nullable=False)
    evaluated_at = Column(DateTime, nullable=False, default=lambda: datetime.now(timezone.utc))


def _detect_date_column(df: pd.DataFrame) -> str:
    for candidate in DATE_COLUMN_CANDIDATES:
        if candidate in df.columns:
            return candidate
    raise ValueError(
        f"Unable to find a date column. Expected one of: {DATE_COLUMN_CANDIDATES}"
    )


def _build_model(features: pd.DataFrame) -> Pipeline:
    numeric_columns = features.select_dtypes(include=["number", "bool"]).columns.tolist()
    categorical_columns = [col for col in features.columns if col not in numeric_columns]

    numeric_pipeline = Pipeline(
        steps=[
            ("imputer", SimpleImputer(strategy="median")),
            ("scaler", StandardScaler()),
        ]
    )

    categorical_pipeline = Pipeline(
        steps=[
            ("imputer", SimpleImputer(strategy="most_frequent")),
            ("encoder", OneHotEncoder(handle_unknown="ignore")),
        ]
    )

    preprocessor = ColumnTransformer(
        transformers=[
            ("numeric", numeric_pipeline, numeric_columns),
            ("categorical", categorical_pipeline, categorical_columns),
        ]
    )

    model = Pipeline(
        steps=[
            ("preprocessor", preprocessor),
            ("classifier", LogisticRegression(max_iter=1000)),
        ]
    )
    return model


def _save_metrics(engine, accuracy: float, model_log_loss: float, brier_score: float) -> None:
    Base.metadata.create_all(engine)

    with Session(engine) as session:
        session.add(
            ModelMetric(
                model_name="logistic_regression",
                accuracy=float(accuracy),
                log_loss=float(model_log_loss),
                brier_score=float(brier_score),
            )
        )
        session.commit()


def train_model() -> dict[str, float]:
    if not DATA_PATH.exists():
        raise FileNotFoundError(f"Training data not found: {DATA_PATH}")

    df = pd.read_csv(DATA_PATH)
    if TARGET_COLUMN not in df.columns:
        raise ValueError(f"Target column '{TARGET_COLUMN}' was not found in {DATA_PATH}")

    date_column = _detect_date_column(df)
    df[date_column] = pd.to_datetime(df[date_column], errors="coerce")
    df = df.dropna(subset=[date_column, TARGET_COLUMN]).sort_values(by=date_column)

    if len(df) < 2:
        raise ValueError("Not enough rows to perform train/test split.")

    split_index = int(len(df) * TRAIN_SPLIT_RATIO)
    split_index = min(max(split_index, 1), len(df) - 1)

    train_df = df.iloc[:split_index]
    test_df = df.iloc[split_index:]

    feature_columns = [col for col in df.columns if col not in {TARGET_COLUMN, date_column}]
    x_train = train_df[feature_columns]
    y_train = train_df[TARGET_COLUMN].astype(int)
    x_test = test_df[feature_columns]
    y_test = test_df[TARGET_COLUMN].astype(int)

    model = _build_model(x_train)
    model.fit(x_train, y_train)

    predictions = model.predict(x_test)
    probabilities = model.predict_proba(x_test)[:, 1]

    accuracy = accuracy_score(y_test, predictions)
    model_log_loss = log_loss(y_test, probabilities)
    brier = brier_score_loss(y_test, probabilities)

    metrics = {
        "accuracy": float(accuracy),
        "log_loss": float(model_log_loss),
        "brier_score": float(brier),
    }

    MODEL_PATH.parent.mkdir(parents=True, exist_ok=True)
    with MODEL_PATH.open("wb") as model_file:
        pickle.dump(model, model_file)

    engine = create_engine(DATABASE_URL)
    _save_metrics(engine, accuracy=accuracy, model_log_loss=model_log_loss, brier_score=brier)

    logger.info("Model evaluation metrics: %s", metrics)
    print(f"accuracy: {metrics['accuracy']:.6f}")
    print(f"log_loss: {metrics['log_loss']:.6f}")
    print(f"brier_score: {metrics['brier_score']:.6f}")

    return metrics


if __name__ == "__main__":
    train_model()
