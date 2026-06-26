# J2d — Executive Dashboard + `/reports` page — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the J2 Reports module. Backend: aggregate KPIs over 7/30/90-day
windows from published schedules and expose `GET /reports/dashboard`. Frontend:
new `/reports` page rendering an executive dashboard (4 KPIs + sparklines + top
late orders) plus 3 PDF download cards (Production Sheet, Late-order, WO
Traveler).

**Architecture:** Reuses J2a-c infrastructure (PdfRenderer, view_reports,
/reports router, tenant scoping, Schedule/WorkOrder repositories). Adds one
backend use case + one route + a frontend page composed from existing design
primitives + recharts.

**Tech Stack:** Python 3.11+, FastAPI, SQLAlchemy 2.0, pytest. Frontend:
TypeScript, React 19, Vite 7, recharts ^2.x (new dep), existing design system.

**Spec:** `docs/superpowers/specs/2026-05-07-j2d-executive-dashboard-design.md`

**Tenant safety:** all backend reads go through F-401
`repo.with_scope(scope)` or `list_recent(organization_id=…, workspace_id=…)`.
Permission gate: `view_reports` (existing). Anonymous → 401, INTEGRATOR → 403.

---

## Phase 1: Backend — dashboard endpoint (Tasks 1-4)

## Task 1: ExecutiveDashboardOutput DTOs

**Files:**
- Create: `planiadvance_v2/application/use_cases/reports/executive_dashboard_payload.py`
- Modify: `planiadvance_v2/application/use_cases/reports/__init__.py` (export)

- [ ] **Step 1: Create the payload module**

Create `planiadvance_v2/application/use_cases/reports/executive_dashboard_payload.py`:

```python
"""View DTOs for the Executive Dashboard JSON endpoint.

These are NOT domain entities — they exist purely to serialize the
dashboard payload. ``as_dict()`` produces the JSON shape the frontend
consumes.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime


@dataclass(frozen=True, slots=True)
class TopLateOrder:
    work_order_ref: str
    work_order_name: str
    due_date: datetime
    planned_end: datetime | None
    lateness_minutes: int | None

    def as_dict(self) -> dict[str, object]:
        return {
            "work_order_ref": self.work_order_ref,
            "work_order_name": self.work_order_name,
            "due_date": self.due_date.isoformat(),
            "planned_end": self.planned_end.isoformat()
            if self.planned_end is not None
            else None,
            "lateness_minutes": self.lateness_minutes,
        }


@dataclass(frozen=True, slots=True)
class ScheduleSample:
    schedule_id: str
    published_at: datetime
    makespan_minutes: int
    on_time_ratio: float
    avg_utilization: float

    def as_dict(self) -> dict[str, object]:
        return {
            "schedule_id": self.schedule_id,
            "published_at": self.published_at.isoformat(),
            "makespan_minutes": self.makespan_minutes,
            "on_time_ratio": round(self.on_time_ratio, 4),
            "avg_utilization": round(self.avg_utilization, 4),
        }


@dataclass(frozen=True, slots=True)
class KpiSnapshot:
    makespan_minutes: int
    on_time_ratio: float
    avg_utilization: float
    makespan_delta_minutes: int | None
    on_time_delta: float | None
    avg_utilization_delta: float | None

    def as_dict(self) -> dict[str, object]:
        return {
            "makespan_minutes": self.makespan_minutes,
            "on_time_ratio": round(self.on_time_ratio, 4),
            "avg_utilization": round(self.avg_utilization, 4),
            "makespan_delta_minutes": self.makespan_delta_minutes,
            "on_time_delta": (
                round(self.on_time_delta, 4)
                if self.on_time_delta is not None
                else None
            ),
            "avg_utilization_delta": (
                round(self.avg_utilization_delta, 4)
                if self.avg_utilization_delta is not None
                else None
            ),
        }


@dataclass(frozen=True, slots=True)
class ExecutiveDashboardOutput:
    range_label: str
    range_start: datetime
    range_end: datetime
    generated_at: datetime
    scenarios_published_count: int
    schedule_samples: tuple[ScheduleSample, ...]
    current_kpis: KpiSnapshot
    top_late_orders: tuple[TopLateOrder, ...]

    def as_dict(self) -> dict[str, object]:
        return {
            "range_label": self.range_label,
            "range_start": self.range_start.isoformat(),
            "range_end": self.range_end.isoformat(),
            "generated_at": self.generated_at.isoformat(),
            "scenarios_published_count": self.scenarios_published_count,
            "schedule_samples": [s.as_dict() for s in self.schedule_samples],
            "current_kpis": self.current_kpis.as_dict(),
            "top_late_orders": [t.as_dict() for t in self.top_late_orders],
        }
```

- [ ] **Step 2: Re-export from the package**

Edit `planiadvance_v2/application/use_cases/reports/__init__.py`. Add the
import and the `__all__` entries — keep alphabetical order. Final file:

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
from .executive_dashboard_payload import (
    ExecutiveDashboardOutput,
    KpiSnapshot,
    ScheduleSample,
    TopLateOrder,
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
    "BuildWoTraveler",
    "CoverageStatus",
    "ExecutiveDashboardOutput",
    "KpiSnapshot",
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
    "ScheduleSample",
    "TopLateOrder",
    "WoTravelerMaterialLine",
    "WoTravelerOperationLine",
    "WoTravelerPayload",
    "WorkOrderNotFoundForReport",
    "classify_late_order_reason",
]
```

- [ ] **Step 3: Run unit suite to verify no breakage**

```bash
python -m pytest tests/unit -q
```

Expected: 767 PASSED (same as end of J2c).

- [ ] **Step 4: Commit**

```bash
git add planiadvance_v2/application/use_cases/reports/executive_dashboard_payload.py planiadvance_v2/application/use_cases/reports/__init__.py
git commit -m "Add ExecutiveDashboardOutput DTOs for J2d

View dataclasses with as_dict() for JSON serialisation. Four records:
TopLateOrder, ScheduleSample, KpiSnapshot, ExecutiveDashboardOutput."
```

---

## Task 2: BuildExecutiveDashboard use case (TDD)

**Files:**
- Create: `planiadvance_v2/application/use_cases/reports/build_executive_dashboard.py`
- Modify: `planiadvance_v2/application/use_cases/reports/__init__.py` (export)
- Test: `tests/unit/use_cases/reports/test_build_executive_dashboard.py`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/use_cases/reports/test_build_executive_dashboard.py`:

