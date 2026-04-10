from datetime import date, datetime

from sqlalchemy import Boolean, Date, DateTime, Float, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.database import Base


class Prediction(Base):
    __tablename__ = "predictions"
    __table_args__ = (UniqueConstraint("game_id", name="uq_predictions_game_id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    game_id: Mapped[str] = mapped_column(String(64), nullable=False)
    game_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    home_team: Mapped[str] = mapped_column(String(128), nullable=False)
    away_team: Mapped[str] = mapped_column(String(128), nullable=False)
    predicted_winner: Mapped[str] = mapped_column(String(128), nullable=False)
    home_win_probability: Mapped[float] = mapped_column(Float, nullable=False)
    away_win_probability: Mapped[float] = mapped_column(Float, nullable=False)
    actual_winner: Mapped[str | None] = mapped_column(String(128), nullable=True)
    away_score: Mapped[int | None] = mapped_column(Integer, nullable=True)
    home_score: Mapped[int | None] = mapped_column(Integer, nullable=True)
    was_correct: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    status: Mapped[str] = mapped_column(String(64), nullable=False, default="Scheduled")
    results_synced_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
