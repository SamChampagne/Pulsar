"""Application-level pre-solve validation gate.

The domain already owns feasibility analysis. This module deliberately does
not duplicate those rules; it only decides whether a use case is allowed to
continue into a solver when hard blockers are present.
"""

from __future__ import annotations

from dataclasses import dataclass

from ...domain.errors import ValidationError
from ...domain.scheduling import SchedulingContext, check_feasibility
from ...domain.scheduling.feasibility import FeasibilityReport
from ..ports.schedule_repository import ScheduleRunMetadata


@dataclass(frozen=True, slots=True)
class PlanningValidationGateResult:
    """Structured outcome of the pre-solve validation gate."""

    mode: str
    feasibility: FeasibilityReport

    def as_diagnostics(self) -> dict[str, object]:
        return {
            "mode": self.mode,
            "status": "blocked" if self.feasibility.error_count else "passed",
            "readiness_status": self.feasibility.readiness_status,
            "error_count": self.feasibility.error_count,
            "warning_count": self.feasibility.warning_count,
            "dominant_issue_kind": self.feasibility.dominant_issue_kind,
            "next_best_action": self.feasibility.next_best_action,
        }


def enforce_planning_validation_gate(
    context: SchedulingContext,
    *,
    mode: str,
) -> PlanningValidationGateResult:
    """Run feasibility checks and block solver execution on hard errors."""

    feasibility = check_feasibility(context)
    result = PlanningValidationGateResult(mode=mode, feasibility=feasibility)
    if feasibility.error_count == 0:
        return result

    first_error = next(
        issue for issue in feasibility.issues if issue.severity.value == "error"
    )
    message = (
        f"Planning validation blocked {mode}: {first_error.message}"
    )
    if feasibility.next_best_action:
        message = f"{message} Next best action: {feasibility.next_best_action}."
    raise ValidationError(message)


def validate_schedule_scope(
    metadata: ScheduleRunMetadata | None,
    *,
    expected_organization_id: str | None,
    schedule_id: str,
    label: str,
) -> None:
    """Prevent a tenant-scoped run from using another tenant's schedule."""

    if expected_organization_id is None:
        return
    actual_organization_id = metadata.organization_id if metadata is not None else None
    if actual_organization_id == expected_organization_id:
        return
    raise ValidationError(
        f"{label} schedule {schedule_id!r} belongs to organization "
        f"{actual_organization_id!r}, not {expected_organization_id!r}."
    )
