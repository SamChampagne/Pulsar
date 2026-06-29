"""Helpers for loading repository data inside an optional tenant context."""

from __future__ import annotations

from typing import Any, Protocol, TypeVar

T = TypeVar("T")


class OrganizationScopedRepository(Protocol[T]):
    def list_all(self) -> list[T]: ...
    def list_for_organization(self, organization_id: str) -> list[T]: ...
    def list_for_scope(
        self,
        *,
        organization_id: str | None = None,
        workspace_id: str | None = None,
    ) -> list[T]: ...


def list_scoped(
    repository: OrganizationScopedRepository[T],
    organization_id: str | None,
    workspace_id: str | None = None,
) -> list[T]:
    """Return tenant/workspace-scoped rows when a tenant context is active."""

    if organization_id is None:
        return repository.list_all()
    return repository.list_for_scope(
        organization_id=organization_id,
        workspace_id=workspace_id,
    )


def data_workspace_id_from_metadata(metadata: Any) -> str | None:
    """Return the actual data workspace captured in a run snapshot.

    Older APIs expose ``workspace_id='default'`` as a run label. The scheduling
    input snapshot stores whether a workspace was truly used as a data scope.
    """

    if metadata is None:
        return None
    input_snapshot = getattr(metadata, "input_snapshot", {})
    if isinstance(input_snapshot, dict):
        snapshot_metadata = input_snapshot.get("metadata")
        if isinstance(snapshot_metadata, dict) and "workspace_id" in snapshot_metadata:
            value = snapshot_metadata.get("workspace_id")
            return value if isinstance(value, str) and value else None
    workspace_id = getattr(metadata, "workspace_id", None)
    return workspace_id if isinstance(workspace_id, str) and workspace_id else None
