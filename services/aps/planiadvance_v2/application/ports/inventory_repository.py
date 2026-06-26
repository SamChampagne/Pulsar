"""Port: inventory persistence."""

from __future__ import annotations

from typing import Protocol

from ...domain.entities import InventoryItem


class InventoryRepository(Protocol):
    def list_all(self) -> list[InventoryItem]: ...
    def list_for_organization(self, organization_id: str) -> list[InventoryItem]: ...
    def list_for_scope(
        self,
        *,
        organization_id: str | None = None,
        workspace_id: str | None = None,
    ) -> list[InventoryItem]: ...
    def get(self, material_id: str) -> InventoryItem | None: ...
    def add(self, item: InventoryItem) -> None: ...
    def delete(self, material_id: str) -> None: ...
