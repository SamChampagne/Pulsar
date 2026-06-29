"""Machine entity.

A machine is a unary (capacity 1) primary resource. Secondary resources
with higher capacity (operator pools, tool cribs, consumables) are
represented by the separate :class:`Resource` entity so that callers who
don't need them can keep ignoring capacity altogether.

Industrial-grade features
-------------------------
``setup_matrix``
    Optional sequence-dependent setup time matrix. When present, the
    scheduler uses it instead of the per-operation fixed ``setup_time``
    whenever the operation declares a ``setup_family``. When ``None`` (or
    when the operation has no family), the legacy fixed setup is used —
    this preserves backwards compatibility of all existing tests.
``maintenance_windows``
    Planned downtime on this specific machine — preventive maintenance,
    tooling swap, annual inspection... These windows are subtracted from
    the working calendar when computing the effective availability, so no
    operation can ever be placed over them. Works consistently in greedy
    and CP-SAT.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from ..errors import ValidationError
from ..value_objects import SetupMatrix, TimeWindow


@dataclass(slots=True)
class Machine:
    id: str
    name: str
    calendar_id: str
    capabilities: list[str] = field(default_factory=list)
    efficiency: float = 1.0
    setup_matrix: SetupMatrix | None = None
    maintenance_windows: list[TimeWindow] = field(default_factory=list)
    organization_id: str | None = None
    workspace_id: str | None = None

    def __post_init__(self) -> None:
        if not self.id:
            raise ValidationError("Machine.id is required")
        if not self.calendar_id:
            raise ValidationError(f"Machine {self.id} must have a calendar_id")
        if self.efficiency <= 0:
            raise ValidationError(
                f"Machine {self.id}: efficiency must be > 0, got {self.efficiency}"
            )
        if self.setup_matrix is not None and self.setup_matrix.machine_id != self.id:
            raise ValidationError(
                f"Machine {self.id}: setup_matrix.machine_id must match "
                f"(got {self.setup_matrix.machine_id!r})"
            )
        # Maintenance windows must be non-empty intervals. Overlaps are
        # allowed (two overlapping preventive tasks merge trivially).
        for mw in self.maintenance_windows:
            if mw.is_empty():
                raise ValidationError(
                    f"Machine {self.id}: maintenance window {mw} is empty"
                )

    def has_capability(self, capability: str) -> bool:
        return capability in self.capabilities
