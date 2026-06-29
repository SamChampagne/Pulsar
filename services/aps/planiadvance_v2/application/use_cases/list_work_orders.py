"""Use case: list work orders, optionally scoped to an organization/workspace."""

from __future__ import annotations

from ...domain.entities import WorkOrder
from ..ports import WorkOrderRepository


class ListWorkOrders:
    def __init__(self, repository: WorkOrderRepository) -> None:
        self._repository = repository

    def execute(
        self,
        organization_id: str | None = None,
        workspace_id: str | None = None,
    ) -> list[WorkOrder]:
        if organization_id is None and workspace_id is None:
            return self._repository.list_all()
        return self._repository.list_for_scope(
            organization_id=organization_id,
            workspace_id=workspace_id,
        )
