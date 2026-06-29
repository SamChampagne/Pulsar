"""SQL-backed :class:`WorkOrderRepository` adapter.

Translates between the domain :class:`WorkOrder` / :class:`Operation`
entities and the normalized SQL schema (``work_orders``, ``operations``,
``operation_dependencies``, ``operation_eligible_machines``).
"""

from __future__ import annotations

from sqlalchemy import delete, select
from sqlalchemy.orm import Session, selectinload

from ....domain.entities import MaterialRequirement, Operation, WorkOrder
from ....domain.entities.operation import (
    DependencyLink,
    DependencyType,
    RoutingAlternative,
)
from ....domain.entities.resource import ResourceRequirement
from ....domain.value_objects import (
    Duration,
    LotSizingMode,
    LotSizingPolicy,
    OperationStatus,
    Priority,
    WorkOrderFirmness,
    WorkOrderStatus,
)
from ...scoping import ScopedRepositoryMixin
from ..models import (
    OperationDependencyModel,
    OperationEligibleMachineModel,
    OperationModel,
    OperationResourceRequirementModel,
    OperationRoutingAlternativeModel,
    WorkOrderModel,
)


class SqlWorkOrderRepository(ScopedRepositoryMixin[WorkOrder]):
    def __init__(self, session: Session) -> None:
        self._session = session

    def list_all(self) -> list[WorkOrder]:
        stmt = self._list_stmt()
        rows = self._session.execute(stmt).scalars().unique().all()
        return [self._to_domain(r) for r in rows]

    def list_for_organization(self, organization_id: str) -> list[WorkOrder]:
        stmt = self._list_stmt().where(WorkOrderModel.organization_id == organization_id)
        rows = self._session.execute(stmt).scalars().unique().all()
        return [self._to_domain(r) for r in rows]

    def list_for_scope(
        self,
        *,
        organization_id: str | None = None,
        workspace_id: str | None = None,
    ) -> list[WorkOrder]:
        stmt = self._list_stmt()
        if organization_id is not None:
            stmt = stmt.where(WorkOrderModel.organization_id == organization_id)
        if workspace_id is not None:
            stmt = stmt.where(WorkOrderModel.workspace_id == workspace_id)
        rows = self._session.execute(stmt).scalars().unique().all()
        return [self._to_domain(r) for r in rows]

    @staticmethod
    def _list_stmt():
        return select(WorkOrderModel).options(
            selectinload(WorkOrderModel.operations).selectinload(
                OperationModel.eligible_machines
            ),
            selectinload(WorkOrderModel.operations).selectinload(
                OperationModel.dependencies
            ),
            selectinload(WorkOrderModel.operations).selectinload(
                OperationModel.resource_requirements
            ),
            selectinload(WorkOrderModel.operations).selectinload(
                OperationModel.routing_alternatives
            ),
        )

    def get(self, work_order_id: str) -> WorkOrder | None:
        row = self._session.get(
            WorkOrderModel,
            work_order_id,
            options=[
                selectinload(WorkOrderModel.operations).selectinload(
                    OperationModel.eligible_machines
                ),
                selectinload(WorkOrderModel.operations).selectinload(
                    OperationModel.dependencies
                ),
                selectinload(WorkOrderModel.operations).selectinload(
                    OperationModel.resource_requirements
                ),
                selectinload(WorkOrderModel.operations).selectinload(
                    OperationModel.routing_alternatives
                ),
            ],
        )
        return self._to_domain(row) if row else None

    def add(self, work_order: WorkOrder) -> None:
        # Replace-on-conflict semantics: delete any prior rows for this WO
        # so merge semantics stay predictable (we own all child rows).
        self._session.execute(
            delete(WorkOrderModel).where(WorkOrderModel.id == work_order.id)
        )
        self._session.flush()

        wo_row = WorkOrderModel(
            id=work_order.id,
            name=work_order.name,
            organization_id=work_order.organization_id,
            workspace_id=work_order.workspace_id,
            product_id=work_order.product_id,
            quantity=work_order.quantity,
            due_date=work_order.due_date,
            release_date=work_order.release_date,
            priority=int(work_order.priority),
            status=work_order.status.value,
            firmness=work_order.firmness.value,
            lot_sizing_mode=work_order.lot_sizing.mode.name.lower(),
            lot_sizing_lot_size=work_order.lot_sizing.lot_size,
            lot_sizing_min=work_order.lot_sizing.min_lot_size,
            lot_sizing_max=work_order.lot_sizing.max_lot_size,
        )
        for op in work_order.operations:
            op_row = OperationModel(
                id=op.id,
                work_order_id=op.work_order_id,
                sequence=op.sequence,
                name=op.name,
                duration_minutes=op.duration.minutes,
                setup_minutes=op.setup_time.minutes,
                status=op.status.value,
                setup_family=op.setup_family,
                material_requirements_json=[
                    {
                        "material_id": req.material_id,
                        "quantity_per_unit": req.quantity_per_unit,
                        "fixed_quantity": req.fixed_quantity,
                    }
                    for req in op.material_requirements
                ] if op.material_requirements else None,
                preemptible=op.preemptible,
                min_chunk_minutes=op.min_chunk.minutes,
                actual_start=op.actual_start,
                actual_machine_id=op.actual_machine_id,
                actual_end=op.actual_end,
                remaining_duration_minutes=(
                    op.remaining_duration.minutes
                    if op.remaining_duration is not None
                    else None
                ),
                firm_until=op.firm_until,
                frozen_until=op.frozen_until,
            )
            op_row.eligible_machines = [
                OperationEligibleMachineModel(operation_id=op.id, machine_id=m)
                for m in op.eligible_machine_ids
            ]
            op_row.dependencies = [
                OperationDependencyModel(
                    operation_id=op.id,
                    depends_on_id=link.depends_on_id,
                    dependency_type=link.dependency_type.value,
                    lag_minutes=link.lag_minutes,
                    max_wait_minutes=link.max_wait_minutes,
                )
                for link in op.effective_dependency_links()
            ]
            op_row.resource_requirements = [
                OperationResourceRequirementModel(
                    operation_id=op.id,
                    resource_id=req.resource_id,
                    units=req.units,
                )
                for req in op.resource_requirements
            ]
            op_row.routing_alternatives = [
                OperationRoutingAlternativeModel(
                    operation_id=op.id,
                    machine_id=alt.machine_id,
                    duration_minutes=alt.duration.minutes,
                    setup_minutes=alt.setup_time.minutes,
                    resource_requirements_json=[
                        {"resource_id": rr.resource_id, "units": rr.units}
                        for rr in alt.resource_requirements
                    ] if alt.resource_requirements else None,
                )
                for alt in op.routings
            ]
            wo_row.operations.append(op_row)
        self._session.add(wo_row)

    def delete(self, work_order_id: str) -> None:
        self._session.execute(
            delete(WorkOrderModel).where(WorkOrderModel.id == work_order_id)
        )

    @staticmethod
    def _lot_sizing_from_row(row: WorkOrderModel) -> LotSizingPolicy:
        mode_str = getattr(row, "lot_sizing_mode", "none") or "none"
        mode_map = {
            "none": LotSizingMode.NONE,
            "fixed": LotSizingMode.FIXED,
            "min_max": LotSizingMode.MIN_MAX,
        }
        mode = mode_map.get(mode_str.lower(), LotSizingMode.NONE)
        return LotSizingPolicy(
            mode=mode,
            lot_size=getattr(row, "lot_sizing_lot_size", 0) or 0,
            min_lot_size=getattr(row, "lot_sizing_min", 0) or 0,
            max_lot_size=getattr(row, "lot_sizing_max", 0) or 0,
        )

    @staticmethod
    def _routing_alternatives_from_row(
        alt_rows: list[OperationRoutingAlternativeModel],
    ) -> list[RoutingAlternative]:
        result = []
        for alt in alt_rows:
            reqs: list[ResourceRequirement] = []
            if alt.resource_requirements_json:
                for rr in alt.resource_requirements_json:
                    reqs.append(
                        ResourceRequirement(
                            resource_id=rr["resource_id"],
                            units=rr.get("units", 1),
                        )
                    )
            result.append(
                RoutingAlternative(
                    machine_id=alt.machine_id,
                    duration=Duration(minutes=alt.duration_minutes),
                    setup_time=Duration(minutes=alt.setup_minutes),
                    resource_requirements=tuple(reqs),
                )
            )
        return result

    @classmethod
    def _to_domain(cls, row: WorkOrderModel) -> WorkOrder:
        operations = []
        for op in row.operations:
            legacy_dependencies: list[str] = []
            dependency_links: list[DependencyLink] = []
            for dep in op.dependencies:
                dep_type = getattr(dep, "dependency_type", "finish_to_start")
                lag_minutes = getattr(dep, "lag_minutes", 0)
                max_wait_minutes = getattr(dep, "max_wait_minutes", None)
                if (
                    dep_type == DependencyType.FINISH_TO_START.value
                    and lag_minutes == 0
                    and max_wait_minutes is None
                ):
                    legacy_dependencies.append(dep.depends_on_id)
                    continue
                dependency_links.append(
                    DependencyLink(
                        depends_on_id=dep.depends_on_id,
                        dependency_type=DependencyType(dep_type),
                        lag_minutes=lag_minutes,
                        max_wait_minutes=max_wait_minutes,
                    )
                )

            operations.append(
                Operation(
                    id=op.id,
                    work_order_id=op.work_order_id,
                    sequence=op.sequence,
                    name=op.name,
                    duration=Duration(minutes=op.duration_minutes),
                    setup_time=Duration(minutes=op.setup_minutes),
                    eligible_machine_ids=[em.machine_id for em in op.eligible_machines],
                    dependencies=legacy_dependencies,
                    dependency_links=dependency_links,
                    status=OperationStatus(op.status),
                    setup_family=op.setup_family,
                    material_requirements=[
                        MaterialRequirement(
                            material_id=req["material_id"],
                            quantity_per_unit=req.get("quantity_per_unit", 0.0),
                            fixed_quantity=req.get("fixed_quantity", 0.0),
                        )
                        for req in (op.material_requirements_json or [])
                    ],
                    preemptible=op.preemptible,
                    min_chunk=Duration(minutes=op.min_chunk_minutes),
                    resource_requirements=[
                        ResourceRequirement(
                            resource_id=rr.resource_id, units=rr.units
                        )
                        for rr in op.resource_requirements
                    ],
                    routings=cls._routing_alternatives_from_row(
                        getattr(op, "routing_alternatives", []) or []
                    ),
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
            )
        return WorkOrder(
            id=row.id,
            name=row.name,
            product_id=row.product_id,
            quantity=row.quantity,
            due_date=row.due_date,
            release_date=row.release_date,
            operations=operations,
            priority=Priority(row.priority),
            status=WorkOrderStatus(row.status),
            firmness=WorkOrderFirmness(row.firmness or "firm"),
            lot_sizing=cls._lot_sizing_from_row(row),
            organization_id=row.organization_id,
            workspace_id=row.workspace_id,
        )
