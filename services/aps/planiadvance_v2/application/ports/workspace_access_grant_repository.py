"""Port: workspace-scoped access grants."""

from __future__ import annotations

from typing import Protocol

from ...domain.entities import WorkspaceAccessGrant


class WorkspaceAccessGrantRepository(Protocol):
    def list_for_organization(self, organization_id: str) -> list[WorkspaceAccessGrant]: ...
    def list_for_workspace(self, workspace_id: str) -> list[WorkspaceAccessGrant]: ...
    def list_for_user(
        self,
        user_id: str,
        *,
        organization_id: str | None = None,
    ) -> list[WorkspaceAccessGrant]: ...
    def get(self, workspace_id: str, user_id: str) -> WorkspaceAccessGrant | None: ...
    def add(self, grant: WorkspaceAccessGrant) -> None: ...
    def delete(self, workspace_id: str, user_id: str) -> None: ...
