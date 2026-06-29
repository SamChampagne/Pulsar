from __future__ import annotations

from datetime import datetime, timedelta

import pytest

from planiadvance_v2.application.use_cases.planner_actions import (
    PlannerAction,
    apply_planner_actions,
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
    ScheduledOperation,
    SupplyLot,
    WorkOrder,
)
from planiadvance_v2.domain.entities.resource import ResourceRequirement
from planiadvance_v2.domain.errors import ValidationError
from planiadvance_v2.domain.value_objects import Duration, Priority, TimeWindow
from planiadvance_v2.infrastructure.in_memory.repositories import (
    InMemoryCalendarRepository,
    InMemoryInventoryRepository,
    InMemoryMachineRepository,
    InMemoryResourceRepository,
    InMemoryScheduleRepository,
    InMemorySupplyRepository,
    InMemoryWorkOrderRepository,
)
from tests.conftest import make_work_order


def test_planner_actions_modify_copied_work_orders(horizon_start):
    work_order = make_work_order(
        "WO-ACTION",
        release=horizon_start,
        due=horizon_start + timedelta(days=3),
        ops=[("OP-ACTION", 60, ["M1", "M2"], 0)],
    )

    result = apply_planner_actions(
        work_orders=[work_order],
        actions=[
            PlannerAction(
                action_type="force_machine",
                operation_id="OP-ACTION",
                machine_id="M2",
            ),
            PlannerAction(
                action_type="change_priority",
                work_order_id="WO-ACTION",
                priority="urgent",
            ),
            PlannerAction(
                action_type="override_due_date",
                work_order_id="WO-ACTION",
                due_date=horizon_start + timedelta(days=2),
            ),
        ],
    )

    changed = result.work_orders[0]
    assert result.applied_count == 3
    assert result.ignored_count == 0
    assert changed.priority == Priority.URGENT
    assert changed.due_date == horizon_start + timedelta(days=2)
    assert changed.operations[0].eligible_machine_ids == ["M2"]
    assert work_order.priority == Priority.NORMAL
    assert work_order.operations[0].eligible_machine_ids == ["M1", "M2"]
    diagnostics = result.as_diagnostics()
    impact_report = diagnostics["impact_report"]
    assert impact_report["impact_count"] == 3
    assert [
        item["impact"]["change_type"] for item in impact_report["items"]
    ] == [
        "machine_forced",
        "priority_changed",
        "due_date_overridden",
    ]
    force_impact = impact_report["items"][0]["impact"]
    assert force_impact["from_eligible_machine_ids"] == ["M1", "M2"]
    assert force_impact["to_eligible_machine_ids"] == ["M2"]


def test_pin_operation_window_validates_calendar_and_maintenance(
    horizon_start,
    standard_calendar,
):
    work_order = make_work_order(
        "WO-PIN-CAL",
        release=horizon_start,
        due=horizon_start + timedelta(days=1),
        ops=[("OP-PIN-CAL", 60, ["M1"], 0)],
    )
    machine = Machine(
        id="M1",
        name="Machine 1",
        calendar_id=standard_calendar.id,
        maintenance_windows=[
            TimeWindow(
                start=horizon_start + timedelta(hours=9),
                end=horizon_start + timedelta(hours=10),
            )
        ],
    )

    result = apply_planner_actions(
        work_orders=[work_order],
        machines=[machine],
        calendars=[standard_calendar],
        actions=[
            PlannerAction(
                action_type="pin_operation_window",
                operation_id="OP-PIN-CAL",
                machine_id="M1",
                start=horizon_start + timedelta(hours=8, minutes=30),
                end=horizon_start + timedelta(hours=9, minutes=30),
            )
        ],
    )

    assert result.applied_count == 0
    assert result.ignored_count == 1
    assert result.frozen_assignments == []
    assert "effective working window" in result.applications[0].message


def test_planner_actions_can_exclude_work_order(horizon_start):
    keep = make_work_order(
        "WO-KEEP",
        release=horizon_start,
        due=horizon_start + timedelta(days=3),
        ops=[("OP-KEEP", 60, ["M1"], 0)],
    )
    drop = make_work_order(
        "WO-DROP",
        release=horizon_start,
        due=horizon_start + timedelta(days=3),
        ops=[("OP-DROP", 60, ["M1"], 0)],
    )

    result = apply_planner_actions(
        work_orders=[keep, drop],
        actions=[
            PlannerAction(action_type="exclude_work_order", work_order_id="WO-DROP")
        ],
    )

    assert [work_order.id for work_order in result.work_orders] == ["WO-KEEP"]
    assert result.applied_count == 1
    impact = result.impact_report()["items"][0]["impact"]
    assert impact["change_type"] == "work_order_excluded"
    assert impact["operation_count_removed"] == 1
    assert impact["removed_operation_ids"] == ["OP-DROP"]


