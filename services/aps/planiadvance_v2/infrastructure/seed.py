"""Demo data seed.

Provides a small but realistic factory that can populate either an
in-memory repository set or a PostgreSQL database. Used by the CLI
``--demo`` flag, by the API bootstrap (``/seed`` endpoint), and by
integration tests.
"""

from __future__ import annotations

from dataclasses import dataclass, replace
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
from ..domain.value_objects import Duration, Priority, Shift, TransferTimes
from .industrial_reference import (
    build_industrial_acceptance_workshop,
    build_industrial_stress_workshop,
)


@dataclass(slots=True)
class DemoDataset:
    name: str
    horizon_start: datetime
    calendars: list[WorkingCalendar]
    machines: list[Machine]
    resources: list[Resource]
    work_orders: list[WorkOrder]
    inventory_items: list[InventoryItem]
    supplies: list[SupplyLot]
    transfer_times: TransferTimes


def build_demo_dataset(start: datetime | None = None) -> DemoDataset:
    """Return a deterministic demo dataset.

    Fixed shape:
    - 1 standard 5-day calendar (Mon-Fri, 08:00-17:00)
    - 4 machines: 2 CNCs, 1 welder, 1 assembly
    - 5 work orders with 2-3 operations each, varied priorities
    """
    start = start or datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)

    calendar = WorkingCalendar(
        id="CAL-STD",
        name="Standard 5x8",
        shifts=[
            Shift(weekday=w, start=time(8, 0), end=time(17, 0)) for w in range(5)
        ],
    )

    machines = [
        Machine(id="CNC-01", name="CNC Mill #1", calendar_id=calendar.id,
                capabilities=["milling"]),
        Machine(id="CNC-02", name="CNC Mill #2", calendar_id=calendar.id,
                capabilities=["milling"], efficiency=1.1),
        Machine(id="WELD-01", name="Welding Bay", calendar_id=calendar.id,
                capabilities=["welding"]),
        Machine(id="ASSY-01", name="Assembly Line", calendar_id=calendar.id,
                capabilities=["assembly"]),
    ]

    work_orders = [
        _build_wo(
            wo_id="WO-1001", name="Bracket A", product="PROD-A",
            release=start, due=start + timedelta(days=5), priority=Priority.HIGH,
            ops=[
                ("mill", ["CNC-01", "CNC-02"], 90, 10),
                ("weld", ["WELD-01"], 45, 15),
                ("assemble", ["ASSY-01"], 60, 5),
            ],
        ),
        _build_wo(
            wo_id="WO-1002", name="Housing B", product="PROD-B",
            release=start, due=start + timedelta(days=4), priority=Priority.URGENT,
            ops=[
                ("mill", ["CNC-01", "CNC-02"], 120, 20),
                ("assemble", ["ASSY-01"], 30, 5),
            ],
        ),
        _build_wo(
            wo_id="WO-1003", name="Plate C", product="PROD-C",
            release=start, due=start + timedelta(days=7), priority=Priority.NORMAL,
            ops=[
                ("mill", ["CNC-02"], 60, 10),
                ("weld", ["WELD-01"], 30, 10),
            ],
        ),
        _build_wo(
            wo_id="WO-1004", name="Frame D", product="PROD-D",
            release=start + timedelta(hours=4),
            due=start + timedelta(days=6), priority=Priority.NORMAL,
            ops=[
                ("mill", ["CNC-01", "CNC-02"], 75, 15),
                ("weld", ["WELD-01"], 60, 15),
                ("assemble", ["ASSY-01"], 90, 10),
            ],
        ),
        _build_wo(
            wo_id="WO-1005", name="Panel E", product="PROD-E",
            release=start, due=start + timedelta(days=10), priority=Priority.LOW,
            ops=[
                ("mill", ["CNC-01"], 150, 20),
                ("assemble", ["ASSY-01"], 45, 5),
            ],
        ),
    ]

    _attach_demo_materials(work_orders)

    inventory_items = [
        InventoryItem(material_id="RAW-ALUMINUM", quantity_on_hand=8.0, as_of=start),
        InventoryItem(material_id="WELD-WIRE", quantity_on_hand=3.0, as_of=start),
        InventoryItem(material_id="FASTENER-KIT", quantity_on_hand=4.0, as_of=start),
    ]
    supplies = [
        SupplyLot(
            id="SUP-AL-001",
            material_id="RAW-ALUMINUM",
            quantity=12.0,
            available_at=start + timedelta(hours=6),
            source_type="purchase_order",
        ),
        SupplyLot(
            id="SUP-KIT-001",
            material_id="FASTENER-KIT",
            quantity=6.0,
            available_at=start + timedelta(days=1, hours=8),
            source_type="kit_supply",
        ),
    ]

    return DemoDataset(
        name="demo",
        horizon_start=start,
        calendars=[calendar],
        machines=machines,
        resources=[],
        work_orders=work_orders,
        inventory_items=inventory_items,
        supplies=supplies,
        transfer_times=TransferTimes(),
    )


