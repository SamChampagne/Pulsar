"""Port: revocation list for signed planner session tokens.

The v1 session token is a stateless HMAC-signed claim (see
``api/auth_sessions.py``). On its own it cannot be invalidated before
its ``exp`` claim — a leaked or "logged out" token stays usable until
expiry. The audit flagged that as a real security gap: a planner
who clicks "log out" expects the token to stop working *immediately*,
not 12 hours later.

This port stores opaque token hashes (SHA-256) — never the raw token —
so a DB dump cannot be replayed to authenticate. ``expires_at`` is
copied from the token's signed ``exp`` claim so a periodic purge can
drop entries that would naturally fail signature/expiry verification
anyway.

Why hash, not raw token: standard credential-store hygiene. If the
revocation table is ever exfiltrated, the attacker still cannot
present a valid bearer — they would need the *raw* token, which the
DB never holds.
"""

from __future__ import annotations

from datetime import datetime
from typing import Protocol


class RevokedAuthTokenRepository(Protocol):
    def is_revoked(self, token_hash: str) -> bool:
        """Return True if the token hash has been recorded as revoked.

        Implementations MUST treat unknown hashes as not revoked
        (default-allow); only explicit revocation should block access.
        """

    def revoke(
        self,
        token_hash: str,
        *,
        expires_at: datetime,
        revoked_at: datetime,
    ) -> None:
        """Record a revocation. Idempotent — revoking twice is a no-op."""

    def purge_expired(self, *, now: datetime) -> int:
        """Drop entries whose ``expires_at`` is past ``now``.

        Returns the number of entries removed. Callers may run this
        opportunistically (every logout, or a periodic janitor task).
        """
