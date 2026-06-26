"""Use cases: the entry points to the application layer.

Each use case is a small class with a single ``execute`` method. This
style (sometimes called *interactor*) keeps API handlers trivial and
makes unit-testing use cases straightforward (no HTTP, no SQL).
"""

from .accounts import (
    AddMembership,
    AddMembershipInput,
    CreateOrganization,
    CreateOrganizationInput,
    CreateUserAccount,
    CreateUserAccountInput,
    ListMemberships,
    ListOrganizations,
    ListOrganizationWorkspaces,
    ListUserAccounts,
)
from .capable_to_promise import (
    CapableToPromise,
    CapableToPromiseInput,
    CapableToPromiseOutput,
)
from .compare_scenarios import (
    CompareScenarios,
    CompareScenariosInput,
    CompareScenariosOutput,
)
from .compare_strategies import (
    CompareStrategies,
    CompareStrategiesInput,
    CompareStrategiesOutput,
    StrategyComparison,
)
from .create_calendar import CreateCalendar, CreateCalendarInput
from .create_inventory_item import CreateInventoryItem, CreateInventoryItemInput
from .create_machine import CreateMachine, CreateMachineInput
from .create_resource import CreateResource, CreateResourceInput
from .create_supply_lot import CreateSupplyLot, CreateSupplyLotInput
from .create_work_order import CreateWorkOrder, CreateWorkOrderInput
from .create_workspace import CreateWorkspace, CreateWorkspaceInput
from .export_planning_snapshot import (
    ExportPlanningSnapshot,
    ExportPlanningSnapshotInput,
)
from .export_published_plan import (
    ExportPublishedPlan,
    ExportPublishedPlanInput,
    ExportPublishedPlanOutput,
)
from .get_integration_automation_health import (
    GetIntegrationAutomationHealth,
    GetIntegrationAutomationHealthInput,
    GetIntegrationAutomationHealthOutput,
    IntegrationAutomationHealthIssue,
)
from .get_machine import DeleteMachine, GetMachine
from .get_schedule_capacity import GetScheduleCapacity, ScheduleCapacityOutput
from .get_schedule_dashboard import DashboardOutput, GetScheduleDashboard
from .get_schedule_gantt import GetScheduleGantt, ScheduleGanttOutput
from .get_schedule_risk import (
    GetScheduleRisk,
    ScheduleRiskAction,
    ScheduleRiskConstraint,
    ScheduleRiskMachinePressure,
    ScheduleRiskOperation,
    ScheduleRiskOutput,
    ScheduleRiskWorkOrder,
)
from .get_work_order import DeleteWorkOrder, GetWorkOrder
from .get_workspace import GetWorkspace
from .handle_disruption import HandleDisruption, HandleDisruptionInput, HandleDisruptionOutput
from .import_planning_snapshot import (
    ImportPlanningSnapshot,
    ImportPlanningSnapshotInput,
    ImportPlanningSnapshotOutput,
)
from .integration_api_clients import (
    CreateIntegrationApiClientInput,
    CreateIntegrationApiClientOutput,
    ManageIntegrationApiClients,
    RevokeIntegrationApiClientInput,
)
from .integration_connectors import (
    CreateIntegrationConnectorInput,
    InspectIntegrationConnectorSchemaInput,
    InspectIntegrationConnectorSchemaOutput,
    ManageIntegrationConnectors,
    TestIntegrationConnectorInput,
    TestIntegrationConnectorOutput,
    UpdateIntegrationConnectorInput,
)
from .integration_credentials import (
    CreateIntegrationCredentialInput,
    ManageIntegrationCredentials,
)
from .integration_flows import (
    FLOW_BLOCK_CATALOG,
    CreateIntegrationFlowInput,
    EvaluateIntegrationFlowReadinessInput,
    FlowBlockExecutionResult,
    IntegrationFlowGraphIssue,
    IntegrationFlowReadinessBlock,
    IntegrationFlowReadinessIssue,
    IntegrationFlowReadinessOutput,
    ManageIntegrationFlows,
    RunIntegrationFlow,
    RunIntegrationFlowInput,
    RunIntegrationFlowOutput,
    RunIntegrationFlowRejected,
    TestFlowBlockInput,
    TestFlowBlockOutput,
    UpdateIntegrationFlowInput,
    ValidateIntegrationFlowGraph,
    ValidateIntegrationFlowGraphInput,
    ValidateIntegrationFlowGraphOutput,
)
from .list_machines import ListMachines
from .list_schedules import ListSchedules
from .list_work_orders import ListWorkOrders
from .list_workspaces import ListWorkspaces
from .planner_readiness import GetPlannerReadiness, PlannerReadinessOutput
from .planning_control import (
    DiscardPlanningCandidateInput,
    GetPlanningStateInput,
    ListPlanningEventsInput,
    PlanningControlPlane,
    PlanningScheduleRef,
    PlanningStateOutput,
    RecordPlanningCandidateInput,
    RecordPlanningPublishInput,
    SelectPlanningBaselineInput,
)
from .publish_scenario import (
    PublishScenario,
    PublishScenarioInput,
    PublishScenarioOutput,
)
from .record_audit_event import record_audit_event
from .replay_schedule_run import (
    ReplayScheduleRun,
    ReplayScheduleRunInput,
    ReplayScheduleRunOutput,
)
from .run_disruption import RunDisruption, RunDisruptionInput, RunDisruptionOutput
from .run_due_integration_automations import (
    DueIntegrationAutomationResult,
    RunDueIntegrationAutomations,
    RunDueIntegrationAutomationsInput,
    RunDueIntegrationAutomationsOutput,
)
from .run_integration_automation import (
    RunIntegrationAutomation,
    RunIntegrationAutomationInput,
    RunIntegrationAutomationOutput,
    RunIntegrationAutomationRejected,
)
from .run_scheduling import RunScheduling, RunSchedulingInput, RunSchedulingOutput
from .run_scheduling_from_snapshot import (
    RunSchedulingFromSnapshot,
    RunSchedulingFromSnapshotInput,
)
from .suggest_operation_slots import (
    SlotMachineRejection,
    SuggestedOperationSlot,
    SuggestOperationSlots,
    SuggestOperationSlotsOutput,
)
from .update_schedule_context import (
    UpdateScheduleContext,
    UpdateScheduleContextInput,
)
from .workspace_access import (
    GrantWorkspaceAccess,
    GrantWorkspaceAccessInput,
    ListAccessibleWorkspaces,
    ListWorkspaceAccessGrants,
    RevokeWorkspaceAccess,
)

