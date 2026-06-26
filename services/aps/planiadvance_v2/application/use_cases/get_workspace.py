"""Use case: fetch a workspace by id."""

from __future__ import annotations

from ...domain.entities import Workspace
from ..ports import WorkspaceRepository


class GetWorkspace:
    def __init__(self, repository: WorkspaceRepository) -> None:
        self._repository = repository

    def execute(self, workspace_id: str) -> Workspace | None:
        return self._repository.get(workspace_id)
