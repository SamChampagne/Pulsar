from __future__ import annotations

from datetime import datetime

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from ....application.ports import IntegrationApiClient
from ...scoping import ScopedRepositoryMixin
from ..models import IntegrationApiClientModel


class SqlIntegrationApiClientRepository(ScopedRepositoryMixin[IntegrationApiClient]):
    def __init__(self, session: Session) -> None:
        self._session = session

    def save(self, client: IntegrationApiClient) -> IntegrationApiClient:
        now = datetime.utcnow()
        row = IntegrationApiClientModel(
            id=client.id,
            organization_id=client.organization_id,
            workspace_id=client.workspace_id,
            name=client.name,
            source_system=client.source_system,
            key_prefix=client.key_prefix,
            key_hash=client.key_hash,
            scopes=list(client.scopes),
            is_active=client.is_active,
            created_by_user_id=client.created_by_user_id,
            expires_at=client.expires_at,
            last_used_at=client.last_used_at,
            created_at=client.created_at,
            updated_at=now,
        )
        merged = self._session.merge(row)
        self._session.flush()
        return self._to_port(merged)

    def get(
        self,
        client_id: str,
        *,
        organization_id: str | None = None,
    ) -> IntegrationApiClient | None:
        stmt = select(IntegrationApiClientModel).where(
            IntegrationApiClientModel.id == client_id
        )
        if organization_id is not None:
            stmt = stmt.where(
                IntegrationApiClientModel.organization_id == organization_id
            )
        row = self._session.execute(stmt).scalar_one_or_none()
        return self._to_port(row) if row else None

    def find_active_by_key_hash(
        self,
        key_hash: str,
        *,
        now: datetime,
    ) -> IntegrationApiClient | None:
        stmt = (
            select(IntegrationApiClientModel)
            .where(IntegrationApiClientModel.key_hash == key_hash)
            .where(IntegrationApiClientModel.is_active.is_(True))
            .where(
                or_(
                    IntegrationApiClientModel.expires_at.is_(None),
                    IntegrationApiClientModel.expires_at > now,
                )
            )
        )
        row = self._session.execute(stmt).scalar_one_or_none()
        return self._to_port(row) if row else None

    def has_active_clients(
        self,
        *,
        now: datetime,
    ) -> bool:
        stmt = (
            select(IntegrationApiClientModel.id)
            .where(IntegrationApiClientModel.is_active.is_(True))
            .where(
                or_(
                    IntegrationApiClientModel.expires_at.is_(None),
                    IntegrationApiClientModel.expires_at > now,
                )
            )
            .limit(1)
        )
        return self._session.execute(stmt).first() is not None

    def has_clients(self) -> bool:
        stmt = select(IntegrationApiClientModel.id).limit(1)
        return self._session.execute(stmt).first() is not None

    def list_for_scope(
        self,
        *,
        organization_id: str | None = None,
        workspace_id: str | None = None,
        limit: int = 50,
    ) -> list[IntegrationApiClient]:
        stmt = select(IntegrationApiClientModel).order_by(
            IntegrationApiClientModel.created_at.desc()
        )
        if organization_id is not None:
            stmt = stmt.where(
                IntegrationApiClientModel.organization_id == organization_id
            )
        if workspace_id is not None:
            stmt = stmt.where(IntegrationApiClientModel.workspace_id == workspace_id)
        rows = self._session.execute(stmt.limit(limit)).scalars().all()
        return [self._to_port(row) for row in rows]

    def mark_used(
        self,
        client_id: str,
        *,
        used_at: datetime,
    ) -> IntegrationApiClient | None:
        client = self.get(client_id)
        if client is None:
            return None
        client.last_used_at = used_at
        client.updated_at = used_at
        return self.save(client)

    @staticmethod
    def _to_port(row: IntegrationApiClientModel) -> IntegrationApiClient:
        return IntegrationApiClient(
            id=row.id,
            organization_id=row.organization_id,
            workspace_id=row.workspace_id,
            name=row.name,
            source_system=row.source_system,
            key_prefix=row.key_prefix,
            key_hash=row.key_hash,
            scopes=tuple(row.scopes or ()),
            is_active=row.is_active,
            created_by_user_id=row.created_by_user_id,
            expires_at=row.expires_at,
            last_used_at=row.last_used_at,
            created_at=row.created_at,
            updated_at=row.updated_at,
        )
