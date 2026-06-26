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
    Schedule,
    ScheduledOperation,
    WorkOrder,
)
from planiadvance_v2.domain.value_objects import Duration, Priority
from planiadvance_v2.infrastructure.in_memory.repositories import (
    InMemoryScheduleRepository,
    InMemoryWorkOrderRepository,
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
    schedules = InMemoryScheduleRepository()
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
        assert out.schedule_samples[0].schedule_id == "sched-a"
        assert out.schedule_samples[1].schedule_id == "sched-b"

    def test_current_kpis_match_latest_sample_with_delta(self, fixture):
        scope = TenantScope.for_workspace(organization_id=_ORG_A, workspace_id=_WS_A)

        out = fixture.execute(range_label="30d", scope=scope)

        latest = out.schedule_samples[1]
        previous = out.schedule_samples[0]
        assert out.current_kpis.makespan_minutes == latest.makespan_minutes
        assert out.current_kpis.on_time_ratio == pytest.approx(latest.on_time_ratio)
        assert out.current_kpis.avg_utilization == pytest.approx(latest.avg_utilization)
        assert out.current_kpis.makespan_delta_minutes == (
            latest.makespan_minutes - previous.makespan_minutes
        )

    def test_industrial_kpis_propagate_to_samples_and_snapshot(self, fixture):
        scope = TenantScope.for_workspace(organization_id=_ORG_A, workspace_id=_WS_A)

        out = fixture.execute(range_label="30d", scope=scope)

        # The samples should expose the industrial KPI fields, even if their
        # values are zero on this synthetic fixture.
        for sample in out.schedule_samples:
            assert hasattr(sample, "queue_time_minutes_avg")
            assert hasattr(sample, "changeover_ratio")
            assert hasattr(sample, "saturation_max")
            assert hasattr(sample, "saturation_p95")
            assert hasattr(sample, "wip_operation_count")

        # Current KPIs mirror the latest sample for the new fields.
        latest = out.schedule_samples[1]
        assert out.current_kpis.queue_time_minutes_avg == latest.queue_time_minutes_avg
        assert out.current_kpis.changeover_ratio == pytest.approx(latest.changeover_ratio)
        assert out.current_kpis.saturation_max == pytest.approx(latest.saturation_max)
        assert out.current_kpis.saturation_p95 == pytest.approx(latest.saturation_p95)
        assert out.current_kpis.wip_operation_count == latest.wip_operation_count

        # Deltas computed when there are >= 2 samples.
        assert out.current_kpis.queue_time_delta_minutes is not None
        assert out.current_kpis.changeover_delta is not None
        assert out.current_kpis.saturation_max_delta is not None
        assert out.current_kpis.saturation_p95_delta is not None
        assert out.current_kpis.wip_delta is not None

    def test_dashboard_as_dict_serializes_industrial_kpis(self, fixture):
        scope = TenantScope.for_workspace(organization_id=_ORG_A, workspace_id=_WS_A)

        out = fixture.execute(range_label="30d", scope=scope)
        payload = out.as_dict()
        kpis = payload["current_kpis"]

        assert "queue_time_minutes_avg" in kpis
        assert "changeover_ratio" in kpis
        assert "saturation_max" in kpis
        assert "saturation_p95" in kpis
        assert "wip_operation_count" in kpis
        assert "queue_time_delta_minutes" in kpis
        assert "changeover_delta" in kpis
        assert "saturation_max_delta" in kpis
        assert "saturation_p95_delta" in kpis
        assert "wip_delta" in kpis

        sample0 = payload["schedule_samples"][0]
        assert "queue_time_minutes_avg" in sample0
        assert "saturation_max" in sample0

    def test_top_late_orders_from_latest_schedule_sorted_desc(self, fixture):
        scope = TenantScope.for_workspace(organization_id=_ORG_A, workspace_id=_WS_A)

        out = fixture.execute(range_label="30d", scope=scope)

        refs = [t.work_order_ref for t in out.top_late_orders]
        assert refs[0] == "WO-2"
        assert refs[1] == "WO-1"
        assert "WO-3" not in refs
        assert "WO-OTHER" not in refs

    def test_seven_day_window_sees_only_recent_schedule(self, fixture):
        scope = TenantScope.for_workspace(organization_id=_ORG_A, workspace_id=_WS_A)

        out = fixture.execute(range_label="7d", scope=scope)

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
        schedules = InMemoryScheduleRepository()

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
        assert out.current_kpis.queue_time_delta_minutes is None
        assert out.current_kpis.changeover_delta is None
        assert out.current_kpis.saturation_max_delta is None
        assert out.current_kpis.saturation_p95_delta is None
        assert out.current_kpis.wip_delta is None

    def test_invalid_range_raises_report_error(self):
        wos = InMemoryWorkOrderRepository([])
        schedules = InMemoryScheduleRepository()

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
        assert out.current_kpis.queue_time_delta_minutes is None
        assert out.current_kpis.changeover_delta is None
        assert out.current_kpis.saturation_max_delta is None
        assert out.current_kpis.saturation_p95_delta is None
        assert out.current_kpis.wip_delta is None
