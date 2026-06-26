"""Port: persisted reusable integration credentials.

Credentials hold reusable auth metadata separately from saved HTTP profiles so
flows can call a direct URL while still reusing the same secret material.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Protocol


@dataclass(slots=True)
class IntegrationCredential:
    id: str
    name: str
    source_system: str
    auth_type: str
    organization_id: str | None = None
    workspace_id: str | None = None
    auth_header_name: str | None = None
    username: str | None = None
    secret_ref: str | None = None
    is_enabled: bool = True
    created_by_user_id: str | None = None
    created_at: datetime = field(default_factory=datetime.utcnow)
    updated_at: datetime = field(default_factory=datetime.utcnow)


class IntegrationCredentialRepository(Protocol):
    def save(self, credential: IntegrationCredential) -> IntegrationCredential: ...

    def get(
        self,
        credential_id: str,
        *,
        organization_id: str | None = None,
    ) -> IntegrationCredential | None: ...

    def list_for_scope(
        self,
        *,
        organization_id: str | None = None,
        workspace_id: str | None = None,
        limit: int = 50,
    ) -> list[IntegrationCredential]: ...
