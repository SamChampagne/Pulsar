"""FastAPI dependency wiring.

Creates a per-request session and injects fully-assembled use cases into
route handlers. Route functions never touch SQLAlchemy directly.
"""

from __future__ import annotations

from collections.abc import Iterator

from fastapi import Depends
from sqlalchemy.orm import Session

from ..application.ports import FlowRunTraceRepository, ScheduleRepository
from ..application.ports.pdf_renderer import PdfRenderer
from ..application.use_cases import (
    AddMembership,
    CapableToPromise,
    CompareScenarios,
    CompareStrategies,
    CreateCalendar,
    CreateInventoryItem,
    CreateMachine,
    CreateOrganization,
    CreateResource,
    CreateSupplyLot,
    CreateUserAccount,
    CreateWorkOrder,
    CreateWorkspace,
    DeleteMachine,
    DeleteWorkOrder,
    ExportPlanningSnapshot,
    ExportPublishedPlan,
    GetIntegrationAutomationHealth,
    GetMachine,
    GetPlannerReadiness,
    GetScheduleCapacity,
    GetScheduleDashboard,
    GetScheduleGantt,
    GetScheduleRisk,
    GetWorkOrder,
    GetWorkspace,
    GrantWorkspaceAccess,
    ImportPlanningSnapshot,
    ListAccessibleWorkspaces,
    ListMachines,
    ListMemberships,
    ListOrganizations,
    ListOrganizationWorkspaces,
    ListSchedules,
    ListUserAccounts,
    ListWorkOrders,
    ListWorkspaceAccessGrants,
    ListWorkspaces,
    ManageIntegrationApiClients,
    ManageIntegrationConnectors,
    ManageIntegrationCredentials,
    ManageIntegrationFlows,
    PlanningControlPlane,
    PublishScenario,
    ReplayScheduleRun,
    RevokeWorkspaceAccess,
    RunDueIntegrationAutomations,
    RunIntegrationAutomation,
    RunIntegrationFlow,
    RunScheduling,
    RunSchedulingFromSnapshot,
    SuggestOperationSlots,
    UpdateScheduleContext,
    ValidateIntegrationFlowGraph,
)
from ..application.use_cases.reports import (
    BuildExecutiveDashboard,
    BuildLateOrderReport,
    BuildProductionSheet,
    BuildWoTraveler,
)
from ..application.use_cases.run_disruption import RunDisruption
from ..infrastructure.db import get_session_factory
from ..infrastructure.db.repositories import (
    SqlAuditEventRepository,
    SqlCalendarRepository,
    SqlFlowRunTraceRepository,
    SqlIntegrationApiClientRepository,
    SqlIntegrationAutomationRepository,
    SqlIntegrationBindingRepository,
    SqlIntegrationConnectorRepository,
    SqlIntegrationCredentialRepository,
    SqlIntegrationExecutionRepository,
    SqlIntegrationFlowRepository,
    SqlIntegrationJournalRepository,
    SqlInventoryRepository,
    SqlMachineRepository,
    SqlMembershipRepository,
    SqlOrganizationRepository,
    SqlPlanningControlRepository,
    SqlResourceRepository,
    SqlRevokedAuthTokenRepository,
    SqlScheduleRepository,
    SqlSupplyRepository,
    SqlUserAccountRepository,
    SqlUserSessionRevocationRepository,
    SqlWebhookEventDedupRepository,
    SqlWorkOrderRepository,
    SqlWorkspaceAccessGrantRepository,
    SqlWorkspaceRepository,
)
from ..infrastructure.integration_database import SqlAlchemyIntegrationDatabaseTransport
from ..infrastructure.integration_http import (
    EnvIntegrationSecretResolver,
    UrllibIntegrationHttpTransport,
)
from ..infrastructure.integration_sftp import ParamikoIntegrationSftpTransport
from ..infrastructure.pdf.weasyprint_renderer import WeasyprintRenderer
from ..infrastructure.scoping import TenantScope


def get_db_session() -> Iterator[Session]:
    factory = get_session_factory()
    with factory.session() as session:
        yield session


