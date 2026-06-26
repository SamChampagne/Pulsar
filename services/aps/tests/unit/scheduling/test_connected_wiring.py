"""End-to-end connectivity tests.

These tests verify that previously-disconnected features are now properly
wired through the use cases:

1. Resources loaded from repository and injected into SchedulingContext
   (RunScheduling, CompareStrategies, RunDisruption).
2. transfer_times passed through CompareStrategies and RunDisruption.
3. Disruption schedules persisted as new runs.
4. Rush order included in metrics computation.
5. Schedule metadata (strategy, solver_status, etc.) persisted and
   returned by list_recent / dashboard.
6. Lot sizing and routing alternatives flow through create → persist → load.
"""

from __future__ import annotations

from datetime import datetime, time, timedelta

import pytest

from planiadvance_v2.application.use_cases.compare_strategies import (
    CompareStrategies,
    CompareStrategiesInput,
)
from planiadvance_v2.application.use_cases.get_schedule_dashboard import (
    GetScheduleDashboard,
)
from planiadvance_v2.application.use_cases.handle_disruption import (
    DisruptionEvent,
    DisruptionType,
)
from planiadvance_v2.application.use_cases.list_schedules import ListSchedules
from planiadvance_v2.application.use_cases.replay_schedule_run import (
    ReplayScheduleRun,
    ReplayScheduleRunInput,
)
from planiadvance_v2.application.use_cases.run_disruption import (
    RunDisruption,
    RunDisruptionInput,
)
from planiadvance_v2.application.use_cases.run_scheduling import (
    RunScheduling,
    RunSchedulingInput,
)
from planiadvance_v2.domain.entities import (
    InventoryItem,
    Machine,
    MaterialRequirement,
    Operation,
    Resource,
    Schedule,
    SupplyLot,
    WorkingCalendar,
    WorkOrder,
)
from planiadvance_v2.domain.entities.operation import RoutingAlternative
from planiadvance_v2.domain.entities.resource import ResourceRequirement
from planiadvance_v2.domain.errors import ValidationError
from planiadvance_v2.domain.value_objects import (
    Duration,
    LotSizingPolicy,
    Priority,
    Shift,
    TransferTimes,
)
from planiadvance_v2.infrastructure.in_memory.repositories import (
    InMemoryCalendarRepository,
    InMemoryInventoryRepository,
    InMemoryMachineRepository,
    InMemoryResourceRepository,
    InMemoryScheduleRepository,
    InMemorySupplyRepository,
    InMemoryWorkOrderRepository,
)

MONDAY = datetime(2026, 1, 5, 0, 0, 0)
HORIZON_END = MONDAY + timedelta(days=7)
NOW = datetime(2026, 1, 5, 10, 0, 0)  # Monday 10:00


def _calendar() -> WorkingCalendar:
    return WorkingCalendar(
        id="CAL",
        name="Mon-Fri 08-17",
        shifts=[
            Shift(weekday=w, start=time(8, 0), end=time(17, 0)) for w in range(5)
        ],
    )


def _machines() -> list[Machine]:
    return [
        Machine(id="M1", name="M1", calendar_id="CAL"),
        Machine(id="M2", name="M2", calendar_id="CAL"),
    ]


def _resource() -> Resource:
    return Resource(id="MOULD", name="Mould", capacity=1)


def _wo_with_resources() -> WorkOrder:
    """A work order whose operations require a secondary resource."""
    return WorkOrder(
        id="WO1",
        name="WO1",
        product_id="P1",
        quantity=1,
        due_date=MONDAY + timedelta(days=3),
        release_date=MONDAY,
        operations=[
            Operation(
                id="OP1",
                work_order_id="WO1",
                sequence=1,
                name="OP1",
                duration=Duration(minutes=60),
                eligible_machine_ids=["M1"],
                resource_requirements=[
                    ResourceRequirement(resource_id="MOULD", units=1),
                ],
            ),
            Operation(
                id="OP2",
                work_order_id="WO1",
                sequence=2,
                name="OP2",
                duration=Duration(minutes=60),
                eligible_machine_ids=["M2"],
                dependencies=["OP1"],
                resource_requirements=[
                    ResourceRequirement(resource_id="MOULD", units=1),
                ],
            ),
        ],
    )


