"""J7 hardening — /auth/login per-IP rate limit."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from planiadvance_v2.api.dependencies import get_list_accessible_workspaces
from planiadvance_v2.api.main import create_app
from planiadvance_v2.api.routes.auth import get_auth_user_repository
from planiadvance_v2.api.tenant import (
    get_tenant_membership_repository,
    get_tenant_organization_repository,
)
from planiadvance_v2.application.use_cases import ListAccessibleWorkspaces
from planiadvance_v2.config import get_settings
from planiadvance_v2.infrastructure.in_memory.repositories import (
    InMemoryMembershipRepository,
    InMemoryOrganizationRepository,
    InMemoryUserAccountRepository,
    InMemoryWorkspaceAccessGrantRepository,
    InMemoryWorkspaceRepository,
)


@pytest.fixture(autouse=True)
def _reset_rate_limiter():
    # Wipe in-process bucket between tests so a fresh limit applies.
    from planiadvance_v2.api import security as security_module

    with security_module._rate_limit_lock:
        security_module._rate_limit_windows.clear()
    get_settings.cache_clear()
    yield
    with security_module._rate_limit_lock:
        security_module._rate_limit_windows.clear()
    get_settings.cache_clear()


def _make_client(login_limit: int) -> TestClient:
    import os

    os.environ["AUTH_LOGIN_RATE_LIMIT_PER_MINUTE"] = str(login_limit)
    get_settings.cache_clear()

    app = create_app()
    organizations = InMemoryOrganizationRepository()
    users = InMemoryUserAccountRepository()
    memberships = InMemoryMembershipRepository()
    workspaces = InMemoryWorkspaceRepository()
    access_grants = InMemoryWorkspaceAccessGrantRepository()

    list_accessible = ListAccessibleWorkspaces(
        workspaces=workspaces,
        grants=access_grants,
    )

    app.dependency_overrides[get_auth_user_repository] = lambda: users
    app.dependency_overrides[get_tenant_organization_repository] = lambda: organizations
    app.dependency_overrides[get_tenant_membership_repository] = lambda: memberships
    app.dependency_overrides[get_list_accessible_workspaces] = lambda: list_accessible

    return TestClient(app)


def test_auth_login_returns_429_after_quota_exhausted() -> None:
    client = _make_client(login_limit=3)

    # 3 attempts within the bucket return their natural error (404
    # because the in-memory user repo is empty), the 4th is throttled.
    for _ in range(3):
        response = client.post("/auth/login", json={"user_id": "ghost"})
        assert response.status_code == 404

    throttled = client.post("/auth/login", json={"user_id": "ghost"})
    assert throttled.status_code == 429
    body = throttled.json()
    assert body["error"] == "rate_limit_exceeded"
    assert body["details"][0]["scope"] == "auth_login"
    assert body["details"][0]["limit"] == 3


def test_auth_login_rate_limit_disabled_when_zero() -> None:
    client = _make_client(login_limit=0)

    # 50 attempts should all hit the natural 404 — never throttled.
    for _ in range(50):
        response = client.post("/auth/login", json={"user_id": "ghost"})
        assert response.status_code == 404
