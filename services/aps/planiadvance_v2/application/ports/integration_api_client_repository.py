"""Port: tenant-scoped integration API clients.

Environment API keys are useful for self-hosted bootstrap. Persisted API
clients are the commercial contract: one generated secret per external
system, stored only as a hash, scoped to a tenant/workspace and revocable.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Protocol


@dataclass(slots=True)
class IntegrationApiClient:
    id: str
    name: str
    key_prefix: str
    key_hash: str
    scopes: tuple[str, ...]
    organization_id: str | None = None
    workspace_id: str | None = None
    source_system: str | None = None
    is_active: bool = True
    created_by_user_id: str | None = None
    expires_at: datetime | None = None
    last_used_at: datetime | None = None
    created_at: datetime = field(default_factory=datetime.utcnow)
    updated_at: datetime = field(default_factory=datetime.utcnow)


class IntegrationApiClientRepository(Protocol):
    def save(self, client: IntegrationApiClient) -> IntegrationApiClient: ...

    def get(
        self,
        client_id: str,
        *,
        organization_id: str | None = None,
    ) -> IntegrationApiClient | None: ...

    def find_active_by_key_hash(
        self,
        key_hash: str,
        *,
        now: datetime,
    ) -> IntegrationApiClient | None: ...

    def has_active_clients(
        self,
        *,
        now: datetime,
    ) -> bool: ...

    def has_clients(self) -> bool: ...

    def list_for_scope(
        self,
        *,
        organization_id: str | None = None,
        workspace_id: str | None = None,
        limit: int = 50,
    ) -> list[IntegrationApiClient]: ...

    def mark_used(
        self,
        client_id: str,
        *,
        used_at: datetime,
    ) -> IntegrationApiClient | None: ...
