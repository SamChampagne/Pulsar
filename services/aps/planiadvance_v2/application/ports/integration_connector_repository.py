"""Port: persisted external integration connectors.

Connectors represent reusable ERP/MES/webhook endpoints and authentication
metadata. Automations can reference a connector instead of carrying transport
details inline in each job config.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Protocol


@dataclass(slots=True)
class IntegrationConnector:
    id: str
    name: str
    endpoint_url: str
    source_system: str
    organization_id: str | None = None
    workspace_id: str | None = None
    connector_type: str = "http"
    method: str = "POST"
    auth_type: str = "none"
    auth_header_name: str | None = None
    username: str | None = None
    secret_ref: str | None = None
    credential_id: str | None = None
    static_headers: dict[str, str] = field(default_factory=dict)
    timeout_seconds: int = 30
    is_enabled: bool = True
    created_by_user_id: str | None = None
    last_tested_at: datetime | None = None
    last_test_status: str | None = None
    last_test_message: str | None = None
    created_at: datetime = field(default_factory=datetime.utcnow)
    updated_at: datetime = field(default_factory=datetime.utcnow)


class IntegrationConnectorRepository(Protocol):
    def save(self, connector: IntegrationConnector) -> IntegrationConnector: ...

    def get(
        self,
        connector_id: str,
        *,
        organization_id: str | None = None,
    ) -> IntegrationConnector | None: ...

    def list_for_scope(
        self,
        *,
        organization_id: str | None = None,
        workspace_id: str | None = None,
        limit: int = 50,
    ) -> list[IntegrationConnector]: ...

    def delete(
        self,
        connector_id: str,
        *,
        organization_id: str | None = None,
    ) -> bool: ...
