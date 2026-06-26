from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from ....application.ports.integration_journal_repository import IntegrationJournalEntry
from ..models import IntegrationJournalModel


class SqlIntegrationJournalRepository:
    def __init__(self, session: Session) -> None:
        self._session = session

    def save(self, entry: IntegrationJournalEntry) -> None:
        self._session.add(
            IntegrationJournalModel(
                id=entry.id,
                action=entry.action,
                source_system=entry.source_system,
                status=entry.status,
                valid=entry.valid,
                organization_id=entry.organization_id,
                workspace_id=entry.workspace_id,
                error_count=entry.error_count,
                warning_count=entry.warning_count,
                entity_counts=dict(entry.entity_counts),
                details=dict(entry.details),
                created_at=entry.created_at,
            )
        )

    def list_recent(
        self,
        limit: int = 20,
        *,
        source_system: str | None = None,
        action: str | None = None,
        organization_id: str | None = None,
        workspace_id: str | None = None,
    ) -> list[IntegrationJournalEntry]:
        stmt = select(IntegrationJournalModel).order_by(
            IntegrationJournalModel.created_at.desc()
        )
        if source_system is not None:
            stmt = stmt.where(IntegrationJournalModel.source_system == source_system)
        if action is not None:
            stmt = stmt.where(IntegrationJournalModel.action == action)
        if organization_id is not None:
            stmt = stmt.where(IntegrationJournalModel.organization_id == organization_id)
        if workspace_id is not None:
            stmt = stmt.where(IntegrationJournalModel.workspace_id == workspace_id)
        rows = self._session.execute(stmt.limit(limit)).scalars().all()
        return [
            IntegrationJournalEntry(
                id=row.id,
                action=row.action,
                source_system=row.source_system,
                status=row.status,
                valid=row.valid,
                organization_id=row.organization_id,
                workspace_id=row.workspace_id,
                error_count=row.error_count,
                warning_count=row.warning_count,
                entity_counts=dict(row.entity_counts or {}),
                details=dict(row.details or {}),
                created_at=row.created_at,
            )
            for row in rows
        ]
