"""SQL-backed :class:`SupplyRepository` adapter."""

from __future__ import annotations

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from ....domain.entities import SupplyLot
from ...scoping import ScopedRepositoryMixin
from ..models import SupplyLotModel


class SqlSupplyRepository(ScopedRepositoryMixin[SupplyLot]):
    def __init__(self, session: Session) -> None:
        self._session = session

    def list_all(self) -> list[SupplyLot]:
        rows = self._session.execute(select(SupplyLotModel)).scalars().all()
        return [self._to_domain(row) for row in rows]

    def list_for_organization(self, organization_id: str) -> list[SupplyLot]:
        rows = self._session.execute(
            select(SupplyLotModel).where(SupplyLotModel.organization_id == organization_id)
        ).scalars().all()
        return [self._to_domain(row) for row in rows]

    def list_for_scope(
        self,
        *,
        organization_id: str | None = None,
        workspace_id: str | None = None,
    ) -> list[SupplyLot]:
        stmt = select(SupplyLotModel)
        if organization_id is not None:
            stmt = stmt.where(SupplyLotModel.organization_id == organization_id)
        if workspace_id is not None:
            stmt = stmt.where(SupplyLotModel.workspace_id == workspace_id)
        rows = self._session.execute(stmt).scalars().all()
        return [self._to_domain(row) for row in rows]

    def get(self, supply_id: str) -> SupplyLot | None:
        row = self._session.get(SupplyLotModel, supply_id)
        return self._to_domain(row) if row is not None else None

    def add(self, lot: SupplyLot) -> None:
        self._session.merge(
            SupplyLotModel(
                id=lot.id,
                material_id=lot.material_id,
                quantity=lot.quantity,
                available_at=lot.available_at,
                source_type=lot.source_type,
                organization_id=lot.organization_id,
                workspace_id=lot.workspace_id,
            )
        )

    def delete(self, supply_id: str) -> None:
        self._session.execute(delete(SupplyLotModel).where(SupplyLotModel.id == supply_id))

    @staticmethod
    def _to_domain(row: SupplyLotModel) -> SupplyLot:
        return SupplyLot(
            id=row.id,
            material_id=row.material_id,
            quantity=row.quantity,
            available_at=row.available_at,
            source_type=row.source_type,
            organization_id=row.organization_id,
            workspace_id=row.workspace_id,
        )
