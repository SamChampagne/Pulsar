"""Reactive disruption handler tests.

Verifies that the HandleDisruption use case correctly:

1. Freezes in-progress operations and replans the rest.
2. Handles MACHINE_DOWN by removing the machine and rescheduling
   affected operations to other machines.
3. Handles RUSH_ORDER by injecting a new work order.
4. Handles OPERATION_DELAY by pushing the frozen end time.
5. Preserves precedence constraints after re-planning.
"""

from __future__ import annotations

from datetime import datetime, time, timedelta

from planiadvance_v2.application.use_cases.handle_disruption import (
    DisruptionEvent,
    DisruptionType,
    HandleDisruption,
    HandleDisruptionInput,
)
from planiadvance_v2.domain.entities import Machine, WorkingCalendar
from planiadvance_v2.domain.scheduling import (
    Objective,
    SchedulingContext,
    resolve_strategy,
)
from planiadvance_v2.domain.value_objects import Priority, Shift
from tests.conftest import make_work_order

MONDAY = datetime(2026, 1, 5, 0, 0, 0)
HORIZON_END = MONDAY + timedelta(days=7)

# "now" is Monday 10:00 — 2 hours into the shift.
NOW = datetime(2026, 1, 5, 10, 0, 0)


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


def _run_initial_schedule(work_orders):
    """Run the greedy strategy to get a baseline schedule."""
    context = SchedulingContext(
        horizon_start=MONDAY,
        horizon_end=HORIZON_END,
        work_orders=work_orders,
        machines=_machines(),
        calendars=[_calendar()],
    )
    return resolve_strategy("greedy").solve(context, Objective.default())


class TestDisruptionFreezeAndReplan:
    """Operations that started before 'now' are frozen; the rest replan."""

    def test_in_progress_ops_are_frozen(self):
        wo = make_work_order(
            "WO1",
            release=MONDAY,
            due=MONDAY + timedelta(days=3),
            ops=[
                ("OP1", 60, ["M1", "M2"], 0),
                ("OP2", 60, ["M1", "M2"], 0),
            ],
        )
        initial = _run_initial_schedule([wo])

        # OP1 starts at 08:00 (before NOW=10:00) → frozen.
        # OP2 starts at 09:00 (before NOW) → also frozen.
        event = DisruptionEvent(
            disruption_type=DisruptionType.RUSH_ORDER,
            timestamp=NOW,
            rush_order=make_work_order(
                "RUSH",
                release=NOW,
                due=MONDAY + timedelta(days=2),
                ops=[("RUSH_OP", 30, ["M1", "M2"], 0)],
                priority=Priority.URGENT,
            ),
        )

        handler = HandleDisruption()
        output = handler.execute(
            HandleDisruptionInput(
                event=event,
                current_schedule=initial.schedule,
                work_orders=[wo],
                machines=_machines(),
                calendars=[_calendar()],
                horizon_start=MONDAY,
                horizon_end=HORIZON_END,
            )
        )

        assert output.frozen_count >= 1  # at least OP1 was frozen
        assert output.rescheduled_count >= 1  # RUSH_OP was scheduled
        # RUSH_OP should appear in the new schedule.
        rush_ops = [
            a for a in output.schedule.assignments if a.operation_id == "RUSH_OP"
        ]
        assert len(rush_ops) == 1


