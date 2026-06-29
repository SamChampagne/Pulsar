"""Supply-lot CRUD endpoints for material-aware scheduling."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ...application.use_cases import CreateSupplyLot
from ...application.use_cases.create_supply_lot import CreateSupplyLotInput
from ...infrastructure.db.repositories import SqlSupplyRepository
from ..dependencies import get_create_supply_lot, get_db_session
from ..schemas import SupplyLotIn, SupplyLotOut
from ..tenant import (
    TenantContext,
    get_tenant_context,
    resolve_scoped_organization_id,
    resolve_scoped_workspace_id,
)

router = APIRouter(prefix="/supplies", tags=["supplies"])


def _lot_to_out(lot) -> SupplyLotOut:
    return SupplyLotOut(
        id=lot.id,
        material_id=lot.material_id,
        quantity=lot.quantity,
        available_at=lot.available_at,
        source_type=lot.source_type,
        organization_id=lot.organization_id,
        workspace_id=lot.workspace_id,
    )


@router.get("", response_model=list[SupplyLotOut])
def list_supplies(
    session: Session = Depends(get_db_session),
    tenant: TenantContext = Depends(get_tenant_context),
) -> list[SupplyLotOut]:
    repo = SqlSupplyRepository(session)
    lots = repo.list_for_scope(
        organization_id=tenant.organization_id,
        workspace_id=tenant.workspace_id,
    )
    return [_lot_to_out(lot) for lot in lots]


@router.post("", response_model=SupplyLotOut, status_code=201)
def create_supply_lot(
    payload: SupplyLotIn,
    use_case: CreateSupplyLot = Depends(get_create_supply_lot),
    tenant: TenantContext = Depends(get_tenant_context),
) -> SupplyLotOut:
    organization_id = resolve_scoped_organization_id(tenant, payload.organization_id)
    workspace_id = resolve_scoped_workspace_id(tenant, payload.workspace_id)
    lot = use_case.execute(
        CreateSupplyLotInput(
            id=payload.id,
            material_id=payload.material_id,
            quantity=payload.quantity,
            available_at=payload.available_at,
            source_type=payload.source_type,
            organization_id=organization_id,
            workspace_id=workspace_id,
        )
    )
    return _lot_to_out(lot)


@router.get("/{supply_id}", response_model=SupplyLotOut)
def get_supply_lot(
    supply_id: str,
    session: Session = Depends(get_db_session),
    tenant: TenantContext = Depends(get_tenant_context),
) -> SupplyLotOut:
    lot = SqlSupplyRepository(session).get(supply_id)
    if lot is None or (
        tenant.organization_id is not None
        and lot.organization_id != tenant.organization_id
    ):
        raise HTTPException(
            status_code=404,
            detail=f"Supply lot {supply_id} not found",
        )
    if tenant.workspace_id is not None and lot.workspace_id != tenant.workspace_id:
        raise HTTPException(
            status_code=404,
            detail=f"Supply lot {supply_id} not found",
        )
    return _lot_to_out(lot)


@router.delete("/{supply_id}", status_code=204)
def delete_supply_lot(
    supply_id: str,
    session: Session = Depends(get_db_session),
    tenant: TenantContext = Depends(get_tenant_context),
) -> None:
    repo = SqlSupplyRepository(session)
    lot = repo.get(supply_id)
    if lot is None or (
        tenant.organization_id is not None
        and lot.organization_id != tenant.organization_id
    ):
        raise HTTPException(
            status_code=404,
            detail=f"Supply lot {supply_id} not found",
        )
    if tenant.workspace_id is not None and lot.workspace_id != tenant.workspace_id:
        raise HTTPException(
            status_code=404,
            detail=f"Supply lot {supply_id} not found",
        )
    repo.delete(supply_id)
    session.commit()
