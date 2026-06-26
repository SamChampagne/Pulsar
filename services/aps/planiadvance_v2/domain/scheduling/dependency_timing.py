"""Shared timing semantics for advanced dependency links."""

from __future__ import annotations

from datetime import datetime, timedelta

from ..entities import DependencyLink, DependencyType


def dependency_reference_time(
    link: DependencyLink,
    *,
    predecessor_start: datetime,
    predecessor_end: datetime,
) -> datetime:
    """Return the predecessor instant the link is anchored to."""

    if link.dependency_type == DependencyType.START_TO_START:
        return predecessor_start
    return predecessor_end


def dependency_min_start(
    link: DependencyLink,
    *,
    predecessor_start: datetime,
    predecessor_end: datetime,
    transfer_minutes: int = 0,
) -> datetime:
    """Earliest allowed successor productive start for this link."""

    reference = dependency_reference_time(
        link,
        predecessor_start=predecessor_start,
        predecessor_end=predecessor_end,
    )
    extra = transfer_minutes if link.dependency_type == DependencyType.FINISH_TO_START else 0
    return reference + timedelta(minutes=link.lag_minutes + extra)


def dependency_max_start(
    link: DependencyLink,
    *,
    predecessor_start: datetime,
    predecessor_end: datetime,
) -> datetime | None:
    """Latest allowed successor productive start when max-wait is active."""

    if link.max_wait_minutes is None:
        return None
    reference = dependency_reference_time(
        link,
        predecessor_start=predecessor_start,
        predecessor_end=predecessor_end,
    )
    return reference + timedelta(minutes=link.max_wait_minutes)
