"""Secondary-resource alignment for the greedy-family strategies.

CP-SAT enforces secondary resources natively through ``AddCumulative``.
The greedy forward and backward strategies do not — historically they
only tracked machine timelines. This module closes that gap by giving
the strategies a drop-in resource layer:

1. :func:`build_resource_timelines` constructs a
   :class:`CumulativeResourceTimeline` for every :class:`Resource` in
   the context, pre-booking off-shift intervals at full capacity so
   that resource calendars are enforced through the same cumulative
   mechanism as capacity itself.

2. :func:`align_to_resources` takes a machine-level tentative window
   and slides it forward until every required resource admits it.
   Returns the aligned window (possibly the same instant) or ``None``
   when no instant within the horizon fits. The strategies retry the
   machine slot finder from the aligned start when resources push a
   placement later than the machine's preferred slot — the loop is
   bounded so an infeasible instance fails fast.

3. :func:`align_to_resources_backward` is the symmetric helper the
   backward (just-in-time) strategy uses: given a tentative ``latest_end``
   it slides the window *backward* until every required resource admits
   it, and returns the latest feasible instant.

4. :func:`book_resources` commits the placement on every required
   resource once both the machine and the resource layers have
   accepted the window.

Keeping all of this in one file means the two greedy strategies share
identical semantics and tests exercising one also exercise the other
indirectly — no risk of drift.
"""

from __future__ import annotations

from collections.abc import Sequence
from datetime import datetime

from ..entities import Operation, Resource, ResourceRequirement, WorkingCalendar
from ..value_objects import Duration, TimeWindow
from .calendar_resolver import CalendarResolver
from .cumulative_timeline import CumulativeResourceTimeline


def _resolve_requirements(
    operation: Operation,
    requirements: Sequence[ResourceRequirement] | None,
) -> Sequence[ResourceRequirement]:
    """Pick the right requirement list for the aligner helpers.

    Strategies that enumerate routings pass the routing's own
    ``resource_requirements`` explicitly; legacy callers leave
    ``requirements=None`` and fall back to the operation's flat list.
    """
    if requirements is not None:
        return requirements
    return operation.resource_requirements


def build_resource_timelines(
    resources: list[Resource],
    calendars: dict[str, WorkingCalendar],
    resolver: CalendarResolver,
) -> dict[str, CumulativeResourceTimeline]:
    """Create a cumulative timeline per resource and seed calendar gaps.

    Resources without a calendar are treated as permanently available
    (e.g. passive consumables). Resources with a calendar have every
    off-shift window pre-booked at full capacity, which turns the
    calendar constraint into a vanilla cumulative check — no special
    casing elsewhere in the strategy code.
    """
    timelines: dict[str, CumulativeResourceTimeline] = {}
    for resource in resources:
        timeline = CumulativeResourceTimeline(
            resource_id=resource.id, capacity=resource.capacity
        )
        if resource.calendar_id is not None:
            calendar = calendars.get(resource.calendar_id)
            if calendar is not None:
                off_shifts = _off_shift_windows(resolver, calendar)
                for gap in off_shifts:
                    timeline.book(
                        gap,
                        units=resource.capacity,
                        operation_id=f"{resource.id}#off-shift",
                    )
        timelines[resource.id] = timeline
    return timelines


