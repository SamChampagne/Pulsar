"""Sequence-dependent setup time matrix.

Real manufacturing cells almost always have **sequence-dependent** setup
times: switching from product A to product B on a painting line is cheap
if B uses the same colour family and expensive if a full cleaning is
needed. Representing setup as a single per-operation constant (as V2 does
today) is the #1 limitation of the engine for industrial use.

A :class:`SetupMatrix` maps ``(from_family, to_family)`` pairs to a setup
duration. "Family" is a free-form string (product type, tooling group,
colour, etc.) exposed via :class:`Operation.setup_family`. The matrix is
attached to a :class:`Machine` — different machines can have different
changeover cost structures.

The matrix is sparse: only non-default entries need to be provided. A
``default`` fall-back setup applies whenever a specific cell is missing,
and the special "first op on the machine" transition uses the dedicated
``initial`` setup.

Design notes
------------
- Frozen dataclass → safe to share between strategies.
- Integer minutes → directly usable by CP-SAT (no float rounding).
- Symmetric lookup helper (``get``) — callers never touch the dict.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from ..errors import ValidationError


@dataclass(frozen=True, slots=True)
class SetupMatrix:
    """Per-machine sequence-dependent setup time matrix.

    Parameters
    ----------
    machine_id:
        Machine this matrix belongs to.
    default_minutes:
        Default setup duration used when no specific ``(from, to)`` entry
        matches — ensures the matrix is always total (avoids missing-key
        bugs in the scheduler).
    initial_minutes:
        Setup applied to the *first* operation scheduled on the machine
        (no prior family to transition from). Defaults to ``0``.
    transitions:
        Dict of ``(from_family, to_family) -> minutes``. Omit any pair
        that uses the default. Self-transitions ``("A", "A") -> 0`` are
        implicit: if you don't override them, the default is used, so
        remember to declare them if you want free changeovers within a
        family.
    """

    machine_id: str
    default_minutes: int = 0
    initial_minutes: int = 0
    transitions: dict[tuple[str, str], int] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if not self.machine_id:
            raise ValidationError("SetupMatrix.machine_id is required")
        if self.default_minutes < 0:
            raise ValidationError(
                f"SetupMatrix {self.machine_id}: default_minutes must be >= 0"
            )
        if self.initial_minutes < 0:
            raise ValidationError(
                f"SetupMatrix {self.machine_id}: initial_minutes must be >= 0"
            )
        for (src, dst), minutes in self.transitions.items():
            if minutes < 0:
                raise ValidationError(
                    f"SetupMatrix {self.machine_id}: transition "
                    f"({src!r} -> {dst!r}) has negative minutes {minutes}"
                )

    def get(self, from_family: str | None, to_family: str | None) -> int:
        """Return the setup minutes for a changeover.

        ``from_family=None`` means this is the first operation on the
        machine (the ``initial_minutes`` value is returned). ``to_family
        =None`` falls back to the default.
        """
        if from_family is None:
            return self.initial_minutes
        if to_family is None:
            return self.default_minutes
        return self.transitions.get((from_family, to_family), self.default_minutes)

    @classmethod
    def uniform(cls, machine_id: str, minutes: int) -> SetupMatrix:
        """Convenience: a matrix where every transition costs the same."""
        return cls(machine_id=machine_id, default_minutes=minutes, initial_minutes=minutes)

    @classmethod
    def zero(cls, machine_id: str) -> SetupMatrix:
        """Convenience: a zero-setup matrix (backward-compat default)."""
        return cls(machine_id=machine_id)
