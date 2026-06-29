from __future__ import annotations

from contextlib import asynccontextmanager
from datetime import datetime

import pytest
from fastapi.testclient import TestClient

from planiadvance_v2.api.dependencies import (
    get_create_work_order,
    get_delete_work_order,
    get_get_work_order,
    get_list_accessible_workspaces,
    get_list_work_orders,
)
from planiadvance_v2.api.main import create_app
from planiadvance_v2.api.tenant import (
    get_tenant_membership_repository,
    get_tenant_organization_repository,
    get_tenant_workspace_repository,
)
from planiadvance_v2.application.use_cases import (
    CreateWorkOrder,
    DeleteWorkOrder,
    GetWorkOrder,
    ListAccessibleWorkspaces,
    ListWorkOrders,
)
from planiadvance_v2.domain.entities import (
    Membership,
    MembershipRole,
    Operation,
    Organization,
    WorkOrder,
    Workspace,
)
from planiadvance_v2.domain.value_objects import Duration, Priority
from planiadvance_v2.infrastructure.in_memory.repositories import (
    InMemoryMembershipRepository,
    InMemoryOrganizationRepository,
    InMemoryWorkOrderRepository,
    InMemoryWorkspaceAccessGrantRepository,
    InMemoryWorkspaceRepository,
)


def _tenant_headers(workspace_id: str | None = None) -> dict[str, str]:
    headers = {"X-Organization-Id": "org-1", "X-User-Id": "user-1"}
    if workspace_id is not None:
        headers["X-Workspace-Id"] = workspace_id
    return headers