class TestMachineDown:
    """MACHINE_DOWN removes the machine and reschedules affected ops."""

    def test_ops_move_to_surviving_machine(self):
        wo = make_work_order(
            "WO1",
            release=MONDAY,
            due=MONDAY + timedelta(days=3),
            ops=[
                ("OP1", 60, ["M1", "M2"], 0),
                ("OP2", 60, ["M1", "M2"], 0),
                ("OP3", 60, ["M1", "M2"], 0),
            ],
        )
        initial = _run_initial_schedule([wo])

        # M1 goes down at NOW. Any not-yet-started ops on M1 should move to M2.
        event = DisruptionEvent(
            disruption_type=DisruptionType.MACHINE_DOWN,
            timestamp=NOW,
            machine_id="M1",
            event_end=MONDAY + timedelta(days=1),
        )

        handler = HandleDisruption()
        output = handler.execute(
            HandleDisruptionInput(
                event=event,
                current_schedule=initial.schedule,
                work_orders=[wo],
                machines=_machines(),
                calendars=[_calendar()],
                horizon_start=MONDAY,
                horizon_end=HORIZON_END,
            )
        )

        # All rescheduled (non-frozen) ops should be on M2 since M1 is down.
        frozen_op_ids = set()
        for a in initial.schedule.assignments:
            if a.setup_start <= NOW and (a.machine_id != "M1" or a.end <= NOW):
                frozen_op_ids.add(a.operation_id)

        for a in output.schedule.assignments:
            if a.operation_id not in frozen_op_ids:
                assert a.machine_id == "M2", (
                    f"Op {a.operation_id} should be on M2 but is on {a.machine_id}"
                )

        assert output.solver_status == "feasible"

    def test_repair_local_freezes_unaffected_future_operations(self):
        impacted = make_work_order(
            "WO-DOWN",
            release=MONDAY,
            due=MONDAY + timedelta(days=2),
            ops=[("DOWN-OP", 60, ["M1"], 0)],
        )
        unaffected = make_work_order(
            "WO-KEEP",
            release=MONDAY,
            due=MONDAY + timedelta(days=2),
            ops=[("KEEP-OP", 60, ["M2"], 0)],
        )
        initial = _run_initial_schedule([impacted, unaffected])
        event = DisruptionEvent(
            disruption_type=DisruptionType.MACHINE_DOWN,
            timestamp=MONDAY + timedelta(hours=7),
            machine_id="M1",
            event_end=MONDAY + timedelta(hours=14),
        )

        handler = HandleDisruption()
        repair_local = handler.execute(
            HandleDisruptionInput(
                event=event,
                current_schedule=initial.schedule,
                work_orders=[impacted, unaffected],
                machines=_machines(),
                calendars=[_calendar()],
                horizon_start=MONDAY,
                horizon_end=HORIZON_END,
                reschedule_mode="repair_local",
            )
        )
        reschedule_all = handler.execute(
            HandleDisruptionInput(
                event=event,
                current_schedule=initial.schedule,
                work_orders=[impacted, unaffected],
                machines=_machines(),
                calendars=[_calendar()],
                horizon_start=MONDAY,
                horizon_end=HORIZON_END,
                reschedule_mode="reschedule_all",
            )
        )

        assert repair_local.reschedule_mode == "repair_local"
        assert repair_local.diagnostics["policy_frozen_count"] == 1
        assert repair_local.frozen_count == 1
        assert reschedule_all.reschedule_mode == "reschedule_all"
        assert reschedule_all.diagnostics["policy_frozen_count"] == 0
        assert reschedule_all.frozen_count == 0

    def test_auto_strategy_uses_repair_local_decision_for_disruption(self):
        impacted = make_work_order(
            "WO-DOWN",
            release=MONDAY,
            due=MONDAY + timedelta(days=2),
            ops=[("DOWN-OP", 60, ["M1"], 0)],
        )
        unaffected = make_work_order(
            "WO-KEEP",
            release=MONDAY,
            due=MONDAY + timedelta(days=2),
            ops=[("KEEP-OP", 60, ["M2"], 0)],
        )
        initial = _run_initial_schedule([impacted, unaffected])
        event = DisruptionEvent(
            disruption_type=DisruptionType.MACHINE_DOWN,
            timestamp=MONDAY + timedelta(hours=7),
            machine_id="M1",
            event_end=MONDAY + timedelta(hours=14),
        )

        output = HandleDisruption().execute(
            HandleDisruptionInput(
                event=event,
                current_schedule=initial.schedule,
                work_orders=[impacted, unaffected],
                machines=_machines(),
                calendars=[_calendar()],
                horizon_start=MONDAY,
                horizon_end=HORIZON_END,
                strategy="auto",
                reschedule_mode="reschedule_all",
            )
        )

        decision = output.diagnostics["decision_layer"]
        assert output.strategy == "greedy"
        assert output.reschedule_mode == "repair_local"
        assert decision["auto_selected"] is True
        assert decision["selected_strategy"] == "greedy"
        assert decision["selected_reschedule_mode"] == "repair_local"
        assert decision["engine_mode"] == "repair"
        assert decision["rules_triggered"] == ["baseline_stability"]

    def test_net_change_uses_stability_preference_with_prefix_freeze(self):
        impacted = make_work_order(
            "WO-DOWN",
            release=MONDAY,
            due=MONDAY + timedelta(days=3),
            ops=[("DOWN-OP", 60, ["M1"], 0)],
        )
        unaffected = make_work_order(
            "WO-KEEP",
            release=MONDAY,
            due=MONDAY + timedelta(days=3),
            ops=[("KEEP-OP", 60, ["M2"], 0)],
        )
        initial = _run_initial_schedule([impacted, unaffected])
        event = DisruptionEvent(
            disruption_type=DisruptionType.MACHINE_DOWN,
            timestamp=MONDAY + timedelta(hours=7),
            machine_id="M1",
            event_end=MONDAY + timedelta(hours=14),
        )

        handler = HandleDisruption()
        net_change = handler.execute(
            HandleDisruptionInput(
                event=event,
                current_schedule=initial.schedule,
                work_orders=[impacted, unaffected],
                machines=_machines(),
                calendars=[_calendar()],
                horizon_start=MONDAY,
                horizon_end=HORIZON_END,
                reschedule_mode="net_change",
            )
        )

        assert net_change.reschedule_mode == "net_change"
        assert net_change.diagnostics["policy_frozen_count"] == 1
        assert (
            net_change.diagnostics["policy_anchor"]
            == (MONDAY + timedelta(hours=14)).isoformat()
        )
        assert net_change.diagnostics["stability_preference_applied"] is True

    def test_net_change_freezes_stable_prefix_before_machine_recovery(self):
        impacted = make_work_order(
            "WO-DOWN",
            release=MONDAY,
            due=MONDAY + timedelta(days=3),
            ops=[("DOWN-OP", 60, ["M1"], 0)],
        )
        stable_prefix = make_work_order(
            "WO-PREFIX",
            release=MONDAY,
            due=MONDAY + timedelta(days=3),
            ops=[("PREFIX-OP", 60, ["M2"], 0)],
        )
        flexible_tail = make_work_order(
            "WO-TAIL",
            release=MONDAY,
            due=MONDAY + timedelta(days=3),
            ops=[("TAIL-OP", 420, ["M2"], 0)],
        )
        initial = _run_initial_schedule([impacted, stable_prefix, flexible_tail])
        event = DisruptionEvent(
            disruption_type=DisruptionType.MACHINE_DOWN,
            timestamp=MONDAY + timedelta(hours=7),
            machine_id="M1",
            event_end=MONDAY + timedelta(hours=14),
        )

        handler = HandleDisruption()
        net_change = handler.execute(
            HandleDisruptionInput(
                event=event,
                current_schedule=initial.schedule,
                work_orders=[impacted, stable_prefix, flexible_tail],
                machines=_machines(),
                calendars=[_calendar()],
                horizon_start=MONDAY,
                horizon_end=HORIZON_END,
                reschedule_mode="net_change",
            )
        )

        assert net_change.reschedule_mode == "net_change"
        assert net_change.diagnostics["policy_frozen_count"] == 1
        assert (
            net_change.diagnostics["policy_anchor"]
            == (MONDAY + timedelta(hours=14)).isoformat()
        )
        frozen_ids = {
            assignment.operation_id
            for assignment in net_change.schedule.assignments
            if assignment.start == MONDAY + timedelta(hours=8)
            and assignment.machine_id == "M2"
        }
        assert "PREFIX-OP" in frozen_ids


