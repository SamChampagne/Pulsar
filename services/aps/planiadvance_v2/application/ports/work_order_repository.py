"""Port: work order persistence."""

from __future__ import annotations

from typing import Protocol

from ...domain.entities import WorkOrder


class WorkOrderRepository(Protocol):
    def list_all(self) -> list[WorkOrder]: ...
    def list_for_organization(self, organization_id: str) -> list[WorkOrder]: ...
    def list_for_scope(
        self,
        *,
        organization_id: str | None = None,
        workspace_id: str | None = None,
    ) -> list[WorkOrder]: ...
    def get(self, work_order_id: str) -> WorkOrder | None: ...
    def add(self, work_order: WorkOrder) -> None: ...
    def delete(self, work_order_id: str) -> None: ...
