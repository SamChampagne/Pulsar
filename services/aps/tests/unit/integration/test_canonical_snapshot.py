from __future__ import annotations

from datetime import datetime

import pytest

from planiadvance_v2.application.integration import (
    CONTRACT_VERSION,
    export_schedule_snapshot,
    snapshot_to_context,
    validate_snapshot,
)
from planiadvance_v2.application.use_cases.export_planning_snapshot import (
    ExportPlanningSnapshot,
    ExportPlanningSnapshotInput,
)
from planiadvance_v2.application.use_cases.run_scheduling import (
    RunScheduling,
    RunSchedulingInput,
)
from planiadvance_v2.domain.errors import UnknownResourceError
from planiadvance_v2.domain.scheduling import Objective, resolve_strategy
from planiadvance_v2.infrastructure.in_memory.repositories import (
    InMemoryCalendarRepository,
    InMemoryMachineRepository,
    InMemoryResourceRepository,
    InMemoryWorkOrderRepository,
)
from tests.support.reference_scenarios import build_stressed_reference_workshop


class TestCanonicalPlanningSnapshot:
    def test_export_use_case_captures_advanced_aps_fields(self):
        workshop = build_stressed_reference_workshop()
        uc = ExportPlanningSnapshot(
            work_orders=InMemoryWorkOrderRepository(workshop.work_orders),
            machines=InMemoryMachineRepository(workshop.machines),
            calendars=InMemoryCalendarRepository(workshop.calendars),
            resources=InMemoryResourceRepository(workshop.resources),
        )

        snapshot = uc.execute(
            ExportPlanningSnapshotInput(
                source_system="erp-demo",
                exported_at=datetime(2026, 1, 5, 7, 0, 0),
                transfer_times=workshop.transfer_times,
                metadata={"plant": "demo"},
            )
        )

        assert snapshot.contract_version == CONTRACT_VERSION
        assert snapshot.source_system == "erp-demo"
        assert snapshot.metadata["plant"] == "demo"
        assert len(snapshot.work_orders) == 3
        assert len(snapshot.machines) == 3
        assert len(snapshot.resources) == 3
        assert all(machine.site_id == "demo" for machine in snapshot.machines)
        assert all(work_order.site_id == "demo" for work_order in snapshot.work_orders)
        assert all(work_order.item_id == work_order.product_id for work_order in snapshot.work_orders)
        assert all(work_order.quantity_uom == "ea" for work_order in snapshot.work_orders)
        assert all(
            work_order.requested_date == work_order.due_date
            for work_order in snapshot.work_orders
        )
        asm1 = next(machine for machine in snapshot.machines if machine.id == "ASM-1")
        assert asm1.setup_matrix is not None
        asm2 = next(machine for machine in snapshot.machines if machine.id == "ASM-2")
        assert len(asm2.maintenance_windows) >= 3
        green_asm = next(
            op
            for wo in snapshot.work_orders
            for op in wo.operations
            if op.id == "GREEN-ASM"
        )
        assert green_asm.preemptible is True
        assert green_asm.min_chunk_minutes == 60
        assert len(green_asm.routings) == 2
        assert snapshot.transfer_times.pairs[("CUT-1", "ASM-2")] == 40

    def test_snapshot_round_trip_builds_context_and_solves(self):
        workshop = build_stressed_reference_workshop()
        snapshot = ExportPlanningSnapshot(
            work_orders=InMemoryWorkOrderRepository(workshop.work_orders),
            machines=InMemoryMachineRepository(workshop.machines),
            calendars=InMemoryCalendarRepository(workshop.calendars),
            resources=InMemoryResourceRepository(workshop.resources),
        ).execute(
            ExportPlanningSnapshotInput(
                source_system="erp-roundtrip",
                transfer_times=workshop.transfer_times,
            )
        )

        context = snapshot_to_context(
            snapshot,
            horizon_start=workshop.horizon_start,
            horizon_end=workshop.horizon_end,
            run_id="erp-import-test",
        )
        result = resolve_strategy("greedy").solve(context, Objective.default())

        assert len(result.schedule.assignments) == 6
        green = next(a for a in result.schedule.assignments if a.operation_id == "GREEN-ASM")
        assert green.is_preempted

    def test_invalid_snapshot_fails_before_engine_run(self):
        workshop = build_stressed_reference_workshop()
        snapshot = ExportPlanningSnapshot(
            work_orders=InMemoryWorkOrderRepository(workshop.work_orders),
            machines=InMemoryMachineRepository(workshop.machines),
            calendars=InMemoryCalendarRepository(workshop.calendars),
            resources=InMemoryResourceRepository(workshop.resources),
        ).execute(
            ExportPlanningSnapshotInput(transfer_times=workshop.transfer_times)
        )

        broken_op = next(
            op
            for wo in snapshot.work_orders
            for op in wo.operations
            if op.id == "RED-ASM"
        )
        broken_op.routings[0].resource_requirements[0]  # touch to keep intent explicit
        broken_snapshot = snapshot.__class__(
            contract_version=snapshot.contract_version,
            exported_at=snapshot.exported_at,
            source_system=snapshot.source_system,
            calendars=snapshot.calendars,
            machines=snapshot.machines,
            resources=snapshot.resources,
            work_orders=tuple(
                type(wo)(
                    id=wo.id,
                    name=wo.name,
                    product_id=wo.product_id,
                    quantity=wo.quantity,
                    due_date=wo.due_date,
                    release_date=wo.release_date,
                    operations=tuple(
                        type(op)(
                            id=op.id,
                            work_order_id=op.work_order_id,
                            sequence=op.sequence,
                            name=op.name,
                            duration_minutes=op.duration_minutes,
                            eligible_machine_ids=op.eligible_machine_ids,
                            setup_minutes=op.setup_minutes,
                            dependencies=op.dependencies,
                            status=op.status,
                            setup_family=op.setup_family,
                            resource_requirements=op.resource_requirements,
                            routings=(
                                tuple(
                                    type(alt)(
                                        machine_id=alt.machine_id,
                                        duration_minutes=alt.duration_minutes,
                                        setup_minutes=alt.setup_minutes,
                                        resource_requirements=(
                                            type(alt.resource_requirements[0])(
                                                resource_id="GHOST-RESOURCE",
                                                units=1,
                                            ),
                                        )
                                        if op.id == "RED-ASM" and idx == 0
                                        else alt.resource_requirements,
                                    )
                                    for idx, alt in enumerate(op.routings)
                                )
                                if op.routings
                                else ()
                            ),
                            preemptible=op.preemptible,
                            min_chunk_minutes=op.min_chunk_minutes,
                            external_ref=op.external_ref,
                        )
                        for op in wo.operations
                    ),
                    priority=wo.priority,
                    status=wo.status,
                    lot_sizing=wo.lot_sizing,
                    external_ref=wo.external_ref,
                )
                for wo in snapshot.work_orders
            ),
            transfer_times=snapshot.transfer_times,
            metadata=snapshot.metadata,
        )

        with pytest.raises(UnknownResourceError):
            validate_snapshot(broken_snapshot)

    def test_exported_schedule_snapshot_is_erp_friendly(self):
        workshop = build_stressed_reference_workshop()
        uc = RunScheduling(
            work_orders=InMemoryWorkOrderRepository(workshop.work_orders),
            machines=InMemoryMachineRepository(workshop.machines),
            calendars=InMemoryCalendarRepository(workshop.calendars),
            resources=InMemoryResourceRepository(workshop.resources),
        )
        result = uc.execute(
            RunSchedulingInput(
                horizon_start=workshop.horizon_start,
                horizon_days=5,
                strategy="greedy",
                transfer_times=workshop.transfer_times,
                persist=False,
            )
        )

        exported = export_schedule_snapshot(
            schedule=result.schedule,
            strategy=result.strategy,
            solver_status=result.solver_status,
            objective_value=result.objective_value,
            wall_time_ms=result.wall_time_ms,
            metrics=result.metrics,
        )

        assert exported["contract_version"] == CONTRACT_VERSION
        assert exported["strategy"] == "greedy"
        assert exported["solver_status"] == "feasible"
        assert len(exported["assignments"]) == 6
        green = next(a for a in exported["assignments"] if a["operation_id"] == "GREEN-ASM")
        assert len(green["segments"]) >= 2
