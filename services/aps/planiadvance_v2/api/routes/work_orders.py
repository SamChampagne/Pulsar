"""Work order CRUD endpoints."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from ...application.use_cases import (
    CreateWorkOrder,
    DeleteWorkOrder,
    GetWorkOrder,
    ListWorkOrders,
)
from ...application.use_cases.create_work_order import (
    CreateWorkOrderInput,
    DependencyLinkInput,
    MaterialRequirementInput,
    OperationInput,
    ResourceRequirementInput,
    RoutingAlternativeInput,
)
from ...domain.value_objects import (
    LotSizingMode,
    LotSizingPolicy,
    Priority,
    WorkOrderFirmness,
)
from ..dependencies import (
    get_create_work_order,
    get_delete_work_order,
    get_get_work_order,
    get_list_work_orders,
)
from ..schemas import (
    DependencyLinkOut,
    LotSizingOut,
    MaterialRequirementOut,
    OperationOut,
    ResourceRequirementOut,
    RoutingAlternativeOut,
    WorkOrderIn,
    WorkOrderOut,
)
from ..tenant import (
    TenantContext,
    get_tenant_context,
    resolve_scoped_organization_id,
    resolve_scoped_workspace_id,
)

router = APIRouter(prefix="/work-orders", tags=["work-orders"])


def _work_order_to_out(wo) -> WorkOrderOut:
    return WorkOrderOut(
        id=wo.id,
        name=wo.name,
        product_id=wo.product_id,
        quantity=wo.quantity,
        due_date=wo.due_date,
        release_date=wo.release_date,
        priority=int(wo.priority),
        status=wo.status.value,
        firmness=wo.firmness.value,
        organization_id=wo.organization_id,
        workspace_id=wo.workspace_id,
        lot_sizing=LotSizingOut(
            mode=wo.lot_sizing.mode.name.lower(),
            lot_size=wo.lot_sizing.lot_size,
            min_lot_size=wo.lot_sizing.min_lot_size,
            max_lot_size=wo.lot_sizing.max_lot_size,
        ),
        operations=[
            OperationOut(
                id=op.id,
                sequence=op.sequence,
                name=op.name,
                duration_minutes=op.duration.minutes,
                setup_minutes=op.setup_time.minutes,
                eligible_machine_ids=list(op.eligible_machine_ids),
                dependencies=list(op.dependencies),
                dependency_links=[
                    DependencyLinkOut(
                        depends_on_id=link.depends_on_id,
                        dependency_type=link.dependency_type.value,
                        lag_minutes=link.lag_minutes,
                        max_wait_minutes=link.max_wait_minutes,
                    )
                    for link in op.dependency_links
                ],
                status=op.status.value,
                setup_family=op.setup_family,
                preemptible=op.preemptible,
                min_chunk_minutes=op.min_chunk.minutes,
                resource_requirements=[
                    ResourceRequirementOut(
                        resource_id=req.resource_id,
                        units=req.units,
                    )
                    for req in op.resource_requirements
                ],
                material_requirements=[
                    MaterialRequirementOut(
                        material_id=req.material_id,
                        quantity_per_unit=req.quantity_per_unit,
                        fixed_quantity=req.fixed_quantity,
                    )
                    for req in op.material_requirements
                ],
                routings=[
                    RoutingAlternativeOut(
                        machine_id=alt.machine_id,
                        duration_minutes=alt.duration.minutes,
                        setup_minutes=alt.setup_time.minutes,
                        resource_requirements=[
                            ResourceRequirementOut(
                                resource_id=req.resource_id,
                                units=req.units,
                            )
                            for req in alt.resource_requirements
                        ],
                    )
                    for alt in op.routings
                ],
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
            for op in wo.ordered_operations()
        ],
    )


@router.get("", response_model=list[WorkOrderOut])
def list_work_orders(
    use_case: ListWorkOrders = Depends(get_list_work_orders),
    tenant: TenantContext = Depends(get_tenant_context),
) -> list[WorkOrderOut]:
    return [
        _work_order_to_out(wo)
        for wo in use_case.execute(
            organization_id=tenant.organization_id,
            workspace_id=tenant.workspace_id,
        )
    ]


@router.post("", response_model=WorkOrderOut, status_code=201)
def create_work_order(
    payload: WorkOrderIn,
    use_case: CreateWorkOrder = Depends(get_create_work_order),
    tenant: TenantContext = Depends(get_tenant_context),
) -> WorkOrderOut:
    organization_id = resolve_scoped_organization_id(tenant, payload.organization_id)
    workspace_id = resolve_scoped_workspace_id(tenant, payload.workspace_id)

    lot_sizing = LotSizingPolicy.none()
    if payload.lot_sizing is not None:
        mode_map = {
            "none": LotSizingMode.NONE,
            "fixed": LotSizingMode.FIXED,
            "min_max": LotSizingMode.MIN_MAX,
        }
        mode = mode_map.get(payload.lot_sizing.mode.lower(), LotSizingMode.NONE)
        lot_sizing = LotSizingPolicy(
            mode=mode,
            lot_size=payload.lot_sizing.lot_size,
            min_lot_size=payload.lot_sizing.min_lot_size,
            max_lot_size=payload.lot_sizing.max_lot_size,
        )

    wo = use_case.execute(
        CreateWorkOrderInput(
            id=payload.id,
            name=payload.name,
            product_id=payload.product_id,
            quantity=payload.quantity,
            due_date=payload.due_date,
            release_date=payload.release_date,
            priority=Priority(payload.priority),
            firmness=WorkOrderFirmness(payload.firmness),
            lot_sizing=lot_sizing,
            organization_id=organization_id,
            workspace_id=workspace_id,
            operations=[
                OperationInput(
                    id=op.id,
                    sequence=op.sequence,
                    name=op.name,
                    duration_minutes=op.duration_minutes,
                    setup_minutes=op.setup_minutes,
                    eligible_machine_ids=op.eligible_machine_ids,
                    dependencies=op.dependencies,
                    dependency_links=[
                        DependencyLinkInput(
                            depends_on_id=link.depends_on_id,
                            dependency_type=link.dependency_type,
                            lag_minutes=link.lag_minutes,
                            max_wait_minutes=link.max_wait_minutes,
                        )
                        for link in op.dependency_links
                    ],
                    setup_family=op.setup_family,
                    preemptible=op.preemptible,
                    min_chunk_minutes=op.min_chunk_minutes,
                    resource_requirements=[
                        ResourceRequirementInput(
                            resource_id=rr.resource_id, units=rr.units
                        )
                        for rr in op.resource_requirements
                    ],
                    material_requirements=[
                        MaterialRequirementInput(
                            material_id=req.material_id,
                            quantity_per_unit=req.quantity_per_unit,
                            fixed_quantity=req.fixed_quantity,
                        )
                        for req in op.material_requirements
                    ],
                    routings=[
                        RoutingAlternativeInput(
                            machine_id=alt.machine_id,
                            duration_minutes=alt.duration_minutes,
                            setup_minutes=alt.setup_minutes,
                            resource_requirements=[
                                ResourceRequirementInput(
                                    resource_id=rr.resource_id, units=rr.units
                                )
                                for rr in alt.resource_requirements
                            ],
                        )
                        for alt in op.routings
                    ],
                    actual_start=op.actual_start,
                    actual_machine_id=op.actual_machine_id,
                    actual_end=op.actual_end,
                    remaining_duration_minutes=op.remaining_duration_minutes,
                    firm_until=op.firm_until,
                    frozen_until=op.frozen_until,
                )
                for op in payload.operations
            ],
        )
    )
    return _work_order_to_out(wo)


@router.get("/{work_order_id}", response_model=WorkOrderOut)
def get_work_order(
    work_order_id: str,
    use_case: GetWorkOrder = Depends(get_get_work_order),
    tenant: TenantContext = Depends(get_tenant_context),
) -> WorkOrderOut:
    wo = use_case.execute(work_order_id)
    if wo is None:
        raise HTTPException(status_code=404, detail=f"Work order {work_order_id} not found")
    if (
        tenant.organization_id is not None
        and wo.organization_id != tenant.organization_id
    ):
        raise HTTPException(status_code=404, detail=f"Work order {work_order_id} not found")
    if tenant.workspace_id is not None and wo.workspace_id != tenant.workspace_id:
        raise HTTPException(status_code=404, detail=f"Work order {work_order_id} not found")
    return _work_order_to_out(wo)


@router.delete("/{work_order_id}", status_code=204)
def delete_work_order(
    work_order_id: str,
    get_use_case: GetWorkOrder = Depends(get_get_work_order),
    delete_use_case: DeleteWorkOrder = Depends(get_delete_work_order),
    tenant: TenantContext = Depends(get_tenant_context),
) -> None:
    wo = get_use_case.execute(work_order_id)
    if wo is None:
        raise HTTPException(
            status_code=404, detail=f"Work order {work_order_id} not found"
        )
    if (
        tenant.organization_id is not None
        and wo.organization_id != tenant.organization_id
    ):
        raise HTTPException(
            status_code=404, detail=f"Work order {work_order_id} not found"
        )
    if tenant.workspace_id is not None and wo.workspace_id != tenant.workspace_id:
        raise HTTPException(
            status_code=404, detail=f"Work order {work_order_id} not found"
        )
    delete_use_case.execute(work_order_id)
