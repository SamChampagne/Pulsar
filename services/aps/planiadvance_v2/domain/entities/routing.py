"""Routing entity: a product recipe / manufacturing template.

A routing describes *how* to produce a product (which operations, in which
order, on which machines), independent of any specific work order. When a
new work order is released for a product, its operations can be generated
from the product's routing.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from ..errors import ValidationError
from ..value_objects import Duration


@dataclass(slots=True)
class RoutingStep:
    sequence: int
    name: str
    duration: Duration
    eligible_machine_ids: list[str]
    setup_time: Duration = field(default_factory=Duration.zero)

    def __post_init__(self) -> None:
        if self.sequence < 1:
            raise ValidationError(f"RoutingStep sequence must be >= 1, got {self.sequence}")
        if not self.eligible_machine_ids:
            raise ValidationError(
                f"RoutingStep {self.name} must have at least one eligible machine"
            )


@dataclass(slots=True)
class Routing:
    id: str
    product_id: str
    name: str
    steps: list[RoutingStep] = field(default_factory=list)

    def __post_init__(self) -> None:
        if not self.id:
            raise ValidationError("Routing.id is required")
        if not self.steps:
            raise ValidationError(f"Routing {self.id} must have at least one step")
        sequences = [s.sequence for s in self.steps]
        if len(set(sequences)) != len(sequences):
            raise ValidationError(f"Routing {self.id} has duplicate step sequences")

    def ordered_steps(self) -> list[RoutingStep]:
        return sorted(self.steps, key=lambda s: s.sequence)
