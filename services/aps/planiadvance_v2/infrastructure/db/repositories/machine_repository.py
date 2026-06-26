"""SQL-backed :class:`MachineRepository` adapter."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from ....domain.entities import Machine
from ....domain.value_objects import SetupMatrix, TimeWindow
from ...scoping import ScopedRepositoryMixin
from ..models import MachineModel


class SqlMachineRepository(ScopedRepositoryMixin[Machine]):
    def __init__(self, session: Session) -> None:
        self._session = session

    def list_all(self) -> list[Machine]:
        rows = self._session.execute(select(MachineModel)).scalars().all()
        return [self._to_domain(r) for r in rows]

    def list_for_organization(self, organization_id: str) -> list[Machine]:
        stmt = select(MachineModel).where(
            MachineModel.organization_id == organization_id
        )
        rows = self._session.execute(stmt).scalars().all()
        return [self._to_domain(r) for r in rows]

    def list_for_scope(
        self,
        *,
        organization_id: str | None = None,
        workspace_id: str | None = None,
    ) -> list[Machine]:
        stmt = select(MachineModel)
        if organization_id is not None:
            stmt = stmt.where(MachineModel.organization_id == organization_id)
        if workspace_id is not None:
            stmt = stmt.where(MachineModel.workspace_id == workspace_id)
        rows = self._session.execute(stmt).scalars().all()
        return [self._to_domain(r) for r in rows]

    def get(self, machine_id: str) -> Machine | None:
        row = self._session.get(MachineModel, machine_id)
        return self._to_domain(row) if row else None

    def add(self, machine: Machine) -> None:
        row = MachineModel(
            id=machine.id,
            name=machine.name,
            calendar_id=machine.calendar_id,
            efficiency=machine.efficiency,
            capabilities=list(machine.capabilities),
            organization_id=machine.organization_id,
            workspace_id=machine.workspace_id,
            setup_matrix_json=self._setup_matrix_to_json(machine.setup_matrix),
            maintenance_windows_json=self._maintenance_to_json(
                machine.maintenance_windows
            ),
        )
        self._session.merge(row)

    def delete(self, machine_id: str) -> None:
        self._session.execute(
            delete(MachineModel).where(MachineModel.id == machine_id)
        )

    # ---- serialization helpers ----

    @staticmethod
    def _setup_matrix_to_json(matrix: SetupMatrix | None) -> dict | None:
        if matrix is None:
            return None
        return {
            "default_minutes": matrix.default_minutes,
            "initial_minutes": matrix.initial_minutes,
            "transitions": [
                {"from": src, "to": dst, "minutes": mins}
                for (src, dst), mins in matrix.transitions.items()
            ],
        }

    @staticmethod
    def _setup_matrix_from_json(
        machine_id: str, data: dict | None
    ) -> SetupMatrix | None:
        if data is None:
            return None
        transitions = {
            (t["from"], t["to"]): t["minutes"] for t in data.get("transitions", [])
        }
        return SetupMatrix(
            machine_id=machine_id,
            default_minutes=data.get("default_minutes", 0),
            initial_minutes=data.get("initial_minutes", 0),
            transitions=transitions,
        )

    @staticmethod
    def _maintenance_to_json(windows: list[TimeWindow]) -> list | None:
        if not windows:
            return None
        return [
            {"start": w.start.isoformat(), "end": w.end.isoformat()} for w in windows
        ]

    @staticmethod
    def _maintenance_from_json(data: list | None) -> list[TimeWindow]:
        if not data:
            return []
        return [
            TimeWindow(
                start=datetime.fromisoformat(w["start"]),
                end=datetime.fromisoformat(w["end"]),
            )
            for w in data
        ]

    @classmethod
    def _to_domain(cls, row: MachineModel) -> Machine:
        return Machine(
            id=row.id,
            name=row.name,
            calendar_id=row.calendar_id,
            capabilities=list(row.capabilities or []),
            efficiency=row.efficiency,
            setup_matrix=cls._setup_matrix_from_json(row.id, row.setup_matrix_json),
            maintenance_windows=cls._maintenance_from_json(
                row.maintenance_windows_json
            ),
            organization_id=row.organization_id,
            workspace_id=row.workspace_id,
        )
