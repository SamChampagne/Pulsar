"""SlotFinder: finds the earliest free slot on a machine.

The slot finder is intentionally the only component that understands both
the calendar (working/non-working time) and the timeline (already-booked
intervals). Keeping it isolated means heuristics and the scheduler never
have to reimplement that intersection logic.

Two modes are supported:

Non-preemptive (:meth:`SlotFinder.find`)
    Returns a single contiguous :class:`TimeWindow`. If an operation doesn't
    fit in any single free sub-interval, we give up and raise
    :class:`InfeasibleScheduleError` upstream. This is the classical
    behaviour and the default.

Preemptive (:meth:`SlotFinder.find_preemptive`)
    For long-running operations flagged ``preemptible=True``, the finder
    accumulates several free sub-intervals across working windows until the
    requested duration is covered. Each chunk must be at least ``min_chunk``
    minutes long — this avoids the pathological case where the planner
    produces hundreds of tiny one-minute slices. The result is a list of
    :class:`TimeWindow` segments whose total productive length equals the
    requested duration; the overall footprint (setup_start → last end) is
    then computed by the caller and stored in
    :attr:`ScheduledOperation.segments`.
"""

from __future__ import annotations

from collections.abc import Iterable
from datetime import datetime

from ..value_objects import Duration, TimeWindow
from .timeline import ResourceTimeline


