"""API security helpers."""

from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from hashlib import sha256
from hmac import compare_digest
from threading import Lock
from time import monotonic

from fastapi import Depends, HTTPException, Security
from fastapi.security import APIKeyHeader
from pydantic import BaseModel

from ..application.ports import IntegrationApiClientRepository
from ..application.use_cases.integration_api_clients import hash_integration_api_key
from ..config import Settings, get_settings
from .dependencies import get_integration_api_clients
from .tenant import (
    TenantContext,
    ensure_authenticated_permission,
    get_tenant_context,
)


class IntegrationAccess(StrEnum):
    READ = "read"
    WRITE = "write"
    RUN = "run"


class IntegrationPrincipal(BaseModel):
    auth_mode: str
    access_scope: IntegrationAccess
    key_type: str
    client_id: str
    organization_id: str | None = None
    workspace_id: str | None = None
    client_name: str | None = None
    source_system: str | None = None
    scopes: tuple[str, ...] = ()
    is_anonymous: bool = False

    def require_organization_id(self) -> str:
        if self.is_anonymous or self.organization_id is None:
            raise HTTPException(
                status_code=403,
                detail={
                    "error": "tenant_required",
                    "message": (
                        "This integration endpoint requires a tenant-scoped "
                        "principal. Configure INTEGRATION_API_KEY, create an "
                        "integration API client, or sign in via the UI before "
                        "writing tenant-owned data."
                    ),
                },
            )
        return self.organization_id


integration_api_key_header = APIKeyHeader(name="X-API-Key", auto_error=False)
_RATE_LIMIT_WINDOW_SECONDS = 60.0
_rate_limit_lock = Lock()
_rate_limit_windows: dict[str, tuple[float, int]] = {}


def require_integration_read_key(
    x_api_key: str | None = Security(integration_api_key_header),
    api_clients: IntegrationApiClientRepository = Depends(get_integration_api_clients),
) -> IntegrationPrincipal:
    return _require_integration_access(
        IntegrationAccess.READ,
        x_api_key=x_api_key,
        api_clients=api_clients,
    )


def require_integration_write_key(
    x_api_key: str | None = Security(integration_api_key_header),
    api_clients: IntegrationApiClientRepository = Depends(get_integration_api_clients),
) -> IntegrationPrincipal:
    return _require_integration_access(
        IntegrationAccess.WRITE,
        x_api_key=x_api_key,
        api_clients=api_clients,
    )


def require_integration_run_key(
    x_api_key: str | None = Security(integration_api_key_header),
    api_clients: IntegrationApiClientRepository = Depends(get_integration_api_clients),
) -> IntegrationPrincipal:
    return _require_integration_access(
        IntegrationAccess.RUN,
        x_api_key=x_api_key,
        api_clients=api_clients,
    )


def require_integration_read_access(
    x_api_key: str | None = Security(integration_api_key_header),
    tenant: TenantContext = Depends(get_tenant_context),
    api_clients: IntegrationApiClientRepository = Depends(get_integration_api_clients),
) -> IntegrationPrincipal:
    return _require_integration_access_or_session(
        IntegrationAccess.READ,
        x_api_key=x_api_key,
        tenant=tenant,
        api_clients=api_clients,
    )


def require_integration_write_access(
    x_api_key: str | None = Security(integration_api_key_header),
    tenant: TenantContext = Depends(get_tenant_context),
    api_clients: IntegrationApiClientRepository = Depends(get_integration_api_clients),
) -> IntegrationPrincipal:
    return _require_integration_access_or_session(
        IntegrationAccess.WRITE,
        x_api_key=x_api_key,
        tenant=tenant,
        api_clients=api_clients,
    )


def require_integration_run_access(
    x_api_key: str | None = Security(integration_api_key_header),
    tenant: TenantContext = Depends(get_tenant_context),
    api_clients: IntegrationApiClientRepository = Depends(get_integration_api_clients),
) -> IntegrationPrincipal:
    return _require_integration_access_or_session(
        IntegrationAccess.RUN,
        x_api_key=x_api_key,
        tenant=tenant,
        api_clients=api_clients,
    )


def _require_integration_access_or_session(
    access: IntegrationAccess,
    *,
    x_api_key: str | None,
    tenant: TenantContext,
    api_clients: IntegrationApiClientRepository,
) -> IntegrationPrincipal:
    if x_api_key:
        return _require_integration_access(
            access,
            x_api_key=x_api_key,
            api_clients=api_clients,
        )

    settings = get_settings()
    if _configured_integration_keys(settings) or api_clients.has_clients():
        if tenant.role is not None:
            ensure_authenticated_permission(tenant, "manage_integrations")
            return IntegrationPrincipal(
                auth_mode="session",
                access_scope=access,
                key_type="session",
                client_id=f"user:{tenant.user_id or 'unknown'}",
                organization_id=tenant.organization_id,
                workspace_id=tenant.workspace_id,
                client_name="PlaniAdvance UI",
                source_system="planiadvance-ui",
                scopes=("manage_integrations",),
            )

    return _require_integration_access(
        access,
        x_api_key=x_api_key,
        api_clients=api_clients,
    )


