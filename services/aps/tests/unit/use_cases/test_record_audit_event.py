"""J7 — record_audit_event helper unit tests."""

from __future__ import annotations

from datetime import datetime

from planiadvance_v2.application.use_cases import record_audit_event
from planiadvance_v2.infrastructure.in_memory.repositories import (
    InMemoryAuditEventRepository,
)


def test_record_audit_event_persists_with_a_uuid_id_and_now_timestamp() -> None:
    repo = InMemoryAuditEventRepository()
    fixed_now = datetime(2026, 5, 7, 19, 0, 0)

    event = record_audit_event(
        repo,
        action="auth.login",
        status="ok",
        organization_id="org-pilot",
        user_id="user-pilot-planner",
        ip_address="10.0.0.42",
        subject="planner@pilot.local",
        now=fixed_now,
    )

    stored = repo.list_recent()
    assert len(stored) == 1
    assert stored[0].id == event.id
    assert stored[0].action == "auth.login"
    assert stored[0].status == "ok"
    assert stored[0].organization_id == "org-pilot"
    assert stored[0].user_id == "user-pilot-planner"
    assert stored[0].ip_address == "10.0.0.42"
    assert stored[0].created_at == fixed_now
    assert len(stored[0].id) >= 16  # uuid hex


def test_record_audit_event_filters_by_organization() -> None:
    repo = InMemoryAuditEventRepository()
    record_audit_event(repo, action="auth.login", status="ok", organization_id="org-a")
    record_audit_event(repo, action="auth.login", status="ok", organization_id="org-b")
    record_audit_event(repo, action="scenario.publish", status="ok", organization_id="org-a")

    org_a = repo.list_recent(organization_id="org-a")
    assert len(org_a) == 2
    assert {e.action for e in org_a} == {"auth.login", "scenario.publish"}

    publish_only = repo.list_recent(action="scenario.publish")
    assert len(publish_only) == 1
    assert publish_only[0].organization_id == "org-a"
