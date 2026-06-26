"""Reference workshop scenarios for APS core maturity.

These tests replay the same small workshop across the main orchestration
paths so we can reason about the engine on a more realistic dataset than
single-operation examples.
"""

from __future__ import annotations

from datetime import datetime

from planiadvance_v2.application.use_cases.compare_strategies import (
    CompareStrategies,
    CompareStrategiesInput,
)
from planiadvance_v2.application.use_cases.handle_disruption import (
    DisruptionEvent,
    DisruptionType,
)
from planiadvance_v2.application.use_cases.run_disruption import (
    RunDisruption,
    RunDisruptionInput,
)
from planiadvance_v2.application.use_cases.run_scheduling import (
    RunScheduling,
    RunSchedulingInput,
)
from planiadvance_v2.domain.entities import Operation, WorkOrder
from planiadvance_v2.domain.value_objects import Duration, Priority
from planiadvance_v2.infrastructure.in_memory.repositories import (
    InMemoryCalendarRepository,
    InMemoryMachineRepository,
    InMemoryResourceRepository,
    InMemoryScheduleRepository,
    InMemoryWorkOrderRepository,
)
from tests.support.reference_scenarios import (
    build_reference_workshop,
    build_stressed_reference_workshop,
)


def _run_use_case():
    workshop = build_reference_workshop()
    schedule_repo = InMemoryScheduleRepository()
    return workshop, schedule_repo, RunScheduling(
        work_orders=InMemoryWorkOrderRepository(workshop.work_orders),
        machines=InMemoryMachineRepository(workshop.machines),
        calendars=InMemoryCalendarRepository(workshop.calendars),
        resources=InMemoryResourceRepository(workshop.resources),
        schedules=schedule_repo,
    )


class TestReferenceWorkshopRun:
    def test_normal_planning_reference_workshop(self):
        workshop, _, uc = _run_use_case()

        result = uc.execute(
            RunSchedulingInput(
                horizon_start=workshop.horizon_start,
                horizon_days=5,
                strategy="greedy",
                transfer_times=workshop.transfer_times,
                persist=False,
            )
        )

        assert len(result.schedule.assignments) == 4
        assert result.summary.work_order_count == 2
        assert result.summary.scheduled_operation_count == 4
        assert result.summary.bottleneck_machine_id in {"CUT-1", "ASM-1", "ASM-2"}
        assert any("Critical path spans" in h for h in result.summary.highlights)
        assert any("Transfer constraints added up to" in h for h in result.summary.highlights)
        trace = {entry["operation_id"]: entry for entry in result.diagnostics["decision_trace"]}
        planner = result.diagnostics["planner_diagnostics"]
        assert planner["language_version"] == "planner-v1"
        assert any("Largest transfer delay was" in note for note in planner["notes"])
        assert planner["top_delay_drivers"][0]["type"] == "transfer"
        assert any(
            card["selected_reason_label"] == "Earliest feasible slot"
            for card in planner["decision_cards"]
        )
        assert trace["RED-ASM"]["transfer_delay_minutes"] >= 20
        assert trace["BLUE-ASM"]["candidate_count"] == 2