```python
"""TDD tests for BuildExecutiveDashboard.

Uses in-memory repositories. Two published schedules in the 30d
window cover the delta path. A third schedule outside the window
verifies the time filter. A WO from another org confirms F-401
scoping for the top-late-orders pass.
"""

from __future__ import annotations

from datetime import datetime, timedelta

import pytest

from planiadvance_v2.application.use_cases.reports import ReportError
from planiadvance_v2.application.use_cases.reports.build_executive_dashboard import (
    BuildExecutiveDashboard,
)
from planiadvance_v2.domain.entities import (
    Operation,
    Organization,
    Schedule,
    ScheduledOperation,
    WorkOrder,
    Workspace,
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


def _scheduled(
    op_id: str,
    wo_id: str,
    *,
    end: datetime,
    machine: str = "M-A",
) -> ScheduledOperation:
    return ScheduledOperation(
        operation_id=op_id,
        work_order_id=wo_id,
        machine_id=machine,
        setup_start=end - timedelta(hours=1, minutes=10),
        start=end - timedelta(hours=1),
        end=end,
    )


def _save_published(
    repo,
    schedule_id: str,
    *,
    created_at: datetime,
    organization_id: str,
    workspace_id: str | None,
    assignments: list[ScheduledOperation],
    horizon_start: datetime,
    horizon_end: datetime,
) -> None:
    schedule = Schedule(
        id=schedule_id,
        created_at=created_at,
        assignments=assignments,
    )
    repo.save(
        schedule,
        metrics={},
        organization_id=organization_id,
        workspace_id=workspace_id,
        lifecycle_status="published",
        horizon_start=horizon_start,
        horizon_end=horizon_end,
    )


@pytest.fixture
def fixture():
    now = datetime(2026, 5, 7, 12, 0)
    work_orders = InMemoryWorkOrderRepository(
        [
            _wo("WO-1", due=datetime(2026, 5, 11, 17, 0)),
            _wo("WO-2", due=datetime(2026, 5, 8, 12, 0)),
            _wo("WO-3", due=datetime(2026, 5, 20, 17, 0)),
            _wo(
                "WO-OTHER",
                due=datetime(2026, 5, 11, 17, 0),
                organization_id=_ORG_B,
                workspace_id=None,
            ),
        ]
    )
    organizations = InMemoryOrganizationRepository(
        [Organization(id=_ORG_A, name="Plant QC", slug="plant-qc")]
    )
    workspaces = InMemoryWorkspaceRepository(
        [Workspace(id=_WS_A, name="Plant A", organization_id=_ORG_A)]
    )

    schedules = InMemoryScheduleRepository()
    # Schedule A: 5 days ago (in window). Both WOs late by some amount.
    _save_published(
        schedules,
        "sched-a",
        created_at=now - timedelta(days=5),
        organization_id=_ORG_A,
        workspace_id=_WS_A,
        assignments=[
            _scheduled("WO-1-OP1", "WO-1", end=datetime(2026, 5, 12, 9, 0)),
            _scheduled("WO-2-OP1", "WO-2", end=datetime(2026, 5, 14, 9, 0)),
            _scheduled("WO-3-OP1", "WO-3", end=datetime(2026, 5, 19, 17, 0)),
        ],
        horizon_start=now - timedelta(days=7),
        horizon_end=now + timedelta(days=10),
    )
    # Schedule B: 2 days ago (in window, more recent). Use a longer makespan.
    _save_published(
        schedules,
        "sched-b",
        created_at=now - timedelta(days=2),
        organization_id=_ORG_A,
        workspace_id=_WS_A,
        assignments=[
            _scheduled("WO-1-OP1", "WO-1", end=datetime(2026, 5, 13, 9, 0)),
            _scheduled("WO-2-OP1", "WO-2", end=datetime(2026, 5, 13, 9, 0)),
            _scheduled("WO-3-OP1", "WO-3", end=datetime(2026, 5, 19, 17, 0)),
        ],
        horizon_start=now - timedelta(days=7),
        horizon_end=now + timedelta(days=10),
    )
    # Schedule C: 60 days ago (outside 30d window). Should be filtered out.
    _save_published(
        schedules,
        "sched-c-old",
        created_at=now - timedelta(days=60),
        organization_id=_ORG_A,
        workspace_id=_WS_A,
        assignments=[
            _scheduled("WO-1-OP1", "WO-1", end=datetime(2026, 3, 10, 12, 0)),
        ],
        horizon_start=now - timedelta(days=70),
        horizon_end=now - timedelta(days=50),
    )

    return BuildExecutiveDashboard(
        work_orders=work_orders,
        schedules=schedules,
        now_provider=lambda: now,
    )


class TestBuildExecutiveDashboardHappyPath:
    def test_returns_two_samples_in_30d_window_sorted_asc(self, fixture):
        scope = TenantScope.for_workspace(organization_id=_ORG_A, workspace_id=_WS_A)

        out = fixture.execute(range_label="30d", scope=scope)

        assert out.range_label == "30d"
        assert out.scenarios_published_count == 2
        assert len(out.schedule_samples) == 2
        # sched-a (5 days ago) < sched-b (2 days ago)
        assert out.schedule_samples[0].schedule_id == "sched-a"
        assert out.schedule_samples[1].schedule_id == "sched-b"

    def test_current_kpis_match_latest_sample_with_delta(self, fixture):
        scope = TenantScope.for_workspace(organization_id=_ORG_A, workspace_id=_WS_A)

        out = fixture.execute(range_label="30d", scope=scope)

        # Latest = sched-b
        latest = out.schedule_samples[1]
        previous = out.schedule_samples[0]
        assert out.current_kpis.makespan_minutes == latest.makespan_minutes
        assert out.current_kpis.on_time_ratio == pytest.approx(latest.on_time_ratio)
        assert out.current_kpis.avg_utilization == pytest.approx(latest.avg_utilization)
        assert out.current_kpis.makespan_delta_minutes == (
            latest.makespan_minutes - previous.makespan_minutes
        )

    def test_top_late_orders_from_latest_schedule_sorted_desc(self, fixture):
        scope = TenantScope.for_workspace(organization_id=_ORG_A, workspace_id=_WS_A)

        out = fixture.execute(range_label="30d", scope=scope)

        # WO-2 ends 5/13 09:00, due 5/8 12:00 -> ~117h late
        # WO-1 ends 5/13 09:00, due 5/11 17:00 -> ~40h late
        # WO-3 ends 5/19 17:00, due 5/20 17:00 -> on time
        refs = [t.work_order_ref for t in out.top_late_orders]
        assert refs[0] == "WO-2"
        assert refs[1] == "WO-1"
        assert "WO-3" not in refs
        assert "WO-OTHER" not in refs

    def test_seven_day_window_sees_only_recent_schedule(self, fixture):
        scope = TenantScope.for_workspace(organization_id=_ORG_A, workspace_id=_WS_A)

        out = fixture.execute(range_label="7d", scope=scope)

        # Both sched-a (5d ago) and sched-b (2d ago) are inside 7d.
        assert out.scenarios_published_count == 2
        assert len(out.schedule_samples) == 2

    def test_old_schedule_outside_window_is_excluded(self, fixture):
        scope = TenantScope.for_workspace(organization_id=_ORG_A, workspace_id=_WS_A)

        out = fixture.execute(range_label="30d", scope=scope)

        sample_ids = {s.schedule_id for s in out.schedule_samples}
        assert "sched-c-old" not in sample_ids


class TestBuildExecutiveDashboardEmptyAndErrors:
    def test_empty_window_returns_zero_snapshot(self):
        wos = InMemoryWorkOrderRepository([])
        organizations = InMemoryOrganizationRepository(
            [Organization(id=_ORG_A, name="Plant QC", slug="plant-qc")]
        )
        workspaces = InMemoryWorkspaceRepository([])
        schedules = InMemoryScheduleRepository()  # empty

        builder = BuildExecutiveDashboard(
            work_orders=wos,
            schedules=schedules,
            now_provider=lambda: datetime(2026, 5, 7, 12, 0),
        )
        out = builder.execute(
            range_label="30d",
            scope=TenantScope.for_organization(_ORG_A),
        )

        assert out.scenarios_published_count == 0
        assert out.schedule_samples == ()
        assert out.top_late_orders == ()
        assert out.current_kpis.makespan_minutes == 0
        assert out.current_kpis.on_time_ratio == 1.0
        assert out.current_kpis.avg_utilization == 0.0
        assert out.current_kpis.makespan_delta_minutes is None
        assert out.current_kpis.on_time_delta is None
        assert out.current_kpis.avg_utilization_delta is None

    def test_invalid_range_raises_report_error(self):
        wos = InMemoryWorkOrderRepository([])
        schedules = InMemoryScheduleRepository()
        organizations = InMemoryOrganizationRepository([])
        workspaces = InMemoryWorkspaceRepository([])

        builder = BuildExecutiveDashboard(
            work_orders=wos,
            schedules=schedules,
            now_provider=lambda: datetime(2026, 5, 7),
        )

        with pytest.raises(ReportError):
            builder.execute(
                range_label="invalid",
                scope=TenantScope.for_organization(_ORG_A),
            )


class TestBuildExecutiveDashboardSingleSample:
    def test_single_sample_has_no_deltas(self):
        wos = InMemoryWorkOrderRepository(
            [_wo("WO-1", due=datetime(2026, 5, 11, 17, 0))]
        )
        organizations = InMemoryOrganizationRepository(
            [Organization(id=_ORG_A, name="Plant QC", slug="plant-qc")]
        )
        workspaces = InMemoryWorkspaceRepository([])
        schedules = InMemoryScheduleRepository()
        now = datetime(2026, 5, 7, 12, 0)
        _save_published(
            schedules,
            "sched-only",
            created_at=now - timedelta(days=2),
            organization_id=_ORG_A,
            workspace_id=None,
            assignments=[
                _scheduled("WO-1-OP1", "WO-1", end=datetime(2026, 5, 11, 12, 0)),
            ],
            horizon_start=now - timedelta(days=7),
            horizon_end=now + timedelta(days=7),
        )

        builder = BuildExecutiveDashboard(
            work_orders=wos,
            schedules=schedules,
            now_provider=lambda: now,
        )
        out = builder.execute(
            range_label="30d",
            scope=TenantScope.for_organization(_ORG_A),
        )

        assert len(out.schedule_samples) == 1
        assert out.current_kpis.makespan_delta_minutes is None
        assert out.current_kpis.on_time_delta is None
        assert out.current_kpis.avg_utilization_delta is None
```

