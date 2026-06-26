"""V1.2 P1.1 — pre-flight readiness check on /flows/{id}/run.

Before this slice, a flow with a missing or stale connector reference
went all the way into the engine before failing half-way through. The
planner saw a 500 with no clear cause, and any blocks that had already
run had committed their side-effects. The route now calls
``evaluate_readiness`` BEFORE handing the flow to the engine, and
refuses with 422 if any runtime-fatal issue is detected.

The allowlist is intentionally small: only connector / credential /
structurally-malformed-flow codes block. UX hygiene codes (flow name
missing, database mapping incomplete) are NOT blockers — the runtime
handles those gracefully (e.g. preview-only mode for database blocks),
and gating them would refuse legitimate sandbox runs.
"""

from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.testclient import TestClient

from planiadvance_v2.api.dependencies import (
    get_audit_event_repository,
    get_db_session,
    get_manage_integration_flows,
    get_run_integration_flow,
)
from planiadvance_v2.api.routes import integration as integration_route
from planiadvance_v2.api.security import (
    IntegrationAccess,
    IntegrationPrincipal,
    require_integration_run_access,
)
from planiadvance_v2.api.tenant import TenantContext, get_tenant_context
from planiadvance_v2.application.ports import (
    IntegrationFlow,
    IntegrationFlowBlock,
)
from planiadvance_v2.application.use_cases.integration_flows import (
    ManageIntegrationFlows,
)
from planiadvance_v2.infrastructure.in_memory.repositories import (
    InMemoryAuditEventRepository,
    InMemoryIntegrationConnectorRepository,
    InMemoryIntegrationFlowRepository,
)


class _RunRecorder:
    """Stub that fails the test if /run reaches the engine. P1.1 must
    short-circuit on readiness blockers BEFORE this is called."""

    def __init__(self) -> None:
        self.calls: list = []

    def execute(self, command):  # pragma: no cover
        self.calls.append(command)
        raise AssertionError(
            "Pre-flight readiness check did not block: the engine "
            "was invoked despite a runtime-fatal readiness issue."
        )


class _CapturingRunner:
    """Stub that records the run command but doesn't really execute."""

    def __init__(self) -> None:
        self.calls: list = []

    def execute(self, command):
        self.calls.append(command)
        # Return a minimal result object the route can serialize. Use
        # a SimpleNamespace mimic so we don't have to drag the full
        # RunIntegrationFlowOutput dataclass in.
        from types import SimpleNamespace

        return SimpleNamespace(
            flow=SimpleNamespace(
                id=command.flow_id,
                name="test-flow",
                source_system="erp",
                organization_id=command.organization_id,
                workspace_id=command.workspace_id,
                is_enabled=True,
                blocks=[],
                last_status="ready",
                last_message="ok",
                last_run_at=None,
                created_by_user_id=None,
                created_at=__import__("datetime").datetime(2026, 5, 18, 12, 0, 0),
                updated_at=__import__("datetime").datetime(2026, 5, 18, 12, 0, 0),
            ),
            status="ready",
            message="ok",
            block_results=[],
            result={},
            execution_scope={
                "run_id": "run-stub",
                "block_ids": [],
                "block_count": 0,
                "started_at": "2026-05-18T12:00:00",
                "completed_at": "2026-05-18T12:00:00",
                "final_block_id": None,
                "wall_time_ms": 0,
            },
            journal_entry=None,
        )


def _dummy_session():
    class _S:
        def commit(self):
            return None

    yield _S()


def _build_app(
    *,
    flow: IntegrationFlow | None,
    runner,
) -> tuple[FastAPI, InMemoryIntegrationConnectorRepository]:
    app = FastAPI()
    app.include_router(integration_route.router)

    @asynccontextmanager
    async def _noop_lifespan(_app):
        yield

    app.router.lifespan_context = _noop_lifespan

    flows_repo = InMemoryIntegrationFlowRepository()
    if flow is not None:
        flows_repo.save(flow)
    connectors_repo = InMemoryIntegrationConnectorRepository()

    flows_use_case = ManageIntegrationFlows(
        flows_repo,
        connectors=connectors_repo,
    )

    app.dependency_overrides[get_run_integration_flow] = lambda: runner
    app.dependency_overrides[get_manage_integration_flows] = lambda: flows_use_case
    app.dependency_overrides[get_audit_event_repository] = (
        lambda: InMemoryAuditEventRepository()
    )
    app.dependency_overrides[get_db_session] = _dummy_session
    app.dependency_overrides[get_tenant_context] = lambda: TenantContext(
        organization_id="org-a",
        user_id="user-a",
        role="owner",
    )
    app.dependency_overrides[require_integration_run_access] = lambda: (
        IntegrationPrincipal(
            auth_mode="session",
            access_scope=IntegrationAccess.RUN,
            key_type="session",
            client_id="user-a",
            organization_id="org-a",
            workspace_id=None,
        )
    )
    return app, connectors_repo


