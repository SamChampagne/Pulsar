"""View DTOs for the WO Traveler PDF.

These are NOT domain entities — they exist purely to feed Jinja2
templates. ``CoverageStatus`` is a typed Literal so the use case and
template share the same vocabulary.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Literal

CoverageStatus = Literal["covered", "short", "unknown"]


@dataclass(frozen=True, slots=True)
class WoTravelerMaterialLine:
    material_id: str
    required_quantity: float
    coverage_status: CoverageStatus


@dataclass(frozen=True, slots=True)
class WoTravelerOperationLine:
    operation_id: str
    sequence: int
    name: str
    eligible_machine_ids: tuple[str, ...]
    planned_machine_id: str | None
    planned_start: datetime | None
    planned_end: datetime | None
    setup_minutes: int
    run_minutes: int
    materials: tuple[WoTravelerMaterialLine, ...]


@dataclass(frozen=True, slots=True)
class WoTravelerPayload:
    organization_name: str
    workspace_name: str | None
    schedule_id: str
    schedule_published_at: datetime
    generated_at: datetime
    work_order_ref: str
    work_order_name: str
    product_id: str
    quantity: int
    priority: str
    status: str
    due_date: datetime
    release_date: datetime
    planned_start: datetime | None
    planned_end: datetime | None
    operations: tuple[WoTravelerOperationLine, ...]
    total_setup_minutes: int
    total_run_minutes: int
    total_operation_count: int
