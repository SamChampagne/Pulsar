"""JSON codec for canonical planning snapshots.

The dataclass contract uses tuples and tuple-key dictionaries because those
are convenient in Python. Persisted run audit data needs a stable JSON shape
instead, so this module owns the conversion and hashing logic in one place.
"""

from __future__ import annotations

import json
from dataclasses import is_dataclass
from datetime import datetime, time
from hashlib import sha256
from typing import Any

from .canonical_snapshot import (
    CanonicalCalendar,
    CanonicalDependencyLink,
    CanonicalInventoryItem,
    CanonicalLotSizing,
    CanonicalMachine,
    CanonicalMaterialRequirement,
    CanonicalOperation,
    CanonicalPlanningSnapshot,
    CanonicalResource,
    CanonicalResourceRequirement,
    CanonicalRoutingAlternative,
    CanonicalSetupMatrix,
    CanonicalShift,
    CanonicalSupplyLot,
    CanonicalTimeWindow,
    CanonicalTransferTimes,
    CanonicalWorkOrder,
)


def planning_snapshot_to_json(snapshot: CanonicalPlanningSnapshot) -> dict[str, Any]:
    """Return a JSON-safe representation with deterministic ordering."""

    return {
        "contract_version": snapshot.contract_version,
        "exported_at": snapshot.exported_at.isoformat(),
        "source_system": snapshot.source_system,
        "calendars": [_calendar_to_json(c) for c in snapshot.calendars],
        "machines": [_machine_to_json(m) for m in snapshot.machines],
        "resources": [_resource_to_json(r) for r in snapshot.resources],
        "work_orders": [_work_order_to_json(w) for w in snapshot.work_orders],
        "inventory_items": [_inventory_to_json(i) for i in snapshot.inventory_items],
        "supplies": [_supply_to_json(s) for s in snapshot.supplies],
        "transfer_times": _transfer_times_to_json(snapshot.transfer_times),
        "metadata": _json_safe(snapshot.metadata),
    }


def planning_snapshot_from_json(data: dict[str, Any]) -> CanonicalPlanningSnapshot:
    """Rebuild a canonical planning snapshot from persisted audit JSON."""

    return CanonicalPlanningSnapshot(
        contract_version=str(data["contract_version"]),
        exported_at=_datetime(data["exported_at"]),
        source_system=str(data["source_system"]),
        calendars=tuple(_calendar_from_json(c) for c in data.get("calendars", [])),
        machines=tuple(_machine_from_json(m) for m in data.get("machines", [])),
        resources=tuple(_resource_from_json(r) for r in data.get("resources", [])),
        work_orders=tuple(_work_order_from_json(w) for w in data.get("work_orders", [])),
        inventory_items=tuple(
            _inventory_from_json(i) for i in data.get("inventory_items", [])
        ),
        supplies=tuple(_supply_from_json(s) for s in data.get("supplies", [])),
        transfer_times=_transfer_times_from_json(data.get("transfer_times", {})),
        metadata=dict(data.get("metadata") or {}),
    )


def planning_snapshot_hash(snapshot: CanonicalPlanningSnapshot | dict[str, Any]) -> str:
    """SHA-256 hash of the canonical JSON representation."""

    payload = (
        planning_snapshot_to_json(snapshot)
        if isinstance(snapshot, CanonicalPlanningSnapshot)
        else snapshot
    )
    encoded = json.dumps(
        payload,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=True,
    ).encode("utf-8")
    return sha256(encoded).hexdigest()


def _calendar_to_json(calendar: CanonicalCalendar) -> dict[str, Any]:
    return {
        "id": calendar.id,
        "name": calendar.name,
        "shifts": [_shift_to_json(s) for s in calendar.shifts],
        "extra_windows": [_time_window_to_json(w) for w in calendar.extra_windows],
        **({"resolved_windows": [_time_window_to_json(w) for w in calendar.resolved_windows]}
           if calendar.resolved_windows is not None else {}),
        "external_ref": calendar.external_ref,
        "site_id": calendar.site_id,
    }


