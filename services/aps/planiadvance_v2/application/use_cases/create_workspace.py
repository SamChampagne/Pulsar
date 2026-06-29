"""Use case: create a workspace."""

from __future__ import annotations

from dataclasses import dataclass

from ...domain.entities import Workspace
from ..ports import WorkspaceRepository


@dataclass(slots=True)
class CreateWorkspaceInput:
    id: str
    name: str
    description: str = ""
    organization_id: str | None = None
    is_default: bool = False
    is_active: bool = True
    plant_timezone: str = "UTC"


class CreateWorkspace:
    def __init__(self, repository: WorkspaceRepository) -> None:
        self._repository = repository

    def execute(self, command: CreateWorkspaceInput) -> Workspace:
        workspace = Workspace(
            id=command.id,
            name=command.name,
            description=command.description,
            organization_id=command.organization_id,
            is_default=command.is_default,
            is_active=command.is_active,
            plant_timezone=command.plant_timezone,
        )
        self._repository.add(workspace)
        return workspace
