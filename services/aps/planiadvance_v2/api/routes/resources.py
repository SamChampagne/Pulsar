"""Resource CRUD endpoints: secondary resources (operators, tooling, etc.)."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ...application.use_cases import CreateResource
from ...application.use_cases.create_resource import CreateResourceInput
from ...infrastructure.db.repositories import SqlResourceRepository
from ..dependencies import get_create_resource, get_db_session
from ..schemas import ResourceIn, ResourceOut
from ..tenant import (
    TenantContext,
    get_tenant_context,
    resolve_scoped_organization_id,
    resolve_scoped_workspace_id,
)

router = APIRouter(prefix="/resources", tags=["resources"])


def _resource_to_out(r) -> ResourceOut:
    return ResourceOut(
        id=r.id,
        name=r.name,
        capacity=r.capacity,
        calendar_id=r.calendar_id,
        tags=r.tags,
        organization_id=r.organization_id,
        workspace_id=r.workspace_id,
    )


@router.get("", response_model=list[ResourceOut])
def list_resources(
    session: Session = Depends(get_db_session),
    tenant: TenantContext = Depends(get_tenant_context),
) -> list[ResourceOut]:
    repo = SqlResourceRepository(session)
    resources = repo.list_for_scope(
        organization_id=tenant.organization_id,
        workspace_id=tenant.workspace_id,
    )
    return [_resource_to_out(r) for r in resources]


@router.post("", response_model=ResourceOut, status_code=201)
def create_resource(
    payload: ResourceIn,
    use_case: CreateResource = Depends(get_create_resource),
    tenant: TenantContext = Depends(get_tenant_context),
) -> ResourceOut:
    organization_id = resolve_scoped_organization_id(tenant, payload.organization_id)
    workspace_id = resolve_scoped_workspace_id(tenant, payload.workspace_id)
    r = use_case.execute(
        CreateResourceInput(
            id=payload.id,
            name=payload.name,
            capacity=payload.capacity,
            calendar_id=payload.calendar_id,
            tags=payload.tags,
            organization_id=organization_id,
            workspace_id=workspace_id,
        )
    )
    return _resource_to_out(r)


@router.get("/{resource_id}", response_model=ResourceOut)
def get_resource(
    resource_id: str,
    session: Session = Depends(get_db_session),
    tenant: TenantContext = Depends(get_tenant_context),
) -> ResourceOut:
    r = SqlResourceRepository(session).get(resource_id)
    if r is None or (
        tenant.organization_id is not None
        and r.organization_id != tenant.organization_id
    ):
        raise HTTPException(status_code=404, detail=f"Resource {resource_id} not found")
    if tenant.workspace_id is not None and r.workspace_id != tenant.workspace_id:
        raise HTTPException(status_code=404, detail=f"Resource {resource_id} not found")
    return _resource_to_out(r)


@router.delete("/{resource_id}", status_code=204)
def delete_resource(
    resource_id: str,
    session: Session = Depends(get_db_session),
    tenant: TenantContext = Depends(get_tenant_context),
) -> None:
    repo = SqlResourceRepository(session)
    resource = repo.get(resource_id)
    if resource is None or (
        tenant.organization_id is not None
        and resource.organization_id != tenant.organization_id
    ):
        raise HTTPException(
            status_code=404, detail=f"Resource {resource_id} not found"
        )
    if tenant.workspace_id is not None and resource.workspace_id != tenant.workspace_id:
        raise HTTPException(
            status_code=404, detail=f"Resource {resource_id} not found"
        )
    repo.delete(resource_id)
    session.commit()
