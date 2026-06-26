"""WorkOrder entity."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime

from ..errors import ValidationError
from ..value_objects import (
    LotSizingPolicy,
    Priority,
    WorkOrderFirmness,
    WorkOrderStatus,
)
from .operation import Operation


@dataclass(slots=True)
class WorkOrder:
    """A manufacturing order — a unit of work to plan.

    Operations are intentionally stored as a list (not a dict) so ordering by
    ``sequence`` is explicit. The invariant "unique ids within a WO" is
    enforced in ``__post_init__``.
    """

    id: str
    name: str
    product_id: str
    quantity: int
    due_date: datetime
    release_date: datetime
    operations: list[Operation] = field(default_factory=list)
    priority: Priority = Priority.NORMAL
    status: WorkOrderStatus = WorkOrderStatus.RELEASED
    # V1.2 Cas 2 — defaults to FIRM so legacy WOs (created before the
    # field existed) behave exactly like before. Set explicitly to
    # FORECAST / TENTATIVE when the source is a forecasting module.
    firmness: WorkOrderFirmness = WorkOrderFirmness.FIRM
    lot_sizing: LotSizingPolicy = field(default_factory=LotSizingPolicy.none)
    organization_id: str | None = None
    workspace_id: str | None = None

    def __post_init__(self) -> None:
        if not self.id:
            raise ValidationError("WorkOrder.id is required")
        if self.quantity <= 0:
            raise ValidationError(f"WorkOrder.quantity must be > 0, got {self.quantity}")
        if self.due_date < self.release_date:
            raise ValidationError(
                f"WorkOrder {self.id}: due_date ({self.due_date}) must be >= "
                f"release_date ({self.release_date})"
            )

        seen_ids: set[str] = set()
        for op in self.operations:
            if op.work_order_id != self.id:
                raise ValidationError(
                    f"Operation {op.id} belongs to WO {op.work_order_id}, "
                    f"not {self.id}"
                )
            if op.id in seen_ids:
                raise ValidationError(f"Duplicate operation id {op.id} in WO {self.id}")
            seen_ids.add(op.id)

    def ordered_operations(self) -> list[Operation]:
        """Return operations sorted by sequence number."""
        return sorted(self.operations, key=lambda o: o.sequence)

    def operation_ids(self) -> set[str]:
        return {op.id for op in self.operations}
