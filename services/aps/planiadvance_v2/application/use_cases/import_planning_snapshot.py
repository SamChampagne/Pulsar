"""Use case: import a canonical planning snapshot into persisted workshop data."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from ...application.integration import validate_snapshot
from ...application.integration.canonical_mapper import snapshot_to_domain_inputs
from ...application.integration.canonical_snapshot import (
    CanonicalCalendar,
    CanonicalDependencyLink,
    CanonicalMachine,
    CanonicalOperation,
    CanonicalPlanningSnapshot,
    CanonicalResource,
    CanonicalRoutingAlternative,
    CanonicalTransferTimes,
    CanonicalWorkOrder,
)
from ...domain.entities import InventoryItem, SupplyLot
from ..ports import (
    CalendarRepository,
    IntegrationBinding,
    IntegrationBindingRepository,
    InventoryRepository,
    MachineRepository,
    ResourceRepository,
    SupplyRepository,
    WorkOrderRepository,
)


@dataclass(slots=True)
class ImportPlanningSnapshotInput:
    snapshot: CanonicalPlanningSnapshot
    organization_id: str | None = None
    workspace_id: str | None = None


@dataclass(slots=True)
class ImportPlanningSnapshotOutput:
    source_system: str
    created: dict[str, int]
    updated: dict[str, int]
    binding_count: int
    imported_at: datetime


class ImportPlanningSnapshot:
    def __init__(
        self,
        *,
        calendars: CalendarRepository,
        machines: MachineRepository,
        resources: ResourceRepository,
        work_orders: WorkOrderRepository,
        inventory: InventoryRepository | None = None,
        supplies: SupplyRepository | None = None,
        bindings: IntegrationBindingRepository,
    ) -> None:
        self._calendars = calendars
        self._machines = machines
        self._resources = resources
        self._work_orders = work_orders
        self._inventory = inventory
        self._supplies = supplies
        self._bindings = bindings

    def execute(
        self, command: ImportPlanningSnapshotInput
    ) -> ImportPlanningSnapshotOutput:
        snapshot = command.snapshot
        validate_snapshot(snapshot)

        created = {
            "calendars": 0,
            "machines": 0,
            "resources": 0,
            "work_orders": 0,
            "inventory_items": 0,
            "supplies": 0,
        }
        updated = {
            "calendars": 0,
            "machines": 0,
            "resources": 0,
            "work_orders": 0,
            "inventory_items": 0,
            "supplies": 0,
        }
        binding_count = 0

        calendar_id_map: dict[str, str] = {}
        for calendar in snapshot.calendars:
            internal_id, was_created, binding_saved = self._resolve_internal_id(
                entity_type="calendar",
                source_system=snapshot.source_system,
                external_ref=calendar.external_ref or calendar.id,
                canonical_id=calendar.id,
                exists=lambda candidate: self._calendars.get(candidate) is not None,
            )
            binding_count += 1 if binding_saved else 0
            if was_created:
                created["calendars"] += 1
            else:
                updated["calendars"] += 1
            calendar_id_map[calendar.id] = internal_id

        machine_id_map: dict[str, str] = {}
        for machine in snapshot.machines:
            internal_id, was_created, binding_saved = self._resolve_internal_id(
                entity_type="machine",
                source_system=snapshot.source_system,
                external_ref=machine.external_ref or machine.id,
                canonical_id=machine.id,
                exists=lambda candidate: self._machines.get(candidate) is not None,
            )
            binding_count += 1 if binding_saved else 0
            if was_created:
                created["machines"] += 1
            else:
                updated["machines"] += 1
            machine_id_map[machine.id] = internal_id

        resource_id_map: dict[str, str] = {}
        for resource in snapshot.resources:
            internal_id, was_created, binding_saved = self._resolve_internal_id(
                entity_type="resource",
                source_system=snapshot.source_system,
                external_ref=resource.external_ref or resource.id,
                canonical_id=resource.id,
                exists=lambda candidate: self._resources.get(candidate) is not None,
            )
            binding_count += 1 if binding_saved else 0
            if was_created:
                created["resources"] += 1
            else:
                updated["resources"] += 1
            resource_id_map[resource.id] = internal_id

        work_order_id_map: dict[str, str] = {}
        operation_id_map: dict[str, str] = {}
        for work_order in snapshot.work_orders:
            internal_id, was_created, binding_saved = self._resolve_internal_id(
                entity_type="work_order",
                source_system=snapshot.source_system,
                external_ref=work_order.external_ref or work_order.id,
                canonical_id=work_order.id,
                exists=lambda candidate: self._work_orders.get(candidate) is not None,
            )
            binding_count += 1 if binding_saved else 0
            if was_created:
                created["work_orders"] += 1
            else:
                updated["work_orders"] += 1
            work_order_id_map[work_order.id] = internal_id

            for operation in work_order.operations:
                op_internal_id, _, op_binding_saved = self._resolve_internal_id(
                    entity_type="operation",
                    source_system=snapshot.source_system,
                    external_ref=operation.external_ref or operation.id,
                    canonical_id=operation.id,
                    exists=lambda _candidate: False,
                )
                binding_count += 1 if op_binding_saved else 0
                operation_id_map[operation.id] = op_internal_id

        mapped_snapshot = CanonicalPlanningSnapshot(
            contract_version=snapshot.contract_version,
            exported_at=snapshot.exported_at,
            source_system=snapshot.source_system,
            calendars=tuple(
                CanonicalCalendar(
                    id=calendar_id_map[calendar.id],
                    name=calendar.name,
                    shifts=calendar.shifts,
                    external_ref=calendar.external_ref,
                    site_id=calendar.site_id,
                )
                for calendar in snapshot.calendars
            ),
            machines=tuple(
                CanonicalMachine(
                    id=machine_id_map[machine.id],
                    name=machine.name,
                    calendar_id=calendar_id_map[machine.calendar_id],
                    capabilities=machine.capabilities,
                    efficiency=machine.efficiency,
                    setup_matrix=machine.setup_matrix,
                    maintenance_windows=machine.maintenance_windows,
                    external_ref=machine.external_ref,
                    site_id=machine.site_id,
                )
                for machine in snapshot.machines
            ),
            resources=tuple(
                CanonicalResource(
                    id=resource_id_map[resource.id],
                    name=resource.name,
                    capacity=resource.capacity,
                    calendar_id=(
                        calendar_id_map[resource.calendar_id]
                        if resource.calendar_id is not None
                        else None
                    ),
                    tags=resource.tags,
                    external_ref=resource.external_ref,
                    site_id=resource.site_id,
                )
                for resource in snapshot.resources
            ),
            work_orders=tuple(
                self._map_work_order(
                    work_order,
                    work_order_id_map=work_order_id_map,
                    operation_id_map=operation_id_map,
                    machine_id_map=machine_id_map,
                    resource_id_map=resource_id_map,
                )
                for work_order in snapshot.work_orders
            ),
            transfer_times=CanonicalTransferTimes(
                default_minutes=snapshot.transfer_times.default_minutes,
                pairs={
                    (machine_id_map[src], machine_id_map[dst]): minutes
                    for (src, dst), minutes in snapshot.transfer_times.pairs.items()
                },
            ),
            inventory_items=snapshot.inventory_items,
            supplies=snapshot.supplies,
            metadata=dict(snapshot.metadata),
        )

        calendars, machines, resources, work_orders, _, _, _ = snapshot_to_domain_inputs(
            mapped_snapshot
        )
        if command.organization_id is not None:
            for calendar in calendars:
                calendar.organization_id = command.organization_id
            for machine in machines:
                machine.organization_id = command.organization_id
            for resource in resources:
                resource.organization_id = command.organization_id
            for work_order in work_orders:
                work_order.organization_id = command.organization_id
        if command.workspace_id is not None:
            for calendar in calendars:
                calendar.workspace_id = command.workspace_id
            for machine in machines:
                machine.workspace_id = command.workspace_id
            for resource in resources:
                resource.workspace_id = command.workspace_id
            for work_order in work_orders:
                work_order.workspace_id = command.workspace_id

        for calendar in calendars:
            self._calendars.add(calendar)
        for machine in machines:
            self._machines.add(machine)
        for resource in resources:
            self._resources.add(resource)
        for work_order in work_orders:
            self._work_orders.add(work_order)
        if self._inventory is not None:
            for item in mapped_snapshot.inventory_items:
                existing = self._inventory.get(item.material_id)
                if existing is None:
                    created["inventory_items"] += 1
                else:
                    updated["inventory_items"] += 1
                self._inventory.add(
                    InventoryItem(
                        material_id=item.material_id,
                        quantity_on_hand=item.quantity_on_hand,
                        as_of=item.as_of,
                        organization_id=command.organization_id,
                        workspace_id=command.workspace_id,
                    )
                )
        if self._supplies is not None:
            for lot in mapped_snapshot.supplies:
                existing = self._supplies.get(lot.id)
                if existing is None:
                    created["supplies"] += 1
                else:
                    updated["supplies"] += 1
                self._supplies.add(
                    SupplyLot(
                        id=lot.id,
                        material_id=lot.material_id,
                        quantity=lot.quantity,
                        available_at=lot.available_at,
                        source_type=lot.source_type,
                        organization_id=command.organization_id,
                        workspace_id=command.workspace_id,
                    )
                )

        return ImportPlanningSnapshotOutput(
            source_system=snapshot.source_system,
            created=created,
            updated=updated,
            binding_count=binding_count,
            imported_at=datetime.utcnow(),
        )

    def _map_work_order(
        self,
        work_order: CanonicalWorkOrder,
        *,
        work_order_id_map: dict[str, str],
        operation_id_map: dict[str, str],
        machine_id_map: dict[str, str],
        resource_id_map: dict[str, str],
    ) -> CanonicalWorkOrder:
        return CanonicalWorkOrder(
            id=work_order_id_map[work_order.id],
            name=work_order.name,
            product_id=work_order.product_id,
            quantity=work_order.quantity,
            due_date=work_order.due_date,
            release_date=work_order.release_date,
            operations=tuple(
                self._map_operation(
                    operation,
                    work_order_id_map=work_order_id_map,
                    operation_id_map=operation_id_map,
                    machine_id_map=machine_id_map,
                    resource_id_map=resource_id_map,
                )
                for operation in work_order.operations
            ),
            priority=work_order.priority,
            status=work_order.status,
            lot_sizing=work_order.lot_sizing,
            external_ref=work_order.external_ref,
            site_id=work_order.site_id,
            item_id=work_order.item_id,
            quantity_uom=work_order.quantity_uom,
            requested_date=work_order.requested_date,
            promised_date=work_order.promised_date,
            erp_status=work_order.erp_status,
            order_type=work_order.order_type,
        )

    def _map_operation(
        self,
        operation: CanonicalOperation,
        *,
        work_order_id_map: dict[str, str],
        operation_id_map: dict[str, str],
        machine_id_map: dict[str, str],
        resource_id_map: dict[str, str],
    ) -> CanonicalOperation:
        return CanonicalOperation(
            id=operation_id_map[operation.id],
            work_order_id=work_order_id_map[operation.work_order_id],
            sequence=operation.sequence,
            name=operation.name,
            duration_minutes=operation.duration_minutes,
            eligible_machine_ids=tuple(
                machine_id_map[machine_id] for machine_id in operation.eligible_machine_ids
            ),
            setup_minutes=operation.setup_minutes,
            dependencies=tuple(
                operation_id_map[dependency] for dependency in operation.dependencies
            ),
            dependency_links=tuple(
                CanonicalDependencyLink(
                    depends_on_id=operation_id_map[link.depends_on_id],
                    dependency_type=link.dependency_type,
                    lag_minutes=link.lag_minutes,
                    max_wait_minutes=link.max_wait_minutes,
                )
                for link in operation.dependency_links
            ),
            status=operation.status,
            setup_family=operation.setup_family,
            resource_requirements=tuple(
                req.__class__(
                    resource_id=resource_id_map[req.resource_id],
                    units=req.units,
                )
                for req in operation.resource_requirements
            ),
            material_requirements=operation.material_requirements,
            routings=tuple(
                CanonicalRoutingAlternative(
                    machine_id=machine_id_map[routing.machine_id],
                    duration_minutes=routing.duration_minutes,
                    setup_minutes=routing.setup_minutes,
                    resource_requirements=tuple(
                        req.__class__(
                            resource_id=resource_id_map[req.resource_id],
                            units=req.units,
                        )
                        for req in routing.resource_requirements
                    ),
                )
                for routing in operation.routings
            ),
            preemptible=operation.preemptible,
            min_chunk_minutes=operation.min_chunk_minutes,
            external_ref=operation.external_ref,
        )

    def _resolve_internal_id(
        self,
        *,
        entity_type: str,
        source_system: str,
        external_ref: str,
        canonical_id: str,
        exists,
    ) -> tuple[str, bool, bool]:
        binding = self._bindings.get(
            entity_type=entity_type,
            source_system=source_system,
            external_ref=external_ref,
        )
        if binding is not None:
            return binding.internal_id, False, False

        internal_id = canonical_id
        was_created = not exists(internal_id)
        # V1.2 P0.2 — save() is now first-writer-wins (see binding port).
        # If a concurrent import lost the race, the returned binding's
        # internal_id is the winner's, not ours: pick it so downstream
        # domain writes converge on the same id instead of forking.
        saved = self._bindings.save(
            IntegrationBinding(
                entity_type=entity_type,
                source_system=source_system,
                external_ref=external_ref,
                internal_id=internal_id,
            )
        )
        if saved.internal_id != internal_id:
            # Lost the race: another flow inserted first. We didn't
            # create the entity in this transaction (the winner did),
            # and the binding was already persisted before our save.
            return saved.internal_id, False, False
        return internal_id, was_created, True
