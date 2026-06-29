from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from ....domain.entities import Workspace
from ..models import WorkspaceModel


class SqlWorkspaceRepository:
    def __init__(self, session: Session) -> None:
        self._session = session

    def list_all(self) -> list[Workspace]:
        rows = self._session.execute(
            select(WorkspaceModel).order_by(WorkspaceModel.is_default.desc(), WorkspaceModel.name)
        ).scalars().all()
        return [self._to_domain(row) for row in rows]

    def list_for_organization(self, organization_id: str) -> list[Workspace]:
        rows = self._session.execute(
            select(WorkspaceModel)
            .where(WorkspaceModel.organization_id == organization_id)
            .order_by(WorkspaceModel.is_default.desc(), WorkspaceModel.name)
        ).scalars().all()
        return [self._to_domain(row) for row in rows]

    def get(self, workspace_id: str) -> Workspace | None:
        row = self._session.get(WorkspaceModel, workspace_id)
        return self._to_domain(row) if row else None

    def add(self, workspace: Workspace) -> None:
        row = WorkspaceModel(
            id=workspace.id,
            name=workspace.name,
            description=workspace.description,
            organization_id=workspace.organization_id,
            is_default=workspace.is_default,
            is_active=workspace.is_active,
            plant_timezone=workspace.plant_timezone,
        )
        self._session.merge(row)

    @staticmethod
    def _to_domain(row: WorkspaceModel) -> Workspace:
        return Workspace(
            id=row.id,
            name=row.name,
            description=row.description,
            organization_id=row.organization_id,
            is_default=row.is_default,
            is_active=row.is_active,
            # Legacy rows persisted before the column existed read
            # back as None from older fixtures; coalesce to UTC so
            # construction never fails on a stale dataset.
            plant_timezone=row.plant_timezone or "UTC",
        )
