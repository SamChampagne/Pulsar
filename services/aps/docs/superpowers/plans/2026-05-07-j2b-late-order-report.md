# J2b — Late-order report — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the second printable report — a Late-order PDF listing every late
work order in the latest published schedule with an engine-classified reason
(`material` / `capacity` / `priority` / `sequence`) and a canonical
`recommended_action`. Validate end-to-end against the industrial seed via real-stack
+ smoke.

**Architecture:** Reuses the J2a infrastructure (`PdfRenderer` port,
`WeasyprintRenderer`, `base.html`, `print.css`, `view_reports` permission,
`reports_html_preview_enabled` flag, `/reports` router, `industrial_stack_smoke.py`).
Adds a pure classifier (`late_order_classifier.py`), a view DTO + a use case
(`build_late_order_report.py`), a Jinja2 template, and two endpoints
(`GET /reports/late-orders`, `GET /reports/preview/late-orders`).

**Tech Stack:** Python 3.11+, FastAPI, SQLAlchemy 2.0, SQLite (test) /
PostgreSQL (real-stack), WeasyPrint ≥ 65, Jinja2, pytest.

**Spec:** `docs/superpowers/specs/2026-05-07-j2b-late-order-report-design.md`

**Tenant safety:** all reads in the use case go through the F-401
`repo.with_scope(scope)` pattern (`docs/tenant-scoping-pattern.md`). The route
requires `view_reports` permission; anonymous calls are 401, INTEGRATOR is 403.

---

## Task 1: LateOrderPayload DTO + types

**Files:**
- Create: `planiadvance_v2/application/use_cases/reports/late_order_payload.py`
- Modify: `planiadvance_v2/application/use_cases/reports/__init__.py` (export)

This task introduces only data structures. No tests — exercised by Task 3+ tests.

- [ ] **Step 1: Create the payload module**

Create `planiadvance_v2/application/use_cases/reports/late_order_payload.py`:

```python
"""View DTOs for the Late-order PDF.

These are NOT domain entities — they exist purely to feed Jinja2
templates. ``LateOrderReason`` and ``RecommendedAction`` are typed
literals so the downstream classifier and template both consume the
same vocabulary.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Literal

LateOrderReason = Literal["material", "capacity", "priority", "sequence"]
RecommendedAction = Literal[
    "expedite_material",
    "add_overtime_or_reroute",
    "review_priority",
    "split_lot_or_reroute",
]

REASON_TO_ACTION: dict[LateOrderReason, RecommendedAction] = {
    "material": "expedite_material",
    "capacity": "add_overtime_or_reroute",
    "priority": "review_priority",
    "sequence": "split_lot_or_reroute",
}


@dataclass(frozen=True, slots=True)
class LateOrderLine:
    work_order_ref: str
    work_order_name: str
    due_date: datetime
    planned_end: datetime | None
    lateness_minutes: int | None
    priority: str
    reason: LateOrderReason
    recommended_action: RecommendedAction


@dataclass(frozen=True, slots=True)
class LateOrderPayload:
    organization_name: str
    workspace_name: str | None
    schedule_id: str
    schedule_published_at: datetime
    generated_at: datetime
    horizon_start: datetime | None
    horizon_end: datetime | None
    lines: tuple[LateOrderLine, ...]
    total_late_count: int
    total_lateness_minutes: int
    by_reason: dict[LateOrderReason, int]
```

- [ ] **Step 2: Re-export from the reports package**

Edit `planiadvance_v2/application/use_cases/reports/__init__.py` — keep the
existing J2a exports and add the new ones. The full file should read:

```python
"""Use cases that build report payloads consumed by the PdfRenderer."""

from .build_production_sheet import (
    BuildProductionSheet,
    MachineNotFoundForReport,
    NoPublishedScheduleForReport,
    ReportError,
    RequestedDateOutsideHorizon,
)
from .late_order_payload import (
    REASON_TO_ACTION,
    LateOrderLine,
    LateOrderPayload,
    LateOrderReason,
    RecommendedAction,
)
from .production_sheet_payload import ProductionSheetLine, ProductionSheetPayload

__all__ = [
    "BuildProductionSheet",
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
]
```

- [ ] **Step 3: Run unit suite to verify no breakage**

```bash
python -m pytest tests/unit -q
```

Expected: same green count as before (~733). The DTO is unused so far.

- [ ] **Step 4: Commit**

```bash
git add planiadvance_v2/application/use_cases/reports/late_order_payload.py planiadvance_v2/application/use_cases/reports/__init__.py
git commit -m "Add LateOrderPayload DTOs for J2b

View dataclasses (not domain entities) plus the LateOrderReason and
RecommendedAction Literal types. REASON_TO_ACTION pins the canonical
mapping shared by the classifier and the template."
```

---

## Task 2: LateOrderClassifier (pure function, TDD)

**Files:**
- Create: `planiadvance_v2/application/use_cases/reports/late_order_classifier.py`
- Modify: `planiadvance_v2/application/use_cases/reports/__init__.py` (export)
- Test: `tests/unit/use_cases/reports/test_late_order_classifier.py`

The classifier is a pure function — no I/O, no repositories. It accepts a
`WorkOrder`, the published `Schedule`, the `ScheduleRunMetadata` (for
`diagnostics`), and the list of all WOs in scope (for the priority comparison).
It returns a single `LateOrderReason` literal.

- [ ] **Step 1: Verify domain entity shapes used by the test**

Read these files to confirm field names before writing the test:

- `planiadvance_v2/domain/entities/work_order.py` — confirm `id`, `priority`,
  `operations`, `operation_ids()` method.
- `planiadvance_v2/domain/value_objects/__init__.py` — find `Priority`. Confirm
  the enum members (`LOW`, `NORMAL`, `HIGH`, `CRITICAL`).
- `planiadvance_v2/application/ports/schedule_repository.py` — confirm
  `ScheduleRunMetadata` has a `diagnostics: dict` field.
- `planiadvance_v2/domain/entities/schedule.py` — confirm `Schedule.assignments`
  list and `ScheduledAssignment` shape (`operation_id`, `machine_id`,
  `start`, `end`).

If a field name differs (e.g. `Priority.NORMAL` is actually `Priority.MEDIUM`),
adapt the test accordingly before proceeding.

- [ ] **Step 2: Write the failing tests**

Create `tests/unit/use_cases/reports/test_late_order_classifier.py`:

