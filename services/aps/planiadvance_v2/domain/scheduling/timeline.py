"""ResourceTimeline: tracks booked intervals on a single machine.

This is the lowest-level primitive of the scheduling engine. Each machine
gets its own timeline; booking an operation simply inserts an interval into
the sorted list for that machine.
"""

from __future__ import annotations

from bisect import insort
from dataclasses import dataclass, field

from ..value_objects import TimeWindow


@dataclass(slots=True)
class _Booking:
    window: TimeWindow
    operation_id: str

    def __lt__(self, other: _Booking) -> bool:
        return self.window.start < other.window.start


@dataclass(slots=True)
class ResourceTimeline:
    """Ordered list of bookings on one exclusive-capacity machine."""

    machine_id: str
    _bookings: list[_Booking] = field(default_factory=list)

    def book(self, window: TimeWindow, operation_id: str) -> None:
        """Insert a new booking. Assumes the caller has already verified
        availability via :meth:`is_free`."""
        insort(self._bookings, _Booking(window=window, operation_id=operation_id))

    def is_free(self, window: TimeWindow) -> bool:
        """True if the timeline has no overlap with the given window."""
        for booking in self._bookings:
            if booking.window.start >= window.end:
                return True
            if booking.window.overlaps(window):
                return False
        return True

    def next_free_after(self, instant) -> object:  # pragma: no cover - see below
        raise NotImplementedError  # delegated to SlotFinder

    def busy_windows(self) -> list[TimeWindow]:
        return [b.window for b in self._bookings]

    def is_empty(self) -> bool:
        return not self._bookings