def get_tenant_scope_from_context(
    *,
    organization_id: str | None = None,
    workspace_id: str | None = None,
) -> TenantScope:
    """Build the tenant scope used when wrapping repositories.

    Helper used by routes that already resolve a ``TenantContext`` and want
    to call ``repo.with_scope(scope)`` to get the F-401 leak-safe view.
    """

    if organization_id is None:
        return TenantScope.unscoped()
    if workspace_id is None:
        return TenantScope.for_organization(organization_id)
    return TenantScope.for_workspace(
        organization_id=organization_id,
        workspace_id=workspace_id,
    )


def get_run_scheduling(
    session: Session = Depends(get_db_session),
) -> RunScheduling:
    return RunScheduling(
        work_orders=SqlWorkOrderRepository(session),
        machines=SqlMachineRepository(session),
        calendars=SqlCalendarRepository(session),
        resources=SqlResourceRepository(session),
        inventory=SqlInventoryRepository(session),
        supplies=SqlSupplyRepository(session),
        schedules=SqlScheduleRepository(session),
    )


def get_compare_strategies(
    session: Session = Depends(get_db_session),
) -> CompareStrategies:
    return CompareStrategies(
        work_orders=SqlWorkOrderRepository(session),
        machines=SqlMachineRepository(session),
        calendars=SqlCalendarRepository(session),
        resources=SqlResourceRepository(session),
        inventory=SqlInventoryRepository(session),
        supplies=SqlSupplyRepository(session),
        schedules=SqlScheduleRepository(session),
    )


def get_compare_scenarios(
    session: Session = Depends(get_db_session),
) -> CompareScenarios:
    return CompareScenarios(SqlScheduleRepository(session))


def get_publish_scenario(
    session: Session = Depends(get_db_session),
) -> PublishScenario:
    return PublishScenario(SqlScheduleRepository(session))


def get_planning_control_plane(
    session: Session = Depends(get_db_session),
) -> PlanningControlPlane:
    return PlanningControlPlane(
        schedules=SqlScheduleRepository(session),
        planning=SqlPlanningControlRepository(session),
    )


def get_planner_readiness(
    session: Session = Depends(get_db_session),
) -> GetPlannerReadiness:
    return GetPlannerReadiness(SqlScheduleRepository(session))


def get_capable_to_promise(
    session: Session = Depends(get_db_session),
) -> CapableToPromise:
    return CapableToPromise(
        work_orders=SqlWorkOrderRepository(session),
        machines=SqlMachineRepository(session),
        calendars=SqlCalendarRepository(session),
        resources=SqlResourceRepository(session),
        inventory=SqlInventoryRepository(session),
        supplies=SqlSupplyRepository(session),
    )


def get_run_disruption(
    session: Session = Depends(get_db_session),
) -> RunDisruption:
    return RunDisruption(
        work_orders=SqlWorkOrderRepository(session),
        machines=SqlMachineRepository(session),
        calendars=SqlCalendarRepository(session),
        resources=SqlResourceRepository(session),
        inventory=SqlInventoryRepository(session),
        supplies=SqlSupplyRepository(session),
        schedules=SqlScheduleRepository(session),
    )


def get_create_work_order(
    session: Session = Depends(get_db_session),
) -> CreateWorkOrder:
    return CreateWorkOrder(SqlWorkOrderRepository(session))


def get_list_work_orders(
    session: Session = Depends(get_db_session),
) -> ListWorkOrders:
    return ListWorkOrders(SqlWorkOrderRepository(session))


def get_get_work_order(
    session: Session = Depends(get_db_session),
) -> GetWorkOrder:
    return GetWorkOrder(SqlWorkOrderRepository(session))


def get_delete_work_order(
    session: Session = Depends(get_db_session),
) -> DeleteWorkOrder:
    return DeleteWorkOrder(SqlWorkOrderRepository(session))


def get_create_machine(
    session: Session = Depends(get_db_session),
) -> CreateMachine:
    return CreateMachine(SqlMachineRepository(session))


def get_list_machines(
    session: Session = Depends(get_db_session),
) -> ListMachines:
    return ListMachines(SqlMachineRepository(session))


def get_get_machine(
    session: Session = Depends(get_db_session),
) -> GetMachine:
    return GetMachine(SqlMachineRepository(session))


def get_delete_machine(
    session: Session = Depends(get_db_session),
) -> DeleteMachine:
    return DeleteMachine(SqlMachineRepository(session))


def get_create_resource(
    session: Session = Depends(get_db_session),
) -> CreateResource:
    return CreateResource(SqlResourceRepository(session))


