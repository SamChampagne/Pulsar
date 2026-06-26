"""Use case: export a published APS plan as an ERP-facing outbound contract."""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import datetime
from hashlib import sha256
from typing import Any

from ...application.integration.canonical_snapshot import (
    CanonicalOperation,
    CanonicalWorkOrder,
)
from ...application.integration.snapshot_codec import planning_snapshot_from_json
from ...domain.entities import Schedule, ScheduledOperation
from ...domain.errors import ValidationError
from ..ports import ScheduleRepository, ScheduleRunMetadata
from .planning_validation_gate import validate_schedule_scope


@dataclass(frozen=True, slots=True)
class ExportPublishedPlanInput:
    source_system: str = "internal"
    organization_id: str | None = None
    workspace_id: str | None = None
    schedule_id: str | None = None
    compare_to_schedule_id: str | None = None
    mode: str = "full"
    metadata: dict[str, object] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class PublishedPlanOperation:
    operation_id: str
    work_order_id: str
    name: str | None = None
    sequence: int | None = None
    status: str | None = None
    external_ref: str | None = None
    eligible_machine_ids: tuple[str, ...] = ()
    planned_machine_id: str | None = None
    planned_setup_start: datetime | None = None
    planned_start: datetime | None = None
    planned_end: datetime | None = None
    previous_machine_id: str | None = None
    previous_setup_start: datetime | None = None
    previous_start: datetime | None = None
    previous_end: datetime | None = None
    change_type: str = "unchanged"
    changed_fields: tuple[str, ...] = ()

    def as_dict(self) -> dict[str, object]:
        return {
            "operation_id": self.operation_id,
            "work_order_id": self.work_order_id,
            "name": self.name,
            "sequence": self.sequence,
            "status": self.status,
            "external_ref": self.external_ref,
            "eligible_machine_ids": list(self.eligible_machine_ids),
            "planned_machine_id": self.planned_machine_id,
            "planned_setup_start": _iso(self.planned_setup_start),
            "planned_start": _iso(self.planned_start),
            "planned_end": _iso(self.planned_end),
            "previous_machine_id": self.previous_machine_id,
            "previous_setup_start": _iso(self.previous_setup_start),
            "previous_start": _iso(self.previous_start),
            "previous_end": _iso(self.previous_end),
            "change_type": self.change_type,
            "changed_fields": list(self.changed_fields),
        }


@dataclass(frozen=True, slots=True)
class PublishedPlanWorkOrder:
    work_order_id: str
    name: str | None = None
    external_ref: str | None = None
    product_id: str | None = None
    quantity: int | None = None
    quantity_uom: str | None = None
    status: str | None = None
    order_type: str | None = None
    site_id: str | None = None
    item_id: str | None = None
    release_date: datetime | None = None
    due_date: datetime | None = None
    requested_date: datetime | None = None
    promised_date: datetime | None = None
    erp_status: str | None = None
    change_type: str = "unchanged"
    changed_fields: tuple[str, ...] = ()
    operations: tuple[PublishedPlanOperation, ...] = ()

    def as_dict(self) -> dict[str, object]:
        scheduled_count = sum(
            1 for operation in self.operations if operation.planned_start is not None
        )
        return {
            "work_order_id": self.work_order_id,
            "name": self.name,
            "external_ref": self.external_ref,
            "product_id": self.product_id,
            "quantity": self.quantity,
            "quantity_uom": self.quantity_uom,
            "status": self.status,
            "order_type": self.order_type,
            "site_id": self.site_id,
            "item_id": self.item_id,
            "release_date": _iso(self.release_date),
            "due_date": _iso(self.due_date),
            "requested_date": _iso(self.requested_date),
            "promised_date": _iso(self.promised_date),
            "erp_status": self.erp_status,
            "change_type": self.change_type,
            "changed_fields": list(self.changed_fields),
            "scheduled_operation_count": scheduled_count,
            "changed_operation_count": len(self.operations),
            "operations": [operation.as_dict() for operation in self.operations],
        }


