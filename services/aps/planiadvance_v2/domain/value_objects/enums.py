"""Domain enumerations.

Kept as a single module (rather than one file per enum) because these are
small and always used together.
"""

from __future__ import annotations

from enum import IntEnum, StrEnum


class Priority(IntEnum):
    """Work order priority. Higher value = higher importance."""

    LOW = 1
    NORMAL = 2
    HIGH = 3
    URGENT = 4


class WorkOrderStatus(StrEnum):
    RELEASED = "released"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    CANCELLED = "cancelled"


class WorkOrderFirmness(StrEnum):
    """V1.2 Cas 2 — distinguishes the kind of demand a WO represents.

    Drives how the engine weighs lateness penalty and yields capacity
    when firm orders compete with forecast / tentative ones.

    - ``firm``: real customer order with a hard commitment. Lateness
      penalty applied at full weight; the engine fights for the
      due date.
    - ``forecast``: predicted demand pushed from the ERP forecasting
      module. Should be scheduled when capacity is free but yields
      to firm orders under contention. Lateness counted at 30 % of
      the firm weight.
    - ``tentative``: planning-only what-if (e.g. a prospect quote that
      hasn't closed). Even softer than forecast. 10 % weight.
    """

    FIRM = "firm"
    FORECAST = "forecast"
    TENTATIVE = "tentative"


class OperationStatus(StrEnum):
    PENDING = "pending"
    SCHEDULED = "scheduled"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"


class ExecutionStatus(StrEnum):
    NOT_STARTED = "not_started"
    QUEUED = "queued"
    IN_PROGRESS = "in_progress"
    PAUSED = "paused"
    COMPLETED = "completed"
    BLOCKED = "blocked"
    SCRAPPED = "scrapped"
    PARTIALLY_COMPLETED = "partially_completed"


class PlanningLock(StrEnum):
    FREE = "free"
    SOFT_LOCKED = "soft_locked"
    MANUAL_PINNED = "manual_pinned"
    FIRM = "firm"
    STARTED_FROZEN = "started_frozen"
    COMPLETED_FROZEN = "completed_frozen"


class PlanningZone(StrEnum):
    FROZEN = "frozen"
    SLUSHY = "slushy"
    LIQUID = "liquid"
