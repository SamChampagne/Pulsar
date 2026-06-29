"""WorkingCalendar entity: which hours a machine is available."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime

from ..errors import ValidationError
from ..value_objects import Shift, TimeWindow


@dataclass(slots=True)
class WorkingCalendar:
    """A reusable working calendar shared by one or more machines.

    A calendar is a list of weekly :class:`Shift` definitions. Expanding
    them into concrete datetime windows for a horizon is the responsibility
    of the scheduling engine (``CalendarResolver``), not of the entity.
    """

    id: str
    name: str
    shifts: list[Shift] = field(default_factory=list)
    extra_windows: list[TimeWindow] = field(default_factory=list)
    organization_id: str | None = None
    workspace_id: str | None = None

    def __post_init__(self) -> None:
        if not self.id:
            raise ValidationError("WorkingCalendar.id is required")
        if not self.shifts:
            raise ValidationError(
                f"WorkingCalendar {self.id} must define at least one shift"
            )
        for window in self.extra_windows:
            if window.is_empty():
                raise ValidationError(
                    f"WorkingCalendar {self.id}: extra window {window} is empty"
                )

    def windows_for_day(self, day: date) -> list[TimeWindow]:
        """Concrete working windows applicable on a given day."""
        windows: list[TimeWindow] = []
        for shift in self.shifts:
            if shift.applies_to(day):
                start_dt, end_dt = shift.instantiate(day)
                windows.append(TimeWindow(start=start_dt, end=end_dt))
        windows.extend(
            window
            for window in self.extra_windows
            if window.start.date() <= day <= window.end.date()
        )
        return sorted(windows, key=lambda w: w.start)

    def is_working_instant(self, instant: datetime) -> bool:
        return any(w.contains(instant) for w in self.windows_for_day(instant.date()))
