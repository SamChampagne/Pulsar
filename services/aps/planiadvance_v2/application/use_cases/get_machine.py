"""Use case: fetch or delete a machine by id."""

from __future__ import annotations

from ...domain.entities import Machine
from ..ports import MachineRepository


class GetMachine:
    def __init__(self, repository: MachineRepository) -> None:
        self._repository = repository

    def execute(self, machine_id: str) -> Machine | None:
        return self._repository.get(machine_id)


class DeleteMachine:
    def __init__(self, repository: MachineRepository) -> None:
        self._repository = repository

    def execute(self, machine_id: str) -> bool:
        if self._repository.get(machine_id) is None:
            return False
        self._repository.delete(machine_id)
        return True