__all__ = [
    "CompareStrategies",
    "CompareScenarios",
    "AddMembership",
    "AddMembershipInput",
    "CompareStrategiesInput",
    "CompareStrategiesOutput",
    "CompareScenariosInput",
    "CompareScenariosOutput",
    "CapableToPromise",
    "CapableToPromiseInput",
    "CapableToPromiseOutput",
    "CreateCalendar",
    "CreateCalendarInput",
    "CreateOrganization",
    "CreateOrganizationInput",
    "CreateUserAccount",
    "CreateUserAccountInput",
    "CreateInventoryItem",
    "CreateInventoryItemInput",
    "DashboardOutput",
    "DeleteMachine",
    "DeleteWorkOrder",
    "ExportPlanningSnapshot",
    "ExportPlanningSnapshotInput",
    "ExportPublishedPlan",
    "ExportPublishedPlanInput",
    "ExportPublishedPlanOutput",
    "CreateMachine",
    "CreateMachineInput",
    "CreateResource",
    "CreateResourceInput",
    "CreateSupplyLot",
    "CreateSupplyLotInput",
    "CreateWorkOrder",
    "CreateWorkOrderInput",
    "CreateWorkspace",
    "CreateWorkspaceInput",
    "GetMachine",
    "GetIntegrationAutomationHealth",
    "GetIntegrationAutomationHealthInput",
    "GetIntegrationAutomationHealthOutput",
    "IntegrationAutomationHealthIssue",
    "GetPlannerReadiness",
    "GetScheduleGantt",
    "GetScheduleDashboard",
    "GetScheduleCapacity",
    "GetScheduleRisk",
    "GetWorkOrder",
    "GetWorkspace",
    "ImportPlanningSnapshot",
    "ImportPlanningSnapshotInput",
    "ImportPlanningSnapshotOutput",
    "CreateIntegrationApiClientInput",
    "CreateIntegrationApiClientOutput",
    "CreateIntegrationConnectorInput",
    "CreateIntegrationCredentialInput",
    "CreateIntegrationFlowInput",
    "EvaluateIntegrationFlowReadinessInput",
    "InspectIntegrationConnectorSchemaInput",
    "InspectIntegrationConnectorSchemaOutput",
    "HandleDisruption",
    "HandleDisruptionInput",
    "HandleDisruptionOutput",
    "ListMachines",
    "ListSchedules",
    "ListMemberships",
    "ListOrganizations",
    "ListOrganizationWorkspaces",
    "ListUserAccounts",
    "ListWorkOrders",
    "ListWorkspaces",
    "ManageIntegrationApiClients",
    "ManageIntegrationConnectors",
    "ManageIntegrationCredentials",
    "ManageIntegrationFlows",
    "IntegrationFlowReadinessBlock",
    "IntegrationFlowReadinessIssue",
    "IntegrationFlowReadinessOutput",
    "PublishScenario",
    "PublishScenarioInput",
    "PublishScenarioOutput",
    "PlannerReadinessOutput",
    "record_audit_event",
    "PlanningControlPlane",
    "PlanningScheduleRef",
    "PlanningStateOutput",
    "ReplayScheduleRun",
    "ReplayScheduleRunInput",
    "ReplayScheduleRunOutput",
    "RevokeIntegrationApiClientInput",
    "TestIntegrationConnectorInput",
    "TestIntegrationConnectorOutput",
    "FlowBlockExecutionResult",
    "FLOW_BLOCK_CATALOG",
    "RunDisruption",
    "RunDisruptionInput",
    "RunDisruptionOutput",
    "DueIntegrationAutomationResult",
    "RunDueIntegrationAutomations",
    "RunDueIntegrationAutomationsInput",
    "RunDueIntegrationAutomationsOutput",
    "RunIntegrationAutomation",
    "RunIntegrationAutomationInput",
    "RunIntegrationAutomationOutput",
    "RunIntegrationAutomationRejected",
    "RunIntegrationFlow",
    "RunIntegrationFlowInput",
    "RunIntegrationFlowOutput",
    "RunIntegrationFlowRejected",
    "ValidateIntegrationFlowGraph",
    "ValidateIntegrationFlowGraphInput",
    "ValidateIntegrationFlowGraphOutput",
    "IntegrationFlowGraphIssue",
    "TestFlowBlockInput",
    "TestFlowBlockOutput",
    "RunSchedulingFromSnapshot",
    "RunSchedulingFromSnapshotInput",
    "RunScheduling",
    "RunSchedulingInput",
    "RunSchedulingOutput",
    "ScheduleGanttOutput",
    "ScheduleCapacityOutput",
    "ScheduleRiskAction",
    "ScheduleRiskConstraint",
    "ScheduleRiskMachinePressure",
    "ScheduleRiskOperation",
    "ScheduleRiskOutput",
    "ScheduleRiskWorkOrder",
    "DiscardPlanningCandidateInput",
    "GetPlanningStateInput",
    "ListPlanningEventsInput",
    "RecordPlanningCandidateInput",
    "RecordPlanningPublishInput",
    "SelectPlanningBaselineInput",
    "SlotMachineRejection",
    "StrategyComparison",
    "SuggestedOperationSlot",
    "SuggestOperationSlots",
    "SuggestOperationSlotsOutput",
    "UpdateIntegrationConnectorInput",
    "UpdateIntegrationFlowInput",
    "UpdateScheduleContext",
    "UpdateScheduleContextInput",
    "GrantWorkspaceAccess",
    "GrantWorkspaceAccessInput",
    "ListAccessibleWorkspaces",
    "ListWorkspaceAccessGrants",
    "RevokeWorkspaceAccess",
]
