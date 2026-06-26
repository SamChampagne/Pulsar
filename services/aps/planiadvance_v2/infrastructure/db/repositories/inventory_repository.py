"""SQL-backed :class:`InventoryRepository` adapter."""

from __future__ import annotations

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from ....domain.entities import InventoryItem
from ...scoping import ScopedRepositoryMixin
from ..models import InventoryItemModel


class SqlInventoryRepository(ScopedRepositoryMixin[InventoryItem]):
    def __init__(self, session: Session) -> None:
        self._session = session

    def list_all(self) -> list[InventoryItem]:
        rows = self._session.execute(select(InventoryItemModel)).scalars().all()
        return [self._to_domain(row) for row in rows]

    def list_for_organization(self, organization_id: str) -> list[InventoryItem]:
        rows = self._session.execute(
            select(InventoryItemModel).where(
                InventoryItemModel.organization_id == organization_id
            )
        ).scalars().all()
        return [self._to_domain(row) for row in rows]

    def list_for_scope(
        self,
        *,
        organization_id: str | None = None,
        workspace_id: str | None = None,
    ) -> list[InventoryItem]:
        stmt = select(InventoryItemModel)
        if organization_id is not None:
            stmt = stmt.where(InventoryItemModel.organization_id == organization_id)
        if workspace_id is not None:
            stmt = stmt.where(InventoryItemModel.workspace_id == workspace_id)
        rows = self._session.execute(stmt).scalars().all()
        return [self._to_domain(row) for row in rows]

    def get(self, material_id: str) -> InventoryItem | None:
        row = self._session.get(InventoryItemModel, material_id)
        return self._to_domain(row) if row is not None else None

    def add(self, item: InventoryItem) -> None:
        self._session.merge(
            InventoryItemModel(
                material_id=item.material_id,
                quantity_on_hand=item.quantity_on_hand,
                as_of=item.as_of,
                organization_id=item.organization_id,
                workspace_id=item.workspace_id,
            )
        )

    def delete(self, material_id: str) -> None:
        self._session.execute(
            delete(InventoryItemModel).where(
                InventoryItemModel.material_id == material_id
            )
        )

    @staticmethod
    def _to_domain(row: InventoryItemModel) -> InventoryItem:
        return InventoryItem(
            material_id=row.material_id,
            quantity_on_hand=row.quantity_on_hand,
            as_of=row.as_of,
            organization_id=row.organization_id,
            workspace_id=row.workspace_id,
        )
