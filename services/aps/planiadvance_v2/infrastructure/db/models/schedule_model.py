"""Schedule ORM models.

Each scheduling run produces one ``ScheduleModel`` with many
``ScheduledOperationModel`` child rows. KPIs are stored as a JSON blob
because they are computed once at write time and consumed as an opaque
dict by downstream dashboards — no need for columnar storage.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import JSON, DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ..base import Base


class ScheduleModel(Base):
    __tablename__ = "schedules"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, default=datetime.utcnow
    )
    metrics: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    organization_id: Mapped[str | None] = mapped_column(
        String(64), nullable=True, index=True
    )
    horizon_start: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    horizon_end: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    workspace_id: Mapped[str] = mapped_column(String(64), nullable=False, default="default")
    scenario_name: Mapped[str] = mapped_column(
        String(128), nullable=False, default="Default Scenario"
    )
    lifecycle_status: Mapped[str] = mapped_column(
        String(32), nullable=False, default="draft"
    )
    strategy: Mapped[str] = mapped_column(String(64), nullable=False, default="unknown")
    solver_status: Mapped[str] = mapped_column(String(32), nullable=False, default="unknown")
    objective_value: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    wall_time_ms: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    diagnostics: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    objective_json: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    transfer_times_json: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    input_snapshot_json: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    input_snapshot_hash: Mapped[str] = mapped_column(
        String(64), nullable=False, default=""
    )
    engine_version: Mapped[str] = mapped_column(
        String(64), nullable=False, default="aps-engine.v1"
    )

    assignments: Mapped[list[ScheduledOperationModel]] = relationship(
        back_populates="schedule",
        cascade="all, delete-orphan",
        order_by="ScheduledOperationModel.setup_start",
    )


class ScheduledOperationModel(Base):
    __tablename__ = "scheduled_operations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    schedule_id: Mapped[str] = mapped_column(
        ForeignKey("schedules.id", ondelete="CASCADE"), nullable=False, index=True
    )
    operation_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    work_order_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    machine_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    setup_start: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    start: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    end: Mapped[datetime] = mapped_column(DateTime, nullable=False)

    schedule: Mapped[ScheduleModel] = relationship(back_populates="assignments")