- [ ] **Step 2: Run the tests, watch them fail (RED)**

```bash
python -m pytest tests/unit/use_cases/reports/test_build_executive_dashboard.py -v
```

Expected: `ModuleNotFoundError: No module named
'planiadvance_v2.application.use_cases.reports.build_executive_dashboard'`.

- [ ] **Step 3: Implement the use case**

Create `planiadvance_v2/application/use_cases/reports/build_executive_dashboard.py`:

```python
"""Use case: aggregate KPIs over a 7/30/90-day window of published schedules.

Pulls every published schedule for the active tenant whose
``created_at`` falls in [now-range, now], computes a per-schedule KPI
sample (makespan, on-time ratio, average utilization), and returns
the time series plus a delta-aware current snapshot. Top late orders
come from the latest schedule.

All reads honour F-401 scoping. ``list_recent`` already filters by
organization_id/workspace_id; the work-order pass uses the scoped view.
"""

from __future__ import annotations

from collections.abc import Callable
from datetime import datetime, timedelta

from ....domain.entities import Schedule, WorkOrder
from ....domain.scheduling import compute_metrics
from ....infrastructure.scoping import TenantScope
from ...ports.schedule_repository import ScheduleRepository
from ...ports.work_order_repository import WorkOrderRepository
from .build_production_sheet import ReportError
from .executive_dashboard_payload import (
    ExecutiveDashboardOutput,
    KpiSnapshot,
    ScheduleSample,
    TopLateOrder,
)

_RANGE_TO_DELTA: dict[str, timedelta] = {
    "7d": timedelta(days=7),
    "30d": timedelta(days=30),
    "90d": timedelta(days=90),
}

_LIST_RECENT_LIMIT = 200
_TOP_LATE_ORDERS_LIMIT = 5


class BuildExecutiveDashboard:
    def __init__(
        self,
        *,
        work_orders: WorkOrderRepository,
        schedules: ScheduleRepository,
        now_provider: Callable[[], datetime] = datetime.now,
    ) -> None:
        self._work_orders = work_orders
        self._schedules = schedules
        self._now = now_provider

    def execute(
        self,
        *,
        range_label: str,
        scope: TenantScope,
    ) -> ExecutiveDashboardOutput:
        delta = _RANGE_TO_DELTA.get(range_label)
        if delta is None:
            raise ReportError(
                f"range must be one of {sorted(_RANGE_TO_DELTA)}; got {range_label!r}"
            )
        organization_id = scope.require_organization()
        now = self._now()
        range_start = now - delta

        recent = self._schedules.list_recent(
            limit=_LIST_RECENT_LIMIT,
            organization_id=organization_id,
            workspace_id=scope.workspace_id,
            lifecycle_status="published",
        )
        # Schedules in the window, sorted by created_at asc.
        in_window = sorted(
            ((s, m) for s, m in recent if s.created_at >= range_start),
            key=lambda pair: pair[0].created_at,
        )

        work_orders = list(self._work_orders.with_scope(scope).list())

        samples = tuple(
            _to_sample(schedule, metadata, work_orders, now)
            for schedule, metadata in in_window
        )
        current_kpis = _kpi_snapshot(samples)

        top_late_orders: tuple[TopLateOrder, ...] = ()
        if in_window:
            latest_schedule, _ = in_window[-1]
            top_late_orders = _top_late_orders(
                latest_schedule, work_orders, now,
            )

        return ExecutiveDashboardOutput(
            range_label=range_label,
            range_start=range_start,
            range_end=now,
            generated_at=now,
            scenarios_published_count=len(samples),
            schedule_samples=samples,
            current_kpis=current_kpis,
            top_late_orders=top_late_orders,
        )


def _to_sample(
    schedule: Schedule,
    metadata,
    work_orders: list[WorkOrder],
    now: datetime,
) -> ScheduleSample:
    metrics = metadata.metrics if metadata.metrics else compute_metrics(
        schedule,
        work_orders,
        horizon_start=metadata.horizon_start or now,
        horizon_end=metadata.horizon_end or now,
    ).as_dict()
    util = metrics.get("machine_utilization") or {}
    avg_util = sum(util.values()) / len(util) if util else 0.0
    return ScheduleSample(
        schedule_id=schedule.id,
        published_at=schedule.created_at,
        makespan_minutes=int(metrics.get("makespan_minutes", 0)),
        on_time_ratio=float(metrics.get("on_time_ratio", 1.0)),
        avg_utilization=avg_util,
    )


def _kpi_snapshot(samples: tuple[ScheduleSample, ...]) -> KpiSnapshot:
    if not samples:
        return KpiSnapshot(
            makespan_minutes=0,
            on_time_ratio=1.0,
            avg_utilization=0.0,
            makespan_delta_minutes=None,
            on_time_delta=None,
            avg_utilization_delta=None,
        )
    latest = samples[-1]
    previous = samples[-2] if len(samples) >= 2 else None
    return KpiSnapshot(
        makespan_minutes=latest.makespan_minutes,
        on_time_ratio=latest.on_time_ratio,
        avg_utilization=latest.avg_utilization,
        makespan_delta_minutes=(
            latest.makespan_minutes - previous.makespan_minutes
            if previous
            else None
        ),
        on_time_delta=(
            latest.on_time_ratio - previous.on_time_ratio if previous else None
        ),
        avg_utilization_delta=(
            latest.avg_utilization - previous.avg_utilization if previous else None
        ),
    )


def _top_late_orders(
    schedule: Schedule,
    work_orders: list[WorkOrder],
    now: datetime,
) -> tuple[TopLateOrder, ...]:
    late: list[TopLateOrder] = []
    for wo in work_orders:
        ends = [a.end for a in schedule.assignments if a.work_order_id == wo.id]
        planned_end = max(ends) if ends else None
        if planned_end is None:
            if wo.due_date >= now:
                continue
            late.append(
                TopLateOrder(
                    work_order_ref=wo.id,
                    work_order_name=wo.name,
                    due_date=wo.due_date,
                    planned_end=None,
                    lateness_minutes=None,
                )
            )
            continue
        if planned_end <= wo.due_date:
            continue
        lateness = int((planned_end - wo.due_date).total_seconds() // 60)
        late.append(
            TopLateOrder(
                work_order_ref=wo.id,
                work_order_name=wo.name,
                due_date=wo.due_date,
                planned_end=planned_end,
                lateness_minutes=lateness,
            )
        )
    late.sort(
        key=lambda t: (
            t.lateness_minutes is None,
            -(t.lateness_minutes or 0),
        )
    )
    return tuple(late[:_TOP_LATE_ORDERS_LIMIT])
```

