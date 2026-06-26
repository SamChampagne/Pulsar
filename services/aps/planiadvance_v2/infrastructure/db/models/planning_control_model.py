"""Planning control plane ORM models."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import JSON, DateTime, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from ..base import Base


class PlanningWorkspaceStateModel(Base):
    __tablename__ = "planning_workspace_state"

    id: Mapped[str] = mapped_column(String(160), primary_key=True)
    organization_id: Mapped[str | None] = mapped_column(
        String(64), nullable=True, index=True
    )
    workspace_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    active_baseline_schedule_id: Mapped[str | None] = mapped_column(
        String(64), nullable=True, index=True
    )
    active_candidate_schedule_id: Mapped[str | None] = mapped_column(
        String(64), nullable=True, index=True
    )
    candidate_status: Mapped[str] = mapped_column(
        String(32), nullable=False, default="none"
    )
    candidate_edit_count: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0
    )
    last_event_type: Mapped[str | None] = mapped_column(String(64), nullable=True)
    updated_by_user_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, default=datetime.utcnow
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, default=datetime.utcnow
    )


class PlanningEventModel(Base):
    __tablename__ = "planning_events"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    organization_id: Mapped[str | None] = mapped_column(
        String(64), nullable=True, index=True
    )
    workspace_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    event_type: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    schedule_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    baseline_schedule_id: Mapped[str | None] = mapped_column(
        String(64), nullable=True, index=True
    )
    candidate_schedule_id: Mapped[str | None] = mapped_column(
        String(64), nullable=True, index=True
    )
    source_schedule_id: Mapped[str | None] = mapped_column(
        String(64), nullable=True, index=True
    )
    edit_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    payload: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    created_by_user_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, default=datetime.utcnow, index=True
    )
