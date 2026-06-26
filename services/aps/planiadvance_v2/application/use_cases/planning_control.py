"""Workspace planning control plane use case.

This layer does not schedule anything itself. It persists the product state
around schedules: which run is the active baseline, which candidate is being
worked, and which planner/API events produced that state.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from uuid import uuid4

from ...domain.errors import ValidationError
from ..ports import (
    PlanningControlRepository,
    PlanningEvent,
    PlanningWorkspaceState,
    ScheduleRepository,
)
from ..ports.schedule_repository import ScheduleRunMetadata
from .planning_validation_gate import validate_schedule_scope
from .tenant_scope import data_workspace_id_from_metadata


@dataclass(frozen=True, slots=True)
class PlanningScheduleRef:
    schedule_id: str
    scenario_name: str
    lifecycle_status: str
    workspace_id: str
    organization_id: str | None
    strategy: str
    solver_status: str
    objective_value: int
    created_at: datetime
    horizon_start: datetime | None
    horizon_end: datetime | None
    input_snapshot_hash: str
    engine_version: str

    def as_dict(self) -> dict[str, object]:
        return {
            "schedule_id": self.schedule_id,
            "scenario_name": self.scenario_name,
            "lifecycle_status": self.lifecycle_status,
            "workspace_id": self.workspace_id,
            "organization_id": self.organization_id,
            "strategy": self.strategy,
            "solver_status": self.solver_status,
            "objective_value": self.objective_value,
            "created_at": self.created_at,
            "horizon_start": self.horizon_start,
            "horizon_end": self.horizon_end,
            "input_snapshot_hash": self.input_snapshot_hash,
            "engine_version": self.engine_version,
        }


@dataclass(frozen=True, slots=True)
class PlanningStateOutput:
    organization_id: str | None
    workspace_id: str
    active_baseline_schedule_id: str | None
    active_candidate_schedule_id: str | None
    candidate_status: str
    candidate_edit_count: int
    last_event_type: str | None
    updated_by_user_id: str | None
    updated_at: datetime | None
    active_baseline: PlanningScheduleRef | None = None
    active_candidate: PlanningScheduleRef | None = None
    recent_events: list[PlanningEvent] = field(default_factory=list)

    def as_dict(self) -> dict[str, object]:
        return {
            "organization_id": self.organization_id,
            "workspace_id": self.workspace_id,
            "active_baseline_schedule_id": self.active_baseline_schedule_id,
            "active_candidate_schedule_id": self.active_candidate_schedule_id,
            "candidate_status": self.candidate_status,
            "candidate_edit_count": self.candidate_edit_count,
            "last_event_type": self.last_event_type,
            "updated_by_user_id": self.updated_by_user_id,
            "updated_at": self.updated_at,
            "active_baseline": (
                self.active_baseline.as_dict() if self.active_baseline else None
            ),
            "active_candidate": (
                self.active_candidate.as_dict() if self.active_candidate else None
            ),
            "recent_events": [event_as_dict(event) for event in self.recent_events],
        }


@dataclass(frozen=True, slots=True)
class GetPlanningStateInput:
    organization_id: str | None
    workspace_id: str | None = None
    include_events: int = 20


@dataclass(frozen=True, slots=True)
class SelectPlanningBaselineInput:
    schedule_id: str
    organization_id: str | None
    workspace_id: str | None = None
    user_id: str | None = None
    scenario_name: str | None = None


@dataclass(frozen=True, slots=True)
class RecordPlanningCandidateInput:
    source_schedule_id: str
    candidate_schedule_id: str
    organization_id: str | None
    workspace_id: str | None = None
    user_id: str | None = None
    planner_actions: list[dict] = field(default_factory=list)
    unsupported_edits: list[dict] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    scenario_name: str | None = None


@dataclass(frozen=True, slots=True)
class DiscardPlanningCandidateInput:
    organization_id: str | None
    workspace_id: str | None = None
    user_id: str | None = None
    candidate_schedule_id: str | None = None
    reason: str | None = None


@dataclass(frozen=True, slots=True)
class RecordPlanningPublishInput:
    schedule_id: str
    organization_id: str | None
    workspace_id: str | None = None
    user_id: str | None = None
    previous_baseline_schedule_id: str | None = None
    publish_status: str | None = None
    recommendation: str | None = None


@dataclass(frozen=True, slots=True)
class ListPlanningEventsInput:
    organization_id: str | None
    workspace_id: str | None = None
    limit: int = 50
    baseline_schedule_id: str | None = None
    candidate_schedule_id: str | None = None


class PlanningControlPlane:
    def __init__(
        self,
        *,
        schedules: ScheduleRepository,
        planning: PlanningControlRepository,
    ) -> None:
        self._schedules = schedules
        self._planning = planning

    def get_state(self, command: GetPlanningStateInput) -> PlanningStateOutput:
        workspace_id = _workspace_id(command.workspace_id)
        state = self._planning.get_state(
            organization_id=command.organization_id,
            workspace_id=workspace_id,
        )
        return self._build_output(
            state,
            organization_id=command.organization_id,
            workspace_id=workspace_id,
            include_events=command.include_events,
        )

    def select_baseline(
        self,
        command: SelectPlanningBaselineInput,
    ) -> PlanningStateOutput:
        workspace_id = _workspace_id(command.workspace_id)
        self._load_ref(
            command.schedule_id,
            organization_id=command.organization_id,
            workspace_id=workspace_id,
            label="Baseline",
        )
        current = self._planning.get_state(
            organization_id=command.organization_id,
            workspace_id=workspace_id,
        )
        updated = self._schedules.update_context(
            command.schedule_id,
            scenario_name=command.scenario_name,
            lifecycle_status="published",
        )
        if updated is None:
            raise ValidationError(f"Schedule {command.schedule_id!r} not found")
        state = self._save_state(
            organization_id=command.organization_id,
            workspace_id=workspace_id,
            active_baseline_schedule_id=command.schedule_id,
            active_candidate_schedule_id=None,
            candidate_status="none",
            candidate_edit_count=0,
            event_type="baseline_selected",
            user_id=command.user_id,
            previous=current,
        )
        self._record_event(
            event_type="baseline_selected",
            organization_id=command.organization_id,
            workspace_id=workspace_id,
            schedule_id=command.schedule_id,
            baseline_schedule_id=command.schedule_id,
            user_id=command.user_id,
            payload={
                "previous_baseline_schedule_id": (
                    current.active_baseline_schedule_id if current else None
                ),
                "previous_candidate_schedule_id": (
                    current.active_candidate_schedule_id if current else None
                ),
                "scenario_name": command.scenario_name,
            },
        )
        return self._build_output(
            state,
            organization_id=command.organization_id,
            workspace_id=workspace_id,
        )

    def record_candidate(
        self,
        command: RecordPlanningCandidateInput,
    ) -> PlanningStateOutput:
        workspace_id = _workspace_id(command.workspace_id)
        self._load_ref(
            command.source_schedule_id,
            organization_id=command.organization_id,
            workspace_id=workspace_id,
            label="Source",
        )
        self._load_ref(
            command.candidate_schedule_id,
            organization_id=command.organization_id,
            workspace_id=workspace_id,
            label="Candidate",
        )
        current = self._planning.get_state(
            organization_id=command.organization_id,
            workspace_id=workspace_id,
        )
        baseline_schedule_id = self._baseline_for_candidate(
            source_schedule_id=command.source_schedule_id,
            current=current,
        )
        previous_candidate_id = (
            current.active_candidate_schedule_id if current is not None else None
        )
        if (
            previous_candidate_id
            and previous_candidate_id != command.candidate_schedule_id
            and previous_candidate_id != baseline_schedule_id
        ):
            self._schedules.update_context(
                previous_candidate_id,
                lifecycle_status="archived",
                scenario_name="Working candidate superseded",
            )
        edit_count = (
            (current.candidate_edit_count if current else 0) + 1
            if previous_candidate_id == command.source_schedule_id
            else 1
        )
        state = self._save_state(
            organization_id=command.organization_id,
            workspace_id=workspace_id,
            active_baseline_schedule_id=baseline_schedule_id,
            active_candidate_schedule_id=command.candidate_schedule_id,
            candidate_status="draft",
            candidate_edit_count=edit_count,
            event_type="candidate_edit_applied",
            user_id=command.user_id,
            previous=current,
        )
        self._record_event(
            event_type="candidate_edit_applied",
            organization_id=command.organization_id,
            workspace_id=workspace_id,
            schedule_id=command.candidate_schedule_id,
            baseline_schedule_id=baseline_schedule_id,
            candidate_schedule_id=command.candidate_schedule_id,
            source_schedule_id=command.source_schedule_id,
            edit_count=edit_count,
            user_id=command.user_id,
            payload={
                "scenario_name": command.scenario_name,
                "planner_actions": command.planner_actions,
                "unsupported_edits": command.unsupported_edits,
                "warnings": command.warnings,
                "previous_candidate_schedule_id": previous_candidate_id,
            },
        )
        return self._build_output(
            state,
            organization_id=command.organization_id,
            workspace_id=workspace_id,
        )

    def discard_candidate(
        self,
        command: DiscardPlanningCandidateInput,
    ) -> PlanningStateOutput:
        workspace_id = _workspace_id(command.workspace_id)
        current = self._planning.get_state(
            organization_id=command.organization_id,
            workspace_id=workspace_id,
        )
        candidate_schedule_id = command.candidate_schedule_id or (
            current.active_candidate_schedule_id if current else None
        )
        if candidate_schedule_id is None:
            return self._build_output(
                current,
                organization_id=command.organization_id,
                workspace_id=workspace_id,
            )
        self._load_ref(
            candidate_schedule_id,
            organization_id=command.organization_id,
            workspace_id=workspace_id,
            label="Candidate",
        )
        self._schedules.update_context(
            candidate_schedule_id,
            lifecycle_status="archived",
            scenario_name="Working candidate discarded",
        )
        state = self._save_state(
            organization_id=command.organization_id,
            workspace_id=workspace_id,
            active_baseline_schedule_id=(
                current.active_baseline_schedule_id if current else None
            ),
            active_candidate_schedule_id=None,
            candidate_status="discarded",
            candidate_edit_count=0,
            event_type="candidate_discarded",
            user_id=command.user_id,
            previous=current,
        )
        self._record_event(
            event_type="candidate_discarded",
            organization_id=command.organization_id,
            workspace_id=workspace_id,
            schedule_id=candidate_schedule_id,
            baseline_schedule_id=(
                current.active_baseline_schedule_id if current else None
            ),
            candidate_schedule_id=candidate_schedule_id,
            user_id=command.user_id,
            payload={"reason": command.reason},
        )
        return self._build_output(
            state,
            organization_id=command.organization_id,
            workspace_id=workspace_id,
        )

    def record_publish(
        self,
        command: RecordPlanningPublishInput,
    ) -> PlanningStateOutput:
        workspace_id = _workspace_id(command.workspace_id)
        self._load_ref(
            command.schedule_id,
            organization_id=command.organization_id,
            workspace_id=workspace_id,
            label="Published",
        )
        current = self._planning.get_state(
            organization_id=command.organization_id,
            workspace_id=workspace_id,
        )
        state = self._save_state(
            organization_id=command.organization_id,
            workspace_id=workspace_id,
            active_baseline_schedule_id=command.schedule_id,
            active_candidate_schedule_id=None,
            candidate_status="published",
            candidate_edit_count=0,
            event_type="candidate_published",
            user_id=command.user_id,
            previous=current,
        )
        self._record_event(
            event_type="candidate_published",
            organization_id=command.organization_id,
            workspace_id=workspace_id,
            schedule_id=command.schedule_id,
            baseline_schedule_id=command.schedule_id,
            candidate_schedule_id=command.schedule_id,
            user_id=command.user_id,
            payload={
                "previous_baseline_schedule_id": command.previous_baseline_schedule_id,
                "previous_candidate_schedule_id": (
                    current.active_candidate_schedule_id if current else None
                ),
                "publish_status": command.publish_status,
                "recommendation": command.recommendation,
            },
        )
        return self._build_output(
            state,
            organization_id=command.organization_id,
            workspace_id=workspace_id,
        )

    def list_events(self, command: ListPlanningEventsInput) -> list[PlanningEvent]:
        return self._planning.list_events(
            organization_id=command.organization_id,
            workspace_id=_workspace_id(command.workspace_id),
            limit=command.limit,
            baseline_schedule_id=command.baseline_schedule_id,
            candidate_schedule_id=command.candidate_schedule_id,
        )

    def _build_output(
        self,
        state: PlanningWorkspaceState | None,
        *,
        organization_id: str | None,
        workspace_id: str,
        include_events: int = 20,
    ) -> PlanningStateOutput:
        baseline_id = state.active_baseline_schedule_id if state else None
        if baseline_id is None:
            inferred = self._latest_ref(
                organization_id=organization_id,
                workspace_id=workspace_id,
                lifecycle_statuses={"published"},
            )
            baseline_id = inferred.schedule_id if inferred is not None else None
        candidate_id = state.active_candidate_schedule_id if state else None
        recent_events = self._planning.list_events(
            organization_id=organization_id,
            workspace_id=workspace_id,
            limit=include_events,
        )
        return PlanningStateOutput(
            organization_id=organization_id,
            workspace_id=workspace_id,
            active_baseline_schedule_id=baseline_id,
            active_candidate_schedule_id=candidate_id,
            candidate_status=state.candidate_status if state else "none",
            candidate_edit_count=state.candidate_edit_count if state else 0,
            last_event_type=state.last_event_type if state else None,
            updated_by_user_id=state.updated_by_user_id if state else None,
            updated_at=state.updated_at if state else None,
            active_baseline=(
                self._safe_ref(
                    baseline_id,
                    organization_id=organization_id,
                    workspace_id=workspace_id,
                )
                if baseline_id
                else None
            ),
            active_candidate=(
                self._safe_ref(
                    candidate_id,
                    organization_id=organization_id,
                    workspace_id=workspace_id,
                )
                if candidate_id
                else None
            ),
            recent_events=recent_events,
        )

    def _save_state(
        self,
        *,
        organization_id: str | None,
        workspace_id: str,
        active_baseline_schedule_id: str | None,
        active_candidate_schedule_id: str | None,
        candidate_status: str,
        candidate_edit_count: int,
        event_type: str,
        user_id: str | None,
        previous: PlanningWorkspaceState | None,
    ) -> PlanningWorkspaceState:
        now = datetime.utcnow()
        return self._planning.save_state(
            PlanningWorkspaceState(
                organization_id=organization_id,
                workspace_id=workspace_id,
                active_baseline_schedule_id=active_baseline_schedule_id,
                active_candidate_schedule_id=active_candidate_schedule_id,
                candidate_status=candidate_status,
                candidate_edit_count=candidate_edit_count,
                last_event_type=event_type,
                updated_by_user_id=user_id,
                created_at=previous.created_at if previous else now,
                updated_at=now,
            )
        )

    def _record_event(
        self,
        *,
        event_type: str,
        organization_id: str | None,
        workspace_id: str,
        schedule_id: str | None = None,
        baseline_schedule_id: str | None = None,
        candidate_schedule_id: str | None = None,
        source_schedule_id: str | None = None,
        edit_count: int = 0,
        payload: dict | None = None,
        user_id: str | None = None,
    ) -> PlanningEvent:
        event = PlanningEvent(
            id=f"plan_evt_{uuid4().hex}",
            organization_id=organization_id,
            workspace_id=workspace_id,
            event_type=event_type,
            schedule_id=schedule_id,
            baseline_schedule_id=baseline_schedule_id,
            candidate_schedule_id=candidate_schedule_id,
            source_schedule_id=source_schedule_id,
            edit_count=edit_count,
            payload=_jsonable(payload or {}),
            created_by_user_id=user_id,
            created_at=datetime.utcnow(),
        )
        return self._planning.record_event(event)

    def _baseline_for_candidate(
        self,
        *,
        source_schedule_id: str,
        current: PlanningWorkspaceState | None,
    ) -> str:
        if current is None or current.active_baseline_schedule_id is None:
            return source_schedule_id
        if source_schedule_id in {
            current.active_baseline_schedule_id,
            current.active_candidate_schedule_id,
        }:
            return current.active_baseline_schedule_id
        return current.active_baseline_schedule_id

    def _latest_ref(
        self,
        *,
        organization_id: str | None,
        workspace_id: str,
        lifecycle_statuses: set[str],
    ) -> PlanningScheduleRef | None:
        for schedule, metadata in self._schedules.list_recent(
            limit=200,
            organization_id=organization_id,
            workspace_id=workspace_id,
        ):
            if metadata.lifecycle_status in lifecycle_statuses:
                return self._to_ref(schedule.id, schedule.created_at, metadata)
        return None

    def _safe_ref(
        self,
        schedule_id: str,
        *,
        organization_id: str | None,
        workspace_id: str,
    ) -> PlanningScheduleRef | None:
        try:
            return self._load_ref(
                schedule_id,
                organization_id=organization_id,
                workspace_id=workspace_id,
                label="Planning state",
            )
        except ValidationError:
            return None

    def _load_ref(
        self,
        schedule_id: str,
        *,
        organization_id: str | None,
        workspace_id: str,
        label: str,
    ) -> PlanningScheduleRef:
        schedule = self._schedules.get(schedule_id)
        metadata = self._schedules.get_metadata(schedule_id)
        if schedule is None or metadata is None:
            raise ValidationError(f"{label} schedule {schedule_id!r} not found")
        validate_schedule_scope(
            metadata,
            expected_organization_id=organization_id,
            schedule_id=schedule_id,
            label=label,
        )
        actual_workspace_id = data_workspace_id_from_metadata(metadata) or "default"
        if actual_workspace_id != workspace_id:
            raise ValidationError(
                f"{label} schedule {schedule_id!r} belongs to workspace "
                f"{actual_workspace_id!r}, not {workspace_id!r}."
            )
        return self._to_ref(schedule.id, schedule.created_at, metadata)

    @staticmethod
    def _to_ref(
        schedule_id: str,
        created_at: datetime,
        metadata: ScheduleRunMetadata,
    ) -> PlanningScheduleRef:
        return PlanningScheduleRef(
            schedule_id=schedule_id,
            scenario_name=metadata.scenario_name,
            lifecycle_status=metadata.lifecycle_status,
            workspace_id=metadata.workspace_id or "default",
            organization_id=metadata.organization_id,
            strategy=metadata.strategy,
            solver_status=metadata.solver_status,
            objective_value=metadata.objective_value,
            created_at=created_at,
            horizon_start=metadata.horizon_start,
            horizon_end=metadata.horizon_end,
            input_snapshot_hash=metadata.input_snapshot_hash,
            engine_version=metadata.engine_version,
        )


def event_as_dict(event: PlanningEvent) -> dict[str, object]:
    return {
        "id": event.id,
        "organization_id": event.organization_id,
        "workspace_id": event.workspace_id,
        "event_type": event.event_type,
        "schedule_id": event.schedule_id,
        "baseline_schedule_id": event.baseline_schedule_id,
        "candidate_schedule_id": event.candidate_schedule_id,
        "source_schedule_id": event.source_schedule_id,
        "edit_count": event.edit_count,
        "payload": event.payload,
        "created_by_user_id": event.created_by_user_id,
        "created_at": event.created_at,
    }


def _workspace_id(workspace_id: str | None) -> str:
    return workspace_id or "default"


def _jsonable(value):
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, dict):
        return {str(key): _jsonable(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_jsonable(item) for item in value]
    return value
