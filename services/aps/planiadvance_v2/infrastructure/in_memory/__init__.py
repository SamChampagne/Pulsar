"""In-memory repository implementations.

Used by unit tests and the CLI ``--demo`` mode. Kept in infrastructure
(not in application/) because they are concrete adapters, not domain logic.
"""

from .repositories import (
    InMemoryAuditEventRepository,
    InMemoryCalendarRepository,
    InMemoryIntegrationApiClientRepository,
    InMemoryIntegrationAutomationRepository,
    InMemoryIntegrationBindingRepository,
    InMemoryIntegrationConnectorRepository,
    InMemoryIntegrationExecutionRepository,
    InMemoryIntegrationFlowRepository,
    InMemoryIntegrationJournalRepository,
    InMemoryInventoryRepository,
    InMemoryMachineRepository,
    InMemoryPlanningControlRepository,
    InMemoryResourceRepository,
    InMemoryScheduleRepository,
    InMemorySupplyRepository,
    InMemoryWorkOrderRepository,
    InMemoryWorkspaceAccessGrantRepository,
    InMemoryWorkspaceRepository,
)

__all__ = [
    "InMemoryAuditEventRepository",
    "InMemoryCalendarRepository",
    "InMemoryIntegrationApiClientRepository",
    "InMemoryIntegrationAutomationRepository",
    "InMemoryIntegrationConnectorRepository",
    "InMemoryIntegrationExecutionRepository",
    "InMemoryIntegrationBindingRepository",
    "InMemoryIntegrationFlowRepository",
    "InMemoryIntegrationJournalRepository",
    "InMemoryInventoryRepository",
    "InMemoryMachineRepository",
    "InMemoryPlanningControlRepository",
    "InMemoryResourceRepository",
    "InMemoryScheduleRepository",
    "InMemorySupplyRepository",
    "InMemoryWorkOrderRepository",
    "InMemoryWorkspaceAccessGrantRepository",
    "InMemoryWorkspaceRepository",
]
