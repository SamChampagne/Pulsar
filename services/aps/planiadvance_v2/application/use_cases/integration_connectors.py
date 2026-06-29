"""Use cases for reusable external integration connectors."""

from __future__ import annotations

import posixpath
from dataclasses import dataclass, field
from datetime import datetime
from urllib.parse import urlparse
from uuid import uuid4

from sqlalchemy.engine import make_url

from ...domain.errors import ValidationError
from ..ports import (
    IntegrationConnector,
    IntegrationConnectorRepository,
    IntegrationCredentialRepository,
    IntegrationDatabaseSchemaRequest,
    IntegrationDatabaseTableSchema,
    IntegrationDatabaseTestRequest,
    IntegrationDatabaseTransport,
    IntegrationDatabaseWriteRequest,
    IntegrationExecutionRepository,
    IntegrationHttpRequest,
    IntegrationHttpTransport,
    IntegrationSecretResolver,
    IntegrationSftpPutRequest,
    IntegrationSftpTestRequest,
    IntegrationSftpTransport,
)
from .integration_credentials import (
    apply_integration_credential,
    validate_integration_credential,
)
from .integration_execution_support import save_integration_execution

VALID_CONNECTOR_TYPES = {"database", "http", "odoo", "sftp"}
VALID_CONNECTOR_METHODS = {"GET", "POST", "PUT", "PATCH"}
VALID_CONNECTOR_AUTH_TYPES = {"none", "bearer", "api_key_header", "basic"}
VALID_DATABASE_AUTH_TYPES = {"basic", "none"}
VALID_SFTP_AUTH_TYPES = {"basic"}
VALID_ODOO_AUTH_TYPES = {"basic"}


@dataclass(frozen=True, slots=True)
class CreateIntegrationConnectorInput:
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
    secret_value: str | None = None
    credential_id: str | None = None
    static_headers: dict[str, str] | None = None
    timeout_seconds: int = 30
    is_enabled: bool = True
    created_by_user_id: str | None = None


_UNSET: object = object()


@dataclass(frozen=True, slots=True)
class UpdateIntegrationConnectorInput:
    """Partial-update payload for an existing connector.

    Any field left as the sentinel _UNSET is preserved from the stored
    record. Pass `secret_value` to re-seal a new secret; pass `secret_ref`
    explicitly (including None) to swap or detach the reference.

    `connector_type`, `organization_id` and `workspace_id` are intentionally
    not mutable — they form the connector's identity from the caller's
    perspective and changing them would orphan the blocks that reference it.
    """

    connector_id: str
    organization_id: str | None = None
    name: object = _UNSET
    endpoint_url: object = _UNSET
    source_system: object = _UNSET
    method: object = _UNSET
    auth_type: object = _UNSET
    auth_header_name: object = _UNSET
    username: object = _UNSET
    secret_ref: object = _UNSET
    secret_value: object = _UNSET
    credential_id: object = _UNSET
    static_headers: object = _UNSET
    timeout_seconds: object = _UNSET
    is_enabled: object = _UNSET


@dataclass(frozen=True, slots=True)
class TestIntegrationConnectorInput:
    connector_id: str
    organization_id: str | None = None
    workspace_id: str | None = None
    actor_details: dict[str, object] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class TestIntegrationConnectorOutput:
    connector: IntegrationConnector
    status_code: int
    ok: bool
    message: str
    response_preview: str


@dataclass(frozen=True, slots=True)
class InspectIntegrationConnectorSchemaInput:
    connector_id: str
    organization_id: str | None = None
    workspace_id: str | None = None


@dataclass(frozen=True, slots=True)
class InspectIntegrationConnectorSchemaOutput:
    connector: IntegrationConnector
    dialect: str | None = None
    database: str | None = None
    tables: tuple[IntegrationDatabaseTableSchema, ...] = ()


