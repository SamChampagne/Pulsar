"""Private, stateless Pulsar adapter. Never reads the standalone engine database.

Pulsar owns persistence and authorization. Every request builds fresh repositories
and uses the existing scheduling/publication use cases, with a server-supplied
tenant scope. The bridge's first version explicitly uses UTC wall-clock fields.
"""

from __future__ import annotations

import hmac
from dataclasses import replace
from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field, field_validator, model_validator

from ...application.integration import snapshot_to_domain_inputs
from ...application.use_cases.publish_scenario import PublishScenario, PublishScenarioInput
from ...application.use_cases.run_scheduling import RunScheduling, RunSchedulingInput
from ...config import get_settings
from ...domain.entities import Schedule, ScheduledOperation
from ...domain.value_objects import TimeWindow
from ...infrastructure.in_memory import (
    InMemoryCalendarRepository,
    InMemoryInventoryRepository,
    InMemoryMachineRepository,
    InMemoryResourceRepository,
    InMemoryScheduleRepository,
    InMemorySupplyRepository,
    InMemoryWorkOrderRepository,
)
from ..schemas import RunScheduleFromSnapshotRequest, RunScheduleResponse, ScheduledOperationOut
from .integration import _build_objective, _enforce_snapshot_limits, _schema_to_snapshot
from .scheduling import _build_analysis_out, _build_feasibility_out, _build_summary_out

BRIDGE_VERSION = "pulsar.aps.v1"
ENGINE_REVISION = "planiadvance-d26a8cd.pulsar-a1"
BRIDGE_V2 = "pulsar.aps.v2"
ENGINE_V2 = "planiadvance-d26a8cd.pulsar-a2"
router = APIRouter(prefix="/internal/pulsar", tags=["pulsar-internal"])


def service_tenant(
    x_api_key: str = Header(default=""),
    x_pulsar_tenant: str = Header(default="", min_length=1, max_length=128),
) -> str:
    # Deliberately no header-identity/demo fallback, even in development.
    key = get_settings().integration_api_key
    if not key:
        raise HTTPException(503, "Pulsar bridge service key is not configured")
    if not hmac.compare_digest(x_api_key.encode(), key.encode()):
        raise HTTPException(401, "Invalid service key")
    if not x_pulsar_tenant.strip():
        raise HTTPException(400, "Pulsar tenant context is required")
    return x_pulsar_tenant


class UtcWindow(BaseModel):
    start: datetime
    end: datetime

    @model_validator(mode="after")
    def valid_window(self):
        if self.start.tzinfo or self.end.tzinfo or self.end <= self.start:
            raise ValueError("Calendar windows must be ordered naive UTC instants")
        return self


class BridgeRunRequest(RunScheduleFromSnapshotRequest):
    bridge_version: Literal["pulsar.aps.v1", "pulsar.aps.v2"]
    time_zone: str = Field(min_length=1, max_length=100)
    horizon_start: datetime
    horizon_end: datetime | None = None
    calendar_windows: dict[str, list[UtcWindow]] | None = None

    @model_validator(mode="after")
    def version_contract(self):
        if self.bridge_version == BRIDGE_VERSION:
            if (
                self.time_zone != "UTC"
                or self.horizon_end is not None
                or self.calendar_windows is not None
            ):
                raise ValueError("V1 only supports UTC weekly calendars")
        else:
            if self.horizon_end is None or self.calendar_windows is None:
                raise ValueError("V2 requires explicit horizon_end and calendar_windows")
            if (
                self.horizon_end.tzinfo
                or not 0 < (self.horizon_end - self.horizon_start).total_seconds() <= 367 * 86400
            ):
                raise ValueError("Invalid explicit UTC horizon")
            if set(self.calendar_windows) != {c.id for c in self.snapshot.calendars}:
                raise ValueError("Resolved calendars must match the snapshot exactly")
            if sum(len(w) for w in self.calendar_windows.values()) > 100_000:
                raise ValueError("Too many resolved calendar windows")
            for windows in self.calendar_windows.values():
                for w in windows:
                    if w.start < self.horizon_start or w.end > self.horizon_end:
                        raise ValueError("Calendar window outside the captured horizon")
        return self

    @field_validator("horizon_start")
    @classmethod
    def naive_utc(cls, value: datetime) -> datetime:
        if value.tzinfo is not None:
            raise ValueError("Bridge dates must be naive UTC wall-clock values")
        return value


class BridgeRunResponse(RunScheduleResponse):
    bridge_version: Literal["pulsar.aps.v1", "pulsar.aps.v2"] = BRIDGE_VERSION
    engine_revision: Literal["planiadvance-d26a8cd.pulsar-a1", "planiadvance-d26a8cd.pulsar-a2"] = (
        ENGINE_REVISION
    )
    time_zone: str = "UTC"


