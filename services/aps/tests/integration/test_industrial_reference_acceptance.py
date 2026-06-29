"""Industrial reference acceptance tests for the APS engine.

These tests are intentionally broader than unit tests. They prove that the
engine can run a compact but realistic shop scenario end-to-end:

- finite machine and secondary-resource capacity;
- calendars, maintenance, setup matrices and transfer times;
- material availability from inventory plus inbound supply;
- persisted baseline, Gantt projection, feasible slots, repair candidate,
  scenario comparison and publish.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import timedelta

from planiadvance_v2.application.use_cases import RunScheduling
from planiadvance_v2.application.use_cases.compare_scenarios import (
    CompareScenarios,
    CompareScenariosInput,
)
from planiadvance_v2.application.use_cases.get_schedule_gantt import GetScheduleGantt
from planiadvance_v2.application.use_cases.planner_actions import PlannerAction
from planiadvance_v2.application.use_cases.publish_scenario import (
    PublishScenario,
    PublishScenarioInput,
)
from planiadvance_v2.application.use_cases.run_scheduling import RunSchedulingInput
from planiadvance_v2.application.use_cases.suggest_operation_slots import (
    SuggestOperationSlots,
)
from planiadvance_v2.domain.entities import Operation, Schedule, WorkOrder
from planiadvance_v2.infrastructure.in_memory import (
    InMemoryCalendarRepository,
    InMemoryInventoryRepository,
    InMemoryMachineRepository,
    InMemoryResourceRepository,
    InMemoryScheduleRepository,
    InMemorySupplyRepository,
    InMemoryWorkOrderRepository,
)
from planiadvance_v2.infrastructure.industrial_reference import (
    IndustrialReferenceDataset,
    build_industrial_acceptance_workshop,
    build_industrial_stress_workshop,
)


@dataclass(frozen=True, slots=True)
class _IndustrialHarness:
    scenario: IndustrialReferenceDataset
    work_orders: InMemoryWorkOrderRepository
    machines: InMemoryMachineRepository
    calendars: InMemoryCalendarRepository
    resources: InMemoryResourceRepository
    inventory: InMemoryInventoryRepository
    supplies: InMemorySupplyRepository
    schedules: InMemoryScheduleRepository

    def run_scheduling(self) -> RunScheduling:
        return RunScheduling(
            work_orders=self.work_orders,
            machines=self.machines,
            calendars=self.calendars,
            resources=self.resources,
            inventory=self.inventory,
            supplies=self.supplies,
            schedules=self.schedules,
        )

    def gantt(self) -> GetScheduleGantt:
        return GetScheduleGantt(
            schedules=self.schedules,
            work_orders=self.work_orders,
            machines=self.machines,
        )

    def slots(self) -> SuggestOperationSlots:
        return SuggestOperationSlots(
            schedules=self.schedules,
            work_orders=self.work_orders,
            machines=self.machines,
            calendars=self.calendars,
            resources=self.resources,
            inventory=self.inventory,
            supplies=self.supplies,
        )


def _build_harness() -> _IndustrialHarness:
    scenario = build_industrial_acceptance_workshop()
    return _build_harness_from_scenario(scenario)


def _build_stress_harness(repetitions: int = 3) -> _IndustrialHarness:
    scenario = build_industrial_stress_workshop(repetitions=repetitions)
    return _build_harness_from_scenario(scenario)


def _build_harness_from_scenario(
    scenario: IndustrialReferenceDataset,
) -> _IndustrialHarness:
    return _IndustrialHarness(
        scenario=scenario,
        work_orders=InMemoryWorkOrderRepository(seed=scenario.work_orders),
        machines=InMemoryMachineRepository(seed=scenario.machines),
        calendars=InMemoryCalendarRepository(seed=scenario.calendars),
        resources=InMemoryResourceRepository(seed=scenario.resources),
        inventory=InMemoryInventoryRepository(seed=scenario.inventory_items),
        supplies=InMemorySupplyRepository(seed=scenario.supplies),
        schedules=InMemoryScheduleRepository(),
    )


def test_industrial_reference_baseline_schedules_all_constraints():
    harness = _build_harness()
    result = harness.run_scheduling().execute(
        RunSchedulingInput(
            horizon_start=harness.scenario.horizon_start,
            horizon_days=7,
            strategy="auto",
            heuristic="priority_edd",
            transfer_times=harness.scenario.transfer_times,
            persist=True,
            workspace_id="industrial-demo",
            scenario_name="Industrial acceptance baseline",
            lifecycle_status="published",
        )
    )

    expected_operation_count = sum(
        len(work_order.operations) for work_order in harness.scenario.work_orders
    )
    assert len(harness.scenario.work_orders) >= 6
    assert expected_operation_count >= 20
    assert len(result.schedule.assignments) == expected_operation_count
    assert result.solver_status == "feasible"
    assert result.input_snapshot_hash
    assert result.metrics["makespan_minutes"] > 0
    assert result.summary.scheduled_operation_count == expected_operation_count
    assert result.diagnostics["planner_decisions"]["version"] == "planner-decisions-v1"
    assert result.diagnostics["planner_exceptions"]["status"] in {
        "clear",
        "ok",
        "attention",
    }
    assert result.diagnostics["repair_scope"]["version"] == "repair-scope-v1"
    assert result.diagnostics["material_pegging_report"]["status"] == "covered"

    _assert_no_machine_overlap(result.schedule)
    _assert_secondary_resource_capacity(
        result.schedule,
        work_orders=harness.scenario.work_orders,
        resource_capacities={
            resource.id: resource.capacity for resource in harness.scenario.resources
        },
    )
    _assert_delta_cut_waited_for_inbound_supply(result.schedule)
    _assert_epsilon_electrical_waited_for_inbound_supply(result.schedule)


def test_industrial_reference_gantt_edit_compare_publish_workflow():
    harness = _build_harness()
    baseline = harness.run_scheduling().execute(
        RunSchedulingInput(
            horizon_start=harness.scenario.horizon_start,
            horizon_days=7,
            strategy="auto",
            heuristic="priority_edd",
            transfer_times=harness.scenario.transfer_times,
            persist=True,
            workspace_id="industrial-demo",
            scenario_name="Published industrial baseline",
            lifecycle_status="published",
        )
    )
    baseline_id = baseline.schedule.id

    gantt = harness.gantt().execute(baseline_id)
    assert gantt.interaction_contract["version"] == "interactive-gantt-v1"
    assert gantt.interaction_contract["assignment_mutation"] == "forbidden"
    assert len(gantt.items) == len(baseline.schedule.assignments)

    suggestions = harness.slots().execute(
        baseline_id,
        "GAMMA-CNC",
        search_start=harness.scenario.horizon_start + timedelta(hours=8),
        max_results=8,
    )
    assert suggestions.interaction_contract["slot_usage"] == "preview_move_before_apply"
    assert suggestions.slots
    selected_slot = _first_changed_slot(suggestions)

    candidate = harness.run_scheduling().execute(
        RunSchedulingInput(
            horizon_start=harness.scenario.horizon_start,
            horizon_days=7,
            strategy="auto",
            heuristic="priority_edd",
            reschedule_mode="repair_local",
            transfer_times=harness.scenario.transfer_times,
            persist=True,
            workspace_id="industrial-demo",
            scenario_name="Gamma CNC planner candidate",
            lifecycle_status="draft",
            baseline_schedule_id=baseline_id,
            planner_actions=[
                PlannerAction(
                    action_type="force_machine",
                    operation_id="GAMMA-CNC",
                    machine_id=selected_slot.machine_id,
                    reason="acceptance test assisted Gantt machine change",
                )
            ],
        )
    )

    candidate_id = candidate.schedule.id
    candidate_gantt = harness.gantt().execute(
        candidate_id,
        baseline_schedule_id=baseline_id,
    )
    changed_items = [
        item for item in candidate_gantt.items if item.changed_from_baseline
    ]
    assert changed_items
    assert candidate.diagnostics["repair_scope"]["repair_strategy"] in {
        "targeted_repair",
        "stability_preserving_repair",
    }

    comparison = CompareScenarios(harness.schedules).execute(
        CompareScenariosInput(
            baseline_schedule_id=baseline_id,
            candidate_schedule_ids=[candidate_id],
            max_operation_changes=10,
        )
    )
    assert comparison.summary["comparison_count"] == 1
    assert comparison.comparisons[0].publish_status in {"publishable", "review"}

    published = PublishScenario(harness.schedules).execute(
        PublishScenarioInput(
            schedule_id=candidate_id,
            baseline_schedule_id=baseline_id,
            scenario_name="Approved industrial candidate",
            allow_review=True,
        )
    )
    assert published.lifecycle_status == "published"
    assert published.publish_status in {"publishable", "review"}


def test_industrial_stress_reference_scales_without_breaking_constraints():
    harness = _build_stress_harness(repetitions=3)
    operation_ids = [
        operation.id
        for work_order in harness.scenario.work_orders
        for operation in work_order.operations
    ]
    assert len(operation_ids) == 66
    assert len(operation_ids) == len(set(operation_ids))
    assert len(harness.scenario.work_orders) == 18

    result = harness.run_scheduling().execute(
        RunSchedulingInput(
            horizon_start=harness.scenario.horizon_start,
            horizon_days=14,
            strategy="auto",
            heuristic="priority_edd",
            transfer_times=harness.scenario.transfer_times,
            persist=True,
            workspace_id="industrial-stress",
            scenario_name="Industrial stress baseline",
            lifecycle_status="simulation",
        )
    )

    assert result.solver_status == "feasible"
    assert len(result.schedule.assignments) == len(operation_ids)
    assert result.summary.scheduled_operation_count == len(operation_ids)
    assert result.diagnostics["material_pegging_report"]["status"] == "covered"
    _assert_no_machine_overlap(result.schedule)
    _assert_secondary_resource_capacity(
        result.schedule,
        work_orders=harness.scenario.work_orders,
        resource_capacities={
            resource.id: resource.capacity for resource in harness.scenario.resources
        },
    )


def _assert_no_machine_overlap(schedule: Schedule) -> None:
    for machine_id in {assignment.machine_id for assignment in schedule.assignments}:
        assignments = schedule.by_machine(machine_id)
        for previous, current in zip(assignments, assignments[1:], strict=False):
            assert previous.end <= current.setup_start, (
                f"{machine_id} overlap: {previous.operation_id} -> "
                f"{current.operation_id}"
            )


def _assert_secondary_resource_capacity(
    schedule: Schedule,
    *,
    work_orders: list[WorkOrder],
    resource_capacities: dict[str, int],
) -> None:
    operation_lookup = {
        operation.id: operation
        for work_order in work_orders
        for operation in work_order.operations
    }
    events_by_resource: dict[str, list[tuple[object, int]]] = {}
    for assignment in schedule.assignments:
        operation = operation_lookup[assignment.operation_id]
        for resource_id, units in _requirements_for_assignment(
            operation,
            assignment.machine_id,
        ).items():
            events = events_by_resource.setdefault(resource_id, [])
            events.append((assignment.full_window.start, units))
            events.append((assignment.full_window.end, -units))

    for resource_id, events in events_by_resource.items():
        load = 0
        capacity = resource_capacities[resource_id]
        for _, delta in sorted(events, key=lambda item: (item[0], item[1])):
            load += delta
            assert load <= capacity, f"{resource_id} exceeds capacity {capacity}"


def _requirements_for_assignment(
    operation: Operation,
    machine_id: str,
) -> dict[str, int]:
    routing = next(
        (
            candidate
            for candidate in operation.effective_routings()
            if candidate.machine_id == machine_id
        ),
        None,
    )
    requirements = (
        routing.resource_requirements
        if routing is not None
        else tuple(operation.resource_requirements)
    )
    return {item.resource_id: item.units for item in requirements}


def _assert_delta_cut_waited_for_inbound_supply(schedule: Schedule) -> None:
    delta_cut = next(
        item for item in schedule.assignments if item.operation_id == "DELTA-CUT"
    )
    assert delta_cut.start >= harness_supply_time("SUP-RAW-AL-MON-11")


def _assert_epsilon_electrical_waited_for_inbound_supply(schedule: Schedule) -> None:
    epsilon_electrical = next(
        item for item in schedule.assignments if item.operation_id == "EPSILON-ELECTRICAL"
    )
    assert epsilon_electrical.start >= harness_supply_time("SUP-ELECTRONICS-TUE-08")


def harness_supply_time(supply_id: str):
    return next(
        supply.available_at
        for supply in build_industrial_acceptance_workshop().supplies
        if supply.id == supply_id
    )


def _first_changed_slot(suggestions):
    for slot in suggestions.slots:
        if slot.baseline_machine_change or slot.baseline_start_delta_minutes:
            return slot
    return suggestions.slots[0]
