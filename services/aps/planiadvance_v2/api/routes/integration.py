from __future__ import annotations

import hashlib
import hmac as hmac_module
import json as json_module
from datetime import datetime, time
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Request, Response

from ...application.integration import (
    CanonicalCsvBundle,
    CanonicalPlanningSnapshot,
    snapshot_from_csv_bundle,
    validate_snapshot_report,
)
from ...application.integration.canonical_snapshot import (
    CanonicalCalendar,
    CanonicalDependencyLink,
    CanonicalInventoryItem,
    CanonicalLotSizing,
    CanonicalMachine,
    CanonicalMaterialRequirement,
    CanonicalOperation,
    CanonicalResource,
    CanonicalResourceRequirement,
    CanonicalRoutingAlternative,
    CanonicalSetupMatrix,
    CanonicalShift,
    CanonicalSupplyLot,
    CanonicalTimeWindow,
    CanonicalTransferTimes,
    CanonicalWorkOrder,
)
from ...application.ports import (
    FlowBlockInput,
    FlowRunTraceRepository,
    IntegrationApiClient,
    IntegrationAutomationJob,
    IntegrationAutomationRepository,
    IntegrationConnector,
    IntegrationCredential,
    IntegrationExecutionRecord,
    IntegrationExecutionRepository,
    IntegrationFlow,
    IntegrationFlowBlock,
    IntegrationJournalEntry,
    IntegrationJournalRepository,
    WorkspaceRepository,
)
from ...application.use_cases import (
    FLOW_BLOCK_CATALOG,
    CreateIntegrationApiClientInput,
    CreateIntegrationConnectorInput,
    CreateIntegrationCredentialInput,
    CreateIntegrationFlowInput,
    EvaluateIntegrationFlowReadinessInput,
    ExportPlanningSnapshot,
    ExportPlanningSnapshotInput,
    ExportPublishedPlan,
    ExportPublishedPlanInput,
    GetIntegrationAutomationHealth,
    GetIntegrationAutomationHealthInput,
    ImportPlanningSnapshot,
    ImportPlanningSnapshotInput,
    InspectIntegrationConnectorSchemaInput,
    ManageIntegrationApiClients,
    ManageIntegrationConnectors,
    ManageIntegrationCredentials,
    ManageIntegrationFlows,
    RevokeIntegrationApiClientInput,
    RunDueIntegrationAutomations,
    RunDueIntegrationAutomationsInput,
    RunIntegrationAutomation,
    RunIntegrationAutomationInput,
    RunIntegrationAutomationRejected,
    RunIntegrationFlow,
    RunIntegrationFlowInput,
    RunIntegrationFlowRejected,
    RunSchedulingFromSnapshot,
    RunSchedulingFromSnapshotInput,
    TestFlowBlockInput,
    TestIntegrationConnectorInput,
    UpdateIntegrationConnectorInput,
    UpdateIntegrationFlowInput,
    ValidateIntegrationFlowGraph,
    ValidateIntegrationFlowGraphInput,
    record_audit_event,
)
from ...config import get_settings
from ...domain.errors import ValidationError
from ...domain.scheduling import Objective
from ...domain.value_objects import TransferTimes
from ...infrastructure.db.repositories import SqlIntegrationFlowRepository
from ..dependencies import (
    get_audit_event_repository,
    get_export_planning_snapshot,
    get_export_published_plan,
    get_flow_run_trace_repository,
    get_import_planning_snapshot,
    get_integration_automation_health,
    get_integration_automations,
    get_integration_executions,
    get_integration_flow_repository,
    get_integration_journal,
    get_manage_integration_api_clients,
    get_manage_integration_connectors,
    get_manage_integration_credentials,
    get_manage_integration_flows,
    get_run_due_integration_automations,
    get_run_integration_automation,
    get_run_integration_flow,
    get_run_scheduling_from_snapshot,
    get_validate_integration_flow_graph,
    get_webhook_event_dedup_repository,
)
from ..schemas import (
    CanonicalCalendarSchema,
    CanonicalCsvBundleRequest,
    CanonicalDependencyLinkSchema,
    CanonicalImportResponse,
    CanonicalInventoryItemSchema,
    CanonicalLotSizingSchema,
    CanonicalMachineSchema,
    CanonicalMaterialRequirementSchema,
    CanonicalOperationSchema,
    CanonicalPlanningSnapshotSchema,
    CanonicalResourceRequirementSchema,
    CanonicalResourceSchema,
    CanonicalRoutingAlternativeSchema,
    CanonicalSetupMatrixSchema,
    CanonicalSetupTransitionSchema,
    CanonicalShiftSchema,
    CanonicalSupplyLotSchema,
    CanonicalTimeWindowSchema,
    CanonicalTransferTimePairSchema,
    CanonicalTransferTimesSchema,
    CanonicalValidationResponse,
    CanonicalWorkOrderSchema,
    ExportPlanningSnapshotRequest,
    FlowRunTraceOut,
    FlowTemplateBlockOut,
    FlowTemplateOut,
    FlowTestBlockRequest,
    FlowTestBlockResponse,
    IntegrationApiClientCreateResponse,
    IntegrationApiClientIn,
    IntegrationApiClientOut,
    IntegrationAutomationHealthIssueOut,
    IntegrationAutomationHealthOut,
    IntegrationAutomationJobIn,
    IntegrationAutomationJobOut,
    IntegrationAutomationRunDueItemOut,
    IntegrationAutomationRunDueOut,
    IntegrationAutomationRunDueRequest,
    IntegrationAutomationRunOut,
    IntegrationConnectorDatabaseSchemaOut,
    IntegrationConnectorIn,
    IntegrationConnectorOut,
    IntegrationConnectorPatch,
    IntegrationConnectorTestResponse,
    IntegrationCredentialIn,
    IntegrationCredentialOut,
    IntegrationDatabaseColumnSchemaOut,
    IntegrationDatabaseTableSchemaOut,
    IntegrationExecutionOut,
    IntegrationFlowBlockCatalogItemOut,
    IntegrationFlowGraphIssueOut,
    IntegrationFlowIn,
    IntegrationFlowOut,
    IntegrationFlowReadinessBlockOut,
    IntegrationFlowReadinessIssueOut,
    IntegrationFlowReadinessOut,
    IntegrationFlowReadinessSummaryOut,
    IntegrationFlowRunBlockOut,
    IntegrationFlowRunOut,
    IntegrationFlowRunRequest,
    IntegrationFlowRunScopeOut,
    IntegrationFlowValidateGraphOut,
    IntegrationJournalEntryOut,
    ObjectiveIn,
    PublishedPlanExportRequest,
    PublishedPlanExportResponse,
    RunScheduleFromSnapshotRequest,
    RunScheduleResponse,
    ScheduledOperationOut,
)
from ..security import (
    IntegrationPrincipal,
    enforce_rate_limit,
    require_integration_read_access,
    require_integration_run_access,
    require_integration_write_access,
)
from ..tenant import (
    TenantContext,
    ensure_authenticated_permission,
    ensure_permission,
    get_tenant_context,
    get_tenant_workspace_repository,
    resolve_scoped_workspace_id,
)
from .scheduling import (
    _build_analysis_out,
    _build_feasibility_out,
    _build_summary_out,
)

router = APIRouter(
    prefix="/integration",
    tags=["integration"],
)


def _snapshot_entity_counts(snapshot: CanonicalPlanningSnapshot) -> dict[str, int]:
    return {
        "calendars": len(snapshot.calendars),
        "machines": len(snapshot.machines),
        "resources": len(snapshot.resources),
        "work_orders": len(snapshot.work_orders),
        "operations": sum(len(work_order.operations) for work_order in snapshot.work_orders),
        "inventory_items": len(snapshot.inventory_items),
        "supplies": len(snapshot.supplies),
    }


def _enforce_csv_payload_limits(payload: CanonicalCsvBundleRequest) -> None:
    limit = get_settings().integration_max_csv_bytes
    actual = sum(
        len(content.encode("utf-8"))
        for content in (
            payload.calendars_csv,
            payload.machines_csv,
            payload.work_orders_csv,
            payload.operations_csv,
        )
    )
    if actual > limit:
        _raise_payload_too_large(
            limit_name="integration_max_csv_bytes",
            actual=actual,
            limit=limit,
            message="CSV planning snapshot payload is too large.",
        )


def _enforce_snapshot_limits(snapshot: CanonicalPlanningSnapshot) -> None:
    settings = get_settings()
    counts = _snapshot_entity_counts(snapshot)
    if counts["work_orders"] > settings.integration_max_work_orders:
        _raise_payload_too_large(
            limit_name="integration_max_work_orders",
            actual=counts["work_orders"],
            limit=settings.integration_max_work_orders,
            message="Planning snapshot contains too many work orders.",
        )
    if counts["operations"] > settings.integration_max_operations:
        _raise_payload_too_large(
            limit_name="integration_max_operations",
            actual=counts["operations"],
            limit=settings.integration_max_operations,
            message="Planning snapshot contains too many operations.",
        )


def _raise_payload_too_large(
    *,
    limit_name: str,
    actual: int,
    limit: int,
    message: str,
) -> None:
    raise HTTPException(
        status_code=413,
        detail={
            "error": "payload_too_large",
            "message": message,
            "details": [
                {
                    "limit_name": limit_name,
                    "actual": actual,
                    "limit": limit,
                }
            ],
        },
    )


def _save_journal_entry(
    journal: IntegrationJournalRepository,
    *,
    action: str,
    source_system: str,
    status: str,
    valid: bool,
    entity_counts: dict[str, int],
    error_count: int = 0,
    warning_count: int = 0,
    details: dict[str, object] | None = None,
    principal: IntegrationPrincipal | None = None,
    organization_id: str | None = None,
    workspace_id: str | None = None,
) -> IntegrationJournalEntry:
    entry_details = dict(details or {})
    entry_organization_id = organization_id
    entry_workspace_id = workspace_id
    if principal is not None:
        entry_details["access_scope"] = principal.access_scope.value
        entry_details["auth_mode"] = principal.auth_mode
        entry_details["key_type"] = principal.key_type
        entry_details["client_id"] = principal.client_id
        entry_organization_id = entry_organization_id or principal.organization_id
        entry_workspace_id = entry_workspace_id or principal.workspace_id
        if principal.scopes:
            entry_details["scopes"] = list(principal.scopes)
        if principal.client_name:
            entry_details["client_name"] = principal.client_name
        if principal.organization_id:
            entry_details["organization_id"] = principal.organization_id
        if principal.workspace_id:
            entry_details["workspace_id"] = principal.workspace_id
        if principal.source_system:
            entry_details["client_source_system"] = principal.source_system
    entry = IntegrationJournalEntry(
        id=f"ij-{uuid4().hex[:12]}",
        action=action,
        source_system=source_system,
        status=status,
        valid=valid,
        organization_id=entry_organization_id,
        workspace_id=entry_workspace_id,
        error_count=error_count,
        warning_count=warning_count,
        entity_counts=entity_counts,
        details=entry_details,
    )
    journal.save(entry)
    return entry


def _api_client_to_schema(client: IntegrationApiClient) -> IntegrationApiClientOut:
    return IntegrationApiClientOut(
        id=client.id,
        organization_id=client.organization_id,
        workspace_id=client.workspace_id,
        name=client.name,
        source_system=client.source_system,
        key_prefix=client.key_prefix,
        scopes=list(client.scopes),
        is_active=client.is_active,
        created_by_user_id=client.created_by_user_id,
        expires_at=client.expires_at,
        last_used_at=client.last_used_at,
        created_at=client.created_at,
        updated_at=client.updated_at,
    )


