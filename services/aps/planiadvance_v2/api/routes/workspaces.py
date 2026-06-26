from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from ...application.use_cases import (
    CreateWorkspace,
    GetWorkspace,
    ListAccessibleWorkspaces,
    ListWorkspaces,
)
from ...application.use_cases.create_workspace import CreateWorkspaceInput
from ..dependencies import (
    get_create_workspace,
    get_get_workspace,
    get_list_accessible_workspaces,
    get_list_workspaces,
)
from ..schemas import WorkspaceIn, WorkspaceOut
from ..tenant import (
    TenantContext,
    get_tenant_context,
    resolve_scoped_organization_id,
)

router = APIRouter(prefix="/workspaces", tags=["workspaces"])


def _workspace_to_out(workspace) -> WorkspaceOut:
    return WorkspaceOut(
        id=workspace.id,
        name=workspace.name,
        description=workspace.description,
        organization_id=workspace.organization_id,
        is_default=workspace.is_default,
        is_active=workspace.is_active,
        plant_timezone=workspace.plant_timezone,
    )


@router.get("", response_model=list[WorkspaceOut])
def list_workspaces(
    use_case: ListWorkspaces = Depends(get_list_workspaces),
    accessible_workspaces: ListAccessibleWorkspaces = Depends(get_list_accessible_workspaces),
    tenant: TenantContext = Depends(get_tenant_context),
) -> list[WorkspaceOut]:
    if tenant.organization_id is not None and tenant.user_id is not None:
        workspaces = accessible_workspaces.execute(
            tenant.organization_id,
            tenant.user_id,
        )
    else:
        workspaces = use_case.execute(organization_id=tenant.organization_id)
    return [_workspace_to_out(workspace) for workspace in workspaces]


@router.post("", response_model=WorkspaceOut, status_code=201)
def create_workspace(
    payload: WorkspaceIn,
    use_case: CreateWorkspace = Depends(get_create_workspace),
    tenant: TenantContext = Depends(get_tenant_context),
) -> WorkspaceOut:
    organization_id = resolve_scoped_organization_id(tenant, payload.organization_id)
    # ValidationError from the Workspace constructor (e.g. unknown
    # plant_timezone) is caught by the global handler at
    # ``api/error_handlers.py`` and surfaced as a 422 with
    # ``error: validation_error`` — same shape as every other
    # constructor-validated entity in the API.
    workspace = use_case.execute(
        CreateWorkspaceInput(
            id=payload.id,
            name=payload.name,
            description=payload.description,
            organization_id=organization_id,
            is_default=payload.is_default,
            is_active=payload.is_active,
            plant_timezone=payload.plant_timezone,
        )
    )
    return _workspace_to_out(workspace)


@router.get("/{workspace_id}", response_model=WorkspaceOut)
def get_workspace(
    workspace_id: str,
    use_case: GetWorkspace = Depends(get_get_workspace),
    tenant: TenantContext = Depends(get_tenant_context),
) -> WorkspaceOut:
    workspace = use_case.execute(workspace_id)
    if workspace is None:
        raise HTTPException(status_code=404, detail=f"Workspace {workspace_id} not found")
    if (
        tenant.organization_id is not None
        and workspace.organization_id != tenant.organization_id
    ):
        raise HTTPException(
            status_code=404,
            detail=f"Workspace {workspace_id} not found",
        )
    if (
        tenant.workspace_access_restricted
        and workspace.id not in tenant.accessible_workspace_ids
    ):
        raise HTTPException(
            status_code=404,
            detail=f"Workspace {workspace_id} not found",
        )
    return _workspace_to_out(workspace)
