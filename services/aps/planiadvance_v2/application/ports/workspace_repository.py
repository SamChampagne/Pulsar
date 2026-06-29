"""Port: workspace persistence."""

from __future__ import annotations

from typing import Protocol

from ...domain.entities import Workspace


class WorkspaceRepository(Protocol):
    def list_all(self) -> list[Workspace]: ...
    def list_for_organization(self, organization_id: str) -> list[Workspace]: ...
    def get(self, workspace_id: str) -> Workspace | None: ...
    def add(self, workspace: Workspace) -> None: ...