def test_planner_actions_can_move_operation_to_standby(horizon_start):
    work_order = make_work_order(
        "WO-STANDBY",
        release=horizon_start,
        due=horizon_start + timedelta(days=3),
        ops=[
            ("OP-KEEP", 60, ["M1"], 0),
            ("OP-STANDBY", 45, ["M1"], 0),
        ],
    )

    result = apply_planner_actions(
        work_orders=[work_order],
        actions=[
            PlannerAction(
                action_type="standby_operation",
                operation_id="OP-STANDBY",
            )
        ],
    )

    assert result.applied_count == 1
    assert [operation.id for operation in result.work_orders[0].operations] == [
        "OP-KEEP"
    ]
    assert [operation.id for operation in work_order.operations] == [
        "OP-KEEP",
        "OP-STANDBY",
    ]
    impact = result.impact_report()["items"][0]["impact"]
    assert impact["change_type"] == "operation_standby"
    assert impact["operation_id"] == "OP-STANDBY"
    assert impact["work_order_id"] == "WO-STANDBY"


def test_planner_actions_block_standby_when_downstream_depends_on_operation(horizon_start):
    work_order = make_work_order(
        "WO-STANDBY-CHAIN",
        release=horizon_start,
        due=horizon_start + timedelta(days=3),
        ops=[
            ("OP-UPSTREAM", 60, ["M1"], 0),
            ("OP-DOWNSTREAM", 45, ["M1"], 0),
        ],
    )

    result = apply_planner_actions(
        work_orders=[work_order],
        actions=[
            PlannerAction(
                action_type="standby_operation",
                operation_id="OP-UPSTREAM",
            )
        ],
    )

    assert result.applied_count == 0
    assert result.ignored_count == 1
    assert [operation.id for operation in result.work_orders[0].operations] == [
        "OP-UPSTREAM",
        "OP-DOWNSTREAM",
    ]
    assert "downstream operations still depend on it" in result.applications[0].message


def test_planner_actions_can_reinsert_standby_operation(horizon_start):
    work_order = make_work_order(
        "WO-REINSERT",
        release=horizon_start,
        due=horizon_start + timedelta(days=3),
        ops=[
            ("OP-KEEP", 60, ["M1"], 0),
            ("OP-REINSERT", 45, ["M1"], 0),
        ],
    )

    result = apply_planner_actions(
        work_orders=[work_order],
        actions=[
            PlannerAction(
                action_type="standby_operation",
                operation_id="OP-REINSERT",
            ),
            PlannerAction(
                action_type="reinsert_standby_operation",
                operation_id="OP-REINSERT",
            ),
        ],
    )

    assert result.applied_count == 2
    assert [operation.id for operation in result.work_orders[0].operations] == [
        "OP-KEEP",
        "OP-REINSERT",
    ]
    diagnostics = result.as_diagnostics()
    assert diagnostics["standby_operation_ids"] == ["OP-REINSERT"]
    assert diagnostics["reinserted_operation_ids"] == ["OP-REINSERT"]
    impacts = [
        item["impact"]["change_type"]
        for item in diagnostics["impact_report"]["items"]
    ]
    assert impacts == [
        "operation_standby",
        "operation_reinserted_from_standby",
    ]


def test_planner_actions_add_overtime_clones_machine_calendar(
    horizon_start,
    standard_calendar,
    two_machines,
):
    work_order = make_work_order(
        "WO-OT",
        release=horizon_start,
        due=horizon_start + timedelta(days=1),
        ops=[("OP-OT", 60, ["M1"], 0)],
    )

    result = apply_planner_actions(
        work_orders=[work_order],
        machines=two_machines,
        calendars=[standard_calendar],
        actions=[
            PlannerAction(
                action_type="add_overtime",
                machine_id="M1",
                start=horizon_start + timedelta(hours=17),
                end=horizon_start + timedelta(hours=20),
            )
        ],
    )

    m1 = next(machine for machine in result.machines if machine.id == "M1")
    m2 = next(machine for machine in result.machines if machine.id == "M2")
    cloned_calendar = next(
        calendar for calendar in result.calendars if calendar.id == m1.calendar_id
    )
    original_calendar = next(
        calendar for calendar in result.calendars if calendar.id == standard_calendar.id
    )

    assert result.applied_count == 1
    assert m1.calendar_id != standard_calendar.id
    assert m2.calendar_id == standard_calendar.id
    assert len(cloned_calendar.extra_windows) == 1
    assert original_calendar.extra_windows == []
    impact = result.impact_report()["items"][0]["impact"]
    assert impact["change_type"] == "machine_overtime_added"
    assert impact["calendar_cloned"] is True
    assert impact["base_calendar_id"] == standard_calendar.id
    assert impact["effective_calendar_id"] == m1.calendar_id
    assert impact["unaffected_machine_ids"] == ["M2"]