def _connector_to_schema(connector: IntegrationConnector) -> IntegrationConnectorOut:
    has_secret = bool(connector.secret_ref)
    if connector.secret_ref and connector.secret_ref.startswith("env:"):
        secret_ref = connector.secret_ref
        secret_mode = "env"
    elif connector.secret_ref and connector.secret_ref.startswith("sealed:"):
        secret_ref = "stored-in-app"
        secret_mode = "app"
    else:
        secret_ref = None
        secret_mode = "none"
    return IntegrationConnectorOut(
        id=connector.id,
        organization_id=connector.organization_id,
        workspace_id=connector.workspace_id,
        name=connector.name,
        endpoint_url=connector.endpoint_url,
        source_system=connector.source_system,
        connector_type=connector.connector_type,
        method=connector.method,
        auth_type=connector.auth_type,
        auth_header_name=connector.auth_header_name,
        username=connector.username,
        credential_id=connector.credential_id,
        secret_ref=secret_ref,
        secret_mode=secret_mode,
        has_secret=has_secret,
        static_headers=dict(connector.static_headers),
        timeout_seconds=connector.timeout_seconds,
        is_enabled=connector.is_enabled,
        created_by_user_id=connector.created_by_user_id,
        last_tested_at=connector.last_tested_at,
        last_test_status=connector.last_test_status,
        last_test_message=connector.last_test_message,
        created_at=connector.created_at,
        updated_at=connector.updated_at,
    )


def _credential_to_schema(credential: IntegrationCredential) -> IntegrationCredentialOut:
    has_secret = bool(credential.secret_ref)
    if credential.secret_ref and credential.secret_ref.startswith("env:"):
        secret_ref = credential.secret_ref
        secret_mode = "env"
    elif credential.secret_ref and credential.secret_ref.startswith("sealed:"):
        secret_ref = "stored-in-app"
        secret_mode = "app"
    else:
        secret_ref = None
        secret_mode = "none"
    return IntegrationCredentialOut(
        id=credential.id,
        organization_id=credential.organization_id,
        workspace_id=credential.workspace_id,
        name=credential.name,
        source_system=credential.source_system,
        auth_type=credential.auth_type,
        auth_header_name=credential.auth_header_name,
        username=credential.username,
        secret_ref=secret_ref,
        secret_mode=secret_mode,
        has_secret=has_secret,
        is_enabled=credential.is_enabled,
        created_by_user_id=credential.created_by_user_id,
        created_at=credential.created_at,
        updated_at=credential.updated_at,
    )


def _database_schema_to_schema(
    result,
) -> IntegrationConnectorDatabaseSchemaOut:
    return IntegrationConnectorDatabaseSchemaOut(
        connector=_connector_to_schema(result.connector),
        dialect=result.dialect,
        database=result.database,
        tables=[
            IntegrationDatabaseTableSchemaOut(
                name=table.name,
                schema_name=table.schema_name,
                full_name=table.full_name or table.name,
                columns=[
                    IntegrationDatabaseColumnSchemaOut(
                        name=column.name,
                        data_type=column.data_type,
                        nullable=column.nullable,
                        is_primary_key=column.is_primary_key,
                    )
                    for column in table.columns
                ],
            )
            for table in result.tables
        ],
    )


def _flow_to_schema(flow: IntegrationFlow) -> IntegrationFlowOut:
    return IntegrationFlowOut(
        id=flow.id,
        organization_id=flow.organization_id,
        workspace_id=flow.workspace_id,
        name=flow.name,
        source_system=flow.source_system,
        is_enabled=flow.is_enabled,
        blocks=[
            {
                "id": block.id,
                "block_type": block.block_type,
                "name": block.name,
                "input_block_id": block.input_block_id,
                "inputs": [
                    {
                        "source_block_id": edge.source_block_id,
                        "edge_type": edge.edge_type,
                        "case_value": edge.case_value,
                    }
                    for edge in block.inputs
                ],
                "config": dict(block.config),
            }
            for block in flow.blocks
        ],
        last_status=flow.last_status,
        last_message=flow.last_message,
        last_run_at=flow.last_run_at,
        created_by_user_id=flow.created_by_user_id,
        created_at=flow.created_at,
        updated_at=flow.updated_at,
    )


def _published_plan_to_schema(output) -> PublishedPlanExportResponse:
    return PublishedPlanExportResponse(**output.as_dict())


def _flow_blocks_from_schema(payload: IntegrationFlowIn) -> list[IntegrationFlowBlock]:
    return [
        IntegrationFlowBlock(
            id=block.id,
            block_type=block.block_type,
            name=block.name,
            input_block_id=block.input_block_id,
            inputs=[
                FlowBlockInput(
                    source_block_id=edge.source_block_id,
                    edge_type=edge.edge_type,
                    case_value=edge.case_value,
                )
                for edge in block.inputs
            ],
            config=dict(block.config),
        )
        for block in payload.blocks
    ]


def _flow_readiness_issue_to_schema(issue) -> IntegrationFlowReadinessIssueOut:
    return IntegrationFlowReadinessIssueOut(
        code=issue.code,
        severity=issue.severity,
        message=issue.message,
        block_id=issue.block_id,
        suggested_action=issue.suggested_action,
    )


def _flow_readiness_to_schema(readiness) -> IntegrationFlowReadinessOut:
    return IntegrationFlowReadinessOut(
        status=readiness.status,
        message=readiness.message,
        blocks=[
            IntegrationFlowReadinessBlockOut(
                block_id=block.block_id,
                block_type=block.block_type,
                status=block.status,
                message=block.message,
                issues=[
                    _flow_readiness_issue_to_schema(issue) for issue in block.issues
                ],
            )
            for block in readiness.blocks
        ],
        blockers=[
            _flow_readiness_issue_to_schema(issue) for issue in readiness.blockers
        ],
        warnings=[
            _flow_readiness_issue_to_schema(issue) for issue in readiness.warnings
        ],
        summary=IntegrationFlowReadinessSummaryOut(**readiness.summary),
    )


def _effective_integration_context(
    tenant: TenantContext,
    principal: IntegrationPrincipal,
) -> TenantContext:
    organization_id = tenant.organization_id
    if principal.organization_id is not None:
        if (
            organization_id is not None
            and organization_id != principal.organization_id
        ):
            raise HTTPException(
                status_code=403,
                detail={
                    "error": "cross_tenant_forbidden",
                    "message": (
                        "Integration API client organization does not match "
                        "the tenant context."
                    ),
                },
            )
        organization_id = principal.organization_id

    workspace_id = tenant.workspace_id
    if principal.workspace_id is not None:
        if workspace_id is not None and workspace_id != principal.workspace_id:
            raise HTTPException(
                status_code=403,
                detail={
                    "error": "cross_workspace_forbidden",
                    "message": (
                        "Integration API client workspace does not match "
                        "the tenant context."
                    ),
                },
            )
        workspace_id = principal.workspace_id

    return TenantContext(
        organization_id=organization_id,
        user_id=tenant.user_id,
        workspace_id=workspace_id,
        role=tenant.role,
    )


def _ensure_integration_route_permission(
    tenant: TenantContext,
    principal: IntegrationPrincipal,
    permission: str,
) -> None:
    if principal.auth_mode == "api_client":
        return
    ensure_permission(tenant, permission)


def _actor_details(
    principal: IntegrationPrincipal,
    tenant: TenantContext | None = None,
) -> dict[str, object]:
    details: dict[str, object] = {
        "access_scope": principal.access_scope.value,
        "auth_mode": principal.auth_mode,
        "key_type": principal.key_type,
        "client_id": principal.client_id,
    }
    if principal.scopes:
        details["scopes"] = list(principal.scopes)
    if principal.client_name:
        details["client_name"] = principal.client_name
    if principal.organization_id:
        details["organization_id"] = principal.organization_id
    if principal.workspace_id:
        details["workspace_id"] = principal.workspace_id
    if principal.source_system:
        details["client_source_system"] = principal.source_system
    if tenant is not None and tenant.user_id:
        details["user_id"] = tenant.user_id
    if tenant is not None and tenant.organization_id and "organization_id" not in details:
        details["organization_id"] = tenant.organization_id
    if tenant is not None and tenant.workspace_id and "workspace_id" not in details:
        details["workspace_id"] = tenant.workspace_id
    return details


def _authenticated_actor_details(tenant: TenantContext) -> dict[str, object]:
    details: dict[str, object] = {
        "auth_mode": "planner_session",
        "user_id": tenant.user_id,
    }
    if tenant.organization_id:
        details["organization_id"] = tenant.organization_id
    if tenant.workspace_id:
        details["workspace_id"] = tenant.workspace_id
    if tenant.role:
        details["role"] = tenant.role
    return details


def _journal_entry_to_schema(entry: IntegrationJournalEntry) -> IntegrationJournalEntryOut:
    return IntegrationJournalEntryOut(
        id=entry.id,
        organization_id=entry.organization_id,
        workspace_id=entry.workspace_id,
        action=entry.action,
        source_system=entry.source_system,
        status=entry.status,
        valid=entry.valid,
        error_count=entry.error_count,
        warning_count=entry.warning_count,
        entity_counts=entry.entity_counts,
        details=entry.details,
        created_at=entry.created_at,
    )


def _execution_to_schema(
    record: IntegrationExecutionRecord,
) -> IntegrationExecutionOut:
    return IntegrationExecutionOut(
        id=record.id,
        organization_id=record.organization_id,
        workspace_id=record.workspace_id,
        execution_kind=record.execution_kind,
        target_type=record.target_type,
        target_id=record.target_id,
        target_name=record.target_name,
        source_system=record.source_system,
        status=record.status,
        valid=record.valid,
        trigger_type=record.trigger_type,
        actor_mode=record.actor_mode,
        actor_id=record.actor_id,
        correlation_id=record.correlation_id,
        attempt_number=record.attempt_number,
        message=record.message,
        error_code=record.error_code,
        entity_counts=record.entity_counts,
        details=record.details,
        journal_entry_id=record.journal_entry_id,
        started_at=record.started_at,
        finished_at=record.finished_at,
        duration_ms=record.duration_ms,
    )


def _automation_to_schema(job: IntegrationAutomationJob) -> IntegrationAutomationJobOut:
    return IntegrationAutomationJobOut(
        id=job.id,
        organization_id=job.organization_id,
        workspace_id=job.workspace_id,
        name=job.name,
        direction=job.direction,
        trigger_type=job.trigger_type,
        source_system=job.source_system,
        is_enabled=job.is_enabled,
        config=job.config,
        last_status=job.last_status,
        last_message=job.last_message,
        last_run_at=job.last_run_at,
        lock_owner=job.lock_owner,
        locked_until=job.locked_until,
        attempt_count=job.attempt_count,
        next_attempt_at=job.next_attempt_at,
        last_error_code=job.last_error_code,
        last_error_at=job.last_error_at,
        created_at=job.created_at,
        updated_at=job.updated_at,
    )


def _automation_due_result_to_schema(result) -> IntegrationAutomationRunDueItemOut:
    return IntegrationAutomationRunDueItemOut(
        job=_automation_to_schema(result.job),
        due=result.due,
        status=result.status,
        message=result.message,
        last_run_at=result.last_run_at,
        next_run_at=result.next_run_at,
        result=result.result,
    )


def _automation_health_issue_to_schema(
    issue,
) -> IntegrationAutomationHealthIssueOut:
    return IntegrationAutomationHealthIssueOut(
        job=_automation_to_schema(issue.job),
        status=issue.status,
        severity=issue.severity,
        message=issue.message,
        next_action=issue.next_action,
        next_run_at=issue.next_run_at,
    )


def _validate_automation_payload(payload: IntegrationAutomationJobIn) -> None:
    allowed_directions = {"inbound", "outbound"}
    allowed_triggers = {"manual", "scheduled", "webhook"}
    if payload.direction not in allowed_directions:
        raise HTTPException(
            status_code=422,
            detail={
                "error": "invalid_automation_direction",
                "message": "Automation direction must be inbound or outbound.",
            },
        )
    if payload.trigger_type not in allowed_triggers:
        raise HTTPException(
            status_code=422,
            detail={
                "error": "invalid_automation_trigger",
                "message": "Automation trigger_type must be manual, scheduled or webhook.",
            },
        )
    mode = str(payload.config.get("mode") or "").strip().lower()
    if mode in {"flow", "flow_run"} and not str(payload.config.get("flow_id") or "").strip():
        raise HTTPException(
            status_code=422,
            detail={
                "error": "missing_flow_id",
                "message": "Flow-backed automation requires config.flow_id.",
            },
        )


