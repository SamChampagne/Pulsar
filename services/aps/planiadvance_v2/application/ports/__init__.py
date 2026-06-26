"""Repository ports (abstract interfaces).

Adapters in the ``infrastructure`` layer implement these protocols.
Defining them here (not in infrastructure) keeps the dependency arrow
pointing from infrastructure → application, not the other way around.
"""

from .account_repository import (
    MembershipRepository,
    OrganizationRepository,
    UserAccountRepository,
)
from .audit_event_repository import AuditEvent, AuditEventRepository
from .calendar_repository import CalendarRepository
from .flow_run_trace_repository import FlowRunTrace, FlowRunTraceRepository
from .integration_api_client_repository import (
    IntegrationApiClient,
    IntegrationApiClientRepository,
)
from .integration_automation_repository import (
    IntegrationAutomationJob,
    IntegrationAutomationRepository,
)
from .integration_binding_repository import (
    IntegrationBinding,
    IntegrationBindingRepository,
)
from .integration_connector_repository import (
    IntegrationConnector,
    IntegrationConnectorRepository,
)
from .integration_credential_repository import (
    IntegrationCredential,
    IntegrationCredentialRepository,
)
from .integration_database_transport import (
    IntegrationDatabaseColumnSchema,
    IntegrationDatabaseSchemaRequest,
    IntegrationDatabaseSchemaResult,
    IntegrationDatabaseTableSchema,
    IntegrationDatabaseTestRequest,
    IntegrationDatabaseTestResult,
    IntegrationDatabaseTransport,
    IntegrationDatabaseWriteRequest,
    IntegrationDatabaseWriteResult,
)
from .integration_execution_repository import (
    IntegrationExecutionRecord,
    IntegrationExecutionRepository,
)
from .integration_flow_repository import (
    FlowBlockInput,
    IntegrationFlow,
    IntegrationFlowBlock,
    IntegrationFlowRepository,
)
from .integration_http_transport import (
    IntegrationHttpRequest,
    IntegrationHttpResponse,
    IntegrationHttpTransport,
)
from .integration_journal_repository import (
    IntegrationJournalEntry,
    IntegrationJournalRepository,
)
from .integration_secret_resolver import IntegrationSecretResolver
from .integration_sftp_transport import (
    IntegrationSftpPutRequest,
    IntegrationSftpPutResult,
    IntegrationSftpTestRequest,
    IntegrationSftpTestResult,
    IntegrationSftpTransport,
)
from .inventory_repository import InventoryRepository
from .machine_repository import MachineRepository
from .pdf_renderer import PdfRenderer, PdfRenderError
from .planning_control_repository import (
    PlanningControlRepository,
    PlanningEvent,
    PlanningWorkspaceState,
)
from .resource_repository import ResourceRepository
from .revoked_auth_token_repository import RevokedAuthTokenRepository
from .schedule_repository import ScheduleRepository, ScheduleRunMetadata
from .supply_repository import SupplyRepository
from .user_session_revocation_repository import UserSessionRevocationRepository
from .webhook_event_dedup_repository import (
    WebhookEventDedupRepository,
    WebhookEventRecord,
)
from .work_order_repository import WorkOrderRepository
from .workspace_access_grant_repository import WorkspaceAccessGrantRepository
from .workspace_repository import WorkspaceRepository

__all__ = [
    "AuditEvent",
    "AuditEventRepository",
    "CalendarRepository",
    "FlowRunTrace",
    "FlowRunTraceRepository",
    "IntegrationAutomationJob",
    "IntegrationAutomationRepository",
    "IntegrationApiClient",
    "IntegrationApiClientRepository",
    "IntegrationConnector",
    "IntegrationConnectorRepository",
    "IntegrationDatabaseColumnSchema",
    "IntegrationDatabaseSchemaRequest",
    "IntegrationDatabaseSchemaResult",
    "IntegrationDatabaseTableSchema",
    "IntegrationDatabaseTestRequest",
    "IntegrationDatabaseTestResult",
    "IntegrationDatabaseTransport",
    "IntegrationDatabaseWriteRequest",
    "IntegrationDatabaseWriteResult",
    "IntegrationCredential",
    "IntegrationCredentialRepository",
    "IntegrationExecutionRecord",
    "IntegrationExecutionRepository",
    "FlowBlockInput",
    "IntegrationFlow",
    "IntegrationFlowBlock",
    "IntegrationFlowRepository",
    "IntegrationHttpRequest",
    "IntegrationHttpResponse",
    "IntegrationHttpTransport",
    "IntegrationSftpPutRequest",
    "IntegrationSftpPutResult",
    "IntegrationSftpTestRequest",
    "IntegrationSftpTestResult",
    "IntegrationSftpTransport",
    "MembershipRepository",
    "OrganizationRepository",
    "IntegrationBinding",
    "IntegrationBindingRepository",
    "IntegrationJournalEntry",
    "IntegrationJournalRepository",
    "IntegrationSecretResolver",
    "InventoryRepository",
    "MachineRepository",
    "PdfRenderError",
    "PdfRenderer",
    "PlanningControlRepository",
    "PlanningEvent",
    "PlanningWorkspaceState",
    "ResourceRepository",
    "RevokedAuthTokenRepository",
    "ScheduleRepository",
    "ScheduleRunMetadata",
    "SupplyRepository",
    "UserAccountRepository",
    "UserSessionRevocationRepository",
    "WebhookEventDedupRepository",
    "WebhookEventRecord",
    "WorkspaceRepository",
    "WorkspaceAccessGrantRepository",
    "WorkOrderRepository",
]