def test_run_scheduling_force_machine_action(
    horizon_start,
    standard_calendar,
    two_machines,
):
    work_order = make_work_order(
        "WO-FORCE",
        release=horizon_start,
        due=horizon_start + timedelta(days=3),
        ops=[("OP-FORCE", 60, ["M1", "M2"], 0)],
    )
    use_case = RunScheduling(
        work_orders=InMemoryWorkOrderRepository([work_order]),
        machines=InMemoryMachineRepository(two_machines),
        calendars=InMemoryCalendarRepository([standard_calendar]),
    )

    result = use_case.execute(
        RunSchedulingInput(
            horizon_start=horizon_start,
            horizon_days=3,
            persist=False,
            planner_actions=[
                PlannerAction(
                    action_type="force_machine",
                    operation_id="OP-FORCE",
                    machine_id="M2",
                )
            ],
        )
    )

    assignment = result.schedule.assignments[0]
    assert assignment.machine_id == "M2"
    assert result.diagnostics["planner_actions"]["applied_count"] == 1
    assert (
        result.diagnostics["planner_diagnostics"]["planner_actions"]
        == result.diagnostics["planner_actions"]
    )
    impact_report = result.diagnostics["planner_actions"]["impact_report"]
    assert impact_report["impact_count"] == 1
    assert impact_report["items"][0]["impact"]["change_type"] == "machine_forced"


def test_run_scheduling_freeze_operation_action(
    horizon_start,
    standard_calendar,
    two_machines,
):
    work_order = make_work_order(
        "WO-FREEZE",
        release=horizon_start,
        due=horizon_start + timedelta(days=3),
        ops=[("OP-FREEZE", 60, ["M1", "M2"], 0)],
    )
    frozen_assignment = ScheduledOperation(
        operation_id="OP-FREEZE",
        work_order_id="WO-FREEZE",
        machine_id="M2",
        setup_start=horizon_start + timedelta(hours=11),
        start=horizon_start + timedelta(hours=11),
        end=horizon_start + timedelta(hours=12),
    )
    baseline = Schedule(
        id="baseline-freeze",
        created_at=datetime(2026, 1, 5, 0, 0),
        assignments=[frozen_assignment],
    )
    schedules = InMemoryScheduleRepository()
    schedules.save(baseline, metrics={}, organization_id=None)
    use_case = RunScheduling(
        work_orders=InMemoryWorkOrderRepository([work_order]),
        machines=InMemoryMachineRepository(two_machines),
        calendars=InMemoryCalendarRepository([standard_calendar]),
        schedules=schedules,
    )

    result = use_case.execute(
        RunSchedulingInput(
            horizon_start=horizon_start,
            horizon_days=3,
            baseline_schedule_id="baseline-freeze",
            reschedule_mode="reschedule_all",
            persist=False,
            planner_actions=[
                PlannerAction(
                    action_type="freeze_operation",
                    operation_id="OP-FREEZE",
                )
            ],
        )
    )

    assignment = result.schedule.assignments[0]
    assert assignment.machine_id == "M2"
    assert assignment.start == frozen_assignment.start
    assert assignment.end == frozen_assignment.end
    assert result.diagnostics["planner_actions"]["frozen_count"] == 1
    impact = result.diagnostics["planner_actions"]["impact_report"]["items"][0]["impact"]
    assert impact["change_type"] == "operation_frozen"
    assert impact["machine_id"] == "M2"
    assert impact["start"] == frozen_assignment.start.isoformat()


def test_run_scheduling_unfreeze_operation_releases_repair_lock(
    horizon_start,
    standard_calendar,
    two_machines,
):
    work_order = make_work_order(
        "WO-UNFREEZE",
        release=horizon_start,
        due=horizon_start + timedelta(days=3),
        ops=[("OP-UNFREEZE", 60, ["M1"], 0)],
    )
    baseline = Schedule(
        id="baseline-unfreeze",
        created_at=datetime(2026, 1, 5, 0, 0),
        assignments=[
            ScheduledOperation(
                operation_id="OP-UNFREEZE",
                work_order_id="WO-UNFREEZE",
                machine_id="M1",
                setup_start=horizon_start + timedelta(hours=11),
                start=horizon_start + timedelta(hours=11),
                end=horizon_start + timedelta(hours=12),
            )
        ],
    )
    schedules = InMemoryScheduleRepository()
    schedules.save(baseline, metrics={}, organization_id=None)
    use_case = RunScheduling(
        work_orders=InMemoryWorkOrderRepository([work_order]),
        machines=InMemoryMachineRepository(two_machines),
        calendars=InMemoryCalendarRepository([standard_calendar]),
        schedules=schedules,
    )

    result = use_case.execute(
        RunSchedulingInput(
            horizon_start=horizon_start,
            horizon_days=3,
            baseline_schedule_id="baseline-unfreeze",
            reschedule_mode="repair_local",
            persist=False,
            planner_actions=[
                PlannerAction(
                    action_type="unfreeze_operation",
                    operation_id="OP-UNFREEZE",
                )
            ],
        )
    )

    assignment = result.schedule.assignments[0]
    assert assignment.start == horizon_start + timedelta(hours=8)
    assert result.diagnostics["planner_actions"]["applied_count"] == 1
    assert result.diagnostics["planner_actions"]["frozen_count"] == 0
    impact = result.diagnostics["planner_actions"]["impact_report"]["items"][0]["impact"]
    assert impact["change_type"] == "operation_unfrozen"


