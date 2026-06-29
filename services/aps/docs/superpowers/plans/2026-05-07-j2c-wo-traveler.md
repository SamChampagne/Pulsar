# J2c — WO Traveler — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the third printable report — a WO Traveler PDF with WO header, ops in
sequence with eligible/planned machines, planned dates, setup/run minutes, and
materials with coverage status.

**Architecture:** Reuses J2a/J2b infrastructure (`PdfRenderer`, `WeasyprintRenderer`,
`base.html`, `print.css`, `view_reports` permission, `reports_html_preview_enabled`,
`/reports` router, `industrial_stack_smoke.py`). Adds three view DTOs in one module,
one use case, one Jinja2 template, two endpoints.

**Tech Stack:** Python 3.11+, FastAPI, SQLAlchemy 2.0, SQLite (test) /
PostgreSQL (real-stack), WeasyPrint ≥ 65, Jinja2, pytest.

**Spec:** `docs/superpowers/specs/2026-05-07-j2c-wo-traveler-design.md`

**Tenant safety:** all reads in the use case go through F-401
`repo.with_scope(scope)`. Anonymous calls are 401, INTEGRATOR is 403.

---

## Task 1: WoTravelerPayload DTOs

**Files:**
- Create: `planiadvance_v2/application/use_cases/reports/wo_traveler_payload.py`
- Modify: `planiadvance_v2/application/use_cases/reports/__init__.py` (export)

This task introduces only data structures. No tests — exercised by Task 2+ tests.

- [ ] **Step 1: Create the payload module**

Create `planiadvance_v2/application/use_cases/reports/wo_traveler_payload.py`:

```python
"""View DTOs for the WO Traveler PDF.

These are NOT domain entities — they exist purely to feed Jinja2
templates. ``CoverageStatus`` is a typed Literal so the use case and
template share the same vocabulary.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Literal

CoverageStatus = Literal["covered", "short", "unknown"]


@dataclass(frozen=True, slots=True)
class WoTravelerMaterialLine:
    material_id: str
    required_quantity: float
    coverage_status: CoverageStatus


@dataclass(frozen=True, slots=True)
class WoTravelerOperationLine:
    operation_id: str
    sequence: int
    name: str
    eligible_machine_ids: tuple[str, ...]
    planned_machine_id: str | None
    planned_start: datetime | None
    planned_end: datetime | None
    setup_minutes: int
    run_minutes: int
    materials: tuple[WoTravelerMaterialLine, ...]


@dataclass(frozen=True, slots=True)
class WoTravelerPayload:
    organization_name: str
    workspace_name: str | None
    schedule_id: str
    schedule_published_at: datetime
    generated_at: datetime
    work_order_ref: str
    work_order_name: str
    product_id: str
    quantity: int
    priority: str
    status: str
    due_date: datetime
    release_date: datetime
    planned_start: datetime | None
    planned_end: datetime | None
    operations: tuple[WoTravelerOperationLine, ...]
    total_setup_minutes: int
    total_run_minutes: int
    total_operation_count: int
```

- [ ] **Step 2: Re-export from the reports package**

Edit `planiadvance_v2/application/use_cases/reports/__init__.py` — keep existing
exports and add the new ones. Final file:

```python
"""Use cases that build report payloads consumed by the PdfRenderer."""

from .build_late_order_report import BuildLateOrderReport
from .build_production_sheet import (
    BuildProductionSheet,
    MachineNotFoundForReport,
    NoPublishedScheduleForReport,
    ReportError,
    RequestedDateOutsideHorizon,
)
from .late_order_classifier import classify_late_order_reason
from .late_order_payload import (
    REASON_TO_ACTION,
    LateOrderLine,
    LateOrderPayload,
    LateOrderReason,
    RecommendedAction,
)
from .production_sheet_payload import ProductionSheetLine, ProductionSheetPayload
from .wo_traveler_payload import (
    CoverageStatus,
    WoTravelerMaterialLine,
    WoTravelerOperationLine,
    WoTravelerPayload,
)

__all__ = [
    "BuildLateOrderReport",
    "BuildProductionSheet",
    "CoverageStatus",
    "LateOrderLine",
    "LateOrderPayload",
    "LateOrderReason",
    "MachineNotFoundForReport",
    "NoPublishedScheduleForReport",
    "ProductionSheetLine",
    "ProductionSheetPayload",
    "REASON_TO_ACTION",
    "RecommendedAction",
    "ReportError",
    "RequestedDateOutsideHorizon",
    "WoTravelerMaterialLine",
    "WoTravelerOperationLine",
    "WoTravelerPayload",
    "classify_late_order_reason",
]
```

- [ ] **Step 3: Run unit suite to verify no breakage**

```bash
python -m pytest tests/unit -q
```

Expected: 752 PASSED (same as end of J2b).

- [ ] **Step 4: Commit**

```bash
git add planiadvance_v2/application/use_cases/reports/wo_traveler_payload.py planiadvance_v2/application/use_cases/reports/__init__.py
git commit -m "Add WoTravelerPayload DTOs for J2c

View dataclasses (not domain entities). Three frozen records:
WoTravelerMaterialLine, WoTravelerOperationLine, WoTravelerPayload.
CoverageStatus literal pins the covered/short/unknown vocabulary."
```

---

## Task 2: BuildWoTraveler use case (TDD)

**Files:**
- Create: `planiadvance_v2/application/use_cases/reports/build_wo_traveler.py`
- Modify: `planiadvance_v2/application/use_cases/reports/__init__.py` (export)
- Test: `tests/unit/use_cases/reports/test_build_wo_traveler.py`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/use_cases/reports/test_build_wo_traveler.py`:

```python
"""TDD tests for BuildWoTraveler.

Uses in-memory repositories. The schedule contains assignments for
two operations of the target WO; a third op is left unplanned to
exercise the partial-plan path. A WO from another organization
confirms F-401 scoping.
"""

from __future__ import annotations

from datetime import datetime, timedelta

import pytest

from planiadvance_v2.application.use_cases.reports import (
    NoPublishedScheduleForReport,
)
from planiadvance_v2.application.use_cases.reports.build_wo_traveler import (
    BuildWoTraveler,
    WorkOrderNotFoundForReport,
)
from planiadvance_v2.domain.entities import (
    MaterialRequirement,
    Operation,
    Organization,
    Schedule,
    ScheduledOperation,
    Workspace,
    WorkOrder,
)
from planiadvance_v2.domain.value_objects import Duration, Priority
from planiadvance_v2.infrastructure.in_memory.repositories import (
    InMemoryOrganizationRepository,
    InMemoryScheduleRepository,
    InMemoryWorkOrderRepository,
    InMemoryWorkspaceRepository,
)
from planiadvance_v2.infrastructure.scoping import TenantScope


_ORG_A = "org-a"
_ORG_B = "org-b"
_WS_A = "ws-a"


def _op(
    op_id: str,
    wo_id: str,
    *,
    sequence: int,
    eligible: tuple[str, ...] = ("M-A",),
    materials: tuple[MaterialRequirement, ...] = (),
    duration_min: int = 60,
    setup_min: int = 10,
) -> Operation:
    return Operation(
        id=op_id,
        work_order_id=wo_id,
        sequence=sequence,
        name=f"Op {sequence}",
        duration=Duration(minutes=duration_min),
        setup_time=Duration(minutes=setup_min),
        eligible_machine_ids=list(eligible),
        dependencies=[],
        material_requirements=list(materials),
    )