def get_create_inventory_item(
    session: Session = Depends(get_db_session),
) -> CreateInventoryItem:
    return CreateInventoryItem(SqlInventoryRepository(session))


def get_create_supply_lot(
    session: Session = Depends(get_db_session),
) -> CreateSupplyLot:
    return CreateSupplyLot(SqlSupplyRepository(session))


def get_create_calendar(
    session: Session = Depends(get_db_session),
) -> CreateCalendar:
    return CreateCalendar(SqlCalendarRepository(session))


def get_create_workspace(
    session: Session = Depends(get_db_session),
) -> CreateWorkspace:
    return CreateWorkspace(SqlWorkspaceRepository(session))


def get_create_organization(
    session: Session = Depends(get_db_session),
) -> CreateOrganization:
    return CreateOrganization(SqlOrganizationRepository(session))


def get_list_organizations(
    session: Session = Depends(get_db_session),
) -> ListOrganizations:
    return ListOrganizations(SqlOrganizationRepository(session))


def get_create_user_account(
    session: Session = Depends(get_db_session),
) -> CreateUserAccount:
    return CreateUserAccount(SqlUserAccountRepository(session))


def get_list_user_accounts(
    session: Session = Depends(get_db_session),
) -> ListUserAccounts:
    return ListUserAccounts(SqlUserAccountRepository(session))


def get_add_membership(
    session: Session = Depends(get_db_session),
) -> AddMembership:
    return AddMembership(
        organizations=SqlOrganizationRepository(session),
        users=SqlUserAccountRepository(session),
        memberships=SqlMembershipRepository(session),
    )


def get_list_memberships(
    session: Session = Depends(get_db_session),
) -> ListMemberships:
    return ListMemberships(SqlMembershipRepository(session))


def get_list_organization_workspaces(
    session: Session = Depends(get_db_session),
) -> ListOrganizationWorkspaces:
    return ListOrganizationWorkspaces(SqlWorkspaceRepository(session))


def get_workspace_access_grants(
    session: Session = Depends(get_db_session),
) -> SqlWorkspaceAccessGrantRepository:
    return SqlWorkspaceAccessGrantRepository(session)


def get_list_workspace_access_grants(
    session: Session = Depends(get_db_session),
) -> ListWorkspaceAccessGrants:
    return ListWorkspaceAccessGrants(SqlWorkspaceAccessGrantRepository(session))


def get_grant_workspace_access(
    session: Session = Depends(get_db_session),
) -> GrantWorkspaceAccess:
    return GrantWorkspaceAccess(
        organizations=SqlOrganizationRepository(session),
        users=SqlUserAccountRepository(session),
        memberships=SqlMembershipRepository(session),
        workspaces=SqlWorkspaceRepository(session),
        grants=SqlWorkspaceAccessGrantRepository(session),
    )


def get_revoke_workspace_access(
    session: Session = Depends(get_db_session),
) -> RevokeWorkspaceAccess:
    return RevokeWorkspaceAccess(
        workspaces=SqlWorkspaceRepository(session),
        grants=SqlWorkspaceAccessGrantRepository(session),
    )


def get_list_accessible_workspaces(
    session: Session = Depends(get_db_session),
) -> ListAccessibleWorkspaces:
    return ListAccessibleWorkspaces(
        workspaces=SqlWorkspaceRepository(session),
        grants=SqlWorkspaceAccessGrantRepository(session),
    )


def get_list_schedules(
    session: Session = Depends(get_db_session),
) -> ListSchedules:
    return ListSchedules(SqlScheduleRepository(session))


def get_schedule_repository(
    session: Session = Depends(get_db_session),
) -> ScheduleRepository:
    return SqlScheduleRepository(session)


def get_list_workspaces(
    session: Session = Depends(get_db_session),
) -> ListWorkspaces:
    return ListWorkspaces(SqlWorkspaceRepository(session))


def get_get_workspace(
    session: Session = Depends(get_db_session),
) -> GetWorkspace:
    return GetWorkspace(SqlWorkspaceRepository(session))


def get_schedule_dashboard(
    session: Session = Depends(get_db_session),
) -> GetScheduleDashboard:
    return GetScheduleDashboard(
        schedules=SqlScheduleRepository(session),
        work_orders=SqlWorkOrderRepository(session),
    )