class ManageIntegrationConnectors:
    def __init__(
        self,
        connectors: IntegrationConnectorRepository,
        *,
        http_transport: IntegrationHttpTransport,
        database_transport: IntegrationDatabaseTransport | None = None,
        sftp_transport: IntegrationSftpTransport | None = None,
        secret_resolver: IntegrationSecretResolver,
        credentials: IntegrationCredentialRepository | None = None,
        executions: IntegrationExecutionRepository | None = None,
    ) -> None:
        self._connectors = connectors
        self._http_transport = http_transport
        self._database_transport = database_transport
        self._sftp_transport = sftp_transport
        self._secret_resolver = secret_resolver
        self._credentials = credentials
        self._executions = executions

    def create(
        self,
        command: CreateIntegrationConnectorInput,
    ) -> IntegrationConnector:
        secret_ref = command.secret_ref.strip() if command.secret_ref else None
        secret_value = command.secret_value.strip() if command.secret_value else None
        credential_id = command.credential_id.strip() if command.credential_id else None
        if secret_ref and secret_value:
            raise ValidationError(
                "Choose either a server secret reference or a credential value stored in the app."
            )
        if credential_id and secret_value:
            raise ValidationError(
                "Choose either a saved credential or paste a secret directly in the connector."
            )
        if credential_id and secret_ref:
            raise ValidationError(
                "Choose either a saved credential or a server secret reference in the connector."
            )
        if command.auth_type.strip().lower() != "none" and secret_value:
            secret_ref = self._secret_resolver.seal(secret_value)
        if credential_id:
            if self._credentials is None:
                raise ValidationError("Saved credentials are not available for connectors.")
            credential = self._credentials.get(
                credential_id,
                organization_id=command.organization_id,
            )
            if credential is None:
                raise ValidationError(
                    f"Integration credential {credential_id!r} not found"
                )
            credential = validate_integration_credential(credential)
            if command.connector_type.strip().lower() != "http":
                raise ValidationError(
                    "Saved credentials are currently supported only for HTTP API profiles."
                )
        connector = _validated_connector(
            IntegrationConnector(
                id=f"icn-{uuid4().hex[:12]}",
                name=command.name.strip(),
                endpoint_url=command.endpoint_url.strip(),
                source_system=command.source_system.strip(),
                organization_id=command.organization_id,
                workspace_id=command.workspace_id,
                connector_type=command.connector_type,
                method=command.method,
                auth_type="none" if credential_id else command.auth_type,
                auth_header_name=(
                    None
                    if credential_id
                    else command.auth_header_name.strip()
                    if command.auth_header_name
                    else None
                ),
                username=None if credential_id else command.username.strip() if command.username else None,
                secret_ref=None if credential_id else secret_ref,
                credential_id=credential_id,
                static_headers=dict(command.static_headers or {}),
                timeout_seconds=command.timeout_seconds,
                is_enabled=command.is_enabled,
                created_by_user_id=command.created_by_user_id,
            )
        )
        return self._connectors.save(connector)

    def list_for_scope(
        self,
        *,
        organization_id: str | None = None,
        workspace_id: str | None = None,
        limit: int = 50,
    ) -> list[IntegrationConnector]:
        limit = max(1, min(limit, 200))
        return self._connectors.list_for_scope(
            organization_id=organization_id,
            workspace_id=workspace_id,
            limit=limit,
        )

    def update(
        self,
        command: UpdateIntegrationConnectorInput,
    ) -> IntegrationConnector:
        existing = self._connectors.get(
            command.connector_id,
            organization_id=command.organization_id,
        )
        if existing is None:
            raise ValidationError(
                f"Integration connector {command.connector_id!r} not found"
            )

        def _pick(value: object, fallback: object) -> object:
            return fallback if value is _UNSET else value

        name = str(_pick(command.name, existing.name)).strip()
        endpoint_url = str(_pick(command.endpoint_url, existing.endpoint_url)).strip()
        source_system = str(_pick(command.source_system, existing.source_system)).strip()
        method = str(_pick(command.method, existing.method))
        auth_type = str(_pick(command.auth_type, existing.auth_type))
        auth_header_raw = _pick(command.auth_header_name, existing.auth_header_name)
        auth_header_name = (
            auth_header_raw.strip() if isinstance(auth_header_raw, str) and auth_header_raw.strip() else None
        )
        username_raw = _pick(command.username, existing.username)
        username = (
            username_raw.strip() if isinstance(username_raw, str) and username_raw.strip() else None
        )
        credential_id_raw = _pick(command.credential_id, existing.credential_id)
        credential_id = (
            credential_id_raw.strip()
            if isinstance(credential_id_raw, str) and credential_id_raw.strip()
            else None
        )

        # Secret resolution mirrors create() but adds a precedence rule so
        # partial updates behave intuitively: a fresh secret_value replaces
        # the stored secret_ref (re-seal), a fresh secret_ref overrides it
        # as-is, and silence preserves whatever was stored.
        secret_value_provided = command.secret_value is not _UNSET
        secret_ref_provided = command.secret_ref is not _UNSET
        secret_value = (
            command.secret_value.strip()
            if secret_value_provided and isinstance(command.secret_value, str) and command.secret_value.strip()
            else None
        )
        if secret_value_provided:
            secret_ref = None
        elif secret_ref_provided:
            secret_ref_raw = command.secret_ref
            secret_ref = (
                secret_ref_raw.strip()
                if isinstance(secret_ref_raw, str) and secret_ref_raw.strip()
                else None
            )
        else:
            secret_ref = existing.secret_ref

        if credential_id and secret_value:
            raise ValidationError(
                "Choose either a saved credential or paste a secret directly in the connector."
            )
        if credential_id and secret_ref:
            raise ValidationError(
                "Choose either a saved credential or a server secret reference in the connector."
            )
        if auth_type.strip().lower() != "none" and secret_value:
            secret_ref = self._secret_resolver.seal(secret_value)

        if credential_id:
            if self._credentials is None:
                raise ValidationError("Saved credentials are not available for connectors.")
            credential = self._credentials.get(
                credential_id,
                organization_id=existing.organization_id,
            )
            if credential is None:
                raise ValidationError(
                    f"Integration credential {credential_id!r} not found"
                )
            credential = validate_integration_credential(credential)
            if existing.connector_type.strip().lower() != "http":
                raise ValidationError(
                    "Saved credentials are currently supported only for HTTP API profiles."
                )

        static_headers_raw = _pick(command.static_headers, existing.static_headers)
        static_headers = dict(static_headers_raw or {})
        timeout_seconds = int(_pick(command.timeout_seconds, existing.timeout_seconds))
        is_enabled_raw = _pick(command.is_enabled, existing.is_enabled)
        is_enabled = bool(is_enabled_raw)

        updated = _validated_connector(
            IntegrationConnector(
                id=existing.id,
                name=name,
                endpoint_url=endpoint_url,
                source_system=source_system,
                organization_id=existing.organization_id,
                workspace_id=existing.workspace_id,
                connector_type=existing.connector_type,
                method=method,
                auth_type="none" if credential_id else auth_type,
                auth_header_name=None if credential_id else auth_header_name,
                username=None if credential_id else username,
                secret_ref=None if credential_id else secret_ref,
                credential_id=credential_id,
                static_headers=static_headers,
                timeout_seconds=timeout_seconds,
                is_enabled=is_enabled,
                created_by_user_id=existing.created_by_user_id,
                last_tested_at=existing.last_tested_at,
                last_test_status=existing.last_test_status,
                last_test_message=existing.last_test_message,
                created_at=existing.created_at,
            )
        )
        return self._connectors.save(updated)

    def delete(
        self,
        connector_id: str,
        *,
        organization_id: str | None = None,
    ) -> None:
        existed = self._connectors.delete(
            connector_id,
            organization_id=organization_id,
        )
        if not existed:
            raise ValidationError(
                f"Integration connector {connector_id!r} not found"
            )

    def test(
        self,
        command: TestIntegrationConnectorInput,
    ) -> TestIntegrationConnectorOutput:
        connector = self._connectors.get(
            command.connector_id,
            organization_id=command.organization_id,
        )
        if connector is None:
            raise ValidationError(
                f"Integration connector {command.connector_id!r} not found"
        )
        connector = _validated_connector(connector)
        started_at = datetime.utcnow()
        if (
            command.workspace_id is not None
            and connector.workspace_id is not None
            and connector.workspace_id != command.workspace_id
        ):
            raise ValidationError(
                "Integration connector workspace does not match the active workspace."
            )
        if connector.connector_type == "database":
            return self._test_database_connector(
                connector,
                command=command,
                started_at=started_at,
            )
        if connector.connector_type == "sftp":
            return self._test_sftp_connector(
                connector,
                command=command,
                started_at=started_at,
            )
        connector_for_request = self._resolve_connector_for_http_request(
            connector,
            organization_id=command.organization_id,
        )
        request = _build_test_request(
            connector_for_request,
            secret_resolver=self._secret_resolver,
        )
        try:
            response = self._http_transport.send(request)
            preview = response.body.decode("utf-8", errors="replace")[:500]
            ok = 200 <= response.status_code < 300
            message = f"Connector responded with HTTP {response.status_code}."
            error_code = None if ok else f"http_{response.status_code}"
        except Exception as exc:
            now = datetime.utcnow()
            message = f"Connector test failed: {exc}"
            connector.last_tested_at = now
            connector.last_test_status = "failed"
            connector.last_test_message = message
            connector.updated_at = now
            connector = self._connectors.save(connector)
            save_integration_execution(
                self._executions,
                execution_kind="connector_test",
                target_type="connector",
                target_id=connector.id,
                target_name=connector.name,
                source_system=connector.source_system,
                status="failed",
                valid=False,
                organization_id=connector.organization_id or command.organization_id,
                workspace_id=connector.workspace_id or command.workspace_id,
                trigger_type="manual_test",
                message=message,
                error_code=exc.__class__.__name__.lower()[:64],
                details={
                    "endpoint_url": connector.endpoint_url,
                    "http_method": connector.method,
                    "auth_type": connector_for_request.auth_type,
                    "credential_id": connector.credential_id,
                },
                started_at=started_at,
                finished_at=now,
                actor_details=command.actor_details,
            )
            raise
        now = datetime.utcnow()
        connector.last_tested_at = now
        connector.last_test_status = "ok" if ok else "failed"
        connector.last_test_message = message
        connector.updated_at = now
        connector = self._connectors.save(connector)
        save_integration_execution(
            self._executions,
            execution_kind="connector_test",
            target_type="connector",
            target_id=connector.id,
            target_name=connector.name,
            source_system=connector.source_system,
            status=connector.last_test_status or "failed",
            valid=ok,
            organization_id=connector.organization_id or command.organization_id,
            workspace_id=connector.workspace_id or command.workspace_id,
            trigger_type="manual_test",
            message=message,
            error_code=error_code,
            details={
                "endpoint_url": connector.endpoint_url,
                "http_method": connector.method,
                "auth_type": connector_for_request.auth_type,
                "credential_id": connector.credential_id,
                "http_status": response.status_code,
                "response_preview": preview,
            },
            started_at=started_at,
            finished_at=now,
            actor_details=command.actor_details,
        )
        return TestIntegrationConnectorOutput(
            connector=connector,
            status_code=response.status_code,
            ok=ok,
            message=message,
            response_preview=preview,
        )

    def inspect_database_schema(
        self,
        command: InspectIntegrationConnectorSchemaInput,
    ) -> InspectIntegrationConnectorSchemaOutput:
        connector = self._connectors.get(
            command.connector_id,
            organization_id=command.organization_id,
        )
        if connector is None:
            raise ValidationError(
                f"Integration connector {command.connector_id!r} not found"
            )
        connector = _validated_connector(connector)
        if (
            command.workspace_id is not None
            and connector.workspace_id is not None
            and connector.workspace_id != command.workspace_id
        ):
            raise ValidationError(
                "Integration connector workspace does not match the active workspace."
            )
        if connector.connector_type != "database":
            raise ValidationError(
                "Only database connectors expose a discoverable schema."
            )
        if self._database_transport is None:
            raise ValidationError(
                "Database connector schema inspection requires the database runtime adapter."
            )
        inspected = self._database_transport.inspect_schema(
            build_connector_database_schema_request(
                connector,
                secret_resolver=self._secret_resolver,
            )
        )
        return InspectIntegrationConnectorSchemaOutput(
            connector=connector,
            dialect=inspected.dialect,
            database=inspected.database,
            tables=tuple(inspected.tables),
        )

    def _resolve_connector_for_http_request(
        self,
        connector: IntegrationConnector,
        *,
        organization_id: str | None,
    ) -> IntegrationConnector:
        if connector.credential_id is None:
            return connector
        if self._credentials is None:
            raise ValidationError(
                "Saved credentials are not available for HTTP requests."
            )
        credential = self._credentials.get(
            connector.credential_id,
            organization_id=organization_id,
        )
        if credential is None:
            raise ValidationError(
                f"Integration credential {connector.credential_id!r} not found"
            )
        if connector.connector_type != "http":
            raise ValidationError(
                "Saved credentials are currently supported only for HTTP API profiles."
            )
        return apply_integration_credential(
            connector=connector,
            credential=credential,
        )

    def _test_database_connector(
        self,
        connector: IntegrationConnector,
        *,
        command: TestIntegrationConnectorInput,
        started_at: datetime,
    ) -> TestIntegrationConnectorOutput:
        if self._database_transport is None:
            return self._test_database_connector_placeholder(
                connector,
                command=command,
                started_at=started_at,
            )
        test_request = build_connector_database_test_request(
            connector,
            secret_resolver=self._secret_resolver,
        )
        try:
            tested = self._database_transport.test_connection(test_request)
        except Exception as exc:
            now = datetime.utcnow()
            message = f"Connector test failed: {exc}"
            connector.last_tested_at = now
            connector.last_test_status = "failed"
            connector.last_test_message = message
            connector.updated_at = now
            connector = self._connectors.save(connector)
            save_integration_execution(
                self._executions,
                execution_kind="connector_test",
                target_type="connector",
                target_id=connector.id,
                target_name=connector.name,
                source_system=connector.source_system,
                status="failed",
                valid=False,
                organization_id=connector.organization_id or command.organization_id,
                workspace_id=connector.workspace_id or command.workspace_id,
                trigger_type="manual_test",
                message=message,
                error_code=exc.__class__.__name__.lower()[:64],
                details={
                    "endpoint_url": connector.endpoint_url,
                    "connector_type": connector.connector_type,
                    "auth_type": connector.auth_type,
                },
                started_at=started_at,
                finished_at=now,
                actor_details=command.actor_details,
            )
            raise
        now = datetime.utcnow()
        connector.last_tested_at = now
        connector.last_test_status = "ok" if tested.ok else "failed"
        connector.last_test_message = tested.message
        connector.updated_at = now
        connector = self._connectors.save(connector)
        save_integration_execution(
            self._executions,
            execution_kind="connector_test",
            target_type="connector",
            target_id=connector.id,
            target_name=connector.name,
            source_system=connector.source_system,
            status=connector.last_test_status or "failed",
            valid=tested.ok,
            organization_id=connector.organization_id or command.organization_id,
            workspace_id=connector.workspace_id or command.workspace_id,
            trigger_type="manual_test",
            message=tested.message,
            error_code=None if tested.ok else "database_connection_failed",
            details={
                "endpoint_url": connector.endpoint_url,
                "connector_type": connector.connector_type,
                "auth_type": connector.auth_type,
                "dialect": tested.dialect,
                "database": tested.database,
            },
            started_at=started_at,
            finished_at=now,
            actor_details=command.actor_details,
        )
        return TestIntegrationConnectorOutput(
            connector=connector,
            status_code=200 if tested.ok else 502,
            ok=tested.ok,
            message=tested.message,
            response_preview=tested.database or tested.dialect or "",
        )

    def _test_database_connector_placeholder(
        self,
        connector: IntegrationConnector,
        *,
        command: TestIntegrationConnectorInput,
        started_at: datetime,
    ) -> TestIntegrationConnectorOutput:
        now = datetime.utcnow()
        message = (
            "Database connector credentials are configured, but live database testing "
            "requires the database runtime adapter."
        )
        connector.last_tested_at = now
        connector.last_test_status = "adapter_missing"
        connector.last_test_message = message
        connector.updated_at = now
        connector = self._connectors.save(connector)
        save_integration_execution(
            self._executions,
            execution_kind="connector_test",
            target_type="connector",
            target_id=connector.id,
            target_name=connector.name,
            source_system=connector.source_system,
            status="failed",
            valid=False,
            organization_id=connector.organization_id or command.organization_id,
            workspace_id=connector.workspace_id or command.workspace_id,
            trigger_type="manual_test",
            message=message,
            error_code="runtime_adapter_missing",
            details={
                "endpoint_url": connector.endpoint_url,
                "connector_type": connector.connector_type,
                "auth_type": connector.auth_type,
            },
            started_at=started_at,
            finished_at=now,
            actor_details=command.actor_details,
        )
        return TestIntegrationConnectorOutput(
            connector=connector,
            status_code=0,
            ok=False,
            message=message,
            response_preview="",
        )

    def _test_sftp_connector(
        self,
        connector: IntegrationConnector,
        *,
        command: TestIntegrationConnectorInput,
        started_at: datetime,
    ) -> TestIntegrationConnectorOutput:
        if self._sftp_transport is None:
            return self._test_sftp_connector_placeholder(
                connector,
                command=command,
                started_at=started_at,
            )
        test_request = build_connector_sftp_test_request(
            connector,
            secret_resolver=self._secret_resolver,
        )
        try:
            tested = self._sftp_transport.test_connection(test_request)
        except Exception as exc:
            now = datetime.utcnow()
            message = f"Connector test failed: {exc}"
            connector.last_tested_at = now
            connector.last_test_status = "failed"
            connector.last_test_message = message
            connector.updated_at = now
            connector = self._connectors.save(connector)
            save_integration_execution(
                self._executions,
                execution_kind="connector_test",
                target_type="connector",
                target_id=connector.id,
                target_name=connector.name,
                source_system=connector.source_system,
                status="failed",
                valid=False,
                organization_id=connector.organization_id or command.organization_id,
                workspace_id=connector.workspace_id or command.workspace_id,
                trigger_type="manual_test",
                message=message,
                error_code=exc.__class__.__name__.lower()[:64],
                details={
                    "endpoint_url": connector.endpoint_url,
                    "connector_type": connector.connector_type,
                    "auth_type": connector.auth_type,
                },
                started_at=started_at,
                finished_at=now,
                actor_details=command.actor_details,
            )
            raise
        now = datetime.utcnow()
        connector.last_tested_at = now
        connector.last_test_status = "ok" if tested.ok else "failed"
        connector.last_test_message = tested.message
        connector.updated_at = now
        connector = self._connectors.save(connector)
        save_integration_execution(
            self._executions,
            execution_kind="connector_test",
            target_type="connector",
            target_id=connector.id,
            target_name=connector.name,
            source_system=connector.source_system,
            status=connector.last_test_status or "failed",
            valid=tested.ok,
            organization_id=connector.organization_id or command.organization_id,
            workspace_id=connector.workspace_id or command.workspace_id,
            trigger_type="manual_test",
            message=tested.message,
            error_code=None if tested.ok else "sftp_connection_failed",
            details={
                "endpoint_url": connector.endpoint_url,
                "connector_type": connector.connector_type,
                "auth_type": connector.auth_type,
                "path": tested.path,
            },
            started_at=started_at,
            finished_at=now,
            actor_details=command.actor_details,
        )
        return TestIntegrationConnectorOutput(
            connector=connector,
            status_code=200 if tested.ok else 502,
            ok=tested.ok,
            message=tested.message,
            response_preview=tested.path or "",
        )

    def _test_sftp_connector_placeholder(
        self,
        connector: IntegrationConnector,
        *,
        command: TestIntegrationConnectorInput,
        started_at: datetime,
    ) -> TestIntegrationConnectorOutput:
        now = datetime.utcnow()
        message = (
            "SFTP connector credentials are configured, but live SFTP testing "
            "requires the SFTP runtime adapter."
        )
        connector.last_tested_at = now
        connector.last_test_status = "adapter_missing"
        connector.last_test_message = message
        connector.updated_at = now
        connector = self._connectors.save(connector)
        save_integration_execution(
            self._executions,
            execution_kind="connector_test",
            target_type="connector",
            target_id=connector.id,
            target_name=connector.name,
            source_system=connector.source_system,
            status="failed",
            valid=False,
            organization_id=connector.organization_id or command.organization_id,
            workspace_id=connector.workspace_id or command.workspace_id,
            trigger_type="manual_test",
            message=message,
            error_code="runtime_adapter_missing",
            details={
                "endpoint_url": connector.endpoint_url,
                "connector_type": connector.connector_type,
                "auth_type": connector.auth_type,
            },
            started_at=started_at,
            finished_at=now,
            actor_details=command.actor_details,
        )
        return TestIntegrationConnectorOutput(
            connector=connector,
            status_code=0,
            ok=False,
            message=message,
            response_preview="",
        )


