"""Inventory CRUD endpoints for material-aware scheduling."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ...application.use_cases import CreateInventoryItem
from ...application.use_cases.create_inventory_item import CreateInventoryItemInput
from ...infrastructure.db.repositories import SqlInventoryRepository
from ..dependencies import get_create_inventory_item, get_db_session
from ..schemas import InventoryItemIn, InventoryItemOut
from ..tenant import (
    TenantContext,
    get_tenant_context,
    resolve_scoped_organization_id,
    resolve_scoped_workspace_id,
)

router = APIRouter(prefix="/inventory", tags=["inventory"])


def _item_to_out(item) -> InventoryItemOut:
    return InventoryItemOut(
        material_id=item.material_id,
        quantity_on_hand=item.quantity_on_hand,
        as_of=item.as_of,
        organization_id=item.organization_id,
        workspace_id=item.workspace_id,
    )


@router.get("", response_model=list[InventoryItemOut])
def list_inventory(
    session: Session = Depends(get_db_session),
    tenant: TenantContext = Depends(get_tenant_context),
) -> list[InventoryItemOut]:
    repo = SqlInventoryRepository(session)
    items = repo.list_for_scope(
        organization_id=tenant.organization_id,
        workspace_id=tenant.workspace_id,
    )
    return [_item_to_out(item) for item in items]


@router.post("", response_model=InventoryItemOut, status_code=201)
def create_inventory_item(
    payload: InventoryItemIn,
    use_case: CreateInventoryItem = Depends(get_create_inventory_item),
    tenant: TenantContext = Depends(get_tenant_context),
) -> InventoryItemOut:
    organization_id = resolve_scoped_organization_id(tenant, payload.organization_id)
    workspace_id = resolve_scoped_workspace_id(tenant, payload.workspace_id)
    item = use_case.execute(
        CreateInventoryItemInput(
            material_id=payload.material_id,
            quantity_on_hand=payload.quantity_on_hand,
            as_of=payload.as_of,
            organization_id=organization_id,
            workspace_id=workspace_id,
        )
    )
    return _item_to_out(item)


@router.get("/{material_id}", response_model=InventoryItemOut)
def get_inventory_item(
    material_id: str,
    session: Session = Depends(get_db_session),
    tenant: TenantContext = Depends(get_tenant_context),
) -> InventoryItemOut:
    item = SqlInventoryRepository(session).get(material_id)
    if item is None or (
        tenant.organization_id is not None
        and item.organization_id != tenant.organization_id
    ):
        raise HTTPException(
            status_code=404,
            detail=f"Inventory item {material_id} not found",
        )
    if tenant.workspace_id is not None and item.workspace_id != tenant.workspace_id:
        raise HTTPException(
            status_code=404,
            detail=f"Inventory item {material_id} not found",
        )
    return _item_to_out(item)


@router.delete("/{material_id}", status_code=204)
def delete_inventory_item(
    material_id: str,
    session: Session = Depends(get_db_session),
    tenant: TenantContext = Depends(get_tenant_context),
) -> None:
    repo = SqlInventoryRepository(session)
    item = repo.get(material_id)
    if item is None or (
        tenant.organization_id is not None
        and item.organization_id != tenant.organization_id
    ):
        raise HTTPException(
            status_code=404,
            detail=f"Inventory item {material_id} not found",
        )
    if tenant.workspace_id is not None and item.workspace_id != tenant.workspace_id:
        raise HTTPException(
            status_code=404,
            detail=f"Inventory item {material_id} not found",
        )
    repo.delete(material_id)
    session.commit()