def _simple_wo() -> WorkOrder:
    """A simple work order without resources for basic tests."""
    return WorkOrder(
        id="WO1",
        name="WO1",
        product_id="P1",
        quantity=1,
        due_date=MONDAY + timedelta(days=3),
        release_date=MONDAY,
        operations=[
            Operation(
                id="OP1",
                work_order_id="WO1",
                sequence=1,
                name="OP1",
                duration=Duration(minutes=60),
                eligible_machine_ids=["M1", "M2"],
            ),
            Operation(
                id="OP2",
                work_order_id="WO1",
                sequence=2,
                name="OP2",
                duration=Duration(minutes=60),
                eligible_machine_ids=["M1", "M2"],
                dependencies=["OP1"],
            ),
        ],
    )


# --------------------------------------------------------------------------
# Priority 1: Resources connected to RunScheduling
# --------------------------------------------------------------------------


class TestRunSchedulingWithResources:
    """Resources from repository are injected into SchedulingContext."""

    def test_resources_loaded_and_used(self):
        """When operations require resources and the resource repo has them,
        the scheduling engine honours the cumulative constraint."""
        uc = RunScheduling(
            work_orders=InMemoryWorkOrderRepository([_wo_with_resources()]),
            machines=InMemoryMachineRepository(_machines()),
            calendars=InMemoryCalendarRepository([_calendar()]),
            resources=InMemoryResourceRepository([_resource()]),
        )
        result = uc.execute(
            RunSchedulingInput(
                horizon_start=MONDAY,
                strategy="greedy",
                persist=False,
            )
        )
        # Both ops need the MOULD (capacity 1) — they must be serialised.
        op1 = next(a for a in result.schedule.assignments if a.operation_id == "OP1")
        op2 = next(a for a in result.schedule.assignments if a.operation_id == "OP2")
        assert op2.start >= op1.end

    def test_no_resources_repo_still_works(self):
        """Backward compat: when no resource repo is injected, works as before."""
        uc = RunScheduling(
            work_orders=InMemoryWorkOrderRepository([_simple_wo()]),
            machines=InMemoryMachineRepository(_machines()),
            calendars=InMemoryCalendarRepository([_calendar()]),
        )
        result = uc.execute(
            RunSchedulingInput(
                horizon_start=MONDAY,
                strategy="greedy",
                persist=False,
            )
        )
        assert len(result.schedule.assignments) == 2

    def test_tenant_run_scopes_secondary_inputs(self):
        """A tenant run must not consume secondary inputs from another org."""
        calendar = _calendar()
        machine = Machine(
            id="M1",
            name="M1",
            calendar_id="CAL",
            organization_id="org-1",
        )
        work_order = WorkOrder(
            id="WO-ORG1",
            name="WO-ORG1",
            product_id="P1",
            quantity=1,
            due_date=MONDAY + timedelta(days=1),
            release_date=MONDAY,
            organization_id="org-1",
            operations=[
                Operation(
                    id="OP-ORG1",
                    work_order_id="WO-ORG1",
                    sequence=1,
                    name="OP-ORG1",
                    duration=Duration(minutes=60),
                    eligible_machine_ids=["M1"],
                    resource_requirements=[
                        ResourceRequirement(resource_id="RES-ORG1", units=1),
                    ],
                    material_requirements=[
                        MaterialRequirement(
                            material_id="MAT-A",
                            fixed_quantity=1.0,
                        )
                    ],
                )
            ],
        )
        uc = RunScheduling(
            work_orders=InMemoryWorkOrderRepository([work_order]),
            machines=InMemoryMachineRepository([machine]),
            calendars=InMemoryCalendarRepository([calendar]),
            resources=InMemoryResourceRepository(
                [
                    Resource(
                        id="RES-ORG1",
                        name="Org 1 resource",
                        capacity=1,
                        organization_id="org-1",
                    ),
                    Resource(
                        id="RES-ORG2",
                        name="Org 2 resource",
                        capacity=1,
                        organization_id="org-2",
                    ),
                ]
            ),
            inventory=InMemoryInventoryRepository(
                [
                    InventoryItem(
                        material_id="MAT-A",
                        quantity_on_hand=2.0,
                        organization_id="org-1",
                    ),
                    InventoryItem(
                        material_id="MAT-B",
                        quantity_on_hand=2.0,
                        organization_id="org-2",
                    ),
                ]
            ),
            supplies=InMemorySupplyRepository(
                [
                    SupplyLot(
                        id="SUP-ORG1",
                        material_id="MAT-A",
                        quantity=1.0,
                        available_at=MONDAY,
                        organization_id="org-1",
                    ),
                    SupplyLot(
                        id="SUP-ORG2",
                        material_id="MAT-B",
                        quantity=1.0,
                        available_at=MONDAY,
                        organization_id="org-2",
                    ),
                ]
            ),
        )

        result = uc.execute(
            RunSchedulingInput(
                horizon_start=MONDAY,
                strategy="greedy",
                persist=False,
                organization_id="org-1",
            )
        )

        counts = result.diagnostics["input_entity_counts"]
        assert counts["resources"] == 1
        assert counts["inventory_items"] == 1
        assert counts["supplies"] == 1
        assert result.schedule.assignments[0].operation_id == "OP-ORG1"

    def test_validation_gate_blocks_material_shortage_before_solve(self):
        """Hard material shortages are rejected before solver execution."""
        work_order = _simple_wo()
        work_order.operations[0].material_requirements = [
            MaterialRequirement(material_id="MAT-A", fixed_quantity=10.0),
        ]
        uc = RunScheduling(
            work_orders=InMemoryWorkOrderRepository([work_order]),
            machines=InMemoryMachineRepository(_machines()),
            calendars=InMemoryCalendarRepository([_calendar()]),
            inventory=InMemoryInventoryRepository([]),
            supplies=InMemorySupplyRepository([]),
        )

        with pytest.raises(ValidationError, match="Planning validation blocked"):
            uc.execute(
                RunSchedulingInput(
                    horizon_start=MONDAY,
                    strategy="greedy",
                    persist=False,
                )
            )

    def test_tenant_run_rejects_cross_org_baseline_schedule(self):
        """A tenant run cannot use a baseline schedule from another organization."""
        schedule_repo = InMemoryScheduleRepository()
        schedule_repo.save(
            Schedule(
                id="baseline-org-2",
                created_at=MONDAY,
                assignments=[],
            ),
            metrics={},
            organization_id="org-2",
        )
        work_order = _simple_wo()
        work_order.organization_id = "org-1"
        machines = [
            Machine(
                id="M1",
                name="M1",
                calendar_id="CAL",
                organization_id="org-1",
            ),
            Machine(
                id="M2",
                name="M2",
                calendar_id="CAL",
                organization_id="org-1",
            ),
        ]
        uc = RunScheduling(
            work_orders=InMemoryWorkOrderRepository([work_order]),
            machines=InMemoryMachineRepository(machines),
            calendars=InMemoryCalendarRepository([_calendar()]),
            schedules=schedule_repo,
        )

        with pytest.raises(ValidationError, match="belongs to organization"):
            uc.execute(
                RunSchedulingInput(
                    horizon_start=MONDAY,
                    strategy="greedy",
                    persist=False,
                    organization_id="org-1",
                    baseline_schedule_id="baseline-org-2",
                )
            )