class SlotFinder:
    """Stateless utility — construct once, call ``find`` many times."""

    def find(
        self,
        *,
        earliest_start: datetime,
        required: Duration,
        working_windows: Iterable[TimeWindow],
        timeline: ResourceTimeline,
    ) -> TimeWindow | None:
        """Return the earliest :class:`TimeWindow` where ``required`` minutes
        fit without overlapping existing bookings, or ``None`` if infeasible.
        """
        needed_minutes = required.minutes
        if needed_minutes == 0:
            return None

        for free in self._iter_free_intervals(
            earliest_start, working_windows, timeline
        ):
            candidate = self._fit(free.start, free.end, needed_minutes)
            if candidate is not None:
                return candidate
        return None

    def find_latest_end(
        self,
        *,
        latest_end: datetime,
        earliest_start: datetime,
        required: Duration,
        working_windows: Iterable[TimeWindow],
        timeline: ResourceTimeline,
    ) -> TimeWindow | None:
        """Return the latest :class:`TimeWindow` that finishes at or before
        ``latest_end`` and starts at or after ``earliest_start``, or ``None``.

        Used by backward (just-in-time) scheduling strategies that place
        operations starting from their successors. The returned window
        occupies the latest feasible slice; the caller subtracts setup
        from its start to derive ``setup_start`` as usual.
        """
        needed_minutes = required.minutes
        if needed_minutes == 0:
            return None

        # Collect all free intervals that could possibly contain the slot,
        # then walk them in reverse chronological order. This is simpler
        # than iterating windows backwards in place and stays O(n).
        frees: list[TimeWindow] = list(
            self._iter_free_intervals(earliest_start, working_windows, timeline)
        )

        for free in reversed(frees):
            if free.start >= latest_end:
                continue
            effective_end = min(free.end, latest_end)
            if effective_end <= free.start:
                continue
            available_minutes = (effective_end - free.start).total_seconds() // 60
            if available_minutes < needed_minutes:
                continue
            candidate_end = effective_end
            candidate_start = candidate_end - Duration(
                minutes=needed_minutes
            ).as_timedelta()
            if candidate_start < free.start:
                continue
            return TimeWindow(start=candidate_start, end=candidate_end)

        return None

    def find_preemptive(
        self,
        *,
        earliest_start: datetime,
        required: Duration,
        working_windows: Iterable[TimeWindow],
        timeline: ResourceTimeline,
        min_chunk: Duration,
    ) -> list[TimeWindow] | None:
        """Return a list of free :class:`TimeWindow` segments whose total
        productive length equals ``required``.

        Unlike :meth:`find`, the caller is expected to account for setup
        separately — this method only deals with the productive run time.
        Each returned segment has a duration of at least ``min_chunk``
        minutes (unless it is the tail segment carrying a smaller leftover).

        Returns ``None`` if the free intervals visible from ``earliest_start``
        cannot cover the requested duration — the caller should treat this
        as a failed placement (horizon too short or machine too loaded).
        """
        needed_minutes = required.minutes
        if needed_minutes == 0:
            return None

        min_chunk_minutes = max(min_chunk.minutes, 1)

        collected: list[TimeWindow] = []
        remaining = needed_minutes
        for free in self._iter_free_intervals(
            earliest_start, working_windows, timeline
        ):
            available = int((free.end - free.start).total_seconds() // 60)
            if available <= 0:
                continue

            # If this free interval is shorter than min_chunk AND we still
            # have room for more than a tail slice, skip it entirely. We
            # tolerate sub-min_chunk only for the final leftover (otherwise
            # we'd create useless micro-slices in the middle of a job).
            if available < min_chunk_minutes and remaining > min_chunk_minutes:
                continue

            take = min(available, remaining)
            # Slices before the last one must be at least ``min_chunk``
            # minutes long so that we don't fragment the work uselessly.
            if take < remaining and take < min_chunk_minutes:
                continue

            collected.append(
                TimeWindow(
                    start=free.start,
                    end=free.start + Duration(minutes=take).as_timedelta(),
                )
            )
            remaining -= take
            if remaining <= 0:
                break

        if remaining > 0:
            return None
        return collected

    def find_preemptive_latest_end(
        self,
        *,
        latest_end: datetime,
        earliest_start: datetime,
        required: Duration,
        working_windows: Iterable[TimeWindow],
        timeline: ResourceTimeline,
        min_chunk: Duration,
    ) -> list[TimeWindow] | None:
        """Return the latest productive segments that cover ``required``.

        This is the backward counterpart of :meth:`find_preemptive`. It
        walks free intervals in reverse chronological order and packs the
        operation as late as possible while still respecting
        ``earliest_start`` and ``min_chunk``.
        """
        needed_minutes = required.minutes
        if needed_minutes == 0:
            return None

        min_chunk_minutes = max(min_chunk.minutes, 1)
        frees = list(
            self._iter_free_intervals(earliest_start, working_windows, timeline)
        )

        collected_rev: list[TimeWindow] = []
        remaining = needed_minutes
        cursor_end = latest_end

        for free in reversed(frees):
            effective_end = min(free.end, cursor_end)
            if effective_end <= free.start:
                continue

            available = int((effective_end - free.start).total_seconds() // 60)
            if available <= 0:
                continue

            if available < min_chunk_minutes and remaining > min_chunk_minutes:
                continue

            take = min(available, remaining)
            if take < remaining and take < min_chunk_minutes:
                continue

            segment = TimeWindow(
                start=effective_end - Duration(minutes=take).as_timedelta(),
                end=effective_end,
            )
            collected_rev.append(segment)
            remaining -= take
            cursor_end = segment.start
            if remaining <= 0:
                break

        if remaining > 0:
            return None
        return list(reversed(collected_rev))

    # ------------------------------------------------------------------ private

    def _iter_free_intervals(
        self,
        earliest_start: datetime,
        working_windows: Iterable[TimeWindow],
        timeline: ResourceTimeline,
    ) -> Iterable[TimeWindow]:
        """Yield contiguous free sub-intervals in chronological order.

        A free interval is the intersection of a working window with the
        complement of the timeline's busy set, clipped at the left by
        ``earliest_start``. Empty intervals (start == end) are skipped.
        """
        busy = timeline.busy_windows()

        for window in working_windows:
            if window.end <= earliest_start:
                continue

            cursor_start = max(window.start, earliest_start)
            cursor_end = window.end

            relevant_busy = [b for b in busy if b.overlaps(window)]
            relevant_busy.sort(key=lambda w: w.start)

            for b in relevant_busy:
                if b.start > cursor_start:
                    free_end = min(b.start, cursor_end)
                    if free_end > cursor_start:
                        yield TimeWindow(start=cursor_start, end=free_end)
                cursor_start = max(cursor_start, b.end)
                if cursor_start >= cursor_end:
                    break

            if cursor_start < cursor_end:
                yield TimeWindow(start=cursor_start, end=cursor_end)

    @staticmethod
    def _fit(start: datetime, end: datetime, needed_minutes: int) -> TimeWindow | None:
        available_seconds = (end - start).total_seconds()
        if available_seconds >= needed_minutes * 60:
            return TimeWindow(
                start=start,
                end=start + Duration(minutes=needed_minutes).as_timedelta(),
            )
        return None