@dataclass(frozen=True, slots=True)
class ExportPublishedPlanOutput:
    contract_version: str
    exported_at: datetime
    source_system: str
    mode: str
    organization_id: str | None
    workspace_id: str | None
    schedule_id: str
    scenario_name: str
    lifecycle_status: str
    compare_to_schedule_id: str | None
    input_snapshot_hash: str
    engine_version: str
    entity_counts: dict[str, int] = field(default_factory=dict)
    change_counts: dict[str, int] = field(default_factory=dict)
    work_orders: tuple[PublishedPlanWorkOrder, ...] = ()
    metadata: dict[str, object] = field(default_factory=dict)

    @property
    def export_hash(self) -> str:
        payload = self.as_dict(include_hash=False)
        encoded = json.dumps(
            payload,
            sort_keys=True,
            separators=(",", ":"),
            ensure_ascii=True,
        ).encode("utf-8")
        return sha256(encoded).hexdigest()

    def as_dict(self, *, include_hash: bool = True) -> dict[str, object]:
        payload = {
            "contract_version": self.contract_version,
            "exported_at": _iso(self.exported_at),
            "source_system": self.source_system,
            "mode": self.mode,
            "organization_id": self.organization_id,
            "workspace_id": self.workspace_id,
            "schedule_id": self.schedule_id,
            "scenario_name": self.scenario_name,
            "lifecycle_status": self.lifecycle_status,
            "compare_to_schedule_id": self.compare_to_schedule_id,
            "input_snapshot_hash": self.input_snapshot_hash,
            "engine_version": self.engine_version,
            "entity_counts": dict(self.entity_counts),
            "change_counts": dict(self.change_counts),
            "work_orders": [work_order.as_dict() for work_order in self.work_orders],
            "metadata": _json_safe(self.metadata),
        }
        if include_hash:
            payload["export_hash"] = self.export_hash
        return payload


class ExportPublishedPlan:
    """Export a published APS plan as a stable outbound ERP contract."""

    def __init__(self, schedules: ScheduleRepository) -> None:
        self._schedules = schedules

    def execute(self, command: ExportPublishedPlanInput) -> ExportPublishedPlanOutput:
        mode = command.mode.strip().lower()
        if mode not in {"full", "delta"}:
            raise ValidationError("Published plan export mode must be full or delta.")
        if not command.source_system.strip():
            raise ValidationError("Published plan export source_system is required.")

        target_schedule, target_meta = self._resolve_target_schedule(command)
        compare_schedule: Schedule | None = None
        compare_meta: ScheduleRunMetadata | None = None
        if mode == "delta":
            compare_schedule, compare_meta = self._resolve_compare_schedule(
                command=command,
                target_schedule=target_schedule,
                target_meta=target_meta,
            )

        target_refs = _SnapshotReferences.from_metadata(target_meta)
        compare_refs = _SnapshotReferences.from_metadata(compare_meta)
        if mode == "full":
            work_orders = _build_full_export(
                target_schedule=target_schedule,
                target_refs=target_refs,
                compare_refs=compare_refs,
            )
        else:
            work_orders = _build_delta_export(
                target_schedule=target_schedule,
                compare_schedule=compare_schedule,
                target_refs=target_refs,
                compare_refs=compare_refs,
            )

        entity_counts, change_counts = _summaries(work_orders)
        return ExportPublishedPlanOutput(
            contract_version="published-plan-export-v1",
            exported_at=datetime.utcnow(),
            source_system=command.source_system.strip(),
            mode=mode,
            organization_id=target_meta.organization_id,
            workspace_id=target_meta.workspace_id,
            schedule_id=target_schedule.id,
            scenario_name=target_meta.scenario_name,
            lifecycle_status=target_meta.lifecycle_status,
            compare_to_schedule_id=(
                compare_schedule.id if compare_schedule is not None else None
            ),
            input_snapshot_hash=target_meta.input_snapshot_hash,
            engine_version=target_meta.engine_version,
            entity_counts=entity_counts,
            change_counts=change_counts,
            work_orders=tuple(work_orders),
            metadata={
                "requested_metadata": dict(command.metadata),
                "schedule_created_at": target_schedule.created_at,
                "compare_schedule_created_at": (
                    compare_schedule.created_at if compare_schedule is not None else None
                ),
            },
        )

    def _resolve_target_schedule(
        self,
        command: ExportPublishedPlanInput,
    ) -> tuple[Schedule, ScheduleRunMetadata]:
        if command.schedule_id:
            schedule, metadata = self._load_published_schedule(
                command.schedule_id,
                organization_id=command.organization_id,
                label="Target",
            )
            if (
                command.workspace_id is not None
                and metadata.workspace_id != command.workspace_id
            ):
                raise ValidationError(
                    "Published plan export target schedule does not match the active workspace."
                )
            return schedule, metadata

        rows = self._schedules.list_recent(
            limit=20,
            organization_id=command.organization_id,
            workspace_id=command.workspace_id,
            lifecycle_status="published",
        )
        if not rows:
            raise ValidationError("No published schedule is available for export.")
        return rows[0]

    def _resolve_compare_schedule(
        self,
        *,
        command: ExportPublishedPlanInput,
        target_schedule: Schedule,
        target_meta: ScheduleRunMetadata,
    ) -> tuple[Schedule | None, ScheduleRunMetadata | None]:
        if command.compare_to_schedule_id:
            return self._load_published_schedule(
                command.compare_to_schedule_id,
                organization_id=command.organization_id,
                label="Compare",
            )

        rows = self._schedules.list_recent(
            limit=50,
            organization_id=target_meta.organization_id,
            workspace_id=target_meta.workspace_id,
            lifecycle_status="published",
        )
        for schedule, metadata in rows:
            if schedule.id == target_schedule.id:
                continue
            if schedule.created_at >= target_schedule.created_at:
                continue
            return schedule, metadata
        for schedule, metadata in rows:
            if schedule.id != target_schedule.id:
                return schedule, metadata
        return None, None

    def _load_published_schedule(
        self,
        schedule_id: str,
        *,
        organization_id: str | None,
        label: str,
    ) -> tuple[Schedule, ScheduleRunMetadata]:
        schedule = self._schedules.get(schedule_id)
        metadata = self._schedules.get_metadata(schedule_id)
        if schedule is None or metadata is None:
            raise ValidationError(f"{label} schedule {schedule_id!r} not found")
        validate_schedule_scope(
            metadata,
            expected_organization_id=organization_id,
            schedule_id=schedule_id,
            label=label,
        )
        if metadata.lifecycle_status != "published":
            raise ValidationError(
                f"{label} schedule {schedule_id!r} must be published before export."
            )
        return schedule, metadata


