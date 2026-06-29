"""Calendar resolver: expands weekly shifts into concrete time windows.

Given a :class:`WorkingCalendar` and a planning horizon, this component
produces the ordered list of ``TimeWindow`` slots during which a machine
sharing that calendar is actually available. The rest of the engine can then
reason purely in terms of those precomputed windows — it never has to know
about weekdays, shifts or DST.

Two levels of availability are exposed:

- :meth:`working_windows` — pure calendar expansion, shared across every
  machine that references the same :class:`WorkingCalendar`. Cached.
- :meth:`effective_windows` — the calendar intersected with an additional
  list of forbidden windows (typically ``machine.maintenance_windows``). Not
  cached because every machine may have its own maintenance schedule.
"""

from __future__ import annotations

from collections.abc import Iterable
from datetime import date, datetime, timedelta

from ..entities import WorkingCalendar
from ..value_objects import TimeWindow


class CalendarResolver:
    """Expands calendars over a fixed horizon.

    Results are cached per-calendar for the lifetime of the instance so
    resolving the same calendar twice during one scheduling run is free.
    """

    def __init__(self, horizon_start: datetime, horizon_end: datetime) -> None:
        self._horizon_start = horizon_start
        self._horizon_end = horizon_end
        self._cache: dict[str, list[TimeWindow]] = {}

    @property
    def horizon_start(self) -> datetime:
        return self._horizon_start

    @property
    def horizon_end(self) -> datetime:
        return self._horizon_end

    def working_windows(self, calendar: WorkingCalendar) -> list[TimeWindow]:
        if calendar.id in self._cache:
            return self._cache[calendar.id]

        windows: list[TimeWindow] = []
        current_day: date = self._horizon_start.date()
        end_day: date = self._horizon_end.date()

        while current_day <= end_day:
            for window in calendar.windows_for_day(current_day):
                clipped = self._clip_to_horizon(window)
                if clipped is not None and not clipped.is_empty():
                    windows.append(clipped)
            current_day += timedelta(days=1)

        windows.sort(key=lambda w: w.start)
        merged = self._merge_adjacent(windows)
        self._cache[calendar.id] = merged
        return merged

    def effective_windows(
        self,
        calendar: WorkingCalendar,
        maintenance: Iterable[TimeWindow] = (),
    ) -> list[TimeWindow]:
        """Calendar windows minus the given maintenance periods.

        ``maintenance`` is treated as a set of forbidden intervals — any
        working window that overlaps a maintenance window is split around
        it. Maintenance windows outside the horizon are silently clipped.
        """
        base = self.working_windows(calendar)
        mlist = [m for m in maintenance if not m.is_empty()]
        if not mlist:
            return base

        # Clip and sort maintenance for deterministic processing.
        clipped: list[TimeWindow] = []
        for m in mlist:
            c = self._clip_to_horizon(m)
            if c is not None:
                clipped.append(c)
        if not clipped:
            return base
        clipped.sort(key=lambda w: w.start)

        result: list[TimeWindow] = []
        for window in base:
            slices = [window]
            for m in clipped:
                if m.end <= window.start or m.start >= window.end:
                    continue
                next_slices: list[TimeWindow] = []
                for s in slices:
                    # Subtract m from s, possibly producing 0, 1 or 2 pieces.
                    if m.end <= s.start or m.start >= s.end:
                        next_slices.append(s)
                        continue
                    if m.start > s.start:
                        next_slices.append(TimeWindow(start=s.start, end=m.start))
                    if m.end < s.end:
                        next_slices.append(TimeWindow(start=m.end, end=s.end))
                slices = next_slices
                if not slices:
                    break
            result.extend(s for s in slices if not s.is_empty())
        return result

    def _clip_to_horizon(self, window: TimeWindow) -> TimeWindow | None:
        start = max(window.start, self._horizon_start)
        end = min(window.end, self._horizon_end)
        if end <= start:
            return None
        return TimeWindow(start=start, end=end)

    @staticmethod
    def _merge_adjacent(windows: list[TimeWindow]) -> list[TimeWindow]:
        """Merge touching windows (end == next.start) into a single window."""
        if not windows:
            return []
        merged = [windows[0]]
        for w in windows[1:]:
            last = merged[-1]
            if w.start <= last.end:
                merged[-1] = TimeWindow(start=last.start, end=max(last.end, w.end))
            else:
                merged.append(w)
        return merged