class TestReferenceWorkshopCompare:
    def test_compare_strategies_on_reference_workshop(self):
        workshop = build_reference_workshop()
        uc = CompareStrategies(
            work_orders=InMemoryWorkOrderRepository(workshop.work_orders),
            machines=InMemoryMachineRepository(workshop.machines),
            calendars=InMemoryCalendarRepository(workshop.calendars),
            resources=InMemoryResourceRepository(workshop.resources),
        )

        result = uc.execute(
            CompareStrategiesInput(
                strategies=["greedy", "backward"],
                horizon_start=workshop.horizon_start,
                horizon_days=5,
                transfer_times=workshop.transfer_times,
                parallel=False,
            )
        )

        assert len(result.runs) == 2
        assert all(run.succeeded for run in result.runs)
        assert all(run.summary is not None for run in result.runs)
        assert all(run.summary.scheduled_operation_count == 4 for run in result.runs)
        assert all(run.summary.work_order_count == 2 for run in result.runs)
        backward = next(run for run in result.runs if run.strategy == "backward")
        assert isinstance(backward.diagnostics.get("decision_trace"), list)
        assert len(backward.diagnostics["decision_trace"]) == 4
        assert result.best is not None
        assert result.summary.best_strategy == result.best.strategy
        assert result.summary.fastest_strategy in {"greedy", "backward"}
        assert result.summary.successful_runs == 2
        assert result.summary.shortest_makespan_strategy in {"greedy", "backward"}
        assert result.summary.lowest_lateness_strategy in {"greedy", "backward"}
        assert result.summary.best_on_time_ratio_strategy in {"greedy", "backward"}
        assert set(result.summary.qualified_strategies) == {"greedy", "backward"}
        assert result.summary.experimental_strategies == []
        assert result.summary.recommended_for_disruption == "greedy"
        assert any(
            "safest successful strategy for disruption handling" in note
            for note in result.summary.qualification_highlights
        )
        assert any(
            "stronger operational default" in note
            for note in result.summary.qualification_highlights
        )
        assert any("Best strategy is" in h for h in result.summary.highlights)
        assert any(
            "Shortest makespan comes from" in h
            for h in result.summary.highlights
        )
        assert any(
            card["dimension"] == "makespan"
            for card in result.summary.tradeoff_cards
        )
        assert any(
            card["dimension"] == "lateness"
            for card in result.summary.tradeoff_cards
        )
        assert all("planner_diagnostics" in run.diagnostics for run in result.runs)
        assert all(run.profile is not None for run in result.runs)
        assert all(run.profile["maturity"] == "production" for run in result.runs)
        assert all(
            run.diagnostics["planner_diagnostics"]["language_version"] == "planner-v1"
            for run in result.runs
        )
        assert any(
            card["selected_reason_label"] in {"Earliest feasible slot", "Resource capacity", "Calendar window"}
            for card in backward.diagnostics["planner_diagnostics"]["decision_cards"]
        )
        operational_card = next(
            card for card in result.summary.qualification_cards if card["context"] == "operational_default"
        )
        assert operational_card["recommended_strategy"] == "greedy"
        assert operational_card["evidence"]["reference_strategy"] == "backward"
        assert operational_card["evidence"]["objective_gap"] > 0

    def test_compare_with_cpsat_qualifies_operational_vs_strategic_use(self):
        workshop = build_reference_workshop()
        uc = CompareStrategies(
            work_orders=InMemoryWorkOrderRepository(workshop.work_orders),
            machines=InMemoryMachineRepository(workshop.machines),
            calendars=InMemoryCalendarRepository(workshop.calendars),
            resources=InMemoryResourceRepository(workshop.resources),
        )

        result = uc.execute(
            CompareStrategiesInput(
                strategies=["greedy", "backward", "cpsat"],
                horizon_start=workshop.horizon_start,
                horizon_days=5,
                transfer_times=workshop.transfer_times,
                parallel=False,
            )
        )

        assert len(result.runs) == 3
        cpsat = next(run for run in result.runs if run.strategy == "cpsat")
        assert cpsat.profile is not None
        assert cpsat.profile["planning_mode"] == "strategic_what_if"
        assert cpsat.profile["recommended_for_disruption"] is False
        assert result.summary.recommended_for_disruption == "greedy"
        assert result.summary.recommended_for_what_if == "cpsat"
        assert any(
            "improves objective by" in note
            for note in result.summary.qualification_highlights
        )
        what_if_card = next(
            card for card in result.summary.qualification_cards if card["context"] == "what_if"
        )
        assert what_if_card["recommended_strategy"] == "cpsat"
        assert what_if_card["evidence"]["reference_strategy"] == "greedy"
        assert what_if_card["evidence"]["objective_gap_vs_best_operational"] == 5
        assert what_if_card["evidence"]["makespan_delta_vs_best_operational"] == 5
        disruption_card = next(
            card for card in result.summary.qualification_cards if card["context"] == "disruption"
        )
        assert disruption_card["recommended_strategy"] == "greedy"
        assert disruption_card["evidence"]["reference_strategy"] == "greedy"
        assert any(
            card["context"] == "disruption"
            for card in result.summary.qualification_cards
        )
        assert any(
            card["context"] == "what_if"
            for card in result.summary.qualification_cards
        )


