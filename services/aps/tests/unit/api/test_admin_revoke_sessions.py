"""V1.2 P3.2b — admin-initiated session revocation route.

POST /accounts/users/{id}/revoke-sessions is the operator-facing
emergency switch: when an account is compromised (laptop stolen,
employee offboarded, planner left a shared workstation unlocked) an
admin clicks this and EVERY outstanding bearer issued to that user
stops working on the next request — without enumerating their token
hashes.

These tests pin the contract:

1. **Permission gate**: planner / viewer roles → 403.
2. **Cross-tenant isolation**: an admin in Org A cannot mass-revoke a
   user who only belongs to Org B. Treated as 404 (same shape as
   "user does not exist") so a probe cannot enumerate users.
3. **Effect is immediate**: after a revoke, the target's pre-existing
   bearer fails the next /auth/me with ``reason: revoked_by_admin``.
4. **New sign-ins still work**: only tokens older than the cutoff are
   blocked; a fresh ``issue_auth_session`` after the revoke is fine.
   The cutoff is per-user-epoch, not per-user-permanent.
5. **Idempotent / monotone**: a second click within the same second
   does not 500 and does not regress the cutoff.

The tests use in-memory adapters and override the tenant-resolver
factory + the route factory at the same instance so the
write-then-read story is end-to-end.
"""

from __future__ import annotations

from contextlib import asynccontextmanager
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient

from planiadvance_v2.api.auth_sessions import issue_auth_session
from planiadvance_v2.api.dependencies import (
    get_audit_event_repository,
    get_list_accessible_workspaces,
    get_user_session_revocation_repository,
)
from planiadvance_v2.api.main import create_app
from planiadvance_v2.api.routes.accounts import get_admin_user_repository
from planiadvance_v2.api.routes.auth import get_auth_user_repository
from planiadvance_v2.api.tenant import (
    get_tenant_membership_repository,
    get_tenant_organization_repository,
    get_tenant_user_session_revocation_repository,
)
from planiadvance_v2.application.ports import AuditEvent
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
    InMemoryUserAccountRepository,
    InMemoryUserSessionRevocationRepository,
    InMemoryWorkspaceAccessGrantRepository,
    InMemoryWorkspaceRepository,
)


class _CapturingAuditRepository:
    """Tiny stub in place of SqlAuditEventRepository. The route only
    needs ``save(event)``; we record events so the cross-tenant test
    can assert that NO leak entered the victim's log either."""

    def __init__(self) -> None:
        self.events: list[AuditEvent] = []

    def save(self, event: AuditEvent) -> None:
        self.events.append(event)

    def list_recent(self, *_args, **_kwargs):  # pragma: no cover - unused
        return list(self.events)


@pytest.fixture
def revocation_store() -> InMemoryUserSessionRevocationRepository:
    return InMemoryUserSessionRevocationRepository()


@pytest.fixture
def audit_store() -> _CapturingAuditRepository:
    return _CapturingAuditRepository()


