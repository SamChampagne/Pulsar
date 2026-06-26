"""SQL-backed planning control plane repository."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from ....application.ports.planning_control_repository import (
    PlanningEvent,
    PlanningWorkspaceState,
)
from ..models import PlanningEventModel, PlanningWorkspaceStateModel


def _scope_key(organization_id: str | None, workspace_id: str) -> str:
    return f"{organization_id or '_local'}:{workspace_id}"


class SqlPlanningControlRepository:
    def __init__(self, session: Session) -> None:
        self._session = session

    def get_state(
        self,
        *,
        organization_id: str | None,
        workspace_id: str,
    ) -> PlanningWorkspaceState | None:
        row = self._session.get(
            PlanningWorkspaceStateModel,
            _scope_key(organization_id, workspace_id),
        )
        return self._to_state(row) if row else None

    def save_state(
        self,
        state: PlanningWorkspaceState,
    ) -> PlanningWorkspaceState:
        now = datetime.utcnow()
        row = PlanningWorkspaceStateModel(
            id=_scope_key(state.organization_id, state.workspace_id),
            organization_id=state.organization_id,
            workspace_id=state.workspace_id,
            active_baseline_schedule_id=state.active_baseline_schedule_id,
            active_candidate_schedule_id=state.active_candidate_schedule_id,
            candidate_status=state.candidate_status,
            candidate_edit_count=state.candidate_edit_count,
            last_event_type=state.last_event_type,
            updated_by_user_id=state.updated_by_user_id,
            created_at=state.created_at,
            updated_at=now,
        )
        merged = self._session.merge(row)
        self._session.flush()
        return self._to_state(merged)

    def record_event(self, event: PlanningEvent) -> PlanningEvent:
        row = PlanningEventModel(
            id=event.id,
            organization_id=event.organization_id,
            workspace_id=event.workspace_id,
            event_type=event.event_type,
            schedule_id=event.schedule_id,
            baseline_schedule_id=event.baseline_schedule_id,
            candidate_schedule_id=event.candidate_schedule_id,
            source_schedule_id=event.source_schedule_id,
            edit_count=event.edit_count,
            payload=dict(event.payload),
            created_by_user_id=event.created_by_user_id,
            created_at=event.created_at,
        )
        self._session.add(row)
        self._session.flush()
        return event

    def list_events(
        self,
        *,
        organization_id: str | None,
        workspace_id: str,
        limit: int = 50,
        baseline_schedule_id: str | None = None,
        candidate_schedule_id: str | None = None,
    ) -> list[PlanningEvent]:
        stmt = (
            select(PlanningEventModel)
            .where(PlanningEventModel.workspace_id == workspace_id)
            .order_by(PlanningEventModel.created_at.desc())
            .limit(limit)
        )
        if organization_id is None:
            stmt = stmt.where(PlanningEventModel.organization_id.is_(None))
        else:
            stmt = stmt.where(PlanningEventModel.organization_id == organization_id)
        if baseline_schedule_id is not None:
            stmt = stmt.where(
                PlanningEventModel.baseline_schedule_id == baseline_schedule_id
            )
        if candidate_schedule_id is not None:
            stmt = stmt.where(
                PlanningEventModel.candidate_schedule_id == candidate_schedule_id
            )
        rows = self._session.execute(stmt).scalars().all()
        return [self._to_event(row) for row in rows]

    @staticmethod
    def _to_state(row: PlanningWorkspaceStateModel) -> PlanningWorkspaceState:
        return PlanningWorkspaceState(
            organization_id=row.organization_id,
            workspace_id=row.workspace_id,
            active_baseline_schedule_id=row.active_baseline_schedule_id,
            active_candidate_schedule_id=row.active_candidate_schedule_id,
            candidate_status=row.candidate_status or "none",
            candidate_edit_count=row.candidate_edit_count or 0,
            last_event_type=row.last_event_type,
            updated_by_user_id=row.updated_by_user_id,
            created_at=row.created_at,
            updated_at=row.updated_at,
        )

    @staticmethod
    def _to_event(row: PlanningEventModel) -> PlanningEvent:
        return PlanningEvent(
            id=row.id,
            organization_id=row.organization_id,
            workspace_id=row.workspace_id,
            event_type=row.event_type,
            schedule_id=row.schedule_id,
            baseline_schedule_id=row.baseline_schedule_id,
            candidate_schedule_id=row.candidate_schedule_id,
            source_schedule_id=row.source_schedule_id,
            edit_count=row.edit_count or 0,
            payload=dict(row.payload or {}),
            created_by_user_id=row.created_by_user_id,
            created_at=row.created_at,
        )
