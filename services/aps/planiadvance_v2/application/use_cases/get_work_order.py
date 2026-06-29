"""Use case: fetch a work order by id."""

from __future__ import annotations

from ...domain.entities import WorkOrder
from ..ports import WorkOrderRepository


class GetWorkOrder:
    def __init__(self, repository: WorkOrderRepository) -> None:
        self._repository = repository

    def execute(self, work_order_id: str) -> WorkOrder | None:
        return self._repository.get(work_order_id)


class DeleteWorkOrder:
    def __init__(self, repository: WorkOrderRepository) -> None:
        self._repository = repository

    def execute(self, work_order_id: str) -> bool:
        if self._repository.get(work_order_id) is None:
            return False
        self._repository.delete(work_order_id)
        return True
