"""Unit tests for CalendarResolver."""

from __future__ import annotations

from datetime import datetime, time, timedelta

from planiadvance_v2.domain.entities import WorkingCalendar
from planiadvance_v2.domain.scheduling import CalendarResolver
from planiadvance_v2.domain.value_objects import Shift


def test_five_day_calendar_expands_to_five_windows() -> None:
    cal = WorkingCalendar(
        id="CAL",
        name="Mon-Fri",
        shifts=[Shift(weekday=w, start=time(8), end=time(17)) for w in range(5)],
    )
    start = datetime(2026, 1, 5)  # Monday
    end = start + timedelta(days=7)
    resolver = CalendarResolver(start, end)
    windows = resolver.working_windows(cal)
    assert len(windows) == 5  # no Saturday/Sunday
    assert all(w.start.hour == 8 and w.end.hour == 17 for w in windows)


def test_clip_to_horizon() -> None:
    cal = WorkingCalendar(
        id="CAL",
        name="Mon",
        shifts=[Shift(weekday=0, start=time(8), end=time(17))],
    )
    # Horizon only covers Monday 09:00-12:00.
    resolver = CalendarResolver(
        datetime(2026, 1, 5, 9),
        datetime(2026, 1, 5, 12),
    )
    windows = resolver.working_windows(cal)
    assert len(windows) == 1
    assert windows[0].start.hour == 9
    assert windows[0].end.hour == 12


def test_cache_returns_same_list() -> None:
    cal = WorkingCalendar(
        id="CAL", name="x",
        shifts=[Shift(weekday=0, start=time(8), end=time(17))],
    )
    resolver = CalendarResolver(datetime(2026, 1, 5), datetime(2026, 1, 12))
    a = resolver.working_windows(cal)
    b = resolver.working_windows(cal)
    assert a is b
