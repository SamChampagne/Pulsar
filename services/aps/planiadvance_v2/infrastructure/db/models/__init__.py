"""SQLAlchemy ORM models.

Each model corresponds to a physical table. Models are kept **separate
from domain entities** — repositories handle the translation. This
separation is what lets us change the DB schema without touching the
domain layer.
"""

from .account_model import (
    MembershipModel,
    OrganizationModel,
    UserAccountModel,
    WorkspaceAccessGrantModel,
)
from .audit_event_model import AuditEventModel
from .calendar_model import CalendarModel, ShiftModel
from .flow_run_trace_model import FlowRunTraceModel
from .integration_api_client_model import IntegrationApiClientModel
from .integration_automation_model import IntegrationAutomationJobModel
from .integration_binding_model import IntegrationBindingModel
from .integration_connector_model import IntegrationConnectorModel
from .integration_credential_model import IntegrationCredentialModel
from .integration_execution_model import IntegrationExecutionModel
from .integration_flow_model import IntegrationFlowModel
from .integration_journal_model import IntegrationJournalModel
from .inventory_item_model import InventoryItemModel
from .machine_model import MachineModel
from .operation_model import (
    OperationDependencyModel,
    OperationEligibleMachineModel,
    OperationModel,
    OperationResourceRequirementModel,
    OperationRoutingAlternativeModel,
)
from .planning_control_model import PlanningEventModel, PlanningWorkspaceStateModel
from .resource_model import ResourceModel
from .revoked_auth_token_model import RevokedAuthTokenModel
from .schedule_model import ScheduledOperationModel, ScheduleModel
from .supply_lot_model import SupplyLotModel
from .user_session_revocation_model import UserSessionRevocationModel
from .webhook_event_dedup_model import WebhookEventDedupModel
from .work_order_model import WorkOrderModel
from .workspace_model import WorkspaceModel

__all__ = [
    "AuditEventModel",
    "CalendarModel",
    "FlowRunTraceModel",
    "IntegrationApiClientModel",
    "IntegrationAutomationJobModel",
    "IntegrationConnectorModel",
    "IntegrationCredentialModel",
    "IntegrationExecutionModel",
    "IntegrationBindingModel",
    "IntegrationFlowModel",
    "IntegrationJournalModel",
    "InventoryItemModel",
    "MachineModel",
    "MembershipModel",
    "OperationDependencyModel",
    "OperationEligibleMachineModel",
    "OperationModel",
    "OperationResourceRequirementModel",
    "OperationRoutingAlternativeModel",
    "OrganizationModel",
    "PlanningEventModel",
    "PlanningWorkspaceStateModel",
    "ResourceModel",
    "RevokedAuthTokenModel",
    "ScheduleModel",
    "ScheduledOperationModel",
    "ShiftModel",
    "SupplyLotModel",
    "UserAccountModel",
    "UserSessionRevocationModel",
    "WebhookEventDedupModel",
    "WorkspaceAccessGrantModel",
    "WorkspaceModel",
    "WorkOrderModel",
]