def _wo(
    wo_id: str,
    *,
    operations: list[Operation],
    organization_id: str = _ORG_A,
    workspace_id: str | None = _WS_A,
    quantity: int = 5,
    priority: Priority = Priority.HIGH,
) -> WorkOrder:
    return WorkOrder(
        id=wo_id,
        name=f"WO {wo_id}",
        product_id=f"PROD-{wo_id}",
        quantity=quantity,
        due_date=datetime(2026, 5, 12, 17, 0),
        release_date=datetime(2026, 5, 4, 8, 0),
        operations=operations,
        priority=priority,
        organization_id=organization_id,
        workspace_id=workspace_id,
    )


def _scheduled(
    op_id: str,
    wo_id: str,
    *,
    machine: str = "M-A",
    start: datetime,
    duration_min: int = 60,
) -> ScheduledOperation:
    return ScheduledOperation(
        operation_id=op_id,
        work_order_id=wo_id,
        machine_id=machine,
        setup_start=start - timedelta(minutes=10),
        start=start,
        end=start + timedelta(minutes=duration_min),
    )


@pytest.fixture
def fixture():
    target_ops = [
        _op(
            "WO-1-OP1",
            "WO-1",
            sequence=1,
            eligible=("M-A", "M-B"),
            materials=(
                MaterialRequirement(material_id="RAW-AL", quantity_per_unit=0.5),
                MaterialRequirement(material_id="STEEL", fixed_quantity=1.0),
            ),
        ),
        _op(
            "WO-1-OP2",
            "WO-1",
            sequence=2,
            eligible=("M-C",),
            materials=(
                MaterialRequirement(material_id="PAINT-RED", quantity_per_unit=0.1),
            ),
        ),
        _op("WO-1-OP3", "WO-1", sequence=3, eligible=("M-D",)),  # unplanned
    ]
    target_wo = _wo("WO-1", operations=target_ops)

    other_tenant_wo = _wo(
        "WO-OTHER",
        operations=[_op("WO-OTHER-OP1", "WO-OTHER", sequence=1)],
        organization_id=_ORG_B,
        workspace_id=None,
    )

    work_orders_repo = InMemoryWorkOrderRepository([target_wo, other_tenant_wo])
    organizations = InMemoryOrganizationRepository(
        [
            Organization(id=_ORG_A, name="Plant QC", slug="plant-qc"),
            Organization(id=_ORG_B, name="Plant EU", slug="plant-eu"),
        ]
    )
    workspaces = InMemoryWorkspaceRepository(
        [Workspace(id=_WS_A, name="Plant A", organization_id=_ORG_A)]
    )

    schedule = Schedule(
        id="sched-1",
        created_at=datetime(2026, 5, 7, 9, 14),
        assignments=[
            _scheduled("WO-1-OP1", "WO-1", machine="M-A", start=datetime(2026, 5, 5, 8, 0)),
            _scheduled("WO-1-OP2", "WO-1", machine="M-C", start=datetime(2026, 5, 6, 10, 0)),
            # OP3 is unplanned on purpose.
        ],
    )
    schedules = InMemoryScheduleRepository()
    schedules.save(
        schedule,
        metrics={},
        organization_id=_ORG_A,
        workspace_id=_WS_A,
        lifecycle_status="published",
        horizon_start=datetime(2026, 5, 5, 0, 0),
        horizon_end=datetime(2026, 5, 12, 0, 0),
        diagnostics={
            "material_pegging_report": {
                "status": "short",
                "pegging_records": [
                    {
                        "operation_id": "WO-1-OP1",
                        "material_id": "RAW-AL",
                        "coverage_status": "covered",
                    },
                    {
                        "operation_id": "WO-1-OP1",
                        "material_id": "STEEL",
                        "coverage_status": "short",
                    },
                    # PAINT-RED has no pegging record -> status 'unknown'
                ],
            },
        },
    )

    return BuildWoTraveler(
        work_orders=work_orders_repo,
        organizations=organizations,
        workspaces=workspaces,
        schedules=schedules,
    )


class TestBuildWoTravelerHappyPath:
    def test_returns_full_payload_with_planned_and_unplanned_ops(self, fixture):
        scope = TenantScope.for_workspace(organization_id=_ORG_A, workspace_id=_WS_A)

        payload = fixture.execute(work_order_id="WO-1", scope=scope)

        assert payload.organization_name == "Plant QC"
        assert payload.workspace_name == "Plant A"
        assert payload.schedule_id == "sched-1"
        assert payload.work_order_ref == "WO-1"
        assert payload.product_id == "PROD-WO-1"
        assert payload.quantity == 5
        assert payload.priority == "HIGH"
        assert payload.due_date == datetime(2026, 5, 12, 17, 0)
        assert payload.release_date == datetime(2026, 5, 4, 8, 0)
        assert len(payload.operations) == 3
        # Operations are sorted by sequence.
        assert [op.sequence for op in payload.operations] == [1, 2, 3]
        # WO planned span = min(planned_start) -> max(planned_end).
        assert payload.planned_start == datetime(2026, 5, 5, 8, 0)
        assert payload.planned_end == datetime(2026, 5, 6, 11, 0)

    def test_planned_op_has_machine_and_dates(self, fixture):
        scope = TenantScope.for_workspace(organization_id=_ORG_A, workspace_id=_WS_A)

        payload = fixture.execute(work_order_id="WO-1", scope=scope)

        op1 = next(op for op in payload.operations if op.operation_id == "WO-1-OP1")
        assert op1.planned_machine_id == "M-A"
        assert op1.planned_start == datetime(2026, 5, 5, 8, 0)
        assert op1.planned_end == datetime(2026, 5, 5, 9, 0)
        assert op1.eligible_machine_ids == ("M-A", "M-B")
        assert op1.setup_minutes == 10
        assert op1.run_minutes == 60

    def test_unplanned_op_has_none_dates(self, fixture):
        scope = TenantScope.for_workspace(organization_id=_ORG_A, workspace_id=_WS_A)

        payload = fixture.execute(work_order_id="WO-1", scope=scope)

        op3 = next(op for op in payload.operations if op.operation_id == "WO-1-OP3")
        assert op3.planned_machine_id is None
        assert op3.planned_start is None
        assert op3.planned_end is None
        assert op3.eligible_machine_ids == ("M-D",)

    def test_material_coverage_resolved_from_pegging(self, fixture):
        scope = TenantScope.for_workspace(organization_id=_ORG_A, workspace_id=_WS_A)

        payload = fixture.execute(work_order_id="WO-1", scope=scope)

        op1 = next(op for op in payload.operations if op.operation_id == "WO-1-OP1")
        materials = {m.material_id: m for m in op1.materials}
        assert materials["RAW-AL"].coverage_status == "covered"
        # WO quantity = 5, RAW-AL.quantity_per_unit = 0.5 -> 2.5
        assert materials["RAW-AL"].required_quantity == pytest.approx(2.5)
        assert materials["STEEL"].coverage_status == "short"
        # WO quantity = 5, STEEL.fixed_quantity = 1.0 -> 1.0
        assert materials["STEEL"].required_quantity == pytest.approx(1.0)

        op2 = next(op for op in payload.operations if op.operation_id == "WO-1-OP2")
        materials_op2 = {m.material_id: m for m in op2.materials}
        # PAINT-RED has no pegging record -> 'unknown'
        assert materials_op2["PAINT-RED"].coverage_status == "unknown"

    def test_aggregates_setup_and_run_totals(self, fixture):
        scope = TenantScope.for_workspace(organization_id=_ORG_A, workspace_id=_WS_A)

        payload = fixture.execute(work_order_id="WO-1", scope=scope)

        # 3 ops × (10 setup + 60 run) = 30 setup, 180 run
        assert payload.total_setup_minutes == 30
        assert payload.total_run_minutes == 180
        assert payload.total_operation_count == 3