def validate_integration_connector(connector: IntegrationConnector) -> IntegrationConnector:
    return _validated_connector(connector)


def build_connector_http_request(
    connector: IntegrationConnector,
    *,
    secret_resolver: IntegrationSecretResolver,
    body: bytes | None = None,
    extra_headers: dict[str, str] | None = None,
    url_override: str | None = None,
    method_override: str | None = None,
) -> IntegrationHttpRequest:
    connector = _validated_connector(connector)
    if connector.connector_type != "http":
        raise ValidationError(
            f"Integration connector {connector.id!r} is a {connector.connector_type!r} "
            "connector and cannot be used for HTTP requests."
        )
    headers = {key: value for key, value in connector.static_headers.items()}
    headers.update(extra_headers or {})
    headers.setdefault("Accept", "application/json")
    _apply_connector_auth(
        connector,
        headers=headers,
        secret_resolver=secret_resolver,
    )
    return IntegrationHttpRequest(
        method=(method_override or connector.method).strip().upper(),
        url=(url_override or connector.endpoint_url).strip(),
        headers=headers,
        body=body,
        timeout_seconds=connector.timeout_seconds,
    )


def _build_test_request(
    connector: IntegrationConnector,
    *,
    secret_resolver: IntegrationSecretResolver,
) -> IntegrationHttpRequest:
    body = None
    method = connector.method.upper()
    if method != "GET":
        body = b'{"ping":"planiadvance"}'
    request = build_connector_http_request(
        connector,
        secret_resolver=secret_resolver,
        body=body,
        extra_headers={"Content-Type": "application/json"} if body else None,
    )
    if method == "GET":
        return request
    return IntegrationHttpRequest(
        method=method,
        url=request.url,
        headers=request.headers,
        body=body,
        timeout_seconds=request.timeout_seconds,
    )