class TestRushOrder:
    """RUSH_ORDER injects a new high-priority work order."""

    def test_rush_order_appears_in_schedule(self):
        wo = make_work_order(
            "WO1",
            release=MONDAY,
            due=MONDAY + timedelta(days=3),
            ops=[("OP1", 60, ["M1", "M2"], 0)],
        )
        initial = _run_initial_schedule([wo])

        rush = make_work_order(
            "RUSH",
            release=NOW,
            due=MONDAY + timedelta(days=1),
            ops=[("RUSH_OP", 45, ["M1", "M2"], 0)],
            priority=Priority.URGENT,
        )

        event = DisruptionEvent(
            disruption_type=DisruptionType.RUSH_ORDER,
            timestamp=NOW,
            rush_order=rush,
        )

        handler = HandleDisruption()
        output = handler.execute(
            HandleDisruptionInput(
                event=event,
                current_schedule=initial.schedule,
                work_orders=[wo],
                machines=_machines(),
                calendars=[_calendar()],
                horizon_start=MONDAY,
                horizon_end=HORIZON_END,
            )
        )

        op_ids = {a.operation_id for a in output.schedule.assignments}
        assert "RUSH_OP" in op_ids
        assert "OP1" in op_ids


class TestOperationDelay:
    """OPERATION_DELAY pushes a frozen op's end time."""

    def test_delayed_op_pushes_successors(self):
        wo = make_work_order(
            "WO1",
            release=MONDAY,
            due=MONDAY + timedelta(days=3),
            ops=[
                ("OP1", 60, ["M1"], 0),
                ("OP2", 60, ["M1", "M2"], 0),
            ],
        )
        initial = _run_initial_schedule([wo])

        # OP1 starts at 08:00, normally ends at 09:00. Delay to 12:00.
        delayed_end = datetime(2026, 1, 5, 12, 0, 0)

        event = DisruptionEvent(
            disruption_type=DisruptionType.OPERATION_DELAY,
            timestamp=NOW,
            operation_id="OP1",
            new_end=delayed_end,
        )

        handler = HandleDisruption()
        output = handler.execute(
            HandleDisruptionInput(
                event=event,
                current_schedule=initial.schedule,
                work_orders=[wo],
                machines=_machines(),
                calendars=[_calendar()],
                horizon_start=MONDAY,
                horizon_end=HORIZON_END,
            )
        )

        op1 = next(
            a for a in output.schedule.assignments if a.operation_id == "OP1"
        )
        op2 = next(
            a for a in output.schedule.assignments if a.operation_id == "OP2"
        )

        # OP1's end should be pushed to 12:00.
        assert op1.end == delayed_end
        # OP2 must start after the delayed OP1.
        assert op2.start >= delayed_end


