from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi.testclient import TestClient

from planiadvance_v2.api.dependencies import (
    get_add_membership,
    get_create_organization,
    get_create_user_account,
    get_create_workspace,
    get_grant_workspace_access,
    get_list_accessible_workspaces,
    get_list_memberships,
    get_list_organization_workspaces,
    get_list_organizations,
    get_list_user_accounts,
    get_list_workspace_access_grants,
    get_revoke_workspace_access,
)
from planiadvance_v2.api.main import create_app
from planiadvance_v2.api.tenant import (
    get_tenant_membership_repository,
    get_tenant_organization_repository,
)
from planiadvance_v2.application.use_cases import (
    AddMembership,
    CreateOrganization,
    CreateUserAccount,
    CreateWorkspace,
    GrantWorkspaceAccess,
    ListAccessibleWorkspaces,
    ListMemberships,
    ListOrganizations,
    ListOrganizationWorkspaces,
    ListUserAccounts,
    ListWorkspaceAccessGrants,
    RevokeWorkspaceAccess,
)
from planiadvance_v2.domain.entities import Membership, MembershipRole, Organization, UserAccount
from planiadvance_v2.infrastructure.in_memory.repositories import (
    InMemoryMembershipRepository,
    InMemoryOrganizationRepository,
    InMemoryUserAccountRepository,
    InMemoryWorkspaceAccessGrantRepository,
    InMemoryWorkspaceRepository,
)


def _accounts_api():
    organizations = InMemoryOrganizationRepository(
        [Organization(id="org-root", name="Root Co", slug="root")]
    )
    users = InMemoryUserAccountRepository(
        [
            UserAccount(
                id="admin-1",
                email="admin@example.com",
                display_name="Admin One",
            )
        ]
    )
    memberships = InMemoryMembershipRepository(
        [
            Membership(
                organization_id="org-root",
                user_id="admin-1",
                role=MembershipRole.ADMIN,
            )
        ]
    )
    workspaces = InMemoryWorkspaceRepository(seed=[])
    grants = InMemoryWorkspaceAccessGrantRepository()

    app = create_app()

    @asynccontextmanager
    async def _noop_lifespan(_app):
        yield

    app.router.lifespan_context = _noop_lifespan
    app.dependency_overrides[get_tenant_organization_repository] = lambda: organizations
    app.dependency_overrides[get_tenant_membership_repository] = lambda: memberships
    app.dependency_overrides[get_create_organization] = lambda: CreateOrganization(
        organizations
    )
    app.dependency_overrides[get_list_organizations] = lambda: ListOrganizations(
        organizations
    )
    app.dependency_overrides[get_create_user_account] = lambda: CreateUserAccount(users)
    app.dependency_overrides[get_list_user_accounts] = lambda: ListUserAccounts(users)
    app.dependency_overrides[get_create_workspace] = lambda: CreateWorkspace(workspaces)
    app.dependency_overrides[get_list_organization_workspaces] = (
        lambda: ListOrganizationWorkspaces(workspaces)
    )
    app.dependency_overrides[get_add_membership] = lambda: AddMembership(
        organizations=organizations,
        users=users,
        memberships=memberships,
    )
    app.dependency_overrides[get_list_memberships] = lambda: ListMemberships(memberships)
    app.dependency_overrides[get_list_accessible_workspaces] = (
        lambda: ListAccessibleWorkspaces(workspaces=workspaces, grants=grants)
    )
    app.dependency_overrides[get_list_workspace_access_grants] = (
        lambda: ListWorkspaceAccessGrants(grants)
    )
    app.dependency_overrides[get_grant_workspace_access] = lambda: GrantWorkspaceAccess(
        organizations=organizations,
        users=users,
        memberships=memberships,
        workspaces=workspaces,
        grants=grants,
    )
    app.dependency_overrides[get_revoke_workspace_access] = lambda: RevokeWorkspaceAccess(
        workspaces=workspaces,
        grants=grants,
    )
    return app


def _admin_headers() -> dict[str, str]:
    return {"X-Organization-Id": "org-root", "X-User-Id": "admin-1"}