class TestReferenceWorkshopDisruption:
    def test_rush_order_reschedules_reference_workshop(self):
        workshop, schedule_repo, uc_init = _run_use_case()
        initial = uc_init.execute(
            RunSchedulingInput(
                horizon_start=workshop.horizon_start,
                horizon_days=5,
                strategy="greedy",
                transfer_times=workshop.transfer_times,
                persist=True,
            )
        )

        uc = RunDisruption(
            work_orders=InMemoryWorkOrderRepository(workshop.work_orders),
            machines=InMemoryMachineRepository(workshop.machines),
            calendars=InMemoryCalendarRepository(workshop.calendars),
            resources=InMemoryResourceRepository(workshop.resources),
            schedules=schedule_repo,
        )
        result = uc.execute(
            RunDisruptionInput(
                event=DisruptionEvent(
                    disruption_type=DisruptionType.RUSH_ORDER,
                    timestamp=datetime(2026, 1, 5, 11, 0, 0),
                    rush_order=workshop.rush_order,
                ),
                schedule_id=initial.schedule.id,
                strategy="greedy",
                transfer_times=workshop.transfer_times,
                persist=True,
            )
        )

        assert result.schedule.id != initial.schedule.id
        assert result.summary.work_order_count == 3
        assert result.summary.scheduled_operation_count == 6
        assert result.analysis is not None
        assert len(result.analysis.gantt) == 6
        assert any("Disruption rush_order applied" in h for h in result.summary.highlights)
        impact = result.diagnostics["disruption_impact"]
        assert impact["introduced_operation_count"] == 2
        assert "RUSH-CUT" in impact["introduced_operations"]
        assert impact["baseline_schedule_id"] == initial.schedule.id
        assert impact["new_schedule_id"] == result.schedule.id
        op_ids = {a.operation_id for a in result.schedule.assignments}
        assert {"RUSH-CUT", "RUSH-ASM"} <= op_ids

    def test_machine_down_keeps_history_coherent(self):
        workshop, schedule_repo, uc_init = _run_use_case()
        initial = uc_init.execute(
            RunSchedulingInput(
                horizon_start=workshop.horizon_start,
                horizon_days=5,
                strategy="greedy",
                transfer_times=workshop.transfer_times,
                persist=True,
            )
        )

        uc = RunDisruption(
            work_orders=InMemoryWorkOrderRepository(workshop.work_orders),
            machines=InMemoryMachineRepository(workshop.machines),
            calendars=InMemoryCalendarRepository(workshop.calendars),
            resources=InMemoryResourceRepository(workshop.resources),
            schedules=schedule_repo,
        )
        result = uc.execute(
            RunDisruptionInput(
                event=DisruptionEvent(
                    disruption_type=DisruptionType.MACHINE_DOWN,
                    timestamp=datetime(2026, 1, 5, 12, 0, 0),
                    machine_id="ASM-1",
                    event_end=datetime(2026, 1, 5, 17, 0, 0),
                ),
                schedule_id=initial.schedule.id,
                strategy="greedy",
                transfer_times=workshop.transfer_times,
                persist=True,
            )
        )

        assert result.schedule.id != initial.schedule.id
        assert schedule_repo.get(initial.schedule.id) is not None
        assert schedule_repo.get(result.schedule.id) is not None
        assert result.summary.scheduled_operation_count == 4
        assert any("Disruption machine_down applied" in h for h in result.summary.highlights)
        impact = result.diagnostics["disruption_impact"]
        assert impact["changed_operation_count"] >= 0
        assert impact["machine_change_count"] >= 0
        assert any(
            "No scheduled operations needed to move after disruption." in h
            or "changed timing or machine after disruption." in h
            for h in result.summary.highlights
        )
        # After the noon breakdown, no new assignment on ASM-1 should start
        # during the outage window.
        blocked_start = datetime(2026, 1, 5, 12, 0, 0)
        blocked_end = datetime(2026, 1, 5, 17, 0, 0)
        assert all(
            not (
                assignment.machine_id == "ASM-1"
                and blocked_start <= assignment.setup_start < blocked_end
            )
            for assignment in result.schedule.assignments
        )

    def test_operation_delay_pushes_successor_in_reference_workshop(self):
        workshop, schedule_repo, uc_init = _run_use_case()
        initial = uc_init.execute(
            RunSchedulingInput(
                horizon_start=workshop.horizon_start,
                horizon_days=5,
                strategy="greedy",
                transfer_times=workshop.transfer_times,
                persist=True,
            )
        )

        uc = RunDisruption(
            work_orders=InMemoryWorkOrderRepository(workshop.work_orders),
            machines=InMemoryMachineRepository(workshop.machines),
            calendars=InMemoryCalendarRepository(workshop.calendars),
            resources=InMemoryResourceRepository(workshop.resources),
            schedules=schedule_repo,
        )
        delayed_end = datetime(2026, 1, 5, 11, 0, 0)
        result = uc.execute(
            RunDisruptionInput(
                event=DisruptionEvent(
                    disruption_type=DisruptionType.OPERATION_DELAY,
                    timestamp=datetime(2026, 1, 5, 9, 0, 0),
                    operation_id="RED-CUT",
                    new_end=delayed_end,
                ),
                schedule_id=initial.schedule.id,
                strategy="greedy",
                transfer_times=workshop.transfer_times,
                persist=True,
            )
        )

        red_asm = next(
            a for a in result.schedule.assignments if a.operation_id == "RED-ASM"
        )
        assert red_asm.start >= delayed_end
        assert result.summary.scheduled_operation_count == 4
        assert any(
            "Disruption operation_delay applied" in h
            for h in result.summary.highlights
        )
        impact = result.diagnostics["disruption_impact"]
        assert impact["delayed_operation_count"] >= 1
        assert "RED-ASM" in impact["delayed_operations"]


