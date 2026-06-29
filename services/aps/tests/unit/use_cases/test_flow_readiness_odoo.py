"""V1.2 P1.1b — readiness rules cover the 3 Odoo block types.

Before this slice, ``evaluate_readiness`` only validated HTTP / SFTP /
database blocks. An Odoo flow pointing at a deleted connector (slice
7B let planners delete connectors) reached engine dispatch before
failing — same root cause, but the planner saw the error mid-execution
instead of in the readiness panel at design time. The route-level
pre-flight gate (P1.1) recognises connector_* codes, so wiring Odoo
blocks through the same `_connector_readiness` helper unlocks both
the design-time panel AND the pre-flight 422 path.

These tests pin the contract for all three Odoo block types so a
future refactor of the readiness dispatch can't silently drop them
again.
"""

from __future__ import annotations

import pytest

from planiadvance_v2.application.ports import (
    IntegrationConnector,
    IntegrationFlowBlock,
)
from planiadvance_v2.application.use_cases.integration_flows import (
    EvaluateIntegrationFlowReadinessInput,
    ManageIntegrationFlows,
)
from planiadvance_v2.infrastructure.in_memory.repositories import (
    InMemoryIntegrationConnectorRepository,
    InMemoryIntegrationFlowRepository,
)


def _use_case(connectors_repo: InMemoryIntegrationConnectorRepository) -> ManageIntegrationFlows:
    return ManageIntegrationFlows(
        flows=InMemoryIntegrationFlowRepository(),
        connectors=connectors_repo,
    )


def _seed_odoo_connector(
    repo: InMemoryIntegrationConnectorRepository,
    *,
    connector_id: str = "icn-odoo-prod",
    organization_id: str = "org-a",
) -> IntegrationConnector:
    connector = IntegrationConnector(
        id=connector_id,
        name="Odoo prod",
        endpoint_url="http://odoo:8069/db",
        source_system="odoo",
        organization_id=organization_id,
        connector_type="odoo",
        method="POST",
        auth_type="basic",
        username="admin",
        secret_ref="env:ODOO_API_KEY",
    )
    repo.save(connector)
    return connector


def _readiness_input(blocks: list[IntegrationFlowBlock]) -> EvaluateIntegrationFlowReadinessInput:
    return EvaluateIntegrationFlowReadinessInput(
        name="Test flow",
        source_system="odoo",
        organization_id="org-a",
        blocks=blocks,
    )


def _trigger_block() -> IntegrationFlowBlock:
    """Manual trigger so `odoo_push_schedule` (which is in
    FLOW_BLOCK_TYPES_REQUIRING_INPUT) doesn't trip the
    `input_block_required` structural blocker."""

    return IntegrationFlowBlock(id="trigger", block_type="trigger_manual")


def _odoo_block(
    block_type: str,
    *,
    config: dict[str, object] | None = None,
) -> IntegrationFlowBlock:
    """odoo_push_schedule needs an input edge; the other two don't."""

    if block_type == "odoo_push_schedule":
        return IntegrationFlowBlock(
            id="b1",
            block_type=block_type,
            input_block_id="trigger",
            config=config or {},
        )
    return IntegrationFlowBlock(id="b1", block_type=block_type, config=config or {})


def _flow_blocks(block_type: str, *, config: dict[str, object] | None = None) -> list[IntegrationFlowBlock]:
    if block_type == "odoo_push_schedule":
        return [_trigger_block(), _odoo_block(block_type, config=config)]
    return [_odoo_block(block_type, config=config)]


@pytest.mark.parametrize(
    "block_type",
    ["odoo_search_read", "odoo_planning_snapshot", "odoo_push_schedule"],
)
def test_missing_connector_id_is_a_blocker(block_type: str):
    """No connector_id in config → `block_config_invalid` blocker. The
    Odoo entry in _validate_block_config (added by P1.1b) catches this
    in the same way HTTP / SFTP blocks do — required-config-missing is
    the canonical "engine can't dispatch this" signal."""

    connectors = InMemoryIntegrationConnectorRepository()
    use_case = _use_case(connectors)

    result = use_case.evaluate_readiness(_readiness_input(_flow_blocks(block_type)))

    codes = [issue.code for issue in result.blockers]
    assert "block_config_invalid" in codes
    assert result.status == "blocked"