def _calendar_from_json(data: dict[str, Any]) -> CanonicalCalendar:
    return CanonicalCalendar(
        id=str(data["id"]),
        name=str(data["name"]),
        shifts=tuple(_shift_from_json(s) for s in data.get("shifts", [])),
        extra_windows=tuple(
            _time_window_from_json(w) for w in data.get("extra_windows", [])
        ),
        external_ref=data.get("external_ref"),
        site_id=data.get("site_id"),
        resolved_windows=(
            tuple(_time_window_from_json(w) for w in data["resolved_windows"])
            if data.get("resolved_windows") is not None else None
        ),
    )


def _shift_to_json(shift: CanonicalShift) -> dict[str, Any]:
    return {
        "weekday": shift.weekday,
        "start": shift.start.isoformat(timespec="minutes"),
        "end": shift.end.isoformat(timespec="minutes"),
    }


def _shift_from_json(data: dict[str, Any]) -> CanonicalShift:
    return CanonicalShift(
        weekday=int(data["weekday"]),
        start=time.fromisoformat(str(data["start"])),
        end=time.fromisoformat(str(data["end"])),
    )


def _machine_to_json(machine: CanonicalMachine) -> dict[str, Any]:
    return {
        "id": machine.id,
        "name": machine.name,
        "calendar_id": machine.calendar_id,
        "capabilities": list(machine.capabilities),
        "efficiency": machine.efficiency,
        "setup_matrix": (
            _setup_matrix_to_json(machine.setup_matrix)
            if machine.setup_matrix is not None
            else None
        ),
        "maintenance_windows": [
            _time_window_to_json(w) for w in machine.maintenance_windows
        ],
        "external_ref": machine.external_ref,
        "site_id": machine.site_id,
    }


def _machine_from_json(data: dict[str, Any]) -> CanonicalMachine:
    setup_matrix = data.get("setup_matrix")
    return CanonicalMachine(
        id=str(data["id"]),
        name=str(data["name"]),
        calendar_id=str(data["calendar_id"]),
        capabilities=tuple(data.get("capabilities", [])),
        efficiency=float(data.get("efficiency", 1.0)),
        setup_matrix=(
            _setup_matrix_from_json(setup_matrix)
            if isinstance(setup_matrix, dict)
            else None
        ),
        maintenance_windows=tuple(
            _time_window_from_json(w) for w in data.get("maintenance_windows", [])
        ),
        external_ref=data.get("external_ref"),
        site_id=data.get("site_id"),
    )


def _resource_to_json(resource: CanonicalResource) -> dict[str, Any]:
    return {
        "id": resource.id,
        "name": resource.name,
        "capacity": resource.capacity,
        "calendar_id": resource.calendar_id,
        "tags": list(resource.tags),
        "external_ref": resource.external_ref,
        "site_id": resource.site_id,
    }


def _resource_from_json(data: dict[str, Any]) -> CanonicalResource:
    return CanonicalResource(
        id=str(data["id"]),
        name=str(data["name"]),
        capacity=int(data["capacity"]),
        calendar_id=data.get("calendar_id"),
        tags=tuple(data.get("tags", [])),
        external_ref=data.get("external_ref"),
        site_id=data.get("site_id"),
    )


def _operation_to_json(operation: CanonicalOperation) -> dict[str, Any]:
    return {
        "id": operation.id,
        "work_order_id": operation.work_order_id,
        "sequence": operation.sequence,
        "name": operation.name,
        "duration_minutes": operation.duration_minutes,
        "eligible_machine_ids": list(operation.eligible_machine_ids),
        "setup_minutes": operation.setup_minutes,
        "dependencies": list(operation.dependencies),
        "dependency_links": [
            _dependency_link_to_json(link) for link in operation.dependency_links
        ],
        "status": operation.status,
        "setup_family": operation.setup_family,
        "resource_requirements": [
            _resource_requirement_to_json(req)
            for req in operation.resource_requirements
        ],
        "material_requirements": [
            _material_requirement_to_json(req)
            for req in operation.material_requirements
        ],
        "routings": [_routing_to_json(r) for r in operation.routings],
        "preemptible": operation.preemptible,
        "min_chunk_minutes": operation.min_chunk_minutes,
        "actual_start": (
            operation.actual_start.isoformat()
            if operation.actual_start is not None
            else None
        ),
        "actual_machine_id": operation.actual_machine_id,
        "actual_end": (
            operation.actual_end.isoformat()
            if operation.actual_end is not None
            else None
        ),
        "remaining_duration_minutes": operation.remaining_duration_minutes,
        "firm_until": (
            operation.firm_until.isoformat()
            if operation.firm_until is not None
            else None
        ),
        "frozen_until": (
            operation.frozen_until.isoformat()
            if operation.frozen_until is not None
            else None
        ),
        "external_ref": operation.external_ref,
    }