def _build_objective(payload: ObjectiveIn | None) -> Objective:
    if payload is None:
        return Objective.default()
    return Objective(
        makespan=payload.makespan,
        total_tardiness=payload.total_tardiness,
        weighted_tardiness=payload.weighted_tardiness,
        setup_cost=payload.setup_cost,
        idle_penalty=payload.idle_penalty,
    )


def _schema_to_snapshot(schema: CanonicalPlanningSnapshotSchema) -> CanonicalPlanningSnapshot:
    return CanonicalPlanningSnapshot(
        contract_version=schema.contract_version,
        exported_at=schema.exported_at,
        source_system=schema.source_system,
        calendars=tuple(_schema_to_calendar(c) for c in schema.calendars),
        machines=tuple(_schema_to_machine(m) for m in schema.machines),
        resources=tuple(_schema_to_resource(r) for r in schema.resources),
        work_orders=tuple(_schema_to_work_order(wo) for wo in schema.work_orders),
        inventory_items=tuple(
            CanonicalInventoryItem(
                material_id=item.material_id,
                quantity_on_hand=item.quantity_on_hand,
                as_of=item.as_of,
            )
            for item in schema.inventory_items
        ),
        supplies=tuple(
            CanonicalSupplyLot(
                id=lot.id,
                material_id=lot.material_id,
                quantity=lot.quantity,
                available_at=lot.available_at,
                source_type=lot.source_type,
            )
            for lot in schema.supplies
        ),
        transfer_times=CanonicalTransferTimes(
            default_minutes=schema.transfer_times.default_minutes,
            pairs={
                (pair.from_machine, pair.to_machine): pair.minutes
                for pair in schema.transfer_times.pairs
            },
        ),
        metadata=dict(schema.metadata),
    )


def _snapshot_to_schema(snapshot: CanonicalPlanningSnapshot) -> CanonicalPlanningSnapshotSchema:
    return CanonicalPlanningSnapshotSchema(
        contract_version=snapshot.contract_version,
        exported_at=snapshot.exported_at,
        source_system=snapshot.source_system,
        calendars=[_calendar_to_schema(c) for c in snapshot.calendars],
        machines=[_machine_to_schema(m) for m in snapshot.machines],
        resources=[_resource_to_schema(r) for r in snapshot.resources],
        work_orders=[_work_order_to_schema(wo) for wo in snapshot.work_orders],
        inventory_items=[
            CanonicalInventoryItemSchema(
                material_id=item.material_id,
                quantity_on_hand=item.quantity_on_hand,
                as_of=item.as_of,
            )
            for item in snapshot.inventory_items
        ],
        supplies=[
            CanonicalSupplyLotSchema(
                id=lot.id,
                material_id=lot.material_id,
                quantity=lot.quantity,
                available_at=lot.available_at,
                source_type=lot.source_type,
            )
            for lot in snapshot.supplies
        ],
        transfer_times=CanonicalTransferTimesSchema(
            default_minutes=snapshot.transfer_times.default_minutes,
            pairs=[
                CanonicalTransferTimePairSchema(
                    from_machine=src,
                    to_machine=dst,
                    minutes=minutes,
                )
                for (src, dst), minutes in snapshot.transfer_times.pairs.items()
            ],
        ),
        metadata=dict(snapshot.metadata),
    )


def _csv_payload_to_snapshot(payload: CanonicalCsvBundleRequest) -> CanonicalPlanningSnapshot:
    _enforce_csv_payload_limits(payload)
    try:
        snapshot = snapshot_from_csv_bundle(
            CanonicalCsvBundle(
                calendars_csv=payload.calendars_csv,
                machines_csv=payload.machines_csv,
                work_orders_csv=payload.work_orders_csv,
                operations_csv=payload.operations_csv,
                source_system=payload.source_system,
                exported_at=payload.exported_at,
                metadata=payload.metadata,
            )
        )
        _enforce_snapshot_limits(snapshot)
        return snapshot
    except ValueError as exc:
        raise HTTPException(
            status_code=422,
            detail={
                "error": "csv_parse_error",
                "message": str(exc),
            },
        ) from exc


def _validation_response(
    snapshot: CanonicalPlanningSnapshot,
    report,
) -> CanonicalValidationResponse:
    operation_count = sum(len(wo.operations) for wo in snapshot.work_orders)
    return CanonicalValidationResponse(
        contract_version=snapshot.contract_version,
        source_system=snapshot.source_system,
        valid=report.valid,
        readiness_status=report.readiness_status,
        error_count=report.error_count,
        warning_count=report.warning_count,
        calendar_count=len(snapshot.calendars),
        machine_count=len(snapshot.machines),
        resource_count=len(snapshot.resources),
        work_order_count=len(snapshot.work_orders),
        operation_count=operation_count,
        issues=[issue.as_dict() for issue in report.issues],
    )


def _schema_to_calendar(schema: CanonicalCalendarSchema) -> CanonicalCalendar:
    return CanonicalCalendar(
        id=schema.id,
        name=schema.name,
        shifts=tuple(
            CanonicalShift(
                weekday=shift.weekday,
                start=time.fromisoformat(shift.start),
                end=time.fromisoformat(shift.end),
            )
            for shift in schema.shifts
        ),
        external_ref=schema.external_ref,
        site_id=schema.site_id,
    )


def _calendar_to_schema(calendar: CanonicalCalendar) -> CanonicalCalendarSchema:
    return CanonicalCalendarSchema(
        id=calendar.id,
        name=calendar.name,
        shifts=[
            CanonicalShiftSchema(
                weekday=shift.weekday,
                start=shift.start.isoformat(timespec="minutes"),
                end=shift.end.isoformat(timespec="minutes"),
            )
            for shift in calendar.shifts
        ],
        external_ref=calendar.external_ref,
        site_id=calendar.site_id,
    )


def _schema_to_machine(schema: CanonicalMachineSchema) -> CanonicalMachine:
    setup_matrix = None
    if schema.setup_matrix is not None:
        setup_matrix = CanonicalSetupMatrix(
            default_minutes=schema.setup_matrix.default_minutes,
            initial_minutes=schema.setup_matrix.initial_minutes,
            transitions={
                (tr.from_family, tr.to_family): tr.minutes
                for tr in schema.setup_matrix.transitions
            },
        )
    return CanonicalMachine(
        id=schema.id,
        name=schema.name,
        calendar_id=schema.calendar_id,
        capabilities=tuple(schema.capabilities),
        efficiency=schema.efficiency,
        setup_matrix=setup_matrix,
        maintenance_windows=tuple(
            CanonicalTimeWindow(start=w.start, end=w.end)
            for w in schema.maintenance_windows
        ),
        external_ref=schema.external_ref,
        site_id=schema.site_id,
    )


def _machine_to_schema(machine: CanonicalMachine) -> CanonicalMachineSchema:
    setup_matrix = None
    if machine.setup_matrix is not None:
        setup_matrix = CanonicalSetupMatrixSchema(
            default_minutes=machine.setup_matrix.default_minutes,
            initial_minutes=machine.setup_matrix.initial_minutes,
            transitions=[
                CanonicalSetupTransitionSchema(
                    **{"from": src, "to": dst, "minutes": minutes}
                )
                for (src, dst), minutes in machine.setup_matrix.transitions.items()
            ],
        )
    return CanonicalMachineSchema(
        id=machine.id,
        name=machine.name,
        calendar_id=machine.calendar_id,
        capabilities=list(machine.capabilities),
        efficiency=machine.efficiency,
        setup_matrix=setup_matrix,
        maintenance_windows=[
            CanonicalTimeWindowSchema(start=w.start, end=w.end)
            for w in machine.maintenance_windows
        ],
        external_ref=machine.external_ref,
        site_id=machine.site_id,
    )


def _schema_to_resource(schema: CanonicalResourceSchema) -> CanonicalResource:
    return CanonicalResource(
        id=schema.id,
        name=schema.name,
        capacity=schema.capacity,
        calendar_id=schema.calendar_id,
        tags=tuple(schema.tags),
        external_ref=schema.external_ref,
        site_id=schema.site_id,
    )


def _resource_to_schema(resource: CanonicalResource) -> CanonicalResourceSchema:
    return CanonicalResourceSchema(
        id=resource.id,
        name=resource.name,
        capacity=resource.capacity,
        calendar_id=resource.calendar_id,
        tags=list(resource.tags),
        external_ref=resource.external_ref,
        site_id=resource.site_id,
    )


def _schema_to_work_order(schema: CanonicalWorkOrderSchema) -> CanonicalWorkOrder:
    return CanonicalWorkOrder(
        id=schema.id,
        name=schema.name,
        product_id=schema.product_id,
        quantity=schema.quantity,
        due_date=schema.due_date,
        release_date=schema.release_date,
        operations=tuple(_schema_to_operation(op) for op in schema.operations),
        priority=schema.priority,
        status=schema.status,
        firmness=schema.firmness,
        lot_sizing=CanonicalLotSizing(
            mode=schema.lot_sizing.mode,
            lot_size=schema.lot_sizing.lot_size,
            min_lot_size=schema.lot_sizing.min_lot_size,
            max_lot_size=schema.lot_sizing.max_lot_size,
        ),
        external_ref=schema.external_ref,
        site_id=schema.site_id,
        item_id=schema.item_id,
        quantity_uom=schema.quantity_uom,
        requested_date=schema.requested_date,
        promised_date=schema.promised_date,
        erp_status=schema.erp_status,
        order_type=schema.order_type,
    )


def _work_order_to_schema(work_order: CanonicalWorkOrder) -> CanonicalWorkOrderSchema:
    return CanonicalWorkOrderSchema(
        id=work_order.id,
        name=work_order.name,
        product_id=work_order.product_id,
        quantity=work_order.quantity,
        due_date=work_order.due_date,
        release_date=work_order.release_date,
        operations=[_operation_to_schema(op) for op in work_order.operations],
        priority=work_order.priority,
        status=work_order.status,
        firmness=work_order.firmness,
        lot_sizing=CanonicalLotSizingSchema(
            mode=work_order.lot_sizing.mode,
            lot_size=work_order.lot_sizing.lot_size,
            min_lot_size=work_order.lot_sizing.min_lot_size,
            max_lot_size=work_order.lot_sizing.max_lot_size,
        ),
        external_ref=work_order.external_ref,
        site_id=work_order.site_id,
        item_id=work_order.item_id,
        quantity_uom=work_order.quantity_uom,
        requested_date=work_order.requested_date,
        promised_date=work_order.promised_date,
        erp_status=work_order.erp_status,
        order_type=work_order.order_type,
    )


def _schema_to_operation(schema: CanonicalOperationSchema) -> CanonicalOperation:
    return CanonicalOperation(
        id=schema.id,
        work_order_id=schema.work_order_id,
        sequence=schema.sequence,
        name=schema.name,
        duration_minutes=schema.duration_minutes,
        eligible_machine_ids=tuple(schema.eligible_machine_ids),
        setup_minutes=schema.setup_minutes,
        dependencies=tuple(schema.dependencies),
        dependency_links=tuple(
            CanonicalDependencyLink(
                depends_on_id=link.depends_on_id,
                dependency_type=link.dependency_type,
                lag_minutes=link.lag_minutes,
                max_wait_minutes=link.max_wait_minutes,
            )
            for link in schema.dependency_links
        ),
        status=schema.status,
        setup_family=schema.setup_family,
        resource_requirements=tuple(
            CanonicalResourceRequirement(resource_id=req.resource_id, units=req.units)
            for req in schema.resource_requirements
        ),
        material_requirements=tuple(
            CanonicalMaterialRequirement(
                material_id=req.material_id,
                quantity_per_unit=req.quantity_per_unit,
                fixed_quantity=req.fixed_quantity,
            )
            for req in schema.material_requirements
        ),
        routings=tuple(_schema_to_routing(r) for r in schema.routings),
        preemptible=schema.preemptible,
        min_chunk_minutes=schema.min_chunk_minutes,
        actual_start=schema.actual_start,
        actual_machine_id=schema.actual_machine_id,
        actual_end=schema.actual_end,
        remaining_duration_minutes=schema.remaining_duration_minutes,
        firm_until=schema.firm_until,
        frozen_until=schema.frozen_until,
        external_ref=schema.external_ref,
    )