def _require_integration_access(
    access: IntegrationAccess,
    *,
    x_api_key: str | None,
    api_clients: IntegrationApiClientRepository,
) -> IntegrationPrincipal:
    """Protect integration endpoints when at least one API key is configured.

    Local development stays frictionless when all integration keys are empty.
    ``INTEGRATION_API_KEY`` is a full-access key. Optional read/run keys can be
    used by limited clients that should not import data.
    """

    settings = get_settings()
    configured_keys = _configured_integration_keys(settings)
    now = datetime.utcnow()
    has_db_clients = api_clients.has_clients()
    if not configured_keys and not has_db_clients:
        return IntegrationPrincipal(
            auth_mode="disabled",
            access_scope=access,
            key_type="none",
            client_id="anonymous",
            is_anonymous=True,
        )
    if not x_api_key:
        raise HTTPException(
            status_code=401,
            detail={
                "error": "missing_api_key",
                "message": "X-API-Key header is required for integration endpoints.",
            },
        )
    matched_allowed_key_type = _matching_integration_key_type(
        x_api_key,
        _allowed_integration_keys(settings, access),
    )
    if matched_allowed_key_type is not None:
        client_id = _client_id_for_key(x_api_key, matched_allowed_key_type)
        _enforce_rate_limit(client_id)
        return IntegrationPrincipal(
            auth_mode="api_key",
            access_scope=access,
            key_type=matched_allowed_key_type,
            client_id=client_id,
            scopes=(matched_allowed_key_type,),
        )
    db_client = api_clients.find_active_by_key_hash(
        hash_integration_api_key(x_api_key),
        now=now,
    )
    if db_client is not None:
        if _db_client_allows(db_client.scopes, access):
            client_id = f"client:{db_client.id}"
            _enforce_rate_limit(client_id)
            api_clients.mark_used(db_client.id, used_at=now)
            return IntegrationPrincipal(
                auth_mode="api_client",
                access_scope=access,
                key_type="client",
                client_id=client_id,
                organization_id=db_client.organization_id,
                workspace_id=db_client.workspace_id,
                client_name=db_client.name,
                source_system=db_client.source_system,
                scopes=db_client.scopes,
            )
        raise HTTPException(
            status_code=403,
            detail={
                "error": "insufficient_scope",
                "message": (
                    "Integration API client does not allow "
                    f"{access.value} access."
                ),
            },
        )
    if _matching_integration_key_type(x_api_key, configured_keys) is not None:
        raise HTTPException(
            status_code=403,
            detail={
                "error": "insufficient_scope",
                "message": f"Integration API key does not allow {access.value} access.",
            },
        )
    raise HTTPException(
        status_code=403,
        detail={
            "error": "invalid_api_key",
            "message": "Invalid integration API key.",
        },
    )


def _configured_integration_keys(settings: Settings) -> tuple[tuple[str, str], ...]:
    return tuple(
        (key_type, key)
        for key_type, key in (
            ("full", settings.integration_api_key),
            ("read", settings.integration_read_api_key),
            ("run", settings.integration_run_api_key),
        )
        if key
    )


def _allowed_integration_keys(
    settings: Settings,
    access: IntegrationAccess,
) -> tuple[tuple[str, str], ...]:
    full_access = (
        (("full", settings.integration_api_key),) if settings.integration_api_key else ()
    )
    match access:
        case IntegrationAccess.READ:
            read_access = (
                (("read", settings.integration_read_api_key),)
                if settings.integration_read_api_key
                else ()
            )
            return full_access + read_access
        case IntegrationAccess.RUN:
            run_access = (
                (("run", settings.integration_run_api_key),)
                if settings.integration_run_api_key
                else ()
            )
            return full_access + run_access
        case IntegrationAccess.WRITE:
            return full_access


def _matching_integration_key_type(
    candidate: str,
    keys: tuple[tuple[str, str], ...],
) -> str | None:
    for key_type, configured_key in keys:
        if compare_digest(candidate, configured_key):
            return key_type
    return None


def _client_id_for_key(api_key: str, key_type: str) -> str:
    digest = sha256(api_key.encode("utf-8")).hexdigest()[:16]
    return f"{key_type}:{digest}"


def _db_client_allows(scopes: tuple[str, ...], access: IntegrationAccess) -> bool:
    return "full" in scopes or access.value in scopes


def enforce_rate_limit(
    *,
    client_id: str,
    limit_per_minute: int,
    scope: str,
) -> None:
    """Reusable token-bucket per (scope, client_id), 60s window.

    Used by the integration handler (per API key / client) and by the
    auth login route (per source IP). `scope` keeps the keys disjoint
    so a high-traffic ERP integration doesn't burn a planner's login
    quota or vice versa.

    A `limit_per_minute <= 0` disables enforcement.
    """

    if limit_per_minute <= 0:
        return
    bucket_key = f"{scope}:{client_id}"
    now = monotonic()
    with _rate_limit_lock:
        window_start, count = _rate_limit_windows.get(bucket_key, (now, 0))
        if now - window_start >= _RATE_LIMIT_WINDOW_SECONDS:
            window_start = now
            count = 0
        count += 1
        _rate_limit_windows[bucket_key] = (window_start, count)
        if count <= limit_per_minute:
            return
    # `limit_name` is an alias kept for the existing integration test
    # contract; new code reads `scope`.
    legacy_limit_name = (
        "integration_rate_limit_per_minute"
        if scope == "integration"
        else f"{scope}_rate_limit_per_minute"
    )
    raise HTTPException(
        status_code=429,
        detail={
            "error": "rate_limit_exceeded",
            "message": f"Rate limit exceeded for {scope}.",
            "details": [
                {
                    "scope": scope,
                    "limit_name": legacy_limit_name,
                    "client_id": client_id,
                    "limit": limit_per_minute,
                    "window_seconds": int(_RATE_LIMIT_WINDOW_SECONDS),
                }
            ],
        },
    )


def _enforce_rate_limit(client_id: str) -> None:
    enforce_rate_limit(
        client_id=client_id,
        limit_per_minute=get_settings().integration_rate_limit_per_minute,
        scope="integration",
    )
