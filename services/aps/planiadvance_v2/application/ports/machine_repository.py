"""Port: machine persistence."""

from __future__ import annotations

from typing import Protocol

from ...domain.entities import Machine


class MachineRepository(Protocol):
    def list_all(self) -> list[Machine]: ...
    def list_for_organization(self, organization_id: str) -> list[Machine]: ...
    def list_for_scope(
        self,
        *,
        organization_id: str | None = None,
        workspace_id: str | None = None,
    ) -> list[Machine]: ...
    def get(self, machine_id: str) -> Machine | None: ...
    def add(self, machine: Machine) -> None: ...
    def delete(self, machine_id: str) -> None: ...
