"""ORM models for calendars and their shifts."""

from __future__ import annotations

from datetime import time

from sqlalchemy import ForeignKey, Integer, String, Time
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ..base import Base


class CalendarModel(Base):
    __tablename__ = "calendars"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    organization_id: Mapped[str | None] = mapped_column(
        String(64), nullable=True, index=True
    )
    workspace_id: Mapped[str | None] = mapped_column(
        String(64), nullable=True, index=True
    )

    shifts: Mapped[list[ShiftModel]] = relationship(
        back_populates="calendar",
        cascade="all, delete-orphan",
        order_by="ShiftModel.weekday, ShiftModel.start_time",
    )


class ShiftModel(Base):
    __tablename__ = "calendar_shifts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    calendar_id: Mapped[str] = mapped_column(
        ForeignKey("calendars.id", ondelete="CASCADE"), nullable=False
    )
    weekday: Mapped[int] = mapped_column(Integer, nullable=False)  # 0..6
    start_time: Mapped[time] = mapped_column(Time, nullable=False)
    end_time: Mapped[time] = mapped_column(Time, nullable=False)

    calendar: Mapped[CalendarModel] = relationship(back_populates="shifts")