@dataclass(frozen=True, slots=True)
class _SnapshotReferences:
    work_orders: dict[str, CanonicalWorkOrder] = field(default_factory=dict)
    operations: dict[str, CanonicalOperation] = field(default_factory=dict)

    @classmethod
    def from_metadata(
        cls,
        metadata: ScheduleRunMetadata | None,
    ) -> _SnapshotReferences:
        if metadata is None or not metadata.input_snapshot:
            return cls()
        snapshot = planning_snapshot_from_json(dict(metadata.input_snapshot))
        work_orders = {work_order.id: work_order for work_order in snapshot.work_orders}
        operations = {
            operation.id: operation
            for work_order in snapshot.work_orders
            for operation in work_order.operations
        }
        return cls(work_orders=work_orders, operations=operations)


def _build_full_export(
    *,
    target_schedule: Schedule,
    target_refs: _SnapshotReferences,
    compare_refs: _SnapshotReferences,
) -> list[PublishedPlanWorkOrder]:
    assignment_map = _assignment_map(target_schedule)
    work_order_ids = list(target_refs.work_orders.keys())
    for assignment in target_schedule.assignments:
        if assignment.work_order_id not in target_refs.work_orders:
            work_order_ids.append(assignment.work_order_id)

    exported: list[PublishedPlanWorkOrder] = []
    for work_order_id in work_order_ids:
        work_order_ref = target_refs.work_orders.get(work_order_id) or compare_refs.work_orders.get(
            work_order_id
        )
        operation_refs = _ordered_operation_refs(
            work_order_id=work_order_id,
            primary=target_refs,
            secondary=compare_refs,
        )
        operations: list[PublishedPlanOperation] = []
        seen_operation_ids: set[str] = set()
        for operation_ref in operation_refs:
            seen_operation_ids.add(operation_ref.id)
            operations.append(
                _build_operation(
                    reference=operation_ref,
                    assignment=assignment_map.get(operation_ref.id),
                    previous_assignment=None,
                    change_type="unchanged",
                )
            )
        extra_assignments = sorted(
            (
                assignment
                for assignment in target_schedule.assignments
                if assignment.work_order_id == work_order_id
                and assignment.operation_id not in seen_operation_ids
            ),
            key=lambda item: item.start,
        )
        for assignment in extra_assignments:
            operations.append(
                _build_operation(
                    reference=target_refs.operations.get(assignment.operation_id)
                    or compare_refs.operations.get(assignment.operation_id),
                    assignment=assignment,
                    previous_assignment=None,
                    change_type="unchanged",
                )
            )
        exported.append(
            _build_work_order(
                work_order_id=work_order_id,
                reference=work_order_ref,
                operations=operations,
                change_type="unchanged",
            )
        )
    return exported