- [ ] **Step 4: Re-export the use case**

Edit `planiadvance_v2/application/use_cases/reports/__init__.py` — add the
import and append `BuildExecutiveDashboard` in alphabetical order:

```python
from .build_executive_dashboard import BuildExecutiveDashboard
```

In `__all__`, insert `"BuildExecutiveDashboard",` between `"BuildLateOrderReport"`
and `"BuildProductionSheet"`. Sorted final order:

```python
__all__ = [
    "BuildExecutiveDashboard",
    "BuildLateOrderReport",
    "BuildProductionSheet",
    "BuildWoTraveler",
    ...
]
```

- [ ] **Step 5: Run the tests, verify GREEN**

```bash
python -m pytest tests/unit/use_cases/reports/test_build_executive_dashboard.py -v
```

Expected: 8 PASSED.

- [ ] **Step 6: Run the full unit suite to confirm no regression**

```bash
python -m pytest tests/unit -q
```

Expected: 767 + 8 = 775 PASSED.

- [ ] **Step 7: Commit**

```bash
git add planiadvance_v2/application/use_cases/reports/build_executive_dashboard.py planiadvance_v2/application/use_cases/reports/__init__.py tests/unit/use_cases/reports/test_build_executive_dashboard.py
git commit -m "Add BuildExecutiveDashboard use case (J2d, TDD, 8 cases)

Aggregates KPIs over a 7/30/90-day window of published schedules.
Per-schedule sample built via compute_metrics; current KPIs come
from the latest sample with deltas vs the previous one. Top late
orders come from the latest schedule (max 5; unplanned overdue
WOs sort last). F-401 scoped read of WOs."
```

---

## Task 3: /reports/dashboard route + dependency wiring + HTTP tests

**Files:**
- Modify: `planiadvance_v2/api/routes/reports.py`
- Modify: `planiadvance_v2/api/dependencies.py`
- Modify: `tests/unit/api/test_reports_http.py`

- [ ] **Step 1: Add the dependency factory**

Edit `planiadvance_v2/api/dependencies.py`. Update the reports import block:

```python
from ..application.use_cases.reports import (
    BuildExecutiveDashboard,
    BuildLateOrderReport,
    BuildProductionSheet,
    BuildWoTraveler,
)
```

Append after `get_build_wo_traveler`:

```python
def get_build_executive_dashboard(
    session: Session = Depends(get_db_session),
) -> BuildExecutiveDashboard:
    return BuildExecutiveDashboard(
        work_orders=SqlWorkOrderRepository(session),
        schedules=SqlScheduleRepository(session),
    )
```

- [ ] **Step 2: Add the route**

Edit `planiadvance_v2/api/routes/reports.py`.

Update the reports import:
```python
from ...application.use_cases.reports import (
    BuildExecutiveDashboard,
    BuildLateOrderReport,
    BuildProductionSheet,
    BuildWoTraveler,
    MachineNotFoundForReport,
    NoPublishedScheduleForReport,
    ReportError,
    RequestedDateOutsideHorizon,
    WorkOrderNotFoundForReport,
)
```

Update the dependencies import:
```python
from ..dependencies import (
    get_build_executive_dashboard,
    get_build_late_order_report,
    get_build_production_sheet,
    get_build_wo_traveler,
    get_pdf_renderer,
    get_tenant_scope_from_context,
)
```

Append at the bottom of `reports.py`:

```python
@router.get("/dashboard")
def executive_dashboard(
    range: str = "30d",
    tenant: TenantContext = Depends(get_tenant_context),
    use_case: BuildExecutiveDashboard = Depends(get_build_executive_dashboard),
) -> Response:
    ensure_authenticated_permission(tenant, "view_reports")

    scope = _scope_from_tenant(tenant)
    try:
        payload = use_case.execute(range_label=range, scope=scope)
    except ReportError as exc:
        raise HTTPException(
            status_code=422,
            detail={"error": "invalid_range", "message": str(exc)},
        ) from exc

    import json
    return Response(
        content=json.dumps(payload.as_dict()),
        media_type="application/json",
    )
```

NOTE: the import of `json` at the top of the function is intentional —
the rest of `reports.py` is binary-PDF-focused; keeping `json` local
avoids reshuffling the file's existing imports for one route. If the
linter complains, lift the import to module level in the same edit.

- [ ] **Step 3: Append the HTTP tests**

Add at the bottom of `tests/unit/api/test_reports_http.py`:

```python
# --- J2d: Executive Dashboard --------------------------------------------

from planiadvance_v2.api.dependencies import get_build_executive_dashboard
from planiadvance_v2.application.use_cases.reports.executive_dashboard_payload import (
    ExecutiveDashboardOutput,
    KpiSnapshot,
)


def _dashboard_payload() -> ExecutiveDashboardOutput:
    return ExecutiveDashboardOutput(
        range_label="30d",
        range_start=datetime(2026, 4, 7, 12, 0),
        range_end=datetime(2026, 5, 7, 12, 0),
        generated_at=datetime(2026, 5, 7, 12, 0),
        scenarios_published_count=2,
        schedule_samples=(),
        current_kpis=KpiSnapshot(
            makespan_minutes=1234,
            on_time_ratio=0.83,
            avg_utilization=0.71,
            makespan_delta_minutes=-50,
            on_time_delta=0.05,
            avg_utilization_delta=-0.02,
        ),
        top_late_orders=(),
    )


class _FakeDashboardUseCase:
    def __init__(self, payload: ExecutiveDashboardOutput) -> None:
        self._payload = payload

    def execute(self, **_kwargs) -> ExecutiveDashboardOutput:
        return self._payload


class _RaisingDashboardUseCase:
    def execute(self, **_kwargs):
        from planiadvance_v2.application.use_cases.reports import ReportError
        raise ReportError("range must be one of ['30d', '7d', '90d']; got 'bad'")


def test_dashboard_returns_json_with_expected_keys(api):
    api.app.dependency_overrides[get_build_executive_dashboard] = (
        lambda: _FakeDashboardUseCase(_dashboard_payload())
    )

    response = api.get("/reports/dashboard?range=30d", headers=_TENANT_HEADERS)

    assert response.status_code == 200, response.text
    assert response.headers["content-type"].startswith("application/json")
    body = response.json()
    assert body["range_label"] == "30d"
    assert body["scenarios_published_count"] == 2
    assert body["current_kpis"]["makespan_minutes"] == 1234
    assert "top_late_orders" in body
    assert "schedule_samples" in body


def test_dashboard_anonymous_is_unauthorized(api):
    api.app.dependency_overrides[get_build_executive_dashboard] = (
        lambda: _FakeDashboardUseCase(_dashboard_payload())
    )

    response = api.get("/reports/dashboard")
    assert response.status_code == 401


def test_dashboard_integrator_is_forbidden(api):
    api.app.dependency_overrides[get_build_executive_dashboard] = (
        lambda: _FakeDashboardUseCase(_dashboard_payload())
    )

    response = api.get(
        "/reports/dashboard",
        headers={"X-Organization-Id": "org-1", "X-User-Id": "integrator-1"},
    )
    assert response.status_code == 403


def test_dashboard_invalid_range_returns_422(api):
    api.app.dependency_overrides[get_build_executive_dashboard] = (
        lambda: _RaisingDashboardUseCase()
    )

    response = api.get(
        "/reports/dashboard?range=bad",
        headers=_TENANT_HEADERS,
    )
    assert response.status_code == 422
    body = response.json()
    assert body["error"] == "invalid_range"
```