@pytest.mark.parametrize(
    "block_type",
    ["odoo_search_read", "odoo_planning_snapshot", "odoo_push_schedule"],
)
def test_unknown_connector_id_is_a_blocker(block_type: str):
    """A connector_id pointing at a non-existent (or deleted) connector
    → connector_missing blocker. This is the slice-7B failure mode —
    planner deletes a connector that flow blocks still reference."""

    connectors = InMemoryIntegrationConnectorRepository()
    use_case = _use_case(connectors)
    blocks = _flow_blocks(block_type, config={"connector_id": "icn-deleted"})

    result = use_case.evaluate_readiness(_readiness_input(blocks))

    codes = [issue.code for issue in result.blockers]
    assert "connector_missing" in codes


@pytest.mark.parametrize(
    "block_type",
    ["odoo_search_read", "odoo_planning_snapshot", "odoo_push_schedule"],
)
def test_wrong_connector_type_is_a_blocker(block_type: str):
    """A flow that points at an HTTP connector by mistake →
    connector_type_mismatch. This catches the realistic planner error
    where the connector picker filter slipped (Studio v2 picker is
    constrained to odoo via the config_fields metadata, but defensive
    server-side check protects against API-direct payloads)."""

    connectors = InMemoryIntegrationConnectorRepository()
    # Seed an HTTP connector with the id the block points at.
    connectors.save(
        IntegrationConnector(
            id="icn-http",
            name="Some HTTP API",
            endpoint_url="https://api.example.com",
            source_system="erp",
            organization_id="org-a",
            connector_type="http",
            method="POST",
            auth_type="none",
        )
    )
    use_case = _use_case(connectors)
    blocks = _flow_blocks(block_type, config={"connector_id": "icn-http"})

    result = use_case.evaluate_readiness(_readiness_input(blocks))

    codes = [issue.code for issue in result.blockers]
    assert "connector_type_mismatch" in codes


@pytest.mark.parametrize(
    "block_type",
    ["odoo_search_read", "odoo_planning_snapshot", "odoo_push_schedule"],
)
def test_valid_odoo_connector_is_ready(block_type: str):
    """Happy path: connector exists, type matches, no connector
    blockers on the block."""

    connectors = InMemoryIntegrationConnectorRepository()
    _seed_odoo_connector(connectors)
    use_case = _use_case(connectors)
    blocks = _flow_blocks(block_type, config={"connector_id": "icn-odoo-prod"})

    result = use_case.evaluate_readiness(_readiness_input(blocks))

    odoo_block_issues = next(
        (b.issues for b in result.blocks if b.block_id == "b1"), ()
    )
    odoo_block_blocker_codes = [
        issue.code
        for issue in odoo_block_issues
        if issue.severity == "blocked"
    ]
    assert "connector_missing" not in odoo_block_blocker_codes
    assert "connector_type_mismatch" not in odoo_block_blocker_codes
    assert "connector_disabled" not in odoo_block_blocker_codes
    assert "block_config_invalid" not in odoo_block_blocker_codes


def test_disabled_odoo_connector_is_a_blocker():
    """Slice 7B added Disable/Enable on the Connectors page. A disabled
    Odoo connector still exists but cannot run — readiness must catch
    that (otherwise the flow runs and fails at engine dispatch)."""

    connectors = InMemoryIntegrationConnectorRepository()
    connector = _seed_odoo_connector(connectors)
    # Disable it after seeding (mirrors what the UI does on toggle).
    connector.is_enabled = False
    connectors.save(connector)

    use_case = _use_case(connectors)
    blocks = _flow_blocks(
        "odoo_push_schedule", config={"connector_id": "icn-odoo-prod"}
    )

    result = use_case.evaluate_readiness(_readiness_input(blocks))

    codes = [issue.code for issue in result.blockers]
    assert "connector_disabled" in codes