def _build_delta_export(
    *,
    target_schedule: Schedule,
    compare_schedule: Schedule | None,
    target_refs: _SnapshotReferences,
    compare_refs: _SnapshotReferences,
) -> list[PublishedPlanWorkOrder]:
    target_assignments = _assignment_map(target_schedule)
    compare_assignments = _assignment_map(compare_schedule)
    changed_by_work_order: dict[str, list[PublishedPlanOperation]] = {}
    all_operation_ids = sorted(set(target_assignments) | set(compare_assignments))
    for operation_id in all_operation_ids:
        current = target_assignments.get(operation_id)
        previous = compare_assignments.get(operation_id)
        change_type, changed_fields = _assignment_change(current, previous)
        if change_type is None:
            continue
        reference = target_refs.operations.get(operation_id) or compare_refs.operations.get(
            operation_id
        )
        work_order_id = (
            reference.work_order_id
            if reference is not None
            else (
                current.work_order_id
                if current is not None
                else previous.work_order_id  # type: ignore[union-attr]
            )
        )
        changed_by_work_order.setdefault(work_order_id, []).append(
            _build_operation(
                reference=reference,
                assignment=current,
                previous_assignment=previous,
                change_type=change_type,
                changed_fields=changed_fields,
            )
        )

    exported: list[PublishedPlanWorkOrder] = []
    for work_order_id, operations in changed_by_work_order.items():
        operations.sort(
            key=lambda item: (
                item.sequence if item.sequence is not None else 10_000,
                item.operation_id,
            )
        )
        target_ref = target_refs.work_orders.get(work_order_id)
        compare_ref = compare_refs.work_orders.get(work_order_id)
        if target_ref is None and compare_ref is not None:
            change_type = "removed"
        elif target_ref is not None and compare_ref is None:
            change_type = "created"
        else:
            change_type = "updated"
        exported.append(
            _build_work_order(
                work_order_id=work_order_id,
                reference=target_ref or compare_ref,
                operations=operations,
                change_type=change_type,
            )
        )
    exported.sort(key=lambda item: item.work_order_id)
    return exported


def _build_work_order(
    *,
    work_order_id: str,
    reference: CanonicalWorkOrder | None,
    operations: list[PublishedPlanOperation],
    change_type: str,
) -> PublishedPlanWorkOrder:
    return PublishedPlanWorkOrder(
        work_order_id=work_order_id,
        name=reference.name if reference is not None else None,
        external_ref=reference.external_ref if reference is not None else None,
        product_id=reference.product_id if reference is not None else None,
        quantity=reference.quantity if reference is not None else None,
        quantity_uom=reference.quantity_uom if reference is not None else None,
        status=reference.status if reference is not None else None,
        order_type=reference.order_type if reference is not None else None,
        site_id=reference.site_id if reference is not None else None,
        item_id=reference.item_id if reference is not None else None,
        release_date=reference.release_date if reference is not None else None,
        due_date=reference.due_date if reference is not None else None,
        requested_date=reference.requested_date if reference is not None else None,
        promised_date=reference.promised_date if reference is not None else None,
        erp_status=reference.erp_status if reference is not None else None,
        change_type=change_type,
        changed_fields=("operations",) if change_type != "unchanged" else (),
        operations=tuple(operations),
    )


