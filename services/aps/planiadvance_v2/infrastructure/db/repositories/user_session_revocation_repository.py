from __future__ import annotations

from datetime import datetime, timedelta

from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from ..models import UserSessionRevocationModel


class SqlUserSessionRevocationRepository:
    """Persistent per-user session-revocation cutoff.

    Stores a monotone ``revoked_before_iat`` per user_id. A token with
    ``iat`` strictly older than the cutoff is treated as revoked. New
    sign-ins (which mint a fresh ``iat``) work normally — the cutoff
    only invalidates tokens that existed BEFORE the admin click.

    Idempotency + monotonicity:

    - Postgres: ``ON CONFLICT (user_id) DO UPDATE`` with a ``WHERE`` guard
      so the cutoff only advances, never regresses. A second admin click
      that lands at the same wall clock is a no-op.
    - SQLite (tests): ``get`` + branch in Python, same monotone semantics.
    """

    def __init__(self, session: Session) -> None:
        self._session = session

    def get_revoked_before(self, user_id: str) -> datetime | None:
        stmt = select(UserSessionRevocationModel.revoked_before_iat).where(
            UserSessionRevocationModel.user_id == user_id
        )
        row = self._session.execute(stmt).first()
        return row[0] if row is not None else None

    def revoke_user_sessions(
        self,
        user_id: str,
        *,
        revoked_before_iat: datetime,
        revoked_at: datetime,
    ) -> None:
        dialect = self._session.bind.dialect.name if self._session.bind else ""
        if dialect == "postgresql":
            stmt = (
                pg_insert(UserSessionRevocationModel)
                .values(
                    user_id=user_id,
                    revoked_before_iat=revoked_before_iat,
                    revoked_at=revoked_at,
                )
                .on_conflict_do_update(
                    index_elements=["user_id"],
                    set_={
                        "revoked_before_iat": revoked_before_iat,
                        "revoked_at": revoked_at,
                    },
                    where=(
                        UserSessionRevocationModel.revoked_before_iat
                        < revoked_before_iat
                    ),
                )
            )
            self._session.execute(stmt)
            return

        existing = self._session.get(UserSessionRevocationModel, user_id)
        if existing is None:
            self._session.add(
                UserSessionRevocationModel(
                    user_id=user_id,
                    revoked_before_iat=revoked_before_iat,
                    revoked_at=revoked_at,
                )
            )
            return
        if existing.revoked_before_iat < revoked_before_iat:
            existing.revoked_before_iat = revoked_before_iat
            existing.revoked_at = revoked_at

    def purge_obsolete(
        self,
        *,
        now: datetime,
        max_session_age: int,
    ) -> int:
        threshold = now - timedelta(hours=max_session_age)
        stmt = delete(UserSessionRevocationModel).where(
            UserSessionRevocationModel.revoked_before_iat <= threshold
        )
        result = self._session.execute(stmt)
        return int(result.rowcount or 0)
