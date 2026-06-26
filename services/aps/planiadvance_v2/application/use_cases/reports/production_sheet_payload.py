"""View DTOs for the Production Sheet PDF.

These are NOT domain entities - they exist purely to feed Jinja2
templates. Keeping them next to the use case keeps print-specific
concerns out of ``domain/``.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime


@dataclass(frozen=True, slots=True)
class ProductionSheetLine:
    operation_id: str
    work_order_ref: str
    work_order_name: str
    sequence: int
    start: datetime
    end: datetime
    setup_minutes: int
    run_minutes: int
    notes: str | None = None


@dataclass(frozen=True, slots=True)
class ProductionSheetPayload:
    machine_id: str
    machine_name: str
    organization_name: str
    workspace_name: str | None
    date: date
    schedule_id: str
    schedule_published_at: datetime
    lines: tuple[ProductionSheetLine, ...]
    total_setup_minutes: int
    total_run_minutes: int
    total_operation_count: int
