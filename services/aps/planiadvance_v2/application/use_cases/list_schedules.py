"""Use case: list the most recent schedule runs with metadata."""

from __future__ import annotations

from ...domain.entities import Schedule
from ..ports import ScheduleRepository
from ..ports.schedule_repository import ScheduleRunMetadata


class ListSchedules:
    def __init__(self, repository: ScheduleRepository) -> None:
        self._repository = repository

    def execute(
        self,
        limit: int = 20,
        *,
        organization_id: str | None = None,
        workspace_id: str | None = None,
        lifecycle_status: str | None = None,
    ) -> list[tuple[Schedule, ScheduleRunMetadata]]:
        return self._repository.list_recent(
            limit=limit,
            organization_id=organization_id,
            workspace_id=workspace_id,
            lifecycle_status=lifecycle_status,
        )
