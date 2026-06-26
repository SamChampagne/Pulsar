"""Material-related entities for supply-aware APS scheduling."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from ..errors import ValidationError


@dataclass(frozen=True, slots=True)
class MaterialRequirement:
    """Material consumed by an operation."""

    material_id: str
    quantity_per_unit: float = 0.0
    fixed_quantity: float = 0.0

    def __post_init__(self) -> None:
        if not self.material_id:
            raise ValidationError("MaterialRequirement.material_id is required")
        if self.quantity_per_unit < 0:
            raise ValidationError(
                f"MaterialRequirement {self.material_id}: quantity_per_unit must be >= 0"
            )
        if self.fixed_quantity < 0:
            raise ValidationError(
                f"MaterialRequirement {self.material_id}: fixed_quantity must be >= 0"
            )
        if self.quantity_per_unit == 0 and self.fixed_quantity == 0:
            raise ValidationError(
                f"MaterialRequirement {self.material_id}: at least one quantity must be > 0"
            )

    def required_quantity(self, work_order_quantity: int) -> float:
        return (self.quantity_per_unit * work_order_quantity) + self.fixed_quantity


@dataclass(frozen=True, slots=True)
class InventoryItem:
    """On-hand inventory available to the scheduler."""

    material_id: str
    quantity_on_hand: float
    as_of: datetime | None = None
    organization_id: str | None = None
    workspace_id: str | None = None

    def __post_init__(self) -> None:
        if not self.material_id:
            raise ValidationError("InventoryItem.material_id is required")
        if self.quantity_on_hand < 0:
            raise ValidationError(
                f"InventoryItem {self.material_id}: quantity_on_hand must be >= 0"
            )


@dataclass(frozen=True, slots=True)
class SupplyLot:
    """Incoming supply that becomes usable at a given timestamp."""

    id: str
    material_id: str
    quantity: float
    available_at: datetime
    source_type: str = "supply"
    organization_id: str | None = None
    workspace_id: str | None = None

    def __post_init__(self) -> None:
        if not self.id:
            raise ValidationError("SupplyLot.id is required")
        if not self.material_id:
            raise ValidationError("SupplyLot.material_id is required")
        if self.quantity <= 0:
            raise ValidationError(
                f"SupplyLot {self.id}: quantity must be > 0, got {self.quantity}"
            )
