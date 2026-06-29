from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from ....application.ports import IntegrationExecutionRecord
from ..models import IntegrationExecutionModel


class SqlIntegrationExecutionRepository:
    def __init__(self, session: Session) -> None:
        self._session = session

    def save(
        self,
        record: IntegrationExecutionRecord,
    ) -> IntegrationExecutionRecord:
        self._session.add(
            IntegrationExecutionModel(
                id=record.id,
                organization_id=record.organization_id,
                workspace_id=record.workspace_id,
                execution_kind=record.execution_kind,
                target_type=record.target_type,
                target_id=record.target_id,
                target_name=record.target_name,
                source_system=record.source_system,
                status=record.status,
                valid=record.valid,
                trigger_type=record.trigger_type,
                actor_mode=record.actor_mode,
                actor_id=record.actor_id,
                correlation_id=record.correlation_id,
                attempt_number=record.attempt_number,
                message=record.message,
                error_code=record.error_code,
                entity_counts=dict(record.entity_counts),
                details=dict(record.details),
                journal_entry_id=record.journal_entry_id,
                started_at=record.started_at,
                finished_at=record.finished_at,
                duration_ms=record.duration_ms,
            )
        )
        return record

    def list_recent(
        self,
        limit: int = 50,
        *,
        organization_id: str | None = None,
        workspace_id: str | None = None,
        execution_kind: str | None = None,
        target_type: str | None = None,
        target_id: str | None = None,
        source_system: str | None = None,
        status: str | None = None,
    ) -> list[IntegrationExecutionRecord]:
        stmt = select(IntegrationExecutionModel).order_by(
            IntegrationExecutionModel.started_at.desc()
        )
        if organization_id is not None:
            stmt = stmt.where(
                IntegrationExecutionModel.organization_id == organization_id
            )
        if workspace_id is not None:
            stmt = stmt.where(IntegrationExecutionModel.workspace_id == workspace_id)
        if execution_kind is not None:
            stmt = stmt.where(
                IntegrationExecutionModel.execution_kind == execution_kind
            )
        if target_type is not None:
            stmt = stmt.where(IntegrationExecutionModel.target_type == target_type)
        if target_id is not None:
            stmt = stmt.where(IntegrationExecutionModel.target_id == target_id)
        if source_system is not None:
            stmt = stmt.where(IntegrationExecutionModel.source_system == source_system)
        if status is not None:
            stmt = stmt.where(IntegrationExecutionModel.status == status)
        rows = self._session.execute(stmt.limit(limit)).scalars().all()
        return [
            IntegrationExecutionRecord(
                id=row.id,
                organization_id=row.organization_id,
                workspace_id=row.workspace_id,
                execution_kind=row.execution_kind,
                target_type=row.target_type,
                target_id=row.target_id,
                target_name=row.target_name,
                source_system=row.source_system,
                status=row.status,
                valid=row.valid,
                trigger_type=row.trigger_type,
                actor_mode=row.actor_mode,
                actor_id=row.actor_id,
                correlation_id=row.correlation_id,
                attempt_number=row.attempt_number,
                message=row.message,
                error_code=row.error_code,
                entity_counts=dict(row.entity_counts or {}),
                details=dict(row.details or {}),
                journal_entry_id=row.journal_entry_id,
                started_at=row.started_at,
                finished_at=row.finished_at,
                duration_ms=row.duration_ms,
            )
            for row in rows
        ]
