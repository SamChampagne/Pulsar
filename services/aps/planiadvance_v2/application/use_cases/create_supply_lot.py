"""Use case: create or replace an inbound supply lot."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from ...domain.entities import SupplyLot
from ..ports import SupplyRepository


@dataclass(slots=True)
class CreateSupplyLotInput:
    id: str
    material_id: str
    quantity: float
    available_at: datetime
    source_type: str = "supply"
    organization_id: str | None = None
    workspace_id: str | None = None


class CreateSupplyLot:
    def __init__(self, repository: SupplyRepository) -> None:
        self._repository = repository

    def execute(self, command: CreateSupplyLotInput) -> SupplyLot:
        lot = SupplyLot(
            id=command.id,
            material_id=command.material_id,
            quantity=command.quantity,
            available_at=command.available_at,
            source_type=command.source_type,
            organization_id=command.organization_id,
            workspace_id=command.workspace_id,
        )
        self._repository.add(lot)
        return lot