- [ ] **Step 4: Run the tests, verify GREEN**

```bash
python -m pytest tests/unit/api/test_reports_http.py -v
```

Expected: 13 (J2a/b/c) + 4 (J2d) = 17 PASSED.

- [ ] **Step 5: Run the full unit suite**

```bash
python -m pytest tests/unit -q
```

Expected: ~779 PASSED.

- [ ] **Step 6: Commit**

```bash
git add planiadvance_v2/api/routes/reports.py planiadvance_v2/api/dependencies.py tests/unit/api/test_reports_http.py
git commit -m "Add /reports/dashboard route + wiring (J2d)

JSON endpoint returning the ExecutiveDashboardOutput payload. Default
range is 30d; invalid ranges produce 422 invalid_range. Permission
gated by view_reports (anonymous 401, INTEGRATOR 403)."
```

---

## Task 4: Real-stack + smoke for the dashboard endpoint

**Files:**
- Modify: `tests/integration/test_real_stack_postgres.py`
- Modify: `planiadvance_v2/infrastructure/industrial_stack_smoke.py`

- [ ] **Step 1: Add the real-stack assertion**

In `tests/integration/test_real_stack_postgres.py`, find the J2c WO traveler
block. Add immediately after it:

```python
            # J2d: Executive Dashboard JSON.
            dashboard = client.get(
                "/reports/dashboard",
                params={"range": "7d"},
                headers=headers,
            )
```

After the J2c assertion block (`assert wo_traveler.status_code == 200, ...`),
add (outside the WeasyPrint conditional — JSON endpoint doesn't depend on
WeasyPrint):

```python
        assert dashboard.status_code == 200, dashboard.text
        dashboard_body = dashboard.json()
        assert dashboard_body["range_label"] == "7d"
        assert dashboard_body["scenarios_published_count"] >= 1
        assert "current_kpis" in dashboard_body
        assert "schedule_samples" in dashboard_body
```

- [ ] **Step 2: Add `dashboard_scenarios_count` to SmokeResult**

Edit `planiadvance_v2/infrastructure/industrial_stack_smoke.py`. Update the
dataclass:

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
    dashboard_scenarios_count: int
```

- [ ] **Step 3: Add the dashboard call in the smoke flow**

After the WO traveler block, add:

```python
    # J2d: Executive Dashboard JSON.
    dashboard_payload = _json_request(
        base_url,
        "GET",
        "/reports/dashboard?range=7d",
        headers=headers,
    )
    _require(
        isinstance(dashboard_payload, dict)
        and dashboard_payload.get("range_label") == "7d",
        f"Dashboard payload missing or wrong range: {dashboard_payload!r}",
    )
    dashboard_scenarios_count = int(
        dashboard_payload.get("scenarios_published_count", 0)
    )
    _require(
        dashboard_scenarios_count >= 1,
        f"Dashboard reported {dashboard_scenarios_count} scenarios; expected >= 1.",
    )
```

Update the `SmokeResult(...)` constructor:

```python
        late_order_bytes=len(late_order_pdf),
        wo_traveler_bytes=len(wo_traveler_pdf),
        wo_traveler_work_order_id=sample_wo_id,
        dashboard_scenarios_count=dashboard_scenarios_count,
    )
```

Update the JSON output dict in `main()`:

```python
                "wo_traveler_bytes": result.wo_traveler_bytes,
                "wo_traveler_work_order_id": result.wo_traveler_work_order_id,
                "dashboard_scenarios_count": result.dashboard_scenarios_count,
```

- [ ] **Step 4: Verify the smoke imports**

```bash
python -c "from planiadvance_v2.infrastructure.industrial_stack_smoke import SmokeResult, run_industrial_stack_smoke; print('imports ok')"
```

Expected: `imports ok`.

- [ ] **Step 5: Verify the integration test collects**

```bash
python -m pytest tests/integration/test_real_stack_postgres.py --collect-only -q
```

Expected: 3 tests collected (no errors).

- [ ] **Step 6: Commit**

```bash
git add tests/integration/test_real_stack_postgres.py planiadvance_v2/infrastructure/industrial_stack_smoke.py
git commit -m "Real-stack + smoke: assert /reports/dashboard returns JSON (J2d)

Dashboard JSON response is exercised with range=7d. Asserts the
top-level keys (range_label, current_kpis, schedule_samples) and a
non-zero scenarios_published_count (industrial seed publishes one)."
```

---

## Phase 2: Frontend — `/reports` page (Tasks 5-9)

## Task 5: Install recharts + add typed dashboard API helper

**Files:**
- Modify: `ui/package.json`
- Create: `ui/src/lib/dashboardApi.ts`
- Create: `ui/src/lib/pdfDownload.ts`

- [ ] **Step 1: Install recharts**

```bash
cd ui && npm install recharts@^2.x
```

Expected: `recharts` appears in `ui/package.json` dependencies, lockfile
updates.

- [ ] **Step 2: Add typed dashboard helper**

Create `ui/src/lib/dashboardApi.ts`:

```typescript
import { tenantHeaders } from "./tenant";

export type RangeLabel = "7d" | "30d" | "90d";

export interface ScheduleSample {
  schedule_id: string;
  published_at: string;
  makespan_minutes: number;
  on_time_ratio: number;
  avg_utilization: number;
}

export interface KpiSnapshot {
  makespan_minutes: number;
  on_time_ratio: number;
  avg_utilization: number;
  makespan_delta_minutes: number | null;
  on_time_delta: number | null;
  avg_utilization_delta: number | null;
}

export interface TopLateOrder {
  work_order_ref: string;
  work_order_name: string;
  due_date: string;
  planned_end: string | null;
  lateness_minutes: number | null;
}

export interface ExecutiveDashboardData {
  range_label: RangeLabel;
  range_start: string;
  range_end: string;
  generated_at: string;
  scenarios_published_count: number;
  schedule_samples: ScheduleSample[];
  current_kpis: KpiSnapshot;
  top_late_orders: TopLateOrder[];
}

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");

