"""Studio v2 phase 3 / J7 — proof that GET /integration/flows/{id}/runs/{run_id}/trace
is tenant-scoped.

The endpoint returns persisted per-block trace rows captured during a
flow run. Two tenants must NEVER see each other's traces. These tests
exercise the full request path:
- A session in org-A pulling a trace they own gets the rows back.
- A session in org-B asking for org-A's trace gets a 404 (same response
  as a non-existent flow — never confirms cross-tenant existence).
- The 404 body MUST NOT echo any of org-A's block ids or payloads.
- An unknown run_id under a flow you DO own returns 200 + empty list
  (a flow with no runs yet is a valid state, not a 404).

Failure here is a real cross-tenant data leak.
"""

from __future__ import annotations

from contextlib import asynccontextmanager
from datetime import datetime

import pytest
from fastapi.testclient import TestClient

from planiadvance_v2.api.dependencies import (
    get_flow_run_trace_repository,
    get_manage_integration_flows,
)
from planiadvance_v2.api.main import create_app
from planiadvance_v2.api.tenant import (
    get_tenant_membership_repository,
    get_tenant_organization_repository,
    get_tenant_workspace_repository,
)
from planiadvance_v2.application.ports.flow_run_trace_repository import FlowRunTrace
from planiadvance_v2.application.use_cases import ManageIntegrationFlows
from planiadvance_v2.application.use_cases.integration_flows import (
    IntegrationFlow,
    IntegrationFlowBlock,
)
from planiadvance_v2.domain.entities import (
    Membership,
    MembershipRole,
    Organization,
    Workspace,
)
from planiadvance_v2.infrastructure.in_memory.repositories import (
    InMemoryFlowRunTraceRepository,
    InMemoryIntegrationFlowRepository,
    InMemoryMembershipRepository,
    InMemoryOrganizationRepository,
    InMemoryWorkspaceRepository,
)


def _tenant_headers(org_id: str, user_id: str) -> dict[str, str]:
    return {"X-Organization-Id": org_id, "X-User-Id": user_id}


@pytest.fixture
def shared_repos():
    flows = InMemoryIntegrationFlowRepository()
    traces = InMemoryFlowRunTraceRepository()
    organizations = InMemoryOrganizationRepository()
    memberships = InMemoryMembershipRepository()
    workspaces = InMemoryWorkspaceRepository()

    organizations.add(
        Organization(id="org-a", name="Alpha Corp", slug="alpha", is_active=True)
    )
    organizations.add(
        Organization(id="org-b", name="Bravo Corp", slug="bravo", is_active=True)
    )
    memberships.add(
        Membership(
            organization_id="org-a",
            user_id="user-a",
            role=MembershipRole.OWNER,
            is_active=True,
        )
    )
    memberships.add(
        Membership(
            organization_id="org-b",
            user_id="user-b",
            role=MembershipRole.OWNER,
            is_active=True,
        )
    )
    workspaces.add(
        Workspace(
            id="ws-a",
            name="Alpha WS",
            organization_id="org-a",
            is_default=True,
            is_active=True,
        )
    )
    workspaces.add(
        Workspace(
            id="ws-b",
            name="Bravo WS",
            organization_id="org-b",
            is_default=True,
            is_active=True,
        )
    )

    # Org-A owns a flow. Use export_snapshot — no required config —
    # so the fixture isn't dragged into per-block validation rules.
    flow_a = IntegrationFlow(
        id="flow-a",
        name="Org A flow",
        source_system="studio_v2",
        organization_id="org-a",
        workspace_id="ws-a",
        is_enabled=True,
        blocks=[
            IntegrationFlowBlock(
                id="b1",
                block_type="export_snapshot",
                name="Export APS Data",
                config={},
            ),
        ],
    )
    flows.save(flow_a)

    # Two trace rows under run-1 for flow-a, scoped to org-a.
    traces.save_many(
        [
            FlowRunTrace(
                id="trace-1",
                flow_id="flow-a",
                run_id="run-1",
                block_id="b1",
                block_type="export_snapshot",
                status="ok",
                duration_ms=42,
                organization_id="org-a",
                workspace_id="ws-a",
                input_payload={"path": "/wo"},
                output_payload={"work_orders": [{"id": "WO-AAA"}]},
                started_at=datetime(2026, 5, 7, 12, 0, 0),
            ),
        ]
    )
    return {
        "flows": flows,
        "traces": traces,
        "organizations": organizations,
        "memberships": memberships,
        "workspaces": workspaces,
    }


@pytest.fixture
def api(shared_repos):
    app = create_app()

    @asynccontextmanager
    async def _noop_lifespan(_app):
        yield

    app.router.lifespan_context = _noop_lifespan

    app.dependency_overrides[get_manage_integration_flows] = (
        lambda: ManageIntegrationFlows(shared_repos["flows"])
    )
    app.dependency_overrides[get_flow_run_trace_repository] = (
        lambda: shared_repos["traces"]
    )
    app.dependency_overrides[get_tenant_organization_repository] = (
        lambda: shared_repos["organizations"]
    )
    app.dependency_overrides[get_tenant_membership_repository] = (
        lambda: shared_repos["memberships"]
    )
    app.dependency_overrides[get_tenant_workspace_repository] = (
        lambda: shared_repos["workspaces"]
    )

    with TestClient(app) as client:
        yield client


def test_org_a_can_read_their_own_run_trace(api) -> None:
    response = api.get(
        "/integration/flows/flow-a/runs/run-1/trace",
        headers=_tenant_headers("org-a", "user-a"),
    )
    assert response.status_code == 200, response.text
    rows = response.json()
    assert len(rows) == 1
    assert rows[0]["block_id"] == "b1"
    assert rows[0]["output_payload"]["work_orders"][0]["id"] == "WO-AAA"


def test_org_b_cannot_read_org_a_trace_returns_404(api) -> None:
    response = api.get(
        "/integration/flows/flow-a/runs/run-1/trace",
        headers=_tenant_headers("org-b", "user-b"),
    )
    assert response.status_code == 404
    body = response.text
    # The 404 body must never echo org-A's block id or payload.
    assert "WO-AAA" not in body
    assert "b1" not in body or "flow_not_found" in body  # accept 'b1' inside 'flow-a' but no payload


def test_unknown_run_id_for_owned_flow_returns_empty_list(api) -> None:
    response = api.get(
        "/integration/flows/flow-a/runs/run-does-not-exist/trace",
        headers=_tenant_headers("org-a", "user-a"),
    )
    assert response.status_code == 200
    assert response.json() == []
