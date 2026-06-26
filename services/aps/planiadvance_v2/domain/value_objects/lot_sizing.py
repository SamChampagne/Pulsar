"""Lot-sizing policy value object.

Industrial production rarely runs a whole order as a single batch: long
runs block machines, delay downstream work centres, and inflate WIP. A
``LotSizingPolicy`` tells the engine how to split a work order's quantity
into independent sub-lots that can be scheduled in parallel on different
machines (or sequentially on the same one if capacity is tight).

Three modes are supported:

``NONE``
    No splitting — the entire WO runs as one lot (default).
``FIXED``
    The caller specifies a fixed ``lot_size``; the WO quantity is divided
    into ⌈quantity / lot_size⌉ sub-lots, the last one carrying the
    remainder.
``MIN_MAX``
    The engine chooses the number of lots such that every lot falls within
    ``[min_lot_size, max_lot_size]``.  When there is no exact-equal split,
    the engine maximises parallelism by creating as many lots as possible
    (ceiling strategy).

The policy is a frozen value object — safe to share, hash, and compare.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from enum import Enum, auto

from ..errors import ValidationError


class LotSizingMode(Enum):
    NONE = auto()
    FIXED = auto()
    MIN_MAX = auto()


@dataclass(frozen=True, slots=True)
class LotSizingPolicy:
    """Describes how a work order's quantity is split into production lots."""

    mode: LotSizingMode = LotSizingMode.NONE
    lot_size: int = 0
    min_lot_size: int = 0
    max_lot_size: int = 0

    def __post_init__(self) -> None:
        if self.mode == LotSizingMode.FIXED:
            if self.lot_size <= 0:
                raise ValidationError(
                    "LotSizingPolicy(FIXED): lot_size must be > 0"
                )
        elif self.mode == LotSizingMode.MIN_MAX:
            if self.min_lot_size <= 0:
                raise ValidationError(
                    "LotSizingPolicy(MIN_MAX): min_lot_size must be > 0"
                )
            if self.max_lot_size < self.min_lot_size:
                raise ValidationError(
                    "LotSizingPolicy(MIN_MAX): max_lot_size must be >= min_lot_size"
                )

    # -------------------------------------------------------------- factories

    @classmethod
    def none(cls) -> LotSizingPolicy:
        return cls(mode=LotSizingMode.NONE)

    @classmethod
    def fixed(cls, lot_size: int) -> LotSizingPolicy:
        return cls(mode=LotSizingMode.FIXED, lot_size=lot_size)

    @classmethod
    def min_max(cls, min_size: int, max_size: int) -> LotSizingPolicy:
        return cls(
            mode=LotSizingMode.MIN_MAX,
            min_lot_size=min_size,
            max_lot_size=max_size,
        )

    # ----------------------------------------------------------- lot compute

    def compute_lots(self, total_quantity: int) -> list[int]:
        """Return the list of sub-lot quantities that sum to ``total_quantity``.

        When mode is NONE, returns ``[total_quantity]``.

        For FIXED mode, returns ⌈total / lot_size⌉ lots of ``lot_size``
        except the last lot which gets the remainder (or ``lot_size`` if
        it divides evenly).

        For MIN_MAX mode, maximises the number of lots (= parallelism)
        while keeping every lot within ``[min_lot_size, max_lot_size]``.
        """
        if total_quantity <= 0:
            raise ValidationError(
                f"compute_lots: total_quantity must be > 0, got {total_quantity}"
            )

        if self.mode == LotSizingMode.NONE:
            return [total_quantity]

        if self.mode == LotSizingMode.FIXED:
            return self._fixed_lots(total_quantity)

        return self._min_max_lots(total_quantity)

    def _fixed_lots(self, total: int) -> list[int]:
        if total <= self.lot_size:
            return [total]
        n_full = total // self.lot_size
        remainder = total % self.lot_size
        lots = [self.lot_size] * n_full
        if remainder > 0:
            lots.append(remainder)
        return lots

    def _min_max_lots(self, total: int) -> list[int]:
        if total <= self.max_lot_size:
            return [total]

        # Maximise number of lots: use ceil(total / max_lot_size) lots.
        n_lots = math.ceil(total / self.max_lot_size)
        # Check that each lot is >= min: total / n_lots >= min_lot_size.
        base = total // n_lots
        if base < self.min_lot_size:
            # Too many lots — reduce count.
            n_lots = total // self.min_lot_size
            if n_lots <= 0:
                n_lots = 1
            base = total // n_lots

        remainder = total - base * n_lots
        # Distribute remainder across first `remainder` lots (+1 each).
        lots = [base + (1 if i < remainder else 0) for i in range(n_lots)]
        return lots