# --------------------------------------------------------------------------
# Priority 2: Resources and transfer_times in CompareStrategies
# --------------------------------------------------------------------------


class TestCompareStrategiesWithResources:
    """CompareStrategies loads resources and accepts transfer_times."""

    def test_resources_loaded_in_compare(self):
        uc = CompareStrategies(
            work_orders=InMemoryWorkOrderRepository([_wo_with_resources()]),
            machines=InMemoryMachineRepository(_machines()),
            calendars=InMemoryCalendarRepository([_calendar()]),
            resources=InMemoryResourceRepository([_resource()]),
        )
        result = uc.execute(
            CompareStrategiesInput(
                strategies=["greedy", "backward"],
                horizon_start=MONDAY,
                parallel=False,
            )
        )
        assert result.best is not None
        for run in result.runs:
            assert run.succeeded
            # Resource constraint means ops are serialised in every strategy.
            op1 = next(
                a for a in run.schedule.assignments if a.operation_id == "OP1"
            )
            op2 = next(
                a for a in run.schedule.assignments if a.operation_id == "OP2"
            )
            assert op2.start >= op1.end

    def test_transfer_times_in_compare(self):
        uc = CompareStrategies(
            work_orders=InMemoryWorkOrderRepository([_simple_wo()]),
            machines=InMemoryMachineRepository(_machines()),
            calendars=InMemoryCalendarRepository([_calendar()]),
        )
        result = uc.execute(
            CompareStrategiesInput(
                strategies=["greedy"],
                horizon_start=MONDAY,
                transfer_times=TransferTimes(pairs={("M1", "M2"): 30}),
                parallel=False,
            )
        )
        assert result.best is not None
        assert result.best.succeeded

    def test_compare_auto_uses_baseline_metadata_as_decision_evidence(self):
        schedule_repo = InMemoryScheduleRepository()
        work_order = _simple_wo()
        initial = RunScheduling(
            work_orders=InMemoryWorkOrderRepository([work_order]),
            machines=InMemoryMachineRepository(_machines()),
            calendars=InMemoryCalendarRepository([_calendar()]),
            schedules=schedule_repo,
        ).execute(
            RunSchedulingInput(
                horizon_start=MONDAY,
                strategy="greedy",
                persist=True,
            )
        )
        uc = CompareStrategies(
            work_orders=InMemoryWorkOrderRepository([work_order]),
            machines=InMemoryMachineRepository(_machines()),
            calendars=InMemoryCalendarRepository([_calendar()]),
            schedules=schedule_repo,
        )

        result = uc.execute(
            CompareStrategiesInput(
                strategies=["auto"],
                horizon_start=MONDAY,
                baseline_schedule_id=initial.schedule.id,
                parallel=False,
            )
        )

        decision = result.runs[0].diagnostics["decision_layer"]
        assert decision["selected_strategy"] == "greedy"
        assert decision["evidence"]["baseline_schedule_present"] is True
        assert decision["evidence"]["makespan_minutes"] == initial.metrics["makespan_minutes"]


