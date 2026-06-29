"""Use case: create a working calendar with shifts."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import time

from ...domain.entities import WorkingCalendar
from ...domain.value_objects import Shift
from ..ports import CalendarRepository


@dataclass(slots=True)
class ShiftInput:
    weekday: int  # 0=Monday .. 6=Sunday
    start: time
    end: time


@dataclass(slots=True)
class CreateCalendarInput:
    id: str
    name: str
    shifts: list[ShiftInput] = field(default_factory=list)
    organization_id: str | None = None
    workspace_id: str | None = None


class CreateCalendar:
    def __init__(self, repository: CalendarRepository) -> None:
        self._repository = repository

    def execute(self, command: CreateCalendarInput) -> WorkingCalendar:
        calendar = WorkingCalendar(
            id=command.id,
            name=command.name,
            organization_id=command.organization_id,
            workspace_id=command.workspace_id,
            shifts=[
                Shift(weekday=s.weekday, start=s.start, end=s.end)
                for s in command.shifts
            ],
        )
        self._repository.add(calendar)
        return calendar