def test_run_scheduling_exposes_repair_scope_and_decision_log(
    horizon_start,
    standard_calendar,
    two_machines,
):
    work_order = make_work_order(
        "WO-REPAIR-SCOPE",
        release=horizon_start,
        due=horizon_start + timedelta(days=3),
        ops=[
            ("REPAIR-A", 60, ["M1", "M2"], 0),
            ("REPAIR-B", 60, ["M1"], 0),
        ],
    )
    baseline = Schedule(
        id="baseline-repair-scope",
        created_at=datetime(2026, 1, 5, 0, 0),
        assignments=[
            ScheduledOperation(
                operation_id="REPAIR-A",
                work_order_id="WO-REPAIR-SCOPE",
                machine_id="M1",
                setup_start=horizon_start + timedelta(hours=8),
                start=horizon_start + timedelta(hours=8),
                end=horizon_start + timedelta(hours=9),
            ),
            ScheduledOperation(
                operation_id="REPAIR-B",
                work_order_id="WO-REPAIR-SCOPE",
                machine_id="M1",
                setup_start=horizon_start + timedelta(hours=9),
                start=horizon_start + timedelta(hours=9),
                end=horizon_start + timedelta(hours=10),
            ),
        ],
    )
    schedules = InMemoryScheduleRepository()
    schedules.save(baseline, metrics={}, organization_id=None)
    use_case = RunScheduling(
        work_orders=InMemoryWorkOrderRepository([work_order]),
        machines=InMemoryMachineRepository(two_machines),
        calendars=InMemoryCalendarRepository([standard_calendar]),
        schedules=schedules,
    )

    result = use_case.execute(
        RunSchedulingInput(
            horizon_start=horizon_start,
            horizon_days=3,
            baseline_schedule_id="baseline-repair-scope",
            reschedule_mode="repair_local",
            persist=False,
            planner_actions=[
                PlannerAction(
                    action_type="pin_operation_window",
                    operation_id="REPAIR-A",
                    machine_id="M2",
                    start=horizon_start + timedelta(hours=10),
                    end=horizon_start + timedelta(hours=11),
                )
            ],
        )
    )

    repair_scope = result.diagnostics["repair_scope"]
    assert repair_scope["version"] == "repair-scope-v1"
    assert repair_scope["repair_strategy"] == "targeted_repair"
    assert repair_scope["direct_operation_ids"] == ["REPAIR-A"]
    assert repair_scope["downstream_operation_ids"] == ["REPAIR-B"]
    assert repair_scope["impacted_operation_ids"] == ["REPAIR-A", "REPAIR-B"]
    assert repair_scope["blocking_operation_ids"] == []
    assert [item["kind"] for item in repair_scope["recommended_actions"]] == [
        "downstream_dependency"
    ]
    assert result.diagnostics["stability_report"]["operation_changes"][0][
        "is_impacted"
    ] is True

    decision_log = result.diagnostics["planner_decisions"]
    assert decision_log["version"] == "planner-decisions-v1"
    assert decision_log["record_count"] == 1
    assert decision_log["records"][0]["decision_version"] == 1
    assert decision_log["records"][0]["decision_id"]
    assert (
        result.diagnostics["planner_diagnostics"]["repair_scope"]
        == result.diagnostics["repair_scope"]
    )


def test_run_scheduling_reinsert_standby_operation_is_replayable(
    horizon_start,
    standard_calendar,
    two_machines,
):
    work_order = make_work_order(
        "WO-REPLAY-STANDBY",
        release=horizon_start,
        due=horizon_start + timedelta(days=3),
        ops=[
            ("REPLAY-A", 60, ["M1"], 0),
            ("REPLAY-B", 45, ["M1"], 0),
        ],
    )
    use_case = RunScheduling(
        work_orders=InMemoryWorkOrderRepository([work_order]),
        machines=InMemoryMachineRepository(two_machines),
        calendars=InMemoryCalendarRepository([standard_calendar]),
    )

    result = use_case.execute(
        RunSchedulingInput(
            horizon_start=horizon_start,
            horizon_days=3,
            persist=False,
            planner_actions=[
                PlannerAction(
                    action_type="standby_operation",
                    operation_id="REPLAY-B",
                ),
                PlannerAction(
                    action_type="reinsert_standby_operation",
                    operation_id="REPLAY-B",
                ),
            ],
        )
    )

    assert [assignment.operation_id for assignment in result.schedule.assignments] == [
        "REPLAY-A",
        "REPLAY-B",
    ]
    diagnostics = result.diagnostics["planner_actions"]
    assert diagnostics["standby_operation_ids"] == ["REPLAY-B"]
    assert diagnostics["reinserted_operation_ids"] == ["REPLAY-B"]
    assert result.diagnostics["repair_scope"]["direct_operation_ids"] == [
        "REPLAY-B"
    ]
    assert result.diagnostics["planner_decisions"]["record_count"] == 2


