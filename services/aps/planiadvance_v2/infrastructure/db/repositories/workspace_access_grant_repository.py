from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from ....domain.entities import WorkspaceAccessGrant
from ..models import WorkspaceAccessGrantModel


class SqlWorkspaceAccessGrantRepository:
    def __init__(self, session: Session) -> None:
        self._session = session

    def list_for_organization(self, organization_id: str) -> list[WorkspaceAccessGrant]:
        rows = self._session.execute(
            select(WorkspaceAccessGrantModel)
            .where(WorkspaceAccessGrantModel.organization_id == organization_id)
            .order_by(
                WorkspaceAccessGrantModel.workspace_id,
                WorkspaceAccessGrantModel.user_id,
            )
        ).scalars().all()
        return [self._to_domain(row) for row in rows]

    def list_for_workspace(self, workspace_id: str) -> list[WorkspaceAccessGrant]:
        rows = self._session.execute(
            select(WorkspaceAccessGrantModel)
            .where(WorkspaceAccessGrantModel.workspace_id == workspace_id)
            .order_by(WorkspaceAccessGrantModel.user_id)
        ).scalars().all()
        return [self._to_domain(row) for row in rows]

    def list_for_user(
        self,
        user_id: str,
        *,
        organization_id: str | None = None,
    ) -> list[WorkspaceAccessGrant]:
        stmt = select(WorkspaceAccessGrantModel).where(
            WorkspaceAccessGrantModel.user_id == user_id
        )
        if organization_id is not None:
            stmt = stmt.where(WorkspaceAccessGrantModel.organization_id == organization_id)
        rows = self._session.execute(
            stmt.order_by(
                WorkspaceAccessGrantModel.organization_id,
                WorkspaceAccessGrantModel.workspace_id,
            )
        ).scalars().all()
        return [self._to_domain(row) for row in rows]

    def get(self, workspace_id: str, user_id: str) -> WorkspaceAccessGrant | None:
        row = self._session.get(
            WorkspaceAccessGrantModel,
            {"workspace_id": workspace_id, "user_id": user_id},
        )
        return self._to_domain(row) if row else None

    def add(self, grant: WorkspaceAccessGrant) -> None:
        self._session.merge(
            WorkspaceAccessGrantModel(
                organization_id=grant.organization_id,
                workspace_id=grant.workspace_id,
                user_id=grant.user_id,
                is_active=grant.is_active,
            )
        )

    def delete(self, workspace_id: str, user_id: str) -> None:
        row = self._session.get(
            WorkspaceAccessGrantModel,
            {"workspace_id": workspace_id, "user_id": user_id},
        )
        if row is not None:
            self._session.delete(row)

    @staticmethod
    def _to_domain(row: WorkspaceAccessGrantModel) -> WorkspaceAccessGrant:
        return WorkspaceAccessGrant(
            organization_id=row.organization_id,
            workspace_id=row.workspace_id,
            user_id=row.user_id,
            is_active=row.is_active,
        )