class TestStressedReferenceWorkshopRun:
    def test_stressed_workshop_solves_with_degraded_readiness(self):
        workshop = build_stressed_reference_workshop()
        uc = RunScheduling(
            work_orders=InMemoryWorkOrderRepository(workshop.work_orders),
            machines=InMemoryMachineRepository(workshop.machines),
            calendars=InMemoryCalendarRepository(workshop.calendars),
            resources=InMemoryResourceRepository(workshop.resources),
        )

        result = uc.execute(
            RunSchedulingInput(
                horizon_start=workshop.horizon_start,
                horizon_days=5,
                strategy="greedy",
                transfer_times=workshop.transfer_times,
                persist=False,
            )
        )

        assert len(result.schedule.assignments) == 6
        assert result.feasibility is not None
        assert result.feasibility.readiness_status == "degraded"
        assert result.feasibility.recommended_mode == "solve_with_caution"
        assert result.feasibility.warning_count >= 1
        assert result.summary.scheduled_operation_count == 6
        assert result.summary.work_order_count == 3
        assert any("Bottleneck is" in h for h in result.summary.highlights)
        assert any("split across multiple working windows" in h for h in result.summary.highlights)
        planner = result.diagnostics["planner_diagnostics"]
        assert planner["top_delay_drivers"]
        assert "GREEN-ASM" in planner["preempted_operations"]
        assert any(card["selected_machine_id"] in {"ASM-1", "ASM-2"} for card in planner["decision_cards"])


