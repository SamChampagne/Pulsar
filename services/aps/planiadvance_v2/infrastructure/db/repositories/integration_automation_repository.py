from __future__ import annotations

from datetime import datetime

from sqlalchemy import or_, select, update
from sqlalchemy.orm import Session

from ....application.ports.integration_automation_repository import (
    IntegrationAutomationJob,
)
from ...scoping import ScopedRepositoryMixin
from ..models import IntegrationAutomationJobModel


class SqlIntegrationAutomationRepository(ScopedRepositoryMixin[IntegrationAutomationJob]):
    def __init__(self, session: Session) -> None:
        self._session = session

    def save(self, job: IntegrationAutomationJob) -> IntegrationAutomationJob:
        now = datetime.utcnow()
        row = IntegrationAutomationJobModel(
            id=job.id,
            organization_id=job.organization_id,
            workspace_id=job.workspace_id,
            name=job.name,
            direction=job.direction,
            trigger_type=job.trigger_type,
            source_system=job.source_system,
            is_enabled=job.is_enabled,
            config=dict(job.config),
            last_status=job.last_status,
            last_message=job.last_message,
            last_run_at=job.last_run_at,
            lock_owner=job.lock_owner,
            locked_until=job.locked_until,
            attempt_count=job.attempt_count,
            next_attempt_at=job.next_attempt_at,
            last_error_code=job.last_error_code,
            last_error_at=job.last_error_at,
            created_at=job.created_at,
            updated_at=now,
        )
        merged = self._session.merge(row)
        self._session.flush()
        return self._to_port(merged)

    def get(
        self,
        job_id: str,
        *,
        organization_id: str | None = None,
    ) -> IntegrationAutomationJob | None:
        stmt = select(IntegrationAutomationJobModel).where(
            IntegrationAutomationJobModel.id == job_id
        )
        if organization_id is not None:
            stmt = stmt.where(IntegrationAutomationJobModel.organization_id == organization_id)
        row = self._session.execute(stmt).scalar_one_or_none()
        return self._to_port(row) if row else None

    def list_for_scope(
        self,
        *,
        organization_id: str | None = None,
        workspace_id: str | None = None,
        limit: int = 50,
    ) -> list[IntegrationAutomationJob]:
        stmt = select(IntegrationAutomationJobModel).order_by(
            IntegrationAutomationJobModel.created_at.desc()
        )
        if organization_id is not None:
            stmt = stmt.where(IntegrationAutomationJobModel.organization_id == organization_id)
        if workspace_id is not None:
            stmt = stmt.where(IntegrationAutomationJobModel.workspace_id == workspace_id)
        rows = self._session.execute(stmt.limit(limit)).scalars().all()
        return [self._to_port(row) for row in rows]

    def try_claim(
        self,
        job_id: str,
        *,
        owner_id: str,
        locked_until: datetime,
        now: datetime,
        organization_id: str | None = None,
    ) -> IntegrationAutomationJob | None:
        stmt = (
            update(IntegrationAutomationJobModel)
            .where(IntegrationAutomationJobModel.id == job_id)
            .where(
                or_(
                    IntegrationAutomationJobModel.locked_until.is_(None),
                    IntegrationAutomationJobModel.locked_until <= now,
                )
            )
            .values(
                lock_owner=owner_id,
                locked_until=locked_until,
                updated_at=now,
            )
        )
        if organization_id is not None:
            stmt = stmt.where(IntegrationAutomationJobModel.organization_id == organization_id)
        result = self._session.execute(stmt)
        if result.rowcount != 1:
            return None
        self._session.flush()
        return self.get(job_id, organization_id=organization_id)

    def release_claim(
        self,
        job_id: str,
        *,
        owner_id: str,
        now: datetime,
        organization_id: str | None = None,
    ) -> IntegrationAutomationJob | None:
        stmt = (
            update(IntegrationAutomationJobModel)
            .where(IntegrationAutomationJobModel.id == job_id)
            .where(IntegrationAutomationJobModel.lock_owner == owner_id)
            .values(
                lock_owner=None,
                locked_until=None,
                updated_at=now,
            )
        )
        if organization_id is not None:
            stmt = stmt.where(IntegrationAutomationJobModel.organization_id == organization_id)
        result = self._session.execute(stmt)
        if result.rowcount != 1:
            return None
        self._session.flush()
        return self.get(job_id, organization_id=organization_id)

    @staticmethod
    def _to_port(row: IntegrationAutomationJobModel) -> IntegrationAutomationJob:
        return IntegrationAutomationJob(
            id=row.id,
            organization_id=row.organization_id,
            workspace_id=row.workspace_id,
            name=row.name,
            direction=row.direction,
            trigger_type=row.trigger_type,
            source_system=row.source_system,
            is_enabled=row.is_enabled,
            config=dict(row.config or {}),
            last_status=row.last_status,
            last_message=row.last_message,
            last_run_at=row.last_run_at,
            lock_owner=row.lock_owner,
            locked_until=row.locked_until,
            attempt_count=row.attempt_count or 0,
            next_attempt_at=row.next_attempt_at,
            last_error_code=row.last_error_code,
            last_error_at=row.last_error_at,
            created_at=row.created_at,
            updated_at=row.updated_at,
        )
