"""Use case: list machines, optionally scoped to an organization/workspace."""

from __future__ import annotations

from ...domain.entities import Machine
from ..ports import MachineRepository


class ListMachines:
    def __init__(self, repository: MachineRepository) -> None:
        self._repository = repository

    def execute(
        self,
        organization_id: str | None = None,
        workspace_id: str | None = None,
    ) -> list[Machine]:
        if organization_id is None and workspace_id is None:
            return self._repository.list_all()
        return self._repository.list_for_scope(
            organization_id=organization_id,
            workspace_id=workspace_id,
        )
