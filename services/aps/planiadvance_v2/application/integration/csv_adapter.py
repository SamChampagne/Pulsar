"""CSV adapter for the canonical APS planning snapshot.

This adapter is intentionally small and deterministic: callers provide CSV
content as strings, and the adapter returns a canonical snapshot that goes
through the same validation/import pipeline as ERP API payloads.
"""

from __future__ import annotations

import csv
from dataclasses import dataclass, field
from datetime import datetime, time
from io import StringIO

from .canonical_mapper import CONTRACT_VERSION
from .canonical_snapshot import (
    CanonicalCalendar,
    CanonicalMachine,
    CanonicalOperation,
    CanonicalPlanningSnapshot,
    CanonicalShift,
    CanonicalTransferTimes,
    CanonicalWorkOrder,
)


@dataclass(frozen=True, slots=True)
class CanonicalCsvBundle:
    calendars_csv: str
    machines_csv: str = ""
    work_orders_csv: str = ""
    operations_csv: str = ""
    source_system: str = "csv"
    exported_at: datetime | None = None
    metadata: dict[str, object] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class _CsvRow:
    values: dict[str, str]
    source_file: str
    row_number: int


def snapshot_from_csv_bundle(bundle: CanonicalCsvBundle) -> CanonicalPlanningSnapshot:
    calendar_rows = _read_rows(bundle.calendars_csv, source_file="calendars.csv")
    machine_rows = _read_rows(bundle.machines_csv, source_file="machines.csv")
    work_order_rows = _read_rows(bundle.work_orders_csv, source_file="work_orders.csv")
    operation_rows = _read_rows(bundle.operations_csv, source_file="operations.csv")

    calendars = _calendars_from_rows(calendar_rows)
    source_rows: dict[str, dict[str, dict[str, object]]] = {}
    for row in calendar_rows:
        _record_source_row(source_rows, "calendar", _required(row.values, "id"), row)
    for row in machine_rows:
        _record_source_row(source_rows, "machine", _required(row.values, "id"), row)
    for row in work_order_rows:
        _record_source_row(source_rows, "work_order", _required(row.values, "id"), row)
    for row in operation_rows:
        _record_source_row(source_rows, "operation", _required(row.values, "id"), row)

    operations_by_work_order: dict[str, list[CanonicalOperation]] = {}
    for row in operation_rows:
        operation = _operation_from_row(row.values)
        operations_by_work_order.setdefault(operation.work_order_id, []).append(operation)
    metadata = dict(bundle.metadata)
    metadata["source_rows"] = source_rows

    return CanonicalPlanningSnapshot(
        contract_version=CONTRACT_VERSION,
        exported_at=bundle.exported_at or datetime.utcnow(),
        source_system=bundle.source_system,
        calendars=tuple(calendars),
        machines=tuple(_machine_from_row(row.values) for row in machine_rows),
        work_orders=tuple(
            _work_order_from_row(
                row.values,
                operations=operations_by_work_order.get(_required(row.values, "id"), []),
            )
            for row in work_order_rows
        ),
        transfer_times=CanonicalTransferTimes(),
        metadata=metadata,
    )


def _read_rows(content: str, *, source_file: str) -> list[_CsvRow]:
    if not content.strip():
        return []
    reader = csv.DictReader(StringIO(content))
    return [
        _CsvRow(
            values={key: (value or "").strip() for key, value in row.items()},
            source_file=source_file,
            row_number=line_number,
        )
        for line_number, row in enumerate(reader, start=2)
        if any((value or "").strip() for value in row.values())
    ]


def _calendars_from_rows(rows: list[_CsvRow]) -> list[CanonicalCalendar]:
    shifts_by_calendar: dict[str, list[CanonicalShift]] = {}
    names: dict[str, str] = {}
    site_ids: dict[str, str | None] = {}
    for row in rows:
        values = row.values
        calendar_id = _required(values, "id")
        names[calendar_id] = values.get("name") or calendar_id
        site_ids[calendar_id] = values.get("site_id") or None
        shifts_by_calendar.setdefault(calendar_id, []).append(
            CanonicalShift(
                weekday=int(_required(values, "weekday")),
                start=time.fromisoformat(_required(values, "start")),
                end=time.fromisoformat(_required(values, "end")),
            )
        )
    return [
        CanonicalCalendar(
            id=calendar_id,
            name=names[calendar_id],
            shifts=tuple(shifts),
            site_id=site_ids[calendar_id],
        )
        for calendar_id, shifts in shifts_by_calendar.items()
    ]