# --------------------------------------------------------------------------
# Priority 2+3: Resources/transfer_times in RunDisruption + persistence
# --------------------------------------------------------------------------


class TestRunDisruptionConnected:
    """RunDisruption loads resources, passes transfer_times, and persists."""

    def _run_initial(self, wo, schedule_repo):
        uc = RunScheduling(
            work_orders=InMemoryWorkOrderRepository([wo]),
            machines=InMemoryMachineRepository(_machines()),
            calendars=InMemoryCalendarRepository([_calendar()]),
            schedules=schedule_repo,
        )
        return uc.execute(
            RunSchedulingInput(
                horizon_start=MONDAY,
                strategy="greedy",
                persist=True,
            )
        )

    def test_disruption_persists_new_schedule(self):
        schedule_repo = InMemoryScheduleRepository()
        wo = _simple_wo()
        initial = self._run_initial(wo, schedule_repo)

        uc = RunDisruption(
            work_orders=InMemoryWorkOrderRepository([wo]),
            machines=InMemoryMachineRepository(_machines()),
            calendars=InMemoryCalendarRepository([_calendar()]),
            schedules=schedule_repo,
        )
        result = uc.execute(
            RunDisruptionInput(
                event=DisruptionEvent(
                    disruption_type=DisruptionType.RUSH_ORDER,
                    timestamp=NOW,
                    rush_order=WorkOrder(
                        id="RUSH",
                        name="RUSH",
                        product_id="PROD-RUSH",
                        quantity=1,
                        due_date=MONDAY + timedelta(days=2),
                        release_date=NOW,
                        priority=Priority.URGENT,
                        operations=[
                            Operation(
                                id="RUSH_OP",
                                work_order_id="RUSH",
                                sequence=1,
                                name="RUSH_OP",
                                duration=Duration(minutes=30),
                                eligible_machine_ids=["M1", "M2"],
                            ),
                        ],
                    ),
                ),
                schedule_id=initial.schedule.id,
                persist=True,
            )
        )
        # New schedule should be persisted.
        assert schedule_repo.get(result.schedule.id) is not None
        # Must be a different schedule from initial.
        assert result.schedule.id != initial.schedule.id
        # RUSH_OP should be in the output.
        op_ids = {a.operation_id for a in result.schedule.assignments}
        assert "RUSH_OP" in op_ids

    def test_auto_disruption_exposes_decision_layer(self):
        schedule_repo = InMemoryScheduleRepository()
        wo = _simple_wo()
        initial = self._run_initial(wo, schedule_repo)

        uc = RunDisruption(
            work_orders=InMemoryWorkOrderRepository([wo]),
            machines=InMemoryMachineRepository(_machines()),
            calendars=InMemoryCalendarRepository([_calendar()]),
            schedules=schedule_repo,
        )
        result = uc.execute(
            RunDisruptionInput(
                event=DisruptionEvent(
                    disruption_type=DisruptionType.MACHINE_DOWN,
                    timestamp=NOW,
                    machine_id="M1",
                    event_end=MONDAY + timedelta(days=1),
                ),
                schedule_id=initial.schedule.id,
                strategy="auto",
                reschedule_mode="reschedule_all",
                persist=False,
            )
        )

        decision = result.diagnostics["decision_layer"]
        planner = result.diagnostics["planner_diagnostics"]
        assert result.strategy == "greedy"
        assert result.reschedule_mode == "repair_local"
        assert decision["auto_selected"] is True
        assert decision["selected_strategy"] == "greedy"
        assert decision["selected_reschedule_mode"] == "repair_local"
        assert decision["engine_mode"] == "repair"
        assert decision["evidence"]["makespan_minutes"] == initial.metrics["makespan_minutes"]
        assert planner["decision_layer"] == decision

    def test_rush_order_in_metrics(self):
        """Metrics are computed including the rush order (bug fix)."""
        schedule_repo = InMemoryScheduleRepository()
        wo = _simple_wo()
        initial = self._run_initial(wo, schedule_repo)

        rush = WorkOrder(
            id="RUSH",
            name="RUSH",
            product_id="PROD-RUSH",
            quantity=1,
            due_date=MONDAY + timedelta(days=2),
            release_date=NOW,
            priority=Priority.URGENT,
            operations=[
                Operation(
                    id="RUSH_OP",
                    work_order_id="RUSH",
                    sequence=1,
                    name="RUSH_OP",
                    duration=Duration(minutes=30),
                    eligible_machine_ids=["M1", "M2"],
                ),
            ],
        )

        uc = RunDisruption(
            work_orders=InMemoryWorkOrderRepository([wo]),
            machines=InMemoryMachineRepository(_machines()),
            calendars=InMemoryCalendarRepository([_calendar()]),
            schedules=schedule_repo,
        )
        result = uc.execute(
            RunDisruptionInput(
                event=DisruptionEvent(
                    disruption_type=DisruptionType.RUSH_ORDER,
                    timestamp=NOW,
                    rush_order=rush,
                ),
                schedule_id=initial.schedule.id,
                persist=False,
            )
        )
        # Metrics should be computed including the rush order.
        assert result.metrics["makespan_minutes"] > 0
        # on_time_ratio should consider all 3 operations (2 + 1 rush).
        assert "on_time_ratio" in result.metrics
        report = result.diagnostics["stability_report"]
        assert report["available"] is True
        assert report["baseline_schedule_id"] == initial.schedule.id
        assert report["introduced_operation_count"] == 1
        assert "RUSH_OP" in {
            change["operation_id"] for change in report["operation_changes"]
        }

    def test_disruption_with_resources(self):
        """Resources are passed to the disruption handler."""
        schedule_repo = InMemoryScheduleRepository()
        wo = _wo_with_resources()

        # Initial schedule with resources.
        uc_init = RunScheduling(
            work_orders=InMemoryWorkOrderRepository([wo]),
            machines=InMemoryMachineRepository(_machines()),
            calendars=InMemoryCalendarRepository([_calendar()]),
            resources=InMemoryResourceRepository([_resource()]),
            schedules=schedule_repo,
        )
        initial = uc_init.execute(
            RunSchedulingInput(
                horizon_start=MONDAY,
                strategy="greedy",
                persist=True,
            )
        )

        # Disruption with resources injected.
        uc = RunDisruption(
            work_orders=InMemoryWorkOrderRepository([wo]),
            machines=InMemoryMachineRepository(_machines()),
            calendars=InMemoryCalendarRepository([_calendar()]),
            resources=InMemoryResourceRepository([_resource()]),
            schedules=schedule_repo,
        )
        result = uc.execute(
            RunDisruptionInput(
                event=DisruptionEvent(
                    disruption_type=DisruptionType.MACHINE_DOWN,
                    timestamp=NOW,
                    machine_id="M1",
                    event_end=NOW + timedelta(hours=4),
                ),
                schedule_id=initial.schedule.id,
                persist=False,
            )
        )
        assert result.solver_status == "feasible"
        assert len(result.schedule.assignments) == 2


