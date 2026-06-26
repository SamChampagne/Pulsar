"""Port: persisted schedule runs."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Protocol

from ...domain.entities import Schedule


@dataclass(frozen=True, slots=True)
class ScheduleRunMetadata:
    """Metadata captured alongside a persisted schedule.

    Stored together with the schedule so that ``list_recent`` callers
    can surface strategy, KPIs and diagnostics without re-running
    the analysis pipeline.
    """

    metrics: dict = field(default_factory=dict)
    strategy: str = "unknown"
    solver_status: str = "unknown"
    objective_value: int = 0
    wall_time_ms: int = 0
    diagnostics: dict = field(default_factory=dict)
    workspace_id: str = "default"
    scenario_name: str = "Default Scenario"
    lifecycle_status: str = "draft"
    organization_id: str | None = None
    horizon_start: datetime | None = None
    horizon_end: datetime | None = None
    objective: dict = field(default_factory=dict)
    transfer_times: dict = field(default_factory=dict)
    input_snapshot: dict = field(default_factory=dict)
    input_snapshot_hash: str = ""
    engine_version: str = "aps-engine.v1"


class ScheduleRepository(Protocol):
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
    ) -> None: ...
    def get(self, schedule_id: str) -> Schedule | None: ...
    def get_metadata(self, schedule_id: str) -> ScheduleRunMetadata | None: ...
    def update_context(
        self,
        schedule_id: str,
        *,
        workspace_id: str | None = None,
        scenario_name: str | None = None,
        lifecycle_status: str | None = None,
    ) -> ScheduleRunMetadata | None: ...
    def delete(self, schedule_id: str) -> None: ...
    def list_recent(
        self,
        limit: int = 20,
        *,
        organization_id: str | None = None,
        workspace_id: str | None = None,
        lifecycle_status: str | None = None,
    ) -> list[tuple[Schedule, ScheduleRunMetadata]]: ...
