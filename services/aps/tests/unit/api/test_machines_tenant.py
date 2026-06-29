from __future__ import annotations

from contextlib import asynccontextmanager

import pytest
from fastapi.testclient import TestClient

from planiadvance_v2.api.dependencies import (
    get_create_machine,
    get_delete_machine,
    get_get_machine,
    get_list_accessible_workspaces,
    get_list_machines,
)
from planiadvance_v2.api.main import create_app
from planiadvance_v2.api.tenant import (
    get_tenant_membership_repository,
    get_tenant_organization_repository,
    get_tenant_workspace_repository,
)
from planiadvance_v2.application.use_cases import (
    CreateMachine,
    DeleteMachine,
    GetMachine,
    ListAccessibleWorkspaces,
    ListMachines,
)
from planiadvance_v2.domain.entities import (
    Machine,
    Membership,
    MembershipRole,
    Organization,
    Workspace,
)
from planiadvance_v2.infrastructure.in_memory.repositories import (
    InMemoryMachineRepository,
    InMemoryMembershipRepository,
    InMemoryOrganizationRepository,
    InMemoryWorkspaceAccessGrantRepository,
    InMemoryWorkspaceRepository,
)


def _tenant_headers(workspace_id: str | None = None) -> dict[str, str]:
    headers = {"X-Organization-Id": "org-1", "X-User-Id": "user-1"}
    if workspace_id is not None:
        headers["X-Workspace-Id"] = workspace_id
    return headers


def _make_machine(
    machine_id: str,
    *,
    organization_id: str | None,
    workspace_id: str | None = None,
) -> Machine:
    return Machine(
        id=machine_id,
        name=machine_id,
        calendar_id="CAL-DEFAULT",
        organization_id=organization_id,
        workspace_id=workspace_id,
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
            )
        ]
    )
    workspaces = InMemoryWorkspaceRepository(
        [
            Workspace(id="plant-a", name="Plant A", organization_id="org-1"),
            Workspace(id="plant-b", name="Plant B", organization_id="org-1"),
            Workspace(id="plant-eu", name="Plant EU", organization_id="org-2"),
        ]
    )
    grants = InMemoryWorkspaceAccessGrantRepository()
    machines = InMemoryMachineRepository(
        [
            _make_machine("M-GLOBAL", organization_id=None),
            _make_machine("M-QC", organization_id="org-1"),
            _make_machine("M-EU", organization_id="org-2"),
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
    app.dependency_overrides[get_list_accessible_workspaces] = (
        lambda: ListAccessibleWorkspaces(workspaces=workspaces, grants=grants)
    )
    app.dependency_overrides[get_list_machines] = lambda: ListMachines(machines)
    app.dependency_overrides[get_create_machine] = lambda: CreateMachine(machines)
    app.dependency_overrides[get_get_machine] = lambda: GetMachine(machines)
    app.dependency_overrides[get_delete_machine] = lambda: DeleteMachine(machines)

    with TestClient(app) as client:
        yield client, machines

    app.dependency_overrides.clear()


def test_list_without_header_returns_all_machines(api):
    client, _ = api
    response = client.get("/machines")

    assert response.status_code == 200
    ids = {m["id"] for m in response.json()}
    assert ids == {"M-GLOBAL", "M-QC", "M-EU"}


def test_list_with_organization_header_filters(api):
    client, _ = api
    response = client.get(
        "/machines",
        headers={"X-Organization-Id": "org-1", "X-User-Id": "user-1"},
    )

    assert response.status_code == 200
    ids = [m["id"] for m in response.json()]
    assert ids == ["M-QC"]


def test_create_inherits_organization_from_header(api):
    client, _ = api
    response = client.post(
        "/machines",
        headers=_tenant_headers(),
        json={
            "id": "M-NEW",
            "name": "M-NEW",
            "calendar_id": "CAL-DEFAULT",
        },
    )

    assert response.status_code == 201
    assert response.json()["organization_id"] == "org-1"


def test_create_rejects_cross_tenant_payload(api):
    client, _ = api
    response = client.post(
        "/machines",
        headers=_tenant_headers(),
        json={
            "id": "M-X",
            "name": "M-X",
            "calendar_id": "CAL-DEFAULT",
            "organization_id": "org-2",
        },
    )

    assert response.status_code == 403
    assert response.json()["error"] == "cross_tenant_forbidden"


def test_create_inherits_workspace_from_header(api):
    client, _ = api
    response = client.post(
        "/machines",
        headers=_tenant_headers("plant-a"),
        json={
            "id": "M-PLANT-A",
            "name": "M-PLANT-A",
            "calendar_id": "CAL-DEFAULT",
        },
    )

    assert response.status_code == 201
    assert response.json()["organization_id"] == "org-1"
    assert response.json()["workspace_id"] == "plant-a"


def test_create_rejects_cross_workspace_payload(api):
    client, _ = api
    response = client.post(
        "/machines",
        headers=_tenant_headers("plant-a"),
        json={
            "id": "M-X",
            "name": "M-X",
            "calendar_id": "CAL-DEFAULT",
            "workspace_id": "plant-b",
        },
    )

    assert response.status_code == 403
    assert response.json()["error"] == "cross_workspace_forbidden"


def test_list_with_workspace_header_filters_to_active_workspace(api):
    client, _ = api
    client.post(
        "/machines",
        headers=_tenant_headers("plant-a"),
        json={
            "id": "M-PLANT-A",
            "name": "M-PLANT-A",
            "calendar_id": "CAL-DEFAULT",
        },
    )
    client.post(
        "/machines",
        headers=_tenant_headers("plant-b"),
        json={
            "id": "M-PLANT-B",
            "name": "M-PLANT-B",
            "calendar_id": "CAL-DEFAULT",
        },
    )

    response = client.get("/machines", headers=_tenant_headers("plant-a"))

    assert response.status_code == 200
    ids = [machine["id"] for machine in response.json()]
    assert ids == ["M-PLANT-A"]


def test_get_machine_returns_404_when_outside_workspace(api):
    client, _ = api
    create_response = client.post(
        "/machines",
        headers=_tenant_headers("plant-b"),
        json={
            "id": "M-PLANT-B",
            "name": "M-PLANT-B",
            "calendar_id": "CAL-DEFAULT",
        },
    )
    assert create_response.status_code == 201

    response = client.get("/machines/M-PLANT-B", headers=_tenant_headers("plant-a"))

    assert response.status_code == 404


def test_get_machine_returns_404_when_outside_tenant(api):
    client, _ = api
    response = client.get(
        "/machines/M-EU",
        headers={"X-Organization-Id": "org-1", "X-User-Id": "user-1"},
    )

    assert response.status_code == 404


def test_get_machine_allowed_within_tenant(api):
    client, _ = api
    response = client.get(
        "/machines/M-QC",
        headers={"X-Organization-Id": "org-1", "X-User-Id": "user-1"},
    )

    assert response.status_code == 200
    assert response.json()["organization_id"] == "org-1"


def test_delete_rejects_cross_tenant(api):
    client, machines = api
    response = client.delete(
        "/machines/M-EU",
        headers={"X-Organization-Id": "org-1", "X-User-Id": "user-1"},
    )

    assert response.status_code == 404
    assert machines.get("M-EU") is not None


def test_delete_succeeds_within_tenant(api):
    client, machines = api
    response = client.delete(
        "/machines/M-QC",
        headers={"X-Organization-Id": "org-1", "X-User-Id": "user-1"},
    )

    assert response.status_code == 204
    assert machines.get("M-QC") is None