class TestBuildWoTravelerErrors:
    def test_unknown_work_order_raises(self, fixture):
        scope = TenantScope.for_workspace(organization_id=_ORG_A, workspace_id=_WS_A)

        with pytest.raises(WorkOrderNotFoundForReport):
            fixture.execute(work_order_id="WO-DOES-NOT-EXIST", scope=scope)

    def test_cross_tenant_work_order_raises_not_found(self, fixture):
        # WO-OTHER belongs to org-b; from org-a it must look invisible.
        scope = TenantScope.for_organization(_ORG_A)

        with pytest.raises(WorkOrderNotFoundForReport):
            fixture.execute(work_order_id="WO-OTHER", scope=scope)


class TestBuildWoTravelerNoSchedule:
    def test_no_published_schedule_raises(self):
        wo = _wo(
            "WO-1",
            operations=[_op("WO-1-OP1", "WO-1", sequence=1)],
        )
        wos = InMemoryWorkOrderRepository([wo])
        organizations = InMemoryOrganizationRepository(
            [Organization(id=_ORG_A, name="Plant QC", slug="plant-qc")]
        )
        workspaces = InMemoryWorkspaceRepository([])
        schedules = InMemoryScheduleRepository()  # empty

        builder = BuildWoTraveler(
            work_orders=wos,
            organizations=organizations,
            workspaces=workspaces,
            schedules=schedules,
        )

        with pytest.raises(NoPublishedScheduleForReport):
            builder.execute(
                work_order_id="WO-1",
                scope=TenantScope.for_organization(_ORG_A),
            )


class TestBuildWoTravelerAllUnplanned:
    def test_wo_with_zero_planned_ops_has_none_planned_span(self):
        wo = _wo(
            "WO-1",
            operations=[
                _op("WO-1-OP1", "WO-1", sequence=1),
                _op("WO-1-OP2", "WO-1", sequence=2),
            ],
        )
        wos = InMemoryWorkOrderRepository([wo])
        organizations = InMemoryOrganizationRepository(
            [Organization(id=_ORG_A, name="Plant QC", slug="plant-qc")]
        )
        workspaces = InMemoryWorkspaceRepository([])
        schedule = Schedule(
            id="sched-1",
            created_at=datetime(2026, 5, 7, 9, 14),
            assignments=[],  # nothing planned
        )
        schedules = InMemoryScheduleRepository()
        schedules.save(
            schedule,
            metrics={},
            organization_id=_ORG_A,
            workspace_id=None,
            lifecycle_status="published",
            horizon_start=datetime(2026, 5, 5, 0, 0),
            horizon_end=datetime(2026, 5, 12, 0, 0),
        )

        builder = BuildWoTraveler(
            work_orders=wos,
            organizations=organizations,
            workspaces=workspaces,
            schedules=schedules,
        )
        payload = builder.execute(
            work_order_id="WO-1",
            scope=TenantScope.for_organization(_ORG_A),
        )

        assert payload.planned_start is None
        assert payload.planned_end is None
        assert all(op.planned_machine_id is None for op in payload.operations)
        assert all(op.planned_start is None for op in payload.operations)
