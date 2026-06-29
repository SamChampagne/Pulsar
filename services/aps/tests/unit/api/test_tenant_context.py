from __future__ import annotations

from contextlib import asynccontextmanager

import pytest
from fastapi.testclient import TestClient

from planiadvance_v2.api.auth_sessions import issue_auth_session
from planiadvance_v2.api.dependencies import (
    get_create_workspace,
    get_get_workspace,
    get_list_accessible_workspaces,
    get_list_workspaces,
)
from planiadvance_v2.api.main import create_app
from planiadvance_v2.api.tenant import (
    get_tenant_membership_repository,
    get_tenant_organization_repository,
    get_tenant_workspace_repository,
)
from planiadvance_v2.application.use_cases import (
    CreateWorkspace,
    GetWorkspace,
    ListAccessibleWorkspaces,
    ListWorkspaces,
)
from planiadvance_v2.domain.entities import (
    Membership,
    MembershipRole,
    Organization,
    Workspace,
    WorkspaceAccessGrant,
)
from planiadvance_v2.infrastructure.in_memory.repositories import (
    InMemoryMembershipRepository,
    InMemoryOrganizationRepository,
    InMemoryWorkspaceAccessGrantRepository,
    InMemoryWorkspaceRepository,
)


@pytest.fixture
def api():
    organizations = InMemoryOrganizationRepository(
        [
            Organization(id="org-1", name="Plant QC", slug="plant-qc"),
            Organization(id="org-2", name="Plant EU", slug="plant-eu"),
        ]
    )
    memberships = InMemoryMembershipRepository(
        [
            Membership(
                organization_id="org-1",
                user_id="user-1",
                role=MembershipRole.PLANNER,
            ),
            Membership(
                organization_id="org-1",
                user_id="user-inactive",
                role=MembershipRole.VIEWER,
                is_active=False,
            ),
        ]
    )
    workspaces = InMemoryWorkspaceRepository(
        seed=[
            Workspace(id="ws-default", name="Default", is_default=True),
            Workspace(id="ws-qc", name="QC Planning", organization_id="org-1"),
            Workspace(id="ws-alt", name="QC Alt", organization_id="org-1"),
            Workspace(id="ws-eu", name="EU Planning", organization_id="org-2"),
        ]
    )
    grants = InMemoryWorkspaceAccessGrantRepository()

    app = create_app()

    @asynccontextmanager
    async def _noop_lifespan(_app):
        yield

    app.router.lifespan_context = _noop_lifespan
    app.dependency_overrides[get_tenant_organization_repository] = lambda: organizations
    app.dependency_overrides[get_tenant_membership_repository] = lambda: memberships
    app.dependency_overrides[get_tenant_workspace_repository] = lambda: workspaces
    app.dependency_overrides[get_list_workspaces] = lambda: ListWorkspaces(workspaces)
    app.dependency_overrides[get_list_accessible_workspaces] = (
        lambda: ListAccessibleWorkspaces(workspaces=workspaces, grants=grants)
    )
    app.dependency_overrides[get_create_workspace] = lambda: CreateWorkspace(workspaces)
    app.dependency_overrides[get_get_workspace] = lambda: GetWorkspace(workspaces)

    with TestClient(app) as client:
        yield client

    app.dependency_overrides.clear()


def _planner_headers() -> dict[str, str]:
    return {"X-Organization-Id": "org-1", "X-User-Id": "user-1"}


def test_list_without_identity_requires_login(api: TestClient):
    response = api.get("/workspaces")

    assert response.status_code == 200
    ids = {ws["id"] for ws in response.json()}
    assert ids == {"ws-default", "ws-qc", "ws-alt", "ws-eu"}


def test_list_with_organization_header_filters_to_that_tenant(api: TestClient):
    response = api.get("/workspaces", headers=_planner_headers())

    assert response.status_code == 200
    ids = [ws["id"] for ws in response.json()]
    assert ids == ["ws-qc", "ws-alt"]


