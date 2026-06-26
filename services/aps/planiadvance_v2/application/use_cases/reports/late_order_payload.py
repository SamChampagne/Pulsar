"""View DTOs for the Late-order PDF.

These are NOT domain entities — they exist purely to feed Jinja2
templates. ``LateOrderReason`` and ``RecommendedAction`` are typed
literals so the downstream classifier and template both consume the
same vocabulary.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Literal

LateOrderReason = Literal["material", "capacity", "priority", "sequence"]
RecommendedAction = Literal[
    "expedite_material",
    "add_overtime_or_reroute",
    "review_priority",
    "split_lot_or_reroute",
]

REASON_TO_ACTION: dict[LateOrderReason, RecommendedAction] = {
    "material": "expedite_material",
    "capacity": "add_overtime_or_reroute",
    "priority": "review_priority",
    "sequence": "split_lot_or_reroute",
}


@dataclass(frozen=True, slots=True)
class LateOrderLine:
    work_order_ref: str
    work_order_name: str
    due_date: datetime
    planned_end: datetime | None
    lateness_minutes: int | None
    priority: str
    reason: LateOrderReason
    recommended_action: RecommendedAction


@dataclass(frozen=True, slots=True)
class LateOrderPayload:
    organization_name: str
    workspace_name: str | None
    schedule_id: str
    schedule_published_at: datetime
    generated_at: datetime
    horizon_start: datetime | None
    horizon_end: datetime | None
    lines: tuple[LateOrderLine, ...]
    total_late_count: int
    total_lateness_minutes: int
    by_reason: dict[LateOrderReason, int]