def _operation_from_json(data: dict[str, Any]) -> CanonicalOperation:
    return CanonicalOperation(
        id=str(data["id"]),
        work_order_id=str(data["work_order_id"]),
        sequence=int(data["sequence"]),
        name=str(data["name"]),
        duration_minutes=int(data["duration_minutes"]),
        eligible_machine_ids=tuple(data.get("eligible_machine_ids", [])),
        setup_minutes=int(data.get("setup_minutes", 0)),
        dependencies=tuple(data.get("dependencies", [])),
        dependency_links=tuple(
            _dependency_link_from_json(link)
            for link in data.get("dependency_links", [])
        ),
        status=str(data.get("status", "pending")),
        setup_family=data.get("setup_family"),
        resource_requirements=tuple(
            _resource_requirement_from_json(req)
            for req in data.get("resource_requirements", [])
        ),
        material_requirements=tuple(
            _material_requirement_from_json(req)
            for req in data.get("material_requirements", [])
        ),
        routings=tuple(_routing_from_json(r) for r in data.get("routings", [])),
        preemptible=bool(data.get("preemptible", False)),
        min_chunk_minutes=int(data.get("min_chunk_minutes", 0)),
        actual_start=_optional_datetime(data.get("actual_start")),
        actual_machine_id=data.get("actual_machine_id"),
        actual_end=_optional_datetime(data.get("actual_end")),
        remaining_duration_minutes=(
            int(data["remaining_duration_minutes"])
            if data.get("remaining_duration_minutes") is not None
            else None
        ),
        firm_until=_optional_datetime(data.get("firm_until")),
        frozen_until=_optional_datetime(data.get("frozen_until")),
        external_ref=data.get("external_ref"),
    )


def _work_order_to_json(work_order: CanonicalWorkOrder) -> dict[str, Any]:
    return {
        "id": work_order.id,
        "name": work_order.name,
        "product_id": work_order.product_id,
        "quantity": work_order.quantity,
        "due_date": work_order.due_date.isoformat(),
        "release_date": work_order.release_date.isoformat(),
        "operations": [_operation_to_json(op) for op in work_order.operations],
        "priority": work_order.priority,
        "status": work_order.status,
        # V1.2 Cas 2 — firm / forecast / tentative. Threaded through
        # the JSON codec so a Studio flow (odoo_pull -> transform ->
        # import_aps) preserves the firmness tagged by the Odoo
        # mapper across block boundaries.
        "firmness": work_order.firmness,
        "lot_sizing": _lot_sizing_to_json(work_order.lot_sizing),
        "external_ref": work_order.external_ref,
        "site_id": work_order.site_id,
        "item_id": work_order.item_id,
        "quantity_uom": work_order.quantity_uom,
        "requested_date": (
            work_order.requested_date.isoformat()
            if work_order.requested_date is not None
            else None
        ),
        "promised_date": (
            work_order.promised_date.isoformat()
            if work_order.promised_date is not None
            else None
        ),
        "erp_status": work_order.erp_status,
        "order_type": work_order.order_type,
    }


