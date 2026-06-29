from __future__ import annotations

from datetime import datetime

from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from ..models import RevokedAuthTokenModel


class SqlRevokedAuthTokenRepository:
    """Persistent revocation list for v1 planner session tokens.

    On Postgres, ``revoke`` uses ON CONFLICT DO NOTHING so a planner
    that clicks "Logout" twice (slow network + double-click) doesn't
    trip an integrity error. The first revocation wins; the second is
    a no-op.

    On SQLite (test envs), the same idempotency is achieved by a
    SELECT-then-INSERT race we accept — tests are single-threaded so
    the race window is empty.
    """

    def __init__(self, session: Session) -> None:
        self._session = session

    def is_revoked(self, token_hash: str) -> bool:
        stmt = select(RevokedAuthTokenModel.token_hash).where(
            RevokedAuthTokenModel.token_hash == token_hash
        )
        return self._session.execute(stmt).first() is not None

    def revoke(
        self,
        token_hash: str,
        *,
        expires_at: datetime,
        revoked_at: datetime,
    ) -> None:
        dialect = self._session.bind.dialect.name if self._session.bind else ""
        if dialect == "postgresql":
            stmt = (
                pg_insert(RevokedAuthTokenModel)
                .values(
                    token_hash=token_hash,
                    expires_at=expires_at,
                    revoked_at=revoked_at,
                )
                .on_conflict_do_nothing(index_elements=["token_hash"])
            )
            self._session.execute(stmt)
            return

        existing = self._session.get(RevokedAuthTokenModel, token_hash)
        if existing is not None:
            return
        self._session.add(
            RevokedAuthTokenModel(
                token_hash=token_hash,
                expires_at=expires_at,
                revoked_at=revoked_at,
            )
        )

    def purge_expired(self, *, now: datetime) -> int:
        stmt = delete(RevokedAuthTokenModel).where(
            RevokedAuthTokenModel.expires_at <= now
        )
        result = self._session.execute(stmt)
        return int(result.rowcount or 0)