```python
"""TDD tests for ``classify_late_order_reason``.

The classifier reads engine diagnostics already attached to a published
schedule's metadata. We synthesise minimal schedules + diagnostics that
cover one signal each, then test signal precedence (material > capacity
> priority > sequence).
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from planiadvance_v2.application.ports.schedule_repository import ScheduleRunMetadata
from planiadvance_v2.application.use_cases.reports.late_order_classifier import (
    classify_late_order_reason,
)
from planiadvance_v2.domain.entities import (
    Operation,
    Schedule,
    ScheduledAssignment,
    WorkOrder,
)
from planiadvance_v2.domain.value_objects import Duration, Priority


def _op(op_id: str, wo_id: str, eligible: tuple[str, ...] = ("M-A",)) -> Operation:
    return Operation(
        id=op_id,
        work_order_id=wo_id,
        sequence=1,
        name=op_id,
        duration=Duration(minutes=60),
        setup_time=Duration(minutes=0),
        eligible_machine_ids=list(eligible),
        dependencies=[],
    )


def _wo(
    wo_id: str,
    *,
    priority: Priority = Priority.NORMAL,
    op_ids: tuple[str, ...] = ("OP1",),
) -> WorkOrder:
    return WorkOrder(
        id=wo_id,
        name=f"WO {wo_id}",
        product_id=f"PROD-{wo_id}",
        quantity=1,
        due_date=datetime(2026, 5, 12),
        release_date=datetime(2026, 5, 1),
        operations=[_op(f"{wo_id}-{op}", wo_id) for op in op_ids],
        priority=priority,
    )


def _assignment(op_id: str, machine_id: str = "M-A") -> ScheduledAssignment:
    return ScheduledAssignment(
        operation_id=op_id,
        machine_id=machine_id,
        start=datetime(2026, 5, 11, 8, 0),
        end=datetime(2026, 5, 11, 9, 0),
        setup_start=datetime(2026, 5, 11, 7, 50),
    )


def _metadata(diagnostics: dict[str, Any]) -> ScheduleRunMetadata:
    return ScheduleRunMetadata(
        schedule_id="sched-1",
        strategy="greedy",
        solver_status="feasible",
        objective_value=0,
        wall_time_ms=0,
        organization_id="org-a",
        workspace_id="ws-a",
        scenario_name="Default",
        lifecycle_status="published",
        horizon_start=datetime(2026, 5, 11),
        horizon_end=datetime(2026, 5, 18),
        metrics={},
        diagnostics=diagnostics,
    )


def test_material_via_planner_exceptions():
    wo = _wo("WO-1")
    schedule = Schedule(id="sched-1", assignments=[_assignment("WO-1-OP1")])
    diagnostics = {
        "planner_exceptions": {
            "exceptions": [
                {"work_order_id": "WO-1", "kind": "material_shortage"},
            ],
        },
    }

    reason = classify_late_order_reason(
        wo=wo,
        schedule=schedule,
        metadata=_metadata(diagnostics),
        all_work_orders=[wo],
    )

    assert reason == "material"


def test_material_via_pegging_blocked_operations():
    wo = _wo("WO-1")
    schedule = Schedule(id="sched-1", assignments=[_assignment("WO-1-OP1")])
    diagnostics = {
        "material_pegging_report": {
            "status": "short",
            "blocked_operations": [
                {"operation_id": "WO-1-OP1", "material_id": "MAT-X"},
            ],
        },
    }

    reason = classify_late_order_reason(
        wo=wo,
        schedule=schedule,
        metadata=_metadata(diagnostics),
        all_work_orders=[wo],
    )

    assert reason == "material"


def test_capacity_via_horizon_too_short():
    wo = _wo("WO-1")
    schedule = Schedule(id="sched-1", assignments=[_assignment("WO-1-OP1")])
    diagnostics = {
        "planner_exceptions": {
            "exceptions": [
                {"work_order_id": "WO-1", "kind": "horizon_too_short"},
            ],
        },
    }

    reason = classify_late_order_reason(
        wo=wo,
        schedule=schedule,
        metadata=_metadata(diagnostics),
        all_work_orders=[wo],
    )

    assert reason == "capacity"


def test_capacity_via_machine_overload():
    wo = _wo("WO-1")
    schedule = Schedule(id="sched-1", assignments=[_assignment("WO-1-OP1")])
    diagnostics = {
        "planner_exceptions": {
            "exceptions": [
                {"work_order_id": "WO-1", "kind": "machine_overload"},
            ],
        },
    }

    reason = classify_late_order_reason(
        wo=wo,
        schedule=schedule,
        metadata=_metadata(diagnostics),
        all_work_orders=[wo],
    )

    assert reason == "capacity"


def test_priority_when_higher_priority_neighbour_shares_machine():
    late = _wo("WO-LATE", priority=Priority.NORMAL)
    other = _wo("WO-VIP", priority=Priority.CRITICAL)
    schedule = Schedule(
        id="sched-1",
        assignments=[
            _assignment("WO-LATE-OP1", machine_id="M-A"),
            _assignment("WO-VIP-OP1", machine_id="M-A"),
        ],
    )
    # No material/capacity signal, so priority rule fires.
    diagnostics: dict[str, Any] = {}

    reason = classify_late_order_reason(
        wo=late,
        schedule=schedule,
        metadata=_metadata(diagnostics),
        all_work_orders=[late, other],
    )

    assert reason == "priority"


def test_sequence_default_when_no_signal():
    wo = _wo("WO-1")
    schedule = Schedule(id="sched-1", assignments=[_assignment("WO-1-OP1")])
    diagnostics: dict[str, Any] = {}

    reason = classify_late_order_reason(
        wo=wo,
        schedule=schedule,
        metadata=_metadata(diagnostics),
        all_work_orders=[wo],
    )

    assert reason == "sequence"


def test_signal_precedence_material_beats_capacity():
    wo = _wo("WO-1")
    schedule = Schedule(id="sched-1", assignments=[_assignment("WO-1-OP1")])
    diagnostics = {
        "planner_exceptions": {
            "exceptions": [
                {"work_order_id": "WO-1", "kind": "material_shortage"},
                {"work_order_id": "WO-1", "kind": "horizon_too_short"},
            ],
        },
    }

    reason = classify_late_order_reason(
        wo=wo,
        schedule=schedule,
        metadata=_metadata(diagnostics),
        all_work_orders=[wo],
    )

    assert reason == "material"


def test_unrelated_work_order_id_in_diagnostics_is_ignored():
    wo = _wo("WO-1")
    schedule = Schedule(id="sched-1", assignments=[_assignment("WO-1-OP1")])
    diagnostics = {
        "planner_exceptions": {
            "exceptions": [
                {"work_order_id": "WO-OTHER", "kind": "material_shortage"},
            ],
        },
    }

    reason = classify_late_order_reason(
        wo=wo,
        schedule=schedule,
        metadata=_metadata(diagnostics),
        all_work_orders=[wo],
    )

    assert reason == "sequence"
```

- [ ] **Step 3: Run the tests, watch them fail (RED)**

```bash
python -m pytest tests/unit/use_cases/reports/test_late_order_classifier.py -v
```

Expected: `ModuleNotFoundError: No module named
'planiadvance_v2.application.use_cases.reports.late_order_classifier'`.

- [ ] **Step 4: Implement the classifier**

Create `planiadvance_v2/application/use_cases/reports/late_order_classifier.py`:

```python
"""Engine-driven classification of why a work order is late.

Pure function. Reads the diagnostics already attached to a published
schedule's run metadata and applies first-match-wins precedence:

    material > capacity > priority > sequence

No I/O, no repositories. The caller passes everything explicitly.
"""

from __future__ import annotations

from typing import Any

from ....domain.entities import Schedule, WorkOrder
from ...ports.schedule_repository import ScheduleRunMetadata
from .late_order_payload import LateOrderReason

_CAPACITY_KINDS = frozenset(
    {"horizon_too_short", "machine_overload", "no_eligible_machine"}
)


def classify_late_order_reason(
    *,
    wo: WorkOrder,
    schedule: Schedule,
    metadata: ScheduleRunMetadata,
    all_work_orders: list[WorkOrder],
) -> LateOrderReason:
    diagnostics = metadata.diagnostics or {}

    if _has_material_signal(wo, diagnostics):
        return "material"
    if _has_capacity_signal(wo, diagnostics):
        return "capacity"
    if _crowded_out_by_higher_priority(wo, schedule, all_work_orders):
        return "priority"
    return "sequence"


def _has_material_signal(wo: WorkOrder, diagnostics: dict[str, Any]) -> bool:
    if _exception_for(wo, diagnostics).get("material_shortage"):
        return True
    pegging = diagnostics.get("material_pegging_report")
    if isinstance(pegging, dict):
        wo_op_ids = wo.operation_ids()
        for entry in pegging.get("blocked_operations") or []:
            if isinstance(entry, dict) and entry.get("operation_id") in wo_op_ids:
                return True
    return False


def _has_capacity_signal(wo: WorkOrder, diagnostics: dict[str, Any]) -> bool:
    kinds = _exception_for(wo, diagnostics)
    return any(kinds.get(k) for k in _CAPACITY_KINDS)


def _crowded_out_by_higher_priority(
    wo: WorkOrder,
    schedule: Schedule,
    all_work_orders: list[WorkOrder],
) -> bool:
    wo_op_ids = wo.operation_ids()
    wo_machines = {
        a.machine_id for a in schedule.assignments if a.operation_id in wo_op_ids
    }
    if not wo_machines:
        return False
    for other in all_work_orders:
        if other.id == wo.id:
            continue
        if other.priority.value <= wo.priority.value:
            continue
        other_op_ids = other.operation_ids()
        other_machines = {
            a.machine_id
            for a in schedule.assignments
            if a.operation_id in other_op_ids
        }
        if wo_machines & other_machines:
            return True
    return False


def _exception_for(wo: WorkOrder, diagnostics: dict[str, Any]) -> dict[str, bool]:
    """Index exception kinds for the given WO id (True if at least one match)."""
    container = diagnostics.get("planner_exceptions")
    if not isinstance(container, dict):
        return {}
    kinds: dict[str, bool] = {}
    for item in container.get("exceptions") or []:
        if not isinstance(item, dict):
            continue
        if item.get("work_order_id") != wo.id:
            continue
        kind = item.get("kind")
        if isinstance(kind, str):
            kinds[kind] = True
    return kinds
```

- [ ] **Step 5: Run the tests, verify GREEN**

```bash
python -m pytest tests/unit/use_cases/reports/test_late_order_classifier.py -v
```

Expected: 8 PASSED.

- [ ] **Step 6: Re-export the classifier**

Edit `planiadvance_v2/application/use_cases/reports/__init__.py` — add the
import and append `classify_late_order_reason` to `__all__` in alphabetical
order. Final file:

```python
"""Use cases that build report payloads consumed by the PdfRenderer."""

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

__all__ = [
    "BuildProductionSheet",
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
    "classify_late_order_reason",
]
```

- [ ] **Step 7: Commit**

```bash
git add planiadvance_v2/application/use_cases/reports/late_order_classifier.py planiadvance_v2/application/use_cases/reports/__init__.py tests/unit/use_cases/reports/test_late_order_classifier.py
git commit -m "Add LateOrderClassifier for J2b (TDD, 8 cases)

Pure function reading engine diagnostics with first-match-wins
precedence: material > capacity > priority > sequence. Material
checks both planner_exceptions and material_pegging_report.
Capacity covers horizon_too_short, machine_overload, and
no_eligible_machine. Priority requires both a higher-priority
neighbour and a shared machine."
```

---

## Task 3: BuildLateOrderReport use case (TDD)

**Files:**
- Create: `planiadvance_v2/application/use_cases/reports/build_late_order_report.py`
- Modify: `planiadvance_v2/application/use_cases/reports/__init__.py` (export)
- Test: `tests/unit/use_cases/reports/test_build_late_order_report.py`

- [ ] **Step 1: Verify in-memory repository / scope shapes**

Read `planiadvance_v2/infrastructure/in_memory/repositories.py` around
`InMemoryScheduleRepository` and `InMemoryWorkOrderRepository` to confirm:

- `InMemoryScheduleRepository.save(schedule, *, metrics, organization_id,
  workspace_id, lifecycle_status, horizon_start, horizon_end, diagnostics=None)`
  — confirm the keyword for diagnostics. If it does not exist, follow what J2a
  does and pass `diagnostics={}` via the constructor or wrapper. (Adapt the
  test file accordingly.)
- `InMemoryWorkOrderRepository` constructor accepts a list of WOs and supports
  `with_scope(scope).list()`.

- [ ] **Step 2: Write the failing tests**

Create `tests/unit/use_cases/reports/test_build_late_order_report.py`:

```python
"""TDD tests for BuildLateOrderReport.

Uses in-memory repositories. The schedule contains 3 late WOs with
different reasons and one on-time WO to verify filtering. A WO from
another organization confirms F-401 scoping.
"""

from __future__ import annotations

from datetime import datetime, timedelta

import pytest

from planiadvance_v2.application.use_cases.reports import (
    NoPublishedScheduleForReport,
)
from planiadvance_v2.application.use_cases.reports.build_late_order_report import (
    BuildLateOrderReport,
)
from planiadvance_v2.domain.entities import (
    Operation,
    Organization,
    Schedule,
    ScheduledAssignment,
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


def _op(op_id: str, wo_id: str) -> Operation:
    return Operation(
        id=op_id,
        work_order_id=wo_id,
        sequence=1,
        name=op_id,
        duration=Duration(minutes=60),
        setup_time=Duration(minutes=0),
        eligible_machine_ids=["M-A"],
        dependencies=[],
    )


def _wo(
    wo_id: str,
    *,
    due: datetime,
    organization_id: str = _ORG_A,
    workspace_id: str | None = _WS_A,
    priority: Priority = Priority.NORMAL,
) -> WorkOrder:
    return WorkOrder(
        id=wo_id,
        name=f"WO {wo_id}",
        product_id=f"PROD-{wo_id}",
        quantity=1,
        due_date=due,
        release_date=datetime(2026, 5, 1),
        operations=[_op(f"{wo_id}-OP1", wo_id)],
        priority=priority,
        organization_id=organization_id,
        workspace_id=workspace_id,
    )


def _assignment(op_id: str, *, end: datetime, start: datetime | None = None) -> ScheduledAssignment:
    return ScheduledAssignment(
        operation_id=op_id,
        machine_id="M-A",
        start=start or end - timedelta(hours=1),
        end=end,
        setup_start=(start or end - timedelta(hours=1)) - timedelta(minutes=10),
    )


@pytest.fixture
def fixture():
    work_orders_repo = InMemoryWorkOrderRepository(
        [
            # Late: planned end after due
            _wo("WO-LATE-1", due=datetime(2026, 5, 11, 17, 0)),  # plan ends 5/12 09:00
            _wo("WO-LATE-2", due=datetime(2026, 5, 11, 12, 0)),  # plan ends 5/14 09:00
            # On time
            _wo("WO-OK", due=datetime(2026, 5, 20, 17, 0)),
            # Cross-tenant
            _wo("WO-OTHER", due=datetime(2026, 5, 11, 17, 0), organization_id=_ORG_B, workspace_id=None),
        ]
    )
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
        assignments=[
            _assignment("WO-LATE-1-OP1", end=datetime(2026, 5, 12, 9, 0)),
            _assignment("WO-LATE-2-OP1", end=datetime(2026, 5, 14, 9, 0)),
            _assignment("WO-OK-OP1", end=datetime(2026, 5, 19, 17, 0)),
        ],
    )
    schedules = InMemoryScheduleRepository()
    schedules.save(
        schedule,
        metrics={},
        organization_id=_ORG_A,
        workspace_id=_WS_A,
        lifecycle_status="published",
        horizon_start=datetime(2026, 5, 11, 0, 0),
        horizon_end=datetime(2026, 5, 18, 0, 0),
        diagnostics={
            "planner_exceptions": {
                "exceptions": [
                    {"work_order_id": "WO-LATE-1", "kind": "material_shortage"},
                ],
            },
        },
    )

    return BuildLateOrderReport(
        work_orders=work_orders_repo,
        organizations=organizations,
        workspaces=workspaces,
        schedules=schedules,
    )


class TestBuildLateOrderReportHappyPath:
    def test_lists_late_wos_sorted_by_lateness_desc(self, fixture):
        scope = TenantScope.for_workspace(organization_id=_ORG_A, workspace_id=_WS_A)

        payload = fixture.execute(scope=scope)

        assert payload.organization_name == "Plant QC"
        assert payload.workspace_name == "Plant A"
        assert payload.schedule_id == "sched-1"
        assert len(payload.lines) == 2
        # WO-LATE-2 is later (5/14) than WO-LATE-1 (5/12), so it should come first.
        assert payload.lines[0].work_order_ref == "WO-LATE-2"
        assert payload.lines[1].work_order_ref == "WO-LATE-1"
        # WO-OK (on time) and WO-OTHER (cross-tenant) excluded.
        refs = {line.work_order_ref for line in payload.lines}
        assert "WO-OK" not in refs
        assert "WO-OTHER" not in refs

    def test_classification_and_action_propagated(self, fixture):
        scope = TenantScope.for_workspace(organization_id=_ORG_A, workspace_id=_WS_A)

        payload = fixture.execute(scope=scope)

        late_1 = next(line for line in payload.lines if line.work_order_ref == "WO-LATE-1")
        # Diagnostics flagged WO-LATE-1 as material_shortage.
        assert late_1.reason == "material"
        assert late_1.recommended_action == "expedite_material"

        late_2 = next(line for line in payload.lines if line.work_order_ref == "WO-LATE-2")
        # No signal for WO-LATE-2 -> sequence (default).
        assert late_2.reason == "sequence"
        assert late_2.recommended_action == "split_lot_or_reroute"

    def test_aggregates_totals_and_by_reason(self, fixture):
        scope = TenantScope.for_workspace(organization_id=_ORG_A, workspace_id=_WS_A)

        payload = fixture.execute(scope=scope)

        assert payload.total_late_count == 2
        assert payload.total_lateness_minutes > 0
        assert payload.by_reason["material"] == 1
        assert payload.by_reason["sequence"] == 1
        assert payload.by_reason["capacity"] == 0
        assert payload.by_reason["priority"] == 0


class TestBuildLateOrderReportEmpty:
    def test_no_late_wos_returns_empty_payload(self):
        # All WOs on time.
        wos = InMemoryWorkOrderRepository(
            [_wo("WO-OK", due=datetime(2026, 5, 20, 17, 0))]
        )
        organizations = InMemoryOrganizationRepository(
            [Organization(id=_ORG_A, name="Plant QC", slug="plant-qc")]
        )
        workspaces = InMemoryWorkspaceRepository([])
        schedule = Schedule(
            id="sched-1",
            assignments=[_assignment("WO-OK-OP1", end=datetime(2026, 5, 19, 17, 0))],
        )
        schedules = InMemoryScheduleRepository()
        schedules.save(
            schedule,
            metrics={},
            organization_id=_ORG_A,
            workspace_id=None,
            lifecycle_status="published",
            horizon_start=datetime(2026, 5, 11, 0, 0),
            horizon_end=datetime(2026, 5, 22, 0, 0),
        )

        builder = BuildLateOrderReport(
            work_orders=wos,
            organizations=organizations,
            workspaces=workspaces,
            schedules=schedules,
        )
        payload = builder.execute(scope=TenantScope.for_organization(_ORG_A))

        assert payload.lines == ()
        assert payload.total_late_count == 0
        assert payload.total_lateness_minutes == 0
        assert payload.by_reason == {
            "material": 0,
            "capacity": 0,
            "priority": 0,
            "sequence": 0,
        }


class TestBuildLateOrderReportErrors:
    def test_no_published_schedule_raises(self):
        wos = InMemoryWorkOrderRepository([])
        organizations = InMemoryOrganizationRepository(
            [Organization(id=_ORG_A, name="Plant QC", slug="plant-qc")]
        )
        workspaces = InMemoryWorkspaceRepository([])
        schedules = InMemoryScheduleRepository()  # empty

        builder = BuildLateOrderReport(
            work_orders=wos,
            organizations=organizations,
            workspaces=workspaces,
            schedules=schedules,
        )

        with pytest.raises(NoPublishedScheduleForReport):
            builder.execute(scope=TenantScope.for_organization(_ORG_A))


class TestBuildLateOrderReportUnplanned:
    def test_unplanned_overdue_wo_included_with_none_lateness(self):
        # WO past due but never assigned: include with planned_end=None.
        wos = InMemoryWorkOrderRepository(
            [_wo("WO-NEVER", due=datetime(2026, 5, 5, 17, 0))]
        )
        organizations = InMemoryOrganizationRepository(
            [Organization(id=_ORG_A, name="Plant QC", slug="plant-qc")]
        )
        workspaces = InMemoryWorkspaceRepository([])

        schedule = Schedule(id="sched-1", assignments=[])
        schedules = InMemoryScheduleRepository()
        schedules.save(
            schedule,
            metrics={},
            organization_id=_ORG_A,
            workspace_id=None,
            lifecycle_status="published",
            horizon_start=datetime(2026, 5, 1, 0, 0),
            horizon_end=datetime(2026, 5, 30, 0, 0),
        )

        builder = BuildLateOrderReport(
            work_orders=wos,
            organizations=organizations,
            workspaces=workspaces,
            schedules=schedules,
        )
        payload = builder.execute(scope=TenantScope.for_organization(_ORG_A))

        assert payload.total_late_count == 1
        assert len(payload.lines) == 1
        line = payload.lines[0]
        assert line.work_order_ref == "WO-NEVER"
        assert line.planned_end is None
        assert line.lateness_minutes is None
        assert line.reason == "sequence"
```

- [ ] **Step 3: Run the tests, watch them fail (RED)**

```bash
python -m pytest tests/unit/use_cases/reports/test_build_late_order_report.py -v
```

Expected: `ModuleNotFoundError: No module named
'planiadvance_v2.application.use_cases.reports.build_late_order_report'`.

- [ ] **Step 4: Implement the use case**

Create `planiadvance_v2/application/use_cases/reports/build_late_order_report.py`:

```python
"""Use case: build the Late-order report for the active tenant.

Loads the latest published Schedule for the tenant scope, finds every
WorkOrder whose planned completion in that schedule overruns its
``due_date`` (or that is unplanned and already past due), classifies the
reason via ``classify_late_order_reason``, maps the reason to its
canonical recommended action, and returns a sorted ``LateOrderPayload``.

All reads honour the F-401 ScopedRepository pattern.
"""

from __future__ import annotations

from datetime import datetime
from typing import Iterable

from ....domain.entities import Schedule, ScheduledAssignment, WorkOrder
from ....infrastructure.scoping import TenantScope
from ...ports.account_repository import OrganizationRepository
from ...ports.schedule_repository import ScheduleRepository, ScheduleRunMetadata
from ...ports.work_order_repository import WorkOrderRepository
from ...ports.workspace_repository import WorkspaceRepository
from .build_production_sheet import NoPublishedScheduleForReport
from .late_order_classifier import classify_late_order_reason
from .late_order_payload import (
    REASON_TO_ACTION,
    LateOrderLine,
    LateOrderPayload,
    LateOrderReason,
)


_REASON_KEYS: tuple[LateOrderReason, ...] = (
    "material",
    "capacity",
    "priority",
    "sequence",
)


class BuildLateOrderReport:
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

    def execute(self, *, scope: TenantScope) -> LateOrderPayload:
        organization_id = scope.require_organization()
        generated_at = datetime.now()

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

        work_orders = list(self._work_orders.with_scope(scope).list())

        lines = list(
            self._build_lines(
                work_orders=work_orders,
                schedule=schedule,
                metadata=metadata,
                generated_at=generated_at,
            )
        )
        lines.sort(
            key=lambda line: (
                line.lateness_minutes is None,
                -(line.lateness_minutes or 0),
            )
        )

        total_lateness = sum(
            line.lateness_minutes for line in lines if line.lateness_minutes is not None
        )
        by_reason: dict[LateOrderReason, int] = {key: 0 for key in _REASON_KEYS}
        for line in lines:
            by_reason[line.reason] += 1

        org = self._organizations.get(organization_id)
        workspace = (
            self._workspaces.get(scope.workspace_id) if scope.workspace_id else None
        )

        return LateOrderPayload(
            organization_name=org.name if org else organization_id,
            workspace_name=workspace.name if workspace else None,
            schedule_id=schedule.id,
            schedule_published_at=schedule.created_at,
            generated_at=generated_at,
            horizon_start=metadata.horizon_start,
            horizon_end=metadata.horizon_end,
            lines=tuple(lines),
            total_late_count=len(lines),
            total_lateness_minutes=total_lateness,
            by_reason=by_reason,
        )

    def _build_lines(
        self,
        *,
        work_orders: list[WorkOrder],
        schedule: Schedule,
        metadata: ScheduleRunMetadata,
        generated_at: datetime,
    ) -> Iterable[LateOrderLine]:
        assignments_by_op = {a.operation_id: a for a in schedule.assignments}
        for wo in work_orders:
            planned_end = _planned_end(wo, assignments_by_op.values())
            if not _is_late(wo=wo, planned_end=planned_end, now=generated_at):
                continue
            reason = classify_late_order_reason(
                wo=wo,
                schedule=schedule,
                metadata=metadata,
                all_work_orders=work_orders,
            )
            lateness_minutes = (
                int((planned_end - wo.due_date).total_seconds() // 60)
                if planned_end is not None
                else None
            )
            yield LateOrderLine(
                work_order_ref=wo.id,
                work_order_name=wo.name,
                due_date=wo.due_date,
                planned_end=planned_end,
                lateness_minutes=lateness_minutes,
                priority=wo.priority.name,
                reason=reason,
                recommended_action=REASON_TO_ACTION[reason],
            )


def _planned_end(
    wo: WorkOrder,
    assignments: Iterable[ScheduledAssignment],
) -> datetime | None:
    op_ids = wo.operation_ids()
    ends = [a.end for a in assignments if a.operation_id in op_ids]
    return max(ends) if ends else None


def _is_late(
    *,
    wo: WorkOrder,
    planned_end: datetime | None,
    now: datetime,
) -> bool:
    if planned_end is None:
        return wo.due_date < now
    return planned_end > wo.due_date
```

- [ ] **Step 5: Re-export from the package**

Edit `planiadvance_v2/application/use_cases/reports/__init__.py` — add the
import and append `BuildLateOrderReport` to `__all__` in alphabetical order.
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
from .late_order_classifier import classify_late_order_reason
from .late_order_payload import (
    REASON_TO_ACTION,
    LateOrderLine,
    LateOrderPayload,
    LateOrderReason,
    RecommendedAction,
)
from .production_sheet_payload import ProductionSheetLine, ProductionSheetPayload

__all__ = [
    "BuildLateOrderReport",
    "BuildProductionSheet",
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
    "classify_late_order_reason",
]
```

- [ ] **Step 6: Run the tests, verify GREEN**

```bash
python -m pytest tests/unit/use_cases/reports/test_build_late_order_report.py -v
```

Expected: 5 PASSED.

- [ ] **Step 7: Run the full unit suite to confirm no regression**

```bash
python -m pytest tests/unit -q
```

Expected: 733 + 8 (classifier) + 5 (use case) ≈ 746 PASS.

- [ ] **Step 8: Commit**

```bash
git add planiadvance_v2/application/use_cases/reports/build_late_order_report.py planiadvance_v2/application/use_cases/reports/__init__.py tests/unit/use_cases/reports/test_build_late_order_report.py
git commit -m "Add BuildLateOrderReport use case (J2b, TDD, 5 cases)

Loads the latest published schedule for the tenant scope, finds late
WOs by comparing planned_end (max assignment.end) to due_date, classifies
each via the LateOrderClassifier, and emits a sorted LateOrderPayload
with totals and by_reason aggregates. Unplanned overdue WOs are
included with planned_end=None and sorted last."
```

---

## Task 4: late_order_report.html template + snapshot test

**Files:**
- Create: `planiadvance_v2/infrastructure/pdf/templates/late_order_report.html`
- Create: `tests/unit/infrastructure/pdf/test_late_order_report_template.py`
- Create: `tests/fixtures/golden/late_order_report.html` (generated on first test run)

The template extends `base.html` and reuses `print.css` classes. The snapshot
test renders the template against a fixed payload and compares to a golden
HTML file. Intentional template changes regenerate the golden.

- [ ] **Step 1: Write the template**

Create `planiadvance_v2/infrastructure/pdf/templates/late_order_report.html`:

```html
{% extends "base.html" %}
{% block title %}Late-order Report — {{ ctx.organization_name }}{% endblock %}
{% block body %}
<header class="header-row">
  <h1 data-header-string="{{ ctx.organization_name }} · Late-order Report · {{ ctx.generated_at.strftime('%Y-%m-%d') }}">
    Late-order Report
  </h1>
  <div class="meta">
    <div>{{ ctx.organization_name }}{% if ctx.workspace_name %} · {{ ctx.workspace_name }}{% endif %}</div>
    <div>Generated: <strong>{{ ctx.generated_at.strftime('%Y-%m-%d %H:%M') }}</strong></div>
    <div>Late WOs: <strong>{{ ctx.total_late_count }}</strong></div>
  </div>
</header>

<table class="lines">
  <thead>
    <tr>
      <th style="width: 12%">WO</th>
      <th>Name</th>
      <th class="time" style="width: 14%">Due</th>
      <th class="time" style="width: 14%">Planned end</th>
      <th class="numeric" style="width: 10%">Late (min)</th>
      <th style="width: 10%">Priority</th>
      <th style="width: 12%">Reason</th>
    </tr>
  </thead>
  <tbody>
    {% for line in ctx.lines %}
    <tr>
      <td>{{ line.work_order_ref }}</td>
      <td>{{ line.work_order_name }}</td>
      <td class="time">{{ line.due_date.strftime('%Y-%m-%d %H:%M') }}</td>
      <td class="time">{% if line.planned_end %}{{ line.planned_end.strftime('%Y-%m-%d %H:%M') }}{% else %}—{% endif %}</td>
      <td class="numeric">{% if line.lateness_minutes is not none %}{{ line.lateness_minutes }}{% else %}—{% endif %}</td>
      <td>{{ line.priority }}</td>
      <td>{{ line.reason }}</td>
    </tr>
    {% else %}
    <tr><td colspan="7" style="text-align:center; color:#888; padding:6mm">No late orders ✓</td></tr>
    {% endfor %}
  </tbody>
</table>