def _operation_to_schema(operation: CanonicalOperation) -> CanonicalOperationSchema:
    return CanonicalOperationSchema(
        id=operation.id,
        work_order_id=operation.work_order_id,
        sequence=operation.sequence,
        name=operation.name,
        duration_minutes=operation.duration_minutes,
        eligible_machine_ids=list(operation.eligible_machine_ids),
        setup_minutes=operation.setup_minutes,
        dependencies=list(operation.dependencies),
        dependency_links=[
            CanonicalDependencyLinkSchema(
                depends_on_id=link.depends_on_id,
                dependency_type=link.dependency_type,
                lag_minutes=link.lag_minutes,
                max_wait_minutes=link.max_wait_minutes,
            )
            for link in operation.dependency_links
        ],
        status=operation.status,
        setup_family=operation.setup_family,
        resource_requirements=[
            CanonicalResourceRequirementSchema(
                resource_id=req.resource_id,
                units=req.units,
            )
            for req in operation.resource_requirements
        ],
        material_requirements=[
            CanonicalMaterialRequirementSchema(
                material_id=req.material_id,
                quantity_per_unit=req.quantity_per_unit,
                fixed_quantity=req.fixed_quantity,
            )
            for req in operation.material_requirements
        ],
        routings=[_routing_to_schema(r) for r in operation.routings],
        preemptible=operation.preemptible,
        min_chunk_minutes=operation.min_chunk_minutes,
        actual_start=operation.actual_start,
        actual_machine_id=operation.actual_machine_id,
        actual_end=operation.actual_end,
        remaining_duration_minutes=operation.remaining_duration_minutes,
        firm_until=operation.firm_until,
        frozen_until=operation.frozen_until,
        external_ref=operation.external_ref,
    )


def _schema_to_routing(schema: CanonicalRoutingAlternativeSchema) -> CanonicalRoutingAlternative:
    return CanonicalRoutingAlternative(
        machine_id=schema.machine_id,
        duration_minutes=schema.duration_minutes,
        setup_minutes=schema.setup_minutes,
        resource_requirements=tuple(
            CanonicalResourceRequirement(resource_id=req.resource_id, units=req.units)
            for req in schema.resource_requirements
        ),
    )


def _routing_to_schema(routing: CanonicalRoutingAlternative) -> CanonicalRoutingAlternativeSchema:
    return CanonicalRoutingAlternativeSchema(
        machine_id=routing.machine_id,
        duration_minutes=routing.duration_minutes,
        setup_minutes=routing.setup_minutes,
        resource_requirements=[
            CanonicalResourceRequirementSchema(
                resource_id=req.resource_id,
                units=req.units,
            )
            for req in routing.resource_requirements
        ],
    )


@router.get(
    "/credentials",
    response_model=list[IntegrationCredentialOut],
)
def list_integration_credentials(
    workspace_id: str | None = None,
    limit: int = 50,
    tenant: TenantContext = Depends(get_tenant_context),
    use_case: ManageIntegrationCredentials = Depends(get_manage_integration_credentials),
) -> list[IntegrationCredentialOut]:
    ensure_authenticated_permission(tenant, "manage_integrations")
    workspace_id = resolve_scoped_workspace_id(tenant, workspace_id)
    credentials = use_case.list_for_scope(
        organization_id=tenant.organization_id,
        workspace_id=workspace_id,
        limit=limit,
    )
    return [_credential_to_schema(credential) for credential in credentials]


@router.post(
    "/credentials",
    response_model=IntegrationCredentialOut,
)
def create_integration_credential(
    payload: IntegrationCredentialIn,
    tenant: TenantContext = Depends(get_tenant_context),
    use_case: ManageIntegrationCredentials = Depends(get_manage_integration_credentials),
) -> IntegrationCredentialOut:
    ensure_authenticated_permission(tenant, "manage_integrations")
    workspace_id = resolve_scoped_workspace_id(tenant, payload.workspace_id)
    try:
        credential = use_case.create(
            CreateIntegrationCredentialInput(
                name=payload.name,
                source_system=payload.source_system,
                organization_id=tenant.organization_id,
                workspace_id=workspace_id,
                auth_type=payload.auth_type,
                auth_header_name=payload.auth_header_name,
                username=payload.username,
                secret_ref=payload.secret_ref,
                secret_value=payload.secret_value,
                is_enabled=payload.is_enabled,
                created_by_user_id=tenant.user_id,
            )
        )
    except ValidationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return _credential_to_schema(credential)


@router.get(
    "/connectors",
    response_model=list[IntegrationConnectorOut],
)
def list_integration_connectors(
    workspace_id: str | None = None,
    limit: int = 50,
    tenant: TenantContext = Depends(get_tenant_context),
    use_case: ManageIntegrationConnectors = Depends(get_manage_integration_connectors),
) -> list[IntegrationConnectorOut]:
    ensure_authenticated_permission(tenant, "manage_integrations")
    workspace_id = resolve_scoped_workspace_id(tenant, workspace_id)
    connectors = use_case.list_for_scope(
        organization_id=tenant.organization_id,
        workspace_id=workspace_id,
        limit=limit,
    )
    return [_connector_to_schema(connector) for connector in connectors]


@router.post(
    "/connectors",
    response_model=IntegrationConnectorOut,
)
def create_integration_connector(
    payload: IntegrationConnectorIn,
    tenant: TenantContext = Depends(get_tenant_context),
    use_case: ManageIntegrationConnectors = Depends(get_manage_integration_connectors),
) -> IntegrationConnectorOut:
    ensure_authenticated_permission(tenant, "manage_integrations")
    workspace_id = resolve_scoped_workspace_id(tenant, payload.workspace_id)
    try:
        connector = use_case.create(
            CreateIntegrationConnectorInput(
                name=payload.name,
                endpoint_url=payload.endpoint_url,
                source_system=payload.source_system,
                organization_id=tenant.organization_id,
                workspace_id=workspace_id,
                connector_type=payload.connector_type,
                method=payload.method,
                auth_type=payload.auth_type,
                auth_header_name=payload.auth_header_name,
                username=payload.username,
                secret_ref=payload.secret_ref,
                secret_value=payload.secret_value,
                credential_id=payload.credential_id,
                static_headers=payload.static_headers,
                timeout_seconds=payload.timeout_seconds,
                is_enabled=payload.is_enabled,
                created_by_user_id=tenant.user_id,
            )
        )
    except ValidationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return _connector_to_schema(connector)


@router.patch(
    "/connectors/{connector_id}",
    response_model=IntegrationConnectorOut,
)
def update_integration_connector(
    connector_id: str,
    payload: IntegrationConnectorPatch,
    tenant: TenantContext = Depends(get_tenant_context),
    use_case: ManageIntegrationConnectors = Depends(get_manage_integration_connectors),
) -> IntegrationConnectorOut:
    ensure_authenticated_permission(tenant, "manage_integrations")
    fields = payload.model_dump(exclude_unset=True)
    try:
        connector = use_case.update(
            UpdateIntegrationConnectorInput(
                connector_id=connector_id,
                organization_id=tenant.organization_id,
                **fields,
            )
        )
    except ValidationError as exc:
        message = str(exc)
        status_code = 404 if "not found" in message.lower() else 422
        raise HTTPException(status_code=status_code, detail=message) from exc
    return _connector_to_schema(connector)


@router.delete(
    "/connectors/{connector_id}",
    status_code=204,
)
def delete_integration_connector(
    connector_id: str,
    tenant: TenantContext = Depends(get_tenant_context),
    use_case: ManageIntegrationConnectors = Depends(get_manage_integration_connectors),
) -> Response:
    ensure_authenticated_permission(tenant, "manage_integrations")
    try:
        use_case.delete(
            connector_id,
            organization_id=tenant.organization_id,
        )
    except ValidationError as exc:
        message = str(exc)
        status_code = 404 if "not found" in message.lower() else 422
        raise HTTPException(status_code=status_code, detail=message) from exc
    return Response(status_code=204)


@router.post(
    "/connectors/{connector_id}/test",
    response_model=IntegrationConnectorTestResponse,
)
def test_integration_connector(
    connector_id: str,
    tenant: TenantContext = Depends(get_tenant_context),
    use_case: ManageIntegrationConnectors = Depends(get_manage_integration_connectors),
) -> IntegrationConnectorTestResponse:
    ensure_authenticated_permission(tenant, "manage_integrations")
    workspace_id = resolve_scoped_workspace_id(tenant, None)
    try:
        result = use_case.test(
            TestIntegrationConnectorInput(
                connector_id=connector_id,
                organization_id=tenant.organization_id,
                workspace_id=workspace_id,
                actor_details=_authenticated_actor_details(tenant),
            )
        )
    except ValidationError as exc:
        message = str(exc)
        status_code = 404 if "not found" in message.lower() else 422
        raise HTTPException(status_code=status_code, detail=message) from exc
    return IntegrationConnectorTestResponse(
        connector=_connector_to_schema(result.connector),
        status_code=result.status_code,
        ok=result.ok,
        message=result.message,
        response_preview=result.response_preview,
    )


@router.get(
    "/connectors/{connector_id}/database-schema",
    response_model=IntegrationConnectorDatabaseSchemaOut,
)
def inspect_integration_connector_database_schema(
    connector_id: str,
    tenant: TenantContext = Depends(get_tenant_context),
    use_case: ManageIntegrationConnectors = Depends(get_manage_integration_connectors),
) -> IntegrationConnectorDatabaseSchemaOut:
    ensure_authenticated_permission(tenant, "manage_integrations")
    workspace_id = resolve_scoped_workspace_id(tenant, None)
    try:
        result = use_case.inspect_database_schema(
            InspectIntegrationConnectorSchemaInput(
                connector_id=connector_id,
                organization_id=tenant.organization_id,
                workspace_id=workspace_id,
            )
        )
    except ValidationError as exc:
        message = str(exc)
        status_code = 404 if "not found" in message.lower() else 422
        raise HTTPException(status_code=status_code, detail=message) from exc
    return _database_schema_to_schema(result)


@router.get(
    "/flow-blocks",
    response_model=list[IntegrationFlowBlockCatalogItemOut],
)
def list_integration_flow_blocks() -> list[IntegrationFlowBlockCatalogItemOut]:
    return [
        IntegrationFlowBlockCatalogItemOut(**dict(item))
        for item in FLOW_BLOCK_CATALOG
    ]


@router.get("/flow-templates", response_model=list[FlowTemplateOut])
def list_flow_templates() -> list[FlowTemplateOut]:
    """Studio v2 phase 8 — starter templates the v2 toolbar can apply."""
    from ...application.integration.flow_templates import FLOW_TEMPLATES

    return [
        FlowTemplateOut(
            key=str(tpl["key"]),
            title=str(tpl["title"]),
            description=str(tpl["description"]),
            outcome=str(tpl["outcome"]),
            source_system=str(tpl["source_system"]),
            blocks=[
                FlowTemplateBlockOut(
                    id=str(b["id"]),
                    block_type=str(b["block_type"]),
                    name=str(b["name"]),
                    input_block_id=(
                        str(b["input_block_id"]) if b["input_block_id"] else None
                    ),
                    config=dict(b["config"]),
                )
                for b in tpl["blocks"]
            ],
        )
        for tpl in FLOW_TEMPLATES
    ]


