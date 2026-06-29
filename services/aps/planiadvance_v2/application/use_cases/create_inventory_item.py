"""Use case: create or replace an inventory balance."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from ...domain.entities import InventoryItem
from ..ports import InventoryRepository


@dataclass(slots=True)
class CreateInventoryItemInput:
    material_id: str
    quantity_on_hand: float
    as_of: datetime | None = None
    organization_id: str | None = None
    workspace_id: str | None = None


class CreateInventoryItem:
    def __init__(self, repository: InventoryRepository) -> None:
        self._repository = repository

    def execute(self, command: CreateInventoryItemInput) -> InventoryItem:
        item = InventoryItem(
            material_id=command.material_id,
            quantity_on_hand=command.quantity_on_hand,
            as_of=command.as_of,
            organization_id=command.organization_id,
            workspace_id=command.workspace_id,
        )
        self._repository.add(item)
        return item