@router.post("/run", response_model=BridgeRunResponse)
def run(payload: BridgeRunRequest, tenant: str = Depends(service_tenant)) -> BridgeRunResponse:
    snapshot = _schema_to_snapshot(payload.snapshot)
    _enforce_snapshot_limits(snapshot)
    calendars, machines, resources, orders, inventory, supplies, transfers = (
        snapshot_to_domain_inputs(snapshot)
    )
    if payload.calendar_windows is not None:
        calendars = [
            replace(
                c,
                resolved_windows=[
                    TimeWindow(start=w.start, end=w.end) for w in payload.calendar_windows[c.id]
                ],
            )
            for c in calendars
        ]

    # These are newly mapped dataclasses, not shared application repositories.
    def scoped(rows):
        return [replace(row, organization_id=tenant) for row in rows]

    result = RunScheduling(
        calendars=InMemoryCalendarRepository(scoped(calendars)),
        machines=InMemoryMachineRepository(scoped(machines)),
        resources=InMemoryResourceRepository(scoped(resources)),
        work_orders=InMemoryWorkOrderRepository(scoped(orders)),
        inventory=InMemoryInventoryRepository(scoped(inventory)),
        supplies=InMemorySupplyRepository(scoped(supplies)),
        schedules=InMemoryScheduleRepository(),
    ).execute(
        RunSchedulingInput(
            horizon_start=payload.horizon_start,
            horizon_days=payload.horizon_days,
            horizon_end=payload.horizon_end,
            snapshot_exported_at=payload.snapshot.exported_at
            if payload.bridge_version == BRIDGE_V2
            else None,
            heuristic=payload.heuristic,
            strategy=payload.strategy,
            objective=_build_objective(payload.objective),
            transfer_times=transfers,
            organization_id=tenant,
            persist=False,
        )
    )
    return BridgeRunResponse(
        bridge_version=payload.bridge_version,
        engine_revision=ENGINE_V2 if payload.bridge_version == BRIDGE_V2 else ENGINE_REVISION,
        time_zone=payload.time_zone,
        schedule_id=result.schedule.id,
        created_at=result.schedule.created_at,
        organization_id=tenant,
        horizon_start=result.horizon_start,
        horizon_end=result.horizon_end,
        input_snapshot_hash=result.input_snapshot_hash,
        engine_version=result.engine_version,
        strategy=result.strategy,
        solver_status=result.solver_status,
        objective_value=result.objective_value,
        wall_time_ms=result.wall_time_ms,
        assignments=[
            ScheduledOperationOut(
                operation_id=a.operation_id,
                work_order_id=a.work_order_id,
                machine_id=a.machine_id,
                setup_start=a.setup_start,
                start=a.start,
                end=a.end,
            )
            for a in result.schedule.assignments
        ],
        metrics=result.metrics,
        summary=_build_summary_out(result.summary),
        analysis=_build_analysis_out(result.analysis),
        feasibility=_build_feasibility_out(result.feasibility),
        diagnostics=result.diagnostics,
    )


class PublishCheckRequest(BaseModel):
    candidate: BridgeRunResponse
    baseline: RunScheduleResponse | None = None
    # No allow_review bypass in v1: a review must get a dedicated human UX first.


@router.post("/check-publication")
def check_publication(payload: PublishCheckRequest, tenant: str = Depends(service_tenant)) -> dict:
    return publication(payload, tenant, review=False)


@router.post("/review")
def review(payload: PublishCheckRequest, tenant: str = Depends(service_tenant)) -> dict:
    return publication(payload, tenant, review=True)


def publication(payload: PublishCheckRequest, tenant: str, *, review: bool) -> dict:
    repository = InMemoryScheduleRepository()
    for item in [payload.candidate, payload.baseline]:
        if item is None:
            continue
        if item.organization_id != tenant:
            raise HTTPException(400, "Schedule tenant context mismatch")
        repository.save(
            Schedule(
                id=item.schedule_id,
                created_at=item.created_at,
                assignments=[ScheduledOperation(**a.model_dump()) for a in item.assignments],
            ),
            metrics=item.metrics,
            strategy=item.strategy,
            solver_status=item.solver_status,
            diagnostics=item.diagnostics,
            objective_value=item.objective_value,
            organization_id=tenant,
            horizon_start=item.horizon_start,
            horizon_end=item.horizon_end,
            input_snapshot_hash=item.input_snapshot_hash,
            engine_version=item.engine_version,
        )
    # This "publish" only changes the request-local repository. The real baseline
    # is committed by Pulsar after its optimistic/transactional concurrency check.
    command = PublishScenarioInput(
        schedule_id=payload.candidate.schedule_id,
        baseline_schedule_id=payload.baseline.schedule_id if payload.baseline else None,
        organization_id=tenant,
    )
    use_case = PublishScenario(repository)
    return use_case.assess(command) if review else use_case.execute(command).as_dict()
