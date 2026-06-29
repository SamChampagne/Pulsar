"""View DTOs for the Executive Dashboard JSON endpoint.

These are NOT domain entities — they exist purely to serialize the
dashboard payload. ``as_dict()`` produces the JSON shape the frontend
consumes.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime


@dataclass(frozen=True, slots=True)
class TopLateOrder:
    work_order_ref: str
    work_order_name: str
    due_date: datetime
    planned_end: datetime | None
    lateness_minutes: int | None

    def as_dict(self) -> dict[str, object]:
        return {
            "work_order_ref": self.work_order_ref,
            "work_order_name": self.work_order_name,
            "due_date": self.due_date.isoformat(),
            "planned_end": self.planned_end.isoformat()
            if self.planned_end is not None
            else None,
            "lateness_minutes": self.lateness_minutes,
        }


@dataclass(frozen=True, slots=True)
class ScheduleSample:
    schedule_id: str
    published_at: datetime
    makespan_minutes: int
    on_time_ratio: float
    avg_utilization: float
    queue_time_minutes_avg: int
    changeover_ratio: float
    saturation_max: float
    saturation_p95: float
    wip_operation_count: int
    campaign_efficiency: float

    def as_dict(self) -> dict[str, object]:
        return {
            "schedule_id": self.schedule_id,
            "published_at": self.published_at.isoformat(),
            "makespan_minutes": self.makespan_minutes,
            "on_time_ratio": round(self.on_time_ratio, 4),
            "avg_utilization": round(self.avg_utilization, 4),
            "queue_time_minutes_avg": self.queue_time_minutes_avg,
            "changeover_ratio": round(self.changeover_ratio, 4),
            "saturation_max": round(self.saturation_max, 4),
            "saturation_p95": round(self.saturation_p95, 4),
            "wip_operation_count": self.wip_operation_count,
            "campaign_efficiency": round(self.campaign_efficiency, 4),
        }


@dataclass(frozen=True, slots=True)
class KpiSnapshot:
    makespan_minutes: int
    on_time_ratio: float
    avg_utilization: float
    queue_time_minutes_avg: int
    changeover_ratio: float
    saturation_max: float
    saturation_p95: float
    wip_operation_count: int
    campaign_efficiency: float
    makespan_delta_minutes: int | None
    on_time_delta: float | None
    avg_utilization_delta: float | None
    queue_time_delta_minutes: int | None
    changeover_delta: float | None
    saturation_max_delta: float | None
    saturation_p95_delta: float | None
    wip_delta: int | None
    campaign_efficiency_delta: float | None

    def as_dict(self) -> dict[str, object]:
        return {
            "makespan_minutes": self.makespan_minutes,
            "on_time_ratio": round(self.on_time_ratio, 4),
            "avg_utilization": round(self.avg_utilization, 4),
            "queue_time_minutes_avg": self.queue_time_minutes_avg,
            "changeover_ratio": round(self.changeover_ratio, 4),
            "saturation_max": round(self.saturation_max, 4),
            "saturation_p95": round(self.saturation_p95, 4),
            "wip_operation_count": self.wip_operation_count,
            "campaign_efficiency": round(self.campaign_efficiency, 4),
            "makespan_delta_minutes": self.makespan_delta_minutes,
            "on_time_delta": _round_or_none(self.on_time_delta),
            "avg_utilization_delta": _round_or_none(self.avg_utilization_delta),
            "queue_time_delta_minutes": self.queue_time_delta_minutes,
            "changeover_delta": _round_or_none(self.changeover_delta),
            "saturation_max_delta": _round_or_none(self.saturation_max_delta),
            "saturation_p95_delta": _round_or_none(self.saturation_p95_delta),
            "wip_delta": self.wip_delta,
            "campaign_efficiency_delta": _round_or_none(self.campaign_efficiency_delta),
        }


def _round_or_none(value: float | None) -> float | None:
    return round(value, 4) if value is not None else None


@dataclass(frozen=True, slots=True)
class ExecutiveDashboardOutput:
    range_label: str
    range_start: datetime
    range_end: datetime
    generated_at: datetime
    scenarios_published_count: int
    schedule_samples: tuple[ScheduleSample, ...]
    current_kpis: KpiSnapshot
    top_late_orders: tuple[TopLateOrder, ...]

    def as_dict(self) -> dict[str, object]:
        return {
            "range_label": self.range_label,
            "range_start": self.range_start.isoformat(),
            "range_end": self.range_end.isoformat(),
            "generated_at": self.generated_at.isoformat(),
            "scenarios_published_count": self.scenarios_published_count,
            "schedule_samples": [s.as_dict() for s in self.schedule_samples],
            "current_kpis": self.current_kpis.as_dict(),
            "top_late_orders": [t.as_dict() for t in self.top_late_orders],
        }
