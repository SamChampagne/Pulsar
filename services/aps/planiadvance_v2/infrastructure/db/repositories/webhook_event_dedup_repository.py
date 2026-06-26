from __future__ import annotations

from datetime import datetime, timedelta

from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from ....application.ports.webhook_event_dedup_repository import (
    WebhookEventRecord,
)
from ..models import WebhookEventDedupModel


class SqlWebhookEventDedupRepository:
    """Persistent idempotency dedup for the public webhook ingress.

    First-writer wins:
    - Postgres uses ``ON CONFLICT DO NOTHING`` on the (token,
      idempotency_key) composite PK. Two simultaneous retries both
      attempt to insert; one wins, the other reads the winner's row
      on the next ``find``.
    - SQLite (test envs) uses a SELECT-then-INSERT path. Acceptable
      because tests are single-threaded; the race window is empty.
    """

    def __init__(self, session: Session) -> None:
        self._session = session

    def find(
        self, *, token: str, idempotency_key: str
    ) -> WebhookEventRecord | None:
        stmt = select(WebhookEventDedupModel).where(
            WebhookEventDedupModel.token == token,
            WebhookEventDedupModel.idempotency_key == idempotency_key,
        )
        row = self._session.execute(stmt).scalar_one_or_none()
        if row is None:
            return None
        return WebhookEventRecord(
            token=row.token,
            idempotency_key=row.idempotency_key,
            body_hash=row.body_hash,
            run_id=row.run_id,
            status=row.status,
            recorded_at=row.recorded_at,
        )

    def record(
        self,
        *,
        token: str,
        idempotency_key: str,
        body_hash: str,
        run_id: str | None,
        status: str,
        recorded_at: datetime,
    ) -> None:
        dialect = self._session.bind.dialect.name if self._session.bind else ""
        if dialect == "postgresql":
            stmt = (
                pg_insert(WebhookEventDedupModel)
                .values(
                    token=token,
                    idempotency_key=idempotency_key,
                    body_hash=body_hash,
                    run_id=run_id,
                    status=status,
                    recorded_at=recorded_at,
                )
                .on_conflict_do_nothing(
                    index_elements=["token", "idempotency_key"]
                )
            )
            self._session.execute(stmt)
            return

        existing = self._session.get(
            WebhookEventDedupModel, (token, idempotency_key)
        )
        if existing is not None:
            return
        self._session.add(
            WebhookEventDedupModel(
                token=token,
                idempotency_key=idempotency_key,
                body_hash=body_hash,
                run_id=run_id,
                status=status,
                recorded_at=recorded_at,
            )
        )

    def purge_expired(self, *, now: datetime, max_age_hours: int) -> int:
        threshold = now - timedelta(hours=max_age_hours)
        stmt = delete(WebhookEventDedupModel).where(
            WebhookEventDedupModel.recorded_at <= threshold
        )
        result = self._session.execute(stmt)
        return int(result.rowcount or 0)
