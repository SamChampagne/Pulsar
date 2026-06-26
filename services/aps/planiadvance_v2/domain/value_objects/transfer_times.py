"""Machine-to-machine transfer (material handling) times.

Real shops rarely have zero-cost hand-off: moving a part from a lathe
to a grinder takes an AGV trip, a forklift, or a walk to the next cell.
Ignoring that delay is a classical first-lesson mistake of academic job-
shop solvers — the resulting schedule looks tight on paper but misses
every downstream start time by the transport duration.

:class:`TransferTimes` is a sparse matrix:

- ``default_minutes`` applies to any machine pair not listed explicitly
  (0 by default, so legacy contexts behave unchanged).
- ``pairs`` overrides the default for specific ``(from_machine, to_machine)``
  hops — asymmetric by design, since a downhill AGV run is typically
  cheaper than the return trip.
- Transfers from a machine to *itself* are always zero (the part stays
  put), and a hop with ``None`` as either endpoint — used when there is
  no predecessor yet — is also zero.

The object is frozen so it can be shared across strategies and cached
without risk of mutation. All values are integer minutes to stay on
the same arithmetic basis as ``Duration`` and CP-SAT.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from ..errors import ValidationError


@dataclass(frozen=True, slots=True)
class TransferTimes:
    """Sparse machine-to-machine transport delay matrix.

    Parameters
    ----------
    default_minutes:
        Delay applied to any pair not listed in ``pairs``. Defaults to
        ``0`` so contexts that never set transfer times keep the legacy
        behaviour (instantaneous hand-off).
    pairs:
        Explicit overrides, indexed by ``(from_machine_id, to_machine_id)``.
    """

    default_minutes: int = 0
    pairs: dict[tuple[str, str], int] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if self.default_minutes < 0:
            raise ValidationError(
                f"TransferTimes.default_minutes must be >= 0, got "
                f"{self.default_minutes}"
            )
        for (src, dst), minutes in self.pairs.items():
            if minutes < 0:
                raise ValidationError(
                    f"TransferTimes[{src!r} -> {dst!r}] must be >= 0, got "
                    f"{minutes}"
                )

    def minutes(self, src: str | None, dst: str | None) -> int:
        """Return the transfer delay from ``src`` to ``dst`` in minutes.

        A missing endpoint (the first op of a work order has no
        predecessor machine) and a self-loop both resolve to zero — the
        part does not need to be moved in either case.
        """
        if src is None or dst is None or src == dst:
            return 0
        return self.pairs.get((src, dst), self.default_minutes)

    @classmethod
    def zero(cls) -> TransferTimes:
        """Convenience: explicit zero matrix for tests and defaults."""
        return cls()

    @classmethod
    def uniform(cls, minutes: int) -> TransferTimes:
        """Convenience: every distinct-machine hop costs the same."""
        return cls(default_minutes=minutes)
