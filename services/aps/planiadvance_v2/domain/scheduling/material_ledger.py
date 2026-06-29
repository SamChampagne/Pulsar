"""Temporal material availability and reservation helper."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from ..entities import InventoryItem, MaterialRequirement, SupplyLot


@dataclass(frozen=True, slots=True)
class MaterialNeed:
    material_id: str
    quantity: float


@dataclass(frozen=True, slots=True)
class MaterialSource:
    id: str
    material_id: str
    quantity: float
    available_at: datetime
    source_type: str


@dataclass(frozen=True, slots=True)
class MaterialAssessment:
    ready_at: datetime | None
    blocking_material_id: str | None
    need_by_material: dict[str, float]
    ready_times: dict[str, datetime]


@dataclass(frozen=True, slots=True)
class MaterialReservation:
    operation_id: str
    material_id: str
    quantity: float
    required_at: datetime
    reservation_origin: str = "scheduled"


class MaterialLedger:
    """Tracks material availability over time.

    Availability is computed from:
    - on-hand inventory
    - inbound supply lots
    - already reserved operation demand

    Reservations are time-stamped, so the ledger stays consistent even when
    a backward strategy books a later operation before an earlier one.
    """

    def __init__(
        self,
        *,
        inventory_items: list[InventoryItem],
        supplies: list[SupplyLot],
        horizon_start: datetime,
    ) -> None:
        self._horizon_start = horizon_start
        self._sources_by_material: dict[str, list[MaterialSource]] = {}
        self._supply_by_material: dict[str, list[tuple[datetime, float]]] = {}
        self._reservations: dict[str, list[MaterialReservation]] = {}

        for item in inventory_items:
            source = MaterialSource(
                id=f"inventory:{item.material_id}",
                material_id=item.material_id,
                quantity=float(item.quantity_on_hand),
                available_at=item.as_of or horizon_start,
                source_type="inventory",
            )
            self._sources_by_material.setdefault(item.material_id, []).append(source)
            self._supply_by_material.setdefault(item.material_id, []).append(
                (item.as_of or horizon_start, float(item.quantity_on_hand))
            )
        for supply in supplies:
            source = MaterialSource(
                id=supply.id,
                material_id=supply.material_id,
                quantity=float(supply.quantity),
                available_at=supply.available_at,
                source_type=supply.source_type,
            )
            self._sources_by_material.setdefault(supply.material_id, []).append(source)
            self._supply_by_material.setdefault(supply.material_id, []).append(
                (supply.available_at, float(supply.quantity))
            )
        for material_id in self._supply_by_material:
            self._supply_by_material[material_id].sort(key=lambda item: item[0])
        for material_id in self._sources_by_material:
            self._sources_by_material[material_id].sort(
                key=lambda item: (item.available_at, item.id)
            )

    def assess(
        self,
        *,
        requirements: list[MaterialRequirement],
        work_order_quantity: int,
        not_before: datetime,
        horizon_end: datetime,
    ) -> MaterialAssessment:
        if not requirements:
            return MaterialAssessment(
                ready_at=not_before,
                blocking_material_id=None,
                need_by_material={},
                ready_times={},
            )

        need_by_material = {
            req.material_id: req.required_quantity(work_order_quantity)
            for req in requirements
        }
        ready_times: dict[str, datetime] = {}
        latest_ready = not_before

        for material_id, quantity in need_by_material.items():
            ready_at = self._earliest_ready_time(
                material_id=material_id,
                quantity=quantity,
                not_before=not_before,
                horizon_end=horizon_end,
            )
            if ready_at is None:
                return MaterialAssessment(
                    ready_at=None,
                    blocking_material_id=material_id,
                    need_by_material=need_by_material,
                    ready_times=ready_times,
                )
            ready_times[material_id] = ready_at
            if ready_at > latest_ready:
                latest_ready = ready_at

        return MaterialAssessment(
            ready_at=latest_ready,
            blocking_material_id=None,
            need_by_material=need_by_material,
            ready_times=ready_times,
        )

    def reserve(
        self,
        *,
        operation_id: str,
        requirements: list[MaterialRequirement],
        work_order_quantity: int,
        required_at: datetime,
        reservation_origin: str = "scheduled",
    ) -> list[MaterialReservation]:
        created: list[MaterialReservation] = []
        for req in requirements:
            quantity = req.required_quantity(work_order_quantity)
            if quantity <= 0:
                continue
            reservation = MaterialReservation(
                operation_id=operation_id,
                material_id=req.material_id,
                quantity=quantity,
                required_at=required_at,
                reservation_origin=reservation_origin,
            )
            self._reservations.setdefault(req.material_id, []).append(reservation)
            self._reservations[req.material_id].sort(key=lambda item: item.required_at)
            created.append(reservation)
        return created

    def build_reservation_trace(self) -> list[dict[str, object]]:
        trace: list[dict[str, object]] = []
        for material_id, reservations in self._reservations.items():
            consumed_by_source: dict[str, float] = {}
            sources = self._sources_by_material.get(material_id, [])
            for reservation in sorted(
                reservations,
                key=lambda item: (item.required_at, item.operation_id),
            ):
                remaining = reservation.quantity
                allocations: list[dict[str, object]] = []
                for source in sources:
                    if source.available_at > reservation.required_at:
                        continue
                    available = source.quantity - consumed_by_source.get(source.id, 0.0)
                    if available <= 0:
                        continue
                    allocated = min(available, remaining)
                    if allocated <= 0:
                        continue
                    consumed_by_source[source.id] = (
                        consumed_by_source.get(source.id, 0.0) + allocated
                    )
                    allocations.append(
                        {
                            "source_id": source.id,
                            "source_type": source.source_type,
                            "quantity": allocated,
                            "available_at": source.available_at.isoformat(),
                        }
                    )
                    remaining -= allocated
                    if remaining <= 1e-9:
                        break
                trace.append(
                    {
                        "operation_id": reservation.operation_id,
                        "material_id": reservation.material_id,
                        "quantity": reservation.quantity,
                        "required_at": reservation.required_at.isoformat(),
                        "source": reservation.reservation_origin,
                        "allocations": allocations,
                        "uncovered_quantity": max(0.0, remaining),
                    }
                )
        trace.sort(key=lambda item: (str(item["required_at"]), str(item["operation_id"])))
        return trace

    def _earliest_ready_time(
        self,
        *,
        material_id: str,
        quantity: float,
        not_before: datetime,
        horizon_end: datetime,
    ) -> datetime | None:
        candidate_times = {not_before}
        for when, _qty in self._supply_by_material.get(material_id, []):
            if when <= horizon_end:
                candidate_times.add(max(when, self._horizon_start))

        for candidate in sorted(candidate_times):
            if candidate < not_before:
                continue
            available = self._available_quantity(material_id=material_id, at=candidate)
            if available >= quantity:
                return candidate
        return None

    def _available_quantity(self, *, material_id: str, at: datetime) -> float:
        supplied = sum(
            quantity
            for when, quantity in self._supply_by_material.get(material_id, [])
            if when <= at
        )
        reserved = sum(
            reservation.quantity
            for reservation in self._reservations.get(material_id, [])
            if reservation.required_at <= at
        )
        return supplied - reserved
