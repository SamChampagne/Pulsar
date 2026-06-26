"""Port: resource persistence."""

from __future__ import annotations

from typing import Protocol

from ...domain.entities import Resource


class ResourceRepository(Protocol):
    def list_all(self) -> list[Resource]: ...
    def list_for_organization(self, organization_id: str) -> list[Resource]: ...
    def list_for_scope(
        self,
        *,
        organization_id: str | None = None,
        workspace_id: str | None = None,
    ) -> list[Resource]: ...
    def get(self, resource_id: str) -> Resource | None: ...
    def add(self, resource: Resource) -> None: ...
    def delete(self, resource_id: str) -> None: ...