def test_run_scheduling_rejects_pin_that_violates_frozen_predecessor(
    horizon_start,
    standard_calendar,
    two_machines,
):
    work_order = make_work_order(
        "WO-PIN-DEP",
        release=horizon_start,
        due=horizon_start + timedelta(days=2),
        ops=[
            ("PIN-DEP-A", 60, ["M1"], 0),
            ("PIN-DEP-B", 60, ["M2"], 0),
        ],
    )
    baseline = Schedule(
        id="baseline-pin-dep",
        created_at=datetime(2026, 1, 5, 0, 0),
        assignments=[
            ScheduledOperation(
                operation_id="PIN-DEP-A",
                work_order_id="WO-PIN-DEP",
                machine_id="M1",
                setup_start=horizon_start + timedelta(hours=8),
                start=horizon_start + timedelta(hours=8),
                end=horizon_start + timedelta(hours=9),
            ),
            ScheduledOperation(
                operation_id="PIN-DEP-B",
                work_order_id="WO-PIN-DEP",
                machine_id="M2",
                setup_start=horizon_start + timedelta(hours=9),
                start=horizon_start + timedelta(hours=9),
                end=horizon_start + timedelta(hours=10),
            ),
        ],
    )
    schedules = InMemoryScheduleRepository()
    schedules.save(baseline, metrics={}, organization_id=None)
    use_case = RunScheduling(
        work_orders=InMemoryWorkOrderRepository([work_order]),
        machines=InMemoryMachineRepository(two_machines),
        calendars=InMemoryCalendarRepository([standard_calendar]),
        schedules=schedules,
    )

    with pytest.raises(ValidationError, match="violates dependency"):
        use_case.execute(
            RunSchedulingInput(
                horizon_start=horizon_start,
                horizon_days=3,
                baseline_schedule_id="baseline-pin-dep",
                reschedule_mode="repair_local",
                persist=False,
                planner_actions=[
                    PlannerAction(
                        action_type="pin_operation_window",
                        operation_id="PIN-DEP-B",
                        machine_id="M2",
                        start=horizon_start + timedelta(hours=8, minutes=30),
                        end=horizon_start + timedelta(hours=9, minutes=30),
                    )
                ],
            )
        )


def test_run_scheduling_rejects_pin_that_overbooks_secondary_resource(
    horizon_start,
    standard_calendar,
    two_machines,
):
    tool = Resource(id="TOOL-1", name="Shared tool", capacity=1)
    work_orders = [
        WorkOrder(
            id="WO-PIN-RES-A",
            name="WO-PIN-RES-A",
            product_id="P-PIN",
            quantity=1,
            due_date=horizon_start + timedelta(days=2),
            release_date=horizon_start,
            operations=[
                Operation(
                    id="PIN-RES-A",
                    work_order_id="WO-PIN-RES-A",
                    sequence=1,
                    name="PIN-RES-A",
                    duration=Duration(minutes=60),
                    eligible_machine_ids=["M1"],
                    resource_requirements=[
                        ResourceRequirement(resource_id="TOOL-1", units=1)
                    ],
                )
            ],
        ),
        WorkOrder(
            id="WO-PIN-RES-B",
            name="WO-PIN-RES-B",
            product_id="P-PIN",
            quantity=1,
            due_date=horizon_start + timedelta(days=2),
            release_date=horizon_start,
            operations=[
                Operation(
                    id="PIN-RES-B",
                    work_order_id="WO-PIN-RES-B",
                    sequence=1,
                    name="PIN-RES-B",
                    duration=Duration(minutes=60),
                    eligible_machine_ids=["M2"],
                    resource_requirements=[
                        ResourceRequirement(resource_id="TOOL-1", units=1)
                    ],
                )
            ],
        ),
    ]
    baseline = Schedule(
        id="baseline-pin-resource",
        created_at=datetime(2026, 1, 5, 0, 0),
        assignments=[
            ScheduledOperation(
                operation_id="PIN-RES-A",
                work_order_id="WO-PIN-RES-A",
                machine_id="M1",
                setup_start=horizon_start + timedelta(hours=8),
                start=horizon_start + timedelta(hours=8),
                end=horizon_start + timedelta(hours=9),
            ),
            ScheduledOperation(
                operation_id="PIN-RES-B",
                work_order_id="WO-PIN-RES-B",
                machine_id="M2",
                setup_start=horizon_start + timedelta(hours=9),
                start=horizon_start + timedelta(hours=9),
                end=horizon_start + timedelta(hours=10),
            ),
        ],
    )
    schedules = InMemoryScheduleRepository()
    schedules.save(baseline, metrics={}, organization_id=None)
    use_case = RunScheduling(
        work_orders=InMemoryWorkOrderRepository(work_orders),
        machines=InMemoryMachineRepository(two_machines),
        calendars=InMemoryCalendarRepository([standard_calendar]),
        resources=InMemoryResourceRepository([tool]),
        schedules=schedules,
    )

    with pytest.raises(ValidationError, match="secondary resource") as exc:
        use_case.execute(
            RunSchedulingInput(
                horizon_start=horizon_start,
                horizon_days=3,
                baseline_schedule_id="baseline-pin-resource",
                reschedule_mode="repair_local",
                persist=False,
                planner_actions=[
                    PlannerAction(
                        action_type="pin_operation_window",
                        operation_id="PIN-RES-B",
                        machine_id="M2",
                        start=horizon_start + timedelta(hours=8),
                        end=horizon_start + timedelta(hours=9),
                    )
                ],
            )
        )
    assert "Suggested action: move_or_delay_pin" in str(exc.value)
    assert "Candidate actions: move_operation, pin_operation_window, add_overtime" in str(
        exc.value
    )