def get_schedule_capacity(
    session: Session = Depends(get_db_session),
) -> GetScheduleCapacity:
    return GetScheduleCapacity(
        schedules=SqlScheduleRepository(session),
        machines=SqlMachineRepository(session),
        calendars=SqlCalendarRepository(session),
    )


def get_schedule_gantt(
    session: Session = Depends(get_db_session),
) -> GetScheduleGantt:
    return GetScheduleGantt(
        schedules=SqlScheduleRepository(session),
        work_orders=SqlWorkOrderRepository(session),
        machines=SqlMachineRepository(session),
    )


def get_schedule_risk(
    session: Session = Depends(get_db_session),
) -> GetScheduleRisk:
    return GetScheduleRisk(
        GetScheduleGantt(
            schedules=SqlScheduleRepository(session),
            work_orders=SqlWorkOrderRepository(session),
            machines=SqlMachineRepository(session),
        )
    )


def get_suggest_operation_slots(
    session: Session = Depends(get_db_session),
) -> SuggestOperationSlots:
    return SuggestOperationSlots(
        schedules=SqlScheduleRepository(session),
        work_orders=SqlWorkOrderRepository(session),
        machines=SqlMachineRepository(session),
        calendars=SqlCalendarRepository(session),
        resources=SqlResourceRepository(session),
        inventory=SqlInventoryRepository(session),
        supplies=SqlSupplyRepository(session),
    )


def get_update_schedule_context(
    session: Session = Depends(get_db_session),
) -> UpdateScheduleContext:
    return UpdateScheduleContext(SqlScheduleRepository(session))


def get_replay_schedule_run(
    session: Session = Depends(get_db_session),
) -> ReplayScheduleRun:
    return ReplayScheduleRun(SqlScheduleRepository(session))


def get_export_planning_snapshot(
    session: Session = Depends(get_db_session),
) -> ExportPlanningSnapshot:
    return ExportPlanningSnapshot(
        work_orders=SqlWorkOrderRepository(session),
        machines=SqlMachineRepository(session),
        calendars=SqlCalendarRepository(session),
        resources=SqlResourceRepository(session),
        inventory=SqlInventoryRepository(session),
        supplies=SqlSupplyRepository(session),
    )


def get_export_published_plan(
    session: Session = Depends(get_db_session),
) -> ExportPublishedPlan:
    return ExportPublishedPlan(SqlScheduleRepository(session))


def get_import_planning_snapshot(
    session: Session = Depends(get_db_session),
) -> ImportPlanningSnapshot:
    return ImportPlanningSnapshot(
        calendars=SqlCalendarRepository(session),
        machines=SqlMachineRepository(session),
        resources=SqlResourceRepository(session),
        work_orders=SqlWorkOrderRepository(session),
        inventory=SqlInventoryRepository(session),
        supplies=SqlSupplyRepository(session),
        bindings=SqlIntegrationBindingRepository(session),
    )


def get_integration_journal(
    session: Session = Depends(get_db_session),
) -> SqlIntegrationJournalRepository:
    return SqlIntegrationJournalRepository(session)


def get_audit_event_repository(
    session: Session = Depends(get_db_session),
) -> SqlAuditEventRepository:
    return SqlAuditEventRepository(session)


def get_revoked_auth_token_repository(
    session: Session = Depends(get_db_session),
) -> SqlRevokedAuthTokenRepository:
    return SqlRevokedAuthTokenRepository(session)


def get_user_session_revocation_repository(
    session: Session = Depends(get_db_session),
) -> SqlUserSessionRevocationRepository:
    return SqlUserSessionRevocationRepository(session)


def get_webhook_event_dedup_repository(
    session: Session = Depends(get_db_session),
) -> SqlWebhookEventDedupRepository:
    return SqlWebhookEventDedupRepository(session)


def get_integration_executions(
    session: Session = Depends(get_db_session),
) -> SqlIntegrationExecutionRepository:
    return SqlIntegrationExecutionRepository(session)


def get_integration_api_clients(
    session: Session = Depends(get_db_session),
) -> SqlIntegrationApiClientRepository:
    return SqlIntegrationApiClientRepository(session)


def get_manage_integration_api_clients(
    session: Session = Depends(get_db_session),
) -> ManageIntegrationApiClients:
    return ManageIntegrationApiClients(SqlIntegrationApiClientRepository(session))


