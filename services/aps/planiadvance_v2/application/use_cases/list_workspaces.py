"""Use case: list workspaces."""

from __future__ import annotations

from ..ports import WorkspaceRepository


class ListWorkspaces:
    def __init__(self, repository: WorkspaceRepository) -> None:
        self._repository = repository

    def execute(self, organization_id: str | None = None):
        if organization_id is None:
            return self._repository.list_all()
        return self._repository.list_for_organization(organization_id)