def _build_operation(
    *,
    reference: CanonicalOperation | None,
    assignment: ScheduledOperation | None,
    previous_assignment: ScheduledOperation | None,
    change_type: str,
    changed_fields: tuple[str, ...] = (),
) -> PublishedPlanOperation:
    operation_id = (
        reference.id
        if reference is not None
        else (
            assignment.operation_id
            if assignment is not None
            else previous_assignment.operation_id  # type: ignore[union-attr]
        )
    )
    work_order_id = (
        reference.work_order_id
        if reference is not None
        else (
            assignment.work_order_id
            if assignment is not None
            else previous_assignment.work_order_id  # type: ignore[union-attr]
        )
    )
    return PublishedPlanOperation(
        operation_id=operation_id,
        work_order_id=work_order_id,
        name=reference.name if reference is not None else None,
        sequence=reference.sequence if reference is not None else None,
        status=reference.status if reference is not None else None,
        external_ref=reference.external_ref if reference is not None else None,
        eligible_machine_ids=(
            tuple(reference.eligible_machine_ids) if reference is not None else ()
        ),
        planned_machine_id=assignment.machine_id if assignment is not None else None,
        planned_setup_start=assignment.setup_start if assignment is not None else None,
        planned_start=assignment.start if assignment is not None else None,
        planned_end=assignment.end if assignment is not None else None,
        previous_machine_id=(
            previous_assignment.machine_id if previous_assignment is not None else None
        ),
        previous_setup_start=(
            previous_assignment.setup_start if previous_assignment is not None else None
        ),
        previous_start=previous_assignment.start if previous_assignment is not None else None,
        previous_end=previous_assignment.end if previous_assignment is not None else None,
        change_type=change_type,
        changed_fields=changed_fields,
    )


def _ordered_operation_refs(
    *,
    work_order_id: str,
    primary: _SnapshotReferences,
    secondary: _SnapshotReferences,
) -> list[CanonicalOperation]:
    work_order = primary.work_orders.get(work_order_id) or secondary.work_orders.get(
        work_order_id
    )
    if work_order is None:
        return []
    return sorted(work_order.operations, key=lambda operation: operation.sequence)


def _assignment_map(
    schedule: Schedule | None,
) -> dict[str, ScheduledOperation]:
    if schedule is None:
        return {}
    return {assignment.operation_id: assignment for assignment in schedule.assignments}


def _assignment_change(
    current: ScheduledOperation | None,
    previous: ScheduledOperation | None,
) -> tuple[str | None, tuple[str, ...]]:
    if current is None and previous is None:
        return None, ()
    if current is not None and previous is None:
        return "created", (
            "planned_machine_id",
            "planned_setup_start",
            "planned_start",
            "planned_end",
        )
    if current is None and previous is not None:
        return "removed", (
            "planned_machine_id",
            "planned_setup_start",
            "planned_start",
            "planned_end",
        )
    changed_fields: list[str] = []
    if current.machine_id != previous.machine_id:
        changed_fields.append("planned_machine_id")
    if current.setup_start != previous.setup_start:
        changed_fields.append("planned_setup_start")
    if current.start != previous.start:
        changed_fields.append("planned_start")
    if current.end != previous.end:
        changed_fields.append("planned_end")
    if not changed_fields:
        return None, ()
    return "updated", tuple(changed_fields)


def _summaries(
    work_orders: list[PublishedPlanWorkOrder],
) -> tuple[dict[str, int], dict[str, int]]:
    operation_rows = [operation for work_order in work_orders for operation in work_order.operations]
    entity_counts = {
        "work_orders": len(work_orders),
        "operations": len(operation_rows),
        "scheduled_operations": sum(
            1 for operation in operation_rows if operation.planned_start is not None
        ),
    }
    change_counts = {
        "created": sum(1 for operation in operation_rows if operation.change_type == "created"),
        "updated": sum(1 for operation in operation_rows if operation.change_type == "updated"),
        "removed": sum(1 for operation in operation_rows if operation.change_type == "removed"),
    }
    return entity_counts, change_counts


def _iso(value: datetime | None) -> str | None:
    return value.isoformat() if value is not None else None


def _json_safe(value: Any) -> Any:
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, dict):
        return {str(key): _json_safe(item) for key, item in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [_json_safe(item) for item in value]
    return value