<footer class="footer-totals">
  <div>
    <strong>By reason:</strong>
    material {{ ctx.by_reason.material }} ·
    capacity {{ ctx.by_reason.capacity }} ·
    priority {{ ctx.by_reason.priority }} ·
    sequence {{ ctx.by_reason.sequence }}
    &nbsp;·&nbsp;
    <strong>Total lateness:</strong> {{ ctx.total_lateness_minutes }} min
  </div>
  <div class="schedule-info">
    Schedule {{ ctx.schedule_id }} · published {{ ctx.schedule_published_at.strftime('%Y-%m-%d %H:%M') }}
  </div>
</footer>

<aside style="margin-top:6mm; font-size:9pt; color:#444">
  <strong>Recommended actions by reason:</strong>
  material → expedite_material ·
  capacity → add_overtime_or_reroute ·
  priority → review_priority ·
  sequence → split_lot_or_reroute
</aside>
{% endblock %}
```

- [ ] **Step 2: Write the snapshot test**

Create `tests/unit/infrastructure/pdf/test_late_order_report_template.py`:

```python
"""Snapshot test for late_order_report.html.

Renders the template against a fixed LateOrderPayload covering all four
reasons and compares to the golden HTML. Regenerate the golden by
deleting the file and re-running the test (it will write a fresh
golden and fail once with a clear message).
"""

from __future__ import annotations

from datetime import datetime
from pathlib import Path

import pytest

from planiadvance_v2.application.use_cases.reports.late_order_payload import (
    LateOrderLine,
    LateOrderPayload,
)
from planiadvance_v2.infrastructure.pdf.weasyprint_renderer import WeasyprintRenderer


_GOLDEN = (
    Path(__file__).parent.parent.parent.parent
    / "fixtures"
    / "golden"
    / "late_order_report.html"
)


def _payload() -> LateOrderPayload:
    return LateOrderPayload(
        organization_name="Plant QC",
        workspace_name="Plant A",
        schedule_id="sched-1",
        schedule_published_at=datetime(2026, 5, 7, 9, 14),
        generated_at=datetime(2026, 5, 7, 14, 32),
        horizon_start=datetime(2026, 5, 7),
        horizon_end=datetime(2026, 5, 21),
        lines=(
            LateOrderLine(
                work_order_ref="WO-1",
                work_order_name="Cabinet 12U",
                due_date=datetime(2026, 5, 4, 17, 0),
                planned_end=datetime(2026, 5, 6, 9, 0),
                lateness_minutes=2400,
                priority="HIGH",
                reason="material",
                recommended_action="expedite_material",
            ),
            LateOrderLine(
                work_order_ref="WO-2",
                work_order_name="Steel frame",
                due_date=datetime(2026, 5, 5, 17, 0),
                planned_end=datetime(2026, 5, 8, 12, 0),
                lateness_minutes=4140,
                priority="NORMAL",
                reason="capacity",
                recommended_action="add_overtime_or_reroute",
            ),
            LateOrderLine(
                work_order_ref="WO-3",
                work_order_name="Brackets",
                due_date=datetime(2026, 5, 6, 17, 0),
                planned_end=datetime(2026, 5, 7, 11, 0),
                lateness_minutes=1080,
                priority="LOW",
                reason="priority",
                recommended_action="review_priority",
            ),
            LateOrderLine(
                work_order_ref="WO-4",
                work_order_name="Casings",
                due_date=datetime(2026, 5, 1, 17, 0),
                planned_end=None,
                lateness_minutes=None,
                priority="NORMAL",
                reason="sequence",
                recommended_action="split_lot_or_reroute",
            ),
        ),
        total_late_count=4,
        total_lateness_minutes=7620,
        by_reason={"material": 1, "capacity": 1, "priority": 1, "sequence": 1},
    )


@pytest.fixture
def renderer():
    return WeasyprintRenderer()


def test_late_order_report_html_matches_golden(renderer):
    actual = renderer.render_html("late_order_report.html", _payload())

    if not _GOLDEN.exists():
        _GOLDEN.parent.mkdir(parents=True, exist_ok=True)
        _GOLDEN.write_text(actual, encoding="utf-8")
        pytest.fail(
            f"Golden file generated at {_GOLDEN}. Re-run the test; it will pass."
        )

    expected = _GOLDEN.read_text(encoding="utf-8")
    assert actual == expected, (
        "Late-order template diverged from the golden snapshot. If the "
        f"change is intentional, replace {_GOLDEN} with the actual output "
        f"(printed below) and re-run.\n\n--- ACTUAL ---\n{actual}"
    )
```

- [ ] **Step 3: Run the test once to generate the golden**

```bash
python -m pytest tests/unit/infrastructure/pdf/test_late_order_report_template.py -v
```

Expected: FAIL with `Golden file generated at ...`. The file
`tests/fixtures/golden/late_order_report.html` is now created.

- [ ] **Step 4: Run the test again — should pass**

```bash
python -m pytest tests/unit/infrastructure/pdf/test_late_order_report_template.py -v
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add planiadvance_v2/infrastructure/pdf/templates/late_order_report.html tests/unit/infrastructure/pdf/test_late_order_report_template.py tests/fixtures/golden/late_order_report.html
git commit -m "Add late-order template + snapshot test (J2b)

Extends base.html, reuses print.css classes, adds a footer aside that
maps each reason to its canonical recommended action. Snapshot test
covers all four reasons + an unplanned WO."
```

---

## Task 5: /reports/late-orders route + dependency wiring + HTTP tests

**Files:**
- Modify: `planiadvance_v2/api/routes/reports.py`
- Modify: `planiadvance_v2/api/dependencies.py`
- Modify: `tests/unit/api/test_reports_http.py`

- [ ] **Step 1: Read the existing test fixture**

Read `tests/unit/api/test_reports_http.py` to confirm the `_FakeUseCase`,
`_FakeRenderer`, and `api` fixture pattern. We will add overrides for the
new use case + reuse the same `_FakeRenderer`.

- [ ] **Step 2: Append the failing HTTP tests**

Add to `tests/unit/api/test_reports_http.py` (at the bottom of the file —
imports go at the top, then test functions append below the J2a tests):

```python
# --- J2b: Late-order report ----------------------------------------------

from datetime import datetime as _dt  # local alias to avoid clashing imports

from planiadvance_v2.api.dependencies import get_build_late_order_report
from planiadvance_v2.application.use_cases.reports import (
    BuildLateOrderReport,
)
from planiadvance_v2.application.use_cases.reports.late_order_payload import (
    LateOrderLine,
    LateOrderPayload,
)


def _late_order_payload() -> LateOrderPayload:
    return LateOrderPayload(
        organization_name="Plant QC",
        workspace_name=None,
        schedule_id="sched-1",
        schedule_published_at=_dt(2026, 5, 7, 9, 14),
        generated_at=_dt(2026, 5, 7, 14, 32),
        horizon_start=_dt(2026, 5, 7),
        horizon_end=_dt(2026, 5, 21),
        lines=(
            LateOrderLine(
                work_order_ref="WO-1",
                work_order_name="Cabinet",
                due_date=_dt(2026, 5, 4, 17, 0),
                planned_end=_dt(2026, 5, 6, 9, 0),
                lateness_minutes=2400,
                priority="HIGH",
                reason="material",
                recommended_action="expedite_material",
            ),
        ),
        total_late_count=1,
        total_lateness_minutes=2400,
        by_reason={"material": 1, "capacity": 0, "priority": 0, "sequence": 0},
    )


class _FakeLateOrderUseCase:
    def __init__(self, payload: LateOrderPayload) -> None:
        self._payload = payload

    def execute(self, **_kwargs) -> LateOrderPayload:
        return self._payload


