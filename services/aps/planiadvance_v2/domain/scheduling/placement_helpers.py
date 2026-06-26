"""Shared helpers used by the greedy-family strategies.

Both :class:`GreedyStrategy` and :class:`BackwardGreedyStrategy` need the
same tiny utilities: adjusting a duration for a machine's efficiency,
running a placement through the pluggable constraint list, and picking
the name of the first offending constraint for the diagnosis report.

Keeping them in one module avoids copy-paste drift and gives future
strategies (simulated annealing, tabu, rolling-horizon) a single place
to reuse. The helpers are pure functions so they can be called from any
context without state concerns.
"""

from __future__ import annotations

from ..value_objects import Duration
from .constraints import Constraint, PlacementProposal


def adjust_duration_for_efficiency(duration: Duration, efficiency: float) -> Duration:
    """Scale ``duration`` by ``1 / efficiency`` (slower machine → longer op).

    Efficiency of ``1.0`` returns the input unchanged so unit tests that
    ignore efficiency stay bit-identical. Values below ``1.0`` lengthen
    the duration; values above ``1.0`` shorten it. The result is always
    at least one minute — a degenerate zero-minute op would be rejected
    downstream by the placement logic anyway.
    """
    if efficiency == 1.0:
        return duration
    adjusted = int(round(duration.minutes / efficiency))
    return Duration(minutes=max(adjusted, 1))


def first_constraint_rejection(
    constraints: tuple[Constraint, ...], proposal: PlacementProposal
) -> tuple[str, str] | None:
    """Run every constraint and return ``(reason, name)`` of the first reject.

    Returns ``None`` when every constraint accepts the proposal. The
    caller typically logs both parts: the human-readable ``reason`` in
    the diagnosis blocker's message and the ``name`` in its
    ``constraint_name`` field.
    """
    for constraint in constraints:
        reason = constraint.validate(proposal)
        if reason is not None:
            name = getattr(constraint, "name", constraint.__class__.__name__)
            return reason, name
    return None
