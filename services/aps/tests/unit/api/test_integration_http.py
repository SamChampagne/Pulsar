from __future__ import annotations

import json
from contextlib import asynccontextmanager
from dataclasses import replace
from datetime import datetime, timedelta

from fastapi.testclient import TestClient

from planiadvance_v2.api.dependencies import (
    get_export_planning_snapshot,
    get_export_published_plan,
    get_import_planning_snapshot,
    get_integration_api_clients,
    get_integration_automation_health,
    get_integration_automations,
    get_integration_executions,
    get_integration_flows,
    get_integration_journal,
    get_list_accessible_workspaces,
    get_manage_integration_api_clients,
    get_manage_integration_connectors,
    get_manage_integration_credentials,
    get_manage_integration_flows,
    get_run_due_integration_automations,
    get_run_integration_automation,
    get_run_integration_flow,
    get_run_scheduling_from_snapshot,
)
from planiadvance_v2.api.main import create_app
from planiadvance_v2.api.tenant import (
    get_tenant_membership_repository,
    get_tenant_organization_repository,
    get_tenant_workspace_repository,
)
from planiadvance_v2.application.integration.snapshot_codec import planning_snapshot_to_json
from planiadvance_v2.application.ports import (
    IntegrationDatabaseColumnSchema,
    IntegrationDatabaseSchemaResult,
    IntegrationDatabaseTableSchema,
    IntegrationDatabaseTestResult,
    IntegrationDatabaseWriteResult,
    IntegrationHttpResponse,
    IntegrationSftpPutResult,
    IntegrationSftpTestResult,
)
from planiadvance_v2.application.use_cases import (
    ExportPlanningSnapshot,
    ExportPlanningSnapshotInput,
    ExportPublishedPlan,
    GetIntegrationAutomationHealth,
    ImportPlanningSnapshot,
    ListAccessibleWorkspaces,
    ManageIntegrationApiClients,
    ManageIntegrationConnectors,
    ManageIntegrationCredentials,
    ManageIntegrationFlows,
    RunDueIntegrationAutomations,
    RunIntegrationAutomation,
    RunIntegrationFlow,
    RunSchedulingFromSnapshot,
)
from planiadvance_v2.config import get_settings
from planiadvance_v2.domain.entities import (
    InventoryItem,
    Membership,
    MembershipRole,
    Organization,
    Schedule,
    ScheduledOperation,
    SupplyLot,
    Workspace,
)
from planiadvance_v2.infrastructure.in_memory.repositories import (
    InMemoryCalendarRepository,
    InMemoryIntegrationApiClientRepository,
    InMemoryIntegrationAutomationRepository,
    InMemoryIntegrationBindingRepository,
    InMemoryIntegrationConnectorRepository,
    InMemoryIntegrationCredentialRepository,
    InMemoryIntegrationExecutionRepository,
    InMemoryIntegrationFlowRepository,
    InMemoryIntegrationJournalRepository,
    InMemoryInventoryRepository,
    InMemoryMachineRepository,
    InMemoryMembershipRepository,
    InMemoryOrganizationRepository,
    InMemoryResourceRepository,
    InMemoryScheduleRepository,
    InMemorySupplyRepository,
    InMemoryWorkOrderRepository,
    InMemoryWorkspaceAccessGrantRepository,
    InMemoryWorkspaceRepository,
)
from tests.support.reference_scenarios import build_stressed_reference_workshop


class _FixedSecretResolver:
    def __init__(self, values: dict[str, str] | None = None) -> None:
        self._values = dict(values or {"env:ERP_TOKEN": "token-demo"})

    def resolve(self, secret_ref: str) -> str:
        return self._values[secret_ref]

    def seal(self, secret_value: str) -> str:
        secret_ref = f"sealed:{secret_value}"
        self._values[secret_ref] = secret_value
        return secret_ref


class _RecordingHttpTransport:
    def __init__(self) -> None:
        self.requests = []
        self._responses: list[IntegrationHttpResponse] = []

    def queue_response(
        self,
        *,
        status_code: int = 200,
        body: bytes = b"{}",
        headers: dict[str, str] | None = None,
    ) -> None:
        self._responses.append(
            IntegrationHttpResponse(
                status_code=status_code,
                headers=dict(headers or {}),
                body=body,
            )
        )

    def send(self, request):
        self.requests.append(request)
        if self._responses:
            return self._responses.pop(0)
        return IntegrationHttpResponse(status_code=200, headers={}, body=b"{}")


class _RecordingSftpTransport:
    def __init__(self) -> None:
        self.put_requests = []
        self.test_requests = []
        self.fail_with: Exception | None = None

    def put_file(self, request):
        self.put_requests.append(request)
        if self.fail_with is not None:
            raise self.fail_with
        return IntegrationSftpPutResult(
            path=request.path,
            bytes_written=len(request.body),
        )

    def test_connection(self, request):
        self.test_requests.append(request)
        if self.fail_with is not None:
            raise self.fail_with
        return IntegrationSftpTestResult(
            ok=True,
            message=f"SFTP connection succeeded for {request.path or '/'}",
            path=request.path,
        )


class _RecordingDatabaseTransport:
    def __init__(self) -> None:
        self.write_requests = []
        self.test_requests = []
        self.schema_requests = []
        self.fail_with: Exception | None = None

    def write_rows(self, request):
        self.write_requests.append(request)
        if self.fail_with is not None:
            raise self.fail_with
        return IntegrationDatabaseWriteResult(
            table_name=request.table_name,
            operation=request.operation,
            rows_received=len(request.rows),
            rows_written=len(request.rows),
            rows_inserted=len(request.rows) if request.operation == "insert" else 0,
            rows_updated=len(request.rows) if request.operation != "insert" else 0,
            dialect="sqlite",
            database="warehouse.db",
        )

    def test_connection(self, request):
        self.test_requests.append(request)
        if self.fail_with is not None:
            raise self.fail_with
        return IntegrationDatabaseTestResult(
            ok=True,
            message="Database connection succeeded for sqlite/warehouse.db.",
            dialect="sqlite",
            database="warehouse.db",
        )

    def inspect_schema(self, request):
        self.schema_requests.append(request)
        if self.fail_with is not None:
            raise self.fail_with
        return IntegrationDatabaseSchemaResult(
            dialect="sqlite",
            database="warehouse.db",
            tables=[
                IntegrationDatabaseTableSchema(
                    name="planned_orders",
                    full_name="planned_orders",
                    columns=[
                        IntegrationDatabaseColumnSchema(
                            name="order_id",
                            data_type="TEXT",
                            nullable=False,
                            is_primary_key=True,
                        ),
                        IntegrationDatabaseColumnSchema(
                            name="item_code",
                            data_type="TEXT",
                            nullable=True,
                        ),
                        IntegrationDatabaseColumnSchema(
                            name="qty",
                            data_type="INTEGER",
                            nullable=True,
                        ),
                        IntegrationDatabaseColumnSchema(
                            name="due_at",
                            data_type="DATETIME",
                            nullable=True,
                        ),
                    ],
                ),
                IntegrationDatabaseTableSchema(
                    name="planned_operations",
                    full_name="planned_operations",
                    columns=[
                        IntegrationDatabaseColumnSchema(
                            name="operation_id",
                            data_type="TEXT",
                            nullable=False,
                            is_primary_key=True,
                        ),
                        IntegrationDatabaseColumnSchema(
                            name="order_id",
                            data_type="TEXT",
                            nullable=False,
                        ),
                        IntegrationDatabaseColumnSchema(
                            name="operation_no",
                            data_type="INTEGER",
                            nullable=True,
                        ),
                        IntegrationDatabaseColumnSchema(
                            name="duration_min",
                            data_type="INTEGER",
                            nullable=True,
                        ),
                    ],
                ),
            ],
        )


def _integration_admin_headers(
    workspace_id: str | None = None,
) -> dict[str, str]:
    headers = {
        "X-Organization-Id": "org-demo",
        "X-User-Id": "admin-1",
    }
    if workspace_id is not None:
        headers["X-Workspace-Id"] = workspace_id
    return headers


def _apply_scope(
    items: list[object],
    *,
    organization_id: str,
    workspace_id: str | None = None,
) -> list[object]:
    return [
        replace(
            item,
            organization_id=organization_id,
            workspace_id=workspace_id,
        )
        for item in items
    ]


def _seed_published_schedules(
    *,
    schedules: InMemoryScheduleRepository,
    snapshot_json: dict[str, object],
    horizon_start: datetime,
) -> None:
    baseline = Schedule(
        id="sched-published-base",
        created_at=horizon_start + timedelta(hours=8),
        assignments=[
            ScheduledOperation(
                operation_id="RED-CUT",
                work_order_id="WO-RED",
                machine_id="CUT-1",
                setup_start=horizon_start + timedelta(hours=8),
                start=horizon_start + timedelta(hours=8, minutes=10),
                end=horizon_start + timedelta(hours=9, minutes=10),
            ),
            ScheduledOperation(
                operation_id="RED-ASM",
                work_order_id="WO-RED",
                machine_id="ASM-1",
                setup_start=horizon_start + timedelta(hours=9),
                start=horizon_start + timedelta(hours=9, minutes=10),
                end=horizon_start + timedelta(hours=10, minutes=10),
            ),
            ScheduledOperation(
                operation_id="BLUE-CUT",
                work_order_id="WO-BLUE",
                machine_id="CUT-1",
                setup_start=horizon_start + timedelta(hours=11),
                start=horizon_start + timedelta(hours=11, minutes=20),
                end=horizon_start + timedelta(hours=12, minutes=20),
            ),
        ],
    )
    current = Schedule(
        id="sched-published-current",
        created_at=horizon_start + timedelta(days=1, hours=8),
        assignments=[
            ScheduledOperation(
                operation_id="RED-CUT",
                work_order_id="WO-RED",
                machine_id="CUT-1",
                setup_start=horizon_start + timedelta(hours=8),
                start=horizon_start + timedelta(hours=8, minutes=10),
                end=horizon_start + timedelta(hours=9, minutes=10),
            ),
            ScheduledOperation(
                operation_id="RED-ASM",
                work_order_id="WO-RED",
                machine_id="ASM-2",
                setup_start=horizon_start + timedelta(days=1, hours=9),
                start=horizon_start + timedelta(days=1, hours=9, minutes=20),
                end=horizon_start + timedelta(days=1, hours=10, minutes=20),
            ),
            ScheduledOperation(
                operation_id="GREEN-CUT",
                work_order_id="WO-GREEN",
                machine_id="CUT-1",
                setup_start=horizon_start + timedelta(days=1, hours=11),
                start=horizon_start + timedelta(days=1, hours=11, minutes=10),
                end=horizon_start + timedelta(days=1, hours=12),
            ),
        ],
    )
    common_kwargs = {
        "metrics": {
            "makespan_minutes": 600,
            "total_lateness_minutes": 0,
            "on_time_ratio": 1.0,
        },
        "strategy": "greedy",
        "solver_status": "feasible",
        "objective_value": 100,
        "wall_time_ms": 25,
        "diagnostics": {},
        "workspace_id": "plant-a",
        "organization_id": "org-demo",
        "lifecycle_status": "published",
        "input_snapshot": snapshot_json,
        "input_snapshot_hash": "snap-demo-hash",
        "engine_version": "aps-engine.v1",
    }
    schedules.save(
        baseline,
        scenario_name="Published Base",
        **common_kwargs,
    )
    schedules.save(
        current,
        scenario_name="Published Current",
        **common_kwargs,
    )


def _erp_api_payload_from_snapshot(snapshot_json: dict[str, object]) -> dict[str, object]:
    work_orders = []
    operations = []
    for work_order in snapshot_json.get("work_orders", []):
        if not isinstance(work_order, dict):
            continue
        work_orders.append(
            {
                "erp_order_id": work_order.get("id"),
                "description": work_order.get("name"),
                "item_code": work_order.get("product_id"),
                "qty": work_order.get("quantity"),
                "quantity_uom": work_order.get("quantity_uom"),
                "due_at": work_order.get("due_date"),
                "release_at": work_order.get("release_date"),
                "status": work_order.get("status"),
            }
        )
        for operation in work_order.get("operations", []):
            if not isinstance(operation, dict):
                continue
            operations.append(
                {
                    "erp_operation_id": operation.get("id"),
                    "erp_order_id": work_order.get("id"),
                    "step_no": operation.get("sequence"),
                    "label": operation.get("name"),
                    "duration_min": operation.get("duration_minutes"),
                    "eligible_machine_ids": operation.get("eligible_machine_ids"),
                }
            )

    return {
        "payload": {
            "calendars": snapshot_json.get("calendars", []),
            "machines": snapshot_json.get("machines", []),
            "resources": snapshot_json.get("resources", []),
            "inventory_items": snapshot_json.get("inventory_items", []),
            "supplies": snapshot_json.get("supplies", []),
            "orders": work_orders,
            "operations": operations,
            "meta": {"source": "erp-work-orders"},
        }
    }