@pytest.fixture
def api_with_late_order(api):
    """Reuses the J2a `api` fixture and overrides the late-order use case."""
    from planiadvance_v2.api.main import create_app  # local re-import not needed
    # The `api` fixture has already overridden tenant repos and pdf renderer.
    # We just need to add the late-order use-case override on the same TestClient.
    api.app.dependency_overrides[get_build_late_order_report] = (
        lambda: _FakeLateOrderUseCase(_late_order_payload())
    )
    return api


def test_late_order_returns_pdf_bytes(api_with_late_order):
    response = api_with_late_order.get(
        "/reports/late-orders",
        headers=_TENANT_HEADERS,
    )

    assert response.status_code == 200, response.text
    assert response.headers["content-type"] == "application/pdf"
    assert response.content.startswith(b"%PDF-")
    assert "attachment" in response.headers["content-disposition"]
    assert "late-orders" in response.headers["content-disposition"]


def test_late_order_anonymous_is_unauthorized(api_with_late_order):
    response = api_with_late_order.get("/reports/late-orders")
    assert response.status_code == 401


def test_late_order_integrator_is_forbidden(api_with_late_order):
    response = api_with_late_order.get(
        "/reports/late-orders",
        headers={"X-Organization-Id": "org-1", "X-User-Id": "integrator-1"},
    )
    assert response.status_code == 403


def test_late_order_html_preview_disabled_by_default(api_with_late_order):
    response = api_with_late_order.get(
        "/reports/preview/late-orders",
        headers=_TENANT_HEADERS,
    )
    assert response.status_code == 404
```

NOTE: the `api` fixture as defined in J2a yields a `TestClient`. To access
`app.dependency_overrides` from within the new fixture, the J2a fixture must
expose `client.app` — verify in step 1. If `TestClient(app)` does not expose
`.app`, store `app` separately and yield a `(client, app)` tuple, or refactor
the J2a fixture to also expose `app`. Adapt the new fixture accordingly.

- [ ] **Step 3: Run the tests, watch them fail (RED)**

```bash
python -m pytest tests/unit/api/test_reports_http.py -v
```

Expected: `ImportError: cannot import name 'get_build_late_order_report' from
'planiadvance_v2.api.dependencies'`.

- [ ] **Step 4: Add the dependency factory**

Edit `planiadvance_v2/api/dependencies.py`. Find the J2a `get_build_production_sheet`
factory and add `get_build_late_order_report` immediately below it. The new
factory mirrors J2a's wiring minus the machine repo:

```python
def get_build_late_order_report(
    session: Session = Depends(get_db_session),
) -> BuildLateOrderReport:
    return BuildLateOrderReport(
        work_orders=SqlWorkOrderRepository(session),
        organizations=SqlOrganizationRepository(session),
        workspaces=SqlWorkspaceRepository(session),
        schedules=SqlScheduleRepository(session),
    )
```

Update the imports near the top of the file: change the existing
`from ..application.use_cases.reports import BuildProductionSheet` to:

```python
from ..application.use_cases.reports import BuildLateOrderReport, BuildProductionSheet
```

(Mirror the alphabetical order convention of the file.)

- [ ] **Step 5: Add the routes**

Edit `planiadvance_v2/api/routes/reports.py`.

Update the imports — replace:
```python
from ...application.use_cases.reports import (
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
    MachineNotFoundForReport,
    NoPublishedScheduleForReport,
    RequestedDateOutsideHorizon,
)
```

Update the `dependencies` import — replace:
```python
from ..dependencies import (
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
    get_pdf_renderer,
    get_tenant_scope_from_context,
)
```

Append at the bottom of the file:

```python
def _build_late_order_payload(
    tenant: TenantContext,
    use_case: BuildLateOrderReport,
):
    scope = _scope_from_tenant(tenant)
    try:
        return use_case.execute(scope=scope)
    except NoPublishedScheduleForReport as exc:
        raise HTTPException(
            status_code=404,
            detail={"error": "no_published_schedule", "message": str(exc)},
        ) from exc


@router.get("/late-orders")
def late_order_pdf(
    tenant: TenantContext = Depends(get_tenant_context),
    use_case: BuildLateOrderReport = Depends(get_build_late_order_report),
    renderer: PdfRenderer = Depends(get_pdf_renderer),
) -> Response:
    ensure_authenticated_permission(tenant, "view_reports")

    payload = _build_late_order_payload(tenant, use_case)
    try:
        pdf_bytes = renderer.render("late_order_report.html", payload)
    except PdfRenderError as exc:
        raise HTTPException(
            status_code=503,
            detail={"error": "pdf_render_failed", "message": str(exc)},
        ) from exc

    filename = f"late-orders-{payload.schedule_id}-{payload.generated_at.strftime('%Y%m%d')}.pdf"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/preview/late-orders")
def late_order_preview(
    tenant: TenantContext = Depends(get_tenant_context),
    use_case: BuildLateOrderReport = Depends(get_build_late_order_report),
    renderer: PdfRenderer = Depends(get_pdf_renderer),
) -> Response:
    if not get_settings().reports_html_preview_enabled:
        raise HTTPException(
            status_code=404,
            detail={"error": "not_found", "message": "Report preview is disabled."},
        )
    ensure_authenticated_permission(tenant, "view_reports")

    payload = _build_late_order_payload(tenant, use_case)
    try:
        html = renderer.render_html("late_order_report.html", payload)
    except PdfRenderError as exc:
        raise HTTPException(
            status_code=503,
            detail={"error": "pdf_render_failed", "message": str(exc)},
        ) from exc

    return Response(content=html, media_type="text/html")
```

- [ ] **Step 6: Run the tests, verify GREEN**

```bash
python -m pytest tests/unit/api/test_reports_http.py -v
```

Expected: 4 (J2a) + 4 (J2b) = 8 PASSED.

- [ ] **Step 7: Run the full unit suite**

```bash
python -m pytest tests/unit -q
```

Expected: all green, count up by 4 (~750).

- [ ] **Step 8: Commit**

```bash
git add planiadvance_v2/api/routes/reports.py planiadvance_v2/api/dependencies.py tests/unit/api/test_reports_http.py
git commit -m "Add /reports/late-orders route + wiring (J2b)

PDF + dev-only HTML preview. Permission gated by view_reports;
INTEGRATOR is excluded. Dependency factory builds the use case with
SqlScheduleRepository + SqlWorkOrderRepository (no machine repo
needed for this report)."
```

---

## Task 6: Real-stack integration test

**Files:**
- Modify: `tests/integration/test_real_stack_postgres.py`

- [ ] **Step 1: Locate the existing real-stack test fixture name**

Read the top of `tests/integration/test_real_stack_postgres.py` and the J2a
production-sheet integration test. Note the fixture name used to obtain a
TestClient against the running stack (`real_stack_client` per J2a plan, but
verify).

- [ ] **Step 2: Append the late-order test**

Inside `class TestRealStackPostgres` (or alongside the J2a test, mirroring
its style), add:

```python
def test_late_order_pdf_renders_against_industrial_seed(self, real_stack_client):
    response = real_stack_client.get("/reports/late-orders")

    # The industrial seed may have zero late WOs; the endpoint must still
    # return a valid PDF (empty-state path).
    assert response.status_code == 200, response.text
    assert response.headers["content-type"] == "application/pdf"
    assert response.content[:4] == b"%PDF"
    assert len(response.content) > 1024
