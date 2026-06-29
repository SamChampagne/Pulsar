"""Lot-splitting preprocessor.

Industrial shops rarely run a 500-unit order as a single batch: it blocks
the machine for hours, delays downstream work centres, and inflates WIP.
This module provides a **pre-processing transform** that expands work
orders with a :class:`LotSizingPolicy` into independent sub-lot work
orders *before* any strategy sees them. The strategies stay untouched —
they just see more (smaller) work orders with dependencies.

Public API
----------
- :func:`split_lots` — expand ``SchedulingContext.work_orders`` into
  sub-lot work orders. Returns a :class:`LotSplitResult` containing the
  expanded work-order list and a mapping from sub-lot ids back to parent
  ids, so the post-processor can reassemble the result.

- :func:`reassemble_schedule` — take the :class:`Schedule` produced by a
  strategy on the expanded context and map sub-lot assignments back to
  their parent work-order / operation ids. This lets the caller see a
  single WO with multiple batches rather than N synthetic WOs.

ID convention
-------------
Sub-lot work orders: ``{parent_wo_id}/lot-{index}``  (1-based)
Sub-lot operations:  ``{parent_op_id}/lot-{index}``

The ``/lot-`` separator is chosen because ``/`` never appears in
user-supplied ids (validated upstream) and makes it trivial to parse.

Dependencies
------------
Each sub-lot's internal operation chain mirrors the parent WO. There are
**no** cross-lot dependencies by default — the whole point is that lot-2
can start on a different machine while lot-1 is still running. A future
extension can add overlap-transfer-batch constraints (lot-2 OP2 can start
after lot-1 OP1 finishes the first transfer batch).
"""

from __future__ import annotations

from dataclasses import dataclass

from ..entities import Operation, Schedule, ScheduledOperation, WorkOrder
from ..value_objects import LotSizingMode


@dataclass(frozen=True, slots=True)
class LotSplitResult:
    """Output of :func:`split_lots`.

    ``work_orders``
        The expanded list — unchanged WOs plus generated sub-lot WOs.
    ``lot_map``
        Maps sub-lot WO id → parent WO id, for reassembly.
    ``op_map``
        Maps sub-lot operation id → parent operation id.
    ``lot_quantities``
        Maps sub-lot WO id → lot quantity.
    """

    work_orders: list[WorkOrder]
    lot_map: dict[str, str]
    op_map: dict[str, str]
    lot_quantities: dict[str, int]


def split_lots(work_orders: list[WorkOrder]) -> LotSplitResult:
    """Expand work orders with lot-sizing policies into sub-lot WOs.

    Work orders whose ``lot_sizing.mode`` is ``NONE`` pass through
    unchanged. Others are replaced by N sub-lot work orders whose
    operations mirror the parent's structure with traceable ids.

    The returned :class:`LotSplitResult` carries the mapping tables
    needed by :func:`reassemble_schedule` to fold sub-lots back.
    """
    expanded: list[WorkOrder] = []
    lot_map: dict[str, str] = {}
    op_map: dict[str, str] = {}
    lot_quantities: dict[str, int] = {}

    for wo in work_orders:
        if wo.lot_sizing.mode == LotSizingMode.NONE:
            expanded.append(wo)
            continue

        lots = wo.lot_sizing.compute_lots(wo.quantity)
        if len(lots) <= 1:
            # Single lot — no benefit in splitting.
            expanded.append(wo)
            continue

        for lot_idx, lot_qty in enumerate(lots, start=1):
            sub_wo = _create_sub_lot_wo(wo, lot_idx, lot_qty)
            expanded.append(sub_wo)
            lot_map[sub_wo.id] = wo.id
            lot_quantities[sub_wo.id] = lot_qty
            for sub_op in sub_wo.operations:
                # Map sub-lot op id back to parent op id.
                parent_op_id = sub_op.id.rsplit("/lot-", 1)[0]
                op_map[sub_op.id] = parent_op_id

    return LotSplitResult(
        work_orders=expanded,
        lot_map=lot_map,
        op_map=op_map,
        lot_quantities=lot_quantities,
    )