@router.get(
    "/flows",
    response_model=list[IntegrationFlowOut],
)
def list_integration_flows(
    workspace_id: str | None = None,
    limit: int = 50,
    tenant: TenantContext = Depends(get_tenant_context),
    use_case: ManageIntegrationFlows = Depends(get_manage_integration_flows),
) -> list[IntegrationFlowOut]:
    ensure_authenticated_permission(tenant, "manage_integrations")
    workspace_id = resolve_scoped_workspace_id(tenant, workspace_id)
    return [
        _flow_to_schema(flow)
        for flow in use_case.list_for_scope(
            organization_id=tenant.organization_id,
            workspace_id=workspace_id,
            limit=limit,
        )
    ]


@router.post(
    "/flows/readiness",
    response_model=IntegrationFlowReadinessOut,
)
def evaluate_integration_flow_readiness(
    payload: IntegrationFlowIn,
    tenant: TenantContext = Depends(get_tenant_context),
    use_case: ManageIntegrationFlows = Depends(get_manage_integration_flows),
) -> IntegrationFlowReadinessOut:
    ensure_authenticated_permission(tenant, "manage_integrations")
    workspace_id = resolve_scoped_workspace_id(tenant, payload.workspace_id)
    readiness = use_case.evaluate_readiness(
        EvaluateIntegrationFlowReadinessInput(
            name=payload.name,
            source_system=payload.source_system,
            organization_id=tenant.organization_id,
            workspace_id=workspace_id,
            is_enabled=payload.is_enabled,
            blocks=_flow_blocks_from_schema(payload),
        )
    )
    return _flow_readiness_to_schema(readiness)


@router.get(
    "/flows/{flow_id}",
    response_model=IntegrationFlowOut,
)
def get_integration_flow(
    flow_id: str,
    tenant: TenantContext = Depends(get_tenant_context),
    use_case: ManageIntegrationFlows = Depends(get_manage_integration_flows),
) -> IntegrationFlowOut:
    ensure_authenticated_permission(tenant, "manage_integrations")
    flow = use_case.get(flow_id, organization_id=tenant.organization_id)
    if flow is None:
        raise HTTPException(
            status_code=404,
            detail={
                "error": "flow_not_found",
                "message": f"Integration flow {flow_id!r} was not found.",
            },
        )
    if (
        tenant.workspace_id is not None
        and flow.workspace_id is not None
        and flow.workspace_id != tenant.workspace_id
    ):
        raise HTTPException(
            status_code=403,
            detail={
                "error": "cross_workspace_forbidden",
                "message": "Integration flow workspace does not match the active workspace.",
            },
        )
    return _flow_to_schema(flow)


@router.post(
    "/flows",
    response_model=IntegrationFlowOut,
)
def create_integration_flow(
    payload: IntegrationFlowIn,
    tenant: TenantContext = Depends(get_tenant_context),
    use_case: ManageIntegrationFlows = Depends(get_manage_integration_flows),
    workspaces: WorkspaceRepository = Depends(get_tenant_workspace_repository),
    audit_repository=Depends(get_audit_event_repository),
) -> IntegrationFlowOut:
    ensure_authenticated_permission(tenant, "manage_integrations")
    workspace_id = resolve_scoped_workspace_id(tenant, payload.workspace_id)
    if workspace_id is None and tenant.organization_id:
        # Phase 11 fix: external API callers (curl, integrations) often
        # skip X-Workspace-Id, leaving the flow with workspace_id=null.
        # That breaks /integration/executions?workspace_id=default later
        # because the row inherits the same null. Fall back to the org's
        # default workspace so flows always carry a real workspace_id.
        for ws in workspaces.list_for_organization(tenant.organization_id):
            if ws.is_default and ws.is_active:
                workspace_id = ws.id
                break
    try:
        flow = use_case.create(
            CreateIntegrationFlowInput(
                name=payload.name,
                source_system=payload.source_system,
                organization_id=tenant.organization_id,
                workspace_id=workspace_id,
                is_enabled=payload.is_enabled,
                blocks=_flow_blocks_from_schema(payload),
                created_by_user_id=tenant.user_id,
            )
        )
    except ValidationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    record_audit_event(
        audit_repository,
        action="integration_flow.create",
        status="ok",
        organization_id=tenant.organization_id,
        workspace_id=tenant.workspace_id,
        user_id=tenant.user_id,
        subject=flow.id,
        details={
            "flow_id": flow.id,
            "name": flow.name,
            "source_system": flow.source_system,
            "block_count": len(flow.blocks),
        },
    )
    return _flow_to_schema(flow)


@router.put(
    "/flows/{flow_id}",
    response_model=IntegrationFlowOut,
)
def update_integration_flow(
    flow_id: str,
    payload: IntegrationFlowIn,
    tenant: TenantContext = Depends(get_tenant_context),
    use_case: ManageIntegrationFlows = Depends(get_manage_integration_flows),
    audit_repository=Depends(get_audit_event_repository),
) -> IntegrationFlowOut:
    ensure_authenticated_permission(tenant, "manage_integrations")
    workspace_id = resolve_scoped_workspace_id(tenant, payload.workspace_id)
    try:
        flow = use_case.update(
            UpdateIntegrationFlowInput(
                flow_id=flow_id,
                name=payload.name,
                source_system=payload.source_system,
                organization_id=tenant.organization_id,
                workspace_id=workspace_id,
                is_enabled=payload.is_enabled,
                blocks=_flow_blocks_from_schema(payload),
            )
        )
    except ValidationError as exc:
        message = str(exc)
        status_code = 404 if "not found" in message.lower() else 422
        raise HTTPException(status_code=status_code, detail=message) from exc
    record_audit_event(
        audit_repository,
        action="integration_flow.update",
        status="ok",
        organization_id=tenant.organization_id,
        workspace_id=tenant.workspace_id,
        user_id=tenant.user_id,
        subject=flow.id,
        details={
            "flow_id": flow.id,
            "name": flow.name,
            "source_system": flow.source_system,
            "block_count": len(flow.blocks),
        },
    )
    return _flow_to_schema(flow)


@router.post(
    "/flows/{flow_id}/run",
    response_model=IntegrationFlowRunOut,
)
def run_integration_flow_route(
    flow_id: str,
    payload: IntegrationFlowRunRequest | None = None,
    principal: IntegrationPrincipal = Depends(require_integration_run_access),
    tenant: TenantContext = Depends(get_tenant_context),
    use_case: RunIntegrationFlow = Depends(get_run_integration_flow),
    flows_use_case: ManageIntegrationFlows = Depends(get_manage_integration_flows),
    audit_repository=Depends(get_audit_event_repository),
) -> IntegrationFlowRunOut:
    context = _effective_integration_context(tenant, principal)
    _ensure_integration_route_permission(tenant, principal, "manage_integrations")

    # V1.2 P1.1 — pre-flight readiness check, scoped to RUNTIME-FATAL
    # issues only. Without this, a flow with a missing connector or a
    # stale credential goes all the way into the engine before failing
    # half-way through, leaving partial side-effects AND a 500 that
    # doesn't say which block was the problem.
    #
    # We deliberately do NOT gate on every readiness blocker. Codes
    # like "database_columns_unknown" or "flow_name_missing" are UX
    # hygiene — the runtime either surfaces them as preview data
    # (database block) or doesn't actually need them (a flow can run
    # without a name). Gating on those would refuse legitimate
    # preview / sandbox runs the planner expects to work.
    #
    # The allowlist captures issues where the engine cannot recover:
    # the connector reference is missing or wrong, or the flow itself
    # is structurally malformed.
    flow_for_check = flows_use_case.get(flow_id, organization_id=context.organization_id)
    if flow_for_check is not None:
        readiness = flows_use_case.evaluate_readiness(
            EvaluateIntegrationFlowReadinessInput(
                name=flow_for_check.name,
                source_system=flow_for_check.source_system,
                organization_id=context.organization_id,
                workspace_id=flow_for_check.workspace_id,
                is_enabled=flow_for_check.is_enabled,
                blocks=flow_for_check.blocks,
            )
        )
        runtime_fatal_codes = {
            "connector_registry_unavailable",
            "connector_missing",
            "connector_invalid",
            "connector_disabled",
            "connector_workspace_mismatch",
            "connector_type_mismatch",
            "credential_registry_unavailable",
            "credential_missing",
            "credential_invalid",
            "credential_disabled",
            "credential_workspace_mismatch",
            "block_id_missing",
            "block_id_duplicate",
            "block_type_unsupported",
            # Required config missing for a block — e.g. call_connector_api
            # without a connector_id. The engine cannot dispatch the block,
            # so refusing pre-flight saves a doomed run + partial side-effects.
            "block_config_invalid",
        }
        runtime_blockers = [
            issue for issue in readiness.blockers if issue.code in runtime_fatal_codes
        ]
        if runtime_blockers:
            raise HTTPException(
                status_code=422,
                detail={
                    "error": "flow_not_ready",
                    "message": (
                        "Flow has runtime-fatal issues — fix them before running. "
                        f"{len(runtime_blockers)} blocker(s) detected."
                    ),
                    "blockers": [
                        {
                            "code": issue.code,
                            "message": issue.message,
                            "block_id": issue.block_id,
                            "suggested_action": issue.suggested_action,
                        }
                        for issue in runtime_blockers
                    ],
                },
            )
    # NOTE: when flow_for_check is None, we let use_case.execute() raise
    # the canonical flow_not_found error below (consistent 404 path).

    try:
        result = use_case.execute(
            RunIntegrationFlowInput(
                flow_id=flow_id,
                organization_id=context.organization_id,
                workspace_id=context.workspace_id,
                start_block_id=payload.start_block_id if payload is not None else None,
                stop_after_block_id=payload.stop_after_block_id if payload is not None else None,
                actor_details=_actor_details(principal, tenant),
                journal_action=(
                    "flow_preview"
                    if payload is not None
                    and (
                        payload.start_block_id is not None
                        or payload.stop_after_block_id is not None
                    )
                    else "flow_run"
                ),
            )
        )
    except RunIntegrationFlowRejected as exc:
        status_code = {
            "flow_not_found": 404,
            "flow_disabled": 409,
            "cross_workspace_forbidden": 403,
        }.get(exc.code, 422)
        raise HTTPException(
            status_code=status_code,
            detail={"error": exc.code, "message": exc.message},
        ) from exc
    record_audit_event(
        audit_repository,
        action="integration_flow.run",
        status=result.status,
        organization_id=context.organization_id,
        workspace_id=context.workspace_id,
        user_id=tenant.user_id or principal.client_id,
        subject=flow_id,
        details={
            "flow_id": flow_id,
            "flow_name": result.flow.name,
            "run_id": result.execution_scope.get("run_id"),
            "block_count": len(result.block_results),
            "auth_mode": principal.auth_mode,
        },
    )
    return IntegrationFlowRunOut(
        flow=_flow_to_schema(result.flow),
        status=result.status,
        message=result.message,
        blocks=[
            IntegrationFlowRunBlockOut(
                block_id=item.block_id,
                block_type=item.block_type,
                status=item.status,
                message=item.message,
                input_preview=item.input_preview,
                output_preview=item.output_preview,
                output_summary=item.output_summary,
            )
            for item in result.block_results
        ],
        result=result.result,
        execution_scope=IntegrationFlowRunScopeOut(**result.execution_scope),
        journal_entry=(
            _journal_entry_to_schema(result.journal_entry)
            if result.journal_entry is not None
            else None
        ),
    )