def _integration_api():
    workshop = build_stressed_reference_workshop()
    workshop.calendars[:] = _apply_scope(
        workshop.calendars,
        organization_id="org-demo",
        workspace_id="plant-a",
    )
    workshop.machines[:] = _apply_scope(
        workshop.machines,
        organization_id="org-demo",
        workspace_id="plant-a",
    )
    workshop.resources[:] = _apply_scope(
        workshop.resources,
        organization_id="org-demo",
        workspace_id="plant-a",
    )
    workshop.work_orders[:] = _apply_scope(
        workshop.work_orders,
        organization_id="org-demo",
        workspace_id="plant-a",
    )
    work_orders = InMemoryWorkOrderRepository(workshop.work_orders)
    machines = InMemoryMachineRepository(workshop.machines)
    calendars = InMemoryCalendarRepository(workshop.calendars)
    resources = InMemoryResourceRepository(workshop.resources)
    inventory_items = _apply_scope(
        [InventoryItem(material_id="MAT-A", quantity_on_hand=12.0)],
        organization_id="org-demo",
        workspace_id="plant-a",
    )
    inventory = InMemoryInventoryRepository(inventory_items)
    supply_lots = _apply_scope(
        [
            SupplyLot(
                id="SUP-ERP-1",
                material_id="MAT-A",
                quantity=20.0,
                available_at=workshop.horizon_start + timedelta(hours=4),
            )
        ],
        organization_id="org-demo",
        workspace_id="plant-a",
    )
    supplies = InMemorySupplyRepository(supply_lots)
    exporter = ExportPlanningSnapshot(
        work_orders=work_orders,
        machines=machines,
        calendars=calendars,
        resources=resources,
        inventory=inventory,
        supplies=supplies,
    )
    baseline_snapshot = exporter.execute(
        ExportPlanningSnapshotInput(
            source_system="erp-demo",
            organization_id="org-demo",
            workspace_id="plant-a",
        )
    )
    snapshot_json = planning_snapshot_to_json(baseline_snapshot)
    schedules = InMemoryScheduleRepository()
    _seed_published_schedules(
        schedules=schedules,
        snapshot_json=snapshot_json,
        horizon_start=workshop.horizon_start,
    )
    bindings = InMemoryIntegrationBindingRepository()
    journal = InMemoryIntegrationJournalRepository()
    executions = InMemoryIntegrationExecutionRepository()
    api_clients = InMemoryIntegrationApiClientRepository()
    connectors = InMemoryIntegrationConnectorRepository()
    credentials = InMemoryIntegrationCredentialRepository()
    flows = InMemoryIntegrationFlowRepository()
    automations = InMemoryIntegrationAutomationRepository()
    organizations = InMemoryOrganizationRepository(
        [Organization(id="org-demo", name="Demo Organization", slug="demo")]
    )
    memberships = InMemoryMembershipRepository(
        [
            Membership(
                organization_id="org-demo",
                user_id="admin-1",
                role=MembershipRole.ADMIN,
            )
        ]
    )
    workspaces = InMemoryWorkspaceRepository(
        [
            Workspace(id="plant-a", name="Plant A", organization_id="org-demo"),
            Workspace(id="plant-b", name="Plant B", organization_id="org-demo"),
        ]
    )
    workspace_access_grants = InMemoryWorkspaceAccessGrantRepository()
    secret_resolver = _FixedSecretResolver()
    http_transport = _RecordingHttpTransport()
    database_transport = _RecordingDatabaseTransport()
    sftp_transport = _RecordingSftpTransport()

    app = create_app()

    @asynccontextmanager
    async def _noop_lifespan(_app):
        yield

    app.router.lifespan_context = _noop_lifespan
    app.dependency_overrides[get_tenant_organization_repository] = lambda: organizations
    app.dependency_overrides[get_tenant_membership_repository] = lambda: memberships
    app.dependency_overrides[get_tenant_workspace_repository] = lambda: workspaces
    app.dependency_overrides[get_list_accessible_workspaces] = (
        lambda: ListAccessibleWorkspaces(
            workspaces=workspaces,
            grants=workspace_access_grants,
        )
    )
    app.dependency_overrides[get_export_planning_snapshot] = lambda: exporter
    app.dependency_overrides[get_export_published_plan] = (
        lambda: ExportPublishedPlan(schedules)
    )
    app.dependency_overrides[get_run_scheduling_from_snapshot] = (
        lambda: RunSchedulingFromSnapshot()
    )
    app.dependency_overrides[get_import_planning_snapshot] = lambda: ImportPlanningSnapshot(
        work_orders=work_orders,
        machines=machines,
        calendars=calendars,
        resources=resources,
        inventory=inventory,
        supplies=supplies,
        bindings=bindings,
    )
    app.dependency_overrides[get_integration_journal] = lambda: journal
    app.dependency_overrides[get_integration_executions] = lambda: executions
    app.dependency_overrides[get_integration_api_clients] = lambda: api_clients
    app.dependency_overrides[get_manage_integration_api_clients] = (
        lambda: ManageIntegrationApiClients(api_clients)
    )
    app.dependency_overrides[get_manage_integration_connectors] = (
        lambda: ManageIntegrationConnectors(
            connectors,
            http_transport=http_transport,
            database_transport=database_transport,
            sftp_transport=sftp_transport,
            secret_resolver=secret_resolver,
            credentials=credentials,
            executions=executions,
        )
    )
    app.dependency_overrides[get_manage_integration_credentials] = (
        lambda: ManageIntegrationCredentials(
            credentials,
            secret_resolver=secret_resolver,
        )
    )
    app.dependency_overrides[get_integration_flows] = lambda: flows
    app.dependency_overrides[get_manage_integration_flows] = (
        lambda: ManageIntegrationFlows(
            flows,
            connectors=connectors,
            credentials=credentials,
            database_transport=database_transport,
            sftp_transport=sftp_transport,
            secret_resolver=secret_resolver,
        )
    )
    app.dependency_overrides[get_run_integration_flow] = (
        lambda: RunIntegrationFlow(
            flows=flows,
            journal=journal,
            exporter=exporter,
            plan_exporter=ExportPublishedPlan(schedules),
            importer=ImportPlanningSnapshot(
                work_orders=work_orders,
                machines=machines,
                calendars=calendars,
                resources=resources,
                inventory=inventory,
                supplies=supplies,
                bindings=bindings,
            ),
            scheduler=RunSchedulingFromSnapshot(),
            connectors=connectors,
            secret_resolver=secret_resolver,
            credentials=credentials,
            http_transport=http_transport,
            database_transport=database_transport,
            sftp_transport=sftp_transport,
            executions=executions,
        )
    )
    app.dependency_overrides[get_integration_automations] = lambda: automations
    app.dependency_overrides[get_integration_automation_health] = (
        lambda: GetIntegrationAutomationHealth(automations)
    )
    app.dependency_overrides[get_run_integration_automation] = (
        lambda: RunIntegrationAutomation(
            automations=automations,
            journal=journal,
            exporter=exporter,
            plan_exporter=ExportPublishedPlan(schedules),
            importer=ImportPlanningSnapshot(
                work_orders=work_orders,
                machines=machines,
                calendars=calendars,
                resources=resources,
                inventory=inventory,
                supplies=supplies,
                bindings=bindings,
            ),
            connectors=connectors,
            secret_resolver=secret_resolver,
            credentials=credentials,
            http_transport=http_transport,
            sftp_transport=sftp_transport,
            flow_runner=RunIntegrationFlow(
                flows=flows,
                journal=journal,
                exporter=exporter,
                plan_exporter=ExportPublishedPlan(schedules),
                importer=ImportPlanningSnapshot(
                    work_orders=work_orders,
                    machines=machines,
                    calendars=calendars,
                    resources=resources,
                    inventory=inventory,
                    supplies=supplies,
                    bindings=bindings,
                ),
                scheduler=RunSchedulingFromSnapshot(),
                connectors=connectors,
                secret_resolver=secret_resolver,
                credentials=credentials,
                http_transport=http_transport,
                database_transport=database_transport,
                sftp_transport=sftp_transport,
                executions=executions,
            ),
            executions=executions,
        )
    )
    app.dependency_overrides[get_run_due_integration_automations] = (
        lambda: RunDueIntegrationAutomations(
            automations=automations,
            runner=RunIntegrationAutomation(
                automations=automations,
                journal=journal,
                exporter=exporter,
                plan_exporter=ExportPublishedPlan(schedules),
                importer=ImportPlanningSnapshot(
                    work_orders=work_orders,
                    machines=machines,
                    calendars=calendars,
                    resources=resources,
                    inventory=inventory,
                    supplies=supplies,
                    bindings=bindings,
                ),
                connectors=connectors,
                secret_resolver=secret_resolver,
                credentials=credentials,
                http_transport=http_transport,
                sftp_transport=sftp_transport,
                flow_runner=RunIntegrationFlow(
                    flows=flows,
                    journal=journal,
                    exporter=exporter,
                    plan_exporter=ExportPublishedPlan(schedules),
                    importer=ImportPlanningSnapshot(
                        work_orders=work_orders,
                        machines=machines,
                        calendars=calendars,
                        resources=resources,
                        inventory=inventory,
                        supplies=supplies,
                        bindings=bindings,
                    ),
                    scheduler=RunSchedulingFromSnapshot(),
                    connectors=connectors,
                    secret_resolver=secret_resolver,
                    credentials=credentials,
                    http_transport=http_transport,
                    database_transport=database_transport,
                    sftp_transport=sftp_transport,
                    executions=executions,
                ),
                executions=executions,
            ),
        )
    )
    app.state.integration_http_transport = http_transport
    app.state.integration_database_transport = database_transport
    app.state.integration_sftp_transport = sftp_transport

    return app


