"""SQL-backed :class:`CalendarRepository` adapter."""

from __future__ import annotations

from sqlalchemy import delete, or_, select
from sqlalchemy.orm import Session, selectinload

from ....domain.entities import WorkingCalendar
from ....domain.value_objects import Shift
from ...scoping import ScopedRepositoryMixin
from ..models import CalendarModel, ShiftModel


class SqlCalendarRepository(ScopedRepositoryMixin[WorkingCalendar]):
    def __init__(self, session: Session) -> None:
        self._session = session

    def list_all(self) -> list[WorkingCalendar]:
        stmt = select(CalendarModel).options(selectinload(CalendarModel.shifts))
        rows = self._session.execute(stmt).scalars().all()
        return [self._to_domain(row) for row in rows]

    def list_for_organization(self, organization_id: str) -> list[WorkingCalendar]:
        stmt = (
            select(CalendarModel)
            .options(selectinload(CalendarModel.shifts))
            .where(
                or_(
                    CalendarModel.organization_id == organization_id,
                    CalendarModel.organization_id.is_(None),
                )
            )
        )
        rows = self._session.execute(stmt).scalars().all()
        return [self._to_domain(row) for row in rows]

    def list_for_scope(
        self,
        *,
        organization_id: str | None = None,
        workspace_id: str | None = None,
    ) -> list[WorkingCalendar]:
        stmt = select(CalendarModel).options(selectinload(CalendarModel.shifts))
        if organization_id is not None:
            stmt = stmt.where(
                or_(
                    CalendarModel.organization_id == organization_id,
                    CalendarModel.organization_id.is_(None),
                )
            )
        if workspace_id is not None:
            stmt = stmt.where(
                or_(
                    CalendarModel.workspace_id == workspace_id,
                    CalendarModel.workspace_id.is_(None),
                )
            )
        rows = self._session.execute(stmt).scalars().all()
        return [self._to_domain(row) for row in rows]

    def get(self, calendar_id: str) -> WorkingCalendar | None:
        row = self._session.get(
            CalendarModel,
            calendar_id,
            options=[selectinload(CalendarModel.shifts)],
        )
        return self._to_domain(row) if row else None

    def delete(self, calendar_id: str) -> None:
        self._session.execute(
            delete(CalendarModel).where(CalendarModel.id == calendar_id)
        )

    def add(self, calendar: WorkingCalendar) -> None:
        row = CalendarModel(
            id=calendar.id,
            name=calendar.name,
            organization_id=calendar.organization_id,
            workspace_id=calendar.workspace_id,
        )
        row.shifts = [
            ShiftModel(
                calendar_id=calendar.id,
                weekday=s.weekday,
                start_time=s.start,
                end_time=s.end,
            )
            for s in calendar.shifts
        ]
        self._session.merge(row)

    @staticmethod
    def _to_domain(row: CalendarModel) -> WorkingCalendar:
        return WorkingCalendar(
            id=row.id,
            name=row.name,
            organization_id=row.organization_id,
            workspace_id=row.workspace_id,
            shifts=[
                Shift(weekday=s.weekday, start=s.start_time, end=s.end_time)
                for s in row.shifts
            ],
        )