def _work_order_from_json(data: dict[str, Any]) -> CanonicalWorkOrder:
    return CanonicalWorkOrder(
        id=str(data["id"]),
        name=str(data["name"]),
        product_id=str(data["product_id"]),
        quantity=int(data["quantity"]),
        due_date=_datetime(data["due_date"]),
        release_date=_datetime(data["release_date"]),
        operations=tuple(_operation_from_json(op) for op in data.get("operations", [])),
        priority=str(data.get("priority", "normal")),
        status=str(data.get("status", "released")),
        # V1.2 Cas 2 — unknown / missing field decodes as "firm" so
        # legacy snapshots persisted before this field existed don't
        # silently demote their WOs to forecast on re-import.
        firmness=str(data.get("firmness", "firm")),
        lot_sizing=_lot_sizing_from_json(data.get("lot_sizing", {})),
        external_ref=data.get("external_ref"),
        site_id=data.get("site_id"),
        item_id=data.get("item_id"),
        quantity_uom=str(data.get("quantity_uom", "ea")),
        requested_date=(
            _datetime(data["requested_date"])
            if data.get("requested_date") is not None
            else None
        ),
        promised_date=(
            _datetime(data["promised_date"])
            if data.get("promised_date") is not None
            else None
        ),
        erp_status=data.get("erp_status"),
        order_type=str(data.get("order_type", "production")),
    )


def _inventory_to_json(item: CanonicalInventoryItem) -> dict[str, Any]:
    return {
        "material_id": item.material_id,
        "quantity_on_hand": item.quantity_on_hand,
        "as_of": item.as_of.isoformat() if item.as_of is not None else None,
    }


def _inventory_from_json(data: dict[str, Any]) -> CanonicalInventoryItem:
    return CanonicalInventoryItem(
        material_id=str(data["material_id"]),
        quantity_on_hand=float(data["quantity_on_hand"]),
        as_of=_datetime(data["as_of"]) if data.get("as_of") is not None else None,
    )


def _supply_to_json(supply: CanonicalSupplyLot) -> dict[str, Any]:
    return {
        "id": supply.id,
        "material_id": supply.material_id,
        "quantity": supply.quantity,
        "available_at": supply.available_at.isoformat(),
        "source_type": supply.source_type,
    }


def _supply_from_json(data: dict[str, Any]) -> CanonicalSupplyLot:
    return CanonicalSupplyLot(
        id=str(data["id"]),
        material_id=str(data["material_id"]),
        quantity=float(data["quantity"]),
        available_at=_datetime(data["available_at"]),
        source_type=str(data.get("source_type", "supply")),
    )


def _setup_matrix_to_json(matrix: CanonicalSetupMatrix) -> dict[str, Any]:
    return {
        "default_minutes": matrix.default_minutes,
        "initial_minutes": matrix.initial_minutes,
        "transitions": [
            {"from": src, "to": dst, "minutes": minutes}
            for (src, dst), minutes in sorted(matrix.transitions.items())
        ],
    }


def _setup_matrix_from_json(data: dict[str, Any]) -> CanonicalSetupMatrix:
    return CanonicalSetupMatrix(
        default_minutes=int(data.get("default_minutes", 0)),
        initial_minutes=int(data.get("initial_minutes", 0)),
        transitions={
            (str(row["from"]), str(row["to"])): int(row["minutes"])
            for row in data.get("transitions", [])
        },
    )


def _dependency_link_to_json(link: CanonicalDependencyLink) -> dict[str, Any]:
    return {
        "depends_on_id": link.depends_on_id,
        "dependency_type": link.dependency_type,
        "lag_minutes": link.lag_minutes,
        "max_wait_minutes": link.max_wait_minutes,
    }


def _dependency_link_from_json(data: dict[str, Any]) -> CanonicalDependencyLink:
    return CanonicalDependencyLink(
        depends_on_id=str(data["depends_on_id"]),
        dependency_type=str(data.get("dependency_type", "finish_to_start")),
        lag_minutes=int(data.get("lag_minutes", 0)),
        max_wait_minutes=(
            int(data["max_wait_minutes"])
            if data.get("max_wait_minutes") is not None
            else None
        ),
    )