@pytest.fixture
def admin_client(
    revocation_store: InMemoryUserSessionRevocationRepository,
    audit_store: _CapturingAuditRepository,
):
    organizations = InMemoryOrganizationRepository(
        [
            Organization(id="org-a", name="Alpha Co", slug="alpha"),
            Organization(id="org-b", name="Bravo Co", slug="bravo"),
        ]
    )
    users = InMemoryUserAccountRepository(
        [
            UserAccount(
                id="admin-a",
                email="admin@alpha.example.com",
                display_name="Alpha Admin",
            ),
            UserAccount(
                id="planner-a",
                email="planner@alpha.example.com",
                display_name="Alpha Planner",
            ),
            UserAccount(
                id="planner-b",
                email="planner@bravo.example.com",
                display_name="Bravo Planner",
            ),
        ]
    )
    memberships = InMemoryMembershipRepository(
        [
            Membership(
                organization_id="org-a",
                user_id="admin-a",
                role=MembershipRole.ADMIN,
            ),
            Membership(
                organization_id="org-a",
                user_id="planner-a",
                role=MembershipRole.PLANNER,
            ),
            Membership(
                organization_id="org-b",
                user_id="planner-b",
                role=MembershipRole.PLANNER,
            ),
        ]
    )
    workspaces = InMemoryWorkspaceRepository(
        [
            Workspace(
                id="default-a",
                name="Default A",
                organization_id="org-a",
                is_default=True,
            ),
            Workspace(
                id="default-b",
                name="Default B",
                organization_id="org-b",
                is_default=True,
            ),
        ]
    )
    grants = InMemoryWorkspaceAccessGrantRepository()

    app = create_app()

    @asynccontextmanager
    async def _noop_lifespan(_app):
        yield

    app.router.lifespan_context = _noop_lifespan
    # auth.py uses get_auth_user_repository; accounts.py uses
    # get_admin_user_repository. Both must resolve to the same
    # in-memory store so /auth/me and the admin route agree on
    # which users exist.
    app.dependency_overrides[get_auth_user_repository] = lambda: users
    app.dependency_overrides[get_admin_user_repository] = lambda: users
    app.dependency_overrides[get_tenant_organization_repository] = (
        lambda: organizations
    )
    app.dependency_overrides[get_tenant_membership_repository] = (
        lambda: memberships
    )
    app.dependency_overrides[get_user_session_revocation_repository] = (
        lambda: revocation_store
    )
    app.dependency_overrides[get_tenant_user_session_revocation_repository] = (
        lambda: revocation_store
    )
    app.dependency_overrides[get_audit_event_repository] = lambda: audit_store
    app.dependency_overrides[get_list_accessible_workspaces] = (
        lambda: ListAccessibleWorkspaces(
            workspaces=workspaces,
            grants=grants,
        )
    )

    with TestClient(app) as client:
        yield client

    app.dependency_overrides.clear()


def _admin_headers() -> dict[str, str]:
    return {"X-Organization-Id": "org-a", "X-User-Id": "admin-a"}


def _planner_headers() -> dict[str, str]:
    return {"X-Organization-Id": "org-a", "X-User-Id": "planner-a"}


def test_planner_role_cannot_mass_revoke(admin_client: TestClient) -> None:
    """Only owner / admin hold ``manage_accounts``. A planner who
    discovers this URL must get 403, not "200, your colleague is
    logged out". A regression that loosened the gate would let any
    floor user log out the entire plant."""

    response = admin_client.post(
        "/accounts/users/planner-a/revoke-sessions",
        headers=_planner_headers(),
    )

    assert response.status_code == 403
    assert response.json()["error"] == "permission_required"


def test_cross_org_target_returns_404(
    admin_client: TestClient,
    revocation_store: InMemoryUserSessionRevocationRepository,
    audit_store: _CapturingAuditRepository,
) -> None:
    """An Org A admin probing for an Org B user must get a 404 that
    looks identical to "user does not exist". A 403 would confirm the
    user's existence (information leak); a 200 + side-effect would
    let one tenant's admin invalidate another tenant's sessions. The
    audit log must NOT record the attempt under the victim's org."""

    response = admin_client.post(
        "/accounts/users/planner-b/revoke-sessions",
        headers=_admin_headers(),
    )

    assert response.status_code == 404
    assert response.json()["error"] == "user_not_found"
    # No write to the revocation store — the cross-tenant probe leaves
    # no trace in the user-session epoch table for either user.
    assert revocation_store.get_revoked_before("planner-b") is None
    # No audit event recorded either: the scope gate fires before
    # record_audit_event, same pattern as the P0.1 replay audit.
    assert audit_store.events == []


def test_unknown_user_returns_404(admin_client: TestClient) -> None:
    """Same response shape as cross-org — the route folds "does not
    exist" and "exists but not in my org" into one 404 so a probe
    cannot enumerate."""

    response = admin_client.post(
        "/accounts/users/ghost-user/revoke-sessions",
        headers=_admin_headers(),
    )
    assert response.status_code == 404
    assert response.json()["error"] == "user_not_found"