def build_industrial_demo_dataset() -> DemoDataset:
    """Return the industrial reference dataset in the seed/CLI shape."""

    dataset = build_industrial_acceptance_workshop()
    return DemoDataset(
        name="industrial",
        horizon_start=dataset.horizon_start,
        calendars=dataset.calendars,
        machines=dataset.machines,
        resources=dataset.resources,
        work_orders=dataset.work_orders,
        inventory_items=dataset.inventory_items,
        supplies=dataset.supplies,
        transfer_times=dataset.transfer_times,
    )


def build_industrial_stress_demo_dataset() -> DemoDataset:
    """Return the scaled industrial dataset in the seed/CLI shape."""

    dataset = build_industrial_stress_workshop()
    return DemoDataset(
        name="industrial_stress",
        horizon_start=dataset.horizon_start,
        calendars=dataset.calendars,
        machines=dataset.machines,
        resources=dataset.resources,
        work_orders=dataset.work_orders,
        inventory_items=dataset.inventory_items,
        supplies=dataset.supplies,
        transfer_times=dataset.transfer_times,
    )


def build_minimal_demo_dataset(start: datetime | None = None) -> DemoDataset:
    """Return a dataset with zero operational data.

    Used by the pilot bundle so a fresh customer install boots with a
    valid schema and tenant fixture but no demo machines / work orders.
    The pilot operator imports their own data through `/integration` or
    the Integration Studio UI. The bootstrap still creates the
    organization / user / workspace from `Settings.seed_*` so the planner
    has an account to log in with.
    """

    horizon = (start or datetime.now()).replace(
        hour=0, minute=0, second=0, microsecond=0
    )
    return DemoDataset(
        name="minimal",
        horizon_start=horizon,
        calendars=[],
        machines=[],
        resources=[],
        work_orders=[],
        inventory_items=[],
        supplies=[],
        transfer_times=TransferTimes(),
    )


def anchor_demo_dataset(dataset: DemoDataset, anchor: datetime) -> DemoDataset:
    """Return a copy of `dataset` with every absolute datetime shifted so
    that the dataset's `horizon_start` lands on `anchor`.

    The reference factories (`build_industrial_acceptance_workshop`,
    `build_demo_dataset`) hard-code dates in 2026-01 because tests need
    determinism. When that dataset is shipped as the seed for a pilot
    install booted in May, every WO ends up four months past due — the
    dashboard reads as catastrophe, not as "this week's plan".

    Bootstrap calls this with `anchor = next Monday from today` so the
    pilot operator sees a current-looking workshop on first boot.
    """

    delta = anchor - dataset.horizon_start
    if delta == timedelta(0):
        return dataset

    def _shift_dt(value: datetime | None) -> datetime | None:
        return value + delta if value is not None else None

    new_work_orders = []
    for wo in dataset.work_orders:
        new_work_orders.append(
            replace(
                wo,
                due_date=wo.due_date + delta,
                release_date=wo.release_date + delta,
            )
        )

    new_inventory = [
        replace(item, as_of=_shift_dt(item.as_of)) for item in dataset.inventory_items
    ]
    new_supplies = [
        replace(supply, available_at=supply.available_at + delta)
        for supply in dataset.supplies
    ]

    return DemoDataset(
        name=dataset.name,
        horizon_start=anchor,
        calendars=dataset.calendars,
        machines=dataset.machines,
        resources=dataset.resources,
        work_orders=new_work_orders,
        inventory_items=new_inventory,
        supplies=new_supplies,
        transfer_times=dataset.transfer_times,
    )


