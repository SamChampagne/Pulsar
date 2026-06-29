"""V1.2 P3 — in-memory RevokedAuthTokenRepository contract.

The HTTP-layer revocation tests prove the end-to-end story; this
file pins the repository contract on its own. A future SQL or
Redis implementation must pass the same shape of test (idempotency,
purge semantics, default-allow on unknown hash).
"""

from __future__ import annotations

from datetime import datetime, timedelta

from planiadvance_v2.infrastructure.in_memory.repositories import (
    InMemoryRevokedAuthTokenRepository,
)


def test_is_revoked_returns_false_for_unknown_hash() -> None:
    """Default-allow on unknown hashes. The revocation list is an
    explicit deny list; absence means valid. A regression that
    returned True here would block every fresh login."""

    repo = InMemoryRevokedAuthTokenRepository()
    assert repo.is_revoked("never-revoked-hash") is False


def test_revoke_marks_token_as_revoked() -> None:
    repo = InMemoryRevokedAuthTokenRepository()
    now = datetime(2026, 5, 18, 10, 0, 0)
    repo.revoke("abc", expires_at=now + timedelta(hours=12), revoked_at=now)
    assert repo.is_revoked("abc") is True
    assert repo.is_revoked("def") is False


def test_revoke_is_idempotent() -> None:
    """Double-revoke must not raise. The SQL adapter uses ON CONFLICT
    DO NOTHING for the same contract; the in-memory adapter uses
    setdefault."""

    repo = InMemoryRevokedAuthTokenRepository()
    now = datetime(2026, 5, 18, 10, 0, 0)
    repo.revoke("abc", expires_at=now + timedelta(hours=12), revoked_at=now)
    repo.revoke(
        "abc",
        expires_at=now + timedelta(hours=24),
        revoked_at=now + timedelta(hours=1),
    )
    assert repo.is_revoked("abc") is True


def test_purge_expired_removes_only_past_entries() -> None:
    """The purge contract drops entries whose ``expires_at`` is past
    ``now`` — those tokens would already fail at the signature/expiry
    check, so keeping them in the revocation table is wasted storage.
    Tokens still within their TTL must survive a purge call."""

    repo = InMemoryRevokedAuthTokenRepository()
    base = datetime(2026, 5, 18, 10, 0, 0)
    # Already-expired (exp = an hour ago).
    repo.revoke(
        "stale",
        expires_at=base - timedelta(hours=1),
        revoked_at=base - timedelta(hours=2),
    )
    # Still fresh.
    repo.revoke(
        "fresh",
        expires_at=base + timedelta(hours=10),
        revoked_at=base,
    )

    removed = repo.purge_expired(now=base)

    assert removed == 1
    assert repo.is_revoked("stale") is False
    assert repo.is_revoked("fresh") is True
