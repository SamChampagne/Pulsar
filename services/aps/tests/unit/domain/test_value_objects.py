"""Unit tests for domain value objects."""

from __future__ import annotations

from datetime import datetime, time

import pytest

from planiadvance_v2.domain.errors import ValidationError
from planiadvance_v2.domain.value_objects import Duration, Shift, TimeWindow


class TestDuration:
    def test_zero_is_valid(self) -> None:
        assert Duration.zero().minutes == 0

    def test_negative_rejected(self) -> None:
        with pytest.raises(ValidationError):
            Duration(minutes=-1)

    def test_add(self) -> None:
        assert (Duration(minutes=10) + Duration(minutes=5)).minutes == 15

    def test_from_hours(self) -> None:
        assert Duration.from_hours(1.5).minutes == 90


class TestTimeWindow:
    def test_overlaps_true(self) -> None:
        a = TimeWindow(datetime(2026, 1, 5, 10), datetime(2026, 1, 5, 12))
        b = TimeWindow(datetime(2026, 1, 5, 11), datetime(2026, 1, 5, 13))
        assert a.overlaps(b)

    def test_overlaps_adjacent_is_false(self) -> None:
        a = TimeWindow(datetime(2026, 1, 5, 10), datetime(2026, 1, 5, 12))
        b = TimeWindow(datetime(2026, 1, 5, 12), datetime(2026, 1, 5, 13))
        assert not a.overlaps(b)

    def test_duration(self) -> None:
        w = TimeWindow(datetime(2026, 1, 5, 10), datetime(2026, 1, 5, 11, 30))
        assert w.duration.minutes == 90

    def test_end_before_start_rejected(self) -> None:
        with pytest.raises(ValidationError):
            TimeWindow(datetime(2026, 1, 5, 12), datetime(2026, 1, 5, 10))


class TestShift:
    def test_invalid_weekday(self) -> None:
        with pytest.raises(ValidationError):
            Shift(weekday=7, start=time(8), end=time(17))

    def test_invalid_order(self) -> None:
        with pytest.raises(ValidationError):
            Shift(weekday=0, start=time(17), end=time(8))

    def test_applies_to_monday(self) -> None:
        s = Shift(weekday=0, start=time(8), end=time(17))
        assert s.applies_to(datetime(2026, 1, 5).date())  # Monday
        assert not s.applies_to(datetime(2026, 1, 6).date())  # Tuesday
