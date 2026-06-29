"""Pre-solve feasibility checker and constraint relaxation advisor.

Before spending seconds in a CP-SAT solve or metaheuristic search, an
industrial APS engine should be able to detect obvious infeasibilities
in milliseconds and tell the planner *exactly* what to fix:

- "Machine M3 has 480 minutes of available time but 720 minutes of
  work assigned. Over-loaded by 240 min."
- "Operation OP5 requires machine M4 which does not exist."
- "Work order WO7 is released at Jan 10 but due at Jan 9."
- "The horizon is too short: 5 days of capacity but 8 days of work."

This module provides:

1. :func:`check_feasibility` — runs a battery of fast checks and
   returns a :class:`FeasibilityReport` with all detected issues.

2. :func:`suggest_relaxations` — given a feasibility report, generates
   concrete relaxation recommendations ranked by impact.

Both are pure functions with no side effects.

Check categories
----------------
``MISSING_MACHINE``
    An operation lists an eligible machine that doesn't exist.
``OVERLOADED_MACHINE``
    Total work assigned to a machine exceeds available calendar time.
``INVALID_DUE_DATE``
    A work order's due date is before its release date.
``HORIZON_TOO_SHORT``
    The horizon doesn't contain enough working time for all operations.
``DEPENDENCY_CYCLE``
    A circular dependency chain makes the problem infeasible.
``NO_ELIGIBLE_MACHINE``
    An operation has no eligible machines at all.
``UNREACHABLE_DUE_DATE``
    A work order's total processing time exceeds the time from release
    to due date (even ignoring contention).
``MATERIAL_SHORTAGE``
    Required material demand exceeds on-hand plus inbound supply.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import StrEnum

from .calendar_resolver import CalendarResolver
from .context import SchedulingContext
from .dependency_links import dependency_ids_for_operation


class IssueKind(StrEnum):
    MISSING_MACHINE = "missing_machine"
    OVERLOADED_MACHINE = "overloaded_machine"
    IMPOSSIBLE_RESOURCE_REQUIREMENT = "impossible_resource_requirement"
    MATERIAL_SHORTAGE = "material_shortage"
    INVALID_DUE_DATE = "invalid_due_date"
    HORIZON_TOO_SHORT = "horizon_too_short"
    DEPENDENCY_CYCLE = "dependency_cycle"
    NO_ELIGIBLE_MACHINE = "no_eligible_machine"
    UNREACHABLE_DUE_DATE = "unreachable_due_date"


class IssueSeverity(StrEnum):
    ERROR = "error"  # definitely infeasible
    WARNING = "warning"  # likely problematic but not provably infeasible


@dataclass(frozen=True, slots=True)
class FeasibilityIssue:
    """A single detected feasibility problem."""

    kind: IssueKind
    severity: IssueSeverity
    message: str
    operation_id: str | None = None
    work_order_id: str | None = None
    machine_id: str | None = None
    material_id: str | None = None

    def as_dict(self) -> dict:
        return {
            "kind": self.kind.value,
            "severity": self.severity.value,
            "message": self.message,
            "operation_id": self.operation_id,
            "work_order_id": self.work_order_id,
            "machine_id": self.machine_id,
            "material_id": self.material_id,
        }


@dataclass(frozen=True, slots=True)
class RelaxationSuggestion:
    """A concrete suggestion for making the problem feasible."""

    action: str
    impact: str
    priority: int  # lower = higher priority
    issue_kind: str | None = None
    target_ids: tuple[str, ...] = ()
    rationale: str | None = None
    expected_mode: str | None = None

    def as_dict(self) -> dict:
        return {
            "action": self.action,
            "impact": self.impact,
            "priority": self.priority,
            "issue_kind": self.issue_kind,
            "target_ids": list(self.target_ids),
            "rationale": self.rationale,
            "expected_mode": self.expected_mode,
        }


@dataclass(slots=True)
class FeasibilityReport:
    """Result of a pre-solve feasibility check."""

    issues: list[FeasibilityIssue] = field(default_factory=list)
    suggestions: list[RelaxationSuggestion] = field(default_factory=list)

    @property
    def is_feasible(self) -> bool:
        return not any(i.severity == IssueSeverity.ERROR for i in self.issues)

    @property
    def error_count(self) -> int:
        return sum(1 for i in self.issues if i.severity == IssueSeverity.ERROR)

    @property
    def warning_count(self) -> int:
        return sum(1 for i in self.issues if i.severity == IssueSeverity.WARNING)

    @property
    def readiness_status(self) -> str:
        if self.error_count > 0:
            return "blocked"
        if self.warning_count > 0:
            return "degraded"
        return "ready"

    @property
    def recommended_mode(self) -> str:
        if self.error_count > 0:
            return "repair_then_solve"
        if self.warning_count > 0:
            return "solve_with_caution"
        return "normal_solve"

    @property
    def dominant_issue_kind(self) -> str | None:
        if not self.issues:
            return None
        counts: dict[IssueKind, int] = {}
        for issue in self.issues:
            counts[issue.kind] = counts.get(issue.kind, 0) + 1
        winner = max(
            counts.items(),
            key=lambda item: (
                item[1],
                1 if item[0] in {
                    IssueKind.IMPOSSIBLE_RESOURCE_REQUIREMENT,
                    IssueKind.MATERIAL_SHORTAGE,
                    IssueKind.DEPENDENCY_CYCLE,
                    IssueKind.MISSING_MACHINE,
                    IssueKind.NO_ELIGIBLE_MACHINE,
                } else 0,
            ),
        )[0]
        return winner.value

    @property
    def next_best_action(self) -> str | None:
        if not self.suggestions:
            return None
        winner = min(
            self.suggestions,
            key=lambda suggestion: (suggestion.priority, suggestion.action),
        )
        return winner.action

    @property
    def planner_focus(self) -> str:
        if self.error_count > 0:
            return "repair_blockers"
        if self.warning_count > 0:
            return "monitor_risks"
        return "run_normally"

    def as_dict(self) -> dict:
        return {
            "is_feasible": self.is_feasible,
            "error_count": self.error_count,
            "warning_count": self.warning_count,
            "readiness_status": self.readiness_status,
            "recommended_mode": self.recommended_mode,
            "dominant_issue_kind": self.dominant_issue_kind,
            "next_best_action": self.next_best_action,
            "planner_focus": self.planner_focus,
            "issues": [i.as_dict() for i in self.issues],
            "suggestions": [s.as_dict() for s in self.suggestions],
        }

    def human_summary(self) -> str:
        if self.is_feasible and not self.issues:
            return "All pre-solve checks passed."
        lines = [
            f"Pre-solve check: {self.error_count} errors, "
            f"{self.warning_count} warnings.",
            f"Readiness: {self.readiness_status} "
            f"({self.recommended_mode}).",
        ]
        if self.next_best_action:
            lines.append(f"Next best action: {self.next_best_action}")
        for issue in self.issues[:10]:
            prefix = "ERROR" if issue.severity == IssueSeverity.ERROR else "WARN"
            lines.append(f"  [{prefix}] {issue.message}")
        if self.suggestions:
            lines.append("Suggestions:")
            for s in self.suggestions:
                lines.append(f"  {s.priority}. {s.action} — {s.impact}")
        return "\n".join(lines)


def check_feasibility(context: SchedulingContext) -> FeasibilityReport:
    """Run all pre-solve feasibility checks.

    Returns a :class:`FeasibilityReport` with all detected issues.
    This is fast (< 10 ms on typical instances) and should be called
    before every solve.
    """
    report = FeasibilityReport()

    machine_ids = {m.id for m in context.machines}
    resource_by_id = {r.id: r for r in context.resources}
    calendar_resolver = CalendarResolver(
        context.horizon_start,
        context.horizon_end,
    )
    calendar_by_id = {c.id: c for c in context.calendars}

    # Build op lookup and per-WO info.
    all_op_ids: set[str] = set()
    for wo in context.work_orders:
        for op in wo.operations:
            all_op_ids.add(op.id)

    # Check 1: Missing machines.
    for wo in context.work_orders:
        for op in wo.operations:
            for mid in op.eligible_machine_ids:
                if mid not in machine_ids:
                    report.issues.append(
                        FeasibilityIssue(
                            kind=IssueKind.MISSING_MACHINE,
                            severity=IssueSeverity.ERROR,
                            message=(
                                f"Operation {op.id} lists machine {mid} "
                                f"which does not exist."
                            ),
                            operation_id=op.id,
                            work_order_id=wo.id,
                            machine_id=mid,
                        )
                    )

    # Check 2: No eligible machines.
    for wo in context.work_orders:
        for op in wo.operations:
            if not op.eligible_machine_ids:
                report.issues.append(
                    FeasibilityIssue(
                        kind=IssueKind.NO_ELIGIBLE_MACHINE,
                        severity=IssueSeverity.ERROR,
                        message=(
                            f"Operation {op.id} has no eligible machines."
                        ),
                        operation_id=op.id,
                        work_order_id=wo.id,
                    )
                )

    # Check 3: Impossible secondary-resource requirements.
    for wo in context.work_orders:
        for op in wo.operations:
            for req in op.resource_requirements:
                resource = resource_by_id.get(req.resource_id)
                if resource is None:
                    continue
                if req.units > resource.capacity:
                    report.issues.append(
                        FeasibilityIssue(
                            kind=IssueKind.IMPOSSIBLE_RESOURCE_REQUIREMENT,
                            severity=IssueSeverity.ERROR,
                            message=(
                                f"Operation {op.id} requires {req.units} unit(s) of "
                                f"resource {resource.id}, but only {resource.capacity} "
                                f"are available."
                            ),
                            operation_id=op.id,
                            work_order_id=wo.id,
                        )
                    )

    # Check 4: Invalid due dates.
    for wo in context.work_orders:
        if wo.due_date < wo.release_date:
            report.issues.append(
                FeasibilityIssue(
                    kind=IssueKind.INVALID_DUE_DATE,
                    severity=IssueSeverity.ERROR,
                    message=(
                        f"Work order {wo.id} due date "
                        f"({wo.due_date.isoformat()}) is before release "
                        f"date ({wo.release_date.isoformat()})."
                    ),
                    work_order_id=wo.id,
                )
            )

    # Check 5: Material availability.
    report.issues.extend(_check_material_availability(context))

    # Check 6: Unreachable due dates (total processing > available window).
    for wo in context.work_orders:
        total_proc = sum(op.duration.minutes for op in wo.operations)
        available = int(
            (wo.due_date - wo.release_date).total_seconds() // 60
        )
        if total_proc > available and wo.due_date >= wo.release_date:
            report.issues.append(
                FeasibilityIssue(
                    kind=IssueKind.UNREACHABLE_DUE_DATE,
                    severity=IssueSeverity.WARNING,
                    message=(
                        f"Work order {wo.id} needs {total_proc} min of "
                        f"processing but only has {available} min between "
                        f"release and due date (even ignoring contention)."
                    ),
                    work_order_id=wo.id,
                )
            )

    # Check 7: Machine overload (total work vs. available calendar).
    machine_load: dict[str, int] = {}
    for wo in context.work_orders:
        for op in wo.operations:
            # Distribute load evenly across eligible machines for estimation.
            per_machine = max(
                op.duration.minutes // max(len(op.eligible_machine_ids), 1),
                1,
            )
            for mid in op.eligible_machine_ids:
                if mid in machine_ids:
                    machine_load[mid] = machine_load.get(mid, 0) + per_machine

    for machine in context.machines:
        cal = calendar_by_id.get(machine.calendar_id)
        if cal is None:
            continue
        available_windows = calendar_resolver.effective_windows(
            cal, machine.maintenance_windows
        )
        available_minutes = sum(
            int((w.end - w.start).total_seconds() // 60) for w in available_windows
        )
        load = machine_load.get(machine.id, 0)
        if available_minutes > 0 and load > available_minutes:
            overload = load - available_minutes
            report.issues.append(
                FeasibilityIssue(
                    kind=IssueKind.OVERLOADED_MACHINE,
                    severity=IssueSeverity.WARNING,
                    message=(
                        f"Machine {machine.id} has {available_minutes} min "
                        f"of calendar time but {load} min of estimated "
                        f"work. Over-loaded by {overload} min."
                    ),
                    machine_id=machine.id,
                )
            )

    # Check 8: Horizon too short.
    total_work = sum(
        op.duration.minutes
        for wo in context.work_orders
        for op in wo.operations
    )
    total_capacity = 0
    for machine in context.machines:
        cal = calendar_by_id.get(machine.calendar_id)
        if cal is None:
            continue
        windows = calendar_resolver.effective_windows(
            cal, machine.maintenance_windows
        )
        total_capacity += sum(
            int((w.end - w.start).total_seconds() // 60) for w in windows
        )
    if total_capacity > 0 and total_work > total_capacity:
        report.issues.append(
            FeasibilityIssue(
                kind=IssueKind.HORIZON_TOO_SHORT,
                severity=IssueSeverity.WARNING,
                message=(
                    f"Total work ({total_work} min) exceeds total "
                    f"machine capacity ({total_capacity} min) in the "
                    f"horizon."
                ),
            )
        )

    # Check 9: Dependency cycles.
    cycle_ops = _find_dependency_cycle(context)
    if cycle_ops:
        report.issues.append(
            FeasibilityIssue(
                kind=IssueKind.DEPENDENCY_CYCLE,
                severity=IssueSeverity.ERROR,
                message=(
                    f"Dependency cycle detected involving: "
                    f"{', '.join(cycle_ops)}."
                ),
            )
        )

    # Generate relaxation suggestions.
    report.suggestions = suggest_relaxations(report, context)

    return report


def _check_material_availability(context: SchedulingContext) -> list[FeasibilityIssue]:
    issues: list[FeasibilityIssue] = []
    supply_events: dict[str, list[tuple[object, float]]] = {}

    for item in context.inventory_items:
        supply_events.setdefault(item.material_id, []).append(
            (item.as_of or context.horizon_start, float(item.quantity_on_hand))
        )
    for supply in context.supplies:
        supply_events.setdefault(supply.material_id, []).append(
            (supply.available_at, float(supply.quantity))
        )

    demand_events: dict[str, list[tuple[object, float, str, str]]] = {}
    for wo in context.work_orders:
        demand_at = max(context.horizon_start, wo.release_date)
        for op in wo.operations:
            for req in op.material_requirements:
                demand_qty = float(req.required_quantity(wo.quantity))
                if demand_qty <= 0:
                    continue
                demand_events.setdefault(req.material_id, []).append(
                    (demand_at, demand_qty, wo.id, op.id)
                )

    for material_id, demands in demand_events.items():
        available = 0.0
        supplies = sorted(supply_events.get(material_id, []), key=lambda item: item[0])
        total_available = round(sum(quantity for _, quantity in supplies), 3)
        total_required = round(sum(quantity for _, quantity, _, _ in demands), 3)
        supply_index = 0

        for demand_at, demand_qty, work_order_id, operation_id in sorted(
            demands,
            key=lambda item: item[0],
        ):
            while supply_index < len(supplies) and supplies[supply_index][0] <= demand_at:
                available += supplies[supply_index][1]
                supply_index += 1
            available -= demand_qty
            if available < 0:
                issues.append(
                    FeasibilityIssue(
                        kind=IssueKind.MATERIAL_SHORTAGE,
                        severity=IssueSeverity.ERROR,
                        message=(
                            f"Operation {operation_id} in work order {work_order_id} "
                            f"requires material {material_id}, but supply is short by "
                            f"{round(abs(available), 3)} units at {demand_at.isoformat()} "
                            f"(required {total_required}, available by horizon {total_available})."
                        ),
                        operation_id=operation_id,
                        work_order_id=work_order_id,
                        material_id=material_id,
                    )
                )
                break

    return issues


def suggest_relaxations(
    report: FeasibilityReport,
    context: SchedulingContext,
) -> list[RelaxationSuggestion]:
    """Generate ranked relaxation suggestions from feasibility issues."""
    suggestions: list[RelaxationSuggestion] = []
    priority = 1

    kinds_found = {i.kind for i in report.issues}

    if IssueKind.MISSING_MACHINE in kinds_found:
        missing = {
            i.machine_id
            for i in report.issues
            if i.kind == IssueKind.MISSING_MACHINE and i.machine_id
        }
        suggestions.append(
            RelaxationSuggestion(
                action=f"Add missing machine(s): {', '.join(sorted(missing))}",
                impact="Removes eligibility errors for affected operations.",
                priority=priority,
                issue_kind=IssueKind.MISSING_MACHINE.value,
                target_ids=tuple(sorted(missing)),
                rationale="Eligible-machine references point to machines absent from the workshop model.",
                expected_mode="repair_then_solve",
            )
        )
        priority += 1

    if IssueKind.IMPOSSIBLE_RESOURCE_REQUIREMENT in kinds_found:
        impossible = sorted(
            {
                i.operation_id
                for i in report.issues
                if i.kind == IssueKind.IMPOSSIBLE_RESOURCE_REQUIREMENT
                and i.operation_id
            }
        )
        suggestions.append(
            RelaxationSuggestion(
                action=(
                    "Reduce required units or increase resource capacity for "
                    f"operation(s): {', '.join(impossible)}"
                ),
                impact=(
                    "Removes requirements that are impossible even before "
                    "sequencing."
                ),
                priority=priority,
                issue_kind=IssueKind.IMPOSSIBLE_RESOURCE_REQUIREMENT.value,
                target_ids=tuple(impossible),
                rationale="Some operations ask for more secondary-resource units than the plant physically owns.",
                expected_mode="repair_then_solve",
            )
        )
        priority += 1

    if IssueKind.MATERIAL_SHORTAGE in kinds_found:
        materials = sorted(
            {
                i.material_id
                for i in report.issues
                if i.kind == IssueKind.MATERIAL_SHORTAGE and i.material_id
            }
        )
        suggestions.append(
            RelaxationSuggestion(
                action=(
                    "Expedite or reallocate material supply for material(s): "
                    f"{', '.join(materials)}"
                ),
                impact="Removes hard supply shortages before sequencing starts.",
                priority=priority,
                issue_kind=IssueKind.MATERIAL_SHORTAGE.value,
                target_ids=tuple(materials),
                rationale="Current on-hand plus inbound supply is insufficient for at least one required operation.",
                expected_mode="repair_then_solve",
            )
        )
        priority += 1

    if IssueKind.DEPENDENCY_CYCLE in kinds_found:
        suggestions.append(
            RelaxationSuggestion(
                action="Break the dependency cycle by removing one constraint.",
                impact="Makes the problem solvable.",
                priority=priority,
                issue_kind=IssueKind.DEPENDENCY_CYCLE.value,
                rationale="Circular precedence prevents any topological execution order.",
                expected_mode="repair_then_solve",
            )
        )
        priority += 1

    if IssueKind.INVALID_DUE_DATE in kinds_found:
        suggestions.append(
            RelaxationSuggestion(
                action="Fix work order due dates that precede release dates.",
                impact="Removes logical contradictions.",
                priority=priority,
                issue_kind=IssueKind.INVALID_DUE_DATE.value,
                rationale="A work order cannot be due before it is released to production.",
                expected_mode="repair_then_solve",
            )
        )
        priority += 1

    if IssueKind.HORIZON_TOO_SHORT in kinds_found:
        total_work = sum(
            op.duration.minutes
            for wo in context.work_orders
            for op in wo.operations
        )
        num_machines = len(context.machines) or 1
        needed_days = (total_work / num_machines) / (8 * 60)  # assume 8h shifts
        suggestions.append(
            RelaxationSuggestion(
                action=(
                    f"Extend the planning horizon to at least "
                    f"{int(needed_days) + 1} working days."
                ),
                impact="Provides enough calendar capacity for all operations.",
                priority=priority,
                issue_kind=IssueKind.HORIZON_TOO_SHORT.value,
                rationale="The current horizon does not contain enough total machine time to absorb all demand.",
                expected_mode="solve_with_caution",
            )
        )
        priority += 1

    if IssueKind.OVERLOADED_MACHINE in kinds_found:
        overloaded = {
            i.machine_id
            for i in report.issues
            if i.kind == IssueKind.OVERLOADED_MACHINE and i.machine_id
        }
        suggestions.append(
            RelaxationSuggestion(
                action=(
                    f"Add capacity to overloaded machine(s): "
                    f"{', '.join(sorted(overloaded))} — extend shifts, "
                    f"add overtime, or add parallel machines."
                ),
                impact="Reduces machine contention.",
                priority=priority,
                issue_kind=IssueKind.OVERLOADED_MACHINE.value,
                target_ids=tuple(sorted(overloaded)),
                rationale="Estimated assigned work on these machines exceeds their available calendar windows.",
                expected_mode="solve_with_caution",
            )
        )
        priority += 1

    if IssueKind.UNREACHABLE_DUE_DATE in kinds_found:
        wo_ids = {
            i.work_order_id
            for i in report.issues
            if i.kind == IssueKind.UNREACHABLE_DUE_DATE and i.work_order_id
        }
        suggestions.append(
            RelaxationSuggestion(
                action=(
                    f"Relax due dates for work orders: "
                    f"{', '.join(sorted(wo_ids))}."
                ),
                impact="Allows enough processing time to complete the work.",
                priority=priority,
                issue_kind=IssueKind.UNREACHABLE_DUE_DATE.value,
                target_ids=tuple(sorted(wo_ids)),
                rationale="The release-to-due window is shorter than required processing time, even before contention.",
                expected_mode="solve_with_caution",
            )
        )
        priority += 1

    if IssueKind.NO_ELIGIBLE_MACHINE in kinds_found:
        op_ids = sorted(
            {
                i.operation_id
                for i in report.issues
                if i.kind == IssueKind.NO_ELIGIBLE_MACHINE and i.operation_id
            }
        )
        suggestions.append(
            RelaxationSuggestion(
                action=(
                    "Add eligible machines or routings for operation(s): "
                    f"{', '.join(op_ids)}."
                ),
                impact="Makes blocked operations schedulable.",
                priority=priority,
                issue_kind=IssueKind.NO_ELIGIBLE_MACHINE.value,
                target_ids=tuple(op_ids),
                rationale="These operations currently have no valid machine path through the workshop.",
                expected_mode="repair_then_solve",
            )
        )
        priority += 1

    return sorted(
        suggestions,
        key=lambda suggestion: (
            _suggestion_rank(suggestion.issue_kind),
            suggestion.priority,
            suggestion.action,
        ),
    )


def _suggestion_rank(issue_kind: str | None) -> int:
    if issue_kind == IssueKind.MISSING_MACHINE.value:
        return 10
    if issue_kind == IssueKind.IMPOSSIBLE_RESOURCE_REQUIREMENT.value:
        return 20
    if issue_kind == IssueKind.MATERIAL_SHORTAGE.value:
        return 25
    if issue_kind == IssueKind.DEPENDENCY_CYCLE.value:
        return 30
    if issue_kind == IssueKind.INVALID_DUE_DATE.value:
        return 40
    if issue_kind == IssueKind.NO_ELIGIBLE_MACHINE.value:
        return 50
    if issue_kind == IssueKind.OVERLOADED_MACHINE.value:
        return 60
    if issue_kind == IssueKind.UNREACHABLE_DUE_DATE.value:
        return 70
    if issue_kind == IssueKind.HORIZON_TOO_SHORT.value:
        return 80
    return 999


def _find_dependency_cycle(context: SchedulingContext) -> list[str]:
    """Detect a dependency cycle via DFS. Returns op IDs in the cycle or []."""
    # Build adjacency list.
    deps: dict[str, list[str]] = {}
    for wo in context.work_orders:
        for op in wo.operations:
            deps[op.id] = dependency_ids_for_operation(wo, op)

    WHITE, GRAY, BLACK = 0, 1, 2
    color: dict[str, int] = {op_id: WHITE for op_id in deps}
    parent: dict[str, str | None] = {}

    def dfs(node: str) -> list[str] | None:
        color[node] = GRAY
        for dep_id in deps.get(node, []):
            if dep_id not in color:
                continue
            if color[dep_id] == GRAY:
                # Found a cycle — trace it back.
                cycle = [dep_id, node]
                current = parent.get(node)
                while current and current != dep_id:
                    cycle.append(current)
                    current = parent.get(current)
                return list(reversed(cycle))
            if color[dep_id] == WHITE:
                parent[dep_id] = node
                result = dfs(dep_id)
                if result:
                    return result
        color[node] = BLACK
        return None

    for op_id in deps:
        if color[op_id] == WHITE:
            parent[op_id] = None
            result = dfs(op_id)
            if result:
                return result
    return []
