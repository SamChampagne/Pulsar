"""CumulativeResourceTimeline: tracks multi-unit bookings on secondary resources.

The primary :class:`ResourceTimeline` is unary: one machine, one booking
per instant. For *secondary resources* — operator pools, tooling,
consumables — we need cumulative capacity: multiple operations can share
the same resource as long as the total units used at any instant stays
below the resource's capacity.

This module provides :class:`CumulativeResourceTimeline`, the cumulative
counterpart. It exposes three operations the greedy-family strategies
rely on:

* :meth:`peak_usage` — maximum concurrent consumption within a window;
* :meth:`can_accommodate` — whether a proposed window fits without
  breaching capacity;
* :meth:`earliest_feasible_start` — slide a candidate window forward
  until it fits, returning the earliest instant that works (``None``
  when no such instant exists within the search horizon);
* :meth:`latest_feasible_end` — the backward counterpart, used by the
  just-in-time strategy to slide a window *backward* until it fits.

Resource calendars are modelled in the strategy layer by pre-booking
off-shift intervals at full capacity, which turns calendar enforcement
into a plain cumulative constraint. That trick keeps this module
calendar-agnostic and reusable.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta

from ..value_objects import Duration, TimeWindow


@dataclass(slots=True)
class _ResourceBooking:
    window: TimeWindow
    units: int
    operation_id: str


@dataclass(slots=True)
class CumulativeResourceTimeline:
    """Ordered list of cumulative bookings on a single secondary resource.

    Parameters
    ----------
    resource_id:
        Stable id of the :class:`Resource` this timeline tracks.
    capacity:
        Maximum units available simultaneously. A unary resource
        (exclusive tooling, unique mould) is modelled with ``capacity=1``.
    """

    resource_id: str
    capacity: int
    _bookings: list[_ResourceBooking] = field(default_factory=list)

    # -------------------------------------------------------------- mutating

    def book(
        self, window: TimeWindow, units: int, operation_id: str
    ) -> None:
        """Record a new booking.

        The caller is expected to have verified capacity first via
        :meth:`can_accommodate`; skipping that check silently produces
        an over-booked schedule, so the strategies always perform the
        capacity probe immediately before booking.
        """
        self._bookings.append(
            _ResourceBooking(
                window=window, units=units, operation_id=operation_id
            )
        )

    # --------------------------------------------------------------- queries

    def peak_usage(self, window: TimeWindow) -> int:
        """Return the maximum concurrent unit count inside ``window``.

        A classical sweep-line: every booking that overlaps contributes
        a (+units) event at the overlap start and a (-units) event at
        the overlap end. Scanning the sorted events gives the peak.
        """
        if not self._bookings:
            return 0
        events: list[tuple[datetime, int]] = []
        for booking in self._bookings:
            overlap_start = max(booking.window.start, window.start)
            overlap_end = min(booking.window.end, window.end)
            if overlap_start >= overlap_end:
                continue
            events.append((overlap_start, booking.units))
            events.append((overlap_end, -booking.units))
        if not events:
            return 0
        # Sort by instant, closing events (negative delta) before opening
        # events (positive delta) so that two bookings touching at a single
        # point don't spuriously stack — closing has the smaller key and
        # is therefore processed first.
        events.sort(key=lambda e: (e[0], e[1]))
        current = 0
        peak = 0
        for _, delta in events:
            current += delta
            if current > peak:
                peak = current
        return peak

    def can_accommodate(self, window: TimeWindow, units: int) -> bool:
        """True when ``units`` can be added to the window without breach."""
        if units <= 0:
            return True
        return self.peak_usage(window) + units <= self.capacity

    def earliest_feasible_start(
        self,
        *,
        earliest_start: datetime,
        duration: Duration,
        units: int,
        horizon_end: datetime,
        max_jumps: int = 256,
    ) -> datetime | None:
        """Find the earliest ``t`` ≥ ``earliest_start`` that admits the booking.

        The search walks the resource's free intervals forward: when a
        candidate window overlaps an over-capacity region, we jump to
        the end of the nearest overlapping booking and retry. ``max_jumps``
        bounds the loop at a generous safety ceiling so a pathological
        instance cannot hang the solver — hitting it returns ``None``
        and lets the caller fail over to another machine.
        """
        if units <= 0:
            return earliest_start
        if units > self.capacity:
            return None  # structurally infeasible, no point scanning

        dt = duration.as_timedelta()
        candidate = earliest_start
        for _ in range(max_jumps):
            if candidate + dt > horizon_end:
                return None
            window = TimeWindow(start=candidate, end=candidate + dt)
            if self.can_accommodate(window, units):
                return candidate
            # Jump: take the earliest release time among bookings that
            # overlap the candidate and push us over capacity.
            next_release = self._earliest_release_inside(window)
            if next_release is None or next_release <= candidate:
                # Defensive — shouldn't happen if can_accommodate is False,
                # but we never want to loop forever.
                candidate = candidate + timedelta(minutes=1)
            else:
                candidate = next_release
        return None

    def latest_feasible_end(
        self,
        *,
        latest_end: datetime,
        duration: Duration,
        units: int,
        earliest_start: datetime,
        max_jumps: int = 256,
    ) -> datetime | None:
        """Find the latest ``t`` ≤ ``latest_end`` admitting ``[t-dt, t]``.

        Symmetric to :meth:`earliest_feasible_start`: the search walks
        *backward* through the resource's bookings. When a candidate
        window overlaps an over-capacity region we jump ``t`` to the
        latest conflicting booking's start, which is the latest instant
        at which the window could possibly slide without hitting that
        booking. The walk terminates when ``t - duration`` would fall
        below ``earliest_start`` or when ``max_jumps`` is exhausted.
        """
        if units <= 0:
            return latest_end
        if units > self.capacity:
            return None

        dt = duration.as_timedelta()
        candidate = latest_end
        for _ in range(max_jumps):
            if candidate - dt < earliest_start:
                return None
            window = TimeWindow(start=candidate - dt, end=candidate)
            if self.can_accommodate(window, units):
                return candidate
            prev_start = self._latest_start_inside(window)
            if prev_start is None or prev_start >= candidate:
                # Defensive — as with the forward counterpart, guarantee
                # strict progress so we cannot spin forever.
                candidate = candidate - timedelta(minutes=1)
            else:
                candidate = prev_start
        return None

    # ------------------------------------------------------------- internals

    def _earliest_release_inside(self, window: TimeWindow) -> datetime | None:
        """Earliest booking end time that overlaps ``window``."""
        earliest: datetime | None = None
        for booking in self._bookings:
            if booking.window.end <= window.start:
                continue
            if booking.window.start >= window.end:
                continue
            if earliest is None or booking.window.end < earliest:
                earliest = booking.window.end
        return earliest

    def _latest_start_inside(self, window: TimeWindow) -> datetime | None:
        """Latest booking start time that overlaps ``window``."""
        latest: datetime | None = None
        for booking in self._bookings:
            if booking.window.end <= window.start:
                continue
            if booking.window.start >= window.end:
                continue
            if latest is None or booking.window.start > latest:
                latest = booking.window.start
        return latest

    def is_empty(self) -> bool:
        return not self._bookings