class TestStressedReferenceWorkshopCompare:
    def test_compare_survives_tight_workshop_and_exposes_tradeoffs(self):
        workshop = build_stressed_reference_workshop()
        uc = CompareStrategies(
            work_orders=InMemoryWorkOrderRepository(workshop.work_orders),
            machines=InMemoryMachineRepository(workshop.machines),
            calendars=InMemoryCalendarRepository(workshop.calendars),
            resources=InMemoryResourceRepository(workshop.resources),
        )

        result = uc.execute(
            CompareStrategiesInput(
                strategies=["greedy", "backward"],
                horizon_start=workshop.horizon_start,
                horizon_days=5,
                transfer_times=workshop.transfer_times,
                parallel=False,
            )
        )

        assert len(result.runs) == 2
        assert all(run.succeeded for run in result.runs)
        assert result.summary.successful_runs == 2
        assert result.summary.objective_spread is not None
        assert result.summary.recommended_for_disruption == "greedy"
        assert result.summary.shortest_makespan_strategy in {"greedy", "backward"}
        assert result.summary.lowest_lateness_strategy in {"greedy", "backward"}
        assert any(
            card["context"] == "operational_default"
            for card in result.summary.qualification_cards
        )
        assert any(
            card["dimension"] == "lateness" for card in result.summary.tradeoff_cards
        )
        assert all("makespan_minutes" in run.metrics for run in result.runs)
        assert all("on_time_ratio" in run.metrics for run in result.runs)


class TestStressedReferenceWorkshopDisruption:
    def test_machine_down_on_stressed_workshop_preserves_coherence(self):
        workshop = build_stressed_reference_workshop()
        schedule_repo = InMemoryScheduleRepository()
        init_uc = RunScheduling(
            work_orders=InMemoryWorkOrderRepository(workshop.work_orders),
            machines=InMemoryMachineRepository(workshop.machines),
            calendars=InMemoryCalendarRepository(workshop.calendars),
            resources=InMemoryResourceRepository(workshop.resources),
            schedules=schedule_repo,
        )
        initial = init_uc.execute(
            RunSchedulingInput(
                horizon_start=workshop.horizon_start,
                horizon_days=5,
                strategy="greedy",
                transfer_times=workshop.transfer_times,
                persist=True,
            )
        )

        uc = RunDisruption(
            work_orders=InMemoryWorkOrderRepository(workshop.work_orders),
            machines=InMemoryMachineRepository(workshop.machines),
            calendars=InMemoryCalendarRepository(workshop.calendars),
            resources=InMemoryResourceRepository(workshop.resources),
            schedules=schedule_repo,
        )
        outage_start = datetime(2026, 1, 5, 12, 0, 0)
        outage_end = datetime(2026, 1, 5, 17, 0, 0)
        result = uc.execute(
            RunDisruptionInput(
                event=DisruptionEvent(
                    disruption_type=DisruptionType.MACHINE_DOWN,
                    timestamp=outage_start,
                    machine_id="ASM-1",
                    event_end=outage_end,
                ),
                schedule_id=initial.schedule.id,
                strategy="greedy",
                transfer_times=workshop.transfer_times,
                persist=True,
            )
        )

        assert result.schedule.id != initial.schedule.id
        assert schedule_repo.get(result.schedule.id) is not None
        assert result.summary.scheduled_operation_count == 6
        assert any(
            "Disruption machine_down applied" in h for h in result.summary.highlights
        )
        assert all(
            not (
                assignment.machine_id == "ASM-1"
                and outage_start <= assignment.setup_start < outage_end
            )
            for assignment in result.schedule.assignments
        )