# --------------------------------------------------------------------------
# Priority 4: Schedule metadata persistence
# --------------------------------------------------------------------------


class TestScheduleMetadataPersistence:
    """Strategy, solver_status, etc. are persisted and readable."""

    def test_metadata_persisted_with_schedule(self):
        schedule_repo = InMemoryScheduleRepository()
        uc = RunScheduling(
            work_orders=InMemoryWorkOrderRepository([_simple_wo()]),
            machines=InMemoryMachineRepository(_machines()),
            calendars=InMemoryCalendarRepository([_calendar()]),
            schedules=schedule_repo,
        )
        result = uc.execute(
            RunSchedulingInput(
                horizon_start=MONDAY,
                strategy="greedy",
                persist=True,
            )
        )

        # Check metadata is persisted.
        meta = schedule_repo.get_metadata(result.schedule.id)
        assert meta is not None
        assert meta.strategy == "greedy"
        assert meta.solver_status == "feasible"
        assert meta.objective_value >= 0
        assert meta.wall_time_ms >= 0
        assert isinstance(meta.diagnostics, dict)
        assert "makespan_minutes" in meta.metrics

    def test_run_audit_snapshot_and_hash_persisted(self):
        schedule_repo = InMemoryScheduleRepository()
        uc = RunScheduling(
            work_orders=InMemoryWorkOrderRepository([_simple_wo()]),
            machines=InMemoryMachineRepository(_machines()),
            calendars=InMemoryCalendarRepository([_calendar()]),
            schedules=schedule_repo,
        )
        result = uc.execute(
            RunSchedulingInput(
                horizon_start=MONDAY,
                horizon_days=5,
                strategy="greedy",
                persist=True,
                workspace_id="plant-qc",
                scenario_name="Audit replay",
                lifecycle_status="candidate",
            )
        )

        meta = schedule_repo.get_metadata(result.schedule.id)
        assert meta is not None
        assert meta.horizon_start == MONDAY
        assert meta.horizon_end == MONDAY + timedelta(days=5)
        assert meta.objective["total_tardiness"] == 10
        assert meta.input_snapshot_hash == result.input_snapshot_hash
        assert meta.input_snapshot["contract_version"] == "aps.canonical.v1"
        assert meta.input_snapshot["metadata"]["workspace_id"] == "plant-qc"
        assert result.diagnostics["input_snapshot_hash"] == meta.input_snapshot_hash

    def test_run_includes_unified_planner_exceptions(self):
        work_order = WorkOrder(
            id="WO-WARN",
            name="WO-WARN",
            product_id="P1",
            quantity=1,
            due_date=MONDAY + timedelta(hours=1),
            release_date=MONDAY,
            operations=[
                Operation(
                    id="OP-WARN",
                    work_order_id="WO-WARN",
                    sequence=1,
                    name="OP-WARN",
                    duration=Duration(minutes=120),
                    eligible_machine_ids=["M1"],
                )
            ],
        )
        uc = RunScheduling(
            work_orders=InMemoryWorkOrderRepository([work_order]),
            machines=InMemoryMachineRepository(_machines()),
            calendars=InMemoryCalendarRepository([_calendar()]),
        )

        result = uc.execute(
            RunSchedulingInput(
                horizon_start=MONDAY,
                horizon_days=5,
                strategy="greedy",
                persist=False,
            )
        )

        exceptions = result.diagnostics["planner_exceptions"]
        assert exceptions["status"] == "attention"
        assert exceptions["warning_count"] >= 1
        assert exceptions["dominant_kind"] in {
            "lateness",
            "unreachable_due_date",
        }
        assert any(
            item["kind"] == "unreachable_due_date"
            for item in exceptions["exceptions"]
        )
        assert (
            result.diagnostics["planner_diagnostics"]["exceptions"]
            == exceptions
        )

    def test_baseline_run_includes_stability_report(self):
        schedule_repo = InMemoryScheduleRepository()
        work_order = _simple_wo()
        uc = RunScheduling(
            work_orders=InMemoryWorkOrderRepository([work_order]),
            machines=InMemoryMachineRepository(_machines()),
            calendars=InMemoryCalendarRepository([_calendar()]),
            schedules=schedule_repo,
        )
        initial = uc.execute(
            RunSchedulingInput(
                horizon_start=MONDAY,
                strategy="greedy",
                persist=True,
            )
        )

        rerun = uc.execute(
            RunSchedulingInput(
                horizon_start=MONDAY,
                strategy="greedy",
                persist=False,
                baseline_schedule_id=initial.schedule.id,
                reschedule_mode="repair_local",
            )
        )

        report = rerun.diagnostics["stability_report"]
        assert report["available"] is True
        assert report["baseline_schedule_id"] == initial.schedule.id
        assert report["changed_operation_count"] == 0
        assert report["frozen_operation_count"] == 2
        assert report["status"] == "stable"
        assert (
            rerun.diagnostics["decision_layer"]["evidence"]["makespan_minutes"]
            == initial.metrics["makespan_minutes"]
        )
        assert any(
            "Stability report" in highlight
            for highlight in rerun.summary.highlights
        )

    def test_persisted_run_can_be_replayed_from_audited_snapshot(self):
        schedule_repo = InMemoryScheduleRepository()
        uc = RunScheduling(
            work_orders=InMemoryWorkOrderRepository([_simple_wo()]),
            machines=InMemoryMachineRepository(_machines()),
            calendars=InMemoryCalendarRepository([_calendar()]),
            schedules=schedule_repo,
        )
        result = uc.execute(
            RunSchedulingInput(
                horizon_start=MONDAY,
                horizon_days=5,
                strategy="greedy",
                persist=True,
            )
        )

        replay = ReplayScheduleRun(schedule_repo).execute(
            ReplayScheduleRunInput(schedule_id=result.schedule.id)
        )

        assert replay.input_snapshot_hash == result.input_snapshot_hash
        assert replay.replay_matches_original is True
        assert replay.hash_matches is True
        assert replay.strategy_matches is True
        assert replay.objective_matches is True
        assert replay.assignment_delta["changed_count"] == 0
        assert replay.metrics_delta == {}
        assert replay.divergence_reasons == []
        assert replay.replay_report["status"] == "matched"
        assert replay.replay.horizon_start == MONDAY

    def test_replay_strategy_override_reports_divergence_reason(self):
        schedule_repo = InMemoryScheduleRepository()
        uc = RunScheduling(
            work_orders=InMemoryWorkOrderRepository([_simple_wo()]),
            machines=InMemoryMachineRepository(_machines()),
            calendars=InMemoryCalendarRepository([_calendar()]),
            schedules=schedule_repo,
        )
        result = uc.execute(
            RunSchedulingInput(
                horizon_start=MONDAY,
                horizon_days=5,
                strategy="greedy",
                persist=True,
            )
        )

        replay = ReplayScheduleRun(schedule_repo).execute(
            ReplayScheduleRunInput(
                schedule_id=result.schedule.id,
                strategy="backward",
            )
        )

        assert replay.replay_matches_original is False
        assert replay.strategy_matches is False
        assert "strategy_override" in replay.divergence_reasons
        assert replay.replay_report["original_strategy"] == "greedy"
        assert replay.replay_report["replay_strategy"] == "backward"

    def test_list_recent_returns_metadata(self):
        schedule_repo = InMemoryScheduleRepository()
        uc = RunScheduling(
            work_orders=InMemoryWorkOrderRepository([_simple_wo()]),
            machines=InMemoryMachineRepository(_machines()),
            calendars=InMemoryCalendarRepository([_calendar()]),
            schedules=schedule_repo,
        )
        uc.execute(
            RunSchedulingInput(
                horizon_start=MONDAY,
                strategy="greedy",
                persist=True,
            )
        )

        list_uc = ListSchedules(schedule_repo)
        runs = list_uc.execute(limit=10)
        assert len(runs) == 1
        schedule, meta = runs[0]
        assert meta.strategy == "greedy"
        assert meta.solver_status == "feasible"
        assert "makespan_minutes" in meta.metrics

    def test_dashboard_includes_strategy_info(self):
        schedule_repo = InMemoryScheduleRepository()
        work_orders = [_simple_wo()]
        uc = RunScheduling(
            work_orders=InMemoryWorkOrderRepository(work_orders),
            machines=InMemoryMachineRepository(_machines()),
            calendars=InMemoryCalendarRepository([_calendar()]),
            schedules=schedule_repo,
        )
        result = uc.execute(
            RunSchedulingInput(
                horizon_start=MONDAY,
                strategy="greedy",
                persist=True,
            )
        )

        dashboard_uc = GetScheduleDashboard(
            schedules=schedule_repo,
            work_orders=InMemoryWorkOrderRepository(work_orders),
        )
        dashboard = dashboard_uc.execute(result.schedule.id)
        assert dashboard.strategy == "greedy"
        assert dashboard.solver_status == "feasible"
        assert dashboard.objective_value >= 0

    def test_disruption_schedule_metadata_persisted(self):
        schedule_repo = InMemoryScheduleRepository()
        wo = _simple_wo()

        # Initial run.
        uc_init = RunScheduling(
            work_orders=InMemoryWorkOrderRepository([wo]),
            machines=InMemoryMachineRepository(_machines()),
            calendars=InMemoryCalendarRepository([_calendar()]),
            schedules=schedule_repo,
        )
        initial = uc_init.execute(
            RunSchedulingInput(
                horizon_start=MONDAY,
                strategy="greedy",
                persist=True,
            )
        )

        # Disruption.
        uc = RunDisruption(
            work_orders=InMemoryWorkOrderRepository([wo]),
            machines=InMemoryMachineRepository(_machines()),
            calendars=InMemoryCalendarRepository([_calendar()]),
            schedules=schedule_repo,
        )
        result = uc.execute(
            RunDisruptionInput(
                event=DisruptionEvent(
                    disruption_type=DisruptionType.MACHINE_DOWN,
                    timestamp=NOW,
                    machine_id="M1",
                    event_end=NOW + timedelta(hours=4),
                ),
                schedule_id=initial.schedule.id,
                persist=True,
            )
        )

        # Disruption schedule should also have metadata.
        meta = schedule_repo.get_metadata(result.schedule.id)
        assert meta is not None
        assert meta.strategy == "greedy"
        assert meta.solver_status == "feasible"


