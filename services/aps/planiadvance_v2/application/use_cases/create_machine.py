"""Use case: create a new machine."""

from __future__ import annotations

from dataclasses import dataclass, field

from ...domain.entities import Machine
from ...domain.value_objects import SetupMatrix, TimeWindow
from ..ports import MachineRepository


@dataclass(slots=True)
class CreateMachineInput:
    id: str
    name: str
    calendar_id: str
    capabilities: list[str] = field(default_factory=list)
    efficiency: float = 1.0
    setup_matrix: SetupMatrix | None = None
    maintenance_windows: list[TimeWindow] = field(default_factory=list)
    organization_id: str | None = None
    workspace_id: str | None = None


class CreateMachine:
    def __init__(self, repository: MachineRepository) -> None:
        self._repository = repository

    def execute(self, command: CreateMachineInput) -> Machine:
        machine = Machine(
            id=command.id,
            name=command.name,
            calendar_id=command.calendar_id,
            capabilities=list(command.capabilities),
            efficiency=command.efficiency,
            setup_matrix=command.setup_matrix,
            maintenance_windows=list(command.maintenance_windows),
            organization_id=command.organization_id,
            workspace_id=command.workspace_id,
        )
        self._repository.add(machine)
        return machine
