"""Frozen assignments for rolling-horizon re-planning.

Real-world APS engines rarely run from a clean slate. Every hour (or
every event — machine breakdown, rush order, operator calling sick)
the planner reruns the engine with *the part of yesterday's plan that
has already started* locked in place. Operations whose setup has
begun must not move; operations whose successors are waiting on a
locked predecessor must respect that predecessor's end time.

This module introduces a tiny immutable :class:`FrozenAssignment`
value object and threads it through :class:`SchedulingContext`. The
greedy-family strategies honour it by:

1. Pre-booking the frozen intervals on the relevant :class:`ResourceTimeline`
   before placing anything, so the slot finder naturally avoids them.
2. Seeding ``completed_ends`` (forward) and ``placed_start`` (backward)
   with the frozen operations' end/start so downstream dependencies line
   up with reality.
3. Recording the frozen operations directly in the output
   :class:`Schedule` — they are still assignments of the current run,
   they just happen to be pinned.

Keeping the logic centralised here means strategies add rolling-horizon
support with a single ``_apply_frozen`` call instead of reinventing it.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime

from ..entities import ScheduledOperation
from ..errors import ValidationError
from ..value_objects import TimeWindow
from .timeline import ResourceTimeline


@dataclass(frozen=True, slots=True)
class FrozenAssignment:
    """An operation that is pinned to a specific machine and time window.

    ``setup_start`` / ``start`` / ``end`` follow the same convention as
    :class:`ScheduledOperation`: ``setup_start`` is where the machine
    starts being occupied, ``start`` is when productive work begins and
    ``end`` is when the operation completes.
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
                f"FrozenAssignment {self.operation_id}: setup_start > start"
            )
        if self.end < self.start:
            raise ValidationError(
                f"FrozenAssignment {self.operation_id}: end < start"
            )
        if self.segments:
            if self.segments[0].start != self.start:
                raise ValidationError(
                    f"FrozenAssignment {self.operation_id}: "
                    "segments[0].start must equal start"
                )
            if self.segments[-1].end != self.end:
                raise ValidationError(
                    f"FrozenAssignment {self.operation_id}: "
                    "segments[-1].end must equal end"
                )
            for current, next_segment in zip(
                self.segments,
                self.segments[1:],
                strict=False,
            ):
                if current.end > next_segment.start:
                    raise ValidationError(
                        f"FrozenAssignment {self.operation_id}: "
                        "segments overlap or are out of order"
                    )

    def to_scheduled_operation(self) -> ScheduledOperation:
        """Lift a frozen assignment into the output :class:`Schedule`."""
        return ScheduledOperation(
            operation_id=self.operation_id,
            work_order_id=self.work_order_id,
            machine_id=self.machine_id,
            setup_start=self.setup_start,
            start=self.start,
            end=self.end,
            segments=self.segments,
        )

    @property
    def full_window(self) -> TimeWindow:
        return TimeWindow(start=self.setup_start, end=self.end)


def apply_frozen_to_timelines(
    frozen: list[FrozenAssignment],
    timelines: dict[str, ResourceTimeline],
) -> None:
    """Book every frozen assignment on its machine's timeline.

    Machines that appear in ``frozen`` but not in ``timelines`` are
    silently skipped — the strategy guarantees that every machine in
    the context has a timeline, so a missing entry here means the
    frozen plan refers to a machine no longer in service and the
    planner should have caught that upstream.
    """
    for fa in frozen:
        timeline = timelines.get(fa.machine_id)
        if timeline is None:
            continue
        timeline.book(fa.full_window, operation_id=fa.operation_id)