def build_connector_database_write_request(
    connector: IntegrationConnector,
    *,
    secret_resolver: IntegrationSecretResolver,
    table_name: str,
    operation: str,
    rows: list[dict[str, object]],
    match_columns: tuple[str, ...] = (),
) -> IntegrationDatabaseWriteRequest:
    connector = _validated_connector(connector)
    if connector.connector_type != "database":
        raise ValidationError(
            f"Integration connector {connector.id!r} is a {connector.connector_type!r} "
            "connector and cannot be used for database delivery."
        )
    target = _resolve_database_target(
        connector,
        secret_resolver=secret_resolver,
    )
    return IntegrationDatabaseWriteRequest(
        url=target["url"],
        table_name=table_name.strip(),
        operation=operation.strip().lower() or "insert",
        rows=[dict(row) for row in rows],
        match_columns=match_columns,
        timeout_seconds=connector.timeout_seconds,
    )


def build_connector_database_test_request(
    connector: IntegrationConnector,
    *,
    secret_resolver: IntegrationSecretResolver,
) -> IntegrationDatabaseTestRequest:
    connector = _validated_connector(connector)
    if connector.connector_type != "database":
        raise ValidationError(
            f"Integration connector {connector.id!r} is a {connector.connector_type!r} "
            "connector and cannot be used for database delivery."
        )
    target = _resolve_database_target(
        connector,
        secret_resolver=secret_resolver,
    )
    return IntegrationDatabaseTestRequest(
        url=target["url"],
        timeout_seconds=connector.timeout_seconds,
    )