def next_monday_eight_am(reference: datetime | None = None) -> datetime:
    """Return the next Monday at 08:00 from `reference` (or now).

    Pure with respect to its argument — uses `reference` (not the wall
    clock) for the "is today Monday after 08:00?" check, so tests can
    pin a deterministic input.
    """

    pivot = reference or datetime.now()
    base = pivot.replace(hour=8, minute=0, second=0, microsecond=0)
    # weekday(): Monday is 0. Shift forward to Monday; if today IS Monday and
    # the reference is past 08:00, jump to next week so the dataset is fully
    # ahead of the wall clock at boot time.
    days_ahead = (0 - base.weekday()) % 7
    if days_ahead == 0 and base < pivot:
        days_ahead = 7
    return base + timedelta(days=days_ahead)


def build_seed_dataset(name: str = "demo", start: datetime | None = None) -> DemoDataset:
    """Return a named deterministic dataset for demos, Docker seed or CLI."""

    key = name.strip().lower()
    if key in {"demo", "basic", "default"}:
        return build_demo_dataset(start)
    if key in {"industrial", "industrial_acceptance", "acceptance"}:
        return build_industrial_demo_dataset()
    if key in {"industrial_stress", "stress", "industrial_scale"}:
        return build_industrial_stress_demo_dataset()
    if key in {"minimal", "empty", "none", "pilot"}:
        return build_minimal_demo_dataset(start)
    raise ValueError(
        f"Unknown seed dataset {name!r}. Available datasets: demo, industrial, "
        "industrial_stress, minimal."
    )


def _build_wo(
    *,
    wo_id: str,
    name: str,
    product: str,
    release: datetime,
    due: datetime,
    priority: Priority,
    ops: list[tuple[str, list[str], int, int]],
) -> WorkOrder:
    operations: list[Operation] = []
    prev_id: str | None = None
    for idx, (op_name, machines, duration_min, setup_min) in enumerate(ops, start=1):
        op_id = f"{wo_id}-{idx:02d}"
        operations.append(
            Operation(
                id=op_id,
                work_order_id=wo_id,
                sequence=idx,
                name=op_name,
                duration=Duration(minutes=duration_min),
                setup_time=Duration(minutes=setup_min),
                eligible_machine_ids=list(machines),
                dependencies=[prev_id] if prev_id else [],
            )
        )
        prev_id = op_id

    return WorkOrder(
        id=wo_id,
        name=name,
        product_id=product,
        quantity=1,
        due_date=due,
        release_date=release,
        operations=operations,
        priority=priority,
    )


def _attach_demo_materials(work_orders: list[WorkOrder]) -> None:
    for work_order in work_orders:
        for operation in work_order.operations:
            if "mill" in operation.name:
                operation.material_requirements = [
                    MaterialRequirement(
                        material_id="RAW-ALUMINUM",
                        quantity_per_unit=1.0,
                    )
                ]
            elif "weld" in operation.name:
                operation.material_requirements = [
                    MaterialRequirement(
                        material_id="WELD-WIRE",
                        fixed_quantity=0.5,
                    )
                ]
            elif "assemble" in operation.name:
                operation.material_requirements = [
                    MaterialRequirement(
                        material_id="FASTENER-KIT",
                        fixed_quantity=1.0,
                    )
                ]
