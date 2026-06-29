"""Unit tests for ResourceTimeline."""

from __future__ import annotations

from datetime import datetime

from planiadvance_v2.domain.scheduling import ResourceTimeline
from planiadvance_v2.domain.value_objects import TimeWindow


def _w(h1: int, h2: int) -> TimeWindow:
    return TimeWindow(datetime(2026, 1, 5, h1), datetime(2026, 1, 5, h2))


def test_empty_timeline_is_free() -> None:
    t = ResourceTimeline(machine_id="M")
    assert t.is_empty()
    assert t.is_free(_w(8, 17))


def test_overlapping_window_not_free() -> None:
    t = ResourceTimeline(machine_id="M")
    t.book(_w(10, 12), "OP1")
    assert not t.is_free(_w(11, 13))


def test_adjacent_window_is_free() -> None:
    """Half-open intervals: end == next.start must NOT be an overlap."""
    t = ResourceTimeline(machine_id="M")
    t.book(_w(10, 12), "OP1")
    assert t.is_free(_w(12, 14))


def test_bookings_stay_sorted() -> None:
    t = ResourceTimeline(machine_id="M")
    t.book(_w(14, 15), "OP2")
    t.book(_w(10, 11), "OP1")
    busy = t.busy_windows()
    assert [b.start.hour for b in busy] == [10, 14]