def build_connector_database_schema_request(
    connector: IntegrationConnector,
    *,
    secret_resolver: IntegrationSecretResolver,
) -> IntegrationDatabaseSchemaRequest:
    connector = _validated_connector(connector)
    if connector.connector_type != "database":
        raise ValidationError(
            f"Integration connector {connector.id!r} is a {connector.connector_type!r} "
            "connector and cannot be used for database delivery."
        )
    target = _resolve_database_target(
        connector,
        secret_resolver=secret_resolver,
    )
    return IntegrationDatabaseSchemaRequest(
        url=target["url"],
        timeout_seconds=connector.timeout_seconds,
    )


def build_connector_sftp_put_request(
    connector: IntegrationConnector,
    *,
    secret_resolver: IntegrationSecretResolver,
    directory: str | None = None,
    file_name: str | None = None,
    body: bytes,
) -> IntegrationSftpPutRequest:
    connector = _validated_connector(connector)
    if connector.connector_type != "sftp":
        raise ValidationError(
            f"Integration connector {connector.id!r} is a {connector.connector_type!r} "
            "connector and cannot be used for SFTP delivery."
        )
    target = _resolve_sftp_target(
        connector,
        secret_resolver=secret_resolver,
        directory=directory,
        file_name=file_name,
    )
    return IntegrationSftpPutRequest(
        host=target["host"],
        port=target["port"],
        username=target["username"],
        password=target["password"],
        path=target["path"],
        body=body,
        timeout_seconds=connector.timeout_seconds,
    )