```

- [ ] **Step 3: Bring up the stack**

```bash
make stack-up
```

Wait for the API to respond.

- [ ] **Step 4: Run the new test**

```bash
PLANIADVANCE_STACK_TEST_DATABASE_URL="postgresql+psycopg://plani:plani@localhost:5432/planiadvance_v2" \
  python -m pytest tests/integration/test_real_stack_postgres.py::TestRealStackPostgres::test_late_order_pdf_renders_against_industrial_seed -v
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/integration/test_real_stack_postgres.py
git commit -m "Add real-stack test: /reports/late-orders renders PDF (J2b)

Asserts 200 + application/pdf + non-trivial bytes. The industrial
seed may have zero late WOs; the empty-state path is the path
exercised here."
```

---

## Task 7: Extend industrial_stack_smoke.py

**Files:**
- Modify: `planiadvance_v2/infrastructure/industrial_stack_smoke.py`

- [ ] **Step 1: Read the J2a smoke step**

Read `planiadvance_v2/infrastructure/industrial_stack_smoke.py` end-to-end.
Locate where `production_sheet_bytes` is set on `SmokeResult` and where the
production-sheet HTTP request is performed (a `_binary_request` helper).
Mirror that pattern.

- [ ] **Step 2: Add `late_order_bytes` to `SmokeResult`**

Update the `SmokeResult` dataclass — add the new field next to
`production_sheet_bytes`:

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
```

- [ ] **Step 3: Add the late-order step**

In the smoke flow, after the production-sheet step (where
`production_sheet_bytes` is captured), add:

```python
# J2b: Late-order report — empty industrial seed is acceptable;
# the empty-state path still produces a valid PDF.
late_order_bytes_value, late_order_content_type = _binary_request(
    base_url,
    "GET",
    "/reports/late-orders",
    headers=tenant_headers,
)
if not late_order_content_type.startswith("application/pdf"):
    raise SmokeFailure(
        f"/reports/late-orders content-type was {late_order_content_type!r}, "
        "expected application/pdf."
    )
if not late_order_bytes_value.startswith(b"%PDF"):
    raise SmokeFailure(
        "/reports/late-orders body did not start with %PDF: "
        f"{late_order_bytes_value[:16]!r}."
    )
late_order_bytes = len(late_order_bytes_value)
```

(Substitute `tenant_headers` with whatever variable name the smoke uses for
the auth headers — see how `production_sheet_bytes` is obtained.)

Update the `SmokeResult(...)` constructor call at the end of the smoke to
include `late_order_bytes=late_order_bytes`.

- [ ] **Step 4: Run the smoke against the running stack**

```bash
docker compose -f docker/docker-compose.yml exec -T api python -m planiadvance_v2.infrastructure.industrial_stack_smoke
```

Expected: JSON output includes `"status": "ok"` AND `"late_order_bytes": NNNN`
where NNNN > 1000.

- [ ] **Step 5: Commit**

```bash
git add planiadvance_v2/infrastructure/industrial_stack_smoke.py
git commit -m "Smoke: assert /reports/late-orders returns valid PDF (J2b)

Adds late_order_bytes to SmokeResult and calls the new endpoint.
Empty-seed path is acceptable — the report renders the 'No late
orders ✓' empty state into a valid PDF."
```

---

## Task 8: Update docs/reports-howto.md

**Files:**
- Modify: `docs/reports-howto.md`

- [ ] **Step 1: Update Reports shipped + Reports planned sections**

Read the current `docs/reports-howto.md`. Replace these two sections:

```markdown
## Reports shipped

- **Production Sheet** — `/reports/production-sheet?machine_id=&date=` —
  J2a, 2026-05-06. PDF per machine per day. Table of operations sorted by
  start time with setup/run minutes. Footer totals. Schedule traceability.

## Reports planned

- **Late-order report** — J2b. List of WOs late vs due date with
  engine-classified reason and recommended action.
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

## Reports planned

- **WO Traveler** — J2c. One page per work order with operations sequence,
  machines, dates, and material requirements (printable for shop floor).
- **Executive Dashboard** — J2d. In-app (not PDF). KPI trends 7/30/90 days.
```

- [ ] **Step 2: Commit**

```bash
git add docs/reports-howto.md
git commit -m "Update reports-howto: J2b Late-order shipped

Adds the late-order entry to 'Reports shipped' and removes it from
'Reports planned'. WO Traveler (J2c) and Executive Dashboard (J2d)
remain pending."
```

---

## Task 9: Final validation pass

This is a verification task — no new code.

- [ ] **Step 1: Run the full unit + integration suite**

```bash
python -m pytest tests/unit tests/integration -q
```

Expected: ~750 unit + 5 integration PASS, 3 real-stack PASS (Postgres still
up from Task 6) or 3 SKIPPED (Postgres down). No reds.

- [ ] **Step 2: Run lint and confirm no new errors vs baseline**

```bash
ruff check planiadvance_v2 tests --output-format=concise
```

Expected: same baseline count as start of J2b (44). If higher, run
`ruff check --fix` on the new files only and re-run.

- [ ] **Step 3: Run the smoke against the running stack**

```bash
docker compose -f docker/docker-compose.yml exec -T api python -m planiadvance_v2.infrastructure.industrial_stack_smoke
```

Expected: `"status": "ok"` and `late_order_bytes` > 1000.

- [ ] **Step 4: Manually save a Late-order PDF for sanity check**

```bash
curl -o /tmp/late-orders.pdf \
     -H "X-Organization-Id: org-demo" \
     -H "X-User-Id: user-1" \
     "http://localhost:8000/reports/late-orders"
```

(Substitute the actual seeded org / user. Reuse the values shown in the
production-sheet curl example in the J2a docs.)

Open the PDF in a viewer. Sanity-check:
- header reads "Late-order Report" with org + workspace
- table either shows late WOs OR the empty state ("No late orders ✓")
- footer "By reason" line displays `material/capacity/priority/sequence`
  counts
- footer aside lists the four recommended actions
- page numbering at bottom-right

- [ ] **Step 5: Update docs/J2-RESUME.md**

Mark J2b as DONE and update "next sub-project" to J2c. Read the current file
first (it currently shows J2a DONE and J2b NEXT). Update the `### ✅ J2a`
header pattern to apply to J2b, and change J2c to "(NEXT)".

- [ ] **Step 6: Bring stack down**

```bash
make stack-down
```

- [ ] **Step 7: Commit**

```bash
git add docs/J2-RESUME.md
git commit -m "Update J2-RESUME: J2b shipped, next is J2c WO Traveler"
```

---

## Self-review checklist (run once before handing off)

- [ ] Spec coverage: every section of
  `2026-05-07-j2b-late-order-report-design.md` has at least one task.
- [ ] No "TBD" / "TODO" / "implement later" / "fill in" in any step.
- [ ] Type names match across tasks: `LateOrderPayload`, `LateOrderLine`,
  `LateOrderReason`, `RecommendedAction`, `BuildLateOrderReport`,
  `classify_late_order_reason`, `REASON_TO_ACTION`.
- [ ] Tenant scoping used in every read (Task 3 explicit via
  `work_orders.with_scope(scope).list()`; Task 6 indirect via the use case).
- [ ] Each task ends with a commit. Frequent commits = bisectable history.
- [ ] No frontend work — explicitly out of scope per spec.
- [ ] Permissions: `view_reports` already exists (J2a) — no permission
  matrix change in this plan.
- [ ] J2a infrastructure reused: `PdfRenderer`, `WeasyprintRenderer`,
  `base.html`, `print.css`, `reports_html_preview_enabled`, `/reports`
  router prefix — none of these are re-created.
