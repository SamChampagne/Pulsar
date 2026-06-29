"""Industrial reference dataset for demos, acceptance tests and UI readiness."""

from __future__ import annotations

from dataclasses import dataclass, field, replace
from datetime import datetime, time, timedelta

from ..domain.entities import (
    InventoryItem,
    Machine,
    Operation,
    Resource,
    SupplyLot,
    WorkingCalendar,
    WorkOrder,
)
from ..domain.entities.material import MaterialRequirement
from ..domain.entities.operation import RoutingAlternative
from ..domain.entities.resource import ResourceRequirement
from ..domain.value_objects import (
    Duration,
    Priority,
    SetupMatrix,
    Shift,
    TimeWindow,
    TransferTimes,
)


@dataclass(frozen=True, slots=True)
class IndustrialReferenceDataset:
    horizon_start: datetime
    horizon_end: datetime
    calendars: list[WorkingCalendar]
    machines: list[Machine]
    resources: list[Resource]
    work_orders: list[WorkOrder]
    transfer_times: TransferTimes
    rush_order: WorkOrder
    inventory_items: list[InventoryItem] = field(default_factory=list)
    supplies: list[SupplyLot] = field(default_factory=list)


def build_industrial_acceptance_workshop() -> IndustrialReferenceDataset:
    """Return a richer APS acceptance dataset for engine/UI readiness.

    This scenario intentionally combines multiple industrial concerns in one
    small model:

    - finite machine capacity across cut, CNC, paint, assembly and QA cells;
    - alternative routings with different resource needs and durations;
    - shared operators, a unique fixture, a paint crew and one QA inspector;
    - sequence-dependent setup families and maintenance downtime;
    - material gating with inventory plus an inbound supply lot;
    - multi-operation work orders suitable for Gantt, repair and scenario tests.
    """

    monday = datetime(2026, 1, 5, 0, 0, 0)
    calendar = WorkingCalendar(
        id="CAL-IND",
        name="Industrial Mon-Fri 08-17",
        shifts=[Shift(weekday=w, start=time(8, 0), end=time(17, 0)) for w in range(5)],
    )
    cnc_setup = SetupMatrix(
        machine_id="CNC-FAST",
        default_minutes=25,
        initial_minutes=15,
        transitions={
            ("ALPHA", "ALPHA"): 0,
            ("ALPHA", "BETA"): 35,
            ("ALPHA", "GAMMA"): 30,
            ("BETA", "ALPHA"): 25,
            ("BETA", "BETA"): 0,
            ("BETA", "GAMMA"): 20,
            ("BETA", "EPSILON"): 18,
            ("GAMMA", "ALPHA"): 30,
            ("GAMMA", "BETA"): 20,
            ("GAMMA", "GAMMA"): 0,
            ("GAMMA", "EPSILON"): 25,
            ("EPSILON", "ALPHA"): 25,
            ("EPSILON", "BETA"): 18,
            ("EPSILON", "GAMMA"): 25,
            ("EPSILON", "EPSILON"): 0,
        },
    )
    paint_setup = SetupMatrix(
        machine_id="PAINT-1",
        default_minutes=20,
        initial_minutes=10,
        transitions={
            ("RED", "RED"): 0,
            ("RED", "BLUE"): 45,
            ("BLUE", "RED"): 35,
            ("BLUE", "BLUE"): 0,
        },
    )

    machines = [
        Machine(id="LASER-1", name="Laser Cell", calendar_id=calendar.id),
        Machine(
            id="CNC-FAST",
            name="Fast CNC",
            calendar_id=calendar.id,
            setup_matrix=cnc_setup,
            maintenance_windows=[
                TimeWindow(
                    start=datetime(2026, 1, 5, 12, 0, 0),
                    end=datetime(2026, 1, 5, 13, 0, 0),
                )
            ],
        ),
        Machine(id="CNC-FLEX", name="Flexible CNC", calendar_id=calendar.id, efficiency=0.85),
        Machine(id="PAINT-1", name="Paint Booth", calendar_id=calendar.id, setup_matrix=paint_setup),
        Machine(id="ASSY-1", name="Assembly Bench", calendar_id=calendar.id),
        Machine(id="ASSY-2", name="Secondary Assembly Bench", calendar_id=calendar.id),
        Machine(id="PACK-1", name="Packing Cell", calendar_id=calendar.id),
        Machine(id="QA-1", name="Quality Gate", calendar_id=calendar.id),
    ]

    resources = [
        Resource(id="OPERATORS", name="Operator Pool", capacity=3),
        Resource(id="FIXTURE-A", name="Fixture A", capacity=1),
        Resource(id="TOOLING-KIT", name="Tooling Kit", capacity=1),
        Resource(id="ELECTRICAL-TECH", name="Electrical Technician", capacity=1),
        Resource(id="PAINT-CREW", name="Paint Crew", capacity=1),
        Resource(id="PACK-CREW", name="Packing Crew", capacity=2),
        Resource(id="QA-INSPECTOR", name="QA Inspector", capacity=1),
    ]

    inventory_items = [
        InventoryItem(material_id="RAW-AL", quantity_on_hand=60.0),
        InventoryItem(material_id="RAW-STEEL", quantity_on_hand=35.0),
        InventoryItem(material_id="PAINT-RED", quantity_on_hand=20.0),
        InventoryItem(material_id="PAINT-BLUE", quantity_on_hand=30.0),
        InventoryItem(material_id="FASTENER", quantity_on_hand=220.0),
        InventoryItem(material_id="ELECTRONICS-KIT", quantity_on_hand=6.0),
        InventoryItem(material_id="LABEL-KIT", quantity_on_hand=60.0),
    ]
    supplies = [
        SupplyLot(
            id="SUP-RAW-AL-MON-11",
            material_id="RAW-AL",
            quantity=80.0,
            available_at=datetime(2026, 1, 5, 11, 0, 0),
        ),
        SupplyLot(
            id="SUP-ELECTRONICS-TUE-08",
            material_id="ELECTRONICS-KIT",
            quantity=20.0,
            available_at=datetime(2026, 1, 6, 8, 0, 0),
        )
    ]

    alpha = WorkOrder(
        id="WO-IND-ALPHA",
        name="Alpha bracket batch",
        product_id="P-ALPHA",
        quantity=20,
        due_date=datetime(2026, 1, 7, 15, 0, 0),
        release_date=datetime(2026, 1, 5, 8, 0, 0),
        priority=Priority.URGENT,
        operations=[
            Operation(
                id="ALPHA-CUT",
                work_order_id="WO-IND-ALPHA",
                sequence=1,
                name="Alpha laser cut",
                duration=Duration(minutes=70),
                eligible_machine_ids=["LASER-1"],
                material_requirements=[
                    MaterialRequirement(material_id="RAW-AL", quantity_per_unit=2.0)
                ],
            ),
            Operation(
                id="ALPHA-CNC",
                work_order_id="WO-IND-ALPHA",
                sequence=2,
                name="Alpha machining",
                duration=Duration(minutes=110),
                eligible_machine_ids=["CNC-FAST", "CNC-FLEX"],
                dependencies=["ALPHA-CUT"],
                setup_family="ALPHA",
                routings=[
                    RoutingAlternative(
                        machine_id="CNC-FAST",
                        duration=Duration(minutes=110),
                        resource_requirements=(
                            ResourceRequirement(resource_id="OPERATORS", units=2),
                            ResourceRequirement(resource_id="FIXTURE-A", units=1),
                        ),
                    ),
                    RoutingAlternative(
                        machine_id="CNC-FLEX",
                        duration=Duration(minutes=145),
                        resource_requirements=(
                            ResourceRequirement(resource_id="OPERATORS", units=1),
                            ResourceRequirement(resource_id="FIXTURE-A", units=1),
                        ),
                    ),
                ],
            ),
            Operation(
                id="ALPHA-PAINT",
                work_order_id="WO-IND-ALPHA",
                sequence=3,
                name="Alpha red paint",
                duration=Duration(minutes=80),
                eligible_machine_ids=["PAINT-1"],
                dependencies=["ALPHA-CNC"],
                setup_family="RED",
                resource_requirements=[
                    ResourceRequirement(resource_id="PAINT-CREW", units=1)
                ],
                material_requirements=[
                    MaterialRequirement(material_id="PAINT-RED", quantity_per_unit=0.5)
                ],
            ),
            Operation(
                id="ALPHA-QA",
                work_order_id="WO-IND-ALPHA",
                sequence=4,
                name="Alpha final inspection",
                duration=Duration(minutes=45),
                eligible_machine_ids=["QA-1"],
                dependencies=["ALPHA-PAINT"],
                resource_requirements=[
                    ResourceRequirement(resource_id="QA-INSPECTOR", units=1)
                ],
            ),
        ],
    )

    beta = WorkOrder(
        id="WO-IND-BETA",
        name="Beta housing batch",
        product_id="P-BETA",
        quantity=10,
        due_date=datetime(2026, 1, 8, 12, 0, 0),
        release_date=datetime(2026, 1, 5, 8, 0, 0),
        priority=Priority.NORMAL,
        operations=[
            Operation(
                id="BETA-CUT",
                work_order_id="WO-IND-BETA",
                sequence=1,
                name="Beta cut",
                duration=Duration(minutes=60),
                eligible_machine_ids=["LASER-1"],
                material_requirements=[
                    MaterialRequirement(material_id="RAW-STEEL", quantity_per_unit=2.0)
                ],
            ),
            Operation(
                id="BETA-CNC",
                work_order_id="WO-IND-BETA",
                sequence=2,
                name="Beta machining",
                duration=Duration(minutes=95),
                eligible_machine_ids=["CNC-FAST", "CNC-FLEX"],
                dependencies=["BETA-CUT"],
                setup_family="BETA",
                routings=[
                    RoutingAlternative(
                        machine_id="CNC-FAST",
                        duration=Duration(minutes=95),
                        resource_requirements=(
                            ResourceRequirement(resource_id="OPERATORS", units=1),
                        ),
                    ),
                    RoutingAlternative(
                        machine_id="CNC-FLEX",
                        duration=Duration(minutes=125),
                        resource_requirements=(
                            ResourceRequirement(resource_id="OPERATORS", units=1),
                        ),
                    ),
                ],
            ),
            Operation(
                id="BETA-ASSY",
                work_order_id="WO-IND-BETA",
                sequence=3,
                name="Beta assembly",
                duration=Duration(minutes=90),
                eligible_machine_ids=["ASSY-1"],
                dependencies=["BETA-CNC"],
                resource_requirements=[
                    ResourceRequirement(resource_id="OPERATORS", units=2)
                ],
                material_requirements=[
                    MaterialRequirement(material_id="FASTENER", fixed_quantity=30.0)
                ],
            ),
            Operation(
                id="BETA-QA",
                work_order_id="WO-IND-BETA",
                sequence=4,
                name="Beta QA",
                duration=Duration(minutes=40),
                eligible_machine_ids=["QA-1"],
                dependencies=["BETA-ASSY"],
                resource_requirements=[
                    ResourceRequirement(resource_id="QA-INSPECTOR", units=1)
                ],
            ),
        ],
    )

    gamma = WorkOrder(
        id="WO-IND-GAMMA",
        name="Gamma rush kit",
        product_id="P-GAMMA",
        quantity=12,
        due_date=datetime(2026, 1, 6, 16, 0, 0),
        release_date=datetime(2026, 1, 5, 8, 0, 0),
        priority=Priority.URGENT,
        operations=[
            Operation(
                id="GAMMA-CUT",
                work_order_id="WO-IND-GAMMA",
                sequence=1,
                name="Gamma cut",
                duration=Duration(minutes=55),
                eligible_machine_ids=["LASER-1"],
                material_requirements=[
                    MaterialRequirement(material_id="RAW-AL", quantity_per_unit=1.5)
                ],
            ),
            Operation(
                id="GAMMA-CNC",
                work_order_id="WO-IND-GAMMA",
                sequence=2,
                name="Gamma machining",
                duration=Duration(minutes=85),
                eligible_machine_ids=["CNC-FAST", "CNC-FLEX"],
                dependencies=["GAMMA-CUT"],
                setup_family="GAMMA",
                routings=[
                    RoutingAlternative(
                        machine_id="CNC-FAST",
                        duration=Duration(minutes=85),
                        resource_requirements=(
                            ResourceRequirement(resource_id="OPERATORS", units=1),
                            ResourceRequirement(resource_id="FIXTURE-A", units=1),
                        ),
                    ),
                    RoutingAlternative(
                        machine_id="CNC-FLEX",
                        duration=Duration(minutes=115),
                        resource_requirements=(
                            ResourceRequirement(resource_id="OPERATORS", units=1),
                        ),
                    ),
                ],
            ),
            Operation(
                id="GAMMA-QA",
                work_order_id="WO-IND-GAMMA",
                sequence=3,
                name="Gamma QA",
                duration=Duration(minutes=35),
                eligible_machine_ids=["QA-1"],
                dependencies=["GAMMA-CNC"],
                resource_requirements=[
                    ResourceRequirement(resource_id="QA-INSPECTOR", units=1)
                ],
            ),
        ],
    )

    delta = WorkOrder(
        id="WO-IND-DELTA",
        name="Delta supply-gated run",
        product_id="P-DELTA",
        quantity=30,
        due_date=datetime(2026, 1, 9, 12, 0, 0),
        release_date=datetime(2026, 1, 5, 11, 0, 0),
        priority=Priority.HIGH,
        operations=[
            Operation(
                id="DELTA-CUT",
                work_order_id="WO-IND-DELTA",
                sequence=1,
                name="Delta cut after inbound aluminum",
                duration=Duration(minutes=75),
                eligible_machine_ids=["LASER-1"],
                material_requirements=[
                    MaterialRequirement(material_id="RAW-AL", quantity_per_unit=2.0)
                ],
            ),
            Operation(
                id="DELTA-PAINT",
                work_order_id="WO-IND-DELTA",
                sequence=2,
                name="Delta blue paint",
                duration=Duration(minutes=70),
                eligible_machine_ids=["PAINT-1"],
                dependencies=["DELTA-CUT"],
                setup_family="BLUE",
                resource_requirements=[
                    ResourceRequirement(resource_id="PAINT-CREW", units=1)
                ],
                material_requirements=[
                    MaterialRequirement(material_id="PAINT-BLUE", quantity_per_unit=0.4)
                ],
            ),
            Operation(
                id="DELTA-QA",
                work_order_id="WO-IND-DELTA",
                sequence=3,
                name="Delta QA",
                duration=Duration(minutes=30),
                eligible_machine_ids=["QA-1"],
                dependencies=["DELTA-PAINT"],
                resource_requirements=[
                    ResourceRequirement(resource_id="QA-INSPECTOR", units=1)
                ],
            ),
        ],
    )

    epsilon = WorkOrder(
        id="WO-IND-EPSILON",
        name="Epsilon control panel",
        product_id="P-EPSILON",
        quantity=8,
        due_date=datetime(2026, 1, 9, 15, 0, 0),
        release_date=datetime(2026, 1, 6, 8, 0, 0),
        priority=Priority.HIGH,
        operations=[
            Operation(
                id="EPSILON-CNC",
                work_order_id="WO-IND-EPSILON",
                sequence=1,
                name="Epsilon precision machining",
                duration=Duration(minutes=100),
                eligible_machine_ids=["CNC-FAST", "CNC-FLEX"],
                setup_family="EPSILON",
                material_requirements=[
                    MaterialRequirement(material_id="RAW-AL", quantity_per_unit=0.8)
                ],
                routings=[
                    RoutingAlternative(
                        machine_id="CNC-FAST",
                        duration=Duration(minutes=100),
                        resource_requirements=(
                            ResourceRequirement(resource_id="OPERATORS", units=1),
                            ResourceRequirement(resource_id="TOOLING-KIT", units=1),
                        ),
                    ),
                    RoutingAlternative(
                        machine_id="CNC-FLEX",
                        duration=Duration(minutes=130),
                        resource_requirements=(
                            ResourceRequirement(resource_id="OPERATORS", units=1),
                            ResourceRequirement(resource_id="TOOLING-KIT", units=1),
                        ),
                    ),
                ],
            ),
            Operation(
                id="EPSILON-ELECTRICAL",
                work_order_id="WO-IND-EPSILON",
                sequence=2,
                name="Epsilon electrical assembly",
                duration=Duration(minutes=120),
                eligible_machine_ids=["ASSY-1", "ASSY-2"],
                dependencies=["EPSILON-CNC"],
                material_requirements=[
                    MaterialRequirement(material_id="ELECTRONICS-KIT", fixed_quantity=8.0)
                ],
                routings=[
                    RoutingAlternative(
                        machine_id="ASSY-1",
                        duration=Duration(minutes=120),
                        resource_requirements=(
                            ResourceRequirement(resource_id="OPERATORS", units=1),
                            ResourceRequirement(resource_id="ELECTRICAL-TECH", units=1),
                        ),
                    ),
                    RoutingAlternative(
                        machine_id="ASSY-2",
                        duration=Duration(minutes=140),
                        resource_requirements=(
                            ResourceRequirement(resource_id="OPERATORS", units=1),
                            ResourceRequirement(resource_id="ELECTRICAL-TECH", units=1),
                        ),
                    ),
                ],
            ),
            Operation(
                id="EPSILON-PACK",
                work_order_id="WO-IND-EPSILON",
                sequence=3,
                name="Epsilon pack and label",
                duration=Duration(minutes=45),
                eligible_machine_ids=["PACK-1"],
                dependencies=["EPSILON-ELECTRICAL"],
                resource_requirements=[
                    ResourceRequirement(resource_id="PACK-CREW", units=1)
                ],
                material_requirements=[
                    MaterialRequirement(material_id="LABEL-KIT", fixed_quantity=8.0)
                ],
            ),
            Operation(
                id="EPSILON-QA",
                work_order_id="WO-IND-EPSILON",
                sequence=4,
                name="Epsilon final inspection",
                duration=Duration(minutes=45),
                eligible_machine_ids=["QA-1"],
                dependencies=["EPSILON-PACK"],
                resource_requirements=[
                    ResourceRequirement(resource_id="QA-INSPECTOR", units=1)
                ],
            ),
        ],
    )

    zeta = WorkOrder(
        id="WO-IND-ZETA",
        name="Zeta blue campaign",
        product_id="P-ZETA",
        quantity=15,
        due_date=datetime(2026, 1, 8, 16, 0, 0),
        release_date=datetime(2026, 1, 5, 8, 0, 0),
        priority=Priority.HIGH,
        operations=[
            Operation(
                id="ZETA-CUT",
                work_order_id="WO-IND-ZETA",
                sequence=1,
                name="Zeta cut",
                duration=Duration(minutes=50),
                eligible_machine_ids=["LASER-1"],
                material_requirements=[
                    MaterialRequirement(material_id="RAW-STEEL", quantity_per_unit=0.8)
                ],
            ),
            Operation(
                id="ZETA-PAINT",
                work_order_id="WO-IND-ZETA",
                sequence=2,
                name="Zeta blue paint",
                duration=Duration(minutes=65),
                eligible_machine_ids=["PAINT-1"],
                dependencies=["ZETA-CUT"],
                setup_family="BLUE",
                resource_requirements=[
                    ResourceRequirement(resource_id="PAINT-CREW", units=1)
                ],
                material_requirements=[
                    MaterialRequirement(material_id="PAINT-BLUE", quantity_per_unit=0.3)
                ],
            ),
            Operation(
                id="ZETA-ASSY",
                work_order_id="WO-IND-ZETA",
                sequence=3,
                name="Zeta assembly",
                duration=Duration(minutes=70),
                eligible_machine_ids=["ASSY-1", "ASSY-2"],
                dependencies=["ZETA-PAINT"],
                material_requirements=[
                    MaterialRequirement(material_id="FASTENER", fixed_quantity=40.0)
                ],
                routings=[
                    RoutingAlternative(
                        machine_id="ASSY-1",
                        duration=Duration(minutes=70),
                        resource_requirements=(
                            ResourceRequirement(resource_id="OPERATORS", units=2),
                        ),
                    ),
                    RoutingAlternative(
                        machine_id="ASSY-2",
                        duration=Duration(minutes=85),
                        resource_requirements=(
                            ResourceRequirement(resource_id="OPERATORS", units=1),
                        ),
                    ),
                ],
            ),
            Operation(
                id="ZETA-QA",
                work_order_id="WO-IND-ZETA",
                sequence=4,
                name="Zeta QA",
                duration=Duration(minutes=35),
                eligible_machine_ids=["QA-1"],
                dependencies=["ZETA-ASSY"],
                resource_requirements=[
                    ResourceRequirement(resource_id="QA-INSPECTOR", units=1)
                ],
            ),
        ],
    )

    rush = WorkOrder(
        id="WO-IND-RUSH",
        name="Industrial rush insertion",
        product_id="P-RUSH",
        quantity=5,
        due_date=datetime(2026, 1, 6, 14, 0, 0),
        release_date=datetime(2026, 1, 5, 10, 0, 0),
        priority=Priority.URGENT,
        operations=[
            Operation(
                id="RUSH-CUT",
                work_order_id="WO-IND-RUSH",
                sequence=1,
                name="Rush cut",
                duration=Duration(minutes=35),
                eligible_machine_ids=["LASER-1"],
                material_requirements=[
                    MaterialRequirement(material_id="RAW-STEEL", quantity_per_unit=1.0)
                ],
            ),
            Operation(
                id="RUSH-QA",
                work_order_id="WO-IND-RUSH",
                sequence=2,
                name="Rush QA",
                duration=Duration(minutes=25),
                eligible_machine_ids=["QA-1"],
                dependencies=["RUSH-CUT"],
                resource_requirements=[
                    ResourceRequirement(resource_id="QA-INSPECTOR", units=1)
                ],
            ),
        ],
    )

    transfers = TransferTimes(
        default_minutes=5,
        pairs={
            ("LASER-1", "CNC-FAST"): 20,
            ("LASER-1", "CNC-FLEX"): 30,
            ("CNC-FAST", "PAINT-1"): 15,
            ("CNC-FLEX", "PAINT-1"): 20,
            ("CNC-FAST", "ASSY-1"): 15,
            ("CNC-FLEX", "ASSY-1"): 20,
            ("CNC-FAST", "ASSY-2"): 18,
            ("CNC-FLEX", "ASSY-2"): 22,
            ("PAINT-1", "QA-1"): 10,
            ("ASSY-1", "QA-1"): 10,
            ("ASSY-2", "QA-1"): 12,
            ("ASSY-1", "PACK-1"): 8,
            ("ASSY-2", "PACK-1"): 8,
            ("PACK-1", "QA-1"): 8,
            ("LASER-1", "QA-1"): 15,
        },
    )

    return IndustrialReferenceDataset(
        horizon_start=monday,
        horizon_end=monday + timedelta(days=7),
        calendars=[calendar],
        machines=machines,
        resources=resources,
        work_orders=[alpha, beta, gamma, delta, epsilon, zeta],
        transfer_times=transfers,
        rush_order=rush,
        inventory_items=inventory_items,
        supplies=supplies,
    )