def build_connector_sftp_test_request(
    connector: IntegrationConnector,
    *,
    secret_resolver: IntegrationSecretResolver,
) -> IntegrationSftpTestRequest:
    connector = _validated_connector(connector)
    if connector.connector_type != "sftp":
        raise ValidationError(
            f"Integration connector {connector.id!r} is a {connector.connector_type!r} "
            "connector and cannot be used for SFTP delivery."
        )
    target = _resolve_sftp_target(
        connector,
        secret_resolver=secret_resolver,
        directory=None,
        file_name=None,
    )
    return IntegrationSftpTestRequest(
        host=target["host"],
        port=target["port"],
        username=target["username"],
        password=target["password"],
        path=target["directory"],
        timeout_seconds=connector.timeout_seconds,
    )


def _resolve_database_target(
    connector: IntegrationConnector,
    *,
    secret_resolver: IntegrationSecretResolver,
) -> dict[str, str]:
    resolved_url = make_url(connector.endpoint_url)
    if connector.auth_type == "basic":
        resolved_url = resolved_url.set(
            username=connector.username or resolved_url.username,
            password=secret_resolver.resolve(connector.secret_ref or ""),
        )
    return {"url": resolved_url.render_as_string(hide_password=False)}


def _resolve_sftp_target(
    connector: IntegrationConnector,
    *,
    secret_resolver: IntegrationSecretResolver,
    directory: str | None,
    file_name: str | None,
) -> dict[str, object]:
    parsed = urlparse(connector.endpoint_url)
    if parsed.scheme != "sftp" or not parsed.hostname:
        raise ValidationError(
            "SFTP integration connector endpoint_url must be an absolute SFTP URL."
        )
    base_directory = parsed.path or "/"
    resolved_directory = _normalize_sftp_directory(base_directory, directory)
    resolved_file_name = (file_name or "").strip()
    if not resolved_file_name:
        resolved_file_name = "payload.dat"
    if "/" in resolved_file_name:
        raise ValidationError("SFTP file_name must not include directory separators.")
    password = secret_resolver.resolve(connector.secret_ref or "")
    return {
        "host": parsed.hostname,
        "port": int(parsed.port or 22),
        "username": connector.username or "",
        "password": password,
        "directory": resolved_directory,
        "path": _join_sftp_path(resolved_directory, resolved_file_name),
    }


