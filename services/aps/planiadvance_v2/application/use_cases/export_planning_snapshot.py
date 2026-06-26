"""Use case: export current APS master data as a canonical snapshot."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime

from ...application.integration import CanonicalPlanningSnapshot, export_planning_snapshot
from ...domain.value_objects import TransferTimes
from ..ports import (
    CalendarRepository,
    InventoryRepository,
    MachineRepository,
    ResourceRepository,
    SupplyRepository,
    WorkOrderRepository,
)
from .tenant_scope import list_scoped


@dataclass(slots=True)
class ExportPlanningSnapshotInput:
    source_system: str = "internal"
    exported_at: datetime | None = None
    transfer_times: TransferTimes = field(default_factory=TransferTimes)
    metadata: dict[str, object] = field(default_factory=dict)
    organization_id: str | None = None
    workspace_id: str | None = None


class ExportPlanningSnapshot:
    def __init__(
        self,
        *,
        work_orders: WorkOrderRepository,
        machines: MachineRepository,
        calendars: CalendarRepository,
        resources: ResourceRepository | None = None,
        inventory: InventoryRepository | None = None,
        supplies: SupplyRepository | None = None,
    ) -> None:
        self._work_orders = work_orders
        self._machines = machines
        self._calendars = calendars
        self._resources = resources
        self._inventory = inventory
        self._supplies = supplies

    def execute(
        self, command: ExportPlanningSnapshotInput
    ) -> CanonicalPlanningSnapshot:
        resources = (
            list_scoped(self._resources, command.organization_id, command.workspace_id)
            if self._resources is not None
            else []
        )
        inventory_items = (
            list_scoped(self._inventory, command.organization_id, command.workspace_id)
            if self._inventory is not None
            else []
        )
        supplies = (
            list_scoped(self._supplies, command.organization_id, command.workspace_id)
            if self._supplies is not None
            else []
        )
        return export_planning_snapshot(
            calendars=list_scoped(
                self._calendars,
                command.organization_id,
                command.workspace_id,
            ),
            machines=list_scoped(
                self._machines,
                command.organization_id,
                command.workspace_id,
            ),
            resources=resources,
            work_orders=list_scoped(
                self._work_orders,
                command.organization_id,
                command.workspace_id,
            ),
            inventory_items=inventory_items,
            supplies=supplies,
            transfer_times=command.transfer_times,
            source_system=command.source_system,
            exported_at=command.exported_at,
            metadata=command.metadata,
        )
