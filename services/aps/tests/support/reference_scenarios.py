"""Reference APS scenarios used across the maturity sprint tests.

The goal is to keep one small but credible workshop model that exercises
several industrial constraints together:

- alternative routings on assembly
- transfer times between cut and assembly cells
- sequence-dependent setup on assembly
- a shared tooling resource
- a planned maintenance window

This gives us a stable dataset to replay in run / compare / disruption tests.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, time, timedelta

from planiadvance_v2.domain.entities import (
    InventoryItem,
    Machine,
    Operation,
    Resource,
    SupplyLot,
    WorkingCalendar,
    WorkOrder,
)
from planiadvance_v2.domain.entities.operation import RoutingAlternative
from planiadvance_v2.domain.entities.resource import ResourceRequirement
from planiadvance_v2.domain.value_objects import (
    Duration,
    Priority,
    SetupMatrix,
    Shift,
    TimeWindow,
    TransferTimes,
)


@dataclass(frozen=True, slots=True)
class ReferenceWorkshop:
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


def build_reference_workshop() -> ReferenceWorkshop:
    monday = datetime(2026, 1, 5, 0, 0, 0)
    calendar = WorkingCalendar(
        id="CAL-REF",
        name="Mon-Fri 08-17",
        shifts=[Shift(weekday=w, start=time(8, 0), end=time(17, 0)) for w in range(5)],
    )
    setup_matrix = SetupMatrix(
        machine_id="ASM-1",
        default_minutes=20,
        initial_minutes=10,
        transitions={
            ("RED", "RED"): 0,
            ("RED", "BLUE"): 35,
            ("BLUE", "RED"): 25,
            ("BLUE", "BLUE"): 0,
        },
    )

    machines = [
        Machine(id="CUT-1", name="Laser Cut", calendar_id=calendar.id),
        Machine(id="ASM-1", name="Assembly Cell 1", calendar_id=calendar.id, setup_matrix=setup_matrix),
        Machine(
            id="ASM-2",
            name="Assembly Cell 2",
            calendar_id=calendar.id,
            maintenance_windows=[
                TimeWindow(
                    start=datetime(2026, 1, 5, 13, 0, 0),
                    end=datetime(2026, 1, 5, 15, 0, 0),
                )
            ],
        ),
    ]

    resources = [
        Resource(id="TOOL-KIT", name="Tool Kit", capacity=1),
        Resource(id="OPERATORS", name="Operators", capacity=2),
    ]

    wo_red = WorkOrder(
        id="WO-RED",
        name="WO-RED",
        product_id="P-RED",
        quantity=20,
        due_date=monday + timedelta(days=1, hours=18),
        release_date=monday + timedelta(hours=8),
        priority=Priority.URGENT,
        operations=[
            Operation(
                id="RED-CUT",
                work_order_id="WO-RED",
                sequence=1,
                name="RED-CUT",
                duration=Duration(minutes=80),
                eligible_machine_ids=["CUT-1"],
            ),
            Operation(
                id="RED-ASM",
                work_order_id="WO-RED",
                sequence=2,
                name="RED-ASM",
                duration=Duration(minutes=90),
                eligible_machine_ids=["ASM-1", "ASM-2"],
                dependencies=["RED-CUT"],
                setup_family="RED",
                routings=[
                    RoutingAlternative(
                        machine_id="ASM-1",
                        duration=Duration(minutes=90),
                        resource_requirements=(
                            ResourceRequirement(resource_id="TOOL-KIT", units=1),
                            ResourceRequirement(resource_id="OPERATORS", units=2),
                        ),
                    ),
                    RoutingAlternative(
                        machine_id="ASM-2",
                        duration=Duration(minutes=120),
                        resource_requirements=(
                            ResourceRequirement(resource_id="OPERATORS", units=1),
                        ),
                    ),
                ],
            ),
        ],
    )

    wo_blue = WorkOrder(
        id="WO-BLUE",
        name="WO-BLUE",
        product_id="P-BLUE",
        quantity=16,
        due_date=monday + timedelta(days=2, hours=12),
        release_date=monday + timedelta(hours=8),
        priority=Priority.NORMAL,
        operations=[
            Operation(
                id="BLUE-CUT",
                work_order_id="WO-BLUE",
                sequence=1,
                name="BLUE-CUT",
                duration=Duration(minutes=70),
                eligible_machine_ids=["CUT-1"],
            ),
            Operation(
                id="BLUE-ASM",
                work_order_id="WO-BLUE",
                sequence=2,
                name="BLUE-ASM",
                duration=Duration(minutes=110),
                eligible_machine_ids=["ASM-1", "ASM-2"],
                dependencies=["BLUE-CUT"],
                setup_family="BLUE",
                routings=[
                    RoutingAlternative(
                        machine_id="ASM-1",
                        duration=Duration(minutes=110),
                        resource_requirements=(
                            ResourceRequirement(resource_id="TOOL-KIT", units=1),
                            ResourceRequirement(resource_id="OPERATORS", units=1),
                        ),
                    ),
                    RoutingAlternative(
                        machine_id="ASM-2",
                        duration=Duration(minutes=95),
                        resource_requirements=(
                            ResourceRequirement(resource_id="OPERATORS", units=1),
                        ),
                    ),
                ],
            ),
        ],
    )

    rush = WorkOrder(
        id="WO-RUSH",
        name="WO-RUSH",
        product_id="P-RUSH",
        quantity=8,
        due_date=monday + timedelta(days=1),
        release_date=monday + timedelta(hours=11),
        priority=Priority.URGENT,
        operations=[
            Operation(
                id="RUSH-CUT",
                work_order_id="WO-RUSH",
                sequence=1,
                name="RUSH-CUT",
                duration=Duration(minutes=45),
                eligible_machine_ids=["CUT-1"],
            ),
            Operation(
                id="RUSH-ASM",
                work_order_id="WO-RUSH",
                sequence=2,
                name="RUSH-ASM",
                duration=Duration(minutes=60),
                eligible_machine_ids=["ASM-1", "ASM-2"],
                dependencies=["RUSH-CUT"],
                setup_family="RED",
                routings=[
                    RoutingAlternative(
                        machine_id="ASM-1",
                        duration=Duration(minutes=60),
                        resource_requirements=(
                            ResourceRequirement(resource_id="TOOL-KIT", units=1),
                            ResourceRequirement(resource_id="OPERATORS", units=1),
                        ),
                    ),
                    RoutingAlternative(
                        machine_id="ASM-2",
                        duration=Duration(minutes=75),
                        resource_requirements=(
                            ResourceRequirement(resource_id="OPERATORS", units=1),
                        ),
                    ),
                ],
            ),
        ],
    )

    transfers = TransferTimes(
        default_minutes=0,
        pairs={
            ("CUT-1", "ASM-1"): 20,
            ("CUT-1", "ASM-2"): 35,
            ("ASM-1", "ASM-2"): 10,
            ("ASM-2", "ASM-1"): 10,
        },
    )

    return ReferenceWorkshop(
        horizon_start=monday,
        horizon_end=monday + timedelta(days=5),
        calendars=[calendar],
        machines=machines,
        resources=resources,
        work_orders=[wo_red, wo_blue],
        transfer_times=transfers,
        rush_order=rush,
    )


def build_stressed_reference_workshop() -> ReferenceWorkshop:
    """A tighter workshop used to stress arbitration logic.

    Compared to ``build_reference_workshop()``, this one adds:
    - a third work order competing for the same cut and assembly cells
    - tighter due dates that trigger degraded pre-solve readiness
    - heavier contention on the shared tooling pool
    - longer maintenance on ASM-2 to force more real routing trade-offs
    """

    monday = datetime(2026, 1, 5, 0, 0, 0)
    calendar = WorkingCalendar(
        id="CAL-STRESS",
        name="Mon-Fri 08-17",
        shifts=[Shift(weekday=w, start=time(8, 0), end=time(17, 0)) for w in range(5)],
    )
    setup_matrix = SetupMatrix(
        machine_id="ASM-1",
        default_minutes=20,
        initial_minutes=10,
        transitions={
            ("RED", "RED"): 0,
            ("RED", "BLUE"): 35,
            ("RED", "GREEN"): 30,
            ("BLUE", "RED"): 25,
            ("BLUE", "BLUE"): 0,
            ("BLUE", "GREEN"): 20,
            ("GREEN", "RED"): 20,
            ("GREEN", "BLUE"): 15,
            ("GREEN", "GREEN"): 0,
        },
    )

    machines = [
        Machine(id="CUT-1", name="Laser Cut", calendar_id=calendar.id),
        Machine(
            id="ASM-1",
            name="Assembly Cell 1",
            calendar_id=calendar.id,
            setup_matrix=setup_matrix,
        ),
        Machine(
            id="ASM-2",
            name="Assembly Cell 2",
            calendar_id=calendar.id,
            maintenance_windows=[
                TimeWindow(
                    start=datetime(2026, 1, 5, 8, 0, 0),
                    end=datetime(2026, 1, 5, 17, 0, 0),
                ),
                TimeWindow(
                    start=datetime(2026, 1, 6, 8, 0, 0),
                    end=datetime(2026, 1, 6, 17, 0, 0),
                ),
                TimeWindow(
                    start=datetime(2026, 1, 7, 8, 0, 0),
                    end=datetime(2026, 1, 7, 17, 0, 0),
                ),
                TimeWindow(
                    start=datetime(2026, 1, 8, 8, 0, 0),
                    end=datetime(2026, 1, 8, 17, 0, 0),
                ),
                TimeWindow(
                    start=datetime(2026, 1, 9, 8, 0, 0),
                    end=datetime(2026, 1, 9, 13, 0, 0),
                ),
            ],
        ),
    ]

    resources = [
        Resource(id="TOOL-KIT", name="Tool Kit", capacity=1),
        Resource(id="OPERATORS", name="Operators", capacity=2),
        Resource(id="FIXTURE-GREEN", name="Green Fixture", capacity=1),
    ]

    wo_red = WorkOrder(
        id="WO-RED",
        name="WO-RED",
        product_id="P-RED",
        quantity=20,
        due_date=datetime(2026, 1, 6, 14, 0, 0),
        release_date=datetime(2026, 1, 5, 8, 0, 0),
        priority=Priority.URGENT,
        operations=[
            Operation(
                id="RED-CUT",
                work_order_id="WO-RED",
                sequence=1,
                name="RED-CUT",
                duration=Duration(minutes=90),
                eligible_machine_ids=["CUT-1"],
            ),
            Operation(
                id="RED-ASM",
                work_order_id="WO-RED",
                sequence=2,
                name="RED-ASM",
                duration=Duration(minutes=150),
                eligible_machine_ids=["ASM-1", "ASM-2"],
                dependencies=["RED-CUT"],
                setup_family="RED",
                routings=[
                    RoutingAlternative(
                        machine_id="ASM-1",
                        duration=Duration(minutes=150),
                        resource_requirements=(
                            ResourceRequirement(resource_id="TOOL-KIT", units=1),
                            ResourceRequirement(resource_id="OPERATORS", units=2),
                        ),
                    ),
                    RoutingAlternative(
                        machine_id="ASM-2",
                        duration=Duration(minutes=185),
                        resource_requirements=(
                            ResourceRequirement(resource_id="OPERATORS", units=1),
                        ),
                    ),
                ],
            ),
        ],
    )

    wo_blue = WorkOrder(
        id="WO-BLUE",
        name="WO-BLUE",
        product_id="P-BLUE",
        quantity=18,
        due_date=datetime(2026, 1, 6, 17, 0, 0),
        release_date=datetime(2026, 1, 5, 8, 0, 0),
        priority=Priority.NORMAL,
        operations=[
            Operation(
                id="BLUE-CUT",
                work_order_id="WO-BLUE",
                sequence=1,
                name="BLUE-CUT",
                duration=Duration(minutes=80),
                eligible_machine_ids=["CUT-1"],
            ),
            Operation(
                id="BLUE-ASM",
                work_order_id="WO-BLUE",
                sequence=2,
                name="BLUE-ASM",
                duration=Duration(minutes=130),
                eligible_machine_ids=["ASM-1", "ASM-2"],
                dependencies=["BLUE-CUT"],
                setup_family="BLUE",
                routings=[
                    RoutingAlternative(
                        machine_id="ASM-1",
                        duration=Duration(minutes=130),
                        resource_requirements=(
                            ResourceRequirement(resource_id="TOOL-KIT", units=1),
                            ResourceRequirement(resource_id="OPERATORS", units=1),
                        ),
                    ),
                    RoutingAlternative(
                        machine_id="ASM-2",
                        duration=Duration(minutes=145),
                        resource_requirements=(
                            ResourceRequirement(resource_id="OPERATORS", units=1),
                        ),
                    ),
                ],
            ),
        ],
    )

    wo_green = WorkOrder(
        id="WO-GREEN",
        name="WO-GREEN",
        product_id="P-GREEN",
        quantity=12,
        due_date=datetime(2026, 1, 7, 12, 0, 0),
        release_date=datetime(2026, 1, 5, 9, 0, 0),
        priority=Priority.URGENT,
        operations=[
            Operation(
                id="GREEN-CUT",
                work_order_id="WO-GREEN",
                sequence=1,
                name="GREEN-CUT",
                duration=Duration(minutes=70),
                eligible_machine_ids=["CUT-1"],
            ),
            Operation(
                id="GREEN-ASM",
                work_order_id="WO-GREEN",
                sequence=2,
                name="GREEN-ASM",
                duration=Duration(minutes=210),
                eligible_machine_ids=["ASM-1", "ASM-2"],
                dependencies=["GREEN-CUT"],
                setup_family="GREEN",
                preemptible=True,
                min_chunk=Duration(minutes=60),
                routings=[
                    RoutingAlternative(
                        machine_id="ASM-1",
                        duration=Duration(minutes=210),
                        resource_requirements=(
                            ResourceRequirement(resource_id="TOOL-KIT", units=1),
                            ResourceRequirement(resource_id="OPERATORS", units=1),
                            ResourceRequirement(resource_id="FIXTURE-GREEN", units=1),
                        ),
                    ),
                    RoutingAlternative(
                        machine_id="ASM-2",
                        duration=Duration(minutes=240),
                        resource_requirements=(
                            ResourceRequirement(resource_id="OPERATORS", units=1),
                            ResourceRequirement(resource_id="FIXTURE-GREEN", units=1),
                        ),
                    ),
                ],
            ),
        ],
    )

    rush = WorkOrder(
        id="WO-RUSH-STRESS",
        name="WO-RUSH-STRESS",
        product_id="P-RUSH-STRESS",
        quantity=6,
        due_date=datetime(2026, 1, 6, 14, 0, 0),
        release_date=datetime(2026, 1, 5, 11, 0, 0),
        priority=Priority.URGENT,
        operations=[
            Operation(
                id="RUSH-STRESS-CUT",
                work_order_id="WO-RUSH-STRESS",
                sequence=1,
                name="RUSH-STRESS-CUT",
                duration=Duration(minutes=50),
                eligible_machine_ids=["CUT-1"],
            ),
            Operation(
                id="RUSH-STRESS-ASM",
                work_order_id="WO-RUSH-STRESS",
                sequence=2,
                name="RUSH-STRESS-ASM",
                duration=Duration(minutes=90),
                eligible_machine_ids=["ASM-1", "ASM-2"],
                dependencies=["RUSH-STRESS-CUT"],
                setup_family="RED",
                routings=[
                    RoutingAlternative(
                        machine_id="ASM-1",
                        duration=Duration(minutes=90),
                        resource_requirements=(
                            ResourceRequirement(resource_id="TOOL-KIT", units=1),
                            ResourceRequirement(resource_id="OPERATORS", units=1),
                        ),
                    ),
                    RoutingAlternative(
                        machine_id="ASM-2",
                        duration=Duration(minutes=105),
                        resource_requirements=(
                            ResourceRequirement(resource_id="OPERATORS", units=1),
                        ),
                    ),
                ],
            ),
        ],
    )

    transfers = TransferTimes(
        default_minutes=0,
        pairs={
            ("CUT-1", "ASM-1"): 25,
            ("CUT-1", "ASM-2"): 40,
            ("ASM-1", "ASM-2"): 15,
            ("ASM-2", "ASM-1"): 15,
        },
    )

    return ReferenceWorkshop(
        horizon_start=monday,
        horizon_end=monday + timedelta(days=5),
        calendars=[calendar],
        machines=machines,
        resources=resources,
        work_orders=[wo_red, wo_blue, wo_green],
        transfer_times=transfers,
        rush_order=rush,
    )

