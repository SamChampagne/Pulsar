"""Pluggable constraints checked before committing a booking.

Constraints are the "business rules" of the APS engine. They are kept
separate from the scheduler so that adding a new rule (e.g. "no welding
during night shift") doesn't require touching the main algorithm.

Each constraint implements :class:`Constraint` and returns a reason string
when it rejects a candidate placement. The scheduler short-circuits on the
first rejection and moves on to the next candidate.
"""

from __future__ import annotations

from typing import Protocol

from ..entities import Machine, Operation
from ..value_objects import TimeWindow


class PlacementProposal:
    """A candidate placement considered by the scheduler."""

    __slots__ = ("operation", "machine", "window")

    def __init__(
        self, operation: Operation, machine: Machine, window: TimeWindow
    ) -> None:
        self.operation = operation
        self.machine = machine
        self.window = window


class Constraint(Protocol):
    name: str

    def validate(self, proposal: PlacementProposal) -> str | None:
        """Return ``None`` if ok, or a human-readable rejection reason."""


class EligibilityConstraint:
    """Enforces ``machine.id in operation.eligible_machine_ids``.

    The scheduler already only considers eligible machines, but having this
    as an explicit constraint means any third-party plugin that bypasses
    the default machine-picking path is still protected.
    """

    name = "eligibility"

    def validate(self, proposal: PlacementProposal) -> str | None:
        if proposal.machine.id not in proposal.operation.eligible_machine_ids:
            return (
                f"Machine {proposal.machine.id} not eligible for "
                f"operation {proposal.operation.id}"
            )
        return None


class CapabilityConstraint:
    """Every capability tag on the operation's name prefix must be present
    on the machine. Simple example of how to extend the ruleset.
    """

    name = "capability"

    def __init__(self, required: dict[str, list[str]] | None = None) -> None:
        self._required = required or {}

    def validate(self, proposal: PlacementProposal) -> str | None:
        required = self._required.get(proposal.operation.id, [])
        missing = [c for c in required if not proposal.machine.has_capability(c)]
        if missing:
            return (
                f"Machine {proposal.machine.id} missing capabilities {missing} "
                f"for operation {proposal.operation.id}"
            )
        return None


DEFAULT_CONSTRAINTS: tuple[Constraint, ...] = (EligibilityConstraint(),)