@router.post("/webhooks/{token}")
async def receive_integration_webhook(
    token: str,
    request: Request,
    flows: SqlIntegrationFlowRepository = Depends(get_integration_flow_repository),
    use_case: RunIntegrationFlow = Depends(get_run_integration_flow),
    dedup=Depends(get_webhook_event_dedup_repository),
    audit_repository=Depends(get_audit_event_repository),
) -> dict[str, object]:
    """V1.2 P3 — public webhook ingress.

    Resolves the opaque ``token`` (derived from the trigger_webhook
    block's flow_id/block_id) back to the owning flow, verifies the
    HMAC-SHA256 signature of the raw request body against the block's
    configured ``secret``, and dispatches the flow on success.

    Security model:
    - Token is NOT a secret. Its only purpose is to avoid leaking
      flow_ids in URLs. The HMAC signature IS the authentication.
    - Unknown token → 404 (same shape as a brute-force probe, never
      confirms which tokens are live).
    - No configured secret on the block → 403. The endpoint is
      explicitly disabled for that block. Fail-closed: never run an
      unauthenticated trigger that could write to the plant.
    - Missing / malformed / wrong signature → 401.
    - Signature OK → flow runs under the flow's persisted
      organization_id / workspace_id. The caller has no tenant
      identity; the trigger block IS the scoped resource.

    The signature header format is ``X-Webhook-Signature:
    sha256=<hexdigest>`` (GitHub-compatible). The digest is computed
    over the raw POST body bytes; trailing whitespace and JSON
    re-serialisation matter, so callers MUST sign exactly what they
    transmit.
    """

    # V1.2 P3 — per-token rate limit. Fires BEFORE token lookup so a
    # brute-force scanner that hammers random tokens burns its quota
    # without consuming SQL round-trips. Settings.webhook_rate_limit_per_minute
    # ≤ 0 disables enforcement (private deployments / local dev).
    enforce_rate_limit(
        client_id=token,
        limit_per_minute=get_settings().webhook_rate_limit_per_minute,
        scope="webhook",
    )

    raw_body = await request.body()

    match = flows.find_by_webhook_token(token)
    if match is None:
        # Same 404 shape as scheduling-runs cross-tenant lookups.
        raise HTTPException(
            status_code=404,
            detail={
                "error": "webhook_not_found",
                "message": "No active webhook trigger matches this token.",
            },
        )
    flow, block = match

    secret = str(block.config.get("secret") or "").strip()
    if not secret:
        # Fail-closed: a trigger_webhook block without a configured
        # secret is treated as DISABLED at the public endpoint. The
        # planner sees this in the Studio readiness panel (P1.1) so
        # there's no surprise — just no inadvertently-public trigger.
        raise HTTPException(
            status_code=403,
            detail={
                "error": "webhook_secret_required",
                "message": (
                    "This webhook trigger has no shared secret "
                    "configured. Set one in the Studio inspector "
                    "before exposing the endpoint."
                ),
            },
        )

    signature_header = request.headers.get("x-webhook-signature") or ""
    if not signature_header.startswith("sha256="):
        raise HTTPException(
            status_code=401,
            detail={
                "error": "webhook_signature_missing",
                "message": (
                    "Missing X-Webhook-Signature header "
                    "(expected 'sha256=<hex>')."
                ),
            },
        )
    provided_hex = signature_header[len("sha256=") :].strip()
    expected_hex = hmac_module.new(
        secret.encode("utf-8"), raw_body, hashlib.sha256
    ).hexdigest()
    if not hmac_module.compare_digest(provided_hex.lower(), expected_hex):
        raise HTTPException(
            status_code=401,
            detail={
                "error": "webhook_signature_invalid",
                "message": "X-Webhook-Signature does not match the request body.",
            },
        )

    # V1.2 P3 idempotency dedup (slice 3). Vendors retry on timeout
    # / network blip; without dedup the flow runs twice and any
    # write-side block (push_schedule, etc.) double-fires. The
    # X-Webhook-Idempotency-Key header is optional — callers that
    # don't send one keep the slice-1 behaviour (every POST
    # executes). Callers that DO send one and replay with the same
    # key + body get the original run_id back. Same key + different
    # body = 409 (key reuse with mismatched payload is almost
    # certainly a caller-side bug).
    body_hash = hashlib.sha256(raw_body).hexdigest()
    idempotency_key = (request.headers.get("x-webhook-idempotency-key") or "").strip()
    if idempotency_key:
        existing = dedup.find(token=token, idempotency_key=idempotency_key)
        if existing is not None:
            if existing.body_hash != body_hash:
                raise HTTPException(
                    status_code=409,
                    detail={
                        "error": "webhook_idempotency_conflict",
                        "message": (
                            "X-Webhook-Idempotency-Key has been used "
                            "before with a different body. Use a fresh "
                            "key or replay the original payload."
                        ),
                    },
                )
            # Same key + same body — return the cached response.
            # No flow execution, no double-side-effect.
            return {
                "flow_id": flow.id,
                "run_id": existing.run_id,
                "status": existing.status,
                "message": "Idempotent replay (original run reused).",
                "idempotent_replay": True,
            }

    # Parse the body as JSON for downstream blocks. A sender that
    # POSTs non-JSON (HTML form, binary, empty body) is still accepted
    # — the signature already authenticated them and the trigger
    # block falls back to its no-payload placeholder. Senders that
    # care about routing on the body MUST POST application/json.
    trigger_payload: dict[str, object] | None = None
    payload_kind = "none"
    if raw_body:
        try:
            decoded = json_module.loads(raw_body.decode("utf-8"))
        except (UnicodeDecodeError, json_module.JSONDecodeError):
            payload_kind = "non_json"
        else:
            if isinstance(decoded, dict):
                trigger_payload = decoded
                payload_kind = "json_object"
            else:
                # Arrays / scalars are valid JSON but the
                # trigger_webhook output contract expects an object
                # (downstream blocks dereference $.payload.field).
                # Wrap so callers always see {"payload": {...}} with
                # the raw value under a known key.
                trigger_payload = {"value": decoded}
                payload_kind = "json_wrapped"

    actor_details: dict[str, object] = {
        "source": "webhook",
        "token": token,
        "block_id": block.id,
        "ip_address": request.client.host if request.client else None,
        "body_bytes": len(raw_body),
        "payload_kind": payload_kind,
    }

    try:
        result = use_case.execute(
            RunIntegrationFlowInput(
                flow_id=flow.id,
                organization_id=flow.organization_id,
                workspace_id=flow.workspace_id,
                actor_details=actor_details,
                journal_action="webhook_run",
                trigger_payload=trigger_payload,
            )
        )
    except RunIntegrationFlowRejected as exc:
        status_code = {
            "flow_not_found": 404,
            "flow_disabled": 409,
            "cross_workspace_forbidden": 403,
        }.get(exc.code, 422)
        raise HTTPException(
            status_code=status_code,
            detail={"error": exc.code, "message": exc.message},
        ) from exc

    # Record the dedup row on a SUCCESSFUL dispatch so a retry
    # within the TTL returns this run_id verbatim. We persist BEFORE
    # the audit event so the dedup gate fires even if audit-write
    # crashes — losing an audit row is a smaller incident than
    # double-executing the flow on a vendor retry.
    if idempotency_key:
        try:
            dedup.record(
                token=token,
                idempotency_key=idempotency_key,
                body_hash=body_hash,
                run_id=result.execution_scope.get("run_id"),
                status=result.status,
                recorded_at=datetime.utcnow(),
            )
            # Opportunistic janitor — keeps the table bounded
            # without a separate cron. Same pattern as /auth/logout's
            # purge_expired and /accounts/users/.../revoke-sessions.
            dedup.purge_expired(now=datetime.utcnow(), max_age_hours=24)
        except Exception:
            # Dedup failure must NOT block the response. Worst-case
            # is a retry within the TTL window dispatches the flow
            # again — same risk profile as no-idempotency-at-all,
            # which is the slice-1 default.
            pass

    try:
        record_audit_event(
            audit_repository,
            action="integration.webhook_received",
            status=result.status,
            organization_id=flow.organization_id,
            workspace_id=flow.workspace_id,
            user_id=None,
            ip_address=request.client.host if request.client else None,
            subject=flow.id,
            details={
                "flow_id": flow.id,
                "flow_name": result.flow.name,
                "trigger_block_id": block.id,
                "run_id": result.execution_scope.get("run_id"),
                "body_bytes": len(raw_body),
                "idempotency_key": idempotency_key or None,
            },
        )
    except Exception:
        # Audit failure must never block the webhook response. The
        # run itself is already committed; losing the audit row is a
        # smaller incident than 500-ing a vendor's retry queue.
        pass

    return {
        "flow_id": flow.id,
        "run_id": result.execution_scope.get("run_id"),
        "status": result.status,
        "message": result.message,
        "idempotent_replay": False,
    }


@router.post(
    "/flows/{flow_id}/test-block/{block_id}",
    response_model=FlowTestBlockResponse,
)
def test_integration_flow_block(
    flow_id: str,
    block_id: str,
    payload: FlowTestBlockRequest | None = None,
    tenant: TenantContext = Depends(get_tenant_context),
    use_case: RunIntegrationFlow = Depends(get_run_integration_flow),
) -> FlowTestBlockResponse:
    """Studio v2 phase 4 — test a single block in isolation.

    Reuses the existing `_execute_block` runtime; never touches the
    journal, the flow_run_traces table, or `flow.last_status`. Tenant
    scope enforced inside `RunIntegrationFlow.test_block`.
    """
    ensure_authenticated_permission(tenant, "manage_integrations")
    try:
        result = use_case.test_block(
            TestFlowBlockInput(
                flow_id=flow_id,
                block_id=block_id,
                organization_id=tenant.organization_id,
                workspace_id=tenant.workspace_id,
                input_value=payload.input if payload is not None else None,
            )
        )
    except ValidationError as exc:
        message = str(exc)
        status_code = 404 if "not found" in message.lower() else 422
        raise HTTPException(status_code=status_code, detail=message) from exc
    return FlowTestBlockResponse(
        block_id=result.block_id,
        block_type=result.block_type,
        status=result.status,
        message=result.message,
        input_preview=result.input_preview,
        output_preview=result.output_preview,
        duration_ms=result.duration_ms,
    )


@router.post(
    "/flows/{flow_id}/validate-graph",
    response_model=IntegrationFlowValidateGraphOut,
)
def validate_integration_flow_graph(
    flow_id: str,
    tenant: TenantContext = Depends(get_tenant_context),
    use_case: ValidateIntegrationFlowGraph = Depends(
        get_validate_integration_flow_graph
    ),
) -> IntegrationFlowValidateGraphOut:
    """Studio v2 phase 6 — static analysis of the flow graph.

    Reports cycles, unknown sources, and dangling branch outputs without
    executing any block. Tenant-scoped: a session in org-B that knows
    org-A's flow_id sees the same 404 it would for a missing flow.
    """
    ensure_authenticated_permission(tenant, "manage_integrations")
    try:
        result = use_case.execute(
            ValidateIntegrationFlowGraphInput(
                flow_id=flow_id,
                organization_id=tenant.organization_id,
                workspace_id=tenant.workspace_id,
            )
        )
    except ValidationError as exc:
        message = str(exc)
        status_code = 404 if "not found" in message.lower() else 422
        raise HTTPException(status_code=status_code, detail=message) from exc
    return IntegrationFlowValidateGraphOut(
        flow_id=result.flow_id,
        valid=result.valid,
        issues=[
            IntegrationFlowGraphIssueOut(
                code=issue.code,
                severity=issue.severity,
                message=issue.message,
                block_ids=list(issue.block_ids),
            )
            for issue in result.issues
        ],
    )