def test_list_with_bearer_session_filters_to_that_tenant(api: TestClient):
    token, _ = issue_auth_session(user_id="user-1", organization_id="org-1")
    response = api.get(
        "/workspaces",
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 200
    ids = [ws["id"] for ws in response.json()]
    assert ids == ["ws-qc", "ws-alt"]


def test_list_with_unknown_organization_header_returns_404(api: TestClient):
    response = api.get("/workspaces", headers={"X-Organization-Id": "org-missing"})

    assert response.status_code == 404
    assert response.json()["error"] == "organization_not_found"


def test_create_inherits_organization_from_header(api: TestClient):
    response = api.post(
        "/workspaces",
        headers=_planner_headers(),
        json={"id": "ws-qc-2", "name": "QC Planning 2"},
    )

    assert response.status_code == 201
    assert response.json()["organization_id"] == "org-1"


def test_create_rejects_cross_tenant_payload(api: TestClient):
    response = api.post(
        "/workspaces",
        headers=_planner_headers(),
        json={"id": "ws-x", "name": "Cross", "organization_id": "org-2"},
    )

    assert response.status_code == 403
    assert response.json()["error"] == "cross_tenant_forbidden"


def test_get_workspace_returns_404_when_outside_tenant(api: TestClient):
    response = api.get("/workspaces/ws-eu", headers=_planner_headers())

    assert response.status_code == 404


def test_user_header_requires_organization(api: TestClient):
    response = api.get("/workspaces", headers={"X-User-Id": "user-1"})

    assert response.status_code == 400
    assert response.json()["error"] == "missing_organization"


def test_organization_header_requires_user(api: TestClient):
    response = api.get("/workspaces", headers={"X-Organization-Id": "org-1"})

    assert response.status_code == 400
    assert response.json()["error"] == "missing_user"


def test_user_header_with_valid_membership_is_allowed(api: TestClient):
    response = api.get("/workspaces", headers=_planner_headers())

    assert response.status_code == 200
    ids = [ws["id"] for ws in response.json()]
    assert ids == ["ws-qc", "ws-alt"]


def test_user_header_without_membership_is_forbidden(api: TestClient):
    response = api.get(
        "/workspaces",
        headers={"X-Organization-Id": "org-1", "X-User-Id": "user-stranger"},
    )

    assert response.status_code == 403
    assert response.json()["error"] == "membership_required"


def test_inactive_membership_is_forbidden(api: TestClient):
    response = api.get(
        "/workspaces",
        headers={"X-Organization-Id": "org-1", "X-User-Id": "user-inactive"},
    )

    assert response.status_code == 403
    assert response.json()["error"] == "membership_required"


def test_bearer_session_rejects_mismatched_identity_headers(api: TestClient):
    token, _ = issue_auth_session(user_id="user-1", organization_id="org-1")
    response = api.get(
        "/workspaces",
        headers={
            "Authorization": f"Bearer {token}",
            "X-Organization-Id": "org-2",
        },
    )

    assert response.status_code == 403
    assert response.json()["error"] == "cross_tenant_forbidden"


def test_workspace_header_requires_explicit_access_when_scope_exists() -> None:
    organizations = InMemoryOrganizationRepository(
        [Organization(id="org-1", name="Plant QC", slug="plant-qc")]
    )
    memberships = InMemoryMembershipRepository(
        [
            Membership(
                organization_id="org-1",
                user_id="user-1",
                role=MembershipRole.PLANNER,
            )
        ]
    )
    workspaces = InMemoryWorkspaceRepository(
        seed=[
            Workspace(id="ws-qc", name="QC Planning", organization_id="org-1"),
            Workspace(id="ws-alt", name="QC Alt", organization_id="org-1"),
        ]
    )
    grants = InMemoryWorkspaceAccessGrantRepository(
        [
            WorkspaceAccessGrant(
                organization_id="org-1",
                workspace_id="ws-qc",
                user_id="user-1",
            )
        ]
    )

    app = create_app()

    @asynccontextmanager
    async def _noop_lifespan(_app):
        yield

    app.router.lifespan_context = _noop_lifespan
    app.dependency_overrides[get_tenant_organization_repository] = lambda: organizations
    app.dependency_overrides[get_tenant_membership_repository] = lambda: memberships
    app.dependency_overrides[get_tenant_workspace_repository] = lambda: workspaces
    app.dependency_overrides[get_list_workspaces] = lambda: ListWorkspaces(workspaces)
    app.dependency_overrides[get_list_accessible_workspaces] = (
        lambda: ListAccessibleWorkspaces(workspaces=workspaces, grants=grants)
    )
    app.dependency_overrides[get_get_workspace] = lambda: GetWorkspace(workspaces)

    with TestClient(app) as client:
        response = client.get(
            "/workspaces",
            headers={
                "X-Organization-Id": "org-1",
                "X-User-Id": "user-1",
                "X-Workspace-Id": "ws-alt",
            },
        )

    app.dependency_overrides.clear()

    assert response.status_code == 403
    assert response.json()["error"] == "workspace_access_required"


def test_list_workspaces_only_returns_granted_scope_when_restricted() -> None:
    organizations = InMemoryOrganizationRepository(
        [Organization(id="org-1", name="Plant QC", slug="plant-qc")]
    )
    memberships = InMemoryMembershipRepository(
        [
            Membership(
                organization_id="org-1",
                user_id="user-1",
                role=MembershipRole.PLANNER,
            )
        ]
    )
    workspaces = InMemoryWorkspaceRepository(
        seed=[
            Workspace(id="ws-qc", name="QC Planning", organization_id="org-1"),
            Workspace(id="ws-alt", name="QC Alt", organization_id="org-1"),
        ]
    )
    grants = InMemoryWorkspaceAccessGrantRepository(
        [
            WorkspaceAccessGrant(
                organization_id="org-1",
                workspace_id="ws-qc",
                user_id="user-1",
            )
        ]
    )

    app = create_app()

    @asynccontextmanager
    async def _noop_lifespan(_app):
        yield

    app.router.lifespan_context = _noop_lifespan
    app.dependency_overrides[get_tenant_organization_repository] = lambda: organizations
    app.dependency_overrides[get_tenant_membership_repository] = lambda: memberships
    app.dependency_overrides[get_tenant_workspace_repository] = lambda: workspaces
    app.dependency_overrides[get_list_workspaces] = lambda: ListWorkspaces(workspaces)
    app.dependency_overrides[get_list_accessible_workspaces] = (
        lambda: ListAccessibleWorkspaces(workspaces=workspaces, grants=grants)
    )

    with TestClient(app) as client:
        response = client.get(
            "/workspaces",
            headers={"X-Organization-Id": "org-1", "X-User-Id": "user-1"},
        )

    app.dependency_overrides.clear()

    assert response.status_code == 200
    assert [workspace["id"] for workspace in response.json()] == ["ws-qc"]


def test_get_workspace_returns_404_when_outside_explicit_scope() -> None:
    organizations = InMemoryOrganizationRepository(
        [Organization(id="org-1", name="Plant QC", slug="plant-qc")]
    )
    memberships = InMemoryMembershipRepository(
        [
            Membership(
                organization_id="org-1",
                user_id="user-1",
                role=MembershipRole.PLANNER,
            )
        ]
    )
    workspaces = InMemoryWorkspaceRepository(
        seed=[
            Workspace(id="ws-qc", name="QC Planning", organization_id="org-1"),
            Workspace(id="ws-alt", name="QC Alt", organization_id="org-1"),
        ]
    )
    grants = InMemoryWorkspaceAccessGrantRepository(
        [
            WorkspaceAccessGrant(
                organization_id="org-1",
                workspace_id="ws-qc",
                user_id="user-1",
            )
        ]
    )

    app = create_app()

    @asynccontextmanager
    async def _noop_lifespan(_app):
        yield

    app.router.lifespan_context = _noop_lifespan
    app.dependency_overrides[get_tenant_organization_repository] = lambda: organizations
    app.dependency_overrides[get_tenant_membership_repository] = lambda: memberships
    app.dependency_overrides[get_tenant_workspace_repository] = lambda: workspaces
    app.dependency_overrides[get_list_workspaces] = lambda: ListWorkspaces(workspaces)
    app.dependency_overrides[get_list_accessible_workspaces] = (
        lambda: ListAccessibleWorkspaces(workspaces=workspaces, grants=grants)
    )
    app.dependency_overrides[get_get_workspace] = lambda: GetWorkspace(workspaces)

    with TestClient(app) as client:
        response = client.get(
            "/workspaces/ws-alt",
            headers={"X-Organization-Id": "org-1", "X-User-Id": "user-1"},
        )

    app.dependency_overrides.clear()

    assert response.status_code == 404


def test_view_reports_permission_matrix():
    from planiadvance_v2.api.tenant import permissions_for_role
    from planiadvance_v2.domain.entities import MembershipRole

    assert "view_reports" in permissions_for_role(MembershipRole.OWNER)
    assert "view_reports" in permissions_for_role(MembershipRole.ADMIN)
    assert "view_reports" in permissions_for_role(MembershipRole.PLANNER)
    assert "view_reports" in permissions_for_role(MembershipRole.VIEWER)
    assert "view_reports" not in permissions_for_role(MembershipRole.INTEGRATOR)