class TestAccountsHttp:
    def test_create_user_org_and_membership(self):
        app = _accounts_api()
        with TestClient(app) as client:
            org = client.post(
                "/accounts/organizations",
                json={"id": "org-1", "name": "Plant QC", "slug": "plant-qc"},
                headers=_admin_headers(),
            )
            user = client.post(
                "/accounts/users",
                json={
                    "id": "user-1",
                    "email": "planner@example.com",
                    "display_name": "Planner One",
                },
                headers=_admin_headers(),
            )
            membership = client.post(
                "/accounts/organizations/org-1/memberships",
                json={"user_id": "user-1", "role": "planner"},
                headers=_admin_headers(),
            )
            org_memberships = client.get(
                "/accounts/organizations/org-1/memberships",
                headers=_admin_headers(),
            )
            user_memberships = client.get(
                "/accounts/users/user-1/memberships",
                headers=_admin_headers(),
            )

        assert org.status_code == 201
        assert org.json()["slug"] == "plant-qc"
        assert user.status_code == 201
        assert user.json()["email"] == "planner@example.com"
        assert membership.status_code == 201
        assert membership.json() == {
            "organization_id": "org-1",
            "user_id": "user-1",
            "role": "planner",
            "is_active": True,
        }
        assert org_memberships.json() == [membership.json()]
        assert user_memberships.json() == [membership.json()]

    def test_organization_workspaces_are_listed_by_tenant(self):
        app = _accounts_api()
        with TestClient(app) as client:
            org = client.post(
                "/accounts/organizations",
                json={"id": "org-1", "name": "Plant QC", "slug": "plant-qc"},
                headers=_admin_headers(),
            )
            workspace = client.post(
                "/workspaces",
                json={
                    "id": "ws-1",
                    "name": "Plant QC Planning",
                    "organization_id": "org-root",
                },
                headers=_admin_headers(),
            )
            organization_workspaces = client.get(
                "/accounts/organizations/org-root/workspaces",
                headers=_admin_headers(),
            )

        assert org.status_code == 201
        assert workspace.status_code == 201
        assert workspace.json()["organization_id"] == "org-root"
        assert organization_workspaces.status_code == 200
        assert organization_workspaces.json() == [workspace.json()]

    def test_duplicate_org_slug_returns_validation_error(self):
        app = _accounts_api()
        with TestClient(app) as client:
            first = client.post(
                "/accounts/organizations",
                json={"id": "org-1", "name": "Plant QC", "slug": "plant-qc"},
                headers=_admin_headers(),
            )
            duplicate = client.post(
                "/accounts/organizations",
                json={"id": "org-2", "name": "Plant 2", "slug": "plant-qc"},
                headers=_admin_headers(),
            )

        assert first.status_code == 201
        assert duplicate.status_code == 422
        assert duplicate.json()["error"] == "validation_error"

    def test_accounts_routes_require_authenticated_admin(self):
        app = _accounts_api()
        with TestClient(app) as client:
            response = client.get("/accounts/users")

        assert response.status_code == 401
        assert response.json()["error"] == "login_required"

    def test_workspace_access_grants_can_be_managed(self):
        app = _accounts_api()
        with TestClient(app) as client:
            workspace = client.post(
                "/workspaces",
                json={
                    "id": "ws-1",
                    "name": "Plant QC Planning",
                    "organization_id": "org-root",
                },
                headers=_admin_headers(),
            )
            user = client.post(
                "/accounts/users",
                json={
                    "id": "planner-1",
                    "email": "planner@example.com",
                    "display_name": "Planner One",
                },
                headers=_admin_headers(),
            )
            membership = client.post(
                "/accounts/organizations/org-root/memberships",
                json={"user_id": "planner-1", "role": "planner"},
                headers=_admin_headers(),
            )
            grant = client.post(
                "/accounts/workspaces/ws-1/access-grants",
                json={"user_id": "planner-1"},
                headers=_admin_headers(),
            )
            listed = client.get(
                "/accounts/organizations/org-root/workspace-access-grants",
                headers=_admin_headers(),
            )
            revoked = client.delete(
                "/accounts/workspaces/ws-1/access-grants/planner-1",
                headers=_admin_headers(),
            )
            listed_after = client.get(
                "/accounts/organizations/org-root/workspace-access-grants",
                headers=_admin_headers(),
            )

        assert workspace.status_code == 201
        assert user.status_code == 201
        assert membership.status_code == 201
        assert grant.status_code == 201
        assert grant.json() == {
            "organization_id": "org-root",
            "workspace_id": "ws-1",
            "user_id": "planner-1",
            "is_active": True,
        }
        assert listed.status_code == 200
        assert listed.json() == [grant.json()]
        assert revoked.status_code == 204
        assert listed_after.json() == []
