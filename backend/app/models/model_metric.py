from datetime import datetime

from sqlalchemy import DateTime, Float, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class ModelMetric(Base):
    __tablename__ = "model_metrics"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    model_version: Mapped[str] = mapped_column(String(100), nullable=False, unique=True, index=True)
    games_evaluated: Mapped[int] = mapped_column(Integer, nullable=False)
    correct_predictions: Mapped[int] = mapped_column(Integer, nullable=False)
    accuracy: Mapped[float] = mapped_column(Float, nullable=False)
    brier_score: Mapped[float] = mapped_column(Float, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)