class TestPrecedenceAfterReplan:
    """Dependencies must hold even after disruption re-planning."""

    def test_precedence_maintained(self):
        wo = make_work_order(
            "WO1",
            release=MONDAY,
            due=MONDAY + timedelta(days=3),
            ops=[
                ("OP1", 60, ["M1", "M2"], 0),
                ("OP2", 60, ["M1", "M2"], 0),
                ("OP3", 60, ["M1", "M2"], 0),
            ],
        )
        initial = _run_initial_schedule([wo])

        event = DisruptionEvent(
            disruption_type=DisruptionType.RUSH_ORDER,
            timestamp=NOW,
            rush_order=make_work_order(
                "RUSH",
                release=NOW,
                due=MONDAY + timedelta(days=2),
                ops=[("R1", 30, ["M1", "M2"], 0)],
            ),
        )

        handler = HandleDisruption()
        output = handler.execute(
            HandleDisruptionInput(
                event=event,
                current_schedule=initial.schedule,
                work_orders=[wo],
                machines=_machines(),
                calendars=[_calendar()],
                horizon_start=MONDAY,
                horizon_end=HORIZON_END,
            )
        )

        ends = {a.operation_id: a.end for a in output.schedule.assignments}
        starts = {a.operation_id: a.start for a in output.schedule.assignments}

        # OP1 -> OP2 -> OP3 precedence.
        assert starts["OP2"] >= ends["OP1"]
        assert starts["OP3"] >= ends["OP2"]