class TestComparisonFailureModes:
    def test_compare_surfaces_infeasible_strategy_cleanly(self):
        workshop = build_reference_workshop()
        tight = WorkOrder(
            id="WO-TIGHT",
            name="WO-TIGHT",
            product_id="P-TIGHT",
            quantity=1,
            release_date=datetime(2026, 1, 5, 8, 0, 0),
            due_date=datetime(2026, 1, 5, 9, 0, 0),
            priority=Priority.URGENT,
            operations=[
                Operation(
                    id="TIGHT-1",
                    work_order_id="WO-TIGHT",
                    sequence=1,
                    name="TIGHT-1",
                    duration=Duration(minutes=60),
                    eligible_machine_ids=["CUT-1"],
                ),
                Operation(
                    id="TIGHT-2",
                    work_order_id="WO-TIGHT",
                    sequence=2,
                    name="TIGHT-2",
                    duration=Duration(minutes=60),
                    eligible_machine_ids=["CUT-1"],
                    dependencies=["TIGHT-1"],
                ),
            ],
        )
        uc = CompareStrategies(
            work_orders=InMemoryWorkOrderRepository([tight]),
            machines=InMemoryMachineRepository([workshop.machines[0]]),
            calendars=InMemoryCalendarRepository(workshop.calendars),
            resources=InMemoryResourceRepository([]),
        )

        result = uc.execute(
            CompareStrategiesInput(
                strategies=["greedy", "backward"],
                horizon_start=workshop.horizon_start,
                horizon_days=2,
                parallel=False,
            )
        )

        greedy = next(run for run in result.runs if run.strategy == "greedy")
        backward = next(run for run in result.runs if run.strategy == "backward")

        assert greedy.succeeded
        assert backward.solver_status == "infeasible"
        assert backward.infeasibility is not None
        assert result.summary.successful_runs == 1
        assert result.summary.failed_strategies == ["backward"]
        assert result.summary.infeasible_strategies == ["backward"]
        assert result.summary.error_strategies == []
        assert any("Infeasible under current constraints" in h for h in result.summary.highlights)
        assert result.summary.dominant_failure_kind == "machine_overloaded"
        assert result.summary.next_best_recovery_action is not None
        assert result.summary.planner_focus == "add_or_shift_capacity"
        assert result.summary.recommended_for_disruption == "greedy"
        assert any(card["strategy"] == "backward" for card in result.summary.failure_cards)
        failure_card = next(
            card for card in result.summary.failure_cards if card["strategy"] == "backward"
        )
        assert failure_card["blocked_operation"] == "TIGHT-1"
        assert failure_card["dominant_blocker_kind"] == "machine_overloaded"
        assert failure_card["dominant_blocker_label"] == "Machine overload"
        assert failure_card["suggested_action"] is not None
        assert failure_card["planner_focus"] == "add_or_shift_capacity"
        assert failure_card["recovery_mode"] == "repair_then_retry"


class TestStrategyQualificationScenarios:
    def test_backward_is_recommended_for_just_in_time_when_score_is_not_worse(self):
        workshop = build_reference_workshop()
        one_machine = [machine for machine in workshop.machines if machine.id == "CUT-1"]
        wo = WorkOrder(
            id="WO-JIT",
            name="WO-JIT",
            product_id="P-JIT",
            quantity=1,
            release_date=datetime(2026, 1, 5, 8, 0, 0),
            due_date=datetime(2026, 1, 6, 17, 0, 0),
            priority=Priority.NORMAL,
            operations=[
                Operation(
                    id="JIT-1",
                    work_order_id="WO-JIT",
                    sequence=1,
                    name="JIT-1",
                    duration=Duration(minutes=120),
                    eligible_machine_ids=["CUT-1"],
                ),
                Operation(
                    id="JIT-2",
                    work_order_id="WO-JIT",
                    sequence=2,
                    name="JIT-2",
                    duration=Duration(minutes=120),
                    eligible_machine_ids=["CUT-1"],
                    dependencies=["JIT-1"],
                ),
            ],
        )
        uc = CompareStrategies(
            work_orders=InMemoryWorkOrderRepository([wo]),
            machines=InMemoryMachineRepository(one_machine),
            calendars=InMemoryCalendarRepository(workshop.calendars),
            resources=InMemoryResourceRepository([]),
        )

        result = uc.execute(
            CompareStrategiesInput(
                strategies=["greedy", "backward"],
                horizon_start=workshop.horizon_start,
                horizon_days=3,
                parallel=False,
            )
        )

        assert len(result.runs) == 2
        assert all(run.succeeded for run in result.runs)
        assert result.summary.recommended_for_disruption == "greedy"
        assert result.summary.recommended_for_just_in_time == "backward"
        assert any(
            "without sacrificing due-date service" in note
            for note in result.summary.qualification_highlights
        )
        jit_card = next(
            card for card in result.summary.qualification_cards if card["context"] == "just_in_time"
        )
        assert jit_card["recommended_strategy"] == "backward"
        assert jit_card["evidence"]["reference_strategy"] == "greedy"
        assert jit_card["evidence"]["objective_gap_vs_best_operational"] > 0
        assert jit_card["evidence"]["lateness_gap_vs_best_operational"] == 0
        assert jit_card["evidence"]["on_time_ratio_gap_vs_best_operational"] == 0.0