```

- [ ] **Step 2: Run the tests, watch them fail (RED)**

```bash
python -m pytest tests/unit/use_cases/reports/test_build_wo_traveler.py -v
```

Expected: `ModuleNotFoundError: No module named
'planiadvance_v2.application.use_cases.reports.build_wo_traveler'`.

- [ ] **Step 3: Implement the use case**

Create `planiadvance_v2/application/use_cases/reports/build_wo_traveler.py`:

```python
"""Use case: build the WO Traveler payload for one work order.

Loads the WO scoped to the active tenant and the latest published
Schedule, looks up each operation's assignment (if planned), reads
material coverage from the pegging report, and assembles a
``WoTravelerPayload``.

All reads honour the F-401 ScopedRepository pattern. Cross-tenant
work_order_id is invisible to the scoped view and surfaces as
``WorkOrderNotFoundForReport``.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from ....domain.entities import Operation, ScheduledOperation
from ....infrastructure.scoping import TenantScope
from ...ports.account_repository import OrganizationRepository
from ...ports.schedule_repository import ScheduleRepository
from ...ports.work_order_repository import WorkOrderRepository
from ...ports.workspace_repository import WorkspaceRepository
from .build_production_sheet import NoPublishedScheduleForReport, ReportError
from .wo_traveler_payload import (
    CoverageStatus,
    WoTravelerMaterialLine,
    WoTravelerOperationLine,
    WoTravelerPayload,
)


class WorkOrderNotFoundForReport(ReportError):
    pass


class BuildWoTraveler:
    def __init__(
        self,
        *,
        work_orders: WorkOrderRepository,
        organizations: OrganizationRepository,
        workspaces: WorkspaceRepository,
        schedules: ScheduleRepository,
    ) -> None:
        self._work_orders = work_orders
        self._organizations = organizations
        self._workspaces = workspaces
        self._schedules = schedules

    def execute(self, *, work_order_id: str, scope: TenantScope) -> WoTravelerPayload:
        organization_id = scope.require_organization()
        generated_at = datetime.now()

        wo = self._work_orders.with_scope(scope).get(work_order_id)
        if wo is None:
            raise WorkOrderNotFoundForReport(
                f"Work order {work_order_id!r} not found in current tenant."
            )

        published = self._schedules.list_recent(
            limit=1,
            organization_id=organization_id,
            workspace_id=scope.workspace_id,
            lifecycle_status="published",
        )
        if not published:
            raise NoPublishedScheduleForReport(
                "No published schedule for the active tenant. Publish a "
                "scenario before printing reports."
            )
        schedule, metadata = published[0]

        assignments_by_op = {
            a.operation_id: a for a in schedule.assignments if a.work_order_id == wo.id
        }
        diagnostics = metadata.diagnostics or {}

        op_lines = tuple(
            _build_operation_line(
                op, assignments_by_op.get(op.id), diagnostics, wo.quantity
            )
            for op in wo.ordered_operations()
        )
        planned_starts = [
            line.planned_start for line in op_lines if line.planned_start is not None
        ]
        planned_ends = [
            line.planned_end for line in op_lines if line.planned_end is not None
        ]
        planned_start = min(planned_starts) if planned_starts else None
        planned_end = max(planned_ends) if planned_ends else None

        total_setup = sum(line.setup_minutes for line in op_lines)
        total_run = sum(line.run_minutes for line in op_lines)

        org = self._organizations.get(organization_id)
        workspace = (
            self._workspaces.get(scope.workspace_id) if scope.workspace_id else None
        )

        return WoTravelerPayload(
            organization_name=org.name if org else organization_id,
            workspace_name=workspace.name if workspace else None,
            schedule_id=schedule.id,
            schedule_published_at=schedule.created_at,
            generated_at=generated_at,
            work_order_ref=wo.id,
            work_order_name=wo.name,
            product_id=wo.product_id,
            quantity=wo.quantity,
            priority=wo.priority.name,
            status=wo.status.name,
            due_date=wo.due_date,
            release_date=wo.release_date,
            planned_start=planned_start,
            planned_end=planned_end,
            operations=op_lines,
            total_setup_minutes=total_setup,
            total_run_minutes=total_run,
            total_operation_count=len(op_lines),
        )


def _build_operation_line(
    op: Operation,
    assignment: ScheduledOperation | None,
    diagnostics: dict[str, Any],
    wo_quantity: int,
) -> WoTravelerOperationLine:
    if assignment is not None:
        planned_machine = assignment.machine_id
        planned_start = assignment.start
        planned_end = assignment.end
    else:
        planned_machine = None
        planned_start = None
        planned_end = None

    materials = tuple(
        WoTravelerMaterialLine(
            material_id=req.material_id,
            required_quantity=req.required_quantity(wo_quantity),
            coverage_status=_coverage_status_for(
                op.id, req.material_id, diagnostics
            ),
        )
        for req in op.material_requirements
    )

    return WoTravelerOperationLine(
        operation_id=op.id,
        sequence=op.sequence,
        name=op.name,
        eligible_machine_ids=tuple(op.eligible_machine_ids),
        planned_machine_id=planned_machine,
        planned_start=planned_start,
        planned_end=planned_end,
        setup_minutes=int(op.setup_time.minutes),
        run_minutes=int(op.duration.minutes),
        materials=materials,
    )


def _coverage_status_for(
    operation_id: str,
    material_id: str,
    diagnostics: dict[str, Any],
) -> CoverageStatus:
    pegging = diagnostics.get("material_pegging_report")
    if not isinstance(pegging, dict):
        return "unknown"
    for record in pegging.get("pegging_records") or []:
        if not isinstance(record, dict):
            continue
        if record.get("operation_id") != operation_id:
            continue
        if record.get("material_id") != material_id:
            continue
        status = record.get("coverage_status")
        if status in ("covered", "short"):
            return status  # type: ignore[return-value]
    return "unknown"
```

- [ ] **Step 4: Re-export from the package**

Edit `planiadvance_v2/application/use_cases/reports/__init__.py` — add the import
and append `BuildWoTraveler` and `WorkOrderNotFoundForReport` in alphabetical order.
The full file should now be:

```python
"""Use cases that build report payloads consumed by the PdfRenderer."""

from .build_late_order_report import BuildLateOrderReport
from .build_production_sheet import (
    BuildProductionSheet,
    MachineNotFoundForReport,
    NoPublishedScheduleForReport,
    ReportError,
    RequestedDateOutsideHorizon,
)
from .build_wo_traveler import BuildWoTraveler, WorkOrderNotFoundForReport
from .late_order_classifier import classify_late_order_reason
from .late_order_payload import (
    REASON_TO_ACTION,
    LateOrderLine,
    LateOrderPayload,
    LateOrderReason,
    RecommendedAction,
)
from .production_sheet_payload import ProductionSheetLine, ProductionSheetPayload
from .wo_traveler_payload import (
    CoverageStatus,
    WoTravelerMaterialLine,
    WoTravelerOperationLine,
    WoTravelerPayload,
)

__all__ = [
    "BuildLateOrderReport",
    "BuildProductionSheet",
    "BuildWoTraveler",
    "CoverageStatus",
    "LateOrderLine",
    "LateOrderPayload",
    "LateOrderReason",
    "MachineNotFoundForReport",
    "NoPublishedScheduleForReport",
    "ProductionSheetLine",
    "ProductionSheetPayload",
    "REASON_TO_ACTION",
    "RecommendedAction",
    "ReportError",
    "RequestedDateOutsideHorizon",
    "WoTravelerMaterialLine",
    "WoTravelerOperationLine",
    "WoTravelerPayload",
    "WorkOrderNotFoundForReport",
    "classify_late_order_reason",
]
```

- [ ] **Step 5: Run the tests, verify GREEN**

```bash
python -m pytest tests/unit/use_cases/reports/test_build_wo_traveler.py -v
```

Expected: 8 PASSED.

- [ ] **Step 6: Run the full unit suite to confirm no regression**

```bash
python -m pytest tests/unit -q
```

Expected: 752 + 8 = 760 PASS.

- [ ] **Step 7: Commit**

```bash
git add planiadvance_v2/application/use_cases/reports/build_wo_traveler.py planiadvance_v2/application/use_cases/reports/__init__.py tests/unit/use_cases/reports/test_build_wo_traveler.py
git commit -m "Add BuildWoTraveler use case (J2c, TDD, 8 cases)

F-401 scoped read of the WO. Per-operation traveler line with planned
machine + dates (None when unplanned), eligible machines, setup/run
minutes, and materials enriched with coverage status from the
material_pegging_report. WO planned span = min(start) -> max(end)
across planned ops, None when nothing is planned.

Cross-tenant work_order_id surfaces as WorkOrderNotFoundForReport
(404 in the route layer)."
```

---

## Task 3: wo_traveler.html template + snapshot test

**Files:**
- Create: `planiadvance_v2/infrastructure/pdf/templates/wo_traveler.html`
- Create: `tests/unit/infrastructure/pdf/test_wo_traveler_template.py`
- Create: `tests/fixtures/golden/wo_traveler.html` (generated on first test run)

- [ ] **Step 1: Write the template**

Create `planiadvance_v2/infrastructure/pdf/templates/wo_traveler.html`:

```html
{% extends "base.html" %}
{% block title %}WO Traveler — {{ ctx.work_order_ref }}{% endblock %}
{% block head_extra %}
<style>
  .op-block {
    border-top: 0.5pt solid #999;
    padding: 4mm 0;
    page-break-inside: avoid;
  }
  .op-block h3 {
    font-size: 11pt;
    margin: 0 0 2mm 0;
  }
  .op-block .op-meta {
    margin: 1mm 0;
    font-size: 9pt;
    color: #444;
  }
  .op-block table.materials {
    width: 60%;
    margin-top: 2mm;
    font-size: 9pt;
    border-collapse: collapse;
  }
  .op-block table.materials th,
  .op-block table.materials td {
    text-align: left;
    padding: 1.5pt 4pt;
    border-bottom: 0.25pt solid #ccc;
  }
  .op-block table.materials td.numeric {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  .op-block .coverage-covered { color: #117a3d; }
  .op-block .coverage-short { color: #a3262e; font-weight: bold; }
  .op-block .coverage-unknown { color: #888; }
  .wo-header dl {
    margin: 0;
    display: grid;
    grid-template-columns: 24mm auto;
    gap: 1mm 4mm;
    font-size: 10pt;
  }
  .wo-header dt {
    font-weight: bold;
    color: #444;
  }
  .wo-header dd {
    margin: 0;
  }
</style>
{% endblock %}
{% block body %}
<header class="header-row">
  <h1 data-header-string="{{ ctx.organization_name }} · WO Traveler · {{ ctx.work_order_ref }}">
    Work Order Traveler — {{ ctx.work_order_ref }}
  </h1>
  <div class="meta">
    <div>{{ ctx.organization_name }}{% if ctx.workspace_name %} · {{ ctx.workspace_name }}{% endif %}</div>
    <div>Generated: <strong>{{ ctx.generated_at.strftime('%Y-%m-%d %H:%M') }}</strong></div>
  </div>
</header>

<section class="wo-header">
  <h2 style="margin: 2mm 0 4mm 0; font-size: 13pt">{{ ctx.work_order_name }}</h2>
  <dl>
    <dt>Product</dt>      <dd>{{ ctx.product_id }}</dd>
    <dt>Quantity</dt>     <dd>{{ ctx.quantity }}</dd>
    <dt>Priority</dt>     <dd>{{ ctx.priority }}</dd>
    <dt>Status</dt>       <dd>{{ ctx.status }}</dd>
    <dt>Release</dt>      <dd>{{ ctx.release_date.strftime('%Y-%m-%d %H:%M') }}</dd>
    <dt>Due</dt>          <dd>{{ ctx.due_date.strftime('%Y-%m-%d %H:%M') }}</dd>
    <dt>Planned</dt>
    <dd>
      {% if ctx.planned_start and ctx.planned_end %}
        {{ ctx.planned_start.strftime('%Y-%m-%d %H:%M') }} → {{ ctx.planned_end.strftime('%Y-%m-%d %H:%M') }}
      {% else %}
        — (no operations are planned in the current schedule)
      {% endif %}
    </dd>
  </dl>
</section>

<section style="margin-top: 6mm">
  <h2 style="font-size: 12pt; margin: 0 0 2mm 0">Operations</h2>
  {% for op in ctx.operations %}
  <div class="op-block">
    <h3>Op {{ op.sequence }} · {{ op.name }}</h3>
    <div class="op-meta">
      <strong>Eligible:</strong> {{ op.eligible_machine_ids | join(', ') }}
    </div>
    <div class="op-meta">
      <strong>Planned:</strong>
      {% if op.planned_machine_id %}
        {{ op.planned_machine_id }} · {{ op.planned_start.strftime('%Y-%m-%d %H:%M') }} → {{ op.planned_end.strftime('%Y-%m-%d %H:%M') }}
      {% else %}
        — (not planned)
      {% endif %}
    </div>
    <div class="op-meta">
      <strong>Setup:</strong> {{ op.setup_minutes }} min ·
      <strong>Run:</strong> {{ op.run_minutes }} min
    </div>
    {% if op.materials %}
    <table class="materials">
      <thead>
        <tr>
          <th>Material</th>
          <th class="numeric">Required</th>
          <th>Coverage</th>
        </tr>
      </thead>
      <tbody>
        {% for material in op.materials %}
        <tr>
          <td>{{ material.material_id }}</td>
          <td class="numeric">{{ '%.2f'|format(material.required_quantity) }}</td>
          <td class="coverage-{{ material.coverage_status }}">
            {% if material.coverage_status == "covered" %}covered ✓{% elif material.coverage_status == "short" %}short ⚠{% else %}?{% endif %}
          </td>
        </tr>
        {% endfor %}
      </tbody>
    </table>
    {% else %}
    <div class="op-meta" style="color:#888">No material requirements.</div>
    {% endif %}
  </div>
  {% else %}
  <p style="color:#888; padding:6mm 0">This work order has no operations defined.</p>
  {% endfor %}
</section>

<footer class="footer-totals">
  <div>
    <strong>Total ops:</strong> {{ ctx.total_operation_count }} ·
    <strong>Setup:</strong> {{ ctx.total_setup_minutes }} min ·
    <strong>Run:</strong> {{ ctx.total_run_minutes }} min
  </div>
  <div class="schedule-info">
    Schedule {{ ctx.schedule_id }} · published {{ ctx.schedule_published_at.strftime('%Y-%m-%d %H:%M') }}
  </div>
</footer>
{% endblock %}
```

- [ ] **Step 2: Write the snapshot test**

Create `tests/unit/infrastructure/pdf/test_wo_traveler_template.py`:

```python
"""Snapshot test for wo_traveler.html.

