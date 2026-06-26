"""Unit tests for SlotFinder."""

from __future__ import annotations

from datetime import datetime

from planiadvance_v2.domain.scheduling import ResourceTimeline, SlotFinder
from planiadvance_v2.domain.value_objects import Duration, TimeWindow


def _window(h1: int, h2: int) -> TimeWindow:
    return TimeWindow(datetime(2026, 1, 5, h1), datetime(2026, 1, 5, h2))


def test_finds_slot_at_start_of_working_window() -> None:
    finder = SlotFinder()
    slot = finder.find(
        earliest_start=datetime(2026, 1, 5, 8),
        required=Duration(minutes=60),
        working_windows=[_window(8, 17)],
        timeline=ResourceTimeline("M"),
    )
    assert slot is not None
    assert slot.start == datetime(2026, 1, 5, 8)
    assert slot.end == datetime(2026, 1, 5, 9)


def test_respects_earliest_start() -> None:
    finder = SlotFinder()
    slot = finder.find(
        earliest_start=datetime(2026, 1, 5, 10),
        required=Duration(minutes=60),
        working_windows=[_window(8, 17)],
        timeline=ResourceTimeline("M"),
    )
    assert slot is not None
    assert slot.start == datetime(2026, 1, 5, 10)


def test_skips_over_existing_booking() -> None:
    finder = SlotFinder()
    t = ResourceTimeline("M")
    t.book(_window(9, 11), "OP0")
    slot = finder.find(
        earliest_start=datetime(2026, 1, 5, 8),
        required=Duration(minutes=60),
        working_windows=[_window(8, 17)],
        timeline=t,
    )
    assert slot is not None
    # 8-9 is a free 1h gap — finder should pick that.
    assert slot.start == datetime(2026, 1, 5, 8)
    assert slot.end == datetime(2026, 1, 5, 9)


def test_uses_gap_after_booking_when_earliest_forces_it() -> None:
    finder = SlotFinder()
    t = ResourceTimeline("M")
    t.book(_window(9, 11), "OP0")
    slot = finder.find(
        earliest_start=datetime(2026, 1, 5, 10),
        required=Duration(minutes=60),
        working_windows=[_window(8, 17)],
        timeline=t,
    )
    assert slot is not None
    assert slot.start == datetime(2026, 1, 5, 11)
    assert slot.end == datetime(2026, 1, 5, 12)


def test_returns_none_when_nothing_fits() -> None:
    finder = SlotFinder()
    slot = finder.find(
        earliest_start=datetime(2026, 1, 5, 16),
        required=Duration(minutes=120),  # 2 hours, but only 1 hour of window left
        working_windows=[_window(8, 17)],
        timeline=ResourceTimeline("M"),
    )
    assert slot is None