def get_integration_connectors(
    session: Session = Depends(get_db_session),
) -> SqlIntegrationConnectorRepository:
    return SqlIntegrationConnectorRepository(session)


def get_integration_credentials(
    session: Session = Depends(get_db_session),
) -> SqlIntegrationCredentialRepository:
    return SqlIntegrationCredentialRepository(session)


def get_integration_secret_resolver() -> EnvIntegrationSecretResolver:
    return EnvIntegrationSecretResolver()


def get_integration_http_transport() -> UrllibIntegrationHttpTransport:
    return UrllibIntegrationHttpTransport()


def get_manage_integration_connectors(
    session: Session = Depends(get_db_session),
) -> ManageIntegrationConnectors:
    return ManageIntegrationConnectors(
        SqlIntegrationConnectorRepository(session),
        http_transport=UrllibIntegrationHttpTransport(),
        database_transport=SqlAlchemyIntegrationDatabaseTransport(),
        sftp_transport=ParamikoIntegrationSftpTransport(),
        secret_resolver=EnvIntegrationSecretResolver(),
        credentials=SqlIntegrationCredentialRepository(session),
        executions=SqlIntegrationExecutionRepository(session),
    )


def get_manage_integration_credentials(
    session: Session = Depends(get_db_session),
) -> ManageIntegrationCredentials:
    return ManageIntegrationCredentials(
        SqlIntegrationCredentialRepository(session),
        secret_resolver=EnvIntegrationSecretResolver(),
    )


def get_integration_automations(
    session: Session = Depends(get_db_session),
) -> SqlIntegrationAutomationRepository:
    return SqlIntegrationAutomationRepository(session)


def get_integration_flows(
    session: Session = Depends(get_db_session),
) -> SqlIntegrationFlowRepository:
    return SqlIntegrationFlowRepository(session)


def get_manage_integration_flows(
    session: Session = Depends(get_db_session),
) -> ManageIntegrationFlows:
    return ManageIntegrationFlows(
        SqlIntegrationFlowRepository(session),
        connectors=SqlIntegrationConnectorRepository(session),
        credentials=SqlIntegrationCredentialRepository(session),
        database_transport=SqlAlchemyIntegrationDatabaseTransport(),
        sftp_transport=ParamikoIntegrationSftpTransport(),
        secret_resolver=EnvIntegrationSecretResolver(),
        automations=SqlIntegrationAutomationRepository(session),
    )


def get_validate_integration_flow_graph(
    session: Session = Depends(get_db_session),
) -> ValidateIntegrationFlowGraph:
    return ValidateIntegrationFlowGraph(SqlIntegrationFlowRepository(session))


def get_integration_flow_repository(
    session: Session = Depends(get_db_session),
) -> SqlIntegrationFlowRepository:
    """V1.2 P3 — direct flow-repo factory for the public webhook route.

    The webhook ingress endpoint resolves a public token to a flow
    BEFORE invoking the use case, so it needs the repo directly
    rather than via ManageIntegrationFlows (which applies tenant
    scoping the public route can't supply)."""

    return SqlIntegrationFlowRepository(session)


def get_run_integration_flow(
    session: Session = Depends(get_db_session),
) -> RunIntegrationFlow:
    return RunIntegrationFlow(
        flows=SqlIntegrationFlowRepository(session),
        journal=SqlIntegrationJournalRepository(session),
        exporter=ExportPlanningSnapshot(
            work_orders=SqlWorkOrderRepository(session),
            machines=SqlMachineRepository(session),
            calendars=SqlCalendarRepository(session),
            resources=SqlResourceRepository(session),
            inventory=SqlInventoryRepository(session),
            supplies=SqlSupplyRepository(session),
        ),
        plan_exporter=ExportPublishedPlan(SqlScheduleRepository(session)),
        importer=ImportPlanningSnapshot(
            calendars=SqlCalendarRepository(session),
            machines=SqlMachineRepository(session),
            resources=SqlResourceRepository(session),
            work_orders=SqlWorkOrderRepository(session),
            inventory=SqlInventoryRepository(session),
            supplies=SqlSupplyRepository(session),
            bindings=SqlIntegrationBindingRepository(session),
        ),
        scheduler=RunSchedulingFromSnapshot(),
        connectors=SqlIntegrationConnectorRepository(session),
        credentials=SqlIntegrationCredentialRepository(session),
        secret_resolver=EnvIntegrationSecretResolver(),
        http_transport=UrllibIntegrationHttpTransport(),
        database_transport=SqlAlchemyIntegrationDatabaseTransport(),
        sftp_transport=ParamikoIntegrationSftpTransport(),
        executions=SqlIntegrationExecutionRepository(session),
        flow_run_traces=SqlFlowRunTraceRepository(session),
        bindings=SqlIntegrationBindingRepository(session),
    )


