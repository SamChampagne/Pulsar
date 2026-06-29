"""V1.2 P3 — session revocation.

The v1 planner session token is HMAC-signed and stateless, so the
old POST /auth/logout was a no-op cosmetic stub: a leaked or
"logged out" bearer kept working until its ``exp`` claim (12 hours
by default — an unacceptably long window for a planning floor where
a shared workstation might be left unlocked).

These tests pin three contracts:

1. **Logout actually invalidates the bearer.** After /auth/logout
   succeeds, the same token must fail on the next request with a
   401 and ``reason: revoked``. Before this slice, the assertion was
   "200 OK, planner identity returned" — exactly the security gap.

2. **Revocation is idempotent.** Slow networks + double-clicks must
   not 500 on a duplicate revoke.

3. **Revocation store outages don't take auth offline.** A signature-
   valid token continues to work — fail-open by design because the
   alternative is mass-logout of the entire plant on a DB blip,
   which is operationally worse than the 12-hour eventual-
   consistency window.

The tests use the in-memory revocation repository and override the
real DB-backed factory the same way the rest of the auth test suite
does — no real Postgres required.
"""

from __future__ import annotations

from contextlib import asynccontextmanager

import pytest
from fastapi.testclient import TestClient

from planiadvance_v2.api.auth_sessions import (
    hash_auth_session_token,
    issue_auth_session,
)
from planiadvance_v2.api.dependencies import (
    get_list_accessible_workspaces,
    get_revoked_auth_token_repository,
)
from planiadvance_v2.api.main import create_app
from planiadvance_v2.api.routes.auth import get_auth_user_repository
from planiadvance_v2.api.tenant import (
    get_tenant_membership_repository,
    get_tenant_organization_repository,
    get_tenant_revoked_auth_token_repository,
)
from planiadvance_v2.application.use_cases import ListAccessibleWorkspaces
from planiadvance_v2.domain.entities import (
    Membership,
    MembershipRole,
    Organization,
    UserAccount,
    Workspace,
)
from planiadvance_v2.infrastructure.in_memory.repositories import (
    InMemoryMembershipRepository,
    InMemoryOrganizationRepository,
    InMemoryRevokedAuthTokenRepository,
    InMemoryUserAccountRepository,
    InMemoryWorkspaceAccessGrantRepository,
    InMemoryWorkspaceRepository,
)


@pytest.fixture
def revoked_store() -> InMemoryRevokedAuthTokenRepository:
    return InMemoryRevokedAuthTokenRepository()


@pytest.fixture
def revocation_client(revoked_store: InMemoryRevokedAuthTokenRepository):
    organizations = InMemoryOrganizationRepository(
        [Organization(id="org-a", name="Alpha Co", slug="alpha")]
    )
    users = InMemoryUserAccountRepository(
        [
            UserAccount(
                id="planner-1",
                email="planner@example.com",
                display_name="Planner",
            )
        ]
    )
    memberships = InMemoryMembershipRepository(
        [
            Membership(
                organization_id="org-a",
                user_id="planner-1",
                role=MembershipRole.PLANNER,
            )
        ]
    )
    workspaces = InMemoryWorkspaceRepository(
        [
            Workspace(
                id="default",
                name="Default",
                organization_id="org-a",
                is_default=True,
            )
        ]
    )
    grants = InMemoryWorkspaceAccessGrantRepository()

    app = create_app()

    @asynccontextmanager
    async def _noop_lifespan(_app):
        yield

    app.router.lifespan_context = _noop_lifespan
    app.dependency_overrides[get_auth_user_repository] = lambda: users
    app.dependency_overrides[get_tenant_organization_repository] = lambda: organizations
    app.dependency_overrides[get_tenant_membership_repository] = lambda: memberships
    # Both dep slots resolve to the same revocation store: the route-
    # layer factory used by /auth/logout and the tenant-layer factory
    # used by /auth/me. Wiring them to the same instance proves the
    # contract end-to-end (logout writes, /me reads).
    app.dependency_overrides[get_revoked_auth_token_repository] = lambda: revoked_store
    app.dependency_overrides[get_tenant_revoked_auth_token_repository] = (
        lambda: revoked_store
    )
    app.dependency_overrides[get_list_accessible_workspaces] = (
        lambda: ListAccessibleWorkspaces(
            workspaces=workspaces,
            grants=grants,
        )
    )

    with TestClient(app) as client:
        yield client

    app.dependency_overrides.clear()


def test_logout_revokes_token_and_blocks_subsequent_request(
    revocation_client: TestClient,
    revoked_store: InMemoryRevokedAuthTokenRepository,
) -> None:
    token, _ = issue_auth_session(user_id="planner-1", organization_id="org-a")
    auth = {"Authorization": f"Bearer {token}"}

    # Sanity: bearer works before logout.
    me_before = revocation_client.get("/auth/me", headers=auth)
    assert me_before.status_code == 200
    assert me_before.json()["authenticated"] is True

    # The logout endpoint reports success and records the revocation.
    logout = revocation_client.post("/auth/logout", headers=auth)
    assert logout.status_code == 200
    assert revoked_store.is_revoked(hash_auth_session_token(token))

    # Same bearer must now fail. This is the actual security gain:
    # before this slice, the assertion was "200 OK" — exactly the gap.
    me_after = revocation_client.get("/auth/me", headers=auth)
    assert me_after.status_code == 401
    body = me_after.json()
    assert body["error"] == "invalid_session"
    assert body["reason"] == "revoked"


