"""J7 — proof that GET /audit/events is tenant-scoped.

The /audit endpoint returns audit events. Two tenants must NEVER see
each other's events. This test exercises the full request path:
- A session for org-A pulls events; only org-A entries come back
- A session for org-B pulls events; only org-B entries come back
- Without a tenant context the endpoint returns 401

Failure here is a real privacy / compliance leak.
"""

from __future__ import annotations

from datetime import datetime, timedelta

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from planiadvance_v2.api.dependencies import get_audit_event_repository
from planiadvance_v2.api.routes import audit as audit_route
from planiadvance_v2.api.tenant import (
    TenantContext,
    get_tenant_context,
)
from planiadvance_v2.application.ports import AuditEvent
from planiadvance_v2.infrastructure.in_memory.repositories import (
    InMemoryAuditEventRepository,
)


def _build_app(repo, tenant: TenantContext | None) -> FastAPI:
    app = FastAPI()
    app.include_router(audit_route.router)
    app.dependency_overrides[get_audit_event_repository] = lambda: repo
    app.dependency_overrides[get_tenant_context] = lambda: tenant or TenantContext(
        organization_id=None,
        user_id=None,
    )
    return app


@pytest.fixture
def two_tenant_repo() -> InMemoryAuditEventRepository:
    repo = InMemoryAuditEventRepository()
    base = datetime(2026, 5, 7, 22, 0, 0)
    # 2 events for org-a, 1 for org-b
    repo.save(
        AuditEvent(
            id="event-a-1",
            action="auth.login",
            status="ok",
            organization_id="org-a",
            user_id="user-a",
            created_at=base,
        )
    )
    repo.save(
        AuditEvent(
            id="event-a-2",
            action="scenario.publish",
            status="publishable",
            organization_id="org-a",
            user_id="user-a",
            subject="run-a-100",
            created_at=base + timedelta(minutes=5),
        )
    )
    repo.save(
        AuditEvent(
            id="event-b-1",
            action="auth.login",
            status="ok",
            organization_id="org-b",
            user_id="user-b",
            created_at=base + timedelta(minutes=10),
        )
    )
    return repo


def test_session_for_org_a_only_sees_org_a_events(two_tenant_repo) -> None:
    tenant = TenantContext(organization_id="org-a", user_id="user-a")
    client = TestClient(_build_app(two_tenant_repo, tenant))

    response = client.get("/audit/events")

    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 2
    actions = sorted(event["action"] for event in body["events"])
    assert actions == ["auth.login", "scenario.publish"]
    assert all(event["organization_id"] == "org-a" for event in body["events"])
    assert all("event-b" not in event["id"] for event in body["events"])


def test_session_for_org_b_only_sees_org_b_events(two_tenant_repo) -> None:
    tenant = TenantContext(organization_id="org-b", user_id="user-b")
    client = TestClient(_build_app(two_tenant_repo, tenant))

    response = client.get("/audit/events")

    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 1
    assert body["events"][0]["organization_id"] == "org-b"
    assert body["events"][0]["id"] == "event-b-1"


def test_no_tenant_context_returns_401_not_a_data_leak(two_tenant_repo) -> None:
    client = TestClient(
        _build_app(two_tenant_repo, TenantContext(organization_id=None, user_id=None))
    )

    response = client.get("/audit/events")

    assert response.status_code == 401
    body = response.json()
    # The body MUST NOT include any audit event data — bug regression.
    serialised = response.text
    assert "event-a-1" not in serialised
    assert "event-b-1" not in serialised
    assert "user-a" not in serialised
    assert "user-b" not in serialised
    assert body.get("error") == "tenant_required" or body.get("detail", {}).get(
        "error"
    ) == "tenant_required"


def test_action_filter_does_not_bypass_tenant_scope(two_tenant_repo) -> None:
    """An attacker who knows the action name must NOT be able to leak
    cross-tenant events by setting ?action=... on their own session."""
    tenant = TenantContext(organization_id="org-a", user_id="user-a")
    client = TestClient(_build_app(two_tenant_repo, tenant))

    response = client.get("/audit/events?action=auth.login")

    assert response.status_code == 200
    body = response.json()
    # org-a has 1 auth.login; org-b has 1 auth.login. The tenant scope
    # must come BEFORE the action filter.
    assert body["total"] == 1
    assert body["events"][0]["organization_id"] == "org-a"