def get_flow_run_trace_repository(
    session: Session = Depends(get_db_session),
) -> FlowRunTraceRepository:
    return SqlFlowRunTraceRepository(session)


def get_integration_automation_health(
    session: Session = Depends(get_db_session),
) -> GetIntegrationAutomationHealth:
    return GetIntegrationAutomationHealth(SqlIntegrationAutomationRepository(session))


def get_run_integration_automation(
    session: Session = Depends(get_db_session),
) -> RunIntegrationAutomation:
    return RunIntegrationAutomation(
        automations=SqlIntegrationAutomationRepository(session),
        journal=SqlIntegrationJournalRepository(session),
        exporter=ExportPlanningSnapshot(
            work_orders=SqlWorkOrderRepository(session),
            machines=SqlMachineRepository(session),
            calendars=SqlCalendarRepository(session),
            resources=SqlResourceRepository(session),
            inventory=SqlInventoryRepository(session),
            supplies=SqlSupplyRepository(session),
        ),
        plan_exporter=ExportPublishedPlan(SqlScheduleRepository(session)),
        importer=ImportPlanningSnapshot(
            calendars=SqlCalendarRepository(session),
            machines=SqlMachineRepository(session),
            resources=SqlResourceRepository(session),
            work_orders=SqlWorkOrderRepository(session),
            inventory=SqlInventoryRepository(session),
            supplies=SqlSupplyRepository(session),
            bindings=SqlIntegrationBindingRepository(session),
        ),
        connectors=SqlIntegrationConnectorRepository(session),
        secret_resolver=EnvIntegrationSecretResolver(),
        http_transport=UrllibIntegrationHttpTransport(),
        sftp_transport=ParamikoIntegrationSftpTransport(),
        flow_runner=RunIntegrationFlow(
            flows=SqlIntegrationFlowRepository(session),
            journal=SqlIntegrationJournalRepository(session),
            exporter=ExportPlanningSnapshot(
                work_orders=SqlWorkOrderRepository(session),
                machines=SqlMachineRepository(session),
                calendars=SqlCalendarRepository(session),
                resources=SqlResourceRepository(session),
                inventory=SqlInventoryRepository(session),
                supplies=SqlSupplyRepository(session),
            ),
            plan_exporter=ExportPublishedPlan(SqlScheduleRepository(session)),
            importer=ImportPlanningSnapshot(
                calendars=SqlCalendarRepository(session),
                machines=SqlMachineRepository(session),
                resources=SqlResourceRepository(session),
                work_orders=SqlWorkOrderRepository(session),
                inventory=SqlInventoryRepository(session),
                supplies=SqlSupplyRepository(session),
                bindings=SqlIntegrationBindingRepository(session),
            ),
            scheduler=RunSchedulingFromSnapshot(),
            connectors=SqlIntegrationConnectorRepository(session),
            credentials=SqlIntegrationCredentialRepository(session),
            secret_resolver=EnvIntegrationSecretResolver(),
            http_transport=UrllibIntegrationHttpTransport(),
            database_transport=SqlAlchemyIntegrationDatabaseTransport(),
            sftp_transport=ParamikoIntegrationSftpTransport(),
            executions=SqlIntegrationExecutionRepository(session),
            bindings=SqlIntegrationBindingRepository(session),
        ),
        credentials=SqlIntegrationCredentialRepository(session),
        executions=SqlIntegrationExecutionRepository(session),
    )