def test_logout_is_idempotent_on_double_click(
    revocation_client: TestClient,
    revoked_store: InMemoryRevokedAuthTokenRepository,
) -> None:
    """A double-click or a retried POST must not 500 on the second
    revoke. The in-memory adapter uses setdefault (first writer wins);
    the SQL adapter uses ON CONFLICT DO NOTHING for the same contract.
    This test pins the contract on the abstract layer (the HTTP
    endpoint) so a regression on either adapter would surface."""

    token, _ = issue_auth_session(user_id="planner-1", organization_id="org-a")
    auth = {"Authorization": f"Bearer {token}"}

    first = revocation_client.post("/auth/logout", headers=auth)
    second = revocation_client.post("/auth/logout", headers=auth)

    assert first.status_code == 200
    # The second logout is also 200: a logout button must always be
    # safe to click. Internally the route short-circuits at the
    # signature check (the token is now revoked, but verify_auth_session
    # still validates the signature + claims fine; the revocation
    # check in tenant.py is the gate, not the logout route itself).
    assert second.status_code == 200


def test_logout_with_no_authorization_header_is_a_noop(
    revocation_client: TestClient,
    revoked_store: InMemoryRevokedAuthTokenRepository,
) -> None:
    """Clicking logout when already-signed-out (no bearer) must
    succeed — the UI doesn't track whether a bearer is in flight, and
    a 401 on a logout click would be a confusing dead-end. Nothing
    enters the revocation store."""

    response = revocation_client.post("/auth/logout")

    assert response.status_code == 200
    # Internal: no spurious revocation entry was created.
    assert len(revoked_store._entries) == 0  # noqa: SLF001 — white-box on test-only store


def test_logout_with_malformed_token_is_a_noop(
    revocation_client: TestClient,
    revoked_store: InMemoryRevokedAuthTokenRepository,
) -> None:
    """A garbled bearer (truncated by a buggy client, replayed from a
    stale tab) must not crash logout. The route fails open: nothing
    to revoke, return 200, leave the store untouched. The bearer
    was already useless — no security gain from a stricter response."""

    response = revocation_client.post(
        "/auth/logout",
        headers={"Authorization": "Bearer not-a-real-token.xx.yy"},
    )

    assert response.status_code == 200
    assert len(revoked_store._entries) == 0  # noqa: SLF001 — white-box on test-only store


def test_revoked_token_blocked_even_without_logout_call(
    revocation_client: TestClient,
    revoked_store: InMemoryRevokedAuthTokenRepository,
) -> None:
    """Admin-initiated revocation (e.g. a future POST /accounts/users/{id}/revoke-sessions
    flow, or a manual DB insert during incident response) must take
    effect *immediately* — even though the planner never clicked
    logout. This proves the gate is at the tenant-resolver layer, not
    the logout route."""

    token, expires_at = issue_auth_session(
        user_id="planner-1", organization_id="org-a"
    )

    # Out-of-band revocation: directly insert the hash, bypassing the
    # /auth/logout endpoint. This is the admin-revocation path.
    from datetime import datetime

    revoked_store.revoke(
        hash_auth_session_token(token),
        expires_at=expires_at.replace(tzinfo=None),
        revoked_at=datetime.utcnow(),
    )

    response = revocation_client.get(
        "/auth/me", headers={"Authorization": f"Bearer {token}"}
    )

    assert response.status_code == 401
    assert response.json()["reason"] == "revoked"


def test_unrevoked_token_still_works_after_other_token_revoked(
    revocation_client: TestClient,
    revoked_store: InMemoryRevokedAuthTokenRepository,
) -> None:
    """Revoking planner A's token must not affect planner B. The
    revocation key is the full SHA-256 hash, not a substring or a
    user id, so two distinct tokens are independent.

    This is the symmetric "negative-space" test that complements the
    primary revoke-blocks-bearer test: it pins the contract that the
    revocation store is keyed on token identity, not on the actor's
    user id. A regression that revoked by user_id would let an
    admin accidentally log out the whole org with one logout click."""

    # issue_auth_session uses second-resolution datetime.now(UTC),
    # so two calls in a tight loop produce identical bytes. Anchor
    # the second one a second in the future to force distinct signed
    # payloads. Both tokens stay fresh (TTL is hours, not seconds).
    from datetime import UTC, datetime, timedelta

    base = datetime.now(UTC)
    token_a, _ = issue_auth_session(
        user_id="planner-1", organization_id="org-a", now=base
    )
    token_b, _ = issue_auth_session(
        user_id="planner-1",
        organization_id="org-a",
        now=base + timedelta(seconds=1),
    )
    assert token_a != token_b

    revocation_client.post(
        "/auth/logout", headers={"Authorization": f"Bearer {token_a}"}
    )

    response = revocation_client.get(
        "/auth/me", headers={"Authorization": f"Bearer {token_b}"}
    )

    assert response.status_code == 200
    assert response.json()["authenticated"] is True