def test_run_scheduling_rejects_pin_before_material_is_available(
    horizon_start,
    standard_calendar,
    two_machines,
):
    material_id = "RAW-PIN"
    work_orders = [
        WorkOrder(
            id="WO-PIN-MAT-A",
            name="WO-PIN-MAT-A",
            product_id="P-PIN",
            quantity=1,
            due_date=horizon_start + timedelta(days=2),
            release_date=horizon_start,
            operations=[
                Operation(
                    id="PIN-MAT-A",
                    work_order_id="WO-PIN-MAT-A",
                    sequence=1,
                    name="PIN-MAT-A",
                    duration=Duration(minutes=60),
                    eligible_machine_ids=["M1"],
                    material_requirements=[
                        MaterialRequirement(material_id=material_id, fixed_quantity=1)
                    ],
                )
            ],
        ),
        WorkOrder(
            id="WO-PIN-MAT-B",
            name="WO-PIN-MAT-B",
            product_id="P-PIN",
            quantity=1,
            due_date=horizon_start + timedelta(days=2),
            release_date=horizon_start + timedelta(hours=10),
            operations=[
                Operation(
                    id="PIN-MAT-B",
                    work_order_id="WO-PIN-MAT-B",
                    sequence=1,
                    name="PIN-MAT-B",
                    duration=Duration(minutes=60),
                    eligible_machine_ids=["M2"],
                    material_requirements=[
                        MaterialRequirement(material_id=material_id, fixed_quantity=1)
                    ],
                )
            ],
        ),
    ]
    baseline = Schedule(
        id="baseline-pin-material",
        created_at=datetime(2026, 1, 5, 0, 0),
        assignments=[
            ScheduledOperation(
                operation_id="PIN-MAT-A",
                work_order_id="WO-PIN-MAT-A",
                machine_id="M1",
                setup_start=horizon_start + timedelta(hours=8),
                start=horizon_start + timedelta(hours=8),
                end=horizon_start + timedelta(hours=9),
            ),
            ScheduledOperation(
                operation_id="PIN-MAT-B",
                work_order_id="WO-PIN-MAT-B",
                machine_id="M2",
                setup_start=horizon_start + timedelta(hours=10),
                start=horizon_start + timedelta(hours=10),
                end=horizon_start + timedelta(hours=11),
            ),
        ],
    )
    schedules = InMemoryScheduleRepository()
    schedules.save(baseline, metrics={}, organization_id=None)
    use_case = RunScheduling(
        work_orders=InMemoryWorkOrderRepository(work_orders),
        machines=InMemoryMachineRepository(two_machines),
        calendars=InMemoryCalendarRepository([standard_calendar]),
        inventory=InMemoryInventoryRepository(
            [
                InventoryItem(
                    material_id=material_id,
                    quantity_on_hand=1,
                    as_of=horizon_start,
                )
            ]
        ),
        supplies=InMemorySupplyRepository(
            [
                SupplyLot(
                    id="SUP-PIN-MAT",
                    material_id=material_id,
                    quantity=1,
                    available_at=horizon_start + timedelta(hours=10),
                )
            ]
        ),
        schedules=schedules,
    )

    with pytest.raises(ValidationError, match="requires material") as exc:
        use_case.execute(
            RunSchedulingInput(
                horizon_start=horizon_start,
                horizon_days=3,
                baseline_schedule_id="baseline-pin-material",
                reschedule_mode="repair_local",
                persist=False,
                planner_actions=[
                    PlannerAction(
                        action_type="pin_operation_window",
                        operation_id="PIN-MAT-B",
                        machine_id="M2",
                        start=horizon_start + timedelta(hours=8),
                        end=horizon_start + timedelta(hours=9),
                    )
                ],
            )
        )
    assert "Suggested action: delay_until_material_ready" in str(exc.value)
    assert "Candidate actions: move_operation, pin_operation_window, add_supply" in str(
        exc.value
    )