@router.get(
    "/flows/{flow_id}/runs/{run_id}/trace",
    response_model=list[FlowRunTraceOut],
)
def get_flow_run_trace(
    flow_id: str,
    run_id: str,
    tenant: TenantContext = Depends(get_tenant_context),
    flows: ManageIntegrationFlows = Depends(get_manage_integration_flows),
    traces: FlowRunTraceRepository = Depends(get_flow_run_trace_repository),
) -> list[FlowRunTraceOut]:
    """Studio v2 phase 3 — read-only access to per-block trace rows
    captured during a previous flow run. Tenant-scoped: a session in
    org-B that knows org-A's flow_id sees the same 404 it would for
    a missing flow (see _ensure_in_tenant_scope pattern in
    /scheduling/runs)."""
    ensure_authenticated_permission(tenant, "manage_integrations")
    flow = flows.get(flow_id, organization_id=tenant.organization_id)
    if flow is None or (
        tenant.workspace_id is not None
        and flow.workspace_id is not None
        and flow.workspace_id != tenant.workspace_id
    ):
        raise HTTPException(
            status_code=404,
            detail={
                "error": "flow_not_found",
                "message": f"Integration flow {flow_id!r} was not found.",
            },
        )
    rows = traces.list_for_run(
        flow_id=flow_id,
        run_id=run_id,
        organization_id=tenant.organization_id,
        workspace_id=tenant.workspace_id,
    )
    return [
        FlowRunTraceOut(
            block_id=r.block_id,
            block_type=r.block_type,
            status=r.status,
            duration_ms=r.duration_ms,
            error_message=r.error_message,
            input_payload=r.input_payload,
            output_payload=r.output_payload,
            started_at=r.started_at,
        )
        for r in rows
    ]


@router.get(
    "/api-clients",
    response_model=list[IntegrationApiClientOut],
)
def list_integration_api_clients(
    workspace_id: str | None = None,
    limit: int = 50,
    tenant: TenantContext = Depends(get_tenant_context),
    use_case: ManageIntegrationApiClients = Depends(get_manage_integration_api_clients),
) -> list[IntegrationApiClientOut]:
    ensure_authenticated_permission(tenant, "manage_integrations")
    workspace_id = resolve_scoped_workspace_id(tenant, workspace_id)
    clients = use_case.list_for_scope(
        organization_id=tenant.organization_id,
        workspace_id=workspace_id,
        limit=limit,
    )
    return [_api_client_to_schema(client) for client in clients]


@router.post(
    "/api-clients",
    response_model=IntegrationApiClientCreateResponse,
)
def create_integration_api_client(
    payload: IntegrationApiClientIn,
    tenant: TenantContext = Depends(get_tenant_context),
    use_case: ManageIntegrationApiClients = Depends(get_manage_integration_api_clients),
) -> IntegrationApiClientCreateResponse:
    ensure_authenticated_permission(tenant, "manage_integrations")
    workspace_id = resolve_scoped_workspace_id(tenant, payload.workspace_id)
    try:
        result = use_case.create(
            CreateIntegrationApiClientInput(
                name=payload.name,
                scopes=tuple(payload.scopes),
                organization_id=tenant.organization_id,
                workspace_id=workspace_id,
                source_system=payload.source_system,
                created_by_user_id=tenant.user_id,
                expires_at=payload.expires_at,
            )
        )
    except ValidationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return IntegrationApiClientCreateResponse(
        client=_api_client_to_schema(result.client),
        api_key=result.api_key,
    )


@router.post(
    "/api-clients/{client_id}/revoke",
    response_model=IntegrationApiClientOut,
)
def revoke_integration_api_client(
    client_id: str,
    tenant: TenantContext = Depends(get_tenant_context),
    use_case: ManageIntegrationApiClients = Depends(get_manage_integration_api_clients),
) -> IntegrationApiClientOut:
    ensure_authenticated_permission(tenant, "manage_integrations")
    try:
        client = use_case.revoke(
            RevokeIntegrationApiClientInput(
                client_id=client_id,
                organization_id=tenant.organization_id,
            )
        )
    except ValidationError as exc:
        message = str(exc)
        status_code = 404 if "not found" in message.lower() else 422
        raise HTTPException(status_code=status_code, detail=message) from exc
    return _api_client_to_schema(client)


@router.post(
    "/planning-snapshot/export",
    response_model=CanonicalPlanningSnapshotSchema,
)
def export_planning_snapshot(
    payload: ExportPlanningSnapshotRequest,
    principal: IntegrationPrincipal = Depends(require_integration_read_access),
    tenant: TenantContext = Depends(get_tenant_context),
    use_case: ExportPlanningSnapshot = Depends(get_export_planning_snapshot),
    journal: IntegrationJournalRepository = Depends(get_integration_journal),
) -> CanonicalPlanningSnapshotSchema:
    context = _effective_integration_context(tenant, principal)
    transfer_times = TransferTimes()
    if payload.transfer_times is not None:
        transfer_times = TransferTimes(
            default_minutes=payload.transfer_times.default_minutes,
            pairs={
                (pair.from_machine, pair.to_machine): pair.minutes
                for pair in payload.transfer_times.pairs
            },
        )
    snapshot = use_case.execute(
        ExportPlanningSnapshotInput(
            source_system=payload.source_system,
            transfer_times=transfer_times,
            metadata=payload.metadata,
            organization_id=context.organization_id,
            workspace_id=context.workspace_id,
        )
    )
    _save_journal_entry(
        journal,
        action="export",
        source_system=snapshot.source_system,
        status="exported",
        valid=True,
        entity_counts=_snapshot_entity_counts(snapshot),
        details={"metadata": dict(snapshot.metadata)},
        principal=principal,
        organization_id=context.organization_id,
        workspace_id=context.workspace_id,
    )
    return _snapshot_to_schema(snapshot)


@router.post(
    "/published-plan/export",
    response_model=PublishedPlanExportResponse,
)
def export_published_plan(
    payload: PublishedPlanExportRequest,
    principal: IntegrationPrincipal = Depends(require_integration_read_access),
    tenant: TenantContext = Depends(get_tenant_context),
    use_case: ExportPublishedPlan = Depends(get_export_published_plan),
    journal: IntegrationJournalRepository = Depends(get_integration_journal),
) -> PublishedPlanExportResponse:
    context = _effective_integration_context(tenant, principal)
    exported = use_case.execute(
        ExportPublishedPlanInput(
            source_system=payload.source_system,
            organization_id=context.organization_id,
            workspace_id=context.workspace_id,
            schedule_id=payload.schedule_id,
            compare_to_schedule_id=payload.compare_to_schedule_id,
            mode=payload.mode,
            metadata=payload.metadata,
        )
    )
    _save_journal_entry(
        journal,
        action="published_plan_export",
        source_system=exported.source_system,
        status=f"{exported.mode}_exported",
        valid=True,
        entity_counts=exported.entity_counts,
        details={
            "schedule_id": exported.schedule_id,
            "scenario_name": exported.scenario_name,
            "lifecycle_status": exported.lifecycle_status,
            "mode": exported.mode,
            "compare_to_schedule_id": exported.compare_to_schedule_id,
            "change_counts": exported.change_counts,
            "export_hash": exported.export_hash,
            "metadata": dict(exported.metadata),
        },
        principal=principal,
        organization_id=context.organization_id,
        workspace_id=context.workspace_id,
    )
    return _published_plan_to_schema(exported)


@router.post(
    "/planning-snapshot/validate",
    response_model=CanonicalValidationResponse,
)
def validate_planning_snapshot(
    payload: CanonicalPlanningSnapshotSchema,
    principal: IntegrationPrincipal = Depends(require_integration_read_access),
    tenant: TenantContext = Depends(get_tenant_context),
    journal: IntegrationJournalRepository = Depends(get_integration_journal),
) -> CanonicalValidationResponse:
    context = _effective_integration_context(tenant, principal)
    snapshot = _schema_to_snapshot(payload)
    _enforce_snapshot_limits(snapshot)
    report = validate_snapshot_report(snapshot)
    _save_journal_entry(
        journal,
        action="validate",
        source_system=snapshot.source_system,
        status=report.readiness_status,
        valid=report.valid,
        error_count=report.error_count,
        warning_count=report.warning_count,
        entity_counts=_snapshot_entity_counts(snapshot),
        details=report.as_dict(),
        principal=principal,
        organization_id=context.organization_id,
        workspace_id=context.workspace_id,
    )
    return _validation_response(snapshot, report)


@router.post(
    "/planning-snapshot/csv/validate",
    response_model=CanonicalValidationResponse,
)
def validate_csv_planning_snapshot(
    payload: CanonicalCsvBundleRequest,
    principal: IntegrationPrincipal = Depends(require_integration_read_access),
    tenant: TenantContext = Depends(get_tenant_context),
    journal: IntegrationJournalRepository = Depends(get_integration_journal),
) -> CanonicalValidationResponse:
    context = _effective_integration_context(tenant, principal)
    snapshot = _csv_payload_to_snapshot(payload)
    report = validate_snapshot_report(snapshot)
    _save_journal_entry(
        journal,
        action="validate_csv",
        source_system=snapshot.source_system,
        status=report.readiness_status,
        valid=report.valid,
        error_count=report.error_count,
        warning_count=report.warning_count,
        entity_counts=_snapshot_entity_counts(snapshot),
        details=report.as_dict(),
        principal=principal,
        organization_id=context.organization_id,
        workspace_id=context.workspace_id,
    )
    return _validation_response(snapshot, report)


@router.post(
    "/planning-snapshot/import",
    response_model=CanonicalImportResponse,
)
def import_planning_snapshot(
    payload: CanonicalPlanningSnapshotSchema,
    principal: IntegrationPrincipal = Depends(require_integration_write_access),
    tenant: TenantContext = Depends(get_tenant_context),
    use_case: ImportPlanningSnapshot = Depends(get_import_planning_snapshot),
    journal: IntegrationJournalRepository = Depends(get_integration_journal),
) -> CanonicalImportResponse:
    context = _effective_integration_context(tenant, principal)
    snapshot = _schema_to_snapshot(payload)
    _enforce_snapshot_limits(snapshot)
    report = validate_snapshot_report(snapshot)
    if not report.valid:
        _save_journal_entry(
            journal,
            action="import",
            source_system=snapshot.source_system,
            status="blocked",
            valid=False,
            error_count=report.error_count,
            warning_count=report.warning_count,
            entity_counts=_snapshot_entity_counts(snapshot),
            details=report.as_dict(),
            principal=principal,
            organization_id=context.organization_id,
            workspace_id=context.workspace_id,
        )
        raise HTTPException(
            status_code=422,
            detail={
                "error": "snapshot_validation_error",
                "message": "Planning snapshot validation failed.",
                "details": [report.as_dict()],
            },
        )
    result = use_case.execute(
        ImportPlanningSnapshotInput(
            snapshot=snapshot,
            organization_id=context.organization_id,
            workspace_id=context.workspace_id,
        )
    )
    _save_journal_entry(
        journal,
        action="import",
        source_system=snapshot.source_system,
        status=report.readiness_status,
        valid=True,
        error_count=report.error_count,
        warning_count=report.warning_count,
        entity_counts=_snapshot_entity_counts(snapshot),
        details={
            "validation": report.as_dict(),
            "created": result.created,
            "updated": result.updated,
            "binding_count": result.binding_count,
        },
        principal=principal,
        organization_id=context.organization_id,
        workspace_id=context.workspace_id,
    )
    return CanonicalImportResponse(
        source_system=result.source_system,
        imported_at=result.imported_at,
        created=result.created,
        updated=result.updated,
        binding_count=result.binding_count,
        validation=report.as_dict(),
    )


