"""Port: user-keyed mass-revocation of planner session tokens.

The hash-keyed :class:`RevokedAuthTokenRepository` revokes a single
bearer that the caller already holds (e.g. /auth/logout). It cannot
revoke ALL of a user's outstanding tokens because the server never
stores them — v1 sessions are stateless HMAC-signed claims.

This port covers the admin-initiated case: when an account is
compromised (laptop stolen, employee offboarded, shared workstation
left logged in) an operator clicks "revoke all sessions" and EVERY
bearer issued to that user before the revocation timestamp must stop
working immediately, without enumerating their hashes.

Mechanism: store a per-user "revoked_before_iat" cutoff. The tenant
resolver consults the store after signature/expiry verification and
rejects a session whose signed ``iat`` claim is older than the cutoff.
Cutoffs are monotone (a newer revocation strictly invalidates more
than an older one), so the store keeps the latest only.
"""

from __future__ import annotations

from datetime import datetime
from typing import Protocol


class UserSessionRevocationRepository(Protocol):
    def get_revoked_before(self, user_id: str) -> datetime | None:
        """Return the cutoff above which tokens are revoked, or None.

        ``None`` means "no mass revocation has ever been recorded for
        this user" — every signature-valid token continues to work.

        Implementations MUST treat unknown users as ``None``
        (default-allow); only explicit revocation should block access.
        """

    def revoke_user_sessions(
        self,
        user_id: str,
        *,
        revoked_before_iat: datetime,
        revoked_at: datetime,
    ) -> None:
        """Set the cutoff for ``user_id``.

        Idempotent and monotone: re-recording with an EARLIER
        ``revoked_before_iat`` is a no-op. A second admin click that
        happens to land at the same wall clock as the first must
        produce the same effect as a single click.

        ``revoked_at`` is informational (audit trail / observability);
        the gate fires off ``revoked_before_iat`` alone.
        """

    def purge_obsolete(
        self,
        *,
        now: datetime,
        max_session_age: int,
    ) -> int:
        """Drop cutoffs whose effect is already covered by token expiry.

        Once ``now - revoked_before_iat`` exceeds the longest possible
        signed-token TTL, every token the cutoff would block would
        already fail the expiry gate. Removing the row is safe and
        keeps the table bounded.

        ``max_session_age`` is the TTL ceiling in hours. Returns the
        number of rows removed. Callers run this opportunistically.
        """
