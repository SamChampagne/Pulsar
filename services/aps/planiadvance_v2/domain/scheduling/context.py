"""SchedulingContext: immutable bundle of inputs for a scheduling run."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime

from ..entities import (
    InventoryItem,
    Machine,
    Resource,
    Schedule,
    SupplyLot,
    WorkingCalendar,
    WorkOrder,
)
from ..errors import UnknownResourceError, ValidationError
from ..value_objects import TransferTimes
from .frozen import FrozenAssignment


@dataclass(slots=True)
class SchedulingContext:
    """All inputs needed to run the scheduler.

    Kept separate from :class:`Scheduler` so that the scheduler instance
    itself is stateless and reusable — you build a new context per run.

    ``resources`` holds the list of secondary resources (operator pools,
    tools, consumables). It is optional: runs that only care about machine
    constraints can omit it entirely and the engine behaves exactly as
    before.

    ``frozen_assignments`` implements rolling-horizon re-planning: any
    operation already in progress (or deliberately pinned by the planner)
    is passed in here and the strategies honour it unchanged. The engine
    validates that each frozen operation refers to a work order and
    machine in the current context, which catches stale plans pointing
    at deleted machines or cancelled work orders.

    ``transfer_times`` is the machine-to-machine material-handling delay
    matrix. When a work order's op A finishes on machine X and op B must
    start on machine Y ≠ X, B cannot start before ``A.end + transfer(X, Y)``.
    Defaults to an empty matrix (zero transfers) so legacy callers keep
    their current behaviour unchanged.
    """

    horizon_start: datetime
    horizon_end: datetime
    work_orders: list[WorkOrder]
    machines: list[Machine]
    calendars: list[WorkingCalendar]
    resources: list[Resource] = field(default_factory=list)
    inventory_items: list[InventoryItem] = field(default_factory=list)
    supplies: list[SupplyLot] = field(default_factory=list)
    frozen_assignments: list[FrozenAssignment] = field(default_factory=list)
    transfer_times: TransferTimes = field(default_factory=TransferTimes)
    baseline_schedule: Schedule | None = None
    run_id: str = field(default="")

    def __post_init__(self) -> None:
        if self.horizon_end <= self.horizon_start:
            raise ValidationError("horizon_end must be > horizon_start")
        if not self.machines:
            raise ValidationError("SchedulingContext requires at least one machine")
        if not self.calendars:
            raise ValidationError("SchedulingContext requires at least one calendar")

        machine_ids = {m.id for m in self.machines}
        calendar_ids = {c.id for c in self.calendars}
        resource_ids = {r.id for r in self.resources}
        if len(resource_ids) != len(self.resources):
            raise ValidationError("SchedulingContext: duplicate resource ids")
        supply_ids = {s.id for s in self.supplies}
        if len(supply_ids) != len(self.supplies):
            raise ValidationError("SchedulingContext: duplicate supply ids")

        for machine in self.machines:
            if machine.calendar_id not in calendar_ids:
                raise UnknownResourceError(
                    f"Machine {machine.id} references unknown calendar "
                    f"{machine.calendar_id}"
                )

        for resource in self.resources:
            if resource.calendar_id is not None and resource.calendar_id not in calendar_ids:
                raise UnknownResourceError(
                    f"Resource {resource.id} references unknown calendar "
                    f"{resource.calendar_id}"
                )

        known_op_ids: set[str] = set()
        for wo in self.work_orders:
            for op in wo.operations:
                known_op_ids.add(op.id)
                unknown = [m for m in op.eligible_machine_ids if m not in machine_ids]
                if unknown:
                    raise UnknownResourceError(
                        f"Operation {op.id} references unknown machines: {unknown}"
                    )
                for req in op.resource_requirements:
                    if req.resource_id not in resource_ids:
                        raise UnknownResourceError(
                            f"Operation {op.id} requires unknown resource "
                            f"{req.resource_id}"
                        )
                for req in op.material_requirements:
                    if not req.material_id:
                        raise ValidationError(
                            f"Operation {op.id} has an empty material requirement id"
                        )

        # Validate frozen assignments against the live context. An
        # operation id that is no longer in the work-order set means the
        # upstream planner forgot to drop a cancelled task — fail loudly.
        seen_frozen_ids: set[str] = set()
        for fa in self.frozen_assignments:
            if fa.operation_id in seen_frozen_ids:
                raise ValidationError(
                    f"Duplicate frozen assignment for operation {fa.operation_id}"
                )
            seen_frozen_ids.add(fa.operation_id)
            if fa.operation_id not in known_op_ids:
                raise UnknownResourceError(
                    f"Frozen assignment references unknown operation "
                    f"{fa.operation_id}"
                )
            if fa.machine_id not in machine_ids:
                raise UnknownResourceError(
                    f"Frozen assignment {fa.operation_id} references unknown "
                    f"machine {fa.machine_id}"
                )

        # Transfer-times matrix: every endpoint must be a known machine,
        # otherwise a typo in the plant model would silently disable the
        # transport delay and produce infeasible handovers on the floor.
        for (src, dst) in self.transfer_times.pairs:
            if src not in machine_ids:
                raise UnknownResourceError(
                    f"TransferTimes references unknown source machine {src!r}"
                )
            if dst not in machine_ids:
                raise UnknownResourceError(
                    f"TransferTimes references unknown target machine {dst!r}"
                )

    def machine_map(self) -> dict[str, Machine]:
        return {m.id: m for m in self.machines}

    def calendar_map(self) -> dict[str, WorkingCalendar]:
        return {c.id: c for c in self.calendars}

    def resource_map(self) -> dict[str, Resource]:
        return {r.id: r for r in self.resources}

    def available_material_ids(self) -> set[str]:
        ids = {item.material_id for item in self.inventory_items}
        ids.update(supply.material_id for supply in self.supplies)
        return ids
