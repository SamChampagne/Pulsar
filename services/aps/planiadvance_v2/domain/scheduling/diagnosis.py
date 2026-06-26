"""Structured infeasibility diagnosis.

When a scheduling run fails, "no slot found" is the least useful message a
planner can receive. An industrial-grade engine should report:

1. *Which* operation(s) could not be placed;
2. *Why* each candidate (machine, resource) was rejected;
3. What the planner can change to make the problem feasible (extend the
   horizon, add capacity, relax a due date ...).

This module defines the data structures for that diagnosis. They are pure
data (no I/O, no logging) so they can be embedded in exception payloads,
API responses and log lines without coupling the core to any framework.

Design inspired by CP-SAT "UNSAT core" / MUS (Minimal Unsatisfiable
Subset) but kept much lighter-weight — we don't enumerate every possible
witness, we aggregate rejections per operation.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from enum import StrEnum


class BlockerKind(StrEnum):
    """Why a candidate placement was refused.

    Exhaustive enough that a planner can act on it without reading the
    source code, but small enough that a UI can surface every value as a
    distinct icon / colour.
    """

    NO_ELIGIBLE_MACHINE = "no_eligible_machine"
    HORIZON_TOO_SHORT = "horizon_too_short"
    CALENDAR_TOO_TIGHT = "calendar_too_tight"
    MACHINE_OVERLOADED = "machine_overloaded"
    RESOURCE_CAPACITY = "resource_capacity"
    MATERIAL_SHORTAGE = "material_shortage"
    DEPENDENCY_NOT_READY = "dependency_not_ready"
    DEPENDENCY_WINDOW = "dependency_window"
    DEPENDENCY_MAX_WAIT = "dependency_max_wait"
    CUSTOM_CONSTRAINT = "custom_constraint"
    DUE_DATE_UNREACHABLE = "due_date_unreachable"


@dataclass(frozen=True, slots=True)
class Blocker:
    """A single reason a placement was refused.

    Multiple blockers can apply to the same operation (one per candidate
    machine, plus cross-cutting ones like horizon).
    """

    kind: BlockerKind
    message: str
    machine_id: str | None = None
    resource_id: str | None = None
    material_id: str | None = None
    constraint_name: str | None = None

    def as_dict(self) -> dict[str, str | None]:
        return {
            "kind": self.kind.value,
            "message": self.message,
            "machine_id": self.machine_id,
            "resource_id": self.resource_id,
            "material_id": self.material_id,
            "constraint_name": self.constraint_name,
        }


@dataclass(slots=True)
class OperationDiagnosis:
    """All blockers for a single infeasible operation."""

    operation_id: str
    work_order_id: str
    earliest_possible_start: datetime | None
    blockers: list[Blocker] = field(default_factory=list)

    def add(self, blocker: Blocker) -> None:
        self.blockers.append(blocker)

    def has(
        self, kind: BlockerKind, *, machine_id: str | None = None
    ) -> bool:
        """True when a blocker matching ``kind`` (and optionally
        ``machine_id``) has already been recorded.

        Strategies use this to avoid stacking duplicate blockers when
        a machine is retried after a resource-driven rescan.
        """
        for blocker in self.blockers:
            if blocker.kind is not kind:
                continue
            if machine_id is not None and blocker.machine_id != machine_id:
                continue
            return True
        return False

    def as_dict(self) -> dict[str, object]:
        return {
            "operation_id": self.operation_id,
            "work_order_id": self.work_order_id,
            "earliest_possible_start": (
                self.earliest_possible_start.isoformat()
                if self.earliest_possible_start
                else None
            ),
            "blockers": [b.as_dict() for b in self.blockers],
        }


@dataclass(slots=True)
class InfeasibilityReport:
    """Full diagnosis for a scheduling run that could not complete.

    Attached to :class:`planiadvance_v2.domain.errors.InfeasibleScheduleError`
    so API callers get a rich structured payload instead of a flat string.
    """

    strategy: str
    scheduled_so_far: int
    total_operations: int
    operations: list[OperationDiagnosis] = field(default_factory=list)
    suggestions: list[str] = field(default_factory=list)

    @property
    def progress_ratio(self) -> float:
        if self.total_operations == 0:
            return 1.0
        return self.scheduled_so_far / self.total_operations

    @property
    def dominant_blocker_kind(self) -> str | None:
        counts: dict[BlockerKind, int] = {}
        for operation in self.operations:
            for blocker in operation.blockers:
                counts[blocker.kind] = counts.get(blocker.kind, 0) + 1
        if not counts:
            return None
        winner = max(
            counts.items(),
            key=lambda item: (
                item[1],
                1 if item[0] in {
                    BlockerKind.RESOURCE_CAPACITY,
                    BlockerKind.MACHINE_OVERLOADED,
                    BlockerKind.NO_ELIGIBLE_MACHINE,
                    BlockerKind.DEPENDENCY_NOT_READY,
                    BlockerKind.DEPENDENCY_MAX_WAIT,
                    BlockerKind.DEPENDENCY_WINDOW,
                } else 0,
            ),
        )[0]
        return winner.value

    @property
    def next_best_action(self) -> str | None:
        if not self.suggestions:
            return None
        return self.suggestions[0]

    @property
    def planner_focus(self) -> str:
        dominant = self.dominant_blocker_kind
        if dominant in {
            BlockerKind.RESOURCE_CAPACITY.value,
            BlockerKind.MACHINE_OVERLOADED.value,
            BlockerKind.CALENDAR_TOO_TIGHT.value,
            BlockerKind.HORIZON_TOO_SHORT.value,
        }:
            return "add_or_shift_capacity"
        if dominant in {
            BlockerKind.NO_ELIGIBLE_MACHINE.value,
            BlockerKind.CUSTOM_CONSTRAINT.value,
        }:
            return "repair_routing_or_rules"
        if dominant in {
            BlockerKind.DEPENDENCY_NOT_READY.value,
            BlockerKind.DEPENDENCY_WINDOW.value,
            BlockerKind.DEPENDENCY_MAX_WAIT.value,
        }:
            return "repair_precedence_or_release"
        if dominant == BlockerKind.DUE_DATE_UNREACHABLE.value:
            return "relax_due_dates"
        return "investigate_blockers"

    def add(self, diag: OperationDiagnosis) -> None:
        self.operations.append(diag)

    def suggest(self, message: str) -> None:
        if message and message not in self.suggestions:
            self.suggestions.append(message)

    def human_summary(self) -> str:
        if not self.operations:
            return f"[{self.strategy}] infeasible: no operation-level details."
        first = self.operations[0]
        lines = [
            f"[{self.strategy}] infeasible after placing "
            f"{self.scheduled_so_far}/{self.total_operations} operations.",
            f"Blocked on operation {first.operation_id} "
            f"(WO {first.work_order_id}):",
        ]
        for blocker in first.blockers[:5]:
            lines.append(f"  - {blocker.kind.value}: {blocker.message}")
        if self.suggestions:
            lines.append("Suggestions:")
            for s in self.suggestions:
                lines.append(f"  * {s}")
        return "\n".join(lines)

    def as_dict(self) -> dict[str, object]:
        return {
            "strategy": self.strategy,
            "scheduled_so_far": self.scheduled_so_far,
            "total_operations": self.total_operations,
            "progress_ratio": round(self.progress_ratio, 4),
            "dominant_blocker_kind": self.dominant_blocker_kind,
            "next_best_action": self.next_best_action,
            "planner_focus": self.planner_focus,
            "operations": [op.as_dict() for op in self.operations],
            "suggestions": list(self.suggestions),
        }
