from __future__ import annotations

from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from ....application.ports import IntegrationCredential
from ...scoping import ScopedRepositoryMixin
from ..models import IntegrationCredentialModel


class SqlIntegrationCredentialRepository(ScopedRepositoryMixin[IntegrationCredential]):
    def __init__(self, session: Session) -> None:
        self._session = session

    def save(self, credential: IntegrationCredential) -> IntegrationCredential:
        now = datetime.utcnow()
        row = IntegrationCredentialModel(
            id=credential.id,
            organization_id=credential.organization_id,
            workspace_id=credential.workspace_id,
            name=credential.name,
            source_system=credential.source_system,
            auth_type=credential.auth_type,
            auth_header_name=credential.auth_header_name,
            username=credential.username,
            secret_ref=credential.secret_ref,
            is_enabled=credential.is_enabled,
            created_by_user_id=credential.created_by_user_id,
            created_at=credential.created_at,
            updated_at=now,
        )
        merged = self._session.merge(row)
        self._session.flush()
        return self._to_port(merged)

    def get(
        self,
        credential_id: str,
        *,
        organization_id: str | None = None,
    ) -> IntegrationCredential | None:
        stmt = select(IntegrationCredentialModel).where(
            IntegrationCredentialModel.id == credential_id
        )
        if organization_id is not None:
            stmt = stmt.where(IntegrationCredentialModel.organization_id == organization_id)
        row = self._session.execute(stmt).scalar_one_or_none()
        return self._to_port(row) if row else None

    def list_for_scope(
        self,
        *,
        organization_id: str | None = None,
        workspace_id: str | None = None,
        limit: int = 50,
    ) -> list[IntegrationCredential]:
        stmt = select(IntegrationCredentialModel).order_by(
            IntegrationCredentialModel.created_at.desc()
        )
        if organization_id is not None:
            stmt = stmt.where(IntegrationCredentialModel.organization_id == organization_id)
        if workspace_id is not None:
            stmt = stmt.where(IntegrationCredentialModel.workspace_id == workspace_id)
        rows = self._session.execute(stmt.limit(limit)).scalars().all()
        return [self._to_port(row) for row in rows]

    @staticmethod
    def _to_port(row: IntegrationCredentialModel) -> IntegrationCredential:
        return IntegrationCredential(
            id=row.id,
            organization_id=row.organization_id,
            workspace_id=row.workspace_id,
            name=row.name,
            source_system=row.source_system,
            auth_type=row.auth_type,
            auth_header_name=row.auth_header_name,
            username=row.username,
            secret_ref=row.secret_ref,
            is_enabled=row.is_enabled,
            created_by_user_id=row.created_by_user_id,
            created_at=row.created_at,
            updated_at=row.updated_at,
        )
