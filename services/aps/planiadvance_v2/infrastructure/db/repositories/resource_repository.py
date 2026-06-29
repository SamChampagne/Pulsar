"""SQL-backed :class:`ResourceRepository` adapter."""

from __future__ import annotations

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from ....domain.entities import Resource
from ...scoping import ScopedRepositoryMixin
from ..models import ResourceModel


class SqlResourceRepository(ScopedRepositoryMixin[Resource]):
    def __init__(self, session: Session) -> None:
        self._session = session

    def list_all(self) -> list[Resource]:
        rows = self._session.execute(select(ResourceModel)).scalars().all()
        return [self._to_domain(r) for r in rows]

    def list_for_organization(self, organization_id: str) -> list[Resource]:
        rows = self._session.execute(
            select(ResourceModel).where(ResourceModel.organization_id == organization_id)
        ).scalars().all()
        return [self._to_domain(r) for r in rows]

    def list_for_scope(
        self,
        *,
        organization_id: str | None = None,
        workspace_id: str | None = None,
    ) -> list[Resource]:
        stmt = select(ResourceModel)
        if organization_id is not None:
            stmt = stmt.where(ResourceModel.organization_id == organization_id)
        if workspace_id is not None:
            stmt = stmt.where(ResourceModel.workspace_id == workspace_id)
        rows = self._session.execute(stmt).scalars().all()
        return [self._to_domain(r) for r in rows]

    def get(self, resource_id: str) -> Resource | None:
        row = self._session.get(ResourceModel, resource_id)
        return self._to_domain(row) if row else None

    def add(self, resource: Resource) -> None:
        row = ResourceModel(
            id=resource.id,
            name=resource.name,
            capacity=resource.capacity,
            calendar_id=resource.calendar_id,
            tags=list(resource.tags),
            organization_id=resource.organization_id,
            workspace_id=resource.workspace_id,
        )
        self._session.merge(row)

    def delete(self, resource_id: str) -> None:
        self._session.execute(
            delete(ResourceModel).where(ResourceModel.id == resource_id)
        )

    @staticmethod
    def _to_domain(row: ResourceModel) -> Resource:
        return Resource(
            id=row.id,
            name=row.name,
            capacity=row.capacity,
            calendar_id=row.calendar_id,
            tags=list(row.tags or []),
            organization_id=row.organization_id,
            workspace_id=row.workspace_id,
        )