def _make_work_order(
    wo_id: str,
    *,
    organization_id: str | None,
    workspace_id: str | None = None,
) -> WorkOrder:
    return WorkOrder(
        id=wo_id,
        name=wo_id,
        product_id="P-1",
        quantity=1,
        due_date=datetime(2026, 1, 10, 18, 0),
        release_date=datetime(2026, 1, 10, 8, 0),
        operations=[
            Operation(
                id=f"{wo_id}-OP1",
                work_order_id=wo_id,
                sequence=1,
                name=f"{wo_id}-OP1",
                duration=Duration(minutes=30),
                eligible_machine_ids=["M1"],
            )
        ],
        priority=Priority.NORMAL,
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
    work_orders = InMemoryWorkOrderRepository(
        [
            _make_work_order("WO-GLOBAL", organization_id=None),
            _make_work_order("WO-QC", organization_id="org-1"),
            _make_work_order("WO-EU", organization_id="org-2"),
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
    app.dependency_overrides[get_list_work_orders] = lambda: ListWorkOrders(work_orders)
    app.dependency_overrides[get_create_work_order] = lambda: CreateWorkOrder(work_orders)
    app.dependency_overrides[get_get_work_order] = lambda: GetWorkOrder(work_orders)
    app.dependency_overrides[get_delete_work_order] = lambda: DeleteWorkOrder(work_orders)

    with TestClient(app) as client:
        yield client, work_orders

    app.dependency_overrides.clear()


def test_list_without_header_returns_all_work_orders(api):
    client, _ = api
    response = client.get("/work-orders")

    assert response.status_code == 200
    ids = {wo["id"] for wo in response.json()}
    assert ids == {"WO-GLOBAL", "WO-QC", "WO-EU"}


def test_list_with_organization_header_filters_to_that_tenant(api):
    client, _ = api
    response = client.get(
        "/work-orders",
        headers={"X-Organization-Id": "org-1", "X-User-Id": "user-1"},
    )

    assert response.status_code == 200
    ids = [wo["id"] for wo in response.json()]
    assert ids == ["WO-QC"]


def _sample_payload(
    wo_id: str,
    *,
    organization_id: str | None = None,
    workspace_id: str | None = None,
) -> dict:
    payload = {
        "id": wo_id,
        "name": wo_id,
        "product_id": "P-1",
        "quantity": 1,
        "due_date": "2026-01-10T18:00:00",
        "release_date": "2026-01-10T08:00:00",
        "priority": 2,
        "operations": [
            {
                "id": f"{wo_id}-OP1",
                "sequence": 1,
                "name": f"{wo_id}-OP1",
                "duration_minutes": 30,
                "eligible_machine_ids": ["M1"],
            }
        ],
    }
    if organization_id is not None:
        payload["organization_id"] = organization_id
    if workspace_id is not None:
        payload["workspace_id"] = workspace_id
    return payload


def test_create_inherits_organization_from_header(api):
    client, _ = api
    response = client.post(
        "/work-orders",
        headers=_tenant_headers(),
        json=_sample_payload("WO-NEW"),
    )

    assert response.status_code == 201
    assert response.json()["organization_id"] == "org-1"


def test_create_rejects_cross_tenant_payload(api):
    client, _ = api
    response = client.post(
        "/work-orders",
        headers=_tenant_headers(),
        json=_sample_payload("WO-X", organization_id="org-2"),
    )

    assert response.status_code == 403
    assert response.json()["error"] == "cross_tenant_forbidden"


def test_create_inherits_workspace_from_header(api):
    client, _ = api
    response = client.post(
        "/work-orders",
        headers=_tenant_headers("plant-a"),
        json=_sample_payload("WO-PLANT-A"),
    )

    assert response.status_code == 201
    assert response.json()["organization_id"] == "org-1"
    assert response.json()["workspace_id"] == "plant-a"


def test_create_rejects_cross_workspace_payload(api):
    client, _ = api
    response = client.post(
        "/work-orders",
        headers=_tenant_headers("plant-a"),
        json=_sample_payload("WO-X", workspace_id="plant-b"),
    )

    assert response.status_code == 403
    assert response.json()["error"] == "cross_workspace_forbidden"


def test_list_with_workspace_header_filters_to_active_workspace(api):
    client, _ = api
    client.post(
        "/work-orders",
        headers=_tenant_headers("plant-a"),
        json=_sample_payload("WO-PLANT-A"),
    )
    client.post(
        "/work-orders",
        headers=_tenant_headers("plant-b"),
        json=_sample_payload("WO-PLANT-B"),
    )

    response = client.get("/work-orders", headers=_tenant_headers("plant-a"))

    assert response.status_code == 200
    ids = [wo["id"] for wo in response.json()]
    assert ids == ["WO-PLANT-A"]


def test_get_work_order_returns_404_when_outside_workspace(api):
    client, _ = api
    create_response = client.post(
        "/work-orders",
        headers=_tenant_headers("plant-b"),
        json=_sample_payload("WO-PLANT-B"),
    )
    assert create_response.status_code == 201

    response = client.get("/work-orders/WO-PLANT-B", headers=_tenant_headers("plant-a"))

    assert response.status_code == 404


def test_get_work_order_returns_404_when_outside_tenant(api):
    client, _ = api
    response = client.get(
        "/work-orders/WO-EU",
        headers={"X-Organization-Id": "org-1", "X-User-Id": "user-1"},
    )

    assert response.status_code == 404


def test_get_work_order_allowed_within_tenant(api):
    client, _ = api
    response = client.get(
        "/work-orders/WO-QC",
        headers={"X-Organization-Id": "org-1", "X-User-Id": "user-1"},
    )

    assert response.status_code == 200
    assert response.json()["organization_id"] == "org-1"


def test_delete_rejects_cross_tenant(api):
    client, work_orders = api
    response = client.delete(
        "/work-orders/WO-EU",
        headers={"X-Organization-Id": "org-1", "X-User-Id": "user-1"},
    )

    assert response.status_code == 404
    # Verify the work order still exists
    assert work_orders.get("WO-EU") is not None


def test_delete_succeeds_within_tenant(api):
    client, work_orders = api
    response = client.delete(
        "/work-orders/WO-QC",
        headers={"X-Organization-Id": "org-1", "X-User-Id": "user-1"},
    )

    assert response.status_code == 204
    assert work_orders.get("WO-QC") is None
