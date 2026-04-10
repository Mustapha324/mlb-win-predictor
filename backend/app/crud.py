from collections.abc import Sequence

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Game, ModelMetric, Prediction


# Game CRUD

def create_game(db: Session, **game_data) -> Game:
    game = Game(**game_data)
    db.add(game)
    db.commit()
    db.refresh(game)
    return game


def get_game(db: Session, game_id: int) -> Game | None:
    return db.get(Game, game_id)


def list_games(db: Session, limit: int = 100, offset: int = 0) -> Sequence[Game]:
    stmt = select(Game).offset(offset).limit(limit)
    return db.scalars(stmt).all()


def update_game(db: Session, game_id: int, **game_data) -> Game | None:
    game = get_game(db, game_id)
    if not game:
        return None
    for field, value in game_data.items():
        setattr(game, field, value)
    db.commit()
    db.refresh(game)
    return game


def delete_game(db: Session, game_id: int) -> bool:
    game = get_game(db, game_id)
    if not game:
        return False
    db.delete(game)
    db.commit()
    return True


# Prediction CRUD

def create_prediction(db: Session, **prediction_data) -> Prediction:
    prediction = Prediction(**prediction_data)
    db.add(prediction)
    db.commit()
    db.refresh(prediction)
    return prediction


def get_prediction(db: Session, prediction_id: int) -> Prediction | None:
    return db.get(Prediction, prediction_id)


def list_predictions(db: Session, limit: int = 100, offset: int = 0) -> Sequence[Prediction]:
    stmt = select(Prediction).offset(offset).limit(limit)
    return db.scalars(stmt).all()


def update_prediction(db: Session, prediction_id: int, **prediction_data) -> Prediction | None:
    prediction = get_prediction(db, prediction_id)
    if not prediction:
        return None
    for field, value in prediction_data.items():
        setattr(prediction, field, value)
    db.commit()
    db.refresh(prediction)
    return prediction


def delete_prediction(db: Session, prediction_id: int) -> bool:
    prediction = get_prediction(db, prediction_id)
    if not prediction:
        return False
    db.delete(prediction)
    db.commit()
    return True


# ModelMetric CRUD

def create_model_metric(db: Session, **metric_data) -> ModelMetric:
    metric = ModelMetric(**metric_data)
    db.add(metric)
    db.commit()
    db.refresh(metric)
    return metric


def get_model_metric(db: Session, metric_id: int) -> ModelMetric | None:
    return db.get(ModelMetric, metric_id)


def get_model_metric_by_version(db: Session, model_version: str) -> ModelMetric | None:
    stmt = select(ModelMetric).where(ModelMetric.model_version == model_version)
    return db.scalar(stmt)


def list_model_metrics(db: Session, limit: int = 100, offset: int = 0) -> Sequence[ModelMetric]:
    stmt = select(ModelMetric).offset(offset).limit(limit)
    return db.scalars(stmt).all()


def update_model_metric(db: Session, metric_id: int, **metric_data) -> ModelMetric | None:
    metric = get_model_metric(db, metric_id)
    if not metric:
        return None
    for field, value in metric_data.items():
        setattr(metric, field, value)
    db.commit()
    db.refresh(metric)
    return metric


def delete_model_metric(db: Session, metric_id: int) -> bool:
    metric = get_model_metric(db, metric_id)
    if not metric:
        return False
    db.delete(metric)
    db.commit()
    return True