def test_run_scheduling_pin_skips_material_check_for_non_pinned_baseline_ops(
    horizon_start,
    standard_calendar,
    two_machines,
):
    """A pinned op must validate its own material strictly, but a
    NON-pinned baseline op whose material has drifted in time (typical
    when the schedule was generated days/months ago and SupplyLot
    available_at has shifted forward since) must NOT cause the pin to
    fail.

    Reproduces the bug Sam hit on the industrial seed: schedule from
    2026-01-05, supply lots anchored on today (2026-05-07). Re-pinning
    any op refused because GAMMA-CUT (baseline op) couldn't get its
    RAW-AL by its baseline start, even though GAMMA-CUT had already
    reserved that material in the baseline run.
    """
    material_id = "RAW-DRIFT"
    # OP-X consumes inventory at h0 (its WO releases at h0).
    # OP-A consumes the same material at h8 baseline-time, but its WO
    # releases at h13 — so the pre-feasibility check (which uses
    # demand_at = max(horizon_start, wo.release_date)) sees the supply
    # arriving in time. After the schedule was generated and inventory
    # got reserved by OP-X, MaterialLedger would now see OP-A's start
    # (h8) before the supply lot arrives (h13) → drifted state.
    work_orders = [
        WorkOrder(
            id="WO-X",
            name="WO-X",
            product_id="P",
            quantity=1,
            due_date=horizon_start + timedelta(days=2),
            release_date=horizon_start,
            operations=[
                Operation(
                    id="OP-X",
                    work_order_id="WO-X",
                    sequence=1,
                    name="OP-X",
                    duration=Duration(minutes=60),
                    eligible_machine_ids=["M1"],
                    material_requirements=[
                        MaterialRequirement(
                            material_id=material_id, fixed_quantity=1
                        )
                    ],
                )
            ],
        ),
        WorkOrder(
            id="WO-A",
            name="WO-A",
            product_id="P",
            quantity=1,
            due_date=horizon_start + timedelta(days=2),
            release_date=horizon_start + timedelta(hours=13),
            operations=[
                Operation(
                    id="OP-A",
                    work_order_id="WO-A",
                    sequence=1,
                    name="OP-A",
                    duration=Duration(minutes=60),
                    eligible_machine_ids=["M1"],
                    material_requirements=[
                        MaterialRequirement(
                            material_id=material_id, fixed_quantity=1
                        )
                    ],
                )
            ],
        ),
        WorkOrder(
            id="WO-B",
            name="WO-B",
            product_id="P",
            quantity=1,
            due_date=horizon_start + timedelta(days=2),
            release_date=horizon_start,
            operations=[
                Operation(
                    id="OP-B",
                    work_order_id="WO-B",
                    sequence=1,
                    name="OP-B",
                    duration=Duration(minutes=60),
                    eligible_machine_ids=["M2"],
                )
            ],
        ),
    ]
    baseline = Schedule(
        id="baseline-drifted-supply",
        created_at=datetime(2026, 1, 5, 0, 0),
        assignments=[
            ScheduledOperation(
                operation_id="OP-X",
                work_order_id="WO-X",
                machine_id="M1",
                setup_start=horizon_start + timedelta(hours=0),
                start=horizon_start + timedelta(hours=0),
                end=horizon_start + timedelta(hours=1),
            ),
            ScheduledOperation(
                operation_id="OP-A",
                work_order_id="WO-A",
                machine_id="M1",
                setup_start=horizon_start + timedelta(hours=8),
                start=horizon_start + timedelta(hours=8),
                end=horizon_start + timedelta(hours=9),
            ),
            ScheduledOperation(
                operation_id="OP-B",
                work_order_id="WO-B",
                machine_id="M2",
                setup_start=horizon_start + timedelta(hours=10),
                start=horizon_start + timedelta(hours=10),
                end=horizon_start + timedelta(hours=11),
            ),
        ],
    )
    schedules = InMemoryScheduleRepository()
    schedules.save(baseline, metrics={}, organization_id=None)
    use_case = RunScheduling(
        work_orders=InMemoryWorkOrderRepository(work_orders),
        machines=InMemoryMachineRepository(two_machines),
        calendars=InMemoryCalendarRepository([standard_calendar]),
        # 1 unit on hand at h0 covers OP-X.
        inventory=InMemoryInventoryRepository(
            [
                InventoryItem(
                    material_id=material_id,
                    quantity_on_hand=1,
                    as_of=horizon_start,
                )
            ]
        ),
        # Supply for OP-A arrives at h13 — ON TIME for the pre-check
        # (demand_at h13 from WO-A's release_date), but TOO LATE for
        # OP-A's frozen baseline start at h8 once OP-X has consumed
        # the inventory.
        supplies=InMemorySupplyRepository(
            [
                SupplyLot(
                    id="SUP-DRIFT",
                    material_id=material_id,
                    quantity=1,
                    available_at=horizon_start + timedelta(hours=13),
                )
            ]
        ),
        schedules=schedules,
    )

    # Pin OP-B (which has no material requirement) at a slightly
    # different position. OP-A is NOT pinned. The pin should succeed
    # without re-failing on OP-A's material.
    result = use_case.execute(
        RunSchedulingInput(
            horizon_start=horizon_start,
            horizon_days=3,
            baseline_schedule_id="baseline-drifted-supply",
            reschedule_mode="repair_local",
            persist=False,
            planner_actions=[
                PlannerAction(
                    action_type="pin_operation_window",
                    operation_id="OP-B",
                    machine_id="M2",
                    start=horizon_start + timedelta(hours=11),
                    end=horizon_start + timedelta(hours=12),
                )
            ],
        )
    )

    # Pin succeeds; OP-B is at the new pinned position.
    pinned = next(
        (a for a in result.schedule.assignments if a.operation_id == "OP-B"),
        None,
    )
    assert pinned is not None
    assert pinned.start == horizon_start + timedelta(hours=11)


