"""Port: workspace planning control plane state and audit events."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Protocol


@dataclass(frozen=True, slots=True)
class PlanningWorkspaceState:
    organization_id: str | None
    workspace_id: str
    active_baseline_schedule_id: str | None = None
    active_candidate_schedule_id: str | None = None
    candidate_status: str = "none"
    candidate_edit_count: int = 0
    last_event_type: str | None = None
    updated_by_user_id: str | None = None
    created_at: datetime = field(default_factory=datetime.utcnow)
    updated_at: datetime = field(default_factory=datetime.utcnow)


@dataclass(frozen=True, slots=True)
class PlanningEvent:
    id: str
    organization_id: str | None
    workspace_id: str
    event_type: str
    schedule_id: str | None = None
    baseline_schedule_id: str | None = None
    candidate_schedule_id: str | None = None
    source_schedule_id: str | None = None
    edit_count: int = 0
    payload: dict = field(default_factory=dict)
    created_by_user_id: str | None = None
    created_at: datetime = field(default_factory=datetime.utcnow)


class PlanningControlRepository(Protocol):
    def get_state(
        self,
        *,
        organization_id: str | None,
        workspace_id: str,
    ) -> PlanningWorkspaceState | None: ...

    def save_state(
        self,
        state: PlanningWorkspaceState,
    ) -> PlanningWorkspaceState: ...

    def record_event(self, event: PlanningEvent) -> PlanningEvent: ...

    def list_events(
        self,
        *,
        organization_id: str | None,
        workspace_id: str,
        limit: int = 50,
        baseline_schedule_id: str | None = None,
        candidate_schedule_id: str | None = None,
    ) -> list[PlanningEvent]: ...
