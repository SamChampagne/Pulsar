"""Domain-specific exceptions.

Keeping domain errors separate from HTTP/DB exceptions allows the
application/api layer to translate them into the right status codes without
leaking infrastructure concerns into the core.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:  # pragma: no cover - typing only
    from .scheduling.diagnosis import InfeasibilityReport


class DomainError(Exception):
    """Base class for all domain errors."""


class ValidationError(DomainError):
    """Raised when an entity or value object fails invariants."""


class SchedulingError(DomainError):
    """Base class for scheduling failures."""


class InfeasibleScheduleError(SchedulingError):
    """Raised when no feasible slot can be found for an operation.

    Typical causes: empty eligible machine list, all machines overloaded,
    or a deadline that cannot be met within the planning horizon.

    An optional :class:`InfeasibilityReport` can be attached so callers
    can display structured diagnostics (one blocker per candidate machine,
    resource or custom constraint) instead of a flat message.
    """

    def __init__(
        self,
        message: str,
        *,
        report: InfeasibilityReport | None = None,
    ) -> None:
        super().__init__(message)
        self.report = report

    def __str__(self) -> str:  # pragma: no cover - trivial
        base = super().__str__()
        if self.report is None:
            return base
        return f"{base}\n{self.report.human_summary()}"


class CircularDependencyError(SchedulingError):
    """Raised when operations contain a dependency cycle."""


class UnknownResourceError(SchedulingError):
    """Raised when an operation references an unknown machine or calendar."""
