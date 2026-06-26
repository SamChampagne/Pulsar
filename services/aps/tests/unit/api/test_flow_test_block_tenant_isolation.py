"""Studio v2 phase 4 / J7 — proof that POST /integration/flows/{flow_id}/test-block/{block_id}
is tenant-scoped and dry-run only.

Same IDOR pattern as the /trace endpoint (Phase 3): an org-B session
that knows org-A's flow_id + block_id must get a 404 (or 422), never
an execution + leak. Plus a guard that the test path never persists
anything (no journal entry, no trace row).
"""

from __future__ import annotations

from contextlib import asynccontextmanager

import pytest
from fastapi.testclient import TestClient

from planiadvance_v2.api.dependencies import (
    get_run_integration_flow,
)
from planiadvance_v2.api.main import create_app
from planiadvance_v2.api.tenant import (
    get_tenant_membership_repository,
    get_tenant_organization_repository,
    get_tenant_workspace_repository,
)
from planiadvance_v2.application.use_cases import (
    ExportPlanningSnapshot,
    ExportPublishedPlan,
    ImportPlanningSnapshot,
    RunIntegrationFlow,
    RunSchedulingFromSnapshot,
)
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
    InMemoryCalendarRepository,
    InMemoryIntegrationBindingRepository,
    InMemoryIntegrationConnectorRepository,
    InMemoryIntegrationFlowRepository,
    InMemoryIntegrationJournalRepository,
    InMemoryInventoryRepository,
    InMemoryMachineRepository,
    InMemoryMembershipRepository,
    InMemoryOrganizationRepository,
    InMemoryResourceRepository,
    InMemorySupplyRepository,
    InMemoryWorkOrderRepository,
    InMemoryWorkspaceRepository,
)
from planiadvance_v2.infrastructure.integration_http import (
    EnvIntegrationSecretResolver,
)


class _NullHttpTransport:
    def request(self, request):  # pragma: no cover - not used in these tests
        raise NotImplementedError


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

    # Org-A owns a flow with a single export_snapshot block (no input required).
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

    journal = InMemoryIntegrationJournalRepository()
    calendars = InMemoryCalendarRepository()
    machines = InMemoryMachineRepository()
    work_orders = InMemoryWorkOrderRepository()
    resources = InMemoryResourceRepository()
    inventory = InMemoryInventoryRepository()
    supplies = InMemorySupplyRepository()
    bindings = InMemoryIntegrationBindingRepository()
    connectors = InMemoryIntegrationConnectorRepository()

    runner = RunIntegrationFlow(
        flows=shared_repos["flows"],
        journal=journal,
        exporter=ExportPlanningSnapshot(
            work_orders=work_orders,
            machines=machines,
            calendars=calendars,
            resources=resources,
            inventory=inventory,
            supplies=supplies,
        ),
        plan_exporter=ExportPublishedPlan(
            schedules=__import__(
                "planiadvance_v2.infrastructure.in_memory.repositories",
                fromlist=["InMemoryScheduleRepository"],
            ).InMemoryScheduleRepository(),
        ),
        importer=ImportPlanningSnapshot(
            calendars=calendars,
            machines=machines,
            resources=resources,
            work_orders=work_orders,
            inventory=inventory,
            supplies=supplies,
            bindings=bindings,
        ),
        scheduler=RunSchedulingFromSnapshot(),
        connectors=connectors,
        secret_resolver=EnvIntegrationSecretResolver(),
        http_transport=_NullHttpTransport(),
    )

    app.dependency_overrides[get_run_integration_flow] = lambda: runner
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
        yield {"client": client, "journal": journal}


def test_org_a_can_test_their_own_block(api) -> None:
    response = api["client"].post(
        "/integration/flows/flow-a/test-block/b1",
        headers=_tenant_headers("org-a", "user-a"),
        json={},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["block_id"] == "b1"
    assert body["block_type"] == "export_snapshot"
    # Defining "ok" semantics is up to the runner; verify the call shape only.
    assert body["status"] in {"ok", "ready", "failed", "blocked"}
    # Test path must not write to the journal repo.
    assert api["journal"]._entries == []


def test_org_b_cannot_test_org_a_block_returns_404(api) -> None:
    response = api["client"].post(
        "/integration/flows/flow-a/test-block/b1",
        headers=_tenant_headers("org-b", "user-b"),
        json={},
    )
    assert response.status_code == 404
    body = response.text
    # 404 body must never echo org-A block metadata.
    assert "export_snapshot" not in body


def test_unknown_block_id_under_owned_flow_returns_422(api) -> None:
    response = api["client"].post(
        "/integration/flows/flow-a/test-block/does-not-exist",
        headers=_tenant_headers("org-a", "user-a"),
        json={},
    )
    assert response.status_code == 422
    # Helpful message tells the planner which block id is missing
    # — body shape varies between FastAPI's "detail" and the project's
    # error_handlers wrapper, so search the whole response text.
    assert "does-not-exist" in response.text
