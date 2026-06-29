"""Shift value object: a working window on a given weekday."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, time

from ..errors import ValidationError


@dataclass(frozen=True, slots=True)
class Shift:
    """A single daily working window for one weekday.

    ``weekday`` follows Python's ``date.weekday()`` convention:
    Monday=0 ... Sunday=6.
    """

    weekday: int
    start: time
    end: time

    def __post_init__(self) -> None:
        if not 0 <= self.weekday <= 6:
            raise ValidationError(f"Shift weekday must be 0..6, got {self.weekday}")
        if self.end <= self.start:
            raise ValidationError(
                f"Shift end ({self.end}) must be > start ({self.start})"
            )

    def applies_to(self, day: date) -> bool:
        return day.weekday() == self.weekday

    def instantiate(self, day: date) -> tuple[datetime, datetime]:
        """Return the concrete (start, end) datetimes for a given day."""
        return (
            datetime.combine(day, self.start),
            datetime.combine(day, self.end),
        )
