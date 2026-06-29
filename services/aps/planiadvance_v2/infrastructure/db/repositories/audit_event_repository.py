from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from ....application.ports import AuditEvent
from ..models import AuditEventModel


class SqlAuditEventRepository:
    def __init__(self, session: Session) -> None:
        self._session = session

    def save(self, event: AuditEvent) -> None:
        self._session.add(
            AuditEventModel(
                id=event.id,
                action=event.action,
                status=event.status,
                organization_id=event.organization_id,
                workspace_id=event.workspace_id,
                user_id=event.user_id,
                ip_address=event.ip_address,
                subject=event.subject,
                details=dict(event.details),
                created_at=event.created_at,
            )
        )

    def list_recent(
        self,
        limit: int = 50,
        *,
        organization_id: str | None = None,
        workspace_id: str | None = None,
        action: str | None = None,
    ) -> list[AuditEvent]:
        stmt = select(AuditEventModel).order_by(AuditEventModel.created_at.desc())
        if organization_id is not None:
            stmt = stmt.where(AuditEventModel.organization_id == organization_id)
        if workspace_id is not None:
            stmt = stmt.where(AuditEventModel.workspace_id == workspace_id)
        if action is not None:
            stmt = stmt.where(AuditEventModel.action == action)
        rows = self._session.execute(stmt.limit(limit)).scalars().all()
        return [
            AuditEvent(
                id=row.id,
                action=row.action,
                status=row.status,
                organization_id=row.organization_id,
                workspace_id=row.workspace_id,
                user_id=row.user_id,
                ip_address=row.ip_address,
                subject=row.subject,
                details=dict(row.details or {}),
                created_at=row.created_at,
            )
            for row in rows
        ]