export async function fetchExecutiveDashboard(
  range: RangeLabel,
): Promise<ExecutiveDashboardData> {
  const url = `${API_BASE_URL}/reports/dashboard?range=${range}`;
  const response = await fetch(url, { headers: tenantHeaders() });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Dashboard fetch failed (${response.status}): ${text}`);
  }
  return (await response.json()) as ExecutiveDashboardData;
}
```

NOTE: read `ui/src/lib/api.ts` first to see how it derives `API_BASE_URL`
and copy that exact pattern (look for `import.meta.env` usage). Adjust
the snippet above if the convention differs.

- [ ] **Step 3: Add a Blob-based PDF download helper**

Create `ui/src/lib/pdfDownload.ts`:

```typescript
import { tenantHeaders } from "./tenant";

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");

export interface PdfDownloadOptions {
  path: string;
  query?: Record<string, string>;
  fallbackFilename: string;
}

export async function downloadPdf(options: PdfDownloadOptions): Promise<void> {
  const search = options.query
    ? "?" + new URLSearchParams(options.query).toString()
    : "";
  const response = await fetch(`${API_BASE_URL}${options.path}${search}`, {
    headers: tenantHeaders(),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`PDF download failed (${response.status}): ${text}`);
  }
  const blob = await response.blob();
  const filename =
    filenameFromContentDisposition(response.headers.get("content-disposition"))
    ?? options.fallbackFilename;
  triggerDownload(blob, filename);
}

function triggerDownload(blob: Blob, filename: string): void {
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(objectUrl);
}

function filenameFromContentDisposition(header: string | null): string | null {
  if (!header) return null;
  const match = /filename="?([^"]+)"?/i.exec(header);
  return match ? match[1] : null;
}
```

- [ ] **Step 4: Verify the build still passes**

```bash
cd ui && npm run build 2>&1 | tail -10
```

Expected: TypeScript compile + Vite production build succeed.

- [ ] **Step 5: Commit**

```bash
git add ui/package.json ui/package-lock.json ui/src/lib/dashboardApi.ts ui/src/lib/pdfDownload.ts
git commit -m "Add recharts + dashboard/pdf helpers for J2d

recharts ^2.x added as a UI dependency (~250KB gzipped) for
sparklines on the new /reports page. dashboardApi.ts is a typed
fetch wrapper around /reports/dashboard. pdfDownload.ts handles
Blob-based downloads with tenant headers (since <a download> can
not inject custom headers)."
```

---

## Task 6: Sparkline component + ExecutiveDashboard component

**Files:**
- Create: `ui/src/components/Sparkline.tsx`
- Create: `ui/src/components/ExecutiveDashboard.tsx`

- [ ] **Step 1: Build Sparkline**

Create `ui/src/components/Sparkline.tsx`:

```typescript
import { Line, LineChart, ResponsiveContainer } from "recharts";

export interface SparklineProps {
  data: number[];
  color?: string;
  height?: number;
}

export function Sparkline({ data, color = "currentColor", height = 32 }: SparklineProps) {
  if (data.length < 2) {
    return <div style={{ height, color: "#888", fontSize: "9pt" }}>—</div>;
  }
  const series = data.map((value, index) => ({ index, value }));
  return (
    <div style={{ width: "100%", height }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={series} margin={{ top: 2, right: 2, left: 2, bottom: 2 }}>
          <Line
            type="monotone"
            dataKey="value"
            stroke={color}
            strokeWidth={1.5}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
```

- [ ] **Step 2: Build ExecutiveDashboard**

Create `ui/src/components/ExecutiveDashboard.tsx`:

```typescript
import { KPI, Panel, Skeleton } from "../design";
import type { ExecutiveDashboardData } from "../lib/dashboardApi";
import { Sparkline } from "./Sparkline";

export interface ExecutiveDashboardProps {
  data: ExecutiveDashboardData | null;
  loading: boolean;
}

export function ExecutiveDashboard({ data, loading }: ExecutiveDashboardProps) {
  if (loading || !data) {
    return (
      <Panel title="Executive Dashboard">
        <div className="pa-grid pa-grid--cols-4" style={{ gap: "1rem" }}>
          <Skeleton style={{ height: 80 }} />
          <Skeleton style={{ height: 80 }} />
          <Skeleton style={{ height: 80 }} />
          <Skeleton style={{ height: 80 }} />
        </div>
      </Panel>
    );
  }

  const samples = data.schedule_samples;
  const makespanSeries = samples.map((s) => s.makespan_minutes);
  const onTimeSeries = samples.map((s) => s.on_time_ratio * 100);
  const utilSeries = samples.map((s) => s.avg_utilization * 100);
  const k = data.current_kpis;
  const empty = data.scenarios_published_count === 0;

  return (
    <Panel title="Executive Dashboard">
      <div
        className="pa-grid pa-grid--cols-4"
        style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "1rem" }}
      >
        <KPI
          label="Makespan"
          value={empty ? "—" : Math.round(k.makespan_minutes / 60)}
          unit={empty ? undefined : "h"}
          delta={
            k.makespan_delta_minutes != null
              ? {
                  value: `${Math.abs(Math.round(k.makespan_delta_minutes / 60))}h`,
                  direction: k.makespan_delta_minutes < 0 ? "down" : k.makespan_delta_minutes > 0 ? "up" : "flat",
                  goodDirection: "down",
                }
              : undefined
          }
          hint={<Sparkline data={makespanSeries} />}
        />
        <KPI
          label="On-time ratio"
          value={empty ? "—" : Math.round(k.on_time_ratio * 100)}
          unit={empty ? undefined : "%"}
          delta={
            k.on_time_delta != null
              ? {
                  value: `${Math.abs(Math.round(k.on_time_delta * 100))}%`,
                  direction: k.on_time_delta > 0 ? "up" : k.on_time_delta < 0 ? "down" : "flat",
                  goodDirection: "up",
                }
              : undefined
          }
          hint={<Sparkline data={onTimeSeries} />}
        />
        <KPI
          label="Avg utilization"
          value={empty ? "—" : Math.round(k.avg_utilization * 100)}
          unit={empty ? undefined : "%"}
          delta={
            k.avg_utilization_delta != null
              ? {
                  value: `${Math.abs(Math.round(k.avg_utilization_delta * 100))}%`,
                  direction: k.avg_utilization_delta > 0 ? "up" : k.avg_utilization_delta < 0 ? "down" : "flat",
                  goodDirection: "up",
                }
              : undefined
          }
          hint={<Sparkline data={utilSeries} />}
        />
        <KPI
          label="Scenarios published"
          value={data.scenarios_published_count}
          unit={data.scenarios_published_count === 1 ? "scenario" : "scenarios"}
          hint={`In the last ${data.range_label}`}
        />
      </div>

      <div style={{ marginTop: "1.5rem" }}>
        <h3 style={{ fontSize: "0.95rem", margin: "0 0 0.5rem 0" }}>Top late orders</h3>
        {data.top_late_orders.length === 0 ? (
          <div style={{ color: "#888", fontSize: "0.9rem" }}>No late orders ✓</div>
        ) : (
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {data.top_late_orders.map((order) => (
              <li
                key={order.work_order_ref}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  padding: "0.4rem 0",
                  borderBottom: "1px solid var(--pa-color-border, #ddd)",
                  fontSize: "0.9rem",
                }}
              >
                <span>
                  <strong>{order.work_order_ref}</strong> — {order.work_order_name}
                </span>
                <span style={{ color: "#a3262e" }}>
                  {order.lateness_minutes != null
                    ? `+${Math.round(order.lateness_minutes / 60)}h`
                    : "unplanned"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Panel>
  );
}
```

NOTE: read `ui/src/design/index.ts` (or the design barrel) before
finalising to confirm the exact export names for `KPI`, `Panel`,
`Skeleton`. The above assumes the barrel re-exports them.

- [ ] **Step 3: Verify the build**

```bash
cd ui && npm run build 2>&1 | tail -10
```

Expected: build succeeds. Type errors here usually mean an import name
mismatch — fix and re-run.

- [ ] **Step 4: Commit**

```bash
git add ui/src/components/Sparkline.tsx ui/src/components/ExecutiveDashboard.tsx
git commit -m "Add Sparkline + ExecutiveDashboard components (J2d)

Sparkline wraps a recharts LineChart (no axes, no animation).
ExecutiveDashboard shows 4 KPI cards (makespan / on-time / util /
scenarios published) with embedded sparklines and a top-late-orders
list. Empty state ('—') when scenarios_published_count is 0."
```

---

## Task 7: PdfReportCards component

**Files:**
- Create: `ui/src/components/PdfReportCards.tsx`

- [ ] **Step 1: Build PdfReportCards**

Create `ui/src/components/PdfReportCards.tsx`:

```typescript
import { Download } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button, Field, Flash, Icon, Panel } from "../design";
import { api } from "../lib/api";
import { downloadPdf } from "../lib/pdfDownload";
import type { MachineOut, WorkOrderOut } from "../types";

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export function PdfReportCards() {
  const [machines, setMachines] = useState<MachineOut[]>([]);
  const [workOrders, setWorkOrders] = useState<WorkOrderOut[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [machinesResult, woResult] = await Promise.all([
        api.machines(),
        api.workOrders(),
      ]);
      if (cancelled) return;
      if (machinesResult.ok) setMachines(machinesResult.data);
      else setLoadError(machinesResult.error);
      if (woResult.ok) setWorkOrders(woResult.data);
      else if (!loadError) setLoadError(woResult.error);
    })();
    return () => {
      cancelled = true;
    };
  }, [loadError]);

  return (
    <Panel title="PDF Reports">
      {loadError && <Flash tone="warn" title="Failed to load options">{loadError}</Flash>}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
          gap: "1rem",
          marginTop: "0.5rem",
        }}
      >
        <ProductionSheetCard machines={machines} />
        <LateOrderCard />
        <WoTravelerCard workOrders={workOrders} />
      </div>
    </Panel>
  );
}

function ProductionSheetCard({ machines }: { machines: MachineOut[] }) {
  const [machineId, setMachineId] = useState<string>("");
  const [date, setDate] = useState<string>(todayIsoDate());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sortedMachines = useMemo(
    () => [...machines].sort((a, b) => a.id.localeCompare(b.id)),
    [machines],
  );

  useEffect(() => {
    if (!machineId && sortedMachines.length > 0) {
      setMachineId(sortedMachines[0].id);
    }
  }, [machineId, sortedMachines]);

  async function handleDownload() {
    if (!machineId || !date) return;
    setBusy(true);
    setError(null);
    try {
      await downloadPdf({
        path: "/reports/production-sheet",
        query: { machine_id: machineId, date },
        fallbackFilename: `production-sheet-${machineId}-${date}.pdf`,
      });
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : String(exc));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ReportCard
      title="Production Sheet"
      description="Operations on one machine for one day."
      controls={
        <>
          <Field label="Machine">
            <select value={machineId} onChange={(e) => setMachineId(e.target.value)}>
              {sortedMachines.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.id} — {m.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Date">
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
        </>
      }
      busy={busy}
      error={error}
      onDownload={handleDownload}
    />
  );
}

function LateOrderCard() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDownload() {
    setBusy(true);
    setError(null);
    try {
      await downloadPdf({
        path: "/reports/late-orders",
        fallbackFilename: "late-orders.pdf",
      });
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : String(exc));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ReportCard
      title="Late-order Report"
      description="All late WOs in the latest published schedule."
      busy={busy}
      error={error}
      onDownload={handleDownload}
    />
  );
}

function WoTravelerCard({ workOrders }: { workOrders: WorkOrderOut[] }) {
  const [workOrderId, setWorkOrderId] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sortedWorkOrders = useMemo(
    () => [...workOrders].sort((a, b) => a.id.localeCompare(b.id)),
    [workOrders],
  );

  useEffect(() => {
    if (!workOrderId && sortedWorkOrders.length > 0) {
      setWorkOrderId(sortedWorkOrders[0].id);
    }
  }, [workOrderId, sortedWorkOrders]);

  async function handleDownload() {
    if (!workOrderId) return;
    setBusy(true);
    setError(null);
    try {
      await downloadPdf({
        path: "/reports/wo-traveler",
        query: { work_order_id: workOrderId },
        fallbackFilename: `wo-traveler-${workOrderId}.pdf`,
      });
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : String(exc));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ReportCard
      title="WO Traveler"
      description="One page per work order with operations and materials."
      controls={
        <Field label="Work order">
          <select
            value={workOrderId}
            onChange={(e) => setWorkOrderId(e.target.value)}
          >
            {sortedWorkOrders.map((wo) => (
              <option key={wo.id} value={wo.id}>
                {wo.id} — {wo.name}
              </option>
            ))}
          </select>
        </Field>
      }
      busy={busy}
      error={error}
      onDownload={handleDownload}
    />
  );
}

function ReportCard({
  title,
  description,
  controls,
  busy,
  error,
  onDownload,
}: {
  title: string;
  description: string;
  controls?: React.ReactNode;
  busy: boolean;
  error: string | null;
  onDownload: () => void;
}) {
  return (
    <div
      style={{
        border: "1px solid var(--pa-color-border, #ddd)",
        borderRadius: "0.5rem",
        padding: "1rem",
        display: "flex",
        flexDirection: "column",
        gap: "0.75rem",
      }}
    >
      <div>
        <h3 style={{ margin: 0, fontSize: "1rem" }}>{title}</h3>
        <p style={{ margin: "0.25rem 0 0 0", color: "#666", fontSize: "0.85rem" }}>
          {description}
        </p>
      </div>
      {controls}
      {error && <Flash tone="warn" title="Download failed">{error}</Flash>}
      <Button
        onClick={onDownload}
        loading={busy}
        leadingIcon={<Icon icon={Download} size="sm" />}
        variant="primary"
      >
        Download PDF
      </Button>
    </div>
  );
}
```

NOTE: this assumes `api.machines()` and `api.workOrders()` exist on
`ui/src/lib/api.ts`. Verify by searching for those method names; if
the names differ (e.g. `api.listMachines()`), update accordingly. Also
verify the `MachineOut` and `WorkOrderOut` types in `ui/src/types.ts`.

- [ ] **Step 2: Verify the build**

```bash
cd ui && npm run build 2>&1 | tail -10
```

Expected: build succeeds. Common type errors here come from mismatched
api method names — adjust as needed.

- [ ] **Step 3: Commit**

```bash
git add ui/src/components/PdfReportCards.tsx
git commit -m "Add PdfReportCards component (J2d)

Three cards in a responsive grid: Production Sheet (machine + date
pickers, default to first machine + today), Late-order (no inputs),
WO Traveler (WO picker, default to first). Each card downloads via
the Blob-based pdfDownload helper; loading + error states inline."
```

---

## Task 8: ReportsPage + route + nav entry

**Files:**
- Create: `ui/src/pages/ReportsPage.tsx`
- Modify: `ui/src/App.tsx` (add route)
- Modify: `ui/src/components/AppShell.tsx` (add launcher entry)

- [ ] **Step 1: Build ReportsPage**

Create `ui/src/pages/ReportsPage.tsx`:

```typescript
import { useEffect, useState } from "react";
import { ExecutiveDashboard } from "../components/ExecutiveDashboard";
import { PdfReportCards } from "../components/PdfReportCards";
import { Flash, PageFrame, Tabs } from "../design";
import {
  fetchExecutiveDashboard,
  type ExecutiveDashboardData,
  type RangeLabel,
} from "../lib/dashboardApi";

const RANGE_TABS = [
  { id: "7d" as const, label: "7 days" },
  { id: "30d" as const, label: "30 days" },
  { id: "90d" as const, label: "90 days" },
];

export function ReportsPage() {
  const [range, setRange] = useState<RangeLabel>("30d");
  const [data, setData] = useState<ExecutiveDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const result = await fetchExecutiveDashboard(range);
        if (!cancelled) setData(result);
      } catch (exc) {
        if (!cancelled) {
          setError(exc instanceof Error ? exc.message : String(exc));
          setData(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [range]);

  return (
    <PageFrame title="Reports & Dashboard">
      <div style={{ marginBottom: "1rem" }}>
        <Tabs<RangeLabel>
          items={RANGE_TABS}
          value={range}
          onChange={setRange}
          variant="segmented"
          aria-label="Time range"
        />
      </div>
      {error && (
        <Flash tone="warn" title="Failed to load dashboard">
          {error}
        </Flash>
      )}
      <ExecutiveDashboard data={data} loading={loading} />
      <div style={{ marginTop: "1.5rem" }}>
        <PdfReportCards />
      </div>
    </PageFrame>
  );
}
```

- [ ] **Step 2: Wire the /reports route**

Edit `ui/src/App.tsx`. Add the import:

```typescript
import { ReportsPage } from "./pages/ReportsPage";
```

Add the route inside `<Routes>` (after `/scenarios`):

```typescript
<Route path="/reports" element={<RequireSession><ReportsPage /></RequireSession>} />
```

- [ ] **Step 3: Add the launcher entry**

Edit `ui/src/components/AppShell.tsx`. Add the import:

```typescript
import { ..., FileBarChart, ... } from "lucide-react";
```

Add a new entry to `APP_LAUNCHER_ITEMS` (after the `scenarios` entry):

```typescript
  {
    id: "reports",
    label: "Reports",
    description: "Download printable reports and review the executive dashboard.",
    to: "/reports",
    group: "operations",
    icon: FileBarChart,
    match: (path) => path.startsWith("/reports"),
  },
```

- [ ] **Step 4: Build the UI**

```bash
cd ui && npm run build 2>&1 | tail -10
```

Expected: build succeeds.

- [ ] **Step 5: Manual smoke (dev server)**

In one terminal:
```bash
make run
```
In another:
```bash
cd ui && npm run dev
```

Open the browser. Log in (industrial seed user). Use the launcher to
navigate to `/reports`. Verify:
- 4 KPI cards render (with sparklines if multiple schedules exist;
  otherwise just current value)
- Top-late-orders list either shows entries or "No late orders ✓"
- Range tabs (7d / 30d / 90d) re-fetch on click
- 3 PDF cards render with their pickers
- Each "Download PDF" button produces a valid PDF file in the
  browser's download tray

If the API isn't running, expect a Flash banner above the dashboard.

- [ ] **Step 6: Commit**

```bash
git add ui/src/pages/ReportsPage.tsx ui/src/App.tsx ui/src/components/AppShell.tsx
git commit -m "Wire /reports page + launcher entry (J2d)

ReportsPage composes ExecutiveDashboard + PdfReportCards under a
range selector (7d / 30d / 90d). Route mounted at /reports with
RequireSession. Launcher entry under 'Data & integrations' with
the FileBarChart icon."
```

---

## Task 9: Doc update + final validation

**Files:**
- Modify: `docs/reports-howto.md`
- Modify: `docs/J2-RESUME.md`

- [ ] **Step 1: Update reports-howto.md**

Replace the "Reports planned" section:

```markdown
## Reports planned

- **Executive Dashboard** — J2d. In-app (not PDF). KPI trends 7/30/90 days.
```

with:

```markdown
## Reports planned

(none — J2 module closed)

## In-app dashboard

- **Executive Dashboard** — `/reports` page (UI) + `GET /reports/dashboard?range=`
  (backend) — J2d, 2026-05-07. KPI trends over a 7d/30d/90d window: makespan,
  on-time ratio, average utilization, top late orders, scenarios published count.
  Sparklines via recharts. The same `/reports` page also exposes download buttons
  for the three PDF reports.
```

- [ ] **Step 2: Run the full unit + integration suite**

```bash
python -m pytest tests/unit tests/integration -q
```

Expected: ~779 unit + 5 integration PASS, real-stack PASSED if Postgres
is running (or SKIPPED).

- [ ] **Step 3: Run lint**

```bash
ruff check planiadvance_v2 tests --output-format=concise
```

Expected: 44 errors (baseline preserved). If higher, run
`ruff check <new files> --fix` on the J2d additions.

- [ ] **Step 4: Build the UI one last time**

```bash
cd ui && npm run build 2>&1 | tail -5
```

Expected: production build succeeds with zero TS errors.

- [ ] **Step 5: Update docs/J2-RESUME.md**

Mark J2d as DONE. Bump test counts. Set "Reports backend" line in
"Quick state check" to "3/3 PDFs + 1 in-app dashboard done — J2 module
closed". Move the "Next subjective milestone" section's "Next" pointer
to J3 (Advanced Gantt).

- [ ] **Step 6: Commit**

```bash
git add docs/reports-howto.md docs/J2-RESUME.md
git commit -m "Close J2 module: J2d Executive Dashboard shipped

reports-howto.md updated to reflect that all 4 V1.0 deliverables are
shipped (3 PDFs + in-app dashboard). J2-RESUME.md marks J2d DONE
and points to J3 Advanced Gantt as the next milestone."
```

---

## Self-review checklist (run once before handing off)

- [ ] Spec coverage: every section of
  `2026-05-07-j2d-executive-dashboard-design.md` has at least one task
  (DTOs / use case / route / real-stack / smoke / frontend page / nav
  / docs).
- [ ] No "TBD" / "TODO" / "implement later" / "fill in".
- [ ] Type names match across tasks: `ExecutiveDashboardOutput`,
  `ScheduleSample`, `KpiSnapshot`, `TopLateOrder`,
  `BuildExecutiveDashboard`.
- [ ] Tenant scoping: backend uses `list_recent(organization_id=…,
  workspace_id=…)` + `work_orders.with_scope(scope).list()`.
- [ ] Frontend respects existing patterns (PageFrame, Panel, KPI, Tabs,
  api lib, tenantHeaders).
- [ ] Each task ends with a commit. Frequent commits = bisectable
  history.
- [ ] Permissions: `view_reports` reused; no matrix change.
- [ ] J2a/b/c infrastructure reused (PdfRenderer, base.html, print.css,
  /reports router, view_reports).
- [ ] recharts dependency justified by spec (user choice during
  brainstorming).
- [ ] Smoke + real-stack assertions added for the new endpoint.