@router.post(
    "/planning-snapshot/csv/import",
    response_model=CanonicalImportResponse,
)
def import_csv_planning_snapshot(
    payload: CanonicalCsvBundleRequest,
    principal: IntegrationPrincipal = Depends(require_integration_write_access),
    tenant: TenantContext = Depends(get_tenant_context),
    use_case: ImportPlanningSnapshot = Depends(get_import_planning_snapshot),
    journal: IntegrationJournalRepository = Depends(get_integration_journal),
) -> CanonicalImportResponse:
    context = _effective_integration_context(tenant, principal)
    snapshot = _csv_payload_to_snapshot(payload)
    report = validate_snapshot_report(snapshot)
    if not report.valid:
        _save_journal_entry(
            journal,
            action="import_csv",
            source_system=snapshot.source_system,
            status="blocked",
            valid=False,
            error_count=report.error_count,
            warning_count=report.warning_count,
            entity_counts=_snapshot_entity_counts(snapshot),
            details=report.as_dict(),
            principal=principal,
            organization_id=context.organization_id,
            workspace_id=context.workspace_id,
        )
        raise HTTPException(
            status_code=422,
            detail={
                "error": "snapshot_validation_error",
                "message": "Planning snapshot validation failed.",
                "details": [report.as_dict()],
            },
        )
    result = use_case.execute(
        ImportPlanningSnapshotInput(
            snapshot=snapshot,
            organization_id=context.organization_id,
            workspace_id=context.workspace_id,
        )
    )
    _save_journal_entry(
        journal,
        action="import_csv",
        source_system=snapshot.source_system,
        status=report.readiness_status,
        valid=True,
        error_count=report.error_count,
        warning_count=report.warning_count,
        entity_counts=_snapshot_entity_counts(snapshot),
        details={
            "validation": report.as_dict(),
            "created": result.created,
            "updated": result.updated,
            "binding_count": result.binding_count,
        },
        principal=principal,
        organization_id=context.organization_id,
        workspace_id=context.workspace_id,
    )
    return CanonicalImportResponse(
        source_system=result.source_system,
        imported_at=result.imported_at,
        created=result.created,
        updated=result.updated,
        binding_count=result.binding_count,
        validation=report.as_dict(),
    )


@router.get(
    "/automations",
    response_model=list[IntegrationAutomationJobOut],
)
def list_integration_automations(
    workspace_id: str | None = None,
    limit: int = 50,
    tenant: TenantContext = Depends(get_tenant_context),
    automations: IntegrationAutomationRepository = Depends(get_integration_automations),
) -> list[IntegrationAutomationJobOut]:
    ensure_authenticated_permission(tenant, "manage_integrations")
    limit = max(1, min(limit, 200))
    workspace_id = resolve_scoped_workspace_id(tenant, workspace_id)
    return [
        _automation_to_schema(job)
        for job in automations.list_for_scope(
            organization_id=tenant.organization_id,
            workspace_id=workspace_id,
            limit=limit,
        )
    ]


@router.post(
    "/automations",
    response_model=IntegrationAutomationJobOut,
)
def create_integration_automation(
    payload: IntegrationAutomationJobIn,
    tenant: TenantContext = Depends(get_tenant_context),
    automations: IntegrationAutomationRepository = Depends(get_integration_automations),
) -> IntegrationAutomationJobOut:
    ensure_authenticated_permission(tenant, "manage_integrations")
    _validate_automation_payload(payload)
    workspace_id = resolve_scoped_workspace_id(tenant, payload.workspace_id)
    now = datetime.utcnow()
    job = IntegrationAutomationJob(
        id=f"iaj-{uuid4().hex[:12]}",
        organization_id=tenant.organization_id,
        workspace_id=workspace_id,
        name=payload.name,
        direction=payload.direction,
        trigger_type=payload.trigger_type,
        source_system=payload.source_system,
        is_enabled=payload.is_enabled,
        config=dict(payload.config),
        last_status="created",
        last_message="Automation job configured. Run now can execute supported snapshot jobs.",
        created_at=now,
        updated_at=now,
    )
    return _automation_to_schema(automations.save(job))


@router.post(
    "/automations/run-due",
    response_model=IntegrationAutomationRunDueOut,
)
def run_due_integration_automations(
    payload: IntegrationAutomationRunDueRequest,
    principal: IntegrationPrincipal = Depends(require_integration_run_access),
    tenant: TenantContext = Depends(get_tenant_context),
    use_case: RunDueIntegrationAutomations = Depends(get_run_due_integration_automations),
) -> IntegrationAutomationRunDueOut:
    context = _effective_integration_context(tenant, principal)
    _ensure_integration_route_permission(tenant, principal, "manage_integrations")
    workspace_id = resolve_scoped_workspace_id(context, payload.workspace_id)
    result = use_case.execute(
        RunDueIntegrationAutomationsInput(
            organization_id=context.organization_id,
            workspace_id=workspace_id,
            limit=payload.limit,
            dry_run=payload.dry_run,
            now=payload.now,
            actor_details=_actor_details(principal, tenant),
        )
    )
    return IntegrationAutomationRunDueOut(
        checked_count=result.checked_count,
        due_count=result.due_count,
        executed_count=result.executed_count,
        skipped_count=result.skipped_count,
        failed_count=result.failed_count,
        locked_count=result.locked_count,
        retry_wait_count=result.retry_wait_count,
        dry_run=result.dry_run,
        results=[_automation_due_result_to_schema(item) for item in result.results],
    )


@router.get(
    "/automations/health",
    response_model=IntegrationAutomationHealthOut,
)
def get_integration_automation_health_route(
    workspace_id: str | None = None,
    limit: int = 200,
    tenant: TenantContext = Depends(get_tenant_context),
    use_case: GetIntegrationAutomationHealth = Depends(get_integration_automation_health),
) -> IntegrationAutomationHealthOut:
    ensure_authenticated_permission(tenant, "manage_integrations")
    limit = max(1, min(limit, 200))
    workspace_id = resolve_scoped_workspace_id(tenant, workspace_id)
    result = use_case.execute(
        GetIntegrationAutomationHealthInput(
            organization_id=tenant.organization_id,
            workspace_id=workspace_id,
            limit=limit,
        )
    )
    return IntegrationAutomationHealthOut(
        generated_at=result.generated_at,
        status=result.status,
        summary=result.summary,
        issues=[_automation_health_issue_to_schema(issue) for issue in result.issues],
        jobs=[_automation_to_schema(job) for job in result.jobs],
    )


@router.post(
    "/automations/{job_id}/run",
    response_model=IntegrationAutomationRunOut,
)
def run_integration_automation(
    job_id: str,
    principal: IntegrationPrincipal = Depends(require_integration_run_access),
    tenant: TenantContext = Depends(get_tenant_context),
    use_case: RunIntegrationAutomation = Depends(get_run_integration_automation),
) -> IntegrationAutomationRunOut:
    context = _effective_integration_context(tenant, principal)
    _ensure_integration_route_permission(tenant, principal, "manage_integrations")
    try:
        result = use_case.execute(
            RunIntegrationAutomationInput(
                job_id=job_id,
                organization_id=context.organization_id,
                workspace_id=context.workspace_id,
                actor_details=_actor_details(principal, tenant),
            )
        )
    except RunIntegrationAutomationRejected as exc:
        status_code = {
            "automation_not_found": 404,
            "automation_disabled": 409,
            "automation_locked": 409,
            "cross_workspace_forbidden": 403,
        }.get(exc.code, 422)
        raise HTTPException(
            status_code=status_code,
            detail={"error": exc.code, "message": exc.message},
        ) from exc
    return IntegrationAutomationRunOut(
        job=_automation_to_schema(result.job),
        journal_entry=_journal_entry_to_schema(result.journal_entry),
        message=result.message,
        result=result.result,
    )


@router.get(
    "/journal",
    response_model=list[IntegrationJournalEntryOut],
)
def list_integration_journal(
    limit: int = 20,
    source_system: str | None = None,
    action: str | None = None,
    workspace_id: str | None = None,
    principal: IntegrationPrincipal = Depends(require_integration_read_access),
    tenant: TenantContext = Depends(get_tenant_context),
    journal: IntegrationJournalRepository = Depends(get_integration_journal),
) -> list[IntegrationJournalEntryOut]:
    context = _effective_integration_context(tenant, principal)
    workspace_id = resolve_scoped_workspace_id(context, workspace_id)
    return [
        _journal_entry_to_schema(entry)
        for entry in journal.list_recent(
            limit=limit,
            source_system=source_system,
            action=action,
            organization_id=context.organization_id,
            workspace_id=workspace_id,
        )
    ]


@router.get(
    "/executions",
    response_model=list[IntegrationExecutionOut],
)
def list_integration_executions(
    limit: int = 50,
    source_system: str | None = None,
    execution_kind: str | None = None,
    target_type: str | None = None,
    target_id: str | None = None,
    status: str | None = None,
    workspace_id: str | None = None,
    tenant: TenantContext = Depends(get_tenant_context),
    executions: IntegrationExecutionRepository = Depends(get_integration_executions),
) -> list[IntegrationExecutionOut]:
    ensure_authenticated_permission(tenant, "manage_integrations")
    limit = max(1, min(limit, 200))
    workspace_id = resolve_scoped_workspace_id(tenant, workspace_id)
    return [
        _execution_to_schema(record)
        for record in executions.list_recent(
            limit=limit,
            organization_id=tenant.organization_id,
            workspace_id=workspace_id,
            execution_kind=execution_kind,
            target_type=target_type,
            target_id=target_id,
            source_system=source_system,
            status=status,
        )
    ]


@router.post(
    "/scheduling/run-from-snapshot",
    response_model=RunScheduleResponse,
)
def run_from_snapshot(
    payload: RunScheduleFromSnapshotRequest,
    principal: IntegrationPrincipal = Depends(require_integration_run_access),
    tenant: TenantContext = Depends(get_tenant_context),
    use_case: RunSchedulingFromSnapshot = Depends(get_run_scheduling_from_snapshot),
    journal: IntegrationJournalRepository = Depends(get_integration_journal),
    audit_repository=Depends(get_audit_event_repository),
) -> RunScheduleResponse:
    context = _effective_integration_context(tenant, principal)
    snapshot = _schema_to_snapshot(payload.snapshot)
    _enforce_snapshot_limits(snapshot)
    result = use_case.execute(
        RunSchedulingFromSnapshotInput(
            snapshot=snapshot,
            horizon_start=payload.horizon_start,
            horizon_days=payload.horizon_days,
            heuristic=payload.heuristic,
            strategy=payload.strategy,
            objective=_build_objective(payload.objective),
        )
    )
    _save_journal_entry(
        journal,
        action="run_from_snapshot",
        source_system=snapshot.source_system,
        status=result.solver_status,
        valid=result.feasibility.readiness_status != "blocked",
        entity_counts=_snapshot_entity_counts(snapshot),
        details={
            "schedule_id": result.schedule.id,
            "strategy": result.strategy,
            "solver_status": result.solver_status,
            "objective_value": result.objective_value,
            "wall_time_ms": result.wall_time_ms,
        },
        principal=principal,
        organization_id=context.organization_id,
        workspace_id=context.workspace_id,
    )
    # J7 pass 2 — audit the integration kick-off (sensitive: external
    # system runs the engine on behalf of the tenant). The integration
    # journal already captures the operational detail; the audit log
    # captures who/where in a single greppable view.
    record_audit_event(
        audit_repository,
        action="integration.run_from_snapshot",
        status=result.solver_status,
        organization_id=context.organization_id,
        workspace_id=context.workspace_id,
        user_id=principal.client_id,
        subject=snapshot.source_system,
        details={
            "schedule_id": result.schedule.id,
            "strategy": result.strategy,
            "auth_mode": principal.auth_mode,
            "key_type": principal.key_type,
        },
    )
    return RunScheduleResponse(
        schedule_id=result.schedule.id,
        created_at=result.schedule.created_at,
        strategy=result.strategy,
        solver_status=result.solver_status,
        objective_value=result.objective_value,
        wall_time_ms=result.wall_time_ms,
        assignments=[
            ScheduledOperationOut(
                operation_id=a.operation_id,
                work_order_id=a.work_order_id,
                machine_id=a.machine_id,
                setup_start=a.setup_start,
                start=a.start,
                end=a.end,
            )
            for a in result.schedule.assignments
        ],
        metrics=result.metrics,
        summary=_build_summary_out(result.summary),
        analysis=_build_analysis_out(result.analysis),
        feasibility=_build_feasibility_out(result.feasibility),
        diagnostics=result.diagnostics,
    )
