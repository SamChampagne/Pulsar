"""Studio v2 phase 6 — proof that POST /integration/flows/{id}/validate-graph
is tenant-scoped. Same IDOR pattern as the /trace and /test-block endpoints:
an org-B session that knows org-A's flow_id must get a 404, never an
execution + leak.
"""

from __future__ import annotations

from contextlib import asynccontextmanager

import pytest
from fastapi.testclient import TestClient

from planiadvance_v2.api.dependencies import (
    get_validate_integration_flow_graph,
)
from planiadvance_v2.api.main import create_app
from planiadvance_v2.api.tenant import (
    get_tenant_membership_repository,
    get_tenant_organization_repository,
    get_tenant_workspace_repository,
)
from planiadvance_v2.application.ports import (
    FlowBlockInput,
    IntegrationFlow,
    IntegrationFlowBlock,
)
from planiadvance_v2.application.use_cases import ValidateIntegrationFlowGraph
from planiadvance_v2.domain.entities import (
    Membership,
    MembershipRole,
    Organization,
    Workspace,
)
from planiadvance_v2.infrastructure.in_memory.repositories import (
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
    organizations = InMemoryOrganizationRepository()
    memberships = InMemoryMembershipRepository()
    workspaces = InMemoryWorkspaceRepository()

    organizations.add(
        Organization(id="org-a", name="Alpha", slug="alpha", is_active=True)
    )
    organizations.add(
        Organization(id="org-b", name="Bravo", slug="bravo", is_active=True)
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

    # Org-A owns a 4-block flow with a branch_if to exercise dangling-branch.
    flow_a = IntegrationFlow(
        id="flow-a",
        name="Org A flow",
        source_system="studio_v2",
        organization_id="org-a",
        workspace_id="ws-a",
        is_enabled=True,
        blocks=[
            IntegrationFlowBlock(id="t", block_type="trigger_manual"),
            IntegrationFlowBlock(
                id="if1",
                block_type="logic_branch_if",
                inputs=[FlowBlockInput(source_block_id="t", edge_type="data")],
                config={"condition_path": "$.via"},
            ),
            IntegrationFlowBlock(
                id="t-side",
                block_type="export_snapshot",
                inputs=[
                    FlowBlockInput(source_block_id="if1", edge_type="branch_true")
                ],
            ),
            # No branch_false consumer → dangling-branch warning expected.
        ],
    )
    flows.save(flow_a)
    return {
        "flows": flows,
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

    use_case = ValidateIntegrationFlowGraph(shared_repos["flows"])
    app.dependency_overrides[get_validate_integration_flow_graph] = lambda: use_case
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


def test_org_a_can_validate_own_flow(api) -> None:
    response = api.post(
        "/integration/flows/flow-a/validate-graph",
        headers=_tenant_headers("org-a", "user-a"),
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["flow_id"] == "flow-a"
    # Valid because dangling-branch is a warning, not an error.
    assert body["valid"] is True
    codes = [issue["code"] for issue in body["issues"]]
    assert "dangling_branch" in codes


def test_org_b_cannot_validate_org_a_flow_returns_404(api) -> None:
    response = api.post(
        "/integration/flows/flow-a/validate-graph",
        headers=_tenant_headers("org-b", "user-b"),
    )
    assert response.status_code == 404
    body = response.text
    # 404 body must never echo org-A flow metadata or block ids.
    assert "logic_branch_if" not in body
    assert "branch_true" not in body


def test_unknown_flow_id_returns_404(api) -> None:
    response = api.post(
        "/integration/flows/does-not-exist/validate-graph",
        headers=_tenant_headers("org-a", "user-a"),
    )
    assert response.status_code == 404