# --------------------------------------------------------------------------
# Priority 5: Lot sizing and routing alternatives flow
# --------------------------------------------------------------------------


class TestLotSizingAndRoutingsFlow:
    """Lot sizing policy is used when present in domain entities."""

    def test_lot_sizing_splits_work_order(self):
        """A work order with fixed lot sizing is split by the engine."""
        wo = WorkOrder(
            id="WO-LOT",
            name="WO-LOT",
            product_id="P1",
            quantity=200,
            due_date=MONDAY + timedelta(days=5),
            release_date=MONDAY,
            operations=[
                Operation(
                    id="OP1",
                    work_order_id="WO-LOT",
                    sequence=1,
                    name="OP1",
                    duration=Duration(minutes=60),
                    eligible_machine_ids=["M1", "M2"],
                ),
            ],
            lot_sizing=LotSizingPolicy.fixed(100),
        )
        uc = RunScheduling(
            work_orders=InMemoryWorkOrderRepository([wo]),
            machines=InMemoryMachineRepository(_machines()),
            calendars=InMemoryCalendarRepository([_calendar()]),
        )
        result = uc.execute(
            RunSchedulingInput(
                horizon_start=MONDAY,
                strategy="greedy",
                persist=False,
            )
        )
        # Lot splitting produces 2 sub-lots for 200 / 100.
        # After reassembly, assignments refer back to the parent WO.
        wo_ids = {a.work_order_id for a in result.schedule.assignments}
        assert "WO-LOT" in wo_ids
        # Two operations scheduled (one per sub-lot).
        assert len(result.schedule.assignments) == 2

    def test_routing_alternatives_used(self):
        """Operations with routing alternatives select the best option."""
        wo = WorkOrder(
            id="WO-ALT",
            name="WO-ALT",
            product_id="P1",
            quantity=1,
            due_date=MONDAY + timedelta(days=3),
            release_date=MONDAY,
            operations=[
                Operation(
                    id="OP1",
                    work_order_id="WO-ALT",
                    sequence=1,
                    name="OP1",
                    duration=Duration(minutes=60),
                    eligible_machine_ids=["M1", "M2"],
                    routings=[
                        RoutingAlternative(
                            machine_id="M1",
                            duration=Duration(minutes=30),  # faster on M1
                        ),
                        RoutingAlternative(
                            machine_id="M2",
                            duration=Duration(minutes=90),  # slower on M2
                        ),
                    ],
                ),
            ],
        )
        uc = RunScheduling(
            work_orders=InMemoryWorkOrderRepository([wo]),
            machines=InMemoryMachineRepository(_machines()),
            calendars=InMemoryCalendarRepository([_calendar()]),
        )
        result = uc.execute(
            RunSchedulingInput(
                horizon_start=MONDAY,
                strategy="greedy",
                persist=False,
            )
        )
        assert len(result.schedule.assignments) == 1
        # Greedy should pick M1 (faster).
        assert result.schedule.assignments[0].machine_id == "M1"