def build_industrial_stress_workshop(
    repetitions: int = 3,
    *,
    release_spacing_days: int = 1,
) -> IndustrialReferenceDataset:
    """Return a deterministic scaled workshop for engine stress tests.

    The stress dataset is intentionally derived from the industrial reference
    workshop instead of inventing another fixture. Every repeated work order
    keeps the same routing/resource/material complexity, while ids,
    dependencies and dates are remapped so the scheduler sees independent
    demand waves.
    """

    if repetitions < 1:
        raise ValueError("repetitions must be >= 1")
    if release_spacing_days < 0:
        raise ValueError("release_spacing_days must be >= 0")

    base = build_industrial_acceptance_workshop()
    work_orders: list[WorkOrder] = []

    for index in range(1, repetitions + 1):
        suffix = f"S{index:02d}"
        date_offset = timedelta(days=(index - 1) * release_spacing_days)
        operation_id_map = {
            operation.id: f"{operation.id}-{suffix}"
            for work_order in base.work_orders
            for operation in work_order.operations
        }

        for work_order in base.work_orders:
            new_work_order_id = f"{work_order.id}-{suffix}"
            operations: list[Operation] = []
            for operation in work_order.operations:
                operations.append(
                    replace(
                        operation,
                        id=operation_id_map[operation.id],
                        work_order_id=new_work_order_id,
                        dependencies=[
                            operation_id_map.get(dep_id, dep_id)
                            for dep_id in operation.dependencies
                        ],
                        dependency_links=[
                            replace(
                                link,
                                depends_on_id=operation_id_map.get(
                                    link.depends_on_id,
                                    link.depends_on_id,
                                ),
                            )
                            for link in operation.dependency_links
                        ],
                        actual_start=(
                            operation.actual_start + date_offset
                            if operation.actual_start
                            else None
                        ),
                        actual_end=(
                            operation.actual_end + date_offset
                            if operation.actual_end
                            else None
                        ),
                        firm_until=(
                            operation.firm_until + date_offset
                            if operation.firm_until
                            else None
                        ),
                        frozen_until=(
                            operation.frozen_until + date_offset
                            if operation.frozen_until
                            else None
                        ),
                    )
                )
            work_orders.append(
                replace(
                    work_order,
                    id=new_work_order_id,
                    name=f"{work_order.name} {suffix}",
                    release_date=work_order.release_date + date_offset,
                    due_date=work_order.due_date + date_offset,
                    operations=operations,
                )
            )

    return IndustrialReferenceDataset(
        horizon_start=base.horizon_start,
        horizon_end=base.horizon_start + timedelta(days=7 + repetitions),
        calendars=base.calendars,
        machines=base.machines,
        resources=base.resources,
        work_orders=work_orders,
        transfer_times=base.transfer_times,
        rush_order=_clone_rush_order(base.rush_order),
        inventory_items=[
            replace(
                item,
                quantity_on_hand=item.quantity_on_hand * repetitions,
            )
            for item in base.inventory_items
        ],
        supplies=[
            replace(
                supply,
                id=f"{supply.id}-STRESS",
                quantity=supply.quantity * repetitions,
            )
            for supply in base.supplies
        ],
    )


def _clone_rush_order(work_order: WorkOrder) -> WorkOrder:
    operation_id_map = {
        operation.id: f"{operation.id}-STRESS"
        for operation in work_order.operations
    }
    operations = [
        replace(
            operation,
            id=operation_id_map[operation.id],
            work_order_id=f"{work_order.id}-STRESS",
            dependencies=[
                operation_id_map.get(dep_id, dep_id)
                for dep_id in operation.dependencies
            ],
        )
        for operation in work_order.operations
    ]
    return replace(
        work_order,
        id=f"{work_order.id}-STRESS",
        name=f"{work_order.name} stress template",
        operations=operations,
    )

