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
from pydantic import BaseModel, field_validator

from ...application.integration import snapshot_to_domain_inputs
from ...application.use_cases.publish_scenario import PublishScenario, PublishScenarioInput
from ...application.use_cases.run_scheduling import RunScheduling, RunSchedulingInput
from ...config import get_settings
from ...domain.entities import Schedule, ScheduledOperation
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


class BridgeRunRequest(RunScheduleFromSnapshotRequest):
    bridge_version: Literal["pulsar.aps.v1"]
    time_zone: Literal["UTC"]
    horizon_start: datetime

    @field_validator("horizon_start")
    @classmethod
    def naive_utc(cls, value: datetime) -> datetime:
        if value.tzinfo is not None:
            raise ValueError("Bridge dates must be naive UTC wall-clock values")
        return value


class BridgeRunResponse(RunScheduleResponse):
    bridge_version: Literal["pulsar.aps.v1"] = BRIDGE_VERSION
    engine_revision: Literal["planiadvance-d26a8cd.pulsar-a1"] = ENGINE_REVISION
    time_zone: Literal["UTC"] = "UTC"


@router.post("/run", response_model=BridgeRunResponse)
def run(payload: BridgeRunRequest, tenant: str = Depends(service_tenant)) -> BridgeRunResponse:
    snapshot = _schema_to_snapshot(payload.snapshot)
    _enforce_snapshot_limits(snapshot)
    calendars, machines, resources, orders, inventory, supplies, transfers = (
        snapshot_to_domain_inputs(snapshot)
    )

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
            heuristic=payload.heuristic,
            strategy=payload.strategy,
            objective=_build_objective(payload.objective),
            transfer_times=transfers,
            organization_id=tenant,
            persist=False,
        )
    )
    return BridgeRunResponse(
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
    return (
        PublishScenario(repository)
        .execute(
            PublishScenarioInput(
                schedule_id=payload.candidate.schedule_id,
                baseline_schedule_id=payload.baseline.schedule_id if payload.baseline else None,
                organization_id=tenant,
            )
        )
        .as_dict()
    )
