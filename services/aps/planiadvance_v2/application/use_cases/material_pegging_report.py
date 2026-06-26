"""Planner-facing material pegging report.

Strategies already emit `material_reservations`. This helper consolidates that
trace into a stable report for API/UI/support tooling without changing solver
reservation logic.
"""

from __future__ import annotations

from collections import defaultdict
from typing import Any


def build_material_pegging_report(
    material_reservations: list[dict[str, Any]] | None,
    *,
    max_records: int = 25,
) -> dict[str, object]:
    """Summarize reservation coverage, source usage, and uncovered demand."""

    records = [
        reservation
        for reservation in (material_reservations or [])
        if isinstance(reservation, dict)
        and isinstance(reservation.get("material_id"), str)
        and isinstance(reservation.get("operation_id"), str)
    ]
    if not records:
        return {
            "available": False,
            "status": "none",
            "reservation_count": 0,
            "material_count": 0,
            "operation_count": 0,
            "material_coverage": [],
            "source_usage": [],
            "blocked_operations": [],
            "pegging_records": [],
        }

    required_by_material: dict[str, float] = defaultdict(float)
    covered_by_material: dict[str, float] = defaultdict(float)
    uncovered_by_material: dict[str, float] = defaultdict(float)
    operations_by_material: dict[str, set[str]] = defaultdict(set)
    source_usage: dict[tuple[str, str, str], float] = defaultdict(float)
    blocked_operations: list[dict[str, object]] = []
    pegging_records: list[dict[str, object]] = []

    for reservation in records:
        material_id = str(reservation["material_id"])
        operation_id = str(reservation["operation_id"])
        quantity = _to_float(reservation.get("quantity"))
        uncovered = _to_float(reservation.get("uncovered_quantity"))
        covered = max(0.0, quantity - uncovered)

        required_by_material[material_id] += quantity
        covered_by_material[material_id] += covered
        uncovered_by_material[material_id] += uncovered
        operations_by_material[material_id].add(operation_id)

        allocations = _normalized_allocations(reservation.get("allocations"))
        for allocation in allocations:
            source_id = str(allocation["source_id"])
            source_type = str(allocation.get("source_type") or "unknown")
            key = (material_id, source_id, source_type)
            source_usage[key] += _to_float(allocation.get("quantity"))

        record = {
            "operation_id": operation_id,
            "material_id": material_id,
            "quantity": quantity,
            "covered_quantity": covered,
            "uncovered_quantity": uncovered,
            "required_at": reservation.get("required_at"),
            "source": reservation.get("source"),
            "allocations": allocations,
            "coverage_status": "covered" if uncovered <= 1e-9 else "short",
        }
        pegging_records.append(record)
        if uncovered > 1e-9:
            blocked_operations.append(
                {
                    "operation_id": operation_id,
                    "material_id": material_id,
                    "uncovered_quantity": uncovered,
                    "required_at": reservation.get("required_at"),
                    "suggested_action": (
                        "Expedite supply, reallocate inventory, or delay the "
                        "operation until material is available."
                    ),
                }
            )

    material_coverage = [
        {
            "material_id": material_id,
            "required_quantity": round(required_by_material[material_id], 6),
            "covered_quantity": round(covered_by_material[material_id], 6),
            "uncovered_quantity": round(uncovered_by_material[material_id], 6),
            "operation_count": len(operations_by_material[material_id]),
            "coverage_ratio": _coverage_ratio(
                required_by_material[material_id],
                covered_by_material[material_id],
            ),
            "status": (
                "covered"
                if uncovered_by_material[material_id] <= 1e-9
                else "short"
            ),
        }
        for material_id in sorted(required_by_material)
    ]
    source_usage_rows = [
        {
            "material_id": material_id,
            "source_id": source_id,
            "source_type": source_type,
            "allocated_quantity": round(quantity, 6),
        }
        for (material_id, source_id, source_type), quantity in sorted(
            source_usage.items(),
            key=lambda item: (item[0][0], item[0][2], item[0][1]),
        )
    ]
    uncovered_count = len(blocked_operations)
    return {
        "available": True,
        "status": "covered" if uncovered_count == 0 else "short",
        "reservation_count": len(records),
        "material_count": len(required_by_material),
        "operation_count": len({str(record["operation_id"]) for record in records}),
        "fully_covered_reservation_count": len(records) - uncovered_count,
        "uncovered_reservation_count": uncovered_count,
        "material_coverage": material_coverage,
        "source_usage": source_usage_rows,
        "blocked_operations": blocked_operations[:max_records],
        "pegging_records": pegging_records[:max_records],
    }


def _normalized_allocations(value: object) -> list[dict[str, object]]:
    if not isinstance(value, list):
        return []
    allocations: list[dict[str, object]] = []
    for item in value:
        if not isinstance(item, dict) or not isinstance(item.get("source_id"), str):
            continue
        allocations.append(
            {
                "source_id": item["source_id"],
                "source_type": item.get("source_type") or "unknown",
                "quantity": _to_float(item.get("quantity")),
                "available_at": item.get("available_at"),
            }
        )
    return allocations


def _to_float(value: object) -> float:
    if isinstance(value, (int, float)):
        return float(value)
    return 0.0


def _coverage_ratio(required: float, covered: float) -> float:
    if required <= 1e-9:
        return 1.0
    return round(min(1.0, covered / required), 6)