def _trigger_block() -> IntegrationFlowBlock:
    return IntegrationFlowBlock(id="trigger", block_type="trigger_manual")


def _call_api_block(connector_id: str | None = None) -> IntegrationFlowBlock:
    """call_connector_api is the block type the readiness evaluator
    actually inspects today (Odoo blocks are only validated at runtime
    in _execute_block — P1.1b will extend the readiness to cover them).
    Using this block lets us prove the route-level pre-flight gate
    fires correctly on connector_missing, with the simplest fixture."""

    config: dict[str, object] = {}
    if connector_id is not None:
        config["connector_id"] = connector_id
    return IntegrationFlowBlock(
        id="push",
        block_type="call_connector_api",
        input_block_id="trigger",
        config=config,
    )


def test_run_blocked_when_connector_missing():
    """Most common pilot trip-wire: the flow points at a connector_id
    that was deleted (slice 7B let planners delete connectors). Pre-flight
    must surface the connector_missing blocker BEFORE the engine starts."""

    flow = IntegrationFlow(
        id="f-1",
        name="Push to Odoo",
        source_system="odoo",
        organization_id="org-a",
        blocks=[_trigger_block(), _call_api_block(connector_id="icn-deleted")],
    )
    runner = _RunRecorder()  # fails if engine is invoked
    app, _ = _build_app(flow=flow, runner=runner)

    response = TestClient(app).post("/integration/flows/f-1/run")

    assert response.status_code == 422
    body = response.json()
    assert body["detail"]["error"] == "flow_not_ready"
    codes = [b["code"] for b in body["detail"]["blockers"]]
    assert "connector_missing" in codes
    # Engine was NEVER invoked — runner.calls is empty.
    assert runner.calls == []


def test_run_blocked_when_no_connector_id_configured():
    """The block has no connector_id at all → connector_missing too."""

    flow = IntegrationFlow(
        id="f-2",
        name="Push to Odoo",
        source_system="odoo",
        organization_id="org-a",
        blocks=[_trigger_block(), _call_api_block(connector_id=None)],
    )
    runner = _RunRecorder()
    app, _ = _build_app(flow=flow, runner=runner)

    response = TestClient(app).post("/integration/flows/f-2/run")

    assert response.status_code == 422
    assert response.json()["detail"]["error"] == "flow_not_ready"
    assert runner.calls == []


def test_run_proceeds_when_flow_is_ready():
    """Happy path: real connector exists, block points at it. The
    pre-flight passes through and the engine is invoked."""

    flow = IntegrationFlow(
        id="f-3",
        name="Push to Odoo",
        source_system="odoo",
        organization_id="org-a",
        blocks=[_trigger_block(), _call_api_block(connector_id="icn-real")],
    )
    runner = _CapturingRunner()
    app, connectors_repo = _build_app(flow=flow, runner=runner)

    # Seed a valid connector matching the block.
    from planiadvance_v2.application.ports import IntegrationConnector

    connectors_repo.save(
        IntegrationConnector(
            id="icn-real",
            name="Odoo prod",
            endpoint_url="https://api.example.com",
            source_system="erp",
            connector_type="http",
            organization_id="org-a",
            method="POST",
            auth_type="basic",
            username="admin",
            secret_ref="sealed:dummy",
        )
    )

    response = TestClient(app).post("/integration/flows/f-3/run")

    assert response.status_code == 200, response.text
    # Engine was invoked exactly once.
    assert len(runner.calls) == 1
    assert runner.calls[0].flow_id == "f-3"


def test_disabled_flow_passes_preflight_but_engine_handles():
    """An is_enabled=False flow is a warning in readiness, not a blocker.
    Pre-flight allows it through; the engine's own gate (RunIntegrationFlow.execute
    raises flow_disabled → 409) is the authoritative refusal. We don't want
    pre-flight duplicating that check or pre-empting the canonical error code."""

    flow = IntegrationFlow(
        id="f-4",
        name="Push to Odoo",
        source_system="odoo",
        organization_id="org-a",
        is_enabled=False,  # flagged as readiness WARNING, not blocker
        blocks=[_trigger_block(), _call_api_block(connector_id="icn-real")],
    )
    runner = _CapturingRunner()
    app, connectors_repo = _build_app(flow=flow, runner=runner)

    from planiadvance_v2.application.ports import IntegrationConnector

    connectors_repo.save(
        IntegrationConnector(
            id="icn-real",
            name="Odoo prod",
            endpoint_url="https://api.example.com",
            source_system="erp",
            connector_type="http",
            organization_id="org-a",
            method="POST",
            auth_type="basic",
            username="admin",
            secret_ref="sealed:dummy",
        )
    )

    response = TestClient(app).post("/integration/flows/f-4/run")

    # Pre-flight does NOT block (warning, not blocker). Engine takes
    # the call (and in production would refuse with 409 flow_disabled
    # — that's the canonical path, not pre-flight's job).
    assert response.status_code == 200, response.text
    assert len(runner.calls) == 1
