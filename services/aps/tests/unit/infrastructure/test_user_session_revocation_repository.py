"""V1.2 P3.2b — in-memory UserSessionRevocationRepository contract.

The HTTP test pins the end-to-end admin-revoke story; this file pins
the repository contract on its own. A future SQL or Redis
implementation must satisfy the same shape: default-allow on unknown
user, monotone updates (a later cutoff replaces an earlier one, an
EARLIER cutoff is a no-op), and purge-by-age semantics.
"""

from __future__ import annotations

from datetime import datetime, timedelta

from planiadvance_v2.infrastructure.in_memory.repositories import (
    InMemoryUserSessionRevocationRepository,
)


def test_get_revoked_before_returns_none_for_unknown_user() -> None:
    """Default-allow on unknown users. The cutoff store is an explicit
    deny list keyed by user_id; absence means "no admin click ever
    landed on this user" and every signature-valid token must work.
    A regression that returned a sentinel datetime here would mass-
    invalidate every planner."""

    repo = InMemoryUserSessionRevocationRepository()
    assert repo.get_revoked_before("never-revoked-user") is None


def test_revoke_user_sessions_records_cutoff() -> None:
    repo = InMemoryUserSessionRevocationRepository()
    cutoff = datetime(2026, 5, 22, 10, 0, 0)
    repo.revoke_user_sessions("planner-1", revoked_before_iat=cutoff, revoked_at=cutoff)

    assert repo.get_revoked_before("planner-1") == cutoff
    # Unrelated users stay unaffected. A regression that revoked
    # globally on any call would log out the entire org.
    assert repo.get_revoked_before("planner-2") is None


def test_revoke_user_sessions_is_monotone_under_double_click() -> None:
    """A double-click in fast succession lands the SECOND cutoff (latest
    wins). Re-submitting the SAME cutoff is a no-op. The contract holds
    for both adapters: Postgres via ON CONFLICT DO UPDATE WHERE
    new_iat > old_iat, in-memory via an explicit branch."""

    repo = InMemoryUserSessionRevocationRepository()
    first = datetime(2026, 5, 22, 10, 0, 0)
    second = first + timedelta(seconds=5)

    repo.revoke_user_sessions(
        "planner-1", revoked_before_iat=first, revoked_at=first
    )
    repo.revoke_user_sessions(
        "planner-1", revoked_before_iat=second, revoked_at=second
    )

    assert repo.get_revoked_before("planner-1") == second


def test_revoke_user_sessions_ignores_earlier_cutoff() -> None:
    """An out-of-order admin click — slow replay of a stale POST, or
    a buggy retry that uses an old timestamp — must NOT regress the
    cutoff. A regressing cutoff would re-grant sessions the admin
    already invalidated, which silently undoes a security action."""

    repo = InMemoryUserSessionRevocationRepository()
    later = datetime(2026, 5, 22, 10, 0, 0)
    earlier = later - timedelta(seconds=30)

    repo.revoke_user_sessions(
        "planner-1", revoked_before_iat=later, revoked_at=later
    )
    repo.revoke_user_sessions(
        "planner-1", revoked_before_iat=earlier, revoked_at=earlier
    )

    assert repo.get_revoked_before("planner-1") == later


def test_purge_obsolete_drops_cutoffs_older_than_session_ttl() -> None:
    """Once a cutoff is older than the longest possible token TTL,
    every token it would block already fails at the signature/expiry
    check. Removing the row is safe and keeps the table bounded. A
    fresh cutoff (still within the TTL window) must survive."""

    repo = InMemoryUserSessionRevocationRepository()
    base = datetime(2026, 5, 22, 10, 0, 0)
    repo.revoke_user_sessions(
        "stale-user",
        revoked_before_iat=base - timedelta(hours=24),
        revoked_at=base - timedelta(hours=24),
    )
    repo.revoke_user_sessions(
        "fresh-user",
        revoked_before_iat=base - timedelta(hours=2),
        revoked_at=base - timedelta(hours=2),
    )

    removed = repo.purge_obsolete(now=base, max_session_age=12)

    assert removed == 1
    assert repo.get_revoked_before("stale-user") is None
    assert repo.get_revoked_before("fresh-user") is not None