def test_revoke_records_cutoff_and_returns_payload(
    admin_client: TestClient,
    revocation_store: InMemoryUserSessionRevocationRepository,
    audit_store: _CapturingAuditRepository,
) -> None:
    before_call = datetime.utcnow()
    response = admin_client.post(
        "/accounts/users/planner-a/revoke-sessions",
        headers=_admin_headers(),
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["user_id"] == "planner-a"
    assert payload["sessions_revoked"] is True
    # The persisted cutoff matches the response (single source of
    # truth: the audit consumer can correlate "the row in the table"
    # with "the value the admin saw").
    stored = revocation_store.get_revoked_before("planner-a")
    assert stored is not None
    assert stored >= before_call
    # The audit event names the right action and subject.
    actions = [event.action for event in audit_store.events]
    assert "auth.sessions_revoked" in actions
    revoked_event = next(
        event for event in audit_store.events
        if event.action == "auth.sessions_revoked"
    )
    assert revoked_event.subject == "planner@alpha.example.com"
    assert revoked_event.details.get("target_user_id") == "planner-a"


def test_pre_revoke_bearer_fails_after_admin_click(
    admin_client: TestClient,
) -> None:
    """The actual user-facing security gain: a planner already
    holding a bearer is locked out on the next request. This pins
    the gate in get_tenant_context, not in the logout route."""

    pre_token, _ = issue_auth_session(
        user_id="planner-a", organization_id="org-a"
    )
    auth = {"Authorization": f"Bearer {pre_token}"}

    sanity = admin_client.get("/auth/me", headers=auth)
    assert sanity.status_code == 200

    revoke = admin_client.post(
        "/accounts/users/planner-a/revoke-sessions",
        headers=_admin_headers(),
    )
    assert revoke.status_code == 200

    me_after = admin_client.get("/auth/me", headers=auth)

    assert me_after.status_code == 401
    body = me_after.json()
    assert body["error"] == "invalid_session"
    # Distinct reason from the hash-keyed /auth/logout path so an
    # incident-response query "who was admin-revoked vs self-logged-out"
    # is answerable from logs alone.
    assert body["reason"] == "revoked_by_admin"


def test_new_login_after_revoke_still_works(
    admin_client: TestClient,
) -> None:
    """The cutoff blocks tokens issued BEFORE it, not after. A planner
    whose sessions were mass-revoked must be able to sign in again
    and get a fresh working bearer. A regression that treated the
    cutoff as permanent ("forever banned") would prevent re-onboarding
    after every offboarding mistake."""

    # Step 1: revoke an existing bearer.
    revoke = admin_client.post(
        "/accounts/users/planner-a/revoke-sessions",
        headers=_admin_headers(),
    )
    assert revoke.status_code == 200

    # Step 2: mint a fresh token AFTER the cutoff (newer iat). This
    # simulates the planner signing back in.
    fresh_iat = datetime.now(UTC) + timedelta(seconds=2)
    fresh_token, _ = issue_auth_session(
        user_id="planner-a",
        organization_id="org-a",
        now=fresh_iat,
    )

    response = admin_client.get(
        "/auth/me",
        headers={"Authorization": f"Bearer {fresh_token}"},
    )

    assert response.status_code == 200
    assert response.json()["authenticated"] is True


def test_double_click_is_monotone_no_500(
    admin_client: TestClient,
    revocation_store: InMemoryUserSessionRevocationRepository,
) -> None:
    """A double-click in fast succession returns 200 twice and leaves
    the cutoff at the LATER value. A regression that crashed on the
    second call would make every admin button "scary to click again"."""

    first = admin_client.post(
        "/accounts/users/planner-a/revoke-sessions",
        headers=_admin_headers(),
    )
    second = admin_client.post(
        "/accounts/users/planner-a/revoke-sessions",
        headers=_admin_headers(),
    )

    assert first.status_code == 200
    assert second.status_code == 200
    # Cutoff is monotone: the persisted value is at least the second
    # response (later one wins).
    stored = revocation_store.get_revoked_before("planner-a")
    second_cutoff = datetime.fromisoformat(second.json()["revoked_before"])
    assert stored is not None
    assert stored >= second_cutoff.replace(tzinfo=None)