def _normalize_sftp_directory(base_directory: str, directory: str | None) -> str:
    base = posixpath.normpath(base_directory or "/")
    base = "/" if base in {"", "."} else base
    if directory is None or not directory.strip():
        return base
    extra = directory.strip()
    if extra.startswith("/"):
        normalized = posixpath.normpath(extra)
    else:
        normalized = posixpath.normpath(posixpath.join(base, extra))
    return "/" if normalized in {"", "."} else normalized


def _join_sftp_path(directory: str, file_name: str) -> str:
    directory = "/" if directory in {"", "."} else directory
    return posixpath.join(directory, file_name)


def _validated_connector(connector: IntegrationConnector) -> IntegrationConnector:
    connector.name = connector.name.strip()
    connector.source_system = connector.source_system.strip()
    connector.endpoint_url = connector.endpoint_url.strip()
    connector.connector_type = connector.connector_type.strip().lower() or "http"
    connector.method = connector.method.strip().upper() or "POST"
    connector.auth_type = connector.auth_type.strip().lower() or "none"
    if not connector.name:
        raise ValidationError("Integration connector name is required.")
    if not connector.source_system:
        raise ValidationError("Integration connector source_system is required.")
    if connector.connector_type not in VALID_CONNECTOR_TYPES:
        raise ValidationError(
            f"Unsupported integration connector type {connector.connector_type!r}."
        )
    if connector.timeout_seconds <= 0:
        raise ValidationError("Integration connector timeout_seconds must be positive.")
    if connector.connector_type == "database":
        _validate_database_connector(connector)
        _validate_connector_auth(connector, VALID_DATABASE_AUTH_TYPES)
        return connector
    if connector.connector_type == "http":
        _validate_http_connector(connector)
        _validate_connector_auth(connector, VALID_CONNECTOR_AUTH_TYPES)
        return connector
    if connector.connector_type == "sftp":
        _validate_sftp_connector(connector)
        _validate_connector_auth(connector, VALID_SFTP_AUTH_TYPES)
        if connector.auth_type != "basic":
            raise ValidationError("SFTP connectors require basic auth with username and secret.")
        return connector
    if connector.connector_type == "odoo":
        _validate_odoo_connector(connector)
        _validate_connector_auth(connector, VALID_ODOO_AUTH_TYPES)
        if connector.auth_type != "basic":
            raise ValidationError(
                "Odoo connectors require basic auth: username = Odoo login, "
                "secret = API key (env:NAME or sealed:...)."
            )
        return connector
    return connector


