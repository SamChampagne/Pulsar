"""Use cases for reusable integration credentials."""

from __future__ import annotations

from dataclasses import dataclass
from uuid import uuid4

from ...domain.errors import ValidationError
from ..ports import IntegrationCredential, IntegrationCredentialRepository

VALID_INTEGRATION_CREDENTIAL_AUTH_TYPES = {"bearer", "api_key_header", "basic"}


@dataclass(frozen=True, slots=True)
class CreateIntegrationCredentialInput:
    name: str
    source_system: str
    auth_type: str
    organization_id: str | None = None
    workspace_id: str | None = None
    auth_header_name: str | None = None
    username: str | None = None
    secret_ref: str | None = None
    secret_value: str | None = None
    is_enabled: bool = True
    created_by_user_id: str | None = None


class ManageIntegrationCredentials:
    def __init__(
        self,
        credentials: IntegrationCredentialRepository,
        *,
        secret_resolver,
    ) -> None:
        self._credentials = credentials
        self._secret_resolver = secret_resolver

    def create(self, command: CreateIntegrationCredentialInput) -> IntegrationCredential:
        secret_ref = command.secret_ref.strip() if command.secret_ref else None
        secret_value = command.secret_value.strip() if command.secret_value else None
        if secret_ref and secret_value:
            raise ValidationError(
                "Choose either a server secret reference or a credential value stored in the app."
            )
        if secret_value:
            secret_ref = self._secret_resolver.seal(secret_value)
        credential = validate_integration_credential(
            IntegrationCredential(
                id=f"icr-{uuid4().hex[:12]}",
                name=command.name.strip(),
                source_system=command.source_system.strip(),
                auth_type=command.auth_type,
                organization_id=command.organization_id,
                workspace_id=command.workspace_id,
                auth_header_name=command.auth_header_name.strip()
                if command.auth_header_name
                else None,
                username=command.username.strip() if command.username else None,
                secret_ref=secret_ref,
                is_enabled=command.is_enabled,
                created_by_user_id=command.created_by_user_id,
            )
        )
        return self._credentials.save(credential)

    def get(
        self,
        credential_id: str,
        *,
        organization_id: str | None = None,
    ) -> IntegrationCredential | None:
        credential = self._credentials.get(
            credential_id,
            organization_id=organization_id,
        )
        return validate_integration_credential(credential) if credential is not None else None

    def list_for_scope(
        self,
        *,
        organization_id: str | None = None,
        workspace_id: str | None = None,
        limit: int = 50,
    ) -> list[IntegrationCredential]:
        limit = max(1, min(limit, 200))
        return [
            validate_integration_credential(credential)
            for credential in self._credentials.list_for_scope(
                organization_id=organization_id,
                workspace_id=workspace_id,
                limit=limit,
            )
        ]


def validate_integration_credential(
    credential: IntegrationCredential,
) -> IntegrationCredential:
    credential.name = credential.name.strip()
    credential.source_system = credential.source_system.strip()
    credential.auth_type = credential.auth_type.strip().lower()
    if not credential.name:
        raise ValidationError("Integration credential name is required.")
    if not credential.source_system:
        raise ValidationError("Integration credential source_system is required.")
    if credential.auth_type not in VALID_INTEGRATION_CREDENTIAL_AUTH_TYPES:
        allowed = ", ".join(sorted(VALID_INTEGRATION_CREDENTIAL_AUTH_TYPES))
        raise ValidationError(
            f"Unsupported integration credential auth_type {credential.auth_type!r}. "
            f"Allowed auth types: {allowed}."
        )
    if not credential.secret_ref:
        raise ValidationError(
            f"Integration credential auth_type {credential.auth_type!r} requires secret_ref."
        )
    if not (
        credential.secret_ref.startswith("env:")
        or credential.secret_ref.startswith("sealed:")
    ):
        raise ValidationError(
            "Integration credential secret_ref must use env:NAME or a stored app secret."
        )
    if credential.auth_type == "api_key_header" and not credential.auth_header_name:
        raise ValidationError(
            "Integration credential api_key_header auth requires auth_header_name."
        )
    if credential.auth_type == "basic" and not credential.username:
        raise ValidationError(
            "Integration credential basic auth requires username."
        )
    return credential


def apply_integration_credential(
    *,
    connector,
    credential: IntegrationCredential,
):
    credential = validate_integration_credential(credential)
    from ..ports import IntegrationConnector

    return IntegrationConnector(
        id=connector.id,
        name=connector.name,
        endpoint_url=connector.endpoint_url,
        source_system=connector.source_system,
        organization_id=connector.organization_id,
        workspace_id=connector.workspace_id,
        connector_type=connector.connector_type,
        method=connector.method,
        auth_type=credential.auth_type,
        auth_header_name=credential.auth_header_name,
        username=credential.username,
        secret_ref=credential.secret_ref,
        credential_id=credential.id,
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