def align_to_resources(
    *,
    earliest_start: datetime,
    duration: Duration,
    operation: Operation,
    timelines: dict[str, CumulativeResourceTimeline],
    horizon_end: datetime,
    requirements: Sequence[ResourceRequirement] | None = None,
) -> datetime | None:
    """Find the earliest instant where every required resource admits the op.

    The search is a monotonic forward scan: we ask each resource for
    its own earliest feasible start (``earliest_feasible_start``) and
    take the maximum. If that max moves forward, we restart the loop
    because another resource may now also be blocked at the new
    instant. The loop terminates when a pass through all resources
    leaves the instant unchanged (fixed point) or when one resource
    returns ``None``.

    ``requirements`` overrides ``operation.resource_requirements`` when
    the caller is evaluating a specific :class:`RoutingAlternative` that
    has its own resource list. Leaving it ``None`` preserves the legacy
    flat-operation behaviour.
    """
    reqs = _resolve_requirements(operation, requirements)
    if not reqs or not timelines:
        return earliest_start

    candidate = earliest_start
    for _ in range(64):  # fixed-point iterations; realistic cap
        moved = False
        for req in reqs:
            timeline = timelines.get(req.resource_id)
            if timeline is None:
                # Unknown resource — context validation should have caught
                # this upstream. Stay defensive and treat as infeasible.
                return None
            feasible = timeline.earliest_feasible_start(
                earliest_start=candidate,
                duration=duration,
                units=req.units,
                horizon_end=horizon_end,
            )
            if feasible is None:
                return None
            if feasible > candidate:
                candidate = feasible
                moved = True
        if not moved:
            return candidate
    return None


def align_to_resources_backward(
    *,
    latest_end: datetime,
    duration: Duration,
    operation: Operation,
    timelines: dict[str, CumulativeResourceTimeline],
    earliest_start: datetime,
    requirements: Sequence[ResourceRequirement] | None = None,
) -> datetime | None:
    """Find the latest instant where every required resource admits the op.

    Symmetric to :func:`align_to_resources`: the scan is monotonic
    *backward*. We query each resource's own latest feasible end
    (``latest_feasible_end``) and take the minimum. If that minimum
    moves back, another resource may now also block at the new instant,
    so the loop restarts. The fixed point is reached when a full pass
    through all resources leaves the instant unchanged, or when any
    resource reports ``None``.

    ``requirements`` overrides the operation's flat list so the backward
    strategy can evaluate individual routing alternatives.
    """
    reqs = _resolve_requirements(operation, requirements)
    if not reqs or not timelines:
        return latest_end

    candidate = latest_end
    for _ in range(64):  # fixed-point iterations; realistic cap
        moved = False
        for req in reqs:
            timeline = timelines.get(req.resource_id)
            if timeline is None:
                # Unknown resource — context validation should have caught
                # this upstream. Stay defensive and treat as infeasible.
                return None
            feasible = timeline.latest_feasible_end(
                latest_end=candidate,
                duration=duration,
                units=req.units,
                earliest_start=earliest_start,
            )
            if feasible is None:
                return None
            if feasible < candidate:
                candidate = feasible
                moved = True
        if not moved:
            return candidate
    return None


def book_resources(
    *,
    window: TimeWindow,
    operation: Operation,
    timelines: dict[str, CumulativeResourceTimeline],
    requirements: Sequence[ResourceRequirement] | None = None,
) -> None:
    """Commit the final placement on every required resource.

    Called *after* the strategy has decided that the machine and every
    resource can accept the window; no further feasibility check is
    performed here.

    ``requirements`` overrides the operation's flat list so the booking
    tracks the resources of the *selected* routing alternative rather
    than the union of every alternative's requirements.
    """
    for req in _resolve_requirements(operation, requirements):
        timeline = timelines.get(req.resource_id)
        if timeline is None:
            continue
        timeline.book(window, req.units, operation.id)


# --------------------------------------------------------------- internals


def _off_shift_windows(
    resolver: CalendarResolver, calendar: WorkingCalendar
) -> list[TimeWindow]:
    """Return the complement of a calendar's working windows within the horizon.

    Reuses :class:`CalendarResolver` so calendar handling stays identical
    to the machine-side logic.
    """
    working = resolver.working_windows(calendar)
    if not working:
        return [TimeWindow(start=resolver.horizon_start, end=resolver.horizon_end)]

    gaps: list[TimeWindow] = []
    cursor = resolver.horizon_start
    for window in working:
        if window.start > cursor:
            gaps.append(TimeWindow(start=cursor, end=window.start))
        cursor = max(cursor, window.end)
    if cursor < resolver.horizon_end:
        gaps.append(TimeWindow(start=cursor, end=resolver.horizon_end))
    return gaps
