"""SQL-backed :class:`ScheduleRepository` adapter."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import delete, select
from sqlalchemy.orm import Session, selectinload

from ....application.ports.schedule_repository import ScheduleRunMetadata
from ....domain.entities import Schedule, ScheduledOperation
from ..models import ScheduledOperationModel, ScheduleModel


class SqlScheduleRepository:
    def __init__(self, session: Session) -> None:
        self._session = session

    def save(
        self,
        schedule: Schedule,
        *,
        metrics: dict,
        strategy: str = "unknown",
        solver_status: str = "unknown",
        objective_value: int = 0,
        wall_time_ms: int = 0,
        diagnostics: dict | None = None,
        workspace_id: str = "default",
        scenario_name: str = "Default Scenario",
        lifecycle_status: str = "draft",
        organization_id: str | None = None,
        horizon_start: datetime | None = None,
        horizon_end: datetime | None = None,
        objective: dict | None = None,
        transfer_times: dict | None = None,
        input_snapshot: dict | None = None,
        input_snapshot_hash: str = "",
        engine_version: str = "aps-engine.v1",
    ) -> None:
        row = ScheduleModel(
            id=schedule.id,
            created_at=schedule.created_at,
            metrics=metrics,
            organization_id=organization_id,
            horizon_start=horizon_start,
            horizon_end=horizon_end,
            workspace_id=workspace_id,
            scenario_name=scenario_name,
            lifecycle_status=lifecycle_status,
            strategy=strategy,
            solver_status=solver_status,
            objective_value=objective_value,
            wall_time_ms=wall_time_ms,
            diagnostics=diagnostics or {},
            objective_json=objective or {},
            transfer_times_json=transfer_times or {},
            input_snapshot_json=input_snapshot or {},
            input_snapshot_hash=input_snapshot_hash,
            engine_version=engine_version,
        )
        row.assignments = [
            ScheduledOperationModel(
                operation_id=a.operation_id,
                work_order_id=a.work_order_id,
                machine_id=a.machine_id,
                setup_start=a.setup_start,
                start=a.start,
                end=a.end,
            )
            for a in schedule.assignments
        ]
        self._session.add(row)
        # Scheduling runs are read immediately by readiness/dashboard/Gantt
        # endpoints in the UI workflow. Commit here so a follow-up HTTP request
        # cannot race FastAPI's dependency cleanup transaction.
        self._session.commit()

    def get(self, schedule_id: str) -> Schedule | None:
        row = self._session.get(
            ScheduleModel,
            schedule_id,
            options=[selectinload(ScheduleModel.assignments)],
        )
        return self._to_domain(row) if row else None

    def get_metadata(self, schedule_id: str) -> ScheduleRunMetadata | None:
        row = self._session.get(ScheduleModel, schedule_id)
        if row is None:
            return None
        return self._to_metadata(row)

    def update_context(
        self,
        schedule_id: str,
        *,
        workspace_id: str | None = None,
        scenario_name: str | None = None,
        lifecycle_status: str | None = None,
    ) -> ScheduleRunMetadata | None:
        row = self._session.get(ScheduleModel, schedule_id)
        if row is None:
            return None
        if workspace_id is not None:
            row.workspace_id = workspace_id
        if scenario_name is not None:
            row.scenario_name = scenario_name
        if lifecycle_status is not None:
            row.lifecycle_status = lifecycle_status
        self._session.commit()
        return self._to_metadata(row)

    def delete(self, schedule_id: str) -> None:
        self._session.execute(
            delete(ScheduleModel).where(ScheduleModel.id == schedule_id)
        )

    def list_recent(
        self,
        limit: int = 20,
        *,
        organization_id: str | None = None,
        workspace_id: str | None = None,
        lifecycle_status: str | None = None,
    ) -> list[tuple[Schedule, ScheduleRunMetadata]]:
        stmt = (
            select(ScheduleModel)
            .options(selectinload(ScheduleModel.assignments))
            .order_by(ScheduleModel.created_at.desc())
        )
        if organization_id is not None:
            stmt = stmt.where(ScheduleModel.organization_id == organization_id)
        if workspace_id is not None:
            stmt = stmt.where(ScheduleModel.workspace_id == workspace_id)
        if lifecycle_status is not None:
            stmt = stmt.where(ScheduleModel.lifecycle_status == lifecycle_status)
        stmt = stmt.limit(limit)
        rows = self._session.execute(stmt).scalars().all()
        return [
            (
                self._to_domain(r),
                self._to_metadata(r),
            )
            for r in rows
        ]

    @staticmethod
    def _to_metadata(row: ScheduleModel) -> ScheduleRunMetadata:
        return ScheduleRunMetadata(
            metrics=row.metrics or {},
            workspace_id=row.workspace_id or "default",
            scenario_name=row.scenario_name or "Default Scenario",
            lifecycle_status=row.lifecycle_status or "draft",
            organization_id=row.organization_id,
            horizon_start=row.horizon_start,
            horizon_end=row.horizon_end,
            strategy=row.strategy or "unknown",
            solver_status=row.solver_status or "unknown",
            objective_value=row.objective_value or 0,
            wall_time_ms=row.wall_time_ms or 0,
            diagnostics=row.diagnostics or {},
            objective=row.objective_json or {},
            transfer_times=row.transfer_times_json or {},
            input_snapshot=row.input_snapshot_json or {},
            input_snapshot_hash=row.input_snapshot_hash or "",
            engine_version=row.engine_version or "aps-engine.v1",
        )

    @staticmethod
    def _to_domain(row: ScheduleModel) -> Schedule:
        return Schedule(
            id=row.id,
            created_at=row.created_at,
            assignments=[
                ScheduledOperation(
                    operation_id=a.operation_id,
                    work_order_id=a.work_order_id,
                    machine_id=a.machine_id,
                    setup_start=a.setup_start,
                    start=a.start,
                    end=a.end,
                )
                for a in row.assignments
            ],
        )
