"""Shared helper: compute the setup duration for an (op, machine) pair.

Having a single resolver for setup minutes guarantees that the greedy
strategy, the CP-SAT strategy and any future plugin all compute setups
the same way — a common source of hard-to-find bugs when each backend
reimplements the lookup.

Precedence rules
----------------
1. If the machine has no :class:`SetupMatrix`, return the fallback
   ``default_minutes`` (or, if omitted, the operation's flat
   ``setup_time``).
2. If the machine has a matrix but the operation has no ``setup_family``,
   also return the fallback — we don't want the matrix to silently
   override values for un-classified operations.
3. Otherwise, consult the matrix with the previous family on that machine
   (``None`` → initial setup).

The optional ``default_minutes`` argument lets callers iterating over
:class:`RoutingAlternative` entries supply the alternative's own
``setup_time``: two routings on the same machine may declare different
setups, and the lookup must honour the *selected* alternative rather than
the operation's flat setup time.
"""

from __future__ import annotations

from ..entities import Machine, Operation


def resolve_setup_minutes(
    *,
    operation: Operation,
    machine: Machine,
    previous_family: str | None,
    default_minutes: int | None = None,
) -> int:
    """Return the setup minutes to apply for this (op, machine) placement."""
    fallback = (
        default_minutes
        if default_minutes is not None
        else operation.setup_time.minutes
    )
    if machine.setup_matrix is None or operation.setup_family is None:
        return fallback
    return machine.setup_matrix.get(previous_family, operation.setup_family)