def _validate_http_connector(connector: IntegrationConnector) -> None:
    parsed = urlparse(connector.endpoint_url)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ValidationError(
            "HTTP integration connector endpoint_url must be an absolute HTTP URL."
        )
    if connector.method not in VALID_CONNECTOR_METHODS:
        allowed = ", ".join(sorted(VALID_CONNECTOR_METHODS))
        raise ValidationError(
            f"Unsupported integration connector method {connector.method!r}. "
            f"Allowed methods: {allowed}."
        )


def _validate_database_connector(connector: IntegrationConnector) -> None:
    try:
        make_url(connector.endpoint_url)
    except Exception as exc:  # pragma: no cover - SQLAlchemy controls exact subtype
        raise ValidationError(
            "Database integration connector endpoint_url must be a valid SQLAlchemy database URL."
        ) from exc


def _validate_sftp_connector(connector: IntegrationConnector) -> None:
    parsed = urlparse(connector.endpoint_url)
    if parsed.scheme != "sftp" or not parsed.netloc:
        raise ValidationError(
            "SFTP integration connector endpoint_url must be an absolute SFTP URL."
        )


def _validate_odoo_connector(connector: IntegrationConnector) -> None:
    parsed = urlparse(connector.endpoint_url)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ValidationError(
            "Odoo integration connector endpoint_url must be an absolute HTTP URL."
        )
    database = parsed.path.strip("/").split("/", 1)[0] if parsed.path else ""
    if not database:
        raise ValidationError(
            "Odoo connector endpoint_url must include the Odoo database name as the "
            "URL path, e.g. http://localhost:8069/planiadvance_test."
        )


def parse_odoo_endpoint(connector: IntegrationConnector) -> tuple[str, str]:
    """Split an Odoo connector's endpoint_url into (base_url, database).

    Raises ValueError if the connector is not an Odoo connector. The split
    assumes Odoo's database name is encoded as the first path segment, e.g.
    ``http://host:port/db_name`` -> ``("http://host:port", "db_name")``.
    """

    if connector.connector_type != "odoo":
        raise ValueError(
            f"parse_odoo_endpoint requires an Odoo connector, got "
            f"connector_type={connector.connector_type!r}"
        )
    parsed = urlparse(connector.endpoint_url)
    database = parsed.path.strip("/").split("/", 1)[0] if parsed.path else ""
    base_url = f"{parsed.scheme}://{parsed.netloc}"
    return base_url, database


def _validate_connector_auth(
    connector: IntegrationConnector,
    allowed_auth_types: set[str],
) -> None:
    if connector.auth_type not in allowed_auth_types:
        allowed = ", ".join(sorted(allowed_auth_types))
        raise ValidationError(
            f"Unsupported integration connector auth_type {connector.auth_type!r}. "
            f"Allowed auth types: {allowed}."
        )
    if connector.auth_type == "none":
        return
    if not connector.secret_ref:
        raise ValidationError(
            f"Integration connector auth_type {connector.auth_type!r} requires secret_ref."
        )
    if not (
        connector.secret_ref.startswith("env:")
        or connector.secret_ref.startswith("sealed:")
    ):
        raise ValidationError(
            "Integration connector secret_ref must use env:NAME or a stored app secret."
        )
    if connector.auth_type == "api_key_header" and not connector.auth_header_name:
        raise ValidationError(
            "Integration connector api_key_header auth requires auth_header_name."
        )
    if connector.auth_type == "basic" and not connector.username:
        raise ValidationError(
            "Integration connector basic auth requires username."
        )


def _apply_connector_auth(
    connector: IntegrationConnector,
    *,
    headers: dict[str, str],
    secret_resolver: IntegrationSecretResolver,
) -> None:
    from base64 import b64encode

    if connector.auth_type == "none":
        return
    secret = secret_resolver.resolve(connector.secret_ref or "")
    if connector.auth_type == "bearer":
        headers["Authorization"] = f"Bearer {secret}"
        return
    if connector.auth_type == "api_key_header":
        headers[connector.auth_header_name or "X-API-Key"] = secret
        return
    if connector.auth_type == "basic":
        userpass = f"{connector.username}:{secret}".encode()
        headers["Authorization"] = f"Basic {b64encode(userpass).decode('ascii')}"
        return