def get_run_due_integration_automations(
    session: Session = Depends(get_db_session),
) -> RunDueIntegrationAutomations:
    automations = SqlIntegrationAutomationRepository(session)
    return RunDueIntegrationAutomations(
        automations=automations,
        runner=RunIntegrationAutomation(
            automations=automations,
            journal=SqlIntegrationJournalRepository(session),
            exporter=ExportPlanningSnapshot(
                work_orders=SqlWorkOrderRepository(session),
                machines=SqlMachineRepository(session),
                calendars=SqlCalendarRepository(session),
                resources=SqlResourceRepository(session),
                inventory=SqlInventoryRepository(session),
                supplies=SqlSupplyRepository(session),
            ),
            plan_exporter=ExportPublishedPlan(SqlScheduleRepository(session)),
            importer=ImportPlanningSnapshot(
                calendars=SqlCalendarRepository(session),
                machines=SqlMachineRepository(session),
                resources=SqlResourceRepository(session),
                work_orders=SqlWorkOrderRepository(session),
                inventory=SqlInventoryRepository(session),
                supplies=SqlSupplyRepository(session),
                bindings=SqlIntegrationBindingRepository(session),
            ),
            connectors=SqlIntegrationConnectorRepository(session),
            secret_resolver=EnvIntegrationSecretResolver(),
            http_transport=UrllibIntegrationHttpTransport(),
            sftp_transport=ParamikoIntegrationSftpTransport(),
            flow_runner=RunIntegrationFlow(
                flows=SqlIntegrationFlowRepository(session),
                journal=SqlIntegrationJournalRepository(session),
                exporter=ExportPlanningSnapshot(
                    work_orders=SqlWorkOrderRepository(session),
                    machines=SqlMachineRepository(session),
                    calendars=SqlCalendarRepository(session),
                    resources=SqlResourceRepository(session),
                    inventory=SqlInventoryRepository(session),
                    supplies=SqlSupplyRepository(session),
                ),
                plan_exporter=ExportPublishedPlan(SqlScheduleRepository(session)),
                importer=ImportPlanningSnapshot(
                    calendars=SqlCalendarRepository(session),
                    machines=SqlMachineRepository(session),
                    resources=SqlResourceRepository(session),
                    work_orders=SqlWorkOrderRepository(session),
                    inventory=SqlInventoryRepository(session),
                    supplies=SqlSupplyRepository(session),
                    bindings=SqlIntegrationBindingRepository(session),
                ),
                scheduler=RunSchedulingFromSnapshot(),
                connectors=SqlIntegrationConnectorRepository(session),
                credentials=SqlIntegrationCredentialRepository(session),
                secret_resolver=EnvIntegrationSecretResolver(),
                http_transport=UrllibIntegrationHttpTransport(),
                database_transport=SqlAlchemyIntegrationDatabaseTransport(),
                sftp_transport=ParamikoIntegrationSftpTransport(),
                executions=SqlIntegrationExecutionRepository(session),
                bindings=SqlIntegrationBindingRepository(session),
            ),
            credentials=SqlIntegrationCredentialRepository(session),
            executions=SqlIntegrationExecutionRepository(session),
        ),
    )


def get_run_scheduling_from_snapshot() -> RunSchedulingFromSnapshot:
    return RunSchedulingFromSnapshot()


def get_pdf_renderer() -> PdfRenderer:
    return WeasyprintRenderer()


def get_build_production_sheet(
    session: Session = Depends(get_db_session),
) -> BuildProductionSheet:
    return BuildProductionSheet(
        machines=SqlMachineRepository(session),
        work_orders=SqlWorkOrderRepository(session),
        organizations=SqlOrganizationRepository(session),
        workspaces=SqlWorkspaceRepository(session),
        schedules=SqlScheduleRepository(session),
    )


def get_build_late_order_report(
    session: Session = Depends(get_db_session),
) -> BuildLateOrderReport:
    return BuildLateOrderReport(
        work_orders=SqlWorkOrderRepository(session),
        organizations=SqlOrganizationRepository(session),
        workspaces=SqlWorkspaceRepository(session),
        schedules=SqlScheduleRepository(session),
    )


def get_build_wo_traveler(
    session: Session = Depends(get_db_session),
) -> BuildWoTraveler:
    return BuildWoTraveler(
        work_orders=SqlWorkOrderRepository(session),
        organizations=SqlOrganizationRepository(session),
        workspaces=SqlWorkspaceRepository(session),
        schedules=SqlScheduleRepository(session),
    )


def get_build_executive_dashboard(
    session: Session = Depends(get_db_session),
) -> BuildExecutiveDashboard:
    return BuildExecutiveDashboard(
        work_orders=SqlWorkOrderRepository(session),
        schedules=SqlScheduleRepository(session),
    )