def _resource_requirement_to_json(req: CanonicalResourceRequirement) -> dict[str, Any]:
    return {"resource_id": req.resource_id, "units": req.units}


def _resource_requirement_from_json(data: dict[str, Any]) -> CanonicalResourceRequirement:
    return CanonicalResourceRequirement(
        resource_id=str(data["resource_id"]),
        units=int(data.get("units", 1)),
    )


def _material_requirement_to_json(req: CanonicalMaterialRequirement) -> dict[str, Any]:
    return {
        "material_id": req.material_id,
        "quantity_per_unit": req.quantity_per_unit,
        "fixed_quantity": req.fixed_quantity,
    }


def _material_requirement_from_json(data: dict[str, Any]) -> CanonicalMaterialRequirement:
    return CanonicalMaterialRequirement(
        material_id=str(data["material_id"]),
        quantity_per_unit=float(data.get("quantity_per_unit", 0.0)),
        fixed_quantity=float(data.get("fixed_quantity", 0.0)),
    )


def _routing_to_json(routing: CanonicalRoutingAlternative) -> dict[str, Any]:
    return {
        "machine_id": routing.machine_id,
        "duration_minutes": routing.duration_minutes,
        "setup_minutes": routing.setup_minutes,
        "resource_requirements": [
            _resource_requirement_to_json(req)
            for req in routing.resource_requirements
        ],
    }


def _routing_from_json(data: dict[str, Any]) -> CanonicalRoutingAlternative:
    return CanonicalRoutingAlternative(
        machine_id=str(data["machine_id"]),
        duration_minutes=int(data["duration_minutes"]),
        setup_minutes=int(data.get("setup_minutes", 0)),
        resource_requirements=tuple(
            _resource_requirement_from_json(req)
            for req in data.get("resource_requirements", [])
        ),
    )


def _lot_sizing_to_json(policy: CanonicalLotSizing) -> dict[str, Any]:
    return {
        "mode": policy.mode,
        "lot_size": policy.lot_size,
        "min_lot_size": policy.min_lot_size,
        "max_lot_size": policy.max_lot_size,
    }


def _lot_sizing_from_json(data: dict[str, Any]) -> CanonicalLotSizing:
    return CanonicalLotSizing(
        mode=str(data.get("mode", "none")),
        lot_size=int(data.get("lot_size", 0)),
        min_lot_size=int(data.get("min_lot_size", 0)),
        max_lot_size=int(data.get("max_lot_size", 0)),
    )


def _time_window_to_json(window: CanonicalTimeWindow) -> dict[str, Any]:
    return {"start": window.start.isoformat(), "end": window.end.isoformat()}


def _time_window_from_json(data: dict[str, Any]) -> CanonicalTimeWindow:
    return CanonicalTimeWindow(start=_datetime(data["start"]), end=_datetime(data["end"]))


def _transfer_times_to_json(transfer_times: CanonicalTransferTimes) -> dict[str, Any]:
    return {
        "default_minutes": transfer_times.default_minutes,
        "pairs": [
            {"from": src, "to": dst, "minutes": minutes}
            for (src, dst), minutes in sorted(transfer_times.pairs.items())
        ],
    }


def _transfer_times_from_json(data: dict[str, Any]) -> CanonicalTransferTimes:
    return CanonicalTransferTimes(
        default_minutes=int(data.get("default_minutes", 0)),
        pairs={
            (
                str(row.get("from", row.get("from_machine"))),
                str(row.get("to", row.get("to_machine"))),
            ): int(row["minutes"])
            for row in data.get("pairs", [])
        },
    )


def _datetime(value: Any) -> datetime:
    if isinstance(value, datetime):
        return value
    return datetime.fromisoformat(str(value))


def _optional_datetime(value: Any) -> datetime | None:
    if value is None:
        return None
    return _datetime(value)


def _json_safe(value: Any) -> Any:
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, time):
        return value.isoformat(timespec="minutes")
    if is_dataclass(value):
        return str(value)
    if isinstance(value, dict):
        return {str(k): _json_safe(v) for k, v in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [_json_safe(v) for v in value]
    return value
