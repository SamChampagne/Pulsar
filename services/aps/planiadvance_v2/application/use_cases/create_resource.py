"""Use case: create a new secondary resource."""

from __future__ import annotations

from dataclasses import dataclass, field

from ...domain.entities import Resource
from ..ports import ResourceRepository


@dataclass(slots=True)
class CreateResourceInput:
    id: str
    name: str
    capacity: int
    calendar_id: str | None = None
    tags: list[str] = field(default_factory=list)
    organization_id: str | None = None
    workspace_id: str | None = None


class CreateResource:
    def __init__(self, repository: ResourceRepository) -> None:
        self._repository = repository

    def execute(self, command: CreateResourceInput) -> Resource:
        resource = Resource(
            id=command.id,
            name=command.name,
            capacity=command.capacity,
            calendar_id=command.calendar_id,
            tags=list(command.tags),
            organization_id=command.organization_id,
            workspace_id=command.workspace_id,
        )
        self._repository.add(resource)
        return resource