class TestIntegrationHttp:
    def test_integration_routes_require_key_when_configured(self, monkeypatch):
        monkeypatch.setenv("INTEGRATION_API_KEY", "secret-key")
        get_settings.cache_clear()
        try:
            app = _integration_api()
            with TestClient(app) as client:
                missing = client.get("/integration/journal")
                invalid = client.get(
                    "/integration/journal",
                    headers={"X-API-Key": "wrong-key"},
                )
                valid = client.get(
                    "/integration/journal",
                    headers={"X-API-Key": "secret-key"},
                )
        finally:
            get_settings.cache_clear()

        assert missing.status_code == 401
        assert missing.json()["error"] == "missing_api_key"
        assert invalid.status_code == 403
        assert invalid.json()["error"] == "invalid_api_key"
        assert valid.status_code == 200

    def test_authenticated_integration_session_can_use_protected_routes_when_key_exists(
        self, monkeypatch
    ):
        monkeypatch.setenv("INTEGRATION_API_KEY", "secret-key")
        get_settings.cache_clear()
        try:
            app = _integration_api()
            with TestClient(app) as client:
                external_missing = client.get("/integration/journal")
                session_journal = client.get(
                    "/integration/journal",
                    headers=_integration_admin_headers(),
                )
                session_export = client.post(
                    "/integration/planning-snapshot/export",
                    json={"source_system": "planiadvance-ui"},
                    headers=_integration_admin_headers(),
                )
        finally:
            get_settings.cache_clear()

        assert external_missing.status_code == 401
        assert external_missing.json()["error"] == "missing_api_key"
        assert session_journal.status_code == 200
        assert session_export.status_code == 200
        assert session_export.json()["source_system"] == "planiadvance-ui"

    def test_limited_integration_keys_enforce_scopes(self, monkeypatch):
        monkeypatch.setenv("INTEGRATION_READ_API_KEY", "read-key")
        get_settings.cache_clear()
        try:
            app = _integration_api()
            with TestClient(app) as client:
                exported = client.post(
                    "/integration/planning-snapshot/export",
                    json={"source_system": "erp-http"},
                    headers={"X-API-Key": "read-key"},
                )
                imported = client.post(
                    "/integration/planning-snapshot/import",
                    json=exported.json(),
                    headers={"X-API-Key": "read-key"},
                )
        finally:
            get_settings.cache_clear()

        assert exported.status_code == 200
        assert imported.status_code == 403
        assert imported.json()["error"] == "insufficient_scope"

    def test_persisted_integration_api_client_authenticates_and_hides_secret(self):
        app = _integration_api()
        with TestClient(app) as client:
            created = client.post(
                "/integration/api-clients",
                json={
                    "name": "ERP read client",
                    "scopes": ["read"],
                    "source_system": "erp-http",
                },
                headers=_integration_admin_headers(),
            )
            api_key = created.json()["api_key"]
            listed_before_use = client.get(
                "/integration/api-clients",
                headers=_integration_admin_headers(),
            )
            missing = client.get("/integration/journal")
            valid = client.get(
                "/integration/journal",
                headers={"X-API-Key": api_key},
            )
            listed_after_use = client.get(
                "/integration/api-clients",
                headers=_integration_admin_headers(),
            )

        assert created.status_code == 200
        assert api_key.startswith("paic_")
        client_record = created.json()["client"]
        assert client_record["key_prefix"] == api_key[:18]
        assert "api_key" not in client_record
        assert "key_hash" not in client_record
        assert listed_before_use.status_code == 200
        assert listed_before_use.json()[0]["last_used_at"] is None
        assert missing.status_code == 401
        assert missing.json()["error"] == "missing_api_key"
        assert valid.status_code == 200
        assert listed_after_use.json()[0]["last_used_at"] is not None

    def test_persisted_integration_api_client_enforces_scopes(self):
        app = _integration_api()
        with TestClient(app) as client:
            created = client.post(
                "/integration/api-clients",
                json={"name": "ERP read client", "scopes": ["read"]},
                headers=_integration_admin_headers(),
            )
            api_key = created.json()["api_key"]
            exported = client.post(
                "/integration/planning-snapshot/export",
                json={"source_system": "erp-http"},
                headers={"X-API-Key": api_key},
            )
            imported = client.post(
                "/integration/planning-snapshot/import",
                json=exported.json(),
                headers={"X-API-Key": api_key},
            )

        assert created.status_code == 200
        assert exported.status_code == 200
        assert imported.status_code == 403
        assert imported.json()["error"] == "insufficient_scope"

    def test_integration_connectors_can_be_created_listed_and_tested(self):
        app = _integration_api()
        app.state.integration_http_transport.queue_response(
            status_code=200,
            body=b'{"pong":true}',
        )
        with TestClient(app) as client:
            created = client.post(
                "/integration/connectors",
                json={
                    "name": "ERP webhook",
                    "endpoint_url": "https://erp.example.test/api/plans",
                    "source_system": "erp-http",
                    "method": "POST",
                    "auth_type": "bearer",
                    "secret_ref": "env:ERP_TOKEN",
                    "static_headers": {"X-Plant": "A"},
                },
                headers=_integration_admin_headers(),
            )
            listed = client.get(
                "/integration/connectors",
                headers=_integration_admin_headers(),
            )
            tested = client.post(
                f"/integration/connectors/{created.json()['id']}/test",
                headers=_integration_admin_headers(),
            )

        assert created.status_code == 200
        assert listed.status_code == 200
        assert len(listed.json()) == 1
        assert tested.status_code == 200
        assert tested.json()["ok"] is True
        assert tested.json()["connector"]["last_test_status"] == "ok"
        request = app.state.integration_http_transport.requests[0]
        assert request.method == "POST"
        assert request.headers["Authorization"] == "Bearer token-demo"
        assert request.headers["X-Plant"] == "A"

    def test_saved_credentials_can_be_created_listed_and_used_by_http_profiles(self):
        app = _integration_api()
        app.state.integration_http_transport.queue_response(
            status_code=200,
            body=b'{"pong":true}',
        )
        with TestClient(app) as client:
            created_credential = client.post(
                "/integration/credentials",
                json={
                    "name": "ERP bearer",
                    "source_system": "erp-http",
                    "auth_type": "bearer",
                    "secret_ref": "env:ERP_TOKEN",
                },
                headers=_integration_admin_headers(),
            )
            listed_credentials = client.get(
                "/integration/credentials",
                headers=_integration_admin_headers(),
            )
            created_connector = client.post(
                "/integration/connectors",
                json={
                    "name": "ERP saved profile",
                    "endpoint_url": "https://erp.example.test/api",
                    "source_system": "erp-http",
                    "method": "GET",
                    "auth_type": "none",
                    "credential_id": created_credential.json()["id"],
                },
                headers=_integration_admin_headers(),
            )
            tested = client.post(
                f"/integration/connectors/{created_connector.json()['id']}/test",
                headers=_integration_admin_headers(),
            )

        assert created_credential.status_code == 200
        assert listed_credentials.status_code == 200
        assert len(listed_credentials.json()) == 1
        credential = created_credential.json()
        assert credential["auth_type"] == "bearer"
        assert credential["secret_ref"] == "env:ERP_TOKEN"
        assert created_connector.status_code == 200
        connector = created_connector.json()
        assert connector["credential_id"] == credential["id"]
        assert connector["auth_type"] == "none"
        assert tested.status_code == 200
        assert tested.json()["ok"] is True
        request = app.state.integration_http_transport.requests[0]
        assert request.method == "GET"
        assert request.headers["Authorization"] == "Bearer token-demo"

    def test_sftp_connector_can_be_created_and_tested(self):
        app = _integration_api()
        with TestClient(app) as client:
            created = client.post(
                "/integration/connectors",
                json={
                    "name": "SFTP dropbox",
                    "endpoint_url": "sftp://files.example.test:22",
                    "source_system": "sftp",
                    "connector_type": "sftp",
                    "method": "PUT",
                    "auth_type": "basic",
                    "username": "planner",
                    "secret_value": "password-demo",
                },
                headers=_integration_admin_headers(),
            )
            tested = client.post(
                f"/integration/connectors/{created.json()['id']}/test",
                headers=_integration_admin_headers(),
            )

        assert created.status_code == 200
        data = created.json()
        assert data["connector_type"] == "sftp"
        assert data["username"] == "planner"
        assert data["has_secret"] is True
        assert data["secret_ref"] == "stored-in-app"
        assert tested.status_code == 200
        assert tested.json()["ok"] is True
        assert tested.json()["connector"]["last_test_status"] == "ok"
        assert "SFTP connection succeeded" in tested.json()["message"]
        assert app.state.integration_http_transport.requests == []
        assert len(app.state.integration_sftp_transport.test_requests) == 1

    def test_database_connector_can_be_created_and_tested(self):
        app = _integration_api()
        with TestClient(app) as client:
            created = client.post(
                "/integration/connectors",
                json={
                    "name": "Warehouse database",
                    "endpoint_url": "sqlite:///warehouse.db",
                    "source_system": "warehouse-db",
                    "connector_type": "database",
                    "auth_type": "none",
                },
                headers=_integration_admin_headers(),
            )
            tested = client.post(
                f"/integration/connectors/{created.json()['id']}/test",
                headers=_integration_admin_headers(),
            )

        assert created.status_code == 200
        data = created.json()
        assert data["connector_type"] == "database"
        assert tested.status_code == 200
        assert tested.json()["ok"] is True
        assert tested.json()["connector"]["last_test_status"] == "ok"
        assert "Database connection succeeded" in tested.json()["message"]
        assert app.state.integration_http_transport.requests == []
        assert len(app.state.integration_database_transport.test_requests) == 1

    def test_database_connector_schema_can_be_loaded(self):
        app = _integration_api()
        with TestClient(app) as client:
            created = client.post(
                "/integration/connectors",
                json={
                    "name": "Warehouse database",
                    "endpoint_url": "sqlite:///warehouse.db",
                    "source_system": "warehouse-db",
                    "connector_type": "database",
                    "auth_type": "none",
                },
                headers=_integration_admin_headers(),
            )
            schema = client.get(
                f"/integration/connectors/{created.json()['id']}/database-schema",
                headers=_integration_admin_headers(),
            )

        assert created.status_code == 200
        assert schema.status_code == 200
        data = schema.json()
        assert data["connector"]["id"] == created.json()["id"]
        assert data["dialect"] == "sqlite"
        assert data["database"] == "warehouse.db"
        assert {table["full_name"] for table in data["tables"]} == {
            "planned_operations",
            "planned_orders",
        }
        operations = next(
            table for table in data["tables"] if table["full_name"] == "planned_operations"
        )
        assert operations["columns"][0]["name"] == "operation_id"
        assert operations["columns"][0]["is_primary_key"] is True
        assert len(app.state.integration_database_transport.schema_requests) == 1

    def test_outbound_automation_can_push_snapshot_through_connector(self):
        app = _integration_api()
        app.state.integration_http_transport.queue_response(
            status_code=202,
            body=b'{"accepted":true}',
        )
        with TestClient(app) as client:
            connector = client.post(
                "/integration/connectors",
                json={
                    "name": "ERP outbound connector",
                    "endpoint_url": "https://erp.example.test/api/outbound",
                    "source_system": "erp-http",
                    "method": "POST",
                    "auth_type": "bearer",
                    "secret_ref": "env:ERP_TOKEN",
                },
                headers=_integration_admin_headers(),
            )
            created = client.post(
                "/integration/automations",
                json={
                    "name": "ERP outbound snapshot",
                    "direction": "outbound",
                    "trigger_type": "manual",
                    "source_system": "erp-http",
                    "config": {
                        "mode": "connector_snapshot_export",
                        "connector_id": connector.json()["id"],
                    },
                },
                headers=_integration_admin_headers(),
            )
            run = client.post(
                f"/integration/automations/{created.json()['id']}/run",
                headers=_integration_admin_headers(),
            )

        assert connector.status_code == 200
        assert created.status_code == 200
        assert run.status_code == 200
        data = run.json()
        assert data["result"]["mode"] == "connector_snapshot_export"
        assert data["result"]["connector_id"] == connector.json()["id"]
        assert data["result"]["http_status"] == 202
        request = app.state.integration_http_transport.requests[0]
        assert request.method == "POST"
        assert request.headers["Authorization"] == "Bearer token-demo"
        assert request.headers["Content-Type"] == "application/json"
        assert b'"contract_version"' in request.body

    def test_inbound_automation_can_pull_snapshot_through_connector(self):
        app = _integration_api()
        with TestClient(app) as client:
            exported = client.post(
                "/integration/planning-snapshot/export",
                json={"source_system": "erp-http"},
            )
            app.state.integration_http_transport.queue_response(
                status_code=200,
                body=json.dumps(exported.json()).encode("utf-8"),
            )
            connector = client.post(
                "/integration/connectors",
                json={
                    "name": "ERP inbound connector",
                    "endpoint_url": "https://erp.example.test/api/inbound",
                    "source_system": "erp-http",
                    "method": "GET",
                    "auth_type": "none",
                },
                headers=_integration_admin_headers(),
            )
            created = client.post(
                "/integration/automations",
                json={
                    "name": "ERP inbound snapshot",
                    "direction": "inbound",
                    "trigger_type": "manual",
                    "source_system": "erp-http",
                    "config": {
                        "mode": "connector_snapshot_import",
                        "connector_id": connector.json()["id"],
                    },
                },
                headers=_integration_admin_headers(),
            )
            run = client.post(
                f"/integration/automations/{created.json()['id']}/run",
                headers=_integration_admin_headers(),
            )

        assert exported.status_code == 200
        assert connector.status_code == 200
        assert created.status_code == 200
        assert run.status_code == 200
        data = run.json()
        assert data["result"]["mode"] == "connector_snapshot_import"
        assert data["result"]["connector_id"] == connector.json()["id"]
        assert data["result"]["http_status"] == 200
        assert data["job"]["last_status"] == "imported"
        request = app.state.integration_http_transport.requests[0]
        assert request.method == "GET"
        assert request.body is None

    def test_integration_flows_can_be_created_listed_and_run(self):
        app = _integration_api()
        with TestClient(app) as client:
            catalog = client.get("/integration/flow-blocks")
            created = client.post(
                "/integration/flows",
                json={
                    "name": "APS baseline flow",
                    "source_system": "erp-flow",
                    "blocks": [
                        {
                            "id": "snapshot",
                            "block_type": "export_snapshot",
                            "config": {"metadata": {"site_id": "plant-flow"}},
                        },
                        {
                            "id": "transform",
                            "block_type": "transform_snapshot",
                            "config": {
                                "operations": [
                                    {
                                        "op": "set_metadata",
                                        "key": "scenario",
                                        "value": "flow-smoke",
                                    }
                                ]
                            },
                        },
                        {"id": "validate", "block_type": "validate_snapshot"},
                        {"id": "gate", "block_type": "require_valid_snapshot"},
                        {
                            "id": "schedule",
                            "block_type": "run_scheduling_from_snapshot",
                            "config": {"horizon_days": 5, "strategy": "greedy"},
                        },
                    ],
                },
                headers=_integration_admin_headers(),
            )
            listed = client.get(
                "/integration/flows",
                headers=_integration_admin_headers(),
            )
            fetched = client.get(
                f"/integration/flows/{created.json()['id']}",
                headers=_integration_admin_headers(),
            )
            run = client.post(
                f"/integration/flows/{created.json()['id']}/run",
                headers=_integration_admin_headers(),
            )

        assert catalog.status_code == 200
        catalog_types = {item["block_type"] for item in catalog.json()}
        assert "export_snapshot" in catalog_types
        assert {"format_payload", "send_sftp_file", "write_database_rows"} <= catalog_types
        assert created.status_code == 200
        assert listed.status_code == 200
        assert fetched.status_code == 200
        assert run.status_code == 200
        data = run.json()
        assert data["status"] == "completed"
        assert data["result"]["kind"] == "schedule_result"
        assert data["result"]["solver_status"] == "feasible"
        assert data["flow"]["last_status"] == "completed"
        assert data["execution_scope"]["mode"] == "full"
        assert data["execution_scope"]["final_block_id"] == "schedule"
        assert len(data["blocks"]) == 5
        assert data["blocks"][1]["status"] == "transformed"
        assert data["blocks"][1]["input_preview"]["kind"] == "snapshot"
        assert data["blocks"][1]["output_preview"]["kind"] == "snapshot"

    def test_integration_flow_can_format_payload_as_xml(self):
        app = _integration_api()
        with TestClient(app) as client:
            created = client.post(
                "/integration/flows",
                json={
                    "name": "APS XML export",
                    "source_system": "erp-flow",
                    "blocks": [
                        {"id": "snapshot", "block_type": "export_snapshot"},
                        {
                            "id": "format",
                            "block_type": "format_payload",
                            "input_block_id": "snapshot",
                            "config": {
                                "format": "xml",
                                "source_path": "snapshot.work_orders",
                                "root_name": "work_orders",
                                "item_name": "work_order",
                                "file_name": "work-orders.xml",
                            },
                        },
                    ],
                },
                headers=_integration_admin_headers(),
            )
            run = client.post(
                f"/integration/flows/{created.json()['id']}/run",
                headers=_integration_admin_headers(),
            )

        assert created.status_code == 200
        assert run.status_code == 200
        data = run.json()
        assert data["status"] == "completed"
        assert data["result"]["kind"] == "formatted_payload"
        assert data["result"]["format"] == "xml"
        assert data["result"]["file_name"] == "work-orders.xml"
        assert "<work_orders>" in data["result"]["text"]
        assert "<work_order>" in data["result"]["text"]
        assert data["blocks"][1]["output_summary"]["format"] == "xml"

    def test_flow_blocks_payload_order_is_independent_of_input_block_id(self):
        # Studio v2 sends blocks in creation order, not topological order.
        # If a planner adds Export APS Data first, then drops a Manual trigger
        # and links them, the export block lands first in the array with an
        # input_block_id pointing to the trigger that comes later. The save
        # must succeed; cycle detection runs separately downstream.
        app = _integration_api()
        with TestClient(app) as client:
            created = client.post(
                "/integration/flows",
                json={
                    "name": "Manual then export, payload order reversed",
                    "source_system": "erp-flow",
                    "blocks": [
                        {
                            "id": "snapshot",
                            "block_type": "export_snapshot",
                            "input_block_id": "trigger",
                        },
                        {"id": "trigger", "block_type": "trigger_manual"},
                    ],
                },
                headers=_integration_admin_headers(),
            )

        assert created.status_code == 200, created.json()

    def test_destination_blocks_can_deliver_to_sftp(self):
        app = _integration_api()
        with TestClient(app) as client:
            connector = client.post(
                "/integration/connectors",
                json={
                    "name": "SFTP dropbox",
                    "endpoint_url": "sftp://files.example.test:22",
                    "source_system": "sftp",
                    "connector_type": "sftp",
                    "method": "PUT",
                    "auth_type": "basic",
                    "username": "planner",
                    "secret_value": "password-demo",
                },
                headers=_integration_admin_headers(),
            )
            created = client.post(
                "/integration/flows",
                json={
                    "name": "APS SFTP export",
                    "source_system": "erp-flow",
                    "blocks": [
                        {"id": "snapshot", "block_type": "export_snapshot"},
                        {
                            "id": "format",
                            "block_type": "format_payload",
                            "input_block_id": "snapshot",
                            "config": {"format": "json", "file_name": "snapshot.json"},
                        },
                        {
                            "id": "sftp",
                            "block_type": "send_sftp_file",
                            "input_block_id": "format",
                            "config": {
                                "connector_id": connector.json()["id"],
                                "directory": "/outbound",
                                "file_name": "{{ input.file_name }}",
                            },
                        },
                    ],
                },
                headers=_integration_admin_headers(),
            )
            run = client.post(
                f"/integration/flows/{created.json()['id']}/run",
                headers=_integration_admin_headers(),
            )

        assert connector.status_code == 200
        assert created.status_code == 200
        assert run.status_code == 200
        data = run.json()
        assert data["status"] == "completed"
        assert data["result"]["destination_type"] == "sftp"
        assert data["result"]["path"] == "/outbound/snapshot.json"
        assert data["blocks"][2]["status"] == "delivered"
        assert data["blocks"][2]["output_summary"]["path"] == "/outbound/snapshot.json"
        assert len(app.state.integration_sftp_transport.put_requests) == 1
        request = app.state.integration_sftp_transport.put_requests[0]
        assert request.host == "files.example.test"
        assert request.port == 22
        assert request.username == "planner"
        assert request.path == "/outbound/snapshot.json"
        assert request.body.startswith(b"{")

    def test_destination_blocks_can_preview_sftp_delivery(self):
        app = _integration_api()
        with TestClient(app) as client:
            connector = client.post(
                "/integration/connectors",
                json={
                    "name": "SFTP preview target",
                    "endpoint_url": "sftp://files.example.test:22",
                    "source_system": "sftp",
                    "connector_type": "sftp",
                    "method": "PUT",
                    "auth_type": "basic",
                    "username": "planner",
                    "secret_value": "password-demo",
                },
                headers=_integration_admin_headers(),
            )
            created = client.post(
                "/integration/flows",
                json={
                    "name": "APS SFTP preview export",
                    "source_system": "erp-flow",
                    "blocks": [
                        {"id": "snapshot", "block_type": "export_snapshot"},
                        {
                            "id": "format",
                            "block_type": "format_payload",
                            "input_block_id": "snapshot",
                            "config": {"format": "json", "file_name": "snapshot.json"},
                        },
                        {
                            "id": "sftp",
                            "block_type": "send_sftp_file",
                            "input_block_id": "format",
                            "config": {
                                "connector_id": connector.json()["id"],
                                "directory": "/outbound",
                                "file_name": "{{ input.file_name }}",
                                "preview_only": True,
                            },
                        },
                    ],
                },
                headers=_integration_admin_headers(),
            )
            run = client.post(
                f"/integration/flows/{created.json()['id']}/run",
                headers=_integration_admin_headers(),
            )

        assert connector.status_code == 200
        assert created.status_code == 200
        assert run.status_code == 200
        data = run.json()
        assert data["status"] == "completed"
        assert data["result"]["destination_type"] == "sftp"
        assert data["result"]["preview_only"] is True
        assert data["result"]["status"] == "preview_only"
        assert data["result"]["path"] == "/outbound/snapshot.json"
        assert data["result"]["byte_length"] > 0
        assert data["result"]["text_preview"].startswith("{")
        assert data["blocks"][2]["status"] == "ready"
        assert "no file sent yet" in data["blocks"][2]["message"].lower()
        assert app.state.integration_sftp_transport.put_requests == []

    def test_destination_blocks_can_write_rows_to_database(self):
        app = _integration_api()
        with TestClient(app) as client:
            connector = client.post(
                "/integration/connectors",
                json={
                    "name": "Warehouse database",
                    "endpoint_url": "sqlite:///warehouse.db",
                    "source_system": "warehouse-db",
                    "connector_type": "database",
                    "auth_type": "none",
                },
                headers=_integration_admin_headers(),
            )
            created = client.post(
                "/integration/flows",
                json={
                    "name": "APS database export",
                    "source_system": "erp-flow",
                    "blocks": [
                        {"id": "snapshot", "block_type": "export_snapshot"},
                        {
                            "id": "database",
                            "block_type": "write_database_rows",
                            "input_block_id": "snapshot",
                            "config": {
                                "connector_id": connector.json()["id"],
                                "table": "planned_orders",
                                "operation": "insert",
                                "rows_path": "work_orders",
                            },
                        },
                    ],
                },
                headers=_integration_admin_headers(),
            )
            run = client.post(
                f"/integration/flows/{created.json()['id']}/run",
                headers=_integration_admin_headers(),
            )

        assert connector.status_code == 200
        assert created.status_code == 200
        assert run.status_code == 200
        data = run.json()
        assert data["status"] == "completed"
        assert data["result"]["destination_type"] == "database"
        assert data["result"]["table"] == "planned_orders"
        assert data["result"]["rows_written"] > 0
        assert data["result"]["source_row_count"] == data["result"]["mapped_row_count"]
        assert data["result"]["source_fields"][0] == "id"
        assert data["result"]["mapped_fields"][0] == "id"
        assert len(data["result"]["source_rows_preview"]) > 0
        assert len(data["result"]["mapped_rows_preview"]) > 0
        assert data["result"]["preview_only"] is False
        assert data["result"]["table_schema_checked"] is True
        assert data["result"]["table_schema_found"] is True
        assert data["result"]["required_columns_missing"] == ["order_id"]
        assert "id" in data["result"]["extra_mapped_fields"]
        assert data["result"]["schema_readiness"] == "mapping_incomplete"
        assert data["blocks"][1]["status"] == "delivered"
        assert data["blocks"][1]["output_summary"]["table"] == "planned_orders"
        # V1.2 P1.1 — the /run endpoint now fetches schema once during
        # the pre-flight readiness check (to validate the database
        # block's mapping before any write) and once during the actual
        # write step. A future caching pass can collapse this to one
        # fetch per request; the contract today is 2.
        assert len(app.state.integration_database_transport.schema_requests) == 2
        assert len(app.state.integration_database_transport.write_requests) == 1
        request = app.state.integration_database_transport.write_requests[0]
        assert request.table_name == "planned_orders"
        assert request.operation == "insert"
        assert len(request.rows) > 0
        assert request.rows[0]["id"].startswith("WO-")

    def test_destination_blocks_can_map_rows_before_database_write(self):
        app = _integration_api()
        with TestClient(app) as client:
            connector = client.post(
                "/integration/connectors",
                json={
                    "name": "Warehouse database",
                    "endpoint_url": "sqlite:///warehouse.db",
                    "source_system": "warehouse-db",
                    "connector_type": "database",
                    "auth_type": "none",
                },
                headers=_integration_admin_headers(),
            )
            created = client.post(
                "/integration/flows",
                json={
                    "name": "APS database mapped export",
                    "source_system": "erp-flow",
                    "blocks": [
                        {"id": "snapshot", "block_type": "export_snapshot"},
                        {
                            "id": "database",
                            "block_type": "write_database_rows",
                            "input_block_id": "snapshot",
                            "config": {
                                "connector_id": connector.json()["id"],
                                "table": "planned_orders",
                                "operation": "upsert",
                                "rows_path": "work_orders",
                                "match_columns": "order_id",
                                "column_map": {
                                    "order_id": "id",
                                    "item_code": "product_id",
                                    "qty": "quantity",
                                    "due_at": "due_date",
                                },
                            },
                        },
                    ],
                },
                headers=_integration_admin_headers(),
            )
            run = client.post(
                f"/integration/flows/{created.json()['id']}/run",
                headers=_integration_admin_headers(),
            )

        assert connector.status_code == 200
        assert created.status_code == 200
        assert run.status_code == 200
        data = run.json()
        assert data["status"] == "completed"
        assert data["result"]["destination_type"] == "database"
        assert data["result"]["match_columns"] == ["order_id"]
        assert data["result"]["mapped_columns"] == [
            "order_id",
            "item_code",
            "qty",
            "due_at",
        ]
        assert data["result"]["source_fields"][:4] == [
            "id",
            "name",
            "product_id",
            "quantity",
        ]
        assert data["result"]["mapped_fields"] == [
            "order_id",
            "item_code",
            "qty",
            "due_at",
        ]
        assert data["result"]["table_schema_checked"] is True
        assert data["result"]["table_schema_found"] is True
        assert data["result"]["table_schema_columns"] == [
            "order_id",
            "item_code",
            "qty",
            "due_at",
        ]
        assert data["result"]["table_primary_key_columns"] == ["order_id"]
        assert data["result"]["required_columns_missing"] == []
        assert data["result"]["extra_mapped_fields"] == []
        assert data["result"]["suggested_match_columns"] == ["order_id"]
        assert data["result"]["schema_readiness"] == "ready"
        assert data["result"]["source_rows_preview"][0]["id"].startswith("WO-")
        assert data["result"]["mapped_rows_preview"][0]["order_id"].startswith("WO-")
        # V1.2 P1.1 — the /run endpoint now fetches schema once during
        # the pre-flight readiness check (to validate the database
        # block's mapping before any write) and once during the actual
        # write step. A future caching pass can collapse this to one
        # fetch per request; the contract today is 2.
        assert len(app.state.integration_database_transport.schema_requests) == 2
        assert len(app.state.integration_database_transport.write_requests) == 1
        request = app.state.integration_database_transport.write_requests[0]
        assert request.operation == "upsert"
        assert request.match_columns == ("order_id",)
        assert set(request.rows[0]) == {"order_id", "item_code", "qty", "due_at"}
        assert request.rows[0]["order_id"].startswith("WO-")
        assert request.rows[0]["qty"] > 0

    def test_destination_blocks_can_flatten_snapshot_operations_before_database_write(self):
        app = _integration_api()
        with TestClient(app) as client:
            exported = client.post(
                "/integration/planning-snapshot/export",
                json={"source_system": "erp-flow"},
            )
            assert exported.status_code == 200
            payload = exported.json()
            expected_operations = sum(
                len(work_order.get("operations", []))
                for work_order in payload.get("work_orders", [])
                if isinstance(work_order, dict)
            )
            connector = client.post(
                "/integration/connectors",
                json={
                    "name": "Operations warehouse database",
                    "endpoint_url": "sqlite:///warehouse.db",
                    "source_system": "warehouse-db",
                    "connector_type": "database",
                    "auth_type": "none",
                },
                headers=_integration_admin_headers(),
            )
            created = client.post(
                "/integration/flows",
                json={
                    "name": "APS operations database export",
                    "source_system": "erp-flow",
                    "blocks": [
                        {"id": "snapshot", "block_type": "export_snapshot"},
                        {
                            "id": "database",
                            "block_type": "write_database_rows",
                            "input_block_id": "snapshot",
                            "config": {
                                "connector_id": connector.json()["id"],
                                "table": "planned_operations",
                                "operation": "upsert",
                                "rows_path": "work_orders.*.operations",
                                "match_columns": "operation_id",
                                "column_map": {
                                    "operation_id": "id",
                                    "order_id": "work_order_id",
                                    "operation_no": "sequence",
                                    "duration_min": "duration_minutes",
                                },
                            },
                        },
                    ],
                },
                headers=_integration_admin_headers(),
            )
            run = client.post(
                f"/integration/flows/{created.json()['id']}/run",
                headers=_integration_admin_headers(),
            )

        assert connector.status_code == 200
        assert created.status_code == 200
        assert run.status_code == 200
        data = run.json()
        assert data["status"] == "completed"
        assert data["result"]["destination_type"] == "database"
        assert data["result"]["match_columns"] == ["operation_id"]
        assert data["result"]["mapped_columns"] == [
            "operation_id",
            "order_id",
            "operation_no",
            "duration_min",
        ]
        assert data["result"]["table_schema_checked"] is True
        assert data["result"]["table_schema_found"] is True
        assert data["result"]["required_columns_missing"] == []
        assert data["result"]["extra_mapped_fields"] == []
        assert data["result"]["schema_readiness"] == "ready"
        # V1.2 P1.1 — the /run endpoint now fetches schema once during
        # the pre-flight readiness check (to validate the database
        # block's mapping before any write) and once during the actual
        # write step. A future caching pass can collapse this to one
        # fetch per request; the contract today is 2.
        assert len(app.state.integration_database_transport.schema_requests) == 2
        assert len(app.state.integration_database_transport.write_requests) == 1
        request = app.state.integration_database_transport.write_requests[0]
        assert request.operation == "upsert"
        assert request.match_columns == ("operation_id",)
        assert len(request.rows) == expected_operations
        assert set(request.rows[0]) == {
            "operation_id",
            "order_id",
            "operation_no",
            "duration_min",
        }
        assert request.rows[0]["operation_id"]
        assert request.rows[0]["order_id"].startswith("WO-")

    def test_destination_blocks_can_preview_database_rows_without_writing(self):
        app = _integration_api()
        with TestClient(app) as client:
            connector = client.post(
                "/integration/connectors",
                json={
                    "name": "Warehouse database",
                    "endpoint_url": "sqlite:///warehouse.db",
                    "source_system": "warehouse-db",
                    "connector_type": "database",
                    "auth_type": "none",
                },
                headers=_integration_admin_headers(),
            )
            created = client.post(
                "/integration/flows",
                json={
                    "name": "APS database preview",
                    "source_system": "erp-flow",
                    "blocks": [
                        {"id": "snapshot", "block_type": "export_snapshot"},
                        {
                            "id": "database",
                            "block_type": "write_database_rows",
                            "input_block_id": "snapshot",
                            "config": {
                                "connector_id": connector.json()["id"],
                                "table": "planned_orders",
                                "operation": "upsert",
                                "rows_path": "work_orders",
                                "match_columns": "order_id",
                                "column_map": {
                                    "order_id": "id",
                                    "qty": "quantity",
                                },
                                "preview_only": True,
                            },
                        },
                    ],
                },
                headers=_integration_admin_headers(),
            )
            run = client.post(
                f"/integration/flows/{created.json()['id']}/run",
                headers=_integration_admin_headers(),
            )

        assert connector.status_code == 200
        assert created.status_code == 200
        assert run.status_code == 200
        data = run.json()
        assert data["status"] == "completed"
        assert data["result"]["destination_type"] == "database"
        assert data["result"]["preview_only"] is True
        assert data["result"]["status"] == "preview_only"
        assert data["result"]["rows_written"] == 0
        assert data["result"]["mapped_fields"] == ["order_id", "qty"]
        assert data["result"]["table_schema_checked"] is True
        assert data["result"]["table_schema_found"] is True
        assert data["result"]["required_columns_missing"] == []
        assert data["result"]["extra_mapped_fields"] == []
        assert data["result"]["schema_readiness"] == "ready"
        assert data["result"]["mapped_rows_preview"][0]["order_id"].startswith("WO-")
        assert data["blocks"][1]["status"] == "ready"
        assert "no write executed" in data["blocks"][1]["message"].lower()
        # V1.2 P1.1 — pre-flight readiness check fetches schema once
        # for validation, then the block fetches it again at preview
        # time. Future caching can collapse to 1; the contract is 2.
        assert len(app.state.integration_database_transport.schema_requests) == 2
        assert app.state.integration_database_transport.write_requests == []

    def test_destination_blocks_report_database_schema_gaps_in_preview(self):
        app = _integration_api()
        with TestClient(app) as client:
            connector = client.post(
                "/integration/connectors",
                json={
                    "name": "Operations warehouse database",
                    "endpoint_url": "sqlite:///warehouse.db",
                    "source_system": "warehouse-db",
                    "connector_type": "database",
                    "auth_type": "none",
                },
                headers=_integration_admin_headers(),
            )
            created = client.post(
                "/integration/flows",
                json={
                    "name": "APS database schema gaps preview",
                    "source_system": "erp-flow",
                    "blocks": [
                        {"id": "snapshot", "block_type": "export_snapshot"},
                        {
                            "id": "database",
                            "block_type": "write_database_rows",
                            "input_block_id": "snapshot",
                            "config": {
                                "connector_id": connector.json()["id"],
                                "table": "planned_operations",
                                "operation": "upsert",
                                "rows_path": "work_orders.*.operations",
                                "match_columns": "operation_id,ghost_key",
                                "column_map": {
                                    "operation_id": "id",
                                    "duration_min": "duration_minutes",
                                    "extra_flag": "status",
                                },
                                "preview_only": True,
                            },
                        },
                    ],
                },
                headers=_integration_admin_headers(),
            )
            run = client.post(
                f"/integration/flows/{created.json()['id']}/run",
                headers=_integration_admin_headers(),
            )

        assert connector.status_code == 200
        assert created.status_code == 200
        assert run.status_code == 200
        data = run.json()
        assert data["status"] == "completed"
        assert data["result"]["preview_only"] is True
        assert data["result"]["table_schema_checked"] is True
        assert data["result"]["table_schema_found"] is True
        assert data["result"]["table_primary_key_columns"] == ["operation_id"]
        assert data["result"]["required_columns_missing"] == ["order_id"]
        assert data["result"]["extra_mapped_fields"] == ["extra_flag"]
        assert data["result"]["missing_match_columns"] == ["ghost_key"]
        assert data["result"]["invalid_match_columns"] == ["ghost_key"]
        assert data["result"]["schema_readiness"] == "mapping_incomplete"
        assert "missing required columns order_id" in data["result"]["schema_readiness_message"]
        # V1.2 P1.1 — pre-flight readiness check fetches schema once
        # for validation, then the block fetches it again at preview
        # time. Future caching can collapse to 1; the contract is 2.
        assert len(app.state.integration_database_transport.schema_requests) == 2
        assert app.state.integration_database_transport.write_requests == []

    def test_integration_flow_can_pull_transform_and_import_snapshot(self):
        app = _integration_api()
        with TestClient(app) as client:
            exported = client.post(
                "/integration/planning-snapshot/export",
                json={"source_system": "erp-flow"},
            )
            assert exported.status_code == 200
            payload = exported.json()
            payload["work_orders"][0]["quantity_uom"] = " "
            app.state.integration_http_transport.queue_response(
                status_code=200,
                body=json.dumps(payload).encode("utf-8"),
            )
            connector = client.post(
                "/integration/connectors",
                json={
                    "name": "ERP inbound flow connector",
                    "endpoint_url": "https://erp.example.test/api/flow/inbound",
                    "source_system": "erp-flow",
                    "method": "GET",
                    "auth_type": "none",
                },
                headers=_integration_admin_headers(),
            )
            created = client.post(
                "/integration/flows",
                json={
                    "name": "ERP inbound flow",
                    "source_system": "erp-flow",
                    "blocks": [
                        {
                            "id": "pull",
                            "block_type": "pull_snapshot_from_connector",
                            "config": {"connector_id": connector.json()["id"]},
                        },
                        {
                            "id": "transform",
                            "block_type": "transform_snapshot",
                            "config": {
                                "operations": [
                                    {
                                        "op": "default_work_order_field",
                                        "field": "quantity_uom",
                                        "value": "ea",
                                    }
                                ]
                            },
                        },
                        {"id": "validate", "block_type": "validate_snapshot"},
                        {"id": "gate", "block_type": "require_valid_snapshot"},
                        {"id": "import", "block_type": "import_snapshot"},
                    ],
                },
                headers=_integration_admin_headers(),
            )
            run = client.post(
                f"/integration/flows/{created.json()['id']}/run",
                headers=_integration_admin_headers(),
            )
            journal = client.get(
                "/integration/journal",
                params={"action": "flow_run"},
                headers=_integration_admin_headers(),
            )

        assert connector.status_code == 200
        assert created.status_code == 200
        assert run.status_code == 200
        data = run.json()
        assert data["status"] == "completed"
        assert data["result"]["kind"] == "import_result"
        assert data["result"]["validation"]["readiness_status"] == "ready"
        assert data["blocks"][0]["status"] == "received"
        assert data["blocks"][1]["status"] == "transformed"
        assert journal.status_code == 200
        assert journal.json()[0]["details"]["flow_id"] == created.json()["id"]

    def test_integration_flow_can_call_connector_route_and_map_api_response(self):
        app = _integration_api()
        with TestClient(app) as client:
            exported = client.post(
                "/integration/planning-snapshot/export",
                json={"source_system": "erp-route"},
            )
            assert exported.status_code == 200
            erp_payload = _erp_api_payload_from_snapshot(exported.json())
            app.state.integration_http_transport.queue_response(
                status_code=200,
                body=json.dumps(erp_payload).encode("utf-8"),
            )
            connector = client.post(
                "/integration/connectors",
                json={
                    "name": "ERP work order API",
                    "endpoint_url": "https://erp.example.test/api",
                    "source_system": "erp-route",
                    "method": "GET",
                    "auth_type": "none",
                },
                headers=_integration_admin_headers(),
            )
            created = client.post(
                "/integration/flows",
                json={
                    "name": "ERP route mapping flow",
                    "source_system": "erp-route",
                    "blocks": [
                        {
                            "id": "fetch",
                            "block_type": "call_connector_api",
                            "config": {
                                "connector_id": connector.json()["id"],
                                "route_path": "/work-orders",
                                "request_method": "GET",
                                "query_params": {"include": "operations,machines"},
                                "response_root": "payload",
                            },
                        },
                        {
                            "id": "map",
                            "block_type": "map_api_response_to_snapshot",
                            "config": {
                                "work_orders_path": "orders",
                                "operations_path": "operations",
                                "calendars_path": "calendars",
                                "machines_path": "machines",
                                "resources_path": "resources",
                                "inventory_items_path": "inventory_items",
                                "supplies_path": "supplies",
                                "metadata_path": "meta",
                                "work_order_field_map": {
                                    "id": "erp_order_id",
                                    "name": "description",
                                    "product_id": "item_code",
                                    "quantity": "qty",
                                    "quantity_uom": "quantity_uom",
                                    "due_date": "due_at",
                                    "release_date": "release_at",
                                    "status": "status",
                                },
                                "operation_field_map": {
                                    "id": "erp_operation_id",
                                    "work_order_id": "erp_order_id",
                                    "sequence": "step_no",
                                    "name": "label",
                                    "duration_minutes": "duration_min",
                                    "eligible_machine_ids": "eligible_machine_ids",
                                },
                            },
                        },
                        {"id": "validate", "block_type": "validate_snapshot"},
                    ],
                },
                headers=_integration_admin_headers(),
            )
            run = client.post(
                f"/integration/flows/{created.json()['id']}/run",
                headers=_integration_admin_headers(),
            )

        assert connector.status_code == 200
        assert created.status_code == 200
        assert run.status_code == 200
        data = run.json()
        assert data["status"] == "completed"
        assert data["blocks"][0]["status"] == "received"
        assert data["blocks"][1]["status"] == "mapped"
        assert data["result"]["kind"] == "validated_snapshot"
        assert data["result"]["validation"]["valid"] is True
        assert data["result"]["validation"]["readiness_status"] == "degraded"
        request = app.state.integration_http_transport.requests[0]
        assert request.method == "GET"
        assert str(request.url) == "https://erp.example.test/api/work-orders?include=operations%2Cmachines"

    def test_integration_flow_can_call_api_with_direct_url(self):
        app = _integration_api()
        with TestClient(app) as client:
            exported = client.post(
                "/integration/planning-snapshot/export",
                json={"source_system": "erp-direct"},
            )
            assert exported.status_code == 200
            erp_payload = _erp_api_payload_from_snapshot(exported.json())
            app.state.integration_http_transport.queue_response(
                status_code=200,
                body=json.dumps(erp_payload).encode("utf-8"),
            )
            created = client.post(
                "/integration/flows",
                json={
                    "name": "ERP direct API flow",
                    "source_system": "erp-direct",
                    "blocks": [
                        {
                            "id": "call",
                            "block_type": "call_connector_api",
                            "config": {
                                "request_mode": "direct",
                                "url": "https://erp.example.test/api/work-orders",
                                "request_method": "GET",
                                "query_params": {"include": "operations,machines"},
                                "response_root": "payload",
                            },
                        },
                        {
                            "id": "map",
                            "block_type": "map_api_response_to_snapshot",
                            "config": {
                                "work_orders_path": "orders",
                                "operations_path": "operations",
                                "machines_path": "machines",
                                "calendars_path": "calendars",
                                "work_order_field_map": {
                                    "id": "erp_order_id",
                                    "name": "description",
                                    "product_id": "item_code",
                                    "quantity": "qty",
                                    "quantity_uom": "quantity_uom",
                                    "due_date": "due_at",
                                    "release_date": "release_at",
                                    "status": "status",
                                },
                                "operation_field_map": {
                                    "id": "erp_operation_id",
                                    "work_order_id": "erp_order_id",
                                    "sequence": "step_no",
                                    "name": "label",
                                    "duration_minutes": "duration_min",
                                    "eligible_machine_ids": "eligible_machine_ids",
                                },
                            },
                        },
                    ],
                },
                headers=_integration_admin_headers(),
            )
            run = client.post(
                f"/integration/flows/{created.json()['id']}/run",
                headers=_integration_admin_headers(),
            )

        assert created.status_code == 200
        assert run.status_code == 200
        data = run.json()
        assert data["status"] == "completed"
        assert data["blocks"][0]["status"] == "received"
        assert data["result"]["kind"] == "snapshot"
        request = app.state.integration_http_transport.requests[0]
        assert request.method == "GET"
        assert str(request.url) == "https://erp.example.test/api/work-orders?include=operations%2Cmachines"

    def test_integration_flow_can_send_custom_connector_payload(self):
        app = _integration_api()
        app.state.integration_http_transport.queue_response(
            status_code=204,
            body=b"",
        )
        with TestClient(app) as client:
            connector = client.post(
                "/integration/connectors",
                json={
                    "name": "ERP event API",
                    "endpoint_url": "https://erp.example.test/api",
                    "source_system": "erp-event",
                    "method": "POST",
                    "auth_type": "none",
                },
                headers=_integration_admin_headers(),
            )
            created = client.post(
                "/integration/flows",
                json={
                    "name": "ERP custom event flow",
                    "source_system": "erp-event",
                    "blocks": [
                        {
                            "id": "send",
                            "block_type": "send_connector_request",
                            "config": {
                                "connector_id": connector.json()["id"],
                                "route_path": "/events",
                                "request_method": "POST",
                                "request_headers": {"X-Plant": "plant-a"},
                                "query_params": {"source": "aps"},
                                "request_body": {
                                    "event_type": "aps.plan.ready",
                                    "payload": {"schedule_id": "sched-demo"},
                                },
                            },
                        }
                    ],
                },
                headers=_integration_admin_headers(),
            )
            run = client.post(
                f"/integration/flows/{created.json()['id']}/run",
                headers=_integration_admin_headers(),
            )

        assert connector.status_code == 200
        assert created.status_code == 200
        assert run.status_code == 200
        data = run.json()
        assert data["status"] == "completed"
        assert data["result"]["kind"] == "connector_delivery"
        assert data["result"]["http_status"] == 204
        assert data["result"]["payload_hash"]
        assert data["blocks"][0]["status"] == "delivered"
        request = app.state.integration_http_transport.requests[0]
        assert request.method == "POST"
        assert str(request.url) == "https://erp.example.test/api/events?source=aps"
        assert request.headers["Content-Type"] == "application/json"
        assert request.headers["X-Plant"] == "plant-a"
        assert request.headers["X-PlaniAdvance-Payload-Kind"] == "custom_payload"
        assert b"aps.plan.ready" in request.body

    def test_integration_flow_can_send_custom_payload_to_direct_url(self):
        app = _integration_api()
        app.state.integration_http_transport.queue_response(
            status_code=202,
            body=b'{"accepted":true}',
        )
        with TestClient(app) as client:
            created = client.post(
                "/integration/flows",
                json={
                    "name": "ERP direct event flow",
                    "source_system": "erp-direct",
                    "blocks": [
                        {
                            "id": "send",
                            "block_type": "send_connector_request",
                            "config": {
                                "request_mode": "direct",
                                "url": "https://erp.example.test/api/events",
                                "request_method": "POST",
                                "request_headers": {"X-Plant": "plant-a"},
                                "query_params": {"source": "aps"},
                                "request_body": {
                                    "event_type": "aps.plan.ready",
                                    "payload": {"schedule_id": "sched-demo"},
                                },
                            },
                        }
                    ],
                },
                headers=_integration_admin_headers(),
            )
            run = client.post(
                f"/integration/flows/{created.json()['id']}/run",
                headers=_integration_admin_headers(),
            )

        assert created.status_code == 200
        assert run.status_code == 200
        data = run.json()
        assert data["status"] == "completed"
        assert data["result"]["kind"] == "connector_delivery"
        assert data["result"]["http_status"] == 202
        assert data["result"]["request_url"] == "https://erp.example.test/api/events?source=aps"
        request = app.state.integration_http_transport.requests[0]
        assert request.method == "POST"
        assert str(request.url) == "https://erp.example.test/api/events?source=aps"
        assert request.headers["Content-Type"] == "application/json"
        assert request.headers["X-Plant"] == "plant-a"
        assert request.headers["X-PlaniAdvance-Payload-Kind"] == "custom_payload"
        assert b"aps.plan.ready" in request.body

    def test_integration_flow_can_send_payload_with_input_variables(self):
        app = _integration_api()
        app.state.integration_http_transport.queue_response(
            status_code=200,
            body=b'{"accepted":true}',
        )
        with TestClient(app) as client:
            connector = client.post(
                "/integration/connectors",
                json={
                    "name": "ERP event API",
                    "endpoint_url": "https://erp.example.test/api",
                    "source_system": "erp-event",
                    "method": "POST",
                    "auth_type": "none",
                },
                headers=_integration_admin_headers(),
            )
            created = client.post(
                "/integration/flows",
                json={
                    "name": "ERP variable event flow",
                    "source_system": "erp-event",
                    "blocks": [
                        {"id": "export", "block_type": "export_snapshot"},
                        {
                            "id": "send",
                            "block_type": "send_connector_request",
                            "input_block_id": "export",
                            "config": {
                                "connector_id": connector.json()["id"],
                                "route_path": "/events",
                                "request_method": "POST",
                                "request_headers": {
                                    "X-Order-Count": "{{ input.entity_counts.work_orders }}"
                                },
                                "query_params": {
                                    "orders": "{{ input.entity_counts.work_orders }}"
                                },
                                "request_body": {
                                    "event_type": "aps.snapshot.ready",
                                    "work_orders": "{{ input.entity_counts.work_orders }}",
                                    "snapshot_hash": "{{ input.snapshot_hash }}",
                                },
                            },
                        },
                    ],
                },
                headers=_integration_admin_headers(),
            )
            run = client.post(
                f"/integration/flows/{created.json()['id']}/run",
                headers=_integration_admin_headers(),
            )

        assert connector.status_code == 200
        assert created.status_code == 200
        assert run.status_code == 200
        request = app.state.integration_http_transport.requests[0]
        assert "orders=3" in str(request.url)
        assert request.headers["X-Order-Count"] == "3"
        body = json.loads(request.body.decode("utf-8"))
        assert body["event_type"] == "aps.snapshot.ready"
        assert body["work_orders"] == 3
        assert body["snapshot_hash"]

    def test_integration_flow_can_pull_aps_ready_data_from_direct_url(self):
        app = _integration_api()
        with TestClient(app) as client:
            exported = client.post(
                "/integration/planning-snapshot/export",
                json={"source_system": "erp-direct"},
                headers=_integration_admin_headers(),
            )
            assert exported.status_code == 200
            app.state.integration_http_transport.queue_response(
                status_code=200,
                body=json.dumps(exported.json()).encode("utf-8"),
            )
            created = client.post(
                "/integration/flows",
                json={
                    "name": "ERP direct APS-ready flow",
                    "source_system": "erp-direct",
                    "blocks": [
                        {
                            "id": "pull",
                            "block_type": "pull_snapshot_from_connector",
                            "config": {
                                "request_mode": "direct",
                                "url": "https://erp.example.test/api/planning-snapshot",
                                "request_method": "GET",
                                "response_root": "",
                            },
                        }
                    ],
                },
                headers=_integration_admin_headers(),
            )
            run = client.post(
                f"/integration/flows/{created.json()['id']}/run",
                headers=_integration_admin_headers(),
            )

        assert created.status_code == 200
        assert run.status_code == 200
        data = run.json()
        assert data["status"] == "completed"
        assert data["result"]["kind"] == "snapshot"
        assert data["result"]["request_url"] == "https://erp.example.test/api/planning-snapshot"
        request = app.state.integration_http_transport.requests[0]
        assert request.method == "GET"
        assert str(request.url) == "https://erp.example.test/api/planning-snapshot"

    def test_integration_flow_can_send_planning_data_to_direct_url(self):
        app = _integration_api()
        app.state.integration_http_transport.queue_response(
            status_code=202,
            body=b'{"accepted":true}',
        )
        with TestClient(app) as client:
            created = client.post(
                "/integration/flows",
                json={
                    "name": "ERP direct snapshot send",
                    "source_system": "erp-direct",
                    "blocks": [
                        {"id": "export", "block_type": "export_snapshot"},
                        {
                            "id": "push",
                            "block_type": "push_snapshot_to_connector",
                            "input_block_id": "export",
                            "config": {
                                "request_mode": "direct",
                                "url": "https://erp.example.test/api/planning-snapshot",
                                "request_method": "POST",
                                "request_headers": {"X-Plant": "plant-a"},
                                "query_params": {"source": "aps"},
                            },
                        },
                    ],
                },
                headers=_integration_admin_headers(),
            )
            run = client.post(
                f"/integration/flows/{created.json()['id']}/run",
                headers=_integration_admin_headers(),
            )

        assert created.status_code == 200
        assert run.status_code == 200
        data = run.json()
        assert data["status"] == "completed"
        assert data["result"]["kind"] == "connector_delivery"
        assert data["result"]["request_url"] == "https://erp.example.test/api/planning-snapshot?source=aps"
        request = app.state.integration_http_transport.requests[0]
        assert request.method == "POST"
        assert str(request.url) == "https://erp.example.test/api/planning-snapshot?source=aps"
        assert request.headers["Content-Type"] == "application/json"
        assert request.headers["X-Plant"] == "plant-a"
        assert b'"work_orders"' in request.body

    def test_integration_flow_can_send_published_plan_to_direct_url(self):
        app = _integration_api()
        app.state.integration_http_transport.queue_response(
            status_code=202,
            body=b'{"accepted":true}',
        )
        with TestClient(app) as client:
            created = client.post(
                "/integration/flows",
                json={
                    "name": "ERP direct published plan send",
                    "source_system": "erp-direct",
                    "blocks": [
                        {
                            "id": "plan",
                            "block_type": "export_published_plan",
                            "config": {"mode": "delta"},
                        },
                        {
                            "id": "push",
                            "block_type": "push_published_plan_to_connector",
                            "input_block_id": "plan",
                            "config": {
                                "request_mode": "direct",
                                "url": "https://erp.example.test/api/published-plan",
                                "request_method": "POST",
                                "request_headers": {"X-Plant": "plant-a"},
                            },
                        },
                    ],
                },
                headers=_integration_admin_headers(),
            )
            run = client.post(
                f"/integration/flows/{created.json()['id']}/run",
                headers=_integration_admin_headers(),
            )

        assert created.status_code == 200
        assert run.status_code == 200
        data = run.json()
        assert data["status"] == "completed"
        assert data["result"]["kind"] == "connector_delivery"
        assert data["result"]["request_url"] == "https://erp.example.test/api/published-plan"
        request = app.state.integration_http_transport.requests[0]
        assert request.method == "POST"
        assert str(request.url) == "https://erp.example.test/api/published-plan"
        assert request.headers["Content-Type"] == "application/json"
        assert request.headers["X-Plant"] == "plant-a"
        assert request.headers["X-PlaniAdvance-Payload-Kind"] == "published_plan"
        assert b'"work_orders"' in request.body

    def test_integration_flow_can_run_preview_from_or_through_a_selected_block(self):
        app = _integration_api()
        with TestClient(app) as client:
            created = client.post(
                "/integration/flows",
                json={
                    "name": "ERP preview flow",
                    "source_system": "erp-preview",
                    "blocks": [
                        {"id": "export", "block_type": "export_snapshot"},
                        {
                            "id": "transform",
                            "block_type": "transform_snapshot",
                            "input_block_id": "export",
                            "config": {
                                "operations": [
                                    {
                                        "op": "set_metadata",
                                        "key": "preview_mode",
                                        "value": "live",
                                    }
                                ]
                            },
                        },
                        {
                            "id": "validate",
                            "block_type": "validate_snapshot",
                            "input_block_id": "transform",
                        },
                        {
                            "id": "gate",
                            "block_type": "require_valid_snapshot",
                            "input_block_id": "validate",
                        },
                    ],
                },
                headers=_integration_admin_headers(),
            )
            stop_after = client.post(
                f"/integration/flows/{created.json()['id']}/run",
                json={"stop_after_block_id": "transform"},
                headers=_integration_admin_headers(),
            )
            run_from = client.post(
                f"/integration/flows/{created.json()['id']}/run",
                json={"start_block_id": "transform"},
                headers=_integration_admin_headers(),
            )

        assert created.status_code == 200
        assert stop_after.status_code == 200
        stop_data = stop_after.json()
        assert stop_data["status"] == "completed"
        assert [block["block_id"] for block in stop_data["blocks"]] == ["export", "transform"]
        assert stop_data["message"].endswith("completed through block 'transform'.")
        assert stop_data["result"]["kind"] == "snapshot"
        assert stop_data["execution_scope"]["mode"] == "through"
        assert stop_data["execution_scope"]["final_block_id"] == "transform"
        assert "preview_mode" in stop_data["blocks"][1]["output_summary"]["metadata_keys"]
        assert stop_data["blocks"][1]["input_preview"]["kind"] == "snapshot"
        assert stop_data["blocks"][1]["output_preview"]["kind"] == "snapshot"

        assert run_from.status_code == 200
        from_data = run_from.json()
        assert from_data["status"] == "completed"
        assert [block["block_id"] for block in from_data["blocks"]] == [
            "export",
            "transform",
            "validate",
            "gate",
        ]
        assert from_data["message"].endswith("completed from block 'transform'.")
        assert from_data["result"]["kind"] == "validated_snapshot"
        assert from_data["execution_scope"]["mode"] == "from"
        assert from_data["execution_scope"]["executed_block_ids"] == [
            "export",
            "transform",
            "validate",
            "gate",
        ]

    def test_automation_can_run_a_persisted_flow(self):
        app = _integration_api()
        with TestClient(app) as client:
            flow = client.post(
                "/integration/flows",
                json={
                    "name": "Flow for automation",
                    "source_system": "erp-flow",
                    "blocks": [
                        {"id": "snapshot", "block_type": "export_snapshot"},
                        {"id": "validate", "block_type": "validate_snapshot"},
                        {"id": "gate", "block_type": "require_valid_snapshot"},
                        {
                            "id": "schedule",
                            "block_type": "run_scheduling_from_snapshot",
                            "config": {"horizon_days": 5, "strategy": "greedy"},
                        },
                    ],
                },
                headers=_integration_admin_headers(),
            )
            created = client.post(
                "/integration/automations",
                json={
                    "name": "Automation flow run",
                    "direction": "outbound",
                    "trigger_type": "manual",
                    "source_system": "erp-flow",
                    "config": {
                        "mode": "flow",
                        "flow_id": flow.json()["id"],
                    },
                },
                headers=_integration_admin_headers(),
            )
            run = client.post(
                f"/integration/automations/{created.json()['id']}/run",
                headers=_integration_admin_headers(),
            )

        assert flow.status_code == 200
        assert created.status_code == 200
        assert run.status_code == 200
        data = run.json()
        assert data["job"]["last_status"] == "completed"
        assert data["result"]["mode"] == "flow"
        assert data["result"]["flow_id"] == flow.json()["id"]
        assert len(data["result"]["block_results"]) == 4
        assert data["result"]["kind"] == "schedule_result"

    def test_persisted_api_client_cannot_manage_automation_config(self):
        app = _integration_api()
        with TestClient(app) as client:
            created = client.post(
                "/integration/api-clients",
                json={"name": "ERP full client", "scopes": ["full"]},
                headers=_integration_admin_headers(),
            )
            api_key = created.json()["api_key"]
            automation = client.post(
                "/integration/automations",
                json={
                    "name": "ERP outbound snapshot",
                    "direction": "outbound",
                    "trigger_type": "manual",
                    "source_system": "erp-http",
                    "config": {"mode": "snapshot_export"},
                },
                headers={"X-API-Key": api_key},
            )

        assert created.status_code == 200
        assert automation.status_code == 401
        assert automation.json()["error"] == "login_required"

    def test_revoked_persisted_integration_api_client_cannot_authenticate(self):
        app = _integration_api()
        with TestClient(app) as client:
            created = client.post(
                "/integration/api-clients",
                json={"name": "ERP full client", "scopes": ["full"]},
                headers=_integration_admin_headers(),
            )
            api_key = created.json()["api_key"]
            first = client.get("/integration/journal", headers={"X-API-Key": api_key})
            revoked = client.post(
                f"/integration/api-clients/{created.json()['client']['id']}/revoke",
                headers=_integration_admin_headers(),
            )
            after_revoke = client.get(
                "/integration/journal",
                headers={"X-API-Key": api_key},
            )

        assert first.status_code == 200
        assert revoked.status_code == 200
        assert revoked.json()["is_active"] is False
        assert after_revoke.status_code == 403
        assert after_revoke.json()["error"] == "invalid_api_key"

    def test_persisted_integration_api_client_journal_is_auditable(self):
        app = _integration_api()
        with TestClient(app) as client:
            created = client.post(
                "/integration/api-clients",
                json={
                    "name": "ERP full client",
                    "scopes": ["full"],
                    "source_system": "erp-http",
                },
                headers=_integration_admin_headers(),
            )
            api_key = created.json()["api_key"]
            exported = client.post(
                "/integration/planning-snapshot/export",
                json={"source_system": "erp-http"},
                headers={"X-API-Key": api_key},
            )
            journal = client.get(
                "/integration/journal",
                headers={"X-API-Key": api_key},
            )

        assert exported.status_code == 200
        entry = next(entry for entry in journal.json() if entry["action"] == "export")
        assert entry["details"]["auth_mode"] == "api_client"
        assert entry["details"]["key_type"] == "client"
        assert entry["details"]["client_id"].startswith("client:iac-")
        assert entry["details"]["client_name"] == "ERP full client"
        assert entry["details"]["client_source_system"] == "erp-http"
        assert api_key not in str(entry["details"])

    def test_persisted_integration_api_client_journal_is_workspace_scoped(self):
        app = _integration_api()
        with TestClient(app) as client:
            plant_a = client.post(
                "/integration/api-clients",
                json={
                    "name": "ERP Plant A",
                    "scopes": ["full"],
                    "workspace_id": "plant-a",
                    "source_system": "erp-a",
                },
                headers=_integration_admin_headers("plant-a"),
            )
            plant_b = client.post(
                "/integration/api-clients",
                json={
                    "name": "ERP Plant B",
                    "scopes": ["full"],
                    "workspace_id": "plant-b",
                    "source_system": "erp-b",
                },
                headers=_integration_admin_headers("plant-b"),
            )
            key_a = plant_a.json()["api_key"]
            key_b = plant_b.json()["api_key"]
            export_a = client.post(
                "/integration/planning-snapshot/export",
                json={"source_system": "erp-a"},
                headers={"X-API-Key": key_a},
            )
            export_b = client.post(
                "/integration/planning-snapshot/export",
                json={"source_system": "erp-b"},
                headers={"X-API-Key": key_b},
            )
            journal_a = client.get(
                "/integration/journal",
                headers={"X-API-Key": key_a},
            )
            journal_b = client.get(
                "/integration/journal",
                headers={"X-API-Key": key_b},
            )
            cross_workspace = client.get(
                "/integration/journal",
                params={"workspace_id": "plant-b"},
                headers={"X-API-Key": key_a},
            )

        assert export_a.status_code == 200
        assert export_b.status_code == 200
        assert journal_a.status_code == 200
        assert journal_b.status_code == 200
        assert [entry["workspace_id"] for entry in journal_a.json()] == ["plant-a"]
        assert [entry["source_system"] for entry in journal_a.json()] == ["erp-a"]
        assert [entry["workspace_id"] for entry in journal_b.json()] == ["plant-b"]
        assert [entry["source_system"] for entry in journal_b.json()] == ["erp-b"]
        assert journal_a.json()[0]["details"]["workspace_id"] == "plant-a"
        assert cross_workspace.status_code == 403
        assert cross_workspace.json()["error"] == "cross_workspace_forbidden"

    def test_api_client_management_requires_authenticated_integrator(self):
        app = _integration_api()
        with TestClient(app) as client:
            created = client.post(
                "/integration/api-clients",
                json={"name": "ERP read client", "scopes": ["read"]},
            )
            listed = client.get("/integration/api-clients")

        assert created.status_code == 401
        assert created.json()["error"] == "login_required"
        assert listed.status_code == 401
        assert listed.json()["error"] == "login_required"

    def test_connector_management_requires_authenticated_integrator(self):
        app = _integration_api()
        app.state.integration_http_transport.queue_response(
            status_code=200,
            body=b'{"pong":true}',
        )
        with TestClient(app) as client:
            created = client.post(
                "/integration/connectors",
                json={
                    "name": "ERP webhook",
                    "endpoint_url": "https://erp.example.test/api/plans",
                    "source_system": "erp-http",
                    "method": "POST",
                    "auth_type": "none",
                },
            )
            listed = client.get("/integration/connectors")
            seeded = client.post(
                "/integration/connectors",
                json={
                    "name": "ERP webhook",
                    "endpoint_url": "https://erp.example.test/api/plans",
                    "source_system": "erp-http",
                    "method": "POST",
                    "auth_type": "none",
                },
                headers=_integration_admin_headers(),
            )
            tested = client.post(
                f"/integration/connectors/{seeded.json()['id']}/test",
            )

        assert created.status_code == 401
        assert created.json()["error"] == "login_required"
        assert listed.status_code == 401
        assert listed.json()["error"] == "login_required"
        assert seeded.status_code == 200
        assert tested.status_code == 401
        assert tested.json()["error"] == "login_required"

    def test_flow_configuration_requires_authenticated_integrator(self):
        app = _integration_api()
        flow_payload = {
            "name": "APS baseline flow",
            "source_system": "erp-flow",
            "blocks": [
                {"id": "snapshot", "block_type": "export_snapshot"},
                {"id": "validate", "block_type": "validate_snapshot"},
            ],
        }
        with TestClient(app) as client:
            created = client.post("/integration/flows", json=flow_payload)
            listed = client.get("/integration/flows")
            readiness = client.post("/integration/flows/readiness", json=flow_payload)
            seeded = client.post(
                "/integration/flows",
                json=flow_payload,
                headers=_integration_admin_headers(),
            )
            fetched = client.get(f"/integration/flows/{seeded.json()['id']}")
            updated = client.put(
                f"/integration/flows/{seeded.json()['id']}",
                json=flow_payload,
            )

        assert created.status_code == 401
        assert created.json()["error"] == "login_required"
        assert listed.status_code == 401
        assert listed.json()["error"] == "login_required"
        assert readiness.status_code == 401
        assert readiness.json()["error"] == "login_required"
        assert seeded.status_code == 200
        assert fetched.status_code == 401
        assert fetched.json()["error"] == "login_required"
        assert updated.status_code == 401
        assert updated.json()["error"] == "login_required"

    def test_flow_readiness_reports_ready_direct_http_block(self):
        app = _integration_api()
        with TestClient(app) as client:
            response = client.post(
                "/integration/flows/readiness",
                json={
                    "name": "ERP ping flow",
                    "source_system": "erp-http",
                    "blocks": [
                        {
                            "id": "call-api",
                            "block_type": "call_connector_api",
                            "config": {
                                "request_mode": "direct",
                                "url": "https://erp.example.test/ping",
                                "request_method": "GET",
                            },
                        }
                    ],
                },
                headers=_integration_admin_headers(),
            )

        assert response.status_code == 200
        payload = response.json()
        assert payload["status"] == "ready"
        assert payload["summary"]["block_count"] == 1
        assert payload["summary"]["blocked_block_count"] == 0
        assert payload["summary"]["warning_count"] == 0
        assert payload["blocks"][0]["block_id"] == "call-api"
        assert payload["blocks"][0]["status"] == "ready"

    def test_flow_readiness_flags_sftp_input_and_connector_mismatch(self):
        app = _integration_api()
        with TestClient(app) as client:
            connector = client.post(
                "/integration/connectors",
                json={
                    "name": "ERP HTTP profile",
                    "endpoint_url": "https://erp.example.test/api/plans",
                    "source_system": "erp-http",
                    "connector_type": "http",
                    "method": "POST",
                },
                headers=_integration_admin_headers(),
            )
            assert connector.status_code == 200

            response = client.post(
                "/integration/flows/readiness",
                json={
                    "name": "Outbound SFTP handoff",
                    "source_system": "erp-flow",
                    "blocks": [
                        {"id": "export", "block_type": "export_snapshot", "config": {}},
                        {
                            "id": "send-sftp",
                            "block_type": "send_sftp_file",
                            "config": {
                                "connector_id": connector.json()["id"],
                                "file_name": "plan.json",
                            },
                        },
                    ],
                },
                headers=_integration_admin_headers(),
            )

        assert response.status_code == 200
        payload = response.json()
        assert payload["status"] == "blocked"
        assert payload["summary"]["blocked_block_count"] == 1
        assert payload["blocks"][1]["block_id"] == "send-sftp"
        assert payload["blocks"][1]["status"] == "blocked"
        issue_codes = {issue["code"] for issue in payload["blocks"][1]["issues"]}
        assert "sftp_input_requires_format" in issue_codes
        assert "connector_type_mismatch" in issue_codes

    def test_automation_configuration_requires_authenticated_integrator(self):
        app = _integration_api()
        automation_payload = {
            "name": "ERP outbound snapshot",
            "direction": "outbound",
            "trigger_type": "manual",
            "source_system": "erp-http",
            "config": {"mode": "snapshot_export"},
        }
        with TestClient(app) as client:
            created = client.post("/integration/automations", json=automation_payload)
            listed = client.get("/integration/automations")
            health = client.get("/integration/automations/health")
            seeded = client.post(
                "/integration/automations",
                json=automation_payload,
                headers=_integration_admin_headers(),
            )

        assert created.status_code == 401
        assert created.json()["error"] == "login_required"
        assert listed.status_code == 401
        assert listed.json()["error"] == "login_required"
        assert health.status_code == 401
        assert health.json()["error"] == "login_required"
        assert seeded.status_code == 200

    def test_integration_journal_records_access_scope(self, monkeypatch):
        monkeypatch.setenv("INTEGRATION_API_KEY", "full-key")
        get_settings.cache_clear()
        try:
            app = _integration_api()
            with TestClient(app) as client:
                exported = client.post(
                    "/integration/planning-snapshot/export",
                    json={"source_system": "erp-http"},
                    headers={"X-API-Key": "full-key"},
                )
                imported = client.post(
                    "/integration/planning-snapshot/import",
                    json=exported.json(),
                    headers={"X-API-Key": "full-key"},
                )
                journal = client.get(
                    "/integration/journal",
                    headers={"X-API-Key": "full-key"},
                )
        finally:
            get_settings.cache_clear()

        assert exported.status_code == 200
        assert imported.status_code == 200
        entries = journal.json()
        import_entry = next(entry for entry in entries if entry["action"] == "import")
        export_entry = next(entry for entry in entries if entry["action"] == "export")
        assert import_entry["details"]["access_scope"] == "write"
        assert import_entry["details"]["auth_mode"] == "api_key"
        assert import_entry["details"]["key_type"] == "full"
        assert import_entry["details"]["client_id"].startswith("full:")
        assert "full-key" not in import_entry["details"]["client_id"]
        assert export_entry["details"]["access_scope"] == "read"

    def test_run_integration_key_can_run_snapshot_without_read_scope(self, monkeypatch):
        monkeypatch.setenv("INTEGRATION_API_KEY", "full-key")
        monkeypatch.setenv("INTEGRATION_RUN_API_KEY", "run-key")
        get_settings.cache_clear()
        try:
            app = _integration_api()
            with TestClient(app) as client:
                exported = client.post(
                    "/integration/planning-snapshot/export",
                    json={"source_system": "erp-http"},
                    headers={"X-API-Key": "full-key"},
                )
                run = client.post(
                    "/integration/scheduling/run-from-snapshot",
                    json={
                        "snapshot": exported.json(),
                        "horizon_days": 5,
                        "strategy": "greedy",
                    },
                    headers={"X-API-Key": "run-key"},
                )
                run_key_journal = client.get(
                    "/integration/journal",
                    headers={"X-API-Key": "run-key"},
                )
                journal = client.get(
                    "/integration/journal",
                    headers={"X-API-Key": "full-key"},
                )
        finally:
            get_settings.cache_clear()

        assert exported.status_code == 200
        assert run.status_code == 200
        assert run.json()["solver_status"] == "feasible"
        assert run_key_journal.status_code == 403
        assert run_key_journal.json()["error"] == "insufficient_scope"
        assert journal.status_code == 200
        run_entry = next(
            entry for entry in journal.json() if entry["action"] == "run_from_snapshot"
        )
        assert run_entry["details"]["access_scope"] == "run"
        assert run_entry["details"]["key_type"] == "run"
        assert run_entry["details"]["schedule_id"] == run.json()["schedule_id"]

    def test_integration_openapi_declares_api_key_header(self):
        app = _integration_api()
        with TestClient(app) as client:
            response = client.get("/openapi.json")

        assert response.status_code == 200
        schema = response.json()
        security_schemes = schema["components"]["securitySchemes"]
        assert any(
            scheme["type"] == "apiKey"
            and scheme["name"] == "X-API-Key"
            and scheme["in"] == "header"
            for scheme in security_schemes.values()
        )
        journal_get = schema["paths"]["/integration/journal"]["get"]
        assert journal_get["security"]

    def test_integration_api_key_rate_limit(self, monkeypatch):
        monkeypatch.setenv("INTEGRATION_READ_API_KEY", "rate-key")
        monkeypatch.setenv("INTEGRATION_RATE_LIMIT_PER_MINUTE", "1")
        get_settings.cache_clear()
        try:
            app = _integration_api()
            with TestClient(app) as client:
                first = client.get(
                    "/integration/journal",
                    headers={"X-API-Key": "rate-key"},
                )
                second = client.get(
                    "/integration/journal",
                    headers={"X-API-Key": "rate-key"},
                )
        finally:
            get_settings.cache_clear()

        assert first.status_code == 200
        assert second.status_code == 429
        data = second.json()
        assert data["error"] == "rate_limit_exceeded"
        assert data["details"][0]["limit_name"] == "integration_rate_limit_per_minute"
        assert data["details"][0]["client_id"].startswith("read:")
        assert "rate-key" not in data["details"][0]["client_id"]

    def test_csv_validate_rejects_payload_over_size_limit(self, monkeypatch):
        monkeypatch.setenv("INTEGRATION_MAX_CSV_BYTES", "20")
        get_settings.cache_clear()
        try:
            app = _integration_api()
            with TestClient(app) as client:
                response = client.post(
                    "/integration/planning-snapshot/csv/validate",
                    json={
                        "calendars_csv": (
                            "id,name,weekday,start,end\n"
                            "CAL-1,Day,0,08:00,17:00\n"
                        )
                    },
                )
        finally:
            get_settings.cache_clear()

        assert response.status_code == 413
        data = response.json()
        assert data["error"] == "payload_too_large"
        assert data["details"][0]["limit_name"] == "integration_max_csv_bytes"

    def test_import_snapshot_rejects_operation_count_over_limit(self, monkeypatch):
        monkeypatch.setenv("INTEGRATION_MAX_OPERATIONS", "1")
        get_settings.cache_clear()
        try:
            app = _integration_api()
            with TestClient(app) as client:
                exported = client.post(
                    "/integration/planning-snapshot/export",
                    json={"source_system": "erp-http"},
                )
                response = client.post(
                    "/integration/planning-snapshot/import",
                    json=exported.json(),
                )
        finally:
            get_settings.cache_clear()

        assert exported.status_code == 200
        assert response.status_code == 413
        data = response.json()
        assert data["error"] == "payload_too_large"
        assert data["details"][0]["limit_name"] == "integration_max_operations"

    def test_export_snapshot_route(self):
        app = _integration_api()
        with TestClient(app) as client:
            response = client.post(
                "/integration/planning-snapshot/export",
                json={
                    "source_system": "erp-http",
                    "transfer_times": {
                        "pairs": [
                            {
                                "from_machine": "CUT-1",
                                "to_machine": "ASM-1",
                                "minutes": 25,
                            }
                        ]
                    },
                    "metadata": {"plant": "demo"},
                },
            )
            journal = client.get("/integration/journal")

        assert response.status_code == 200
        data = response.json()
        assert data["contract_version"] == "aps.canonical.v1"
        assert data["source_system"] == "erp-http"
        assert data["metadata"]["plant"] == "demo"
        assert len(data["work_orders"]) == 3
        assert len(data["machines"]) == 3
        assert len(data["inventory_items"]) == 1
        assert len(data["supplies"]) == 1
        assert data["supplies"][0]["id"] == "SUP-ERP-1"
        assert all(machine["site_id"] == "demo" for machine in data["machines"])
        assert all(work_order["site_id"] == "demo" for work_order in data["work_orders"])
        assert all(
            work_order["item_id"] == work_order["product_id"]
            for work_order in data["work_orders"]
        )
        assert journal.status_code == 200
        entries = journal.json()
        assert entries[0]["action"] == "export"
        assert entries[0]["source_system"] == "erp-http"
        assert entries[0]["status"] == "exported"
        assert entries[0]["valid"] is True
        assert entries[0]["entity_counts"]["work_orders"] == 3

    def test_validate_snapshot_route(self):
        app = _integration_api()
        with TestClient(app) as client:
            exported = client.post(
                "/integration/planning-snapshot/export",
                json={"source_system": "erp-http"},
            )
            assert exported.status_code == 200
            payload = exported.json()
            payload["work_orders"][0]["site_id"] = "plant-qc"
            payload["work_orders"][0]["item_id"] = "ERP-ITEM-RED"
            payload["work_orders"][0]["quantity_uom"] = "case"
            payload["work_orders"][0]["requested_date"] = payload["work_orders"][0][
                "due_date"
            ]
            payload["work_orders"][0]["promised_date"] = payload["work_orders"][0][
                "due_date"
            ]
            payload["work_orders"][0]["erp_status"] = "FirmPlanned"
            payload["work_orders"][0]["order_type"] = "manufacturing"
            response = client.post(
                "/integration/planning-snapshot/validate",
                json=payload,
            )

        assert response.status_code == 200
        data = response.json()
        assert data["valid"] is True
        assert data["calendar_count"] == 1
        assert data["machine_count"] == 3
        assert data["resource_count"] == 3
        assert data["work_order_count"] == 3
        assert data["operation_count"] == 6
        assert data["readiness_status"] == "ready"
        assert data["error_count"] == 0
        assert data["warning_count"] == 0
        assert data["issues"] == []

        with TestClient(app) as client:
            journal = client.get("/integration/journal", params={"action": "validate"})
        assert journal.status_code == 200
        assert journal.json()[0]["status"] == "ready"

    def test_validate_snapshot_route_returns_structured_errors(self):
        app = _integration_api()
        with TestClient(app) as client:
            exported = client.post(
                "/integration/planning-snapshot/export",
                json={"source_system": "erp-http"},
            )
            assert exported.status_code == 200
            payload = exported.json()
            payload["machines"][0]["calendar_id"] = "UNKNOWN-CALENDAR"
            first_operation = payload["work_orders"][0]["operations"][0]
            first_operation["eligible_machine_ids"] = ["UNKNOWN-MACHINE"]
            first_operation["dependencies"] = ["UNKNOWN-OP"]

            response = client.post(
                "/integration/planning-snapshot/validate",
                json=payload,
            )

        assert response.status_code == 200
        data = response.json()
        assert data["valid"] is False
        assert data["readiness_status"] == "blocked"
        assert data["error_count"] >= 3
        issue_kinds = {issue["kind"] for issue in data["issues"]}
        assert {"unknown_calendar", "unknown_machine", "unknown_dependency"} <= issue_kinds
        machine_issue = next(
            issue for issue in data["issues"] if issue["kind"] == "unknown_machine"
        )
        assert machine_issue["entity_type"] == "operation"
        assert machine_issue["field"] == "eligible_machine_ids"
        assert machine_issue["reference"] == "UNKNOWN-MACHINE"

    def test_validate_csv_snapshot_route_returns_source_locations(self):
        app = _integration_api()
        with TestClient(app) as client:
            response = client.post(
                "/integration/planning-snapshot/csv/validate",
                json={
                    "source_system": "erp-csv",
                    "calendars_csv": "id,name,weekday,start,end\nCAL-1,Day,0,08:00,17:00\n",
                    "machines_csv": "id,name,calendar_id\nM1,Cutter,CAL-1\n",
                    "work_orders_csv": (
                        "id,name,product_id,item_id,quantity,quantity_uom,"
                        "release_date,due_date\n"
                        "WO-1,Order 1,P1,ERP-P1,5,ea,2026-01-05T08:00:00,"
                        "2026-01-06T17:00:00\n"
                    ),
                    "operations_csv": (
                        "id,work_order_id,sequence,name,duration_minutes,"
                        "eligible_machine_ids\n"
                        "OP-1,WO-1,1,Cut,60,GHOST-MACHINE\n"
                    ),
                },
            )

        assert response.status_code == 200
        data = response.json()
        assert data["valid"] is False
        issue = next(issue for issue in data["issues"] if issue["kind"] == "unknown_machine")
        assert issue["source_file"] == "operations.csv"
        assert issue["source_row"] == 2

    def test_validate_snapshot_route_warns_when_material_has_no_supply(self):
        app = _integration_api()
        with TestClient(app) as client:
            exported = client.post(
                "/integration/planning-snapshot/export",
                json={"source_system": "erp-http"},
            )
            assert exported.status_code == 200
            payload = exported.json()
            payload["work_orders"][0]["operations"][0]["material_requirements"] = [
                {
                    "material_id": "MAT-MISSING",
                    "quantity_per_unit": 1.0,
                    "fixed_quantity": 0.0,
                }
            ]
            payload["inventory_items"] = []
            payload["supplies"] = []

            response = client.post(
                "/integration/planning-snapshot/validate",
                json=payload,
            )

        assert response.status_code == 200
        data = response.json()
        assert data["valid"] is True
        assert data["readiness_status"] == "degraded"
        assert data["error_count"] == 0
        assert data["warning_count"] >= 1
        assert any(
            issue["kind"] == "material_without_supply"
            and issue["severity"] == "warning"
            for issue in data["issues"]
        )

    def test_validate_snapshot_route_blocks_missing_quantity_uom(self):
        app = _integration_api()
        with TestClient(app) as client:
            exported = client.post(
                "/integration/planning-snapshot/export",
                json={"source_system": "erp-http"},
            )
            assert exported.status_code == 200
            payload = exported.json()
            payload["work_orders"][0]["quantity_uom"] = " "

            response = client.post(
                "/integration/planning-snapshot/validate",
                json=payload,
            )

        assert response.status_code == 200
        data = response.json()
        assert data["valid"] is False
        assert data["readiness_status"] == "blocked"
        assert any(issue["kind"] == "missing_quantity_uom" for issue in data["issues"])

    def test_run_from_snapshot_route(self):
        app = _integration_api()
        with TestClient(app) as client:
            exported = client.post(
                "/integration/planning-snapshot/export",
                json={
                    "source_system": "erp-http",
                    "transfer_times": {
                        "pairs": [
                            {
                                "from_machine": "CUT-1",
                                "to_machine": "ASM-1",
                                "minutes": 25,
                            },
                            {
                                "from_machine": "CUT-1",
                                "to_machine": "ASM-2",
                                "minutes": 40,
                            },
                        ]
                    },
                },
            )
            assert exported.status_code == 200
            response = client.post(
                "/integration/scheduling/run-from-snapshot",
                json={
                    "snapshot": exported.json(),
                    "horizon_start": "2026-01-05T00:00:00",
                    "horizon_days": 5,
                    "strategy": "greedy",
                },
            )

        assert response.status_code == 200
        data = response.json()
        assert data["strategy"] == "greedy"
        assert data["solver_status"] == "feasible"
        assert data["summary"]["scheduled_operation_count"] == 6
        assert data["feasibility"]["readiness_status"] == "degraded"

    def test_import_snapshot_route_is_idempotent(self):
        app = _integration_api()
        with TestClient(app) as client:
            exported = client.post(
                "/integration/planning-snapshot/export",
                json={"source_system": "erp-http"},
            )
            assert exported.status_code == 200

            first = client.post(
                "/integration/planning-snapshot/import",
                json=exported.json(),
            )
            second = client.post(
                "/integration/planning-snapshot/import",
                json=exported.json(),
            )

        assert first.status_code == 200
        assert second.status_code == 200
        first_data = first.json()
        second_data = second.json()
        assert first_data["updated"]["work_orders"] == 3
        assert second_data["updated"]["work_orders"] == 3
        assert first_data["binding_count"] >= 3
        assert second_data["binding_count"] == 0
        assert first_data["validation"]["readiness_status"] == "ready"

        with TestClient(app) as client:
            journal = client.get("/integration/journal", params={"action": "import"})
        assert journal.status_code == 200
        import_entries = journal.json()
        assert len(import_entries) == 2
        assert all(entry["valid"] is True for entry in import_entries)

    def test_import_snapshot_route_rejects_invalid_snapshot_with_report(self):
        app = _integration_api()
        with TestClient(app) as client:
            exported = client.post(
                "/integration/planning-snapshot/export",
                json={"source_system": "erp-http"},
            )
            assert exported.status_code == 200
            payload = exported.json()
            payload["work_orders"][0]["operations"][0]["eligible_machine_ids"] = [
                "UNKNOWN-MACHINE"
            ]

            response = client.post(
                "/integration/planning-snapshot/import",
                json=payload,
            )

        assert response.status_code == 422
        error = response.json()
        assert error["error"] == "snapshot_validation_error"
        detail = error["details"][0]
        assert detail["valid"] is False
        assert detail["readiness_status"] == "blocked"
        assert detail["error_count"] >= 1
        assert any(issue["kind"] == "unknown_machine" for issue in detail["issues"])

        with TestClient(app) as client:
            journal = client.get("/integration/journal", params={"action": "import"})
        assert journal.status_code == 200
        blocked = journal.json()[0]
        assert blocked["status"] == "blocked"
        assert blocked["valid"] is False
        assert blocked["error_count"] >= 1

    def test_import_csv_snapshot_route_imports_valid_bundle(self):
        app = _integration_api()
        with TestClient(app) as client:
            response = client.post(
                "/integration/planning-snapshot/csv/import",
                json={
                    "source_system": "erp-csv",
                    "metadata": {"site_id": "plant-qc"},
                    "calendars_csv": "id,name,weekday,start,end\nCAL-1,Day,0,08:00,17:00\n",
                    "machines_csv": "id,name,calendar_id\nM1,Cutter,CAL-1\n",
                    "work_orders_csv": (
                        "id,name,product_id,item_id,quantity,quantity_uom,"
                        "release_date,due_date\n"
                        "WO-1,Order 1,P1,ERP-P1,5,ea,2026-01-05T08:00:00,"
                        "2026-01-06T17:00:00\n"
                    ),
                    "operations_csv": (
                        "id,work_order_id,sequence,name,duration_minutes,"
                        "eligible_machine_ids\n"
                        "OP-1,WO-1,1,Cut,60,M1\n"
                    ),
                },
            )
            journal = client.get("/integration/journal", params={"action": "import_csv"})

        assert response.status_code == 200
        data = response.json()
        assert data["source_system"] == "erp-csv"
        assert data["validation"]["readiness_status"] == "ready"
        assert journal.status_code == 200
        assert journal.json()[0]["entity_counts"]["work_orders"] == 1

    def test_published_plan_export_returns_latest_published_plan_full(self):
        app = _integration_api()
        with TestClient(app) as client:
            response = client.post(
                "/integration/published-plan/export",
                json={"source_system": "erp-out", "mode": "full"},
            )
            journal = client.get(
                "/integration/journal",
                params={"action": "published_plan_export"},
            )

        assert response.status_code == 200
        data = response.json()
        assert data["contract_version"] == "published-plan-export-v1"
        assert data["mode"] == "full"
        assert data["schedule_id"] == "sched-published-current"
        assert data["lifecycle_status"] == "published"
        assert data["entity_counts"]["work_orders"] == 3
        assert data["entity_counts"]["scheduled_operations"] == 3
        assert data["change_counts"] == {"created": 0, "updated": 0, "removed": 0}
        red = next(item for item in data["work_orders"] if item["work_order_id"] == "WO-RED")
        red_asm = next(
            operation for operation in red["operations"] if operation["operation_id"] == "RED-ASM"
        )
        assert red_asm["planned_machine_id"] == "ASM-2"
        assert journal.status_code == 200
        assert journal.json()[0]["details"]["mode"] == "full"

    def test_published_plan_export_supports_delta_against_previous_publish(self):
        app = _integration_api()
        with TestClient(app) as client:
            response = client.post(
                "/integration/published-plan/export",
                json={"source_system": "erp-out", "mode": "delta"},
            )

        assert response.status_code == 200
        data = response.json()
        assert data["mode"] == "delta"
        assert data["schedule_id"] == "sched-published-current"
        assert data["compare_to_schedule_id"] == "sched-published-base"
        assert data["entity_counts"]["work_orders"] == 3
        assert data["entity_counts"]["operations"] == 3
        assert data["change_counts"] == {"created": 1, "updated": 1, "removed": 1}
        changes = {
            operation["operation_id"]: operation
            for work_order in data["work_orders"]
            for operation in work_order["operations"]
        }
        assert changes["RED-ASM"]["change_type"] == "updated"
        assert changes["BLUE-CUT"]["change_type"] == "removed"
        assert changes["GREEN-CUT"]["change_type"] == "created"
        assert "planned_machine_id" in changes["RED-ASM"]["changed_fields"]
        assert changes["RED-ASM"]["previous_machine_id"] == "ASM-1"
        assert changes["RED-ASM"]["planned_machine_id"] == "ASM-2"

    def test_flow_can_export_published_plan(self):
        app = _integration_api()
        with TestClient(app) as client:
            flow = client.post(
                "/integration/flows",
                json={
                    "name": "ERP published plan flow",
                    "source_system": "erp-flow",
                    "blocks": [
                        {
                            "id": "plan",
                            "block_type": "export_published_plan",
                            "config": {"mode": "delta"},
                        }
                    ],
                },
                headers=_integration_admin_headers(),
            )
            assert flow.status_code == 200

            run = client.post(
                f"/integration/flows/{flow.json()['id']}/run",
                headers=_integration_admin_headers(),
            )

        assert run.status_code == 200
        data = run.json()
        assert data["status"] == "completed"
        assert data["result"]["kind"] == "published_plan"
        assert data["result"]["mode"] == "delta"
        assert data["result"]["plan"]["schedule_id"] == "sched-published-current"
        assert data["blocks"][0]["output_summary"]["plan_mode"] == "delta"

    def test_outbound_automation_run_exports_published_plan(self):
        app = _integration_api()
        with TestClient(app) as client:
            created = client.post(
                "/integration/automations",
                json={
                    "name": "ERP published plan export",
                    "direction": "outbound",
                    "trigger_type": "manual",
                    "source_system": "erp-auto",
                    "config": {
                        "mode": "published_plan_export",
                        "plan_mode": "delta",
                    },
                },
                headers=_integration_admin_headers(),
            )
            assert created.status_code == 200

            run = client.post(
                f"/integration/automations/{created.json()['id']}/run",
                headers=_integration_admin_headers(),
            )

        assert run.status_code == 200
        data = run.json()
        assert data["job"]["last_status"] == "exported"
        assert data["result"]["mode"] == "published_plan_export"
        assert data["result"]["plan"]["mode"] == "delta"
        assert data["result"]["change_counts"] == {
            "created": 1,
            "updated": 1,
            "removed": 1,
        }

    def test_outbound_automation_run_exports_planning_snapshot(self):
        app = _integration_api()
        with TestClient(app) as client:
            created = client.post(
                "/integration/automations",
                json={
                    "name": "ERP outbound snapshot",
                    "direction": "outbound",
                    "trigger_type": "manual",
                    "source_system": "erp-auto",
                    "config": {
                        "mode": "snapshot_export",
                        "metadata": {"site_id": "plant-auto"},
                    },
                },
                headers=_integration_admin_headers(),
            )
            assert created.status_code == 200

            run = client.post(
                f"/integration/automations/{created.json()['id']}/run",
                headers=_integration_admin_headers(),
            )
            journal = client.get(
                "/integration/journal",
                params={"action": "automation_outbound"},
                headers=_integration_admin_headers(),
            )

        assert run.status_code == 200
        data = run.json()
        assert data["job"]["last_status"] == "exported"
        assert data["journal_entry"]["status"] == "exported"
        assert data["journal_entry"]["valid"] is True
        assert data["journal_entry"]["entity_counts"]["work_orders"] == 3
        assert data["result"]["mode"] == "snapshot_export"
        assert data["result"]["snapshot_hash"]
        assert data["result"]["snapshot"]["source_system"] == "erp-auto"
        assert len(data["result"]["snapshot"]["work_orders"]) == 3
        assert all(
            machine["site_id"] == "plant-auto"
            for machine in data["result"]["snapshot"]["machines"]
        )
        assert journal.status_code == 200
        assert "snapshot" not in journal.json()[0]["details"]

    def test_due_automation_dry_run_does_not_execute_jobs(self):
        app = _integration_api()
        with TestClient(app) as client:
            scheduled = client.post(
                "/integration/automations",
                json={
                    "name": "ERP scheduled outbound",
                    "direction": "outbound",
                    "trigger_type": "scheduled",
                    "source_system": "erp-auto",
                    "config": {
                        "mode": "snapshot_export",
                        "schedule": {"interval_minutes": 30},
                    },
                },
                headers=_integration_admin_headers(),
            )
            manual = client.post(
                "/integration/automations",
                json={
                    "name": "ERP manual outbound",
                    "direction": "outbound",
                    "trigger_type": "manual",
                    "source_system": "erp-auto",
                    "config": {"mode": "snapshot_export"},
                },
                headers=_integration_admin_headers(),
            )
            assert scheduled.status_code == 200
            assert manual.status_code == 200

            due = client.post(
                "/integration/automations/run-due",
                json={"dry_run": True, "limit": 10},
                headers=_integration_admin_headers(),
            )
            jobs = client.get(
                "/integration/automations",
                headers=_integration_admin_headers(),
            )
            journal = client.get(
                "/integration/journal",
                params={"action": "automation_outbound"},
                headers=_integration_admin_headers(),
            )

        assert due.status_code == 200
        data = due.json()
        assert data["checked_count"] == 2
        assert data["due_count"] == 1
        assert data["executed_count"] == 0
        assert data["skipped_count"] == 1
        due_item = next(item for item in data["results"] if item["due"])
        assert due_item["job"]["id"] == scheduled.json()["id"]
        assert due_item["status"] == "due"
        assert next(
            job for job in jobs.json() if job["id"] == scheduled.json()["id"]
        )["last_run_at"] is None
        assert journal.status_code == 200
        assert journal.json() == []

    def test_run_due_automations_executes_only_due_scheduled_jobs(self):
        app = _integration_api()
        with TestClient(app) as client:
            scheduled = client.post(
                "/integration/automations",
                json={
                    "name": "ERP scheduled outbound",
                    "direction": "outbound",
                    "trigger_type": "scheduled",
                    "source_system": "erp-auto",
                    "config": {
                        "mode": "snapshot_export",
                        "schedule": {"interval_minutes": 30},
                        "metadata": {"site_id": "plant-due"},
                    },
                },
                headers=_integration_admin_headers(),
            )
            manual = client.post(
                "/integration/automations",
                json={
                    "name": "ERP manual outbound",
                    "direction": "outbound",
                    "trigger_type": "manual",
                    "source_system": "erp-auto",
                    "config": {"mode": "snapshot_export"},
                },
                headers=_integration_admin_headers(),
            )
            assert scheduled.status_code == 200
            assert manual.status_code == 200

            first = client.post(
                "/integration/automations/run-due",
                json={"limit": 10},
                headers=_integration_admin_headers(),
            )
            second = client.post(
                "/integration/automations/run-due",
                json={"limit": 10},
                headers=_integration_admin_headers(),
            )
            journal = client.get(
                "/integration/journal",
                params={"action": "automation_outbound"},
                headers=_integration_admin_headers(),
            )

        assert first.status_code == 200
        first_data = first.json()
        assert first_data["checked_count"] == 2
        assert first_data["due_count"] == 1
        assert first_data["executed_count"] == 1
        assert first_data["failed_count"] == 0
        executed = next(item for item in first_data["results"] if item["due"])
        assert executed["job"]["id"] == scheduled.json()["id"]
        assert executed["status"] == "exported"
        assert executed["job"]["last_status"] == "exported"
        assert executed["job"]["last_run_at"] is not None
        assert executed["result"]["snapshot_hash"]
        assert executed["result"]["snapshot"]["machines"][0]["site_id"] == "plant-due"

        assert second.status_code == 200
        second_data = second.json()
        assert second_data["due_count"] == 0
        assert second_data["executed_count"] == 0
        assert any(item["status"] == "not_due" for item in second_data["results"])
        assert journal.status_code == 200
        assert len(journal.json()) == 1
        assert journal.json()[0]["details"]["triggered_by"] == "scheduled_due_runner"

    def test_automation_health_reports_due_backoff_and_retry_exhausted(self):
        app = _integration_api()
        with TestClient(app) as client:
            backoff_job = client.post(
                "/integration/automations",
                json={
                    "name": "ERP retry backoff",
                    "direction": "outbound",
                    "trigger_type": "scheduled",
                    "source_system": "erp-auto",
                    "config": {
                        "mode": "unsupported_export",
                        "schedule": {"interval_minutes": 30},
                        "retry": {
                            "max_attempts": 3,
                            "base_delay_seconds": 600,
                        },
                    },
                },
                headers=_integration_admin_headers(),
            )
            exhausted_job = client.post(
                "/integration/automations",
                json={
                    "name": "ERP exhausted retry",
                    "direction": "outbound",
                    "trigger_type": "scheduled",
                    "source_system": "erp-auto",
                    "config": {
                        "mode": "unsupported_export",
                        "schedule": {"interval_minutes": 30},
                        "retry": {"max_attempts": 1},
                    },
                },
                headers=_integration_admin_headers(),
            )
            assert backoff_job.status_code == 200
            assert exhausted_job.status_code == 200

            due_run = client.post(
                "/integration/automations/run-due",
                json={"limit": 10},
                headers=_integration_admin_headers(),
            )
            due_job = client.post(
                "/integration/automations",
                json={
                    "name": "ERP due outbound",
                    "direction": "outbound",
                    "trigger_type": "scheduled",
                    "source_system": "erp-auto",
                    "config": {
                        "mode": "snapshot_export",
                        "schedule": {"interval_minutes": 30},
                    },
                },
                headers=_integration_admin_headers(),
            )
            health = client.get(
                "/integration/automations/health",
                params={"limit": 10},
                headers=_integration_admin_headers(),
            )

        assert due_run.status_code == 200
        assert due_run.json()["failed_count"] == 2
        assert due_job.status_code == 200

        assert health.status_code == 200
        data = health.json()
        assert data["status"] == "blocked"
        assert data["summary"]["total_count"] == 3
        assert data["summary"]["due_count"] == 1
        assert data["summary"]["retry_wait_count"] == 1
        assert data["summary"]["retry_exhausted_count"] == 1
        assert data["summary"]["failed_count"] == 2
        issue_statuses = {issue["status"] for issue in data["issues"]}
        assert {"due", "backoff", "retry_exhausted"} <= issue_statuses
        exhausted_issue = next(
            issue for issue in data["issues"] if issue["status"] == "retry_exhausted"
        )
        assert exhausted_issue["severity"] == "critical"
        assert exhausted_issue["job"]["id"] == exhausted_job.json()["id"]

    def test_inbound_automation_run_imports_planning_snapshot(self):
        app = _integration_api()
        with TestClient(app) as client:
            exported = client.post(
                "/integration/planning-snapshot/export",
                json={"source_system": "erp-auto"},
            )
            assert exported.status_code == 200
            created = client.post(
                "/integration/automations",
                json={
                    "name": "ERP inbound snapshot",
                    "direction": "inbound",
                    "trigger_type": "manual",
                    "source_system": "erp-auto",
                    "config": {
                        "mode": "snapshot_import",
                        "snapshot": exported.json(),
                    },
                },
                headers=_integration_admin_headers(),
            )
            assert created.status_code == 200

            run = client.post(
                f"/integration/automations/{created.json()['id']}/run",
                headers=_integration_admin_headers(),
            )
            journal = client.get(
                "/integration/journal",
                params={"action": "automation_inbound"},
                headers=_integration_admin_headers(),
            )

        assert run.status_code == 200
        data = run.json()
        assert data["job"]["last_status"] == "imported"
        assert data["journal_entry"]["status"] == "imported"
        assert data["journal_entry"]["valid"] is True
        assert data["result"]["mode"] == "snapshot_import"
        assert data["result"]["validation"]["readiness_status"] == "ready"
        assert data["result"]["updated"]["work_orders"] == 3
        assert data["result"]["binding_count"] >= 3
        assert journal.status_code == 200
        assert journal.json()[0]["details"]["mode"] == "snapshot_import"

    def test_inbound_automation_run_records_blocked_snapshot(self):
        app = _integration_api()
        with TestClient(app) as client:
            exported = client.post(
                "/integration/planning-snapshot/export",
                json={"source_system": "erp-auto"},
            )
            assert exported.status_code == 200
            payload = exported.json()
            payload["work_orders"][0]["operations"][0]["eligible_machine_ids"] = [
                "UNKNOWN-MACHINE"
            ]
            created = client.post(
                "/integration/automations",
                json={
                    "name": "ERP inbound invalid snapshot",
                    "direction": "inbound",
                    "trigger_type": "manual",
                    "source_system": "erp-auto",
                    "config": {
                        "mode": "snapshot_import",
                        "snapshot": payload,
                    },
                },
                headers=_integration_admin_headers(),
            )
            assert created.status_code == 200

            run = client.post(
                f"/integration/automations/{created.json()['id']}/run",
                headers=_integration_admin_headers(),
            )

        assert run.status_code == 200
        data = run.json()
        assert data["job"]["last_status"] == "blocked"
        assert data["journal_entry"]["status"] == "blocked"
        assert data["journal_entry"]["valid"] is False
        assert data["result"]["validation"]["readiness_status"] == "blocked"
        assert any(
            issue["kind"] == "unknown_machine"
            for issue in data["result"]["validation"]["issues"]
        )

    def test_execution_ledger_records_connector_flow_and_automation_runs(self):
        app = _integration_api()
        app.state.integration_http_transport.queue_response(
            status_code=200,
            body=b'{"pong":true}',
        )
        with TestClient(app) as client:
            connector = client.post(
                "/integration/connectors",
                json={
                    "name": "ERP webhook",
                    "endpoint_url": "https://erp.example.test/api/plans",
                    "source_system": "erp-http",
                    "method": "POST",
                },
                headers=_integration_admin_headers(),
            )
            assert connector.status_code == 200

            tested = client.post(
                f"/integration/connectors/{connector.json()['id']}/test",
                headers=_integration_admin_headers(),
            )
            assert tested.status_code == 200

            flow = client.post(
                "/integration/flows",
                json={
                    "name": "ERP export flow",
                    "source_system": "erp-flow",
                    "blocks": [
                        {"id": "export", "block_type": "export_snapshot", "config": {}},
                        {"id": "validate", "block_type": "validate_snapshot", "config": {}},
                    ],
                },
                headers=_integration_admin_headers(),
            )
            assert flow.status_code == 200

            flowed = client.post(
                f"/integration/flows/{flow.json()['id']}/run",
                headers=_integration_admin_headers(),
            )
            assert flowed.status_code == 200

            automation = client.post(
                "/integration/automations",
                json={
                    "name": "ERP outbound snapshot",
                    "direction": "outbound",
                    "trigger_type": "manual",
                    "source_system": "erp-auto",
                    "config": {"mode": "snapshot_export"},
                },
                headers=_integration_admin_headers(),
            )
            assert automation.status_code == 200

            automated = client.post(
                f"/integration/automations/{automation.json()['id']}/run",
                headers=_integration_admin_headers(),
            )
            assert automated.status_code == 200

            executions = client.get(
                "/integration/executions",
                headers=_integration_admin_headers(),
            )

        assert executions.status_code == 200
        rows = executions.json()
        kinds = {(row["execution_kind"], row["target_type"]) for row in rows}
        assert ("connector_test", "connector") in kinds
        assert ("flow_run", "flow") in kinds
        assert ("automation_run", "automation") in kinds
        connector_row = next(row for row in rows if row["execution_kind"] == "connector_test")
        assert connector_row["status"] == "ok"
        assert connector_row["message"] == "Connector responded with HTTP 200."
        assert connector_row["duration_ms"] >= 0
        flow_row = next(row for row in rows if row["execution_kind"] == "flow_run")
        assert flow_row["journal_entry_id"] is not None
        assert flow_row["details"]["block_count"] == 2
        automation_row = next(row for row in rows if row["execution_kind"] == "automation_run")
        assert automation_row["entity_counts"]["work_orders"] == 3
        assert automation_row["correlation_id"]

    def test_execution_ledger_requires_authenticated_human_context(self):
        app = _integration_api()
        with TestClient(app) as client:
            created = client.post(
                "/integration/api-clients",
                json={"name": "ERP full client", "scopes": ["full"]},
                headers=_integration_admin_headers(),
            )
            assert created.status_code == 200

            response = client.get(
                "/integration/executions",
                headers={"X-API-Key": created.json()["api_key"]},
            )

        assert response.status_code == 401

    def test_flow_blocks_catalog_exposes_call_connector_api_schema(self):
        """Studio v2 phase 2: the /flow-blocks catalog must surface
        config_fields + expected_input_kinds so the frontend can render
        a schema-driven Inspector form and type-check edges."""
        app = _integration_api()
        with TestClient(app) as client:
            response = client.get("/integration/flow-blocks")
            assert response.status_code == 200
            items = response.json()
        call_api = next(i for i in items if i["block_type"] == "call_connector_api")
        keys = {f["key"] for f in call_api["config_fields"]}
        assert {"connector_id", "route_path", "query_params", "request_headers"} <= keys
        assert call_api["expected_input_kinds"] is not None
        assert "api_response" in call_api["expected_input_kinds"]

    def test_flow_blocks_catalog_exposes_validate_snapshot_inputs(self):
        app = _integration_api()
        with TestClient(app) as client:
            items = client.get("/integration/flow-blocks").json()
        validate = next(i for i in items if i["block_type"] == "validate_snapshot")
        # Validate has no user-facing config — just runs the readiness gate.
        assert validate["config_fields"] == []
        assert validate["expected_input_kinds"] == ["snapshot"]

    def test_trigger_blocks_run_as_pass_through_producers(self):
        """Studio v2 phase 5: each trigger block emits a trigger_event
        payload when executed, marking 'ready' so the next block can
        consume it. Worker firing is deferred — this just proves the
        manual Run path produces the contract."""
        app = _integration_api()
        with TestClient(app) as client:
            for block_type in (
                "trigger_manual",
                "trigger_schedule",
                "trigger_webhook",
            ):
                # trigger_schedule needs a cron; the others have no config.
                config: dict = {}
                if block_type == "trigger_schedule":
                    config = {"cron_expression": "*/15 * * * *"}
                created = client.post(
                    "/integration/flows",
                    json={
                        "name": f"Phase 5 {block_type}",
                        "source_system": "studio_v2",
                        "blocks": [
                            {
                                "id": "t1",
                                "block_type": block_type,
                                "name": block_type,
                                "config": config,
                            }
                        ],
                    },
                    headers=_integration_admin_headers(),
                )
                assert created.status_code == 200, created.text
                flow_id = created.json()["id"]
                run = client.post(
                    f"/integration/flows/{flow_id}/run",
                    json={},
                    headers=_integration_admin_headers(),
                )
                assert run.status_code == 200, run.text
                body = run.json()
                blocks = body["blocks"]
                assert len(blocks) == 1
                trigger = blocks[0]
                assert trigger["status"] == "ready"
                payload = trigger["output_preview"]
                assert payload is not None
                assert payload["kind"] == "trigger_event"
                assert payload["via"] == block_type.removeprefix("trigger_")

    def test_flow_blocks_catalog_lists_three_trigger_blocks(self):
        """Studio v2 phase 5: the three trigger blocks must appear in
        the catalog under category 'trigger' so the palette can group
        them. trigger_schedule must expose its cron_expression field."""
        app = _integration_api()
        with TestClient(app) as client:
            items = client.get("/integration/flow-blocks").json()
        triggers = [i for i in items if i["category"] == "trigger"]
        block_types = {t["block_type"] for t in triggers}
        assert block_types == {
            "trigger_manual",
            "trigger_schedule",
            "trigger_webhook",
        }
        schedule = next(t for t in triggers if t["block_type"] == "trigger_schedule")
        assert any(f["key"] == "cron_expression" for f in schedule["config_fields"])
        for t in triggers:
            assert t["accepts_input"] is False
            assert t["output_kind"] == "trigger_event"