def reassemble_schedule(
    schedule: Schedule,
    result: LotSplitResult,
) -> Schedule:
    """Map sub-lot assignments back to their parent work-order/operation ids.

    Each sub-lot assignment is rewritten to carry the parent WO id and
    parent operation id. The ``operation_id`` gets a ``/lot-N`` suffix
    preserved so the caller can still distinguish lots within the same
    parent operation — useful for Gantt charts.

    Work orders that were not split pass through unchanged.
    """
    if not result.lot_map:
        # Nothing was split — return as-is.
        return schedule

    reassembled: list[ScheduledOperation] = []
    for assignment in schedule.assignments:
        parent_wo_id = result.lot_map.get(
            assignment.work_order_id, assignment.work_order_id
        )
        reassembled.append(
            ScheduledOperation(
                operation_id=assignment.operation_id,
                work_order_id=parent_wo_id,
                machine_id=assignment.machine_id,
                setup_start=assignment.setup_start,
                start=assignment.start,
                end=assignment.end,
                segments=assignment.segments,
            )
        )

    return Schedule(
        id=schedule.id,
        created_at=schedule.created_at,
        assignments=reassembled,
    )


# ----------------------------------------------------------------- internals


def _create_sub_lot_wo(
    parent: WorkOrder,
    lot_index: int,
    lot_quantity: int,
) -> WorkOrder:
    """Build a sub-lot work order from a parent WO."""
    sub_wo_id = f"{parent.id}/lot-{lot_index}"
    parent_ops = parent.ordered_operations()

    sub_ops: list[Operation] = []
    for op in parent_ops:
        sub_op_id = f"{op.id}/lot-{lot_index}"
        # Remap dependencies to sub-lot ids.
        sub_deps = [f"{dep}/lot-{lot_index}" for dep in op.dependencies]
        sub_links = [
            link.__class__(
                depends_on_id=f"{link.depends_on_id}/lot-{lot_index}",
                dependency_type=link.dependency_type,
                lag_minutes=link.lag_minutes,
                max_wait_minutes=link.max_wait_minutes,
            )
            for link in op.dependency_links
        ]
        sub_ops.append(
            Operation(
                id=sub_op_id,
                work_order_id=sub_wo_id,
                sequence=op.sequence,
                name=f"{op.name} (lot {lot_index})",
                duration=_scale_duration(op.duration, lot_quantity, parent.quantity),
                setup_time=op.setup_time,  # setup is per-batch, not per-unit
                eligible_machine_ids=list(op.eligible_machine_ids),
                dependencies=sub_deps,
                dependency_links=sub_links,
                status=op.status,
                setup_family=op.setup_family,
                resource_requirements=list(op.resource_requirements),
                routings=list(op.routings),
                preemptible=op.preemptible,
                min_chunk=op.min_chunk,
            )
        )

    return WorkOrder(
        id=sub_wo_id,
        name=f"{parent.name} (lot {lot_index})",
        product_id=parent.product_id,
        quantity=lot_quantity,
        due_date=parent.due_date,
        release_date=parent.release_date,
        operations=sub_ops,
        priority=parent.priority,
        status=parent.status,
        lot_sizing=parent.lot_sizing.none(),  # sub-lots are never re-split
    )


def _scale_duration(duration, lot_qty: int, total_qty: int):
    """Scale an operation duration proportionally to the lot's share.

    Duration is assumed proportional to quantity (linear model — the
    standard assumption for machining, assembly, etc.). The minimum
    is 1 minute to avoid zero-duration operations.
    """
    from ..value_objects import Duration

    scaled = max(int(round(duration.minutes * lot_qty / total_qty)), 1)
    return Duration(minutes=scaled)
