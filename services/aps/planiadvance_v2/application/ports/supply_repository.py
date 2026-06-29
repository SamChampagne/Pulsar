"""Port: supply-lot persistence."""

from __future__ import annotations

from typing import Protocol

from ...domain.entities import SupplyLot


class SupplyRepository(Protocol):
    def list_all(self) -> list[SupplyLot]: ...
    def list_for_organization(self, organization_id: str) -> list[SupplyLot]: ...
    def list_for_scope(
        self,
        *,
        organization_id: str | None = None,
        workspace_id: str | None = None,
    ) -> list[SupplyLot]: ...
    def get(self, supply_id: str) -> SupplyLot | None: ...
    def add(self, lot: SupplyLot) -> None: ...
    def delete(self, supply_id: str) -> None: ...
