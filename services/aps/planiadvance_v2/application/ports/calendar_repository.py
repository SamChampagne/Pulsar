"""Port: working calendar persistence."""

from __future__ import annotations

from typing import Protocol

from ...domain.entities import WorkingCalendar


class CalendarRepository(Protocol):
    def list_all(self) -> list[WorkingCalendar]: ...
    def list_for_organization(self, organization_id: str) -> list[WorkingCalendar]: ...
    def list_for_scope(
        self,
        *,
        organization_id: str | None = None,
        workspace_id: str | None = None,
    ) -> list[WorkingCalendar]: ...
    def get(self, calendar_id: str) -> WorkingCalendar | None: ...
    def add(self, calendar: WorkingCalendar) -> None: ...