def _work_order_from_row(
    row: dict[str, str],
    *,
    operations: list[CanonicalOperation],
) -> CanonicalWorkOrder:
    return CanonicalWorkOrder(
        id=_required(row, "id"),
        name=row.get("name") or _required(row, "id"),
        product_id=row.get("product_id") or row.get("item_id") or _required(row, "id"),
        quantity=int(_required(row, "quantity")),
        due_date=_parse_datetime(_required(row, "due_date")),
        release_date=_parse_datetime(_required(row, "release_date")),
        operations=tuple(sorted(operations, key=lambda op: op.sequence)),
        priority=row.get("priority") or "normal",
        status=row.get("status") or "released",
        external_ref=row.get("external_ref") or None,
        site_id=row.get("site_id") or None,
        item_id=row.get("item_id") or row.get("product_id") or None,
        quantity_uom=row.get("quantity_uom") or "ea",
        requested_date=_parse_optional_datetime(row.get("requested_date")),
        promised_date=_parse_optional_datetime(row.get("promised_date")),
        erp_status=row.get("erp_status") or None,
        order_type=row.get("order_type") or "production",
    )


def _machine_from_row(row: dict[str, str]) -> CanonicalMachine:
    return CanonicalMachine(
        id=_required(row, "id"),
        name=row.get("name") or _required(row, "id"),
        calendar_id=_required(row, "calendar_id"),
        capabilities=tuple(_split_list(row.get("capabilities", ""))),
        efficiency=float(row.get("efficiency") or 1.0),
        external_ref=row.get("external_ref") or None,
        site_id=row.get("site_id") or None,
    )


def _operation_from_row(row: dict[str, str]) -> CanonicalOperation:
    return CanonicalOperation(
        id=_required(row, "id"),
        work_order_id=_required(row, "work_order_id"),
        sequence=int(_required(row, "sequence")),
        name=row.get("name") or _required(row, "id"),
        duration_minutes=int(_required(row, "duration_minutes")),
        eligible_machine_ids=tuple(_split_list(row.get("eligible_machine_ids", ""))),
        setup_minutes=int(row.get("setup_minutes") or 0),
        dependencies=tuple(_split_list(row.get("dependencies", ""))),
        status=row.get("status") or "pending",
        setup_family=row.get("setup_family") or None,
        actual_start=_parse_optional_datetime(row.get("actual_start")),
        actual_machine_id=row.get("actual_machine_id") or None,
        actual_end=_parse_optional_datetime(row.get("actual_end")),
        remaining_duration_minutes=(
            int(row["remaining_duration_minutes"])
            if row.get("remaining_duration_minutes")
            else None
        ),
        firm_until=_parse_optional_datetime(row.get("firm_until")),
        frozen_until=_parse_optional_datetime(row.get("frozen_until")),
        external_ref=row.get("external_ref") or None,
    )


def _required(row: dict[str, str], key: str) -> str:
    value = row.get(key, "").strip()
    if not value:
        raise ValueError(f"Missing required CSV field {key!r}")
    return value


def _split_list(value: str) -> list[str]:
    return [item.strip() for item in value.replace("|", ";").split(";") if item.strip()]


def _parse_datetime(value: str) -> datetime:
    return datetime.fromisoformat(value)


def _parse_optional_datetime(value: str | None) -> datetime | None:
    if value is None or not value.strip():
        return None
    return _parse_datetime(value.strip())


def _record_source_row(
    source_rows: dict[str, dict[str, dict[str, object]]],
    entity_type: str,
    entity_id: str,
    row: _CsvRow,
) -> None:
    source_rows.setdefault(entity_type, {}).setdefault(
        entity_id,
        {"source_file": row.source_file, "source_row": row.row_number},
    )
