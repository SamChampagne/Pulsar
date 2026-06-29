"""Scheduling heuristics: operation ordering strategies.

Heuristics decide *in what order* operations are considered by the greedy
forward scheduler. They don't place operations — that's the scheduler's job
— they only rank pending operations.

A :class:`Heuristic` is a simple callable protocol: it takes the current
list of pending (work_order, operation) pairs and returns the same list in
the desired order.
"""

from __future__ import annotations

import math
from datetime import datetime
from typing import Protocol

from ..entities import Operation, WorkOrder
from ..errors import ValidationError

PendingItem = tuple[WorkOrder, Operation]


class Heuristic(Protocol):
    name: str

    def order(self, pending: list[PendingItem], now: datetime) -> list[PendingItem]: ...


# V1.2 Cas 2 — firmness rank for sort tiebreaks. Firm wins when due
# dates and priorities are otherwise equal so forecast / tentative
# WOs yield capacity to real customer orders.
_FIRMNESS_RANK = {"firm": 0, "forecast": 1, "tentative": 2}


def _firmness_rank(work_order) -> int:
    return _FIRMNESS_RANK.get(getattr(work_order.firmness, "value", "firm"), 0)


class EarliestDueDateFirst:
    """Classic EDD: operations of the most urgent work orders go first."""

    name = "edd"

    def order(self, pending: list[PendingItem], now: datetime) -> list[PendingItem]:
        return sorted(
            pending,
            key=lambda pair: (
                pair[0].due_date,
                _firmness_rank(pair[0]),
                pair[1].sequence,
            ),
        )


class PriorityWeightedEDD:
    """Priority first, then due date. Useful when business priority overrides
    the strict due-date ordering (e.g. strategic customers)."""

    name = "priority_edd"

    def order(self, pending: list[PendingItem], now: datetime) -> list[PendingItem]:
        return sorted(
            pending,
            key=lambda pair: (
                -int(pair[0].priority),  # negate so higher priority sorts first
                _firmness_rank(pair[0]),
                pair[0].due_date,
                pair[1].sequence,
            ),
        )


class ShortestProcessingTimeFirst:
    """SPT: schedule quick operations first. Good for minimising average
    flow time but bad for large jobs (they can be starved)."""

    name = "spt"

    def order(self, pending: list[PendingItem], now: datetime) -> list[PendingItem]:
        return sorted(
            pending,
            key=lambda pair: (pair[1].total_processing_time.minutes, pair[0].due_date),
        )


class CriticalRatioFirst:
    """CR = (time_until_due) / (remaining_processing_time).

    CR < 1 means the job is already behind schedule. Scheduling the lowest
    CR first maximises the chance of recovering late jobs.
    """

    name = "critical_ratio"

    def order(self, pending: list[PendingItem], now: datetime) -> list[PendingItem]:
        def cr(pair: PendingItem) -> float:
            wo, op = pair
            time_left = max((wo.due_date - now).total_seconds() / 60.0, 1.0)
            return time_left / max(op.total_processing_time.minutes, 1)

        return sorted(pending, key=cr)


class ApparentTardinessCost:
    """Vepsalainen & Morton's Apparent Tardiness Cost rule.

    ATC dispatches jobs by a priority index that blends weighted SPT with
    a due-date pressure factor. For pending job ``j`` at decision time
    ``t`` the index is

        π_j(t) = (w_j / p_j) · exp(-max(d_j - p_j - t, 0) / (k · p_avg))

    where ``w_j`` is the job's weight (derived from :class:`Priority`),
    ``p_j`` its remaining processing time, ``d_j`` its due date and
    ``p_avg`` the average processing time of the pending set. The
    look-ahead constant ``k`` controls how aggressively the rule switches
    from weighted SPT (for distant due dates) to EDD-like behaviour (as
    slack approaches zero); practical values sit in ``[1, 5]`` and ``2``
    is the textbook default for shop-floor environments.

    Sorting by the index in descending order gives the most
    *time-critical* high-weight job first, which empirically minimises
    weighted tardiness on single- and multi-machine shops — a strictly
    better default than EDD whenever work orders carry business
    priorities.
    """

    name = "atc"

    def __init__(self, *, k: float = 2.0) -> None:
        if k <= 0:
            raise ValidationError("ATC look-ahead parameter k must be > 0")
        self._k = k

    def order(self, pending: list[PendingItem], now: datetime) -> list[PendingItem]:
        if not pending:
            return []

        processing = [max(op.total_processing_time.minutes, 1) for _, op in pending]
        p_avg = sum(processing) / len(processing)
        scale = self._k * p_avg if p_avg > 0 else 1.0

        def atc_index(pair: PendingItem, p_j: int) -> float:
            wo, _op = pair
            weight = float(int(wo.priority))
            slack_min = (wo.due_date - now).total_seconds() / 60.0 - p_j
            pressure = math.exp(-max(slack_min, 0.0) / scale)
            return (weight / p_j) * pressure

        indexed = list(zip(pending, processing, strict=False))
        # Descending index; tie-break by due date, then work-order id,
        # then operation sequence so the output is independent of the
        # input order — critical when multiple jobs share identical
        # priority/duration/due (common in synthetic tests and reruns).
        indexed.sort(
            key=lambda item: (
                -atc_index(item[0], item[1]),
                item[0][0].due_date,
                item[0][0].id,
                item[0][1].sequence,
            )
        )
        return [pair for pair, _ in indexed]


class FixedOrderHeuristic:
    """Order operations by their position in an externally supplied list.

    Used by :class:`SimulatedAnnealingStrategy` to replay a specific
    operation permutation through the greedy scheduler: SA explores the
    permutation space, and each candidate permutation is evaluated by
    feeding it here so the same feasibility/placement logic is reused.

    Operations absent from ``priority_order`` sort after the listed ones
    (rank ``len(order)``), preserving the scheduler's invariant that
    every pending op gets a rank.
    """

    name = "fixed_order"

    def __init__(self, priority_order: list[str]) -> None:
        self._rank = {op_id: idx for idx, op_id in enumerate(priority_order)}
        self._tail = len(priority_order)

    def order(self, pending: list[PendingItem], now: datetime) -> list[PendingItem]:
        return sorted(
            pending,
            key=lambda pair: (
                self._rank.get(pair[1].id, self._tail),
                pair[1].sequence,
            ),
        )


_REGISTRY: dict[str, type[Heuristic]] = {
    EarliestDueDateFirst.name: EarliestDueDateFirst,
    PriorityWeightedEDD.name: PriorityWeightedEDD,
    ShortestProcessingTimeFirst.name: ShortestProcessingTimeFirst,
    CriticalRatioFirst.name: CriticalRatioFirst,
    ApparentTardinessCost.name: ApparentTardinessCost,
}


def resolve_heuristic(name: str) -> Heuristic:
    """Lookup a heuristic by its short name (``"edd"``, ``"spt"``, ...)."""
    key = name.lower().strip()
    cls = _REGISTRY.get(key)
    if cls is None:
        raise ValidationError(
            f"Unknown heuristic {name!r}. Available: {sorted(_REGISTRY)}"
        )
    return cls()
