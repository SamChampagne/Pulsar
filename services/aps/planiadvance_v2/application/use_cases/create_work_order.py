"""Use case: create a new work order.

The use case accepts a plain DTO so that the API layer can deserialize
Pydantic into it without the domain knowing about Pydantic.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime

from ...domain.entities import MaterialRequirement, Operation, WorkOrder
from ...domain.entities.operation import (
    DependencyLink,
    DependencyType,
    RoutingAlternative,
)
from ...domain.entities.resource import ResourceRequirement
from ...domain.value_objects import (
    Duration,
    LotSizingPolicy,
    Priority,
    WorkOrderFirmness,
)
from ..ports import WorkOrderRepository


@dataclass(slots=True)
class ResourceRequirementInput:
    resource_id: str
    units: int = 1


@dataclass(slots=True)
class MaterialRequirementInput:
    material_id: str
    quantity_per_unit: float = 0.0
    fixed_quantity: float = 0.0


@dataclass(slots=True)
class RoutingAlternativeInput:
    machine_id: str
    duration_minutes: int
    setup_minutes: int = 0
    resource_requirements: list[ResourceRequirementInput] = field(default_factory=list)


@dataclass(slots=True)
class DependencyLinkInput:
    depends_on_id: str
    dependency_type: str = DependencyType.FINISH_TO_START.value
    lag_minutes: int = 0
    max_wait_minutes: int | None = None


@dataclass(slots=True)
class OperationInput:
    id: str
    sequence: int
    name: str
    duration_minutes: int
    eligible_machine_ids: list[str]
    setup_minutes: int = 0
    dependencies: list[str] = field(default_factory=list)
    dependency_links: list[DependencyLinkInput] = field(default_factory=list)
    setup_family: str | None = None
    preemptible: bool = False
    min_chunk_minutes: int = 0
    resource_requirements: list[ResourceRequirementInput] = field(default_factory=list)
    material_requirements: list[MaterialRequirementInput] = field(default_factory=list)
    routings: list[RoutingAlternativeInput] = field(default_factory=list)
    actual_start: datetime | None = None
    actual_machine_id: str | None = None
    actual_end: datetime | None = None
    remaining_duration_minutes: int | None = None
    firm_until: datetime | None = None
    frozen_until: datetime | None = None


@dataclass(slots=True)
class CreateWorkOrderInput:
    id: str
    name: str
    product_id: str
    quantity: int
    due_date: datetime
    release_date: datetime
    operations: list[OperationInput]
    priority: Priority = Priority.NORMAL
    firmness: WorkOrderFirmness = WorkOrderFirmness.FIRM
    lot_sizing: LotSizingPolicy = field(default_factory=LotSizingPolicy.none)
    organization_id: str | None = None
    workspace_id: str | None = None


class CreateWorkOrder:
    def __init__(self, repository: WorkOrderRepository) -> None:
        self._repository = repository

    def execute(self, command: CreateWorkOrderInput) -> WorkOrder:
        operations = [
            Operation(
                id=op.id,
                work_order_id=command.id,
                sequence=op.sequence,
                name=op.name,
                duration=Duration(minutes=op.duration_minutes),
                setup_time=Duration(minutes=op.setup_minutes),
                eligible_machine_ids=list(op.eligible_machine_ids),
                dependencies=list(op.dependencies),
                dependency_links=[
                    DependencyLink(
                        depends_on_id=link.depends_on_id,
                        dependency_type=DependencyType(link.dependency_type),
                        lag_minutes=link.lag_minutes,
                        max_wait_minutes=link.max_wait_minutes,
                    )
                    for link in op.dependency_links
                ],
                setup_family=op.setup_family,
                preemptible=op.preemptible,
                min_chunk=Duration(minutes=op.min_chunk_minutes),
                resource_requirements=[
                    ResourceRequirement(
                        resource_id=rr.resource_id, units=rr.units
                    )
                    for rr in op.resource_requirements
                ],
                material_requirements=[
                    MaterialRequirement(
                        material_id=req.material_id,
                        quantity_per_unit=req.quantity_per_unit,
                        fixed_quantity=req.fixed_quantity,
                    )
                    for req in op.material_requirements
                ],
                routings=[
                    RoutingAlternative(
                        machine_id=alt.machine_id,
                        duration=Duration(minutes=alt.duration_minutes),
                        setup_time=Duration(minutes=alt.setup_minutes),
                        resource_requirements=tuple(
                            ResourceRequirement(
                                resource_id=rr.resource_id, units=rr.units
                            )
                            for rr in alt.resource_requirements
                        ),
                    )
                    for alt in op.routings
                ],
                actual_start=op.actual_start,
                actual_machine_id=op.actual_machine_id,
                actual_end=op.actual_end,
                remaining_duration=(
                    Duration(minutes=op.remaining_duration_minutes)
                    if op.remaining_duration_minutes is not None
                    else None
                ),
                firm_until=op.firm_until,
                frozen_until=op.frozen_until,
            )
            for op in command.operations
        ]
        work_order = WorkOrder(
            id=command.id,
            name=command.name,
            product_id=command.product_id,
            quantity=command.quantity,
            due_date=command.due_date,
            release_date=command.release_date,
            operations=operations,
            priority=command.priority,
            firmness=command.firmness,
            lot_sizing=command.lot_sizing,
            organization_id=command.organization_id,
            workspace_id=command.workspace_id,
        )
        self._repository.add(work_order)
        return work_order
