from __future__ import annotations

from datetime import datetime

from planiadvance_v2.application.integration import export_planning_snapshot
from planiadvance_v2.application.use_cases.import_planning_snapshot import (
    ImportPlanningSnapshot,
    ImportPlanningSnapshotInput,
)
from planiadvance_v2.infrastructure.in_memory import (
    InMemoryCalendarRepository,
    InMemoryIntegrationBindingRepository,
    InMemoryMachineRepository,
    InMemoryResourceRepository,
    InMemoryWorkOrderRepository,
)
from tests.support.reference_scenarios import build_reference_workshop


def test_import_snapshot_is_idempotent_for_same_external_refs():
    workshop = build_reference_workshop()
    snapshot = export_planning_snapshot(
        calendars=workshop.calendars,
        machines=workshop.machines,
        resources=workshop.resources,
        work_orders=workshop.work_orders,
        transfer_times=workshop.transfer_times,
        source_system="erp-demo",
        exported_at=datetime(2026, 1, 5, 7, 0, 0),
    )

    calendars = InMemoryCalendarRepository()
    machines = InMemoryMachineRepository()
    resources = InMemoryResourceRepository()
    work_orders = InMemoryWorkOrderRepository()
    bindings = InMemoryIntegrationBindingRepository()

    use_case = ImportPlanningSnapshot(
        calendars=calendars,
        machines=machines,
        resources=resources,
        work_orders=work_orders,
        bindings=bindings,
    )

    first = use_case.execute(ImportPlanningSnapshotInput(snapshot=snapshot))
    second = use_case.execute(ImportPlanningSnapshotInput(snapshot=snapshot))

    assert first.created["calendars"] == len(workshop.calendars)
    assert first.created["machines"] == len(workshop.machines)
    assert first.created["resources"] == len(workshop.resources)
    assert first.created["work_orders"] == len(workshop.work_orders)
    assert second.updated["calendars"] == len(workshop.calendars)
    assert second.updated["machines"] == len(workshop.machines)
    assert second.updated["resources"] == len(workshop.resources)
    assert second.updated["work_orders"] == len(workshop.work_orders)
    assert len(calendars.list_all()) == len(workshop.calendars)
    assert len(machines.list_all()) == len(workshop.machines)
    assert len(resources.list_all()) == len(workshop.resources)
    assert len(work_orders.list_all()) == len(workshop.work_orders)


def test_import_snapshot_uses_external_refs_for_binding_when_ids_change():
    workshop = build_reference_workshop()
    snapshot = export_planning_snapshot(
        calendars=workshop.calendars,
        machines=workshop.machines,
        resources=workshop.resources,
        work_orders=workshop.work_orders,
        transfer_times=workshop.transfer_times,
        source_system="erp-demo",
    )

    remapped_snapshot = snapshot.__class__(
        contract_version=snapshot.contract_version,
        exported_at=snapshot.exported_at,
        source_system=snapshot.source_system,
        calendars=tuple(
            calendar.__class__(
                id=f"SRC-{calendar.id}",
                name=calendar.name,
                shifts=calendar.shifts,
                external_ref=calendar.id,
            )
            for calendar in snapshot.calendars
        ),
        machines=tuple(
            machine.__class__(
                id=f"SRC-{machine.id}",
                name=machine.name,
                calendar_id=f"SRC-{machine.calendar_id}",
                capabilities=machine.capabilities,
                efficiency=machine.efficiency,
                setup_matrix=machine.setup_matrix,
                maintenance_windows=machine.maintenance_windows,
                external_ref=machine.id,
            )
            for machine in snapshot.machines
        ),
        resources=tuple(
            resource.__class__(
                id=f"SRC-{resource.id}",
                name=resource.name,
                capacity=resource.capacity,
                calendar_id=(f"SRC-{resource.calendar_id}" if resource.calendar_id else None),
                tags=resource.tags,
                external_ref=resource.id,
            )
            for resource in snapshot.resources
        ),
        work_orders=tuple(
            work_order.__class__(
                id=f"SRC-{work_order.id}",
                name=work_order.name,
                product_id=work_order.product_id,
                quantity=work_order.quantity,
                due_date=work_order.due_date,
                release_date=work_order.release_date,
                operations=tuple(
                    operation.__class__(
                        id=f"SRC-{operation.id}",
                        work_order_id=f"SRC-{work_order.id}",
                        sequence=operation.sequence,
                        name=operation.name,
                        duration_minutes=operation.duration_minutes,
                        eligible_machine_ids=tuple(
                            f"SRC-{machine_id}" for machine_id in operation.eligible_machine_ids
                        ),
                        setup_minutes=operation.setup_minutes,
                        dependencies=tuple(f"SRC-{dependency}" for dependency in operation.dependencies),
                        status=operation.status,
                        setup_family=operation.setup_family,
                        resource_requirements=tuple(
                            req.__class__(
                                resource_id=f"SRC-{req.resource_id}",
                                units=req.units,
                            )
                            for req in operation.resource_requirements
                        ),
                        routings=tuple(
                            routing.__class__(
                                machine_id=f"SRC-{routing.machine_id}",
                                duration_minutes=routing.duration_minutes,
                                setup_minutes=routing.setup_minutes,
                                resource_requirements=tuple(
                                    req.__class__(
                                        resource_id=f"SRC-{req.resource_id}",
                                        units=req.units,
                                    )
                                    for req in routing.resource_requirements
                                ),
                            )
                            for routing in operation.routings
                        ),
                        preemptible=operation.preemptible,
                        min_chunk_minutes=operation.min_chunk_minutes,
                        external_ref=operation.id,
                    )
                    for operation in work_order.operations
                ),
                priority=work_order.priority,
                status=work_order.status,
                lot_sizing=work_order.lot_sizing,
                external_ref=work_order.id,
            )
            for work_order in snapshot.work_orders
        ),
        transfer_times=snapshot.transfer_times.__class__(
            default_minutes=snapshot.transfer_times.default_minutes,
            pairs={
                (f"SRC-{src}", f"SRC-{dst}"): minutes
                for (src, dst), minutes in snapshot.transfer_times.pairs.items()
            },
        ),
        metadata=snapshot.metadata,
    )

    calendars = InMemoryCalendarRepository()
    machines = InMemoryMachineRepository()
    resources = InMemoryResourceRepository()
    work_orders = InMemoryWorkOrderRepository()
    bindings = InMemoryIntegrationBindingRepository()

    use_case = ImportPlanningSnapshot(
        calendars=calendars,
        machines=machines,
        resources=resources,
        work_orders=work_orders,
        bindings=bindings,
    )

    use_case.execute(ImportPlanningSnapshotInput(snapshot=snapshot))
    result = use_case.execute(ImportPlanningSnapshotInput(snapshot=remapped_snapshot))

    assert result.updated["work_orders"] == len(workshop.work_orders)
    assert len(calendars.list_all()) == len(workshop.calendars)
    assert len(machines.list_all()) == len(workshop.machines)
    assert len(resources.list_all()) == len(workshop.resources)
    assert len(work_orders.list_all()) == len(workshop.work_orders)
