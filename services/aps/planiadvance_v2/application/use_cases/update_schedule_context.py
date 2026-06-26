"""Use case: update the product context of a persisted schedule."""

from __future__ import annotations

from dataclasses import dataclass

from ...domain.errors import ValidationError
from ..ports import ScheduleRepository
from ..ports.schedule_repository import ScheduleRunMetadata


@dataclass(slots=True)
class UpdateScheduleContextInput:
    schedule_id: str
    workspace_id: str | None = None
    scenario_name: str | None = None
    lifecycle_status: str | None = None


class UpdateScheduleContext:
    def __init__(self, repository: ScheduleRepository) -> None:
        self._repository = repository

    def execute(self, command: UpdateScheduleContextInput) -> ScheduleRunMetadata:
        if (
            command.workspace_id is None
            and command.scenario_name is None
            and command.lifecycle_status is None
        ):
            raise ValidationError("At least one schedule context field must be updated")

        metadata = self._repository.update_context(
            command.schedule_id,
            workspace_id=command.workspace_id,
            scenario_name=command.scenario_name,
            lifecycle_status=command.lifecycle_status,
        )
        if metadata is None:
            raise ValidationError(f"Schedule {command.schedule_id!r} not found")
        return metadata
