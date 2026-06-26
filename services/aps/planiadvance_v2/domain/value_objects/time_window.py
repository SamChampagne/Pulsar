"""Time window value object.

Represents a half-open interval ``[start, end)``. Half-open intervals make
adjacency checks (``a.end == b.start`` → no overlap) trivial and are the
standard convention for scheduling systems.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta

from ..errors import ValidationError
from .duration import Duration


@dataclass(frozen=True, slots=True)
class TimeWindow:
    start: datetime
    end: datetime

    def __post_init__(self) -> None:
        if self.end < self.start:
            raise ValidationError(
                f"TimeWindow end ({self.end}) must be >= start ({self.start})"
            )

    @classmethod
    def from_duration(cls, start: datetime, duration: Duration) -> TimeWindow:
        return cls(start=start, end=start + duration.as_timedelta())

    @property
    def duration(self) -> Duration:
        delta: timedelta = self.end - self.start
        return Duration(minutes=int(delta.total_seconds() // 60))

    def overlaps(self, other: TimeWindow) -> bool:
        """True if the two half-open intervals share any instant."""
        return self.start < other.end and other.start < self.end

    def contains(self, instant: datetime) -> bool:
        return self.start <= instant < self.end

    def shifted(self, delta: timedelta) -> TimeWindow:
        return TimeWindow(start=self.start + delta, end=self.end + delta)

    def is_empty(self) -> bool:
        return self.start == self.end
