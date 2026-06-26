"""Phase 9.5 — import_snapshot must re-emit `snapshot` so import → run chains.

Regression for the bug surfaced in the 2026-05-08 E2E audit: the v1
ERP-import template chains `import_snapshot → run_scheduling_from_snapshot`,
but the runner's extract_snapshot() requires `output['snapshot']` to be
populated. Pre-fix, import_snapshot returned only `import_result` keys
and the chain failed with "Flow block run does not include a canonical
snapshot payload."
"""

from __future__ import annotations

import pytest

from planiadvance_v2.application.ports import (
    IntegrationFlow,
    IntegrationFlowBlock,
)
from planiadvance_v2.application.use_cases import (
    ExportPlanningSnapshot,
    ExportPublishedPlan,
    ImportPlanningSnapshot,
    RunIntegrationFlow,
    RunSchedulingFromSnapshot,
)
from planiadvance_v2.application.use_cases.integration_flows import (
    RunIntegrationFlowInput,
)
from planiadvance_v2.infrastructure.in_memory.repositories import (
    InMemoryCalendarRepository,
    InMemoryIntegrationBindingRepository,
    InMemoryIntegrationConnectorRepository,
    InMemoryIntegrationFlowRepository,
    InMemoryIntegrationJournalRepository,
    InMemoryInventoryRepository,
    InMemoryMachineRepository,
    InMemoryResourceRepository,
    InMemoryScheduleRepository,
    InMemorySupplyRepository,
    InMemoryWorkOrderRepository,
)
from planiadvance_v2.infrastructure.integration_http import (
    EnvIntegrationSecretResolver,
)


class _NullHttpTransport:
    def request(self, request):  # pragma: no cover
        raise NotImplementedError


