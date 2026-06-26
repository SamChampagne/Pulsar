"""Machine CRUD endpoints."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from ...application.use_cases import (
    CreateMachine,
    DeleteMachine,
    GetMachine,
    ListMachines,
)
from ...application.use_cases.create_machine import CreateMachineInput
from ...domain.value_objects import SetupMatrix, TimeWindow
from ..dependencies import (
    get_create_machine,
    get_delete_machine,
    get_get_machine,
    get_list_machines,
)
from ..schemas import (
    MachineIn,
    MachineOut,
    MaintenanceWindowOut,
    SetupMatrixOut,
    SetupTransitionOut,
)
from ..tenant import (
    TenantContext,
    get_tenant_context,
    resolve_scoped_organization_id,
    resolve_scoped_workspace_id,
)

router = APIRouter(prefix="/machines", tags=["machines"])


def _setup_matrix_to_out(matrix: SetupMatrix | None) -> SetupMatrixOut | None:
    if matrix is None:
        return None
    return SetupMatrixOut(
        default_minutes=matrix.default_minutes,
        initial_minutes=matrix.initial_minutes,
        transitions=[
            SetupTransitionOut(from_family=src, to_family=dst, minutes=minutes)
            for (src, dst), minutes in sorted(matrix.transitions.items())
        ],
    )


def _maintenance_to_out(windows: list[TimeWindow]) -> list[MaintenanceWindowOut]:
    return [MaintenanceWindowOut(start=window.start, end=window.end) for window in windows]


def _machine_to_out(m) -> MachineOut:
    return MachineOut(
        id=m.id,
        name=m.name,
        calendar_id=m.calendar_id,
        capabilities=m.capabilities,
        efficiency=m.efficiency,
        setup_matrix=_setup_matrix_to_out(m.setup_matrix),
        maintenance_windows=_maintenance_to_out(m.maintenance_windows),
        has_setup_matrix=m.setup_matrix is not None,
        maintenance_window_count=len(m.maintenance_windows),
        organization_id=m.organization_id,
        workspace_id=m.workspace_id,
    )


def _build_setup_matrix(machine_id: str, payload) -> SetupMatrix | None:
    if payload is None:
        return None
    transitions = {
        (t.from_family, t.to_family): t.minutes for t in payload.transitions
    }
    return SetupMatrix(
        machine_id=machine_id,
        default_minutes=payload.default_minutes,
        initial_minutes=payload.initial_minutes,
        transitions=transitions,
    )


def _build_maintenance_windows(windows) -> list[TimeWindow]:
    return [TimeWindow(start=w.start, end=w.end) for w in windows]


@router.get("", response_model=list[MachineOut])
def list_machines(
    use_case: ListMachines = Depends(get_list_machines),
    tenant: TenantContext = Depends(get_tenant_context),
) -> list[MachineOut]:
    return [
        _machine_to_out(m)
        for m in use_case.execute(
            organization_id=tenant.organization_id,
            workspace_id=tenant.workspace_id,
        )
    ]


@router.post("", response_model=MachineOut, status_code=201)
def create_machine(
    payload: MachineIn,
    use_case: CreateMachine = Depends(get_create_machine),
    tenant: TenantContext = Depends(get_tenant_context),
) -> MachineOut:
    organization_id = resolve_scoped_organization_id(tenant, payload.organization_id)
    workspace_id = resolve_scoped_workspace_id(tenant, payload.workspace_id)
    m = use_case.execute(
        CreateMachineInput(
            id=payload.id,
            name=payload.name,
            calendar_id=payload.calendar_id,
            capabilities=payload.capabilities,
            efficiency=payload.efficiency,
            setup_matrix=_build_setup_matrix(payload.id, payload.setup_matrix),
            maintenance_windows=_build_maintenance_windows(
                payload.maintenance_windows
            ),
            organization_id=organization_id,
            workspace_id=workspace_id,
        )
    )
    return _machine_to_out(m)


@router.get("/{machine_id}", response_model=MachineOut)
def get_machine(
    machine_id: str,
    use_case: GetMachine = Depends(get_get_machine),
    tenant: TenantContext = Depends(get_tenant_context),
) -> MachineOut:
    m = use_case.execute(machine_id)
    if m is None:
        raise HTTPException(status_code=404, detail=f"Machine {machine_id} not found")
    if (
        tenant.organization_id is not None
        and m.organization_id != tenant.organization_id
    ):
        raise HTTPException(status_code=404, detail=f"Machine {machine_id} not found")
    if tenant.workspace_id is not None and m.workspace_id != tenant.workspace_id:
        raise HTTPException(status_code=404, detail=f"Machine {machine_id} not found")
    return _machine_to_out(m)


@router.delete("/{machine_id}", status_code=204)
def delete_machine(
    machine_id: str,
    get_use_case: GetMachine = Depends(get_get_machine),
    delete_use_case: DeleteMachine = Depends(get_delete_machine),
    tenant: TenantContext = Depends(get_tenant_context),
) -> None:
    m = get_use_case.execute(machine_id)
    if m is None:
        raise HTTPException(status_code=404, detail=f"Machine {machine_id} not found")
    if (
        tenant.organization_id is not None
        and m.organization_id != tenant.organization_id
    ):
        raise HTTPException(status_code=404, detail=f"Machine {machine_id} not found")
    if tenant.workspace_id is not None and m.workspace_id != tenant.workspace_id:
        raise HTTPException(status_code=404, detail=f"Machine {machine_id} not found")
    delete_use_case.execute(machine_id)
