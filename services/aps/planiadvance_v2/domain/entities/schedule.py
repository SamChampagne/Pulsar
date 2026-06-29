"""Schedule and ScheduledOperation entities.

A :class:`Schedule` is the *output* of running the APS engine. It is
immutable once produced — re-planning always creates a new Schedule rather
than mutating the old one, which makes auditing, comparing scenarios and
rollback trivial.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime

from ..errors import ValidationError
from ..value_objects import TimeWindow


@dataclass(frozen=True, slots=True)
class ScheduledOperation:
    """A single operation placed in time on a machine.

    The ``setup_start``/``start``/``end`` triple describes the *overall*
    footprint of the operation. For non-preemptive operations this is
    everything there is to know. For preemptive operations (long jobs
    split across multiple working windows) the ``segments`` tuple holds
    the individual productive chunks:

        setup_start ── setup ── start ═ segment[0] ═ … ═ segment[-1].end == end

    When ``segments`` has zero or one entries the operation ran in a
    single chunk and consumers can keep using ``start``/``end`` as
    before — existing code is unaffected.
    """

    operation_id: str
    work_order_id: str
    machine_id: str
    setup_start: datetime
    start: datetime
    end: datetime
    segments: tuple[TimeWindow, ...] = field(default_factory=tuple)

    def __post_init__(self) -> None:
        if self.setup_start > self.start:
            raise ValidationError(
                f"ScheduledOperation {self.operation_id}: setup_start > start"
            )
        if self.end < self.start:
            raise ValidationError(
                f"ScheduledOperation {self.operation_id}: end < start"
            )
        if self.segments:
            if self.segments[0].start != self.start:
                raise ValidationError(
                    f"ScheduledOperation {self.operation_id}: "
                    f"segments[0].start must equal start"
                )
            if self.segments[-1].end != self.end:
                raise ValidationError(
                    f"ScheduledOperation {self.operation_id}: "
                    f"segments[-1].end must equal end"
                )
            # Segments must be strictly ordered and non-overlapping.
            for a, b in zip(self.segments, self.segments[1:], strict=False):
                if a.end > b.start:
                    raise ValidationError(
                        f"ScheduledOperation {self.operation_id}: "
                        f"segments overlap or are out of order"
                    )

    @property
    def full_window(self) -> TimeWindow:
        """Window including setup time — what the machine is actually busy for."""
        return TimeWindow(start=self.setup_start, end=self.end)

    @property
    def run_window(self) -> TimeWindow:
        """Window of the actual productive work (excluding setup)."""
        return TimeWindow(start=self.start, end=self.end)

    @property
    def is_preempted(self) -> bool:
        return len(self.segments) > 1

    @property
    def productive_minutes(self) -> int:
        """Sum of actual productive minutes across all segments.

        For non-preempted operations this is ``(end - start)`` in minutes;
        for preempted ones it excludes the idle gaps between chunks.
        """
        if not self.segments:
            return int((self.end - self.start).total_seconds() // 60)
        total = 0
        for seg in self.segments:
            total += int((seg.end - seg.start).total_seconds() // 60)
        return total


@dataclass(slots=True)
class Schedule:
    id: str
    created_at: datetime
    assignments: list[ScheduledOperation] = field(default_factory=list)

    def by_machine(self, machine_id: str) -> list[ScheduledOperation]:
        return sorted(
            (a for a in self.assignments if a.machine_id == machine_id),
            key=lambda a: a.setup_start,
        )

    def by_work_order(self, work_order_id: str) -> list[ScheduledOperation]:
        return sorted(
            (a for a in self.assignments if a.work_order_id == work_order_id),
            key=lambda a: a.start,
        )

    @property
    def makespan_end(self) -> datetime | None:
        """The latest completion time across all scheduled operations."""
        if not self.assignments:
            return None
        return max(a.end for a in self.assignments)