@pytest.fixture
def runner_factory():
    def _build():
        flows = InMemoryIntegrationFlowRepository()
        journal = InMemoryIntegrationJournalRepository()
        calendars = InMemoryCalendarRepository()
        machines = InMemoryMachineRepository()
        work_orders = InMemoryWorkOrderRepository()
        resources = InMemoryResourceRepository()
        inventory = InMemoryInventoryRepository()
        supplies = InMemorySupplyRepository()
        bindings = InMemoryIntegrationBindingRepository()
        connectors = InMemoryIntegrationConnectorRepository()
        schedules = InMemoryScheduleRepository()
        runner = RunIntegrationFlow(
            flows=flows,
            journal=journal,
            exporter=ExportPlanningSnapshot(
                work_orders=work_orders,
                machines=machines,
                calendars=calendars,
                resources=resources,
                inventory=inventory,
                supplies=supplies,
            ),
            plan_exporter=ExportPublishedPlan(schedules=schedules),
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
        return runner, flows, work_orders

    return _build


def test_import_to_run_chain_succeeds(runner_factory):
    """The full v1-template chain export → validate → require → import → run
    must complete without 'snapshot payload missing' errors."""
    runner, flows, work_orders = runner_factory()
    flow = IntegrationFlow(
        id="f-import-run",
        name="import then run",
        source_system="studio_v2",
        organization_id="org-A",
        blocks=[
            IntegrationFlowBlock(id="export", block_type="export_snapshot"),
            IntegrationFlowBlock(
                id="validate",
                block_type="validate_snapshot",
                input_block_id="export",
            ),
            IntegrationFlowBlock(
                id="require",
                block_type="require_valid_snapshot",
                input_block_id="validate",
            ),
            IntegrationFlowBlock(
                id="import_block",
                block_type="import_snapshot",
                input_block_id="require",
            ),
            IntegrationFlowBlock(
                id="run",
                block_type="run_scheduling_from_snapshot",
                input_block_id="import_block",
                config={
                    "horizon_days": 30,
                    "heuristic": "edd",
                    "strategy": "greedy",
                },
            ),
        ],
    )
    flows.save(flow)
    out = runner.execute(
        RunIntegrationFlowInput(
            flow_id="f-import-run",
            organization_id="org-A",
            workspace_id=None,
        )
    )
    statuses = {r.block_id: r.status for r in out.block_results}
    assert statuses["import_block"] == "imported"
    # The workspace is empty so scheduling fails on "no machine" — that
    # is fine; the regression is the OLD pre-fix message
    # "Flow block run does not include a canonical snapshot payload."
    run_msg = next(
        r for r in out.block_results if r.block_id == "run"
    ).message or ""
    assert (
        "does not include a canonical snapshot payload" not in run_msg
    ), f"import → run chain still drops the snapshot: {run_msg}"


def test_validate_block_message_summarises_errors_when_invalid(runner_factory):
    """When validation rejects the snapshot, the block_result.message must
    surface the failure (count + first error) instead of repeating the
    generic "validated against the canonical contract" string. The Studio
    v2 Logs tab reads block_result.message verbatim."""
    from datetime import datetime

    from planiadvance_v2.domain.entities import Operation, WorkOrder
    from planiadvance_v2.domain.value_objects import Duration

    runner, flows, work_orders = runner_factory()
    work_orders.add(
        WorkOrder(
            id="WO-X",
            name="broken WO",
            product_id="P-X",
            quantity=1,
            due_date=datetime(2026, 5, 20),
            release_date=datetime(2026, 5, 10),
            organization_id="org-A",
            operations=[
                Operation(
                    id="OP-X",
                    work_order_id="WO-X",
                    sequence=10,
                    name="cut",
                    duration=Duration.from_minutes(60),
                    eligible_machine_ids=["GHOST-MACHINE"],
                )
            ],
        )
    )
    flow = IntegrationFlow(
        id="f-validate-fail",
        name="validate broken",
        source_system="studio_v2",
        organization_id="org-A",
        blocks=[
            IntegrationFlowBlock(id="export", block_type="export_snapshot"),
            IntegrationFlowBlock(
                id="validate",
                block_type="validate_snapshot",
                input_block_id="export",
            ),
        ],
    )
    flows.save(flow)

    out = runner.execute(
        RunIntegrationFlowInput(
            flow_id="f-validate-fail",
            organization_id="org-A",
            workspace_id=None,
        )
    )

    validate_result = next(
        r for r in out.block_results if r.block_id == "validate"
    )
    assert validate_result.status == "blocked"
    msg = validate_result.message or ""
    assert "Validation found" in msg, msg
    assert "error(s)" in msg, msg
    assert "GHOST-MACHINE" in msg, msg
    assert "validated against the canonical contract" not in msg, msg


def test_validate_block_message_stays_positive_when_valid(runner_factory):
    """A valid snapshot keeps the original confirmation message so the
    success path is unchanged."""
    runner, flows, work_orders = runner_factory()
    flow = IntegrationFlow(
        id="f-validate-ok",
        name="validate empty",
        source_system="studio_v2",
        organization_id="org-A",
        blocks=[
            IntegrationFlowBlock(id="export", block_type="export_snapshot"),
            IntegrationFlowBlock(
                id="validate",
                block_type="validate_snapshot",
                input_block_id="export",
            ),
        ],
    )
    flows.save(flow)

    out = runner.execute(
        RunIntegrationFlowInput(
            flow_id="f-validate-ok",
            organization_id="org-A",
            workspace_id=None,
        )
    )

    validate_result = next(
        r for r in out.block_results if r.block_id == "validate"
    )
    assert validate_result.message == (
        "Snapshot validated against the canonical contract."
    )


def test_enrich_with_master_data_borrows_workspace_machines(runner_factory):
    """An ERP source typically ships work orders only — operations point at
    machine ids that live in the APS master data. The enrich block borrows
    machines / calendars / resources from the active workspace when the
    incoming snapshot leaves them empty.

    We hit the block directly because using export_snapshot as the source
    would pre-fill the machines tuple from the workspace, hiding the gap
    we want to test."""
    from datetime import datetime, time

    from planiadvance_v2.application.integration.canonical_snapshot import (
        CanonicalPlanningSnapshot,
    )
    from planiadvance_v2.application.use_cases.integration_flows import (
        snapshot_envelope,
    )
    from planiadvance_v2.domain.entities import Machine, WorkingCalendar
    from planiadvance_v2.domain.value_objects import Shift

    runner, _, _ = runner_factory()
    runner._importer._calendars.add(
        WorkingCalendar(
            id="CAL-1",
            name="Day shift",
            shifts=[
                Shift(weekday=d, start=time(8, 0), end=time(17, 0))
                for d in range(5)
            ],
            organization_id="org-A",
        )
    )
    runner._importer._machines.add(
        Machine(
            id="LASER-1",
            name="Laser",
            calendar_id="CAL-1",
            capabilities=["LASER"],
            organization_id="org-A",
        )
    )

    erp_only_snapshot = CanonicalPlanningSnapshot(
        contract_version="aps.canonical.v1",
        exported_at=datetime(2026, 5, 10),
        source_system="erp",
        calendars=(),
        machines=(),
    )
    flow = IntegrationFlow(
        id="f-direct",
        name="direct",
        source_system="erp",
        organization_id="org-A",
    )
    block = IntegrationFlowBlock(id="enrich", block_type="enrich_with_master_data")

    output, status, message = runner._execute_block(
        flow=flow,
        block=block,
        input_value=snapshot_envelope(erp_only_snapshot),
        organization_id="org-A",
        workspace_id=None,
    )

    assert status == "ready"
    assert "+1 machines" in message
    assert "+1 calendars" in message
    assert output["entity_counts"]["machines"] == 1
    assert output["entity_counts"]["calendars"] == 1


def test_enrich_with_master_data_keeps_existing_collections(runner_factory):
    """When the upstream source already shipped machines, the enrich block
    must NOT overwrite them with the workspace copy — the source wins."""
    from datetime import datetime

    from planiadvance_v2.application.integration.canonical_snapshot import (
        CanonicalMachine,
        CanonicalPlanningSnapshot,
    )
    from planiadvance_v2.application.use_cases.integration_flows import (
        snapshot_envelope,
    )

    runner, _, _ = runner_factory()
    snapshot_with_machines = CanonicalPlanningSnapshot(
        contract_version="aps.canonical.v1",
        exported_at=datetime(2026, 5, 10),
        source_system="erp",
        calendars=(),
        machines=(
            CanonicalMachine(
                id="ERP-MACHINE",
                name="From ERP",
                calendar_id="CAL-X",
                capabilities=("X",),
            ),
        ),
    )
    flow = IntegrationFlow(
        id="f-direct",
        name="direct",
        source_system="erp",
        organization_id="org-A",
    )
    block = IntegrationFlowBlock(id="enrich", block_type="enrich_with_master_data")

    output, _, message = runner._execute_block(
        flow=flow,
        block=block,
        input_value=snapshot_envelope(snapshot_with_machines),
        organization_id="org-A",
        workspace_id=None,
    )

    assert "+0 machines" in message
    assert output["entity_counts"]["machines"] == 1
    assert output["snapshot"]["machines"][0]["id"] == "ERP-MACHINE"
