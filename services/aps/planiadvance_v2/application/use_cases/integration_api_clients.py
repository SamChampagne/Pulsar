"""Use cases for commercial integration API clients."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from hashlib import sha256
from secrets import token_urlsafe
from uuid import uuid4

from ...domain.errors import ValidationError
from ..ports import IntegrationApiClient, IntegrationApiClientRepository

VALID_INTEGRATION_API_SCOPES = {"read", "write", "run", "full"}


@dataclass(frozen=True, slots=True)
class CreateIntegrationApiClientInput:
    name: str
    scopes: tuple[str, ...] = ("read",)
    organization_id: str | None = None
    workspace_id: str | None = None
    source_system: str | None = None
    created_by_user_id: str | None = None
    expires_at: datetime | None = None


@dataclass(frozen=True, slots=True)
class CreateIntegrationApiClientOutput:
    client: IntegrationApiClient
    api_key: str


@dataclass(frozen=True, slots=True)
class RevokeIntegrationApiClientInput:
    client_id: str
    organization_id: str | None = None


class ManageIntegrationApiClients:
    """Create, list and revoke integration clients.

    Secrets are returned exactly once at creation time. Repositories store only
    the SHA-256 hash and a short non-secret prefix for support/debugging.
    """

    def __init__(self, clients: IntegrationApiClientRepository) -> None:
        self._clients = clients

    def create(
        self,
        command: CreateIntegrationApiClientInput,
    ) -> CreateIntegrationApiClientOutput:
        name = command.name.strip()
        if not name:
            raise ValidationError("Integration API client name is required.")
        scopes = _normalize_scopes(command.scopes)
        client_id = f"iac-{uuid4().hex[:12]}"
        secret = token_urlsafe(32)
        api_key = f"paic_{client_id}_{secret}"
        key_prefix = api_key[:18]
        now = datetime.utcnow()
        client = self._clients.save(
            IntegrationApiClient(
                id=client_id,
                name=name,
                key_prefix=key_prefix,
                key_hash=hash_integration_api_key(api_key),
                scopes=scopes,
                organization_id=command.organization_id,
                workspace_id=command.workspace_id,
                source_system=command.source_system,
                is_active=True,
                created_by_user_id=command.created_by_user_id,
                expires_at=command.expires_at,
                created_at=now,
                updated_at=now,
            )
        )
        return CreateIntegrationApiClientOutput(client=client, api_key=api_key)

    def list_for_scope(
        self,
        *,
        organization_id: str | None = None,
        workspace_id: str | None = None,
        limit: int = 50,
    ) -> list[IntegrationApiClient]:
        limit = max(1, min(limit, 200))
        return self._clients.list_for_scope(
            organization_id=organization_id,
            workspace_id=workspace_id,
            limit=limit,
        )

    def revoke(
        self,
        command: RevokeIntegrationApiClientInput,
    ) -> IntegrationApiClient:
        client = self._clients.get(
            command.client_id,
            organization_id=command.organization_id,
        )
        if client is None:
            raise ValidationError(
                f"Integration API client {command.client_id!r} not found"
            )
        client.is_active = False
        client.updated_at = datetime.utcnow()
        return self._clients.save(client)


def hash_integration_api_key(api_key: str) -> str:
    return sha256(api_key.encode("utf-8")).hexdigest()


def _normalize_scopes(scopes: tuple[str, ...]) -> tuple[str, ...]:
    normalized = tuple(dict.fromkeys(scope.strip().lower() for scope in scopes if scope))
    if not normalized:
        raise ValidationError("At least one integration API client scope is required.")
    unknown = sorted(set(normalized) - VALID_INTEGRATION_API_SCOPES)
    if unknown:
        allowed = ", ".join(sorted(VALID_INTEGRATION_API_SCOPES))
        raise ValidationError(
            f"Unsupported integration API client scope(s): {', '.join(unknown)}. "
            f"Allowed scopes: {allowed}."
        )
    return ("full",) if "full" in normalized else normalized
