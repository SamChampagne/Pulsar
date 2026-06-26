"""Calendar CRUD endpoints: working calendars with shift definitions."""

from __future__ import annotations

from datetime import time

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ...application.use_cases import CreateCalendar
from ...application.use_cases.create_calendar import CreateCalendarInput, ShiftInput
from ...infrastructure.db.repositories import SqlCalendarRepository
from ..dependencies import get_create_calendar, get_db_session
from ..schemas import CalendarIn, CalendarOut, ShiftOut
from ..tenant import (
    TenantContext,
    get_tenant_context,
    resolve_scoped_organization_id,
    resolve_scoped_workspace_id,
)

router = APIRouter(prefix="/calendars", tags=["calendars"])


def _calendar_to_out(c) -> CalendarOut:
    return CalendarOut(
        id=c.id,
        name=c.name,
        organization_id=c.organization_id,
        workspace_id=c.workspace_id,
        shifts=[
            ShiftOut(
                weekday=s.weekday,
                start=s.start.strftime("%H:%M"),
                end=s.end.strftime("%H:%M"),
            )
            for s in c.shifts
        ],
    )


def _parse_time(value: str) -> time:
    """Parse HH:MM string to time object."""
    parts = value.strip().split(":")
    return time(int(parts[0]), int(parts[1]))


@router.get("", response_model=list[CalendarOut])
def list_calendars(
    session: Session = Depends(get_db_session),
    tenant: TenantContext = Depends(get_tenant_context),
) -> list[CalendarOut]:
    repo = SqlCalendarRepository(session)
    calendars = repo.list_for_scope(
        organization_id=tenant.organization_id,
        workspace_id=tenant.workspace_id,
    )
    return [_calendar_to_out(c) for c in calendars]


@router.post("", response_model=CalendarOut, status_code=201)
def create_calendar(
    payload: CalendarIn,
    use_case: CreateCalendar = Depends(get_create_calendar),
    tenant: TenantContext = Depends(get_tenant_context),
) -> CalendarOut:
    organization_id = resolve_scoped_organization_id(tenant, payload.organization_id)
    workspace_id = resolve_scoped_workspace_id(tenant, payload.workspace_id)
    c = use_case.execute(
        CreateCalendarInput(
            id=payload.id,
            name=payload.name,
            organization_id=organization_id,
            workspace_id=workspace_id,
            shifts=[
                ShiftInput(
                    weekday=s.weekday,
                    start=_parse_time(s.start),
                    end=_parse_time(s.end),
                )
                for s in payload.shifts
            ],
        )
    )
    return _calendar_to_out(c)


@router.get("/{calendar_id}", response_model=CalendarOut)
def get_calendar(
    calendar_id: str,
    session: Session = Depends(get_db_session),
    tenant: TenantContext = Depends(get_tenant_context),
) -> CalendarOut:
    c = SqlCalendarRepository(session).get(calendar_id)
    if c is None or (
        tenant.organization_id is not None
        and c.organization_id not in {tenant.organization_id, None}
    ):
        raise HTTPException(
            status_code=404, detail=f"Calendar {calendar_id} not found"
        )
    if tenant.workspace_id is not None and c.workspace_id not in {tenant.workspace_id, None}:
        raise HTTPException(
            status_code=404, detail=f"Calendar {calendar_id} not found"
        )
    return _calendar_to_out(c)


@router.delete("/{calendar_id}", status_code=204)
def delete_calendar(
    calendar_id: str,
    session: Session = Depends(get_db_session),
    tenant: TenantContext = Depends(get_tenant_context),
) -> None:
    repo = SqlCalendarRepository(session)
    calendar = repo.get(calendar_id)
    if calendar is None or (
        tenant.organization_id is not None
        and calendar.organization_id != tenant.organization_id
    ):
        raise HTTPException(
            status_code=404, detail=f"Calendar {calendar_id} not found"
        )
    if tenant.workspace_id is not None and calendar.workspace_id != tenant.workspace_id:
        raise HTTPException(
            status_code=404, detail=f"Calendar {calendar_id} not found"
        )
    repo.delete(calendar_id)
    session.commit()
