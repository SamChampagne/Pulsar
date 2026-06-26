"""Canonical APS integration contract.

The APS engine should not couple directly to the data model of any
particular ERP or MES. This module defines a stable, ERP-agnostic
snapshot that external systems can map to before feeding the engine.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, time


@dataclass(frozen=True, slots=True)
class CanonicalShift:
    weekday: int
    start: time
    end: time


@dataclass(frozen=True, slots=True)
class CanonicalTimeWindow:
    start: datetime
    end: datetime


@dataclass(frozen=True, slots=True)
class CanonicalCalendar:
    id: str
    name: str
    shifts: tuple[CanonicalShift, ...]
    extra_windows: tuple[CanonicalTimeWindow, ...] = ()
    external_ref: str | None = None
    site_id: str | None = None


@dataclass(frozen=True, slots=True)
class CanonicalSetupMatrix:
    default_minutes: int = 0
    initial_minutes: int = 0
    transitions: dict[tuple[str, str], int] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class CanonicalMachine:
    id: str
    name: str
    calendar_id: str
    capabilities: tuple[str, ...] = ()
    efficiency: float = 1.0
    setup_matrix: CanonicalSetupMatrix | None = None
    maintenance_windows: tuple[CanonicalTimeWindow, ...] = ()
    external_ref: str | None = None
    site_id: str | None = None


@dataclass(frozen=True, slots=True)
class CanonicalResource:
    id: str
    name: str
    capacity: int
    calendar_id: str | None = None
    tags: tuple[str, ...] = ()
    external_ref: str | None = None
    site_id: str | None = None


@dataclass(frozen=True, slots=True)
class CanonicalResourceRequirement:
    resource_id: str
    units: int = 1


@dataclass(frozen=True, slots=True)
class CanonicalMaterialRequirement:
    material_id: str
    quantity_per_unit: float = 0.0
    fixed_quantity: float = 0.0


@dataclass(frozen=True, slots=True)
class CanonicalDependencyLink:
    depends_on_id: str
    dependency_type: str = "finish_to_start"
    lag_minutes: int = 0
    max_wait_minutes: int | None = None


@dataclass(frozen=True, slots=True)
class CanonicalRoutingAlternative:
    machine_id: str
    duration_minutes: int
    setup_minutes: int = 0
    resource_requirements: tuple[CanonicalResourceRequirement, ...] = ()


@dataclass(frozen=True, slots=True)
class CanonicalOperation:
    id: str
    work_order_id: str
    sequence: int
    name: str
    duration_minutes: int
    eligible_machine_ids: tuple[str, ...]
    setup_minutes: int = 0
    dependencies: tuple[str, ...] = ()
    dependency_links: tuple[CanonicalDependencyLink, ...] = ()
    status: str = "pending"
    setup_family: str | None = None
    resource_requirements: tuple[CanonicalResourceRequirement, ...] = ()
    material_requirements: tuple[CanonicalMaterialRequirement, ...] = ()
    routings: tuple[CanonicalRoutingAlternative, ...] = ()
    preemptible: bool = False
    min_chunk_minutes: int = 0
    actual_start: datetime | None = None
    actual_machine_id: str | None = None
    actual_end: datetime | None = None
    remaining_duration_minutes: int | None = None
    firm_until: datetime | None = None
    frozen_until: datetime | None = None
    external_ref: str | None = None


@dataclass(frozen=True, slots=True)
class CanonicalLotSizing:
    mode: str = "none"
    lot_size: int = 0
    min_lot_size: int = 0
    max_lot_size: int = 0


@dataclass(frozen=True, slots=True)
class CanonicalWorkOrder:
    id: str
    name: str
    product_id: str
    quantity: int
    due_date: datetime
    release_date: datetime
    operations: tuple[CanonicalOperation, ...]
    priority: str = "normal"
    status: str = "released"
    # V1.2 Cas 2 — firm / forecast / tentative. ERP forecasting
    # modules push "forecast"; firm orders + the legacy / unknown
    # path default to "firm" so the engine respects them as real
    # commitments. Validated against WorkOrderFirmness on the way
    # in via the snapshot mapper.
    firmness: str = "firm"
    lot_sizing: CanonicalLotSizing = field(default_factory=CanonicalLotSizing)
    external_ref: str | None = None
    site_id: str | None = None
    item_id: str | None = None
    quantity_uom: str = "ea"
    requested_date: datetime | None = None
    promised_date: datetime | None = None
    erp_status: str | None = None
    order_type: str = "production"


@dataclass(frozen=True, slots=True)
class CanonicalTransferTimes:
    default_minutes: int = 0
    pairs: dict[tuple[str, str], int] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class CanonicalInventoryItem:
    material_id: str
    quantity_on_hand: float
    as_of: datetime | None = None


@dataclass(frozen=True, slots=True)
class CanonicalSupplyLot:
    id: str
    material_id: str
    quantity: float
    available_at: datetime
    source_type: str = "supply"


@dataclass(frozen=True, slots=True)
class CanonicalPlanningSnapshot:
    contract_version: str
    exported_at: datetime
    source_system: str
    calendars: tuple[CanonicalCalendar, ...]
    machines: tuple[CanonicalMachine, ...]
    resources: tuple[CanonicalResource, ...] = ()
    work_orders: tuple[CanonicalWorkOrder, ...] = ()
    inventory_items: tuple[CanonicalInventoryItem, ...] = ()
    supplies: tuple[CanonicalSupplyLot, ...] = ()
    transfer_times: CanonicalTransferTimes = field(default_factory=CanonicalTransferTimes)
    metadata: dict[str, object] = field(default_factory=dict)
