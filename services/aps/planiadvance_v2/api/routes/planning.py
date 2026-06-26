"""Planning control plane endpoints.

These routes expose workspace-level planner state without duplicating the
scheduling engine routes. Scheduling still creates schedules, edit/apply still
creates candidates, and scenario publish still promotes a run; this API makes
the active baseline/candidate state durable and API-first.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ...application.use_cases import (
    DiscardPlanningCandidateInput,
    GetPlanningStateInput,
    ListPlanningEventsInput,
    PlanningControlPlane,
    SelectPlanningBaselineInput,
)
from ...application.use_cases.planning_control import event_as_dict
from ...domain.errors import ValidationError
from ..dependencies import get_db_session, get_planning_control_plane
from ..schemas import (
    DiscardPlanningCandidateRequest,
    PlanningEventOut,
    PlanningStateResponse,
    SelectPlanningBaselineRequest,
)
from ..tenant import (
    TenantContext,
    ensure_permission,
    get_tenant_context,
    resolve_scoped_workspace_id,
)

router = APIRouter(prefix="/planning", tags=["planning"])


@router.get(
    "/state",
    response_model=PlanningStateResponse,
    summary="Get active planning state for the workspace",
)
def get_planning_state(
    workspace_id: str | None = None,
    include_events: int = Query(20, ge=0, le=100),
    use_case: PlanningControlPlane = Depends(get_planning_control_plane),
    tenant: TenantContext = Depends(get_tenant_context),
) -> PlanningStateResponse:
    ensure_permission(tenant, "view_plans")
    scoped_workspace_id = resolve_scoped_workspace_id(tenant, workspace_id)
    result = use_case.get_state(
        GetPlanningStateInput(
            organization_id=tenant.organization_id,
            workspace_id=scoped_workspace_id,
            include_events=include_events,
        )
    )
    return PlanningStateResponse(**result.as_dict())


@router.post(
    "/baseline/select",
    response_model=PlanningStateResponse,
    summary="Select the active baseline for the workspace",
)
def select_planning_baseline(
    payload: SelectPlanningBaselineRequest,
    use_case: PlanningControlPlane = Depends(get_planning_control_plane),
    tenant: TenantContext = Depends(get_tenant_context),
    session: Session = Depends(get_db_session),
) -> PlanningStateResponse:
    ensure_permission(tenant, "publish_scenario")
    workspace_id = resolve_scoped_workspace_id(tenant, payload.workspace_id)
    try:
        result = use_case.select_baseline(
            SelectPlanningBaselineInput(
                schedule_id=payload.schedule_id,
                organization_id=tenant.organization_id,
                workspace_id=workspace_id,
                user_id=tenant.user_id,
                scenario_name=payload.scenario_name,
            )
        )
        session.commit()
    except ValidationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return PlanningStateResponse(**result.as_dict())


@router.post(
    "/candidate/discard",
    response_model=PlanningStateResponse,
    summary="Discard the active workspace candidate",
)
def discard_planning_candidate(
    payload: DiscardPlanningCandidateRequest,
    use_case: PlanningControlPlane = Depends(get_planning_control_plane),
    tenant: TenantContext = Depends(get_tenant_context),
    session: Session = Depends(get_db_session),
) -> PlanningStateResponse:
    ensure_permission(tenant, "edit_plan")
    workspace_id = resolve_scoped_workspace_id(tenant, payload.workspace_id)
    try:
        result = use_case.discard_candidate(
            DiscardPlanningCandidateInput(
                organization_id=tenant.organization_id,
                workspace_id=workspace_id,
                user_id=tenant.user_id,
                candidate_schedule_id=payload.candidate_schedule_id,
                reason=payload.reason,
            )
        )
        session.commit()
    except ValidationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return PlanningStateResponse(**result.as_dict())


@router.get(
    "/events",
    response_model=list[PlanningEventOut],
    summary="List planner control plane events for the workspace",
)
def list_planning_events(
    workspace_id: str | None = None,
    limit: int = Query(50, ge=1, le=200),
    baseline_schedule_id: str | None = None,
    candidate_schedule_id: str | None = None,
    use_case: PlanningControlPlane = Depends(get_planning_control_plane),
    tenant: TenantContext = Depends(get_tenant_context),
) -> list[PlanningEventOut]:
    ensure_permission(tenant, "view_plans")
    scoped_workspace_id = resolve_scoped_workspace_id(tenant, workspace_id)
    events = use_case.list_events(
        ListPlanningEventsInput(
            organization_id=tenant.organization_id,
            workspace_id=scoped_workspace_id,
            limit=limit,
            baseline_schedule_id=baseline_schedule_id,
            candidate_schedule_id=candidate_schedule_id,
        )
    )
    return [PlanningEventOut(**event_as_dict(event)) for event in events]
