from __future__ import annotations

from datetime import datetime

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from ....application.ports import IntegrationConnector
from ...scoping import ScopedRepositoryMixin
from ..models import IntegrationConnectorModel


class SqlIntegrationConnectorRepository(ScopedRepositoryMixin[IntegrationConnector]):
    def __init__(self, session: Session) -> None:
        self._session = session

    def save(self, connector: IntegrationConnector) -> IntegrationConnector:
        now = datetime.utcnow()
        row = IntegrationConnectorModel(
            id=connector.id,
            organization_id=connector.organization_id,
            workspace_id=connector.workspace_id,
            name=connector.name,
            endpoint_url=connector.endpoint_url,
            source_system=connector.source_system,
            connector_type=connector.connector_type,
            method=connector.method,
            auth_type=connector.auth_type,
            auth_header_name=connector.auth_header_name,
            username=connector.username,
            secret_ref=connector.secret_ref,
            credential_id=connector.credential_id,
            static_headers=dict(connector.static_headers),
            timeout_seconds=connector.timeout_seconds,
            is_enabled=connector.is_enabled,
            created_by_user_id=connector.created_by_user_id,
            last_tested_at=connector.last_tested_at,
            last_test_status=connector.last_test_status,
            last_test_message=connector.last_test_message,
            created_at=connector.created_at,
            updated_at=now,
        )
        merged = self._session.merge(row)
        self._session.flush()
        return self._to_port(merged)

    def get(
        self,
        connector_id: str,
        *,
        organization_id: str | None = None,
    ) -> IntegrationConnector | None:
        stmt = select(IntegrationConnectorModel).where(
            IntegrationConnectorModel.id == connector_id
        )
        if organization_id is not None:
            stmt = stmt.where(IntegrationConnectorModel.organization_id == organization_id)
        row = self._session.execute(stmt).scalar_one_or_none()
        return self._to_port(row) if row else None

    def delete(
        self,
        connector_id: str,
        *,
        organization_id: str | None = None,
    ) -> bool:
        stmt = delete(IntegrationConnectorModel).where(
            IntegrationConnectorModel.id == connector_id
        )
        if organization_id is not None:
            stmt = stmt.where(IntegrationConnectorModel.organization_id == organization_id)
        result = self._session.execute(stmt)
        self._session.flush()
        return (result.rowcount or 0) > 0

    def list_for_scope(
        self,
        *,
        organization_id: str | None = None,
        workspace_id: str | None = None,
        limit: int = 50,
    ) -> list[IntegrationConnector]:
        stmt = select(IntegrationConnectorModel).order_by(
            IntegrationConnectorModel.created_at.desc()
        )
        if organization_id is not None:
            stmt = stmt.where(IntegrationConnectorModel.organization_id == organization_id)
        if workspace_id is not None:
            stmt = stmt.where(IntegrationConnectorModel.workspace_id == workspace_id)
        rows = self._session.execute(stmt.limit(limit)).scalars().all()
        return [self._to_port(row) for row in rows]

    @staticmethod
    def _to_port(row: IntegrationConnectorModel) -> IntegrationConnector:
        return IntegrationConnector(
            id=row.id,
            organization_id=row.organization_id,
            workspace_id=row.workspace_id,
            name=row.name,
            endpoint_url=row.endpoint_url,
            source_system=row.source_system,
            connector_type=row.connector_type,
            method=row.method,
            auth_type=row.auth_type,
            auth_header_name=row.auth_header_name,
            username=row.username,
            secret_ref=row.secret_ref,
            credential_id=row.credential_id,
            static_headers=dict(row.static_headers or {}),
            timeout_seconds=row.timeout_seconds,
            is_enabled=row.is_enabled,
            created_by_user_id=row.created_by_user_id,
            last_tested_at=row.last_tested_at,
            last_test_status=row.last_test_status,
            last_test_message=row.last_test_message,
            created_at=row.created_at,
            updated_at=row.updated_at,
        )