Renders the template against a fixed payload covering planned ops,
an unplanned op, and the three coverage statuses (covered / short /
unknown). Regenerate the golden by deleting the file.
"""

from __future__ import annotations

from datetime import datetime
from pathlib import Path

import pytest

from planiadvance_v2.application.use_cases.reports.wo_traveler_payload import (
    WoTravelerMaterialLine,
    WoTravelerOperationLine,
    WoTravelerPayload,
)
from planiadvance_v2.infrastructure.pdf.weasyprint_renderer import WeasyprintRenderer


_GOLDEN = (
    Path(__file__).parent.parent.parent.parent
    / "fixtures"
    / "golden"
    / "wo_traveler.html"
)


def _payload() -> WoTravelerPayload:
    return WoTravelerPayload(
        organization_name="Plant QC",
        workspace_name="Plant A",
        schedule_id="sched-1",
        schedule_published_at=datetime(2026, 5, 7, 9, 14),
        generated_at=datetime(2026, 5, 7, 14, 32),
        work_order_ref="WO-IND-ALPHA",
        work_order_name="Cabinet 12U",
        product_id="PROD-CAB12",
        quantity=5,
        priority="HIGH",
        status="RELEASED",
        due_date=datetime(2026, 5, 10, 17, 0),
        release_date=datetime(2026, 5, 4, 8, 0),
        planned_start=datetime(2026, 5, 5, 8, 0),
        planned_end=datetime(2026, 5, 6, 11, 0),
        operations=(
            WoTravelerOperationLine(
                operation_id="OP-1",
                sequence=1,
                name="Cutting",
                eligible_machine_ids=("CNC-FAST", "CNC-FLEX"),
                planned_machine_id="CNC-FAST",
                planned_start=datetime(2026, 5, 5, 8, 0),
                planned_end=datetime(2026, 5, 5, 9, 30),
                setup_minutes=10,
                run_minutes=80,
                materials=(
                    WoTravelerMaterialLine(
                        material_id="RAW-AL",
                        required_quantity=2.50,
                        coverage_status="covered",
                    ),
                    WoTravelerMaterialLine(
                        material_id="STEEL",
                        required_quantity=1.00,
                        coverage_status="short",
                    ),
                ),
            ),
            WoTravelerOperationLine(
                operation_id="OP-2",
                sequence=2,
                name="Drilling",
                eligible_machine_ids=("CNC-FLEX",),
                planned_machine_id="CNC-FLEX",
                planned_start=datetime(2026, 5, 6, 10, 0),
                planned_end=datetime(2026, 5, 6, 11, 0),
                setup_minutes=5,
                run_minutes=55,
                materials=(
                    WoTravelerMaterialLine(
                        material_id="PAINT-RED",
                        required_quantity=0.50,
                        coverage_status="unknown",
                    ),
                ),
            ),
            WoTravelerOperationLine(
                operation_id="OP-3",
                sequence=3,
                name="QA",
                eligible_machine_ids=("QA-1",),
                planned_machine_id=None,
                planned_start=None,
                planned_end=None,
                setup_minutes=0,
                run_minutes=15,
                materials=(),
            ),
        ),
        total_setup_minutes=15,
        total_run_minutes=150,
        total_operation_count=3,
    )


@pytest.fixture
def renderer():
    return WeasyprintRenderer()


def test_wo_traveler_html_matches_golden(renderer):
    actual = renderer.render_html("wo_traveler.html", _payload())

    if not _GOLDEN.exists():
        _GOLDEN.parent.mkdir(parents=True, exist_ok=True)
        _GOLDEN.write_text(actual, encoding="utf-8")
        pytest.fail(
            f"Golden file generated at {_GOLDEN}. Re-run the test; it will pass."
        )

    expected = _GOLDEN.read_text(encoding="utf-8")
    assert actual == expected, (
        "WO Traveler template diverged from the golden snapshot. If the "
        f"change is intentional, replace {_GOLDEN} with the actual output "
        f"(printed below) and re-run.\n\n--- ACTUAL ---\n{actual}"
    )
```

- [ ] **Step 3: Run the test once to generate the golden**

```bash
python -m pytest tests/unit/infrastructure/pdf/test_wo_traveler_template.py -v
```

Expected: FAIL with `Golden file generated at ...`. The file
`tests/fixtures/golden/wo_traveler.html` is now created.

- [ ] **Step 4: Run the test again — should pass**

```bash
python -m pytest tests/unit/infrastructure/pdf/test_wo_traveler_template.py -v
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add planiadvance_v2/infrastructure/pdf/templates/wo_traveler.html tests/unit/infrastructure/pdf/test_wo_traveler_template.py tests/fixtures/golden/wo_traveler.html
git commit -m "Add wo-traveler template + snapshot test (J2c)

Extends base.html. Adds local CSS for op-block layout (page-break-
inside avoid) and coverage status colours. Snapshot covers planned
ops, an unplanned op, and the three coverage statuses (covered /
short / unknown)."
```

---

## Task 4: /reports/wo-traveler route + dependency wiring + HTTP tests

**Files:**
- Modify: `planiadvance_v2/api/routes/reports.py`
- Modify: `planiadvance_v2/api/dependencies.py`
- Modify: `tests/unit/api/test_reports_http.py`

- [ ] **Step 1: Append the failing HTTP tests**

Edit `tests/unit/api/test_reports_http.py` and add at the bottom of the file. First
extend the imports near the top:

Replace:
```python
from planiadvance_v2.api.dependencies import (
    get_build_late_order_report,
    get_build_production_sheet,
    get_list_accessible_workspaces,
    get_pdf_renderer,
)
```
with:
```python
from planiadvance_v2.api.dependencies import (
    get_build_late_order_report,
    get_build_production_sheet,
    get_build_wo_traveler,
    get_list_accessible_workspaces,
    get_pdf_renderer,
)
```

Then add to the import block at the top of the test file:
```python
from planiadvance_v2.application.use_cases.reports.wo_traveler_payload import (
    WoTravelerOperationLine,
    WoTravelerPayload,
)
```

Append the new fixture wiring + tests at the bottom of the file:

```python
# --- J2c: WO Traveler ----------------------------------------------------


def _wo_traveler_payload() -> WoTravelerPayload:
    return WoTravelerPayload(
        organization_name="Plant QC",
        workspace_name=None,
        schedule_id="sched-1",
        schedule_published_at=datetime(2026, 5, 7, 9, 14),
        generated_at=datetime(2026, 5, 7, 14, 32),
        work_order_ref="WO-1",
        work_order_name="Cabinet",
        product_id="PROD-1",
        quantity=5,
        priority="HIGH",
        status="RELEASED",
        due_date=datetime(2026, 5, 10, 17, 0),
        release_date=datetime(2026, 5, 4, 8, 0),
        planned_start=datetime(2026, 5, 5, 8, 0),
        planned_end=datetime(2026, 5, 6, 11, 0),
        operations=(
            WoTravelerOperationLine(
                operation_id="OP-1",
                sequence=1,
                name="Cutting",
                eligible_machine_ids=("M-A",),
                planned_machine_id="M-A",
                planned_start=datetime(2026, 5, 5, 8, 0),
                planned_end=datetime(2026, 5, 5, 9, 0),
                setup_minutes=10,
                run_minutes=60,
                materials=(),
            ),
        ),
        total_setup_minutes=10,
        total_run_minutes=60,
        total_operation_count=1,
    )


class _FakeWoTravelerUseCase:
    def __init__(self, payload: WoTravelerPayload) -> None:
        self._payload = payload

    def execute(self, **_kwargs) -> WoTravelerPayload:
        return self._payload


def test_wo_traveler_returns_pdf_bytes(api):
    api.app.dependency_overrides[get_build_wo_traveler] = (
        lambda: _FakeWoTravelerUseCase(_wo_traveler_payload())
    )

    response = api.get(
        "/reports/wo-traveler?work_order_id=WO-1", headers=_TENANT_HEADERS
    )

    assert response.status_code == 200, response.text
    assert response.headers["content-type"] == "application/pdf"
    assert response.content.startswith(b"%PDF-")
    assert "attachment" in response.headers["content-disposition"]
    assert "wo-traveler-WO-1.pdf" in response.headers["content-disposition"]


def test_wo_traveler_anonymous_is_unauthorized(api):
    api.app.dependency_overrides[get_build_wo_traveler] = (
        lambda: _FakeWoTravelerUseCase(_wo_traveler_payload())
    )

    response = api.get("/reports/wo-traveler?work_order_id=WO-1")
    assert response.status_code == 401


def test_wo_traveler_integrator_is_forbidden(api):
    api.app.dependency_overrides[get_build_wo_traveler] = (
        lambda: _FakeWoTravelerUseCase(_wo_traveler_payload())
    )

    response = api.get(
        "/reports/wo-traveler?work_order_id=WO-1",
        headers={"X-Organization-Id": "org-1", "X-User-Id": "integrator-1"},
    )
    assert response.status_code == 403


def test_wo_traveler_unknown_work_order_returns_404(api):
    from planiadvance_v2.application.use_cases.reports.build_wo_traveler import (
        WorkOrderNotFoundForReport,
    )

    class _RaisingUseCase:
        def execute(self, **_kwargs):
            raise WorkOrderNotFoundForReport("Work order WO-X not found.")

    api.app.dependency_overrides[get_build_wo_traveler] = lambda: _RaisingUseCase()

    response = api.get(
        "/reports/wo-traveler?work_order_id=WO-X",
        headers=_TENANT_HEADERS,
    )
    assert response.status_code == 404
    body = response.json()
    assert body["detail"]["error"] == "work_order_not_found"


def test_wo_traveler_html_preview_disabled_by_default(api):
    api.app.dependency_overrides[get_build_wo_traveler] = (
        lambda: _FakeWoTravelerUseCase(_wo_traveler_payload())
    )

    response = api.get(
        "/reports/preview/wo-traveler?work_order_id=WO-1",
        headers=_TENANT_HEADERS,
    )
    assert response.status_code == 404
```

- [ ] **Step 2: Run the tests, watch them fail (RED)**

```bash
python -m pytest tests/unit/api/test_reports_http.py -v
```

Expected: `ImportError: cannot import name 'get_build_wo_traveler' from
'planiadvance_v2.api.dependencies'`.

- [ ] **Step 3: Add the dependency factory**

Edit `planiadvance_v2/api/dependencies.py`. Find the existing reports import line:

```python
from ..application.use_cases.reports import BuildLateOrderReport, BuildProductionSheet
```

Replace with:

```python
from ..application.use_cases.reports import (
    BuildLateOrderReport,
    BuildProductionSheet,
    BuildWoTraveler,
)
```

Append after `get_build_late_order_report`:

```python
def get_build_wo_traveler(
    session: Session = Depends(get_db_session),
) -> BuildWoTraveler:
    return BuildWoTraveler(
        work_orders=SqlWorkOrderRepository(session),
        organizations=SqlOrganizationRepository(session),
        workspaces=SqlWorkspaceRepository(session),
        schedules=SqlScheduleRepository(session),
    )
```

- [ ] **Step 4: Add the routes**

Edit `planiadvance_v2/api/routes/reports.py`.

Replace the reports import block:
```python
from ...application.use_cases.reports import (
    BuildLateOrderReport,
    BuildProductionSheet,
    MachineNotFoundForReport,
    NoPublishedScheduleForReport,
    RequestedDateOutsideHorizon,
)
```
with:
```python
from ...application.use_cases.reports import (
    BuildLateOrderReport,
    BuildProductionSheet,
    BuildWoTraveler,
    MachineNotFoundForReport,
    NoPublishedScheduleForReport,
    RequestedDateOutsideHorizon,
    WorkOrderNotFoundForReport,
)
```

Replace the dependencies import:
```python
from ..dependencies import (
    get_build_late_order_report,
    get_build_production_sheet,
    get_pdf_renderer,
    get_tenant_scope_from_context,
)
```
with:
```python
from ..dependencies import (
    get_build_late_order_report,
    get_build_production_sheet,
    get_build_wo_traveler,
    get_pdf_renderer,
    get_tenant_scope_from_context,
)
```

Append at the bottom of the file:

```python
def _build_wo_traveler_payload(
    work_order_id: str,
    tenant: TenantContext,
    use_case: BuildWoTraveler,
):
    scope = _scope_from_tenant(tenant)
    try:
        return use_case.execute(work_order_id=work_order_id, scope=scope)
    except WorkOrderNotFoundForReport as exc:
        raise HTTPException(
            status_code=404,
            detail={"error": "work_order_not_found", "message": str(exc)},
        ) from exc
    except NoPublishedScheduleForReport as exc:
        raise HTTPException(
            status_code=404,
            detail={"error": "no_published_schedule", "message": str(exc)},
        ) from exc


@router.get("/wo-traveler")
def wo_traveler_pdf(
    work_order_id: str,
    tenant: TenantContext = Depends(get_tenant_context),
    use_case: BuildWoTraveler = Depends(get_build_wo_traveler),
    renderer: PdfRenderer = Depends(get_pdf_renderer),
) -> Response:
    ensure_authenticated_permission(tenant, "view_reports")

    payload = _build_wo_traveler_payload(work_order_id, tenant, use_case)
    try:
        pdf_bytes = renderer.render("wo_traveler.html", payload)
    except PdfRenderError as exc:
        raise HTTPException(
            status_code=503,
            detail={"error": "pdf_render_failed", "message": str(exc)},
        ) from exc

    filename = f"wo-traveler-{work_order_id}.pdf"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/preview/wo-traveler")
def wo_traveler_preview(
    work_order_id: str,
    tenant: TenantContext = Depends(get_tenant_context),
    use_case: BuildWoTraveler = Depends(get_build_wo_traveler),
    renderer: PdfRenderer = Depends(get_pdf_renderer),
) -> Response:
    if not get_settings().reports_html_preview_enabled:
        raise HTTPException(
            status_code=404,
            detail={"error": "not_found", "message": "Report preview is disabled."},
        )
    ensure_authenticated_permission(tenant, "view_reports")

    payload = _build_wo_traveler_payload(work_order_id, tenant, use_case)
    try:
        html = renderer.render_html("wo_traveler.html", payload)
    except PdfRenderError as exc:
        raise HTTPException(
            status_code=503,
            detail={"error": "pdf_render_failed", "message": str(exc)},
        ) from exc

    return Response(content=html, media_type="text/html")
```

- [ ] **Step 5: Run the tests, verify GREEN**

```bash
python -m pytest tests/unit/api/test_reports_http.py -v
```

Expected: 8 (J2a+J2b) + 5 (J2c) = 13 PASSED.

- [ ] **Step 6: Run the full unit suite**

```bash
python -m pytest tests/unit -q
```

Expected: all green, count up by 5 (~765).

- [ ] **Step 7: Commit**

```bash
git add planiadvance_v2/api/routes/reports.py planiadvance_v2/api/dependencies.py tests/unit/api/test_reports_http.py
git commit -m "Add /reports/wo-traveler route + wiring (J2c)

PDF + dev-only HTML preview gated by reports_html_preview_enabled.
work_order_id is a required query param; cross-tenant or unknown
WOs surface as 404 work_order_not_found. Filename:
wo-traveler-<work_order_id>.pdf."
```

---

## Task 5: Real-stack integration test

**Files:**
- Modify: `tests/integration/test_real_stack_postgres.py`

- [ ] **Step 1: Append the late-order pattern**

Find the J2b late-order block in
`test_industrial_seed_supports_ui_critical_api_contract`. Add immediately after it:

```python
            # J2c: WO Traveler — pick a seeded WO from the published schedule.
            sample_wo_id = work_order_data[0]["id"]
            wo_traveler = client.get(
                "/reports/wo-traveler",
                params={"work_order_id": sample_wo_id},
                headers=headers,
            )
```

- [ ] **Step 2: Append the assertions**

Find the J2b assertion block (`assert late_orders.status_code == 200, ...`) and add
after it:

```python
            assert wo_traveler.status_code == 200, wo_traveler.text
            assert wo_traveler.headers["content-type"] == "application/pdf"
            assert wo_traveler.content[:4] == b"%PDF"
            assert len(wo_traveler.content) > 1024, (
                f"WO traveler PDF too small: {len(wo_traveler.content)} bytes"
            )
            assert "attachment" in wo_traveler.headers["content-disposition"]
            assert f"wo-traveler-{sample_wo_id}" in wo_traveler.headers["content-disposition"]
```

And in the `else:` branch (for the no-WeasyPrint Windows path), add:

```python
            assert wo_traveler.status_code == 503, wo_traveler.text
            assert wo_traveler.json()["error"] == "pdf_render_failed"
```

- [ ] **Step 3: Verify the test still collects without errors**

```bash
python -m pytest tests/integration/test_real_stack_postgres.py --collect-only -q
```

Expected: 3 tests collected (no errors).

- [ ] **Step 4: Commit**

```bash
git add tests/integration/test_real_stack_postgres.py
git commit -m "Add real-stack assertion: /reports/wo-traveler renders PDF (J2c)

Hits the new endpoint inside the existing industrial scenario test
with the first seeded WO id, asserts 200 + application/pdf when
WeasyPrint is installed, or 503 pdf_render_failed otherwise."
```

---

## Task 6: Extend industrial_stack_smoke.py

**Files:**
- Modify: `planiadvance_v2/infrastructure/industrial_stack_smoke.py`

- [ ] **Step 1: Add `wo_traveler_bytes` to `SmokeResult`**

Add the new field next to `late_order_bytes`:

```python
@dataclass(frozen=True, slots=True)
class SmokeResult:
    schedule_id: str
    candidate_schedule_id: str
    operation_id: str
    assignment_count: int
    readiness_status: str
    gantt_entry_count: int
    feasible_slot_count: int
    comparison_count: int
    publish_status: str
    production_sheet_bytes: int
    production_sheet_machine_id: str
    production_sheet_date: str
    late_order_bytes: int
    wo_traveler_bytes: int
    wo_traveler_work_order_id: str
```

- [ ] **Step 2: Add the WO traveler step**

After the late-order request block (where `late_order_bytes_value` is set if the
plan you have uses that name; otherwise after the `_require(len(late_order_pdf) >
1024, ...)` line), add:

```python
    # J2c: WO Traveler — pick a seeded WO id (use the first one from the
    # /work-orders response captured earlier, e.g. WO-IND-ALPHA).
    sample_wo_id = sorted(work_order_ids)[0]
    wo_traveler_pdf, wo_traveler_content_type = _binary_request(
        base_url,
        "GET",
        f"/reports/wo-traveler?work_order_id={sample_wo_id}",
        headers=headers,
    )
    _require(
        wo_traveler_content_type.startswith("application/pdf"),
        f"WO traveler content-type is not PDF: {wo_traveler_content_type!r}",
    )
    _require(
        wo_traveler_pdf.startswith(b"%PDF"),
        f"WO traveler body does not start with %PDF: {wo_traveler_pdf[:16]!r}",
    )
    _require(
        len(wo_traveler_pdf) > 1024,
        f"WO traveler PDF too small ({len(wo_traveler_pdf)} bytes)",
    )
```

Update the `SmokeResult(...)` call to pass:

```python
        late_order_bytes=len(late_order_pdf),
        wo_traveler_bytes=len(wo_traveler_pdf),
        wo_traveler_work_order_id=sample_wo_id,
    )
```

- [ ] **Step 3: Update the JSON output dict**

In `main()`, add the two new fields next to `late_order_bytes`:

```python
                "late_order_bytes": result.late_order_bytes,
                "wo_traveler_bytes": result.wo_traveler_bytes,
                "wo_traveler_work_order_id": result.wo_traveler_work_order_id,
```

- [ ] **Step 4: Verify the smoke module imports cleanly**

```bash
python -c "from planiadvance_v2.infrastructure.industrial_stack_smoke import SmokeResult, run_industrial_stack_smoke; print('imports ok')"
```

Expected: `imports ok`.

- [ ] **Step 5: Commit**

```bash
git add planiadvance_v2/infrastructure/industrial_stack_smoke.py
git commit -m "Smoke: assert /reports/wo-traveler returns valid PDF (J2c)

Adds wo_traveler_bytes + wo_traveler_work_order_id to SmokeResult.
Picks the alphabetically-first seeded WO id and asserts 200 + %PDF
+ non-trivial bytes against the published industrial schedule."
```

---

## Task 7: Update docs/reports-howto.md

**Files:**
- Modify: `docs/reports-howto.md`

- [ ] **Step 1: Update Reports shipped + Reports planned sections**

Read `docs/reports-howto.md` and replace the two sections.

Replace:
```markdown
## Reports shipped

- **Production Sheet** — `/reports/production-sheet?machine_id=&date=` —
  J2a, 2026-05-06. PDF per machine per day. Table of operations sorted by
  start time with setup/run minutes. Footer totals. Schedule traceability.
- **Late-order report** — `/reports/late-orders` — J2b, 2026-05-07. PDF
  listing every late WO in the latest published schedule with an
  engine-classified reason (`material` / `capacity` / `priority` /
  `sequence`) and a canonical recommended action. Sorted by lateness desc;
  unplanned overdue WOs sort last with `planned_end=—`. Empty state
  ("No late orders ✓") is a valid render.

## Reports planned

- **WO Traveler** — J2c. One page per work order with operations sequence,
  machines, dates, and material requirements (printable for shop floor).
- **Executive Dashboard** — J2d. In-app (not PDF). KPI trends 7/30/90 days.
```

with:

```markdown
## Reports shipped

- **Production Sheet** — `/reports/production-sheet?machine_id=&date=` —
  J2a, 2026-05-06. PDF per machine per day. Table of operations sorted by
  start time with setup/run minutes. Footer totals. Schedule traceability.
- **Late-order report** — `/reports/late-orders` — J2b, 2026-05-07. PDF
  listing every late WO in the latest published schedule with an
  engine-classified reason (`material` / `capacity` / `priority` /
  `sequence`) and a canonical recommended action. Sorted by lateness desc;
  unplanned overdue WOs sort last with `planned_end=—`. Empty state
  ("No late orders ✓") is a valid render.
- **WO Traveler** — `/reports/wo-traveler?work_order_id=` — J2c, 2026-05-07.
  One PDF per work order: header (product/qty/priority/dates), operations
  in sequence with eligible + planned machines, planned start/end, setup/
  run minutes, and per-op materials with coverage status (`covered` /
  `short` / `unknown` from `material_pegging_report`). Unplanned operations
  render with `Planned: —`. Returns 404 on cross-tenant or unknown WO id.

## Reports planned

- **Executive Dashboard** — J2d. In-app (not PDF). KPI trends 7/30/90 days.
```

- [ ] **Step 2: Commit**

```bash
git add docs/reports-howto.md
git commit -m "Update reports-howto: J2c WO Traveler shipped

Adds the WO Traveler entry to 'Reports shipped' and removes it from
'Reports planned'. Only the Executive Dashboard (J2d) remains."
```

---

## Task 8: Final validation pass

This is a verification task — no new code.

- [ ] **Step 1: Run the full unit + integration suite**

```bash
python -m pytest tests/unit tests/integration -q
```

Expected: ~765 unit + 5 integration PASS, 3 real-stack PASS (Postgres up) or
SKIPPED. No reds.

- [ ] **Step 2: Run lint and confirm baseline preserved**

```bash
ruff check planiadvance_v2 tests --output-format=concise
```

Expected: 44 errors (same baseline as start of J2b/J2c). If higher, run
`ruff check <new-files> --fix` to clean the J2c additions.

- [ ] **Step 3: Update docs/J2-RESUME.md**

Read the current file. Mark J2c DONE and update "next sub-project" to J2d.
Bump test counts (~765 unit), update commit hash range, and update the
"Reports backend" line in "Quick state check" (3/3 PDFs done).

- [ ] **Step 4: Commit**

```bash
git add docs/J2-RESUME.md
git commit -m "Update J2-RESUME: J2c shipped, only J2d remains"
```

---

## Self-review checklist (run once before handing off)

- [ ] Spec coverage: every section of `2026-05-07-j2c-wo-traveler-design.md`
  has at least one task.
- [ ] No "TBD" / "TODO" / "implement later" in any step.
- [ ] Type names match across tasks: `WoTravelerPayload`, `WoTravelerOperationLine`,
  `WoTravelerMaterialLine`, `BuildWoTraveler`, `WorkOrderNotFoundForReport`,
  `CoverageStatus`.
- [ ] Tenant scoping used in every read (Task 2 explicit via
  `work_orders.with_scope(scope).get(...)`; Task 5 indirect via the use case).
- [ ] Each task ends with a commit.
- [ ] No frontend work.
- [ ] Permissions: `view_reports` already exists (J2a) — no permission matrix
  change.
- [ ] J2a/J2b infrastructure reused: PdfRenderer, base.html, print.css,
  reports_html_preview_enabled, /reports router prefix.