def test_run_scheduling_pin_still_rejects_when_pinned_op_lacks_material(
    horizon_start,
    standard_calendar,
    two_machines,
):
    """The previous test confirms baseline-op material drift no longer
    breaks unrelated pins. This test is the symmetric guard: when the
    pinned op itself can't get its material at the pinned start, the
    engine MUST still raise — that's a real planner mistake worth
    surfacing.
    """
    material_id = "RAW-PIN-STRICT"
    work_orders = [
        WorkOrder(
            id="WO-PIN",
            name="WO-PIN",
            product_id="P",
            quantity=1,
            due_date=horizon_start + timedelta(days=2),
            release_date=horizon_start,
            operations=[
                Operation(
                    id="OP-PIN",
                    work_order_id="WO-PIN",
                    sequence=1,
                    name="OP-PIN",
                    duration=Duration(minutes=60),
                    eligible_machine_ids=["M1"],
                    material_requirements=[
                        MaterialRequirement(
                            material_id=material_id, fixed_quantity=1
                        )
                    ],
                )
            ],
        ),
    ]
    use_case = RunScheduling(
        work_orders=InMemoryWorkOrderRepository(work_orders),
        machines=InMemoryMachineRepository(two_machines),
        calendars=InMemoryCalendarRepository([standard_calendar]),
        inventory=InMemoryInventoryRepository([]),
        supplies=InMemorySupplyRepository(
            [
                SupplyLot(
                    id="SUP-PIN-LATE",
                    material_id=material_id,
                    quantity=1,
                    available_at=horizon_start + timedelta(hours=15),
                )
            ]
        ),
    )

    with pytest.raises(ValidationError, match="requires material"):
        use_case.execute(
            RunSchedulingInput(
                horizon_start=horizon_start,
                horizon_days=3,
                reschedule_mode="repair_local",
                persist=False,
                planner_actions=[
                    PlannerAction(
                        action_type="pin_operation_window",
                        operation_id="OP-PIN",
                        machine_id="M1",
                        start=horizon_start + timedelta(hours=8),
                        end=horizon_start + timedelta(hours=9),
                    )
                ],
            )
        )


def test_run_scheduling_add_overtime_action_expands_capacity(
    horizon_start,
    standard_calendar,
    two_machines,
):
    work_order = make_work_order(
        "WO-OVERTIME",
        release=horizon_start + timedelta(hours=17),
        due=horizon_start + timedelta(hours=20),
        ops=[("OP-OVERTIME", 120, ["M1"], 0)],
    )
    use_case = RunScheduling(
        work_orders=InMemoryWorkOrderRepository([work_order]),
        machines=InMemoryMachineRepository(two_machines),
        calendars=InMemoryCalendarRepository([standard_calendar]),
    )

    result = use_case.execute(
        RunSchedulingInput(
            horizon_start=horizon_start,
            horizon_days=1,
            persist=False,
            planner_actions=[
                PlannerAction(
                    action_type="add_overtime",
                    machine_id="M1",
                    start=horizon_start + timedelta(hours=17),
                    end=horizon_start + timedelta(hours=20),
                )
            ],
        )
    )

    assignment = result.schedule.assignments[0]
    snapshot_calendars = result.diagnostics["input_entity_counts"]["calendars"]
    assert assignment.machine_id == "M1"
    assert assignment.start == horizon_start + timedelta(hours=17)
    assert assignment.end == horizon_start + timedelta(hours=19)
    assert snapshot_calendars == 2
    assert result.diagnostics["planner_actions"]["applied_count"] == 1
    impact = result.diagnostics["planner_actions"]["impact_report"]["items"][0]["impact"]
    assert impact["change_type"] == "machine_overtime_added"
    assert impact["window"]["duration_minutes"] == 180
