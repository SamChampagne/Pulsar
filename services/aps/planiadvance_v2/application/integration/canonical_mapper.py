"""Mappers between the domain model and the canonical APS snapshot."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime

from ...domain.entities import (
    DependencyLink,
    InventoryItem,
    Machine,
    MaterialRequirement,
    Operation,
    Resource,
    Schedule,
    SupplyLot,
    WorkingCalendar,
    WorkOrder,
)
from ...domain.entities.operation import DependencyType, RoutingAlternative
from ...domain.entities.resource import ResourceRequirement
from ...domain.errors import UnknownResourceError, ValidationError
from ...domain.scheduling import SchedulingContext
from ...domain.value_objects import (
    Duration,
    LotSizingMode,
    LotSizingPolicy,
    OperationStatus,
    Priority,
    SetupMatrix,
    Shift,
    TimeWindow,
    TransferTimes,
    WorkOrderFirmness,
    WorkOrderStatus,
)
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

CONTRACT_VERSION = "aps.canonical.v1"


@dataclass(frozen=True, slots=True)
class SnapshotValidationIssue:
    kind: str
    severity: str
    message: str
    entity_type: str | None = None
    entity_id: str | None = None
    field: str | None = None
    reference: str | None = None
    source_file: str | None = None
    source_row: int | None = None

    def as_dict(self) -> dict[str, object]:
        return {
            "kind": self.kind,
            "severity": self.severity,
            "message": self.message,
            "entity_type": self.entity_type,
            "entity_id": self.entity_id,
            "field": self.field,
            "reference": self.reference,
            "source_file": self.source_file,
            "source_row": self.source_row,
        }


@dataclass(frozen=True, slots=True)
class SnapshotValidationReport:
    valid: bool
    readiness_status: str
    error_count: int
    warning_count: int
    issues: tuple[SnapshotValidationIssue, ...] = field(default_factory=tuple)

    def as_dict(self) -> dict[str, object]:
        return {
            "valid": self.valid,
            "readiness_status": self.readiness_status,
            "error_count": self.error_count,
            "warning_count": self.warning_count,
            "issues": [issue.as_dict() for issue in self.issues],
        }


def export_planning_snapshot(
    *,
    calendars: list[WorkingCalendar],
    machines: list[Machine],
    resources: list[Resource],
    work_orders: list[WorkOrder],
    inventory_items: list[InventoryItem] | None = None,
    supplies: list[SupplyLot] | None = None,
    transfer_times: TransferTimes = TransferTimes(),
    source_system: str = "internal",
    exported_at: datetime | None = None,
    metadata: dict[str, object] | None = None,
) -> CanonicalPlanningSnapshot:
    site_id = _metadata_text(metadata, "site_id") or _metadata_text(metadata, "plant")
    return CanonicalPlanningSnapshot(
        contract_version=CONTRACT_VERSION,
        exported_at=exported_at or datetime.utcnow(),
        source_system=source_system,
        calendars=tuple(_export_calendar(c, site_id=site_id) for c in calendars),
        machines=tuple(_export_machine(m, site_id=site_id) for m in machines),
        resources=tuple(_export_resource(r, site_id=site_id) for r in resources),
        work_orders=tuple(_export_work_order(wo, site_id=site_id) for wo in work_orders),
        inventory_items=tuple(
            CanonicalInventoryItem(
                material_id=item.material_id,
                quantity_on_hand=item.quantity_on_hand,
                as_of=item.as_of,
            )
            for item in (inventory_items or [])
        ),
        supplies=tuple(
            CanonicalSupplyLot(
                id=lot.id,
                material_id=lot.material_id,
                quantity=lot.quantity,
                available_at=lot.available_at,
                source_type=lot.source_type,
            )
            for lot in (supplies or [])
        ),
        transfer_times=CanonicalTransferTimes(
            default_minutes=transfer_times.default_minutes,
            pairs=dict(transfer_times.pairs),
        ),
        metadata=dict(metadata or {}),
    )


def snapshot_to_context(
    snapshot: CanonicalPlanningSnapshot,
    *,
    horizon_start: datetime,
    horizon_end: datetime,
    run_id: str = "",
) -> SchedulingContext:
    (
        calendars,
        machines,
        resources,
        work_orders,
        inventory_items,
        supplies,
        transfer_times,
    ) = snapshot_to_domain_inputs(
        snapshot
    )
    return SchedulingContext(
        horizon_start=horizon_start,
        horizon_end=horizon_end,
        calendars=calendars,
        machines=machines,
        resources=resources,
        work_orders=work_orders,
        inventory_items=inventory_items,
        supplies=supplies,
        transfer_times=transfer_times,
        run_id=run_id,
    )


def validate_snapshot(snapshot: CanonicalPlanningSnapshot) -> None:
    report = validate_snapshot_report(snapshot)
    first_error = next(
        (issue for issue in report.issues if issue.severity == "error"),
        None,
    )
    if first_error is None:
        return
    if first_error.kind.startswith("unknown_"):
        raise UnknownResourceError(first_error.message)
    raise ValidationError(first_error.message)


def validate_snapshot_report(snapshot: CanonicalPlanningSnapshot) -> SnapshotValidationReport:
    issues: list[SnapshotValidationIssue] = []
    if snapshot.contract_version != CONTRACT_VERSION:
        _add_issue(
            issues,
            kind="unsupported_contract",
            message=f"Unsupported planning snapshot contract {snapshot.contract_version!r}",
            entity_type="snapshot",
            field="contract_version",
            reference=CONTRACT_VERSION,
        )

    calendar_ids = [c.id for c in snapshot.calendars]
    machine_ids = [m.id for m in snapshot.machines]
    resource_ids = [r.id for r in snapshot.resources]
    work_order_ids = [wo.id for wo in snapshot.work_orders]

    _collect_duplicate_issues(issues, "calendar", calendar_ids)
    _collect_duplicate_issues(issues, "machine", machine_ids)
    _collect_duplicate_issues(issues, "resource", resource_ids)
    _collect_duplicate_issues(issues, "work_order", work_order_ids)

    machine_id_set = set(machine_ids)
    calendar_id_set = set(calendar_ids)
    resource_id_set = set(resource_ids)
    inventory_materials = {item.material_id for item in snapshot.inventory_items}
    supply_materials = {supply.material_id for supply in snapshot.supplies}

    operation_ids: set[str] = set()
    seen_supply_ids: set[str] = set()
    for machine in snapshot.machines:
        if machine.calendar_id not in calendar_id_set:
            _add_issue(
                issues,
                kind="unknown_calendar",
                message=f"Machine {machine.id} references unknown calendar {machine.calendar_id}",
                entity_type="machine",
                entity_id=machine.id,
                field="calendar_id",
                reference=machine.calendar_id,
            )
    for resource in snapshot.resources:
        if resource.calendar_id is not None and resource.calendar_id not in calendar_id_set:
            _add_issue(
                issues,
                kind="unknown_calendar",
                message=f"Resource {resource.id} references unknown calendar {resource.calendar_id}",
                entity_type="resource",
                entity_id=resource.id,
                field="calendar_id",
                reference=resource.calendar_id,
            )

    for work_order in snapshot.work_orders:
        if work_order.quantity <= 0:
            _add_issue(
                issues,
                kind="invalid_quantity",
                message=f"Work order {work_order.id}: quantity must be > 0",
                entity_type="work_order",
                entity_id=work_order.id,
                field="quantity",
            )
        if not work_order.quantity_uom.strip():
            _add_issue(
                issues,
                kind="missing_quantity_uom",
                message=f"Work order {work_order.id}: quantity_uom is required",
                entity_type="work_order",
                entity_id=work_order.id,
                field="quantity_uom",
            )
        if work_order.item_id is None:
            _add_issue(
                issues,
                kind="missing_item_identity",
                severity="warning",
                message=(
                    f"Work order {work_order.id}: item_id is missing; "
                    "product_id will be used as the planning item identity"
                ),
                entity_type="work_order",
                entity_id=work_order.id,
                field="item_id",
                reference=work_order.product_id,
            )
        if (
            work_order.requested_date is not None
            and work_order.promised_date is not None
            and work_order.promised_date < work_order.requested_date
        ):
            _add_issue(
                issues,
                kind="promise_before_request",
                severity="warning",
                message=(
                    f"Work order {work_order.id}: promised_date is before requested_date"
                ),
                entity_type="work_order",
                entity_id=work_order.id,
                field="promised_date",
            )
        if work_order.due_date < work_order.release_date:
            _add_issue(
                issues,
                kind="invalid_date_order",
                message=f"Work order {work_order.id}: due_date must be >= release_date",
                entity_type="work_order",
                entity_id=work_order.id,
                field="due_date",
            )
        if not work_order.operations:
            _add_issue(
                issues,
                kind="missing_operations",
                message=f"Work order {work_order.id}: at least one operation is required",
                entity_type="work_order",
                entity_id=work_order.id,
                field="operations",
            )

        op_ids = [op.id for op in work_order.operations]
        _collect_duplicate_issues(
            issues,
            f"operation in work order {work_order.id}",
            op_ids,
            entity_type="operation",
        )
        operation_ids.update(op_ids)

        for op in work_order.operations:
            if op.work_order_id != work_order.id:
                _add_issue(
                    issues,
                    kind="work_order_mismatch",
                    message=(
                        f"Operation {op.id} belongs to work order {op.work_order_id}, "
                        f"not {work_order.id}"
                    ),
                    entity_type="operation",
                    entity_id=op.id,
                    field="work_order_id",
                    reference=work_order.id,
                )
            if not op.eligible_machine_ids:
                _add_issue(
                    issues,
                    kind="missing_machine_candidate",
                    message=f"Operation {op.id}: at least one eligible machine is required",
                    entity_type="operation",
                    entity_id=op.id,
                    field="eligible_machine_ids",
                    )
            if op.actual_end is not None and op.actual_start is None:
                _add_issue(
                    issues,
                    kind="invalid_execution_state",
                    message=f"Operation {op.id}: actual_end requires actual_start",
                    entity_type="operation",
                    entity_id=op.id,
                    field="actual_end",
                )
            if op.actual_machine_id is not None:
                if op.actual_machine_id not in machine_id_set:
                    _add_issue(
                        issues,
                        kind="unknown_machine",
                        message=(
                            f"Operation {op.id}: actual_machine_id references "
                            f"unknown machine {op.actual_machine_id}"
                        ),
                        entity_type="operation",
                        entity_id=op.id,
                        field="actual_machine_id",
                        reference=op.actual_machine_id,
                    )
                if op.actual_machine_id not in op.eligible_machine_ids:
                    _add_issue(
                        issues,
                        kind="ineligible_actual_machine",
                        message=(
                            f"Operation {op.id}: actual_machine_id "
                            f"{op.actual_machine_id} is not eligible"
                        ),
                        entity_type="operation",
                        entity_id=op.id,
                        field="actual_machine_id",
                        reference=op.actual_machine_id,
                    )
                if op.actual_start is None:
                    _add_issue(
                        issues,
                        kind="invalid_execution_state",
                        message=(
                            f"Operation {op.id}: actual_machine_id requires "
                            "actual_start"
                        ),
                        entity_type="operation",
                        entity_id=op.id,
                        field="actual_machine_id",
                    )
            if (
                op.actual_start is not None
                and op.actual_end is not None
                and op.actual_end < op.actual_start
            ):
                _add_issue(
                    issues,
                    kind="invalid_execution_state",
                    message=f"Operation {op.id}: actual_end cannot be before actual_start",
                    entity_type="operation",
                    entity_id=op.id,
                    field="actual_end",
                )
            if (
                op.remaining_duration_minutes is not None
                and op.remaining_duration_minutes > op.duration_minutes
            ):
                _add_issue(
                    issues,
                    kind="invalid_execution_state",
                    message=(
                        f"Operation {op.id}: remaining_duration_minutes cannot "
                        "exceed duration_minutes"
                    ),
                    entity_type="operation",
                    entity_id=op.id,
                    field="remaining_duration_minutes",
                )
            if (
                op.frozen_until is not None
                and op.firm_until is not None
                and op.frozen_until > op.firm_until
            ):
                _add_issue(
                    issues,
                    kind="invalid_planning_fence",
                    message=f"Operation {op.id}: frozen_until cannot be after firm_until",
                    entity_type="operation",
                    entity_id=op.id,
                    field="frozen_until",
                )
            for mid in op.eligible_machine_ids:
                if mid not in machine_id_set:
                    _add_issue(
                        issues,
                        kind="unknown_machine",
                        message=f"Operation {op.id} references unknown machine {mid}",
                        entity_type="operation",
                        entity_id=op.id,
                        field="eligible_machine_ids",
                        reference=mid,
                    )
            for req in op.resource_requirements:
                if req.resource_id not in resource_id_set:
                    _add_issue(
                        issues,
                        kind="unknown_resource",
                        message=f"Operation {op.id} references unknown resource {req.resource_id}",
                        entity_type="operation",
                        entity_id=op.id,
                        field="resource_requirements",
                        reference=req.resource_id,
                    )
            for req in op.material_requirements:
                if req.quantity_per_unit < 0 or req.fixed_quantity < 0:
                    _add_issue(
                        issues,
                        kind="invalid_material_quantity",
                        message=(
                            f"Operation {op.id} material requirement {req.material_id} "
                            "has negative quantity"
                        ),
                        entity_type="operation",
                        entity_id=op.id,
                        field="material_requirements",
                        reference=req.material_id,
                    )
                if (
                    req.material_id not in inventory_materials
                    and req.material_id not in supply_materials
                ):
                    _add_issue(
                        issues,
                        kind="material_without_supply",
                        severity="warning",
                        message=(
                            f"Operation {op.id} requires material {req.material_id}, "
                            "but no inventory or supply lot is present in the snapshot"
                        ),
                        entity_type="operation",
                        entity_id=op.id,
                        field="material_requirements",
                        reference=req.material_id,
                    )
            for alt in op.routings:
                if alt.machine_id not in machine_id_set:
                    _add_issue(
                        issues,
                        kind="unknown_machine",
                        message=(
                            f"Operation {op.id} routing references unknown machine "
                            f"{alt.machine_id}"
                        ),
                        entity_type="operation",
                        entity_id=op.id,
                        field="routings",
                        reference=alt.machine_id,
                    )
                if alt.machine_id not in op.eligible_machine_ids:
                    _add_issue(
                        issues,
                        kind="ineligible_routing_machine",
                        message=(
                            f"Operation {op.id} routing targets {alt.machine_id} "
                            "but it is not eligible"
                        ),
                        entity_type="operation",
                        entity_id=op.id,
                        field="routings",
                        reference=alt.machine_id,
                    )
                for req in alt.resource_requirements:
                    if req.resource_id not in resource_id_set:
                        _add_issue(
                            issues,
                            kind="unknown_resource",
                            message=(
                                f"Operation {op.id} routing references unknown resource "
                                f"{req.resource_id}"
                            ),
                            entity_type="operation",
                            entity_id=op.id,
                            field="routings.resource_requirements",
                            reference=req.resource_id,
                        )

    for work_order in snapshot.work_orders:
        for op in work_order.operations:
            for dep in op.dependencies:
                if dep not in operation_ids:
                    _add_issue(
                        issues,
                        kind="unknown_dependency",
                        message=f"Operation {op.id} depends on unknown operation {dep}",
                        entity_type="operation",
                        entity_id=op.id,
                        field="dependencies",
                        reference=dep,
                    )
            for link in op.dependency_links:
                if link.depends_on_id not in operation_ids:
                    _add_issue(
                        issues,
                        kind="unknown_dependency",
                        message=(
                            f"Operation {op.id} depends on unknown operation "
                            f"{link.depends_on_id}"
                        ),
                        entity_type="operation",
                        entity_id=op.id,
                        field="dependency_links",
                        reference=link.depends_on_id,
                    )

    for src, dst in snapshot.transfer_times.pairs:
        if src not in machine_id_set:
            _add_issue(
                issues,
                kind="unknown_machine",
                message=f"TransferTimes references unknown source machine {src!r}",
                entity_type="transfer_times",
                field="pairs",
                reference=src,
            )
        if dst not in machine_id_set:
            _add_issue(
                issues,
                kind="unknown_machine",
                message=f"TransferTimes references unknown target machine {dst!r}",
                entity_type="transfer_times",
                field="pairs",
                reference=dst,
            )
    for item in snapshot.inventory_items:
        if item.quantity_on_hand < 0:
            _add_issue(
                issues,
                kind="invalid_inventory_quantity",
                message=f"Inventory item {item.material_id}: quantity_on_hand must be >= 0",
                entity_type="inventory_item",
                entity_id=item.material_id,
                field="quantity_on_hand",
            )
    for supply in snapshot.supplies:
        if supply.id in seen_supply_ids:
            _add_issue(
                issues,
                kind="duplicate_supply",
                message=f"Duplicate supply id {supply.id} in canonical planning snapshot",
                entity_type="supply",
                entity_id=supply.id,
                field="id",
            )
        seen_supply_ids.add(supply.id)
        if supply.quantity <= 0:
            _add_issue(
                issues,
                kind="invalid_supply_quantity",
                message=f"Supply lot {supply.id}: quantity must be > 0",
                entity_type="supply",
                entity_id=supply.id,
                field="quantity",
            )

    enriched_issues = _with_source_locations(issues, snapshot.metadata)
    error_count = sum(1 for issue in enriched_issues if issue.severity == "error")
    warning_count = sum(1 for issue in enriched_issues if issue.severity == "warning")
    readiness_status = "blocked" if error_count else "degraded" if warning_count else "ready"
    return SnapshotValidationReport(
        valid=error_count == 0,
        readiness_status=readiness_status,
        error_count=error_count,
        warning_count=warning_count,
        issues=tuple(enriched_issues),
    )


def snapshot_to_domain_inputs(
    snapshot: CanonicalPlanningSnapshot,
) -> tuple[
    list[WorkingCalendar],
    list[Machine],
    list[Resource],
    list[WorkOrder],
    list[InventoryItem],
    list[SupplyLot],
    TransferTimes,
]:
    validate_snapshot(snapshot)
    return (
        [_import_calendar(c) for c in snapshot.calendars],
        [_import_machine(m) for m in snapshot.machines],
        [_import_resource(r) for r in snapshot.resources],
        [_import_work_order(wo) for wo in snapshot.work_orders],
        [_import_inventory_item(item) for item in snapshot.inventory_items],
        [_import_supply_lot(supply) for supply in snapshot.supplies],
        TransferTimes(
            default_minutes=snapshot.transfer_times.default_minutes,
            pairs=dict(snapshot.transfer_times.pairs),
        ),
    )


def export_schedule_snapshot(
    *,
    schedule: Schedule,
    strategy: str,
    solver_status: str,
    objective_value: int | None,
    wall_time_ms: int,
    metrics: dict[str, object],
) -> dict[str, object]:
    return {
        "contract_version": CONTRACT_VERSION,
        "schedule_id": schedule.id,
        "created_at": schedule.created_at.isoformat(),
        "strategy": strategy,
        "solver_status": solver_status,
        "objective_value": objective_value,
        "wall_time_ms": wall_time_ms,
        "metrics": dict(metrics),
        "assignments": [
            {
                "operation_id": a.operation_id,
                "work_order_id": a.work_order_id,
                "machine_id": a.machine_id,
                "setup_start": a.setup_start.isoformat(),
                "start": a.start.isoformat(),
                "end": a.end.isoformat(),
                "segments": [
                    {"start": seg.start.isoformat(), "end": seg.end.isoformat()}
                    for seg in a.segments
                ],
            }
            for a in schedule.assignments
        ],
    }


def _assert_unique(label: str, ids: list[str]) -> None:
    if len(ids) != len(set(ids)):
        raise ValidationError(f"Duplicate {label} ids in canonical planning snapshot")


def _collect_duplicate_issues(
    issues: list[SnapshotValidationIssue],
    label: str,
    ids: list[str],
    *,
    entity_type: str | None = None,
) -> None:
    seen: set[str] = set()
    duplicates: set[str] = set()
    for item_id in ids:
        if item_id in seen:
            duplicates.add(item_id)
        seen.add(item_id)
    for item_id in sorted(duplicates):
        _add_issue(
            issues,
            kind="duplicate_id",
            message=f"Duplicate {label} id {item_id} in canonical planning snapshot",
            entity_type=entity_type or label,
            entity_id=item_id,
            field="id",
        )


def _add_issue(
    issues: list[SnapshotValidationIssue],
    *,
    kind: str,
    message: str,
    severity: str = "error",
    entity_type: str | None = None,
    entity_id: str | None = None,
    field: str | None = None,
    reference: str | None = None,
) -> None:
    issues.append(
        SnapshotValidationIssue(
            kind=kind,
            severity=severity,
            message=message,
            entity_type=entity_type,
            entity_id=entity_id,
            field=field,
            reference=reference,
        )
    )


def _with_source_locations(
    issues: list[SnapshotValidationIssue],
    metadata: dict[str, object],
) -> list[SnapshotValidationIssue]:
    source_rows = metadata.get("source_rows")
    if not isinstance(source_rows, dict):
        return issues
    return [_with_source_location(issue, source_rows) for issue in issues]


def _with_source_location(
    issue: SnapshotValidationIssue,
    source_rows: dict[object, object],
) -> SnapshotValidationIssue:
    if issue.source_file is not None or issue.source_row is not None:
        return issue
    if issue.entity_type is None or issue.entity_id is None:
        return issue
    entity_rows = source_rows.get(issue.entity_type)
    if not isinstance(entity_rows, dict):
        return issue
    location = entity_rows.get(issue.entity_id)
    if not isinstance(location, dict):
        return issue
    source_file = location.get("source_file")
    source_row = location.get("source_row")
    if not isinstance(source_file, str) or not isinstance(source_row, int):
        return issue
    return SnapshotValidationIssue(
        kind=issue.kind,
        severity=issue.severity,
        message=issue.message,
        entity_type=issue.entity_type,
        entity_id=issue.entity_id,
        field=issue.field,
        reference=issue.reference,
        source_file=source_file,
        source_row=source_row,
    )


def _metadata_text(metadata: dict[str, object] | None, key: str) -> str | None:
    if metadata is None or key not in metadata:
        return None
    value = metadata[key]
    return str(value) if value is not None else None


def _export_calendar(
    calendar: WorkingCalendar,
    *,
    site_id: str | None = None,
) -> CanonicalCalendar:
    return CanonicalCalendar(
        id=calendar.id,
        name=calendar.name,
        shifts=tuple(
            CanonicalShift(weekday=s.weekday, start=s.start, end=s.end)
            for s in calendar.shifts
        ),
        extra_windows=tuple(
            CanonicalTimeWindow(start=w.start, end=w.end)
            for w in calendar.extra_windows
        ),
        site_id=site_id,
        resolved_windows=(
            tuple(CanonicalTimeWindow(start=w.start, end=w.end) for w in calendar.resolved_windows)
            if calendar.resolved_windows is not None else None
        ),
    )


def _import_calendar(calendar: CanonicalCalendar) -> WorkingCalendar:
    return WorkingCalendar(
        id=calendar.id,
        name=calendar.name,
        shifts=[
            Shift(weekday=s.weekday, start=s.start, end=s.end)
            for s in calendar.shifts
        ],
        extra_windows=[
            TimeWindow(start=w.start, end=w.end)
            for w in calendar.extra_windows
        ],
        resolved_windows=(
            [TimeWindow(start=w.start, end=w.end) for w in calendar.resolved_windows]
            if calendar.resolved_windows is not None else None
        ),
    )


def _export_machine(
    machine: Machine,
    *,
    site_id: str | None = None,
) -> CanonicalMachine:
    setup_matrix = None
    if machine.setup_matrix is not None:
        setup_matrix = CanonicalSetupMatrix(
            default_minutes=machine.setup_matrix.default_minutes,
            initial_minutes=machine.setup_matrix.initial_minutes,
            transitions=dict(machine.setup_matrix.transitions),
        )
    return CanonicalMachine(
        id=machine.id,
        name=machine.name,
        calendar_id=machine.calendar_id,
        capabilities=tuple(machine.capabilities),
        efficiency=machine.efficiency,
        setup_matrix=setup_matrix,
        maintenance_windows=tuple(
            CanonicalTimeWindow(start=w.start, end=w.end)
            for w in machine.maintenance_windows
        ),
        site_id=site_id,
    )


def _import_machine(machine: CanonicalMachine) -> Machine:
    setup_matrix = None
    if machine.setup_matrix is not None:
        setup_matrix = SetupMatrix(
            machine_id=machine.id,
            default_minutes=machine.setup_matrix.default_minutes,
            initial_minutes=machine.setup_matrix.initial_minutes,
            transitions=dict(machine.setup_matrix.transitions),
        )
    return Machine(
        id=machine.id,
        name=machine.name,
        calendar_id=machine.calendar_id,
        capabilities=list(machine.capabilities),
        efficiency=machine.efficiency,
        setup_matrix=setup_matrix,
        maintenance_windows=[
            TimeWindow(start=w.start, end=w.end)
            for w in machine.maintenance_windows
        ],
    )


def _export_resource(
    resource: Resource,
    *,
    site_id: str | None = None,
) -> CanonicalResource:
    return CanonicalResource(
        id=resource.id,
        name=resource.name,
        capacity=resource.capacity,
        calendar_id=resource.calendar_id,
        tags=tuple(resource.tags),
        site_id=site_id,
    )


def _import_resource(resource: CanonicalResource) -> Resource:
    return Resource(
        id=resource.id,
        name=resource.name,
        capacity=resource.capacity,
        calendar_id=resource.calendar_id,
        tags=list(resource.tags),
    )


def _export_work_order(
    work_order: WorkOrder,
    *,
    site_id: str | None = None,
) -> CanonicalWorkOrder:
    return CanonicalWorkOrder(
        id=work_order.id,
        name=work_order.name,
        product_id=work_order.product_id,
        quantity=work_order.quantity,
        due_date=work_order.due_date,
        release_date=work_order.release_date,
        operations=tuple(_export_operation(op) for op in work_order.operations),
        priority=work_order.priority.name.lower(),
        status=work_order.status.value,
        firmness=work_order.firmness.value,
        lot_sizing=_export_lot_sizing(work_order.lot_sizing),
        site_id=site_id,
        item_id=work_order.product_id,
        requested_date=work_order.due_date,
        erp_status=work_order.status.value,
    )


def _import_work_order(work_order: CanonicalWorkOrder) -> WorkOrder:
    return WorkOrder(
        id=work_order.id,
        name=work_order.name,
        product_id=work_order.product_id,
        quantity=work_order.quantity,
        due_date=work_order.due_date,
        release_date=work_order.release_date,
        operations=[_import_operation(op) for op in work_order.operations],
        priority=Priority[work_order.priority.upper()],
        status=WorkOrderStatus(work_order.status),
        # V1.2 Cas 2 — unknown / empty firmness defaults to FIRM
        # (legacy snapshots from before the field existed).
        firmness=WorkOrderFirmness(work_order.firmness or "firm"),
        lot_sizing=_import_lot_sizing(work_order.lot_sizing),
    )


def _export_operation(operation: Operation) -> CanonicalOperation:
    return CanonicalOperation(
        id=operation.id,
        work_order_id=operation.work_order_id,
        sequence=operation.sequence,
        name=operation.name,
        duration_minutes=operation.duration.minutes,
        eligible_machine_ids=tuple(operation.eligible_machine_ids),
        setup_minutes=operation.setup_time.minutes,
        dependencies=tuple(operation.dependencies),
        dependency_links=tuple(
            CanonicalDependencyLink(
                depends_on_id=link.depends_on_id,
                dependency_type=link.dependency_type.value,
                lag_minutes=link.lag_minutes,
                max_wait_minutes=link.max_wait_minutes,
            )
            for link in operation.dependency_links
        ),
        status=operation.status.value,
        setup_family=operation.setup_family,
        resource_requirements=tuple(
            CanonicalResourceRequirement(resource_id=req.resource_id, units=req.units)
            for req in operation.resource_requirements
        ),
        material_requirements=tuple(
            CanonicalMaterialRequirement(
                material_id=req.material_id,
                quantity_per_unit=req.quantity_per_unit,
                fixed_quantity=req.fixed_quantity,
            )
            for req in operation.material_requirements
        ),
        routings=tuple(_export_routing(alt) for alt in operation.routings),
        preemptible=operation.preemptible,
        min_chunk_minutes=operation.min_chunk.minutes,
        actual_start=operation.actual_start,
        actual_machine_id=operation.actual_machine_id,
        actual_end=operation.actual_end,
        remaining_duration_minutes=(
            operation.remaining_duration.minutes
            if operation.remaining_duration is not None
            else None
        ),
        firm_until=operation.firm_until,
        frozen_until=operation.frozen_until,
    )


def _import_operation(operation: CanonicalOperation) -> Operation:
    return Operation(
        id=operation.id,
        work_order_id=operation.work_order_id,
        sequence=operation.sequence,
        name=operation.name,
        duration=Duration(minutes=operation.duration_minutes),
        eligible_machine_ids=list(operation.eligible_machine_ids),
        setup_time=Duration(minutes=operation.setup_minutes),
        dependencies=list(operation.dependencies),
        dependency_links=[
            DependencyLink(
                depends_on_id=link.depends_on_id,
                dependency_type=DependencyType(link.dependency_type),
                lag_minutes=link.lag_minutes,
                max_wait_minutes=link.max_wait_minutes,
            )
            for link in operation.dependency_links
        ],
        status=OperationStatus(operation.status),
        setup_family=operation.setup_family,
        resource_requirements=[
            ResourceRequirement(resource_id=req.resource_id, units=req.units)
            for req in operation.resource_requirements
        ],
        material_requirements=[
            MaterialRequirement(
                material_id=req.material_id,
                quantity_per_unit=req.quantity_per_unit,
                fixed_quantity=req.fixed_quantity,
            )
            for req in operation.material_requirements
        ],
        routings=[_import_routing(alt) for alt in operation.routings],
        preemptible=operation.preemptible,
        min_chunk=Duration(minutes=operation.min_chunk_minutes),
        actual_start=operation.actual_start,
        actual_machine_id=operation.actual_machine_id,
        actual_end=operation.actual_end,
        remaining_duration=(
            Duration(minutes=operation.remaining_duration_minutes)
            if operation.remaining_duration_minutes is not None
            else None
        ),
        firm_until=operation.firm_until,
        frozen_until=operation.frozen_until,
    )


def _export_routing(routing: RoutingAlternative) -> CanonicalRoutingAlternative:
    return CanonicalRoutingAlternative(
        machine_id=routing.machine_id,
        duration_minutes=routing.duration.minutes,
        setup_minutes=routing.setup_time.minutes,
        resource_requirements=tuple(
            CanonicalResourceRequirement(resource_id=req.resource_id, units=req.units)
            for req in routing.resource_requirements
        ),
    )


def _import_routing(routing: CanonicalRoutingAlternative) -> RoutingAlternative:
    return RoutingAlternative(
        machine_id=routing.machine_id,
        duration=Duration(minutes=routing.duration_minutes),
        setup_time=Duration(minutes=routing.setup_minutes),
        resource_requirements=tuple(
            ResourceRequirement(resource_id=req.resource_id, units=req.units)
            for req in routing.resource_requirements
        ),
    )


def _import_inventory_item(item: CanonicalInventoryItem) -> InventoryItem:
    return InventoryItem(
        material_id=item.material_id,
        quantity_on_hand=item.quantity_on_hand,
        as_of=item.as_of,
    )


def _import_supply_lot(supply: CanonicalSupplyLot) -> SupplyLot:
    return SupplyLot(
        id=supply.id,
        material_id=supply.material_id,
        quantity=supply.quantity,
        available_at=supply.available_at,
        source_type=supply.source_type,
    )


def _export_lot_sizing(policy: LotSizingPolicy) -> CanonicalLotSizing:
    return CanonicalLotSizing(
        mode=policy.mode.name.lower(),
        lot_size=policy.lot_size,
        min_lot_size=policy.min_lot_size,
        max_lot_size=policy.max_lot_size,
    )


def _import_lot_sizing(policy: CanonicalLotSizing) -> LotSizingPolicy:
    mode = LotSizingMode[policy.mode.upper()]
    if mode == LotSizingMode.NONE:
        return LotSizingPolicy.none()
    if mode == LotSizingMode.FIXED:
        return LotSizingPolicy.fixed(policy.lot_size)
    return LotSizingPolicy.min_max(policy.min_lot_size, policy.max_lot_size)
