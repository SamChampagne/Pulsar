"""HTTP proof tests for the MVP auth/session context."""

from __future__ import annotations

from contextlib import asynccontextmanager

import pytest
from fastapi.testclient import TestClient

from planiadvance_v2.api.auth_sessions import issue_auth_session
from planiadvance_v2.api.dependencies import get_list_accessible_workspaces
from planiadvance_v2.api.main import create_app
from planiadvance_v2.api.routes.auth import get_auth_user_repository
from planiadvance_v2.api.tenant import (
    get_tenant_membership_repository,
    get_tenant_organization_repository,
)
from planiadvance_v2.application.use_cases import ListAccessibleWorkspaces
from planiadvance_v2.domain.entities import (
    Membership,
    MembershipRole,
    Organization,
    UserAccount,
    Workspace,
    WorkspaceAccessGrant,
)
from planiadvance_v2.infrastructure.in_memory.repositories import (
    InMemoryMembershipRepository,
    InMemoryOrganizationRepository,
    InMemoryUserAccountRepository,
    InMemoryWorkspaceAccessGrantRepository,
    InMemoryWorkspaceRepository,
)


@pytest.fixture
def auth_client():
    organizations = InMemoryOrganizationRepository(
        [
            Organization(id="org-a", name="Alpha Co", slug="alpha"),
            Organization(id="org-b", name="Beta Co", slug="beta"),
        ]
    )
    users = InMemoryUserAccountRepository(
        [UserAccount(id="planner-1", email="planner@example.com", display_name="Planner")]
    )
    memberships = InMemoryMembershipRepository(
        [
            Membership(
                organization_id="org-a",
                user_id="planner-1",
                role=MembershipRole.PLANNER,
            ),
            Membership(
                organization_id="org-b",
                user_id="planner-1",
                role=MembershipRole.VIEWER,
            ),
        ]
    )
    workspaces = InMemoryWorkspaceRepository(
        [
            Workspace(
                id="default",
                name="Default",
                organization_id="org-a",
                is_default=True,
            ),
            Workspace(
                id="plant-2",
                name="Plant 2",
                organization_id="org-a",
            ),
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
    app.dependency_overrides[get_list_accessible_workspaces] = (
        lambda: ListAccessibleWorkspaces(
            workspaces=workspaces,
            grants=grants,
        )
    )

    with TestClient(app) as client:
        yield client

    app.dependency_overrides.clear()


def test_auth_me_without_headers_is_anonymous(auth_client: TestClient) -> None:
    response = auth_client.get("/auth/me")

    assert response.status_code == 200
    assert response.json()["authenticated"] is False
    assert response.json()["auth_mode"] == "anonymous"


def test_login_directory_lists_active_users_and_memberships(auth_client: TestClient) -> None:
    response = auth_client.get("/auth/login-directory")

    assert response.status_code == 200
    body = response.json()
    assert [user["id"] for user in body["users"]] == ["planner-1"]
    assert {membership["organization_id"] for membership in body["memberships"]} == {
        "org-a",
        "org-b",
    }


def test_login_builds_company_user_context_and_session(auth_client: TestClient) -> None:
    response = auth_client.post(
        "/auth/login",
        json={"email": "planner@example.com", "organization_id": "org-a"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["authenticated"] is True
    assert body["auth_mode"] == "session"
    assert body["user"]["id"] == "planner-1"
    assert body["active_organization"]["id"] == "org-a"
    assert body["active_membership"]["role"] == "planner"
    assert "run_scheduling" in body["permissions"]
    assert body["memberships"][0]["organization"]["id"] == "org-a"
    assert body["session_token"]
    assert body["session_expires_at"]


def test_auth_me_accepts_bearer_session(auth_client: TestClient) -> None:
    token, _ = issue_auth_session(user_id="planner-1", organization_id="org-a")
    response = auth_client.get(
        "/auth/me",
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["authenticated"] is True
    assert body["auth_mode"] == "session"
    assert body["active_organization"]["id"] == "org-a"
    assert body["session_token"] is None


def test_switch_organization_recomputes_permissions_and_rotates_session(
    auth_client: TestClient,
) -> None:
    token, _ = issue_auth_session(user_id="planner-1", organization_id="org-a")
    response = auth_client.post(
        "/auth/switch-organization",
        headers={"Authorization": f"Bearer {token}"},
        json={"organization_id": "org-b"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["auth_mode"] == "session"
    assert body["active_organization"]["id"] == "org-b"
    assert body["active_membership"]["role"] == "viewer"
    assert body["permissions"] == ["view_data", "view_plans", "view_reports"]
    assert body["session_token"]


def test_login_only_returns_granted_workspaces_when_scope_exists(auth_client: TestClient) -> None:
    organizations = InMemoryOrganizationRepository(
        [
            Organization(id="org-a", name="Alpha Co", slug="alpha"),
        ]
    )
    users = InMemoryUserAccountRepository(
        [UserAccount(id="planner-1", email="planner@example.com", display_name="Planner")]
    )
    memberships = InMemoryMembershipRepository(
        [
            Membership(
                organization_id="org-a",
                user_id="planner-1",
                role=MembershipRole.PLANNER,
            ),
        ]
    )
    workspaces = InMemoryWorkspaceRepository(
        [
            Workspace(id="default", name="Default", organization_id="org-a", is_default=True),
            Workspace(id="plant-2", name="Plant 2", organization_id="org-a"),
        ]
    )
    grants = InMemoryWorkspaceAccessGrantRepository(
        [
            WorkspaceAccessGrant(
                organization_id="org-a",
                workspace_id="plant-2",
                user_id="planner-1",
            )
        ]
    )

    app = create_app()

    @asynccontextmanager
    async def _noop_lifespan(_app):
        yield

    app.router.lifespan_context = _noop_lifespan
    app.dependency_overrides[get_auth_user_repository] = lambda: users
    app.dependency_overrides[get_tenant_organization_repository] = lambda: organizations
    app.dependency_overrides[get_tenant_membership_repository] = lambda: memberships
    app.dependency_overrides[get_list_accessible_workspaces] = (
        lambda: ListAccessibleWorkspaces(workspaces=workspaces, grants=grants)
    )

    with TestClient(app) as client:
        response = client.post("/auth/login", json={"user_id": "planner-1"})

    app.dependency_overrides.clear()

    assert response.status_code == 200
    body = response.json()
    assert body["memberships"][0]["organization"]["id"] == "org-a"
    assert [workspace["id"] for workspace in body["memberships"][0]["workspaces"]] == ["plant-2"]
