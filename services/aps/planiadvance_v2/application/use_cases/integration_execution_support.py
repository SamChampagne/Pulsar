"""Shared helpers for the append-only integration execution ledger."""

from __future__ import annotations

from datetime import datetime
from uuid import uuid4

from ..ports import IntegrationExecutionRecord, IntegrationExecutionRepository


def ensure_integration_correlation_id(actor_details: dict[str, object]) -> str:
    value = actor_details.get("correlation_id")
    if value is not None and str(value).strip():
        return str(value)
    correlation_id = f"iex-{uuid4().hex[:12]}"
    actor_details["correlation_id"] = correlation_id
    return correlation_id


def integration_actor_mode(actor_details: dict[str, object]) -> str | None:
    for key in ("auth_mode", "triggered_by", "actor_mode"):
        value = actor_details.get(key)
        if value is not None and str(value).strip():
            return str(value)
    return None


def integration_actor_id(actor_details: dict[str, object]) -> str | None:
    for key in (
        "user_id",
        "client_id",
        "worker_id",
        "automation_job_id",
        "lock_owner",
    ):
        value = actor_details.get(key)
        if value is not None and str(value).strip():
            return str(value)
    return None


def integration_duration_ms(
    started_at: datetime,
    finished_at: datetime,
) -> int:
    elapsed = int((finished_at - started_at).total_seconds() * 1000)
    return max(0, elapsed)


def save_integration_execution(
    executions: IntegrationExecutionRepository | None,
    *,
    execution_kind: str,
    target_type: str,
    source_system: str,
    status: str,
    valid: bool,
    organization_id: str | None = None,
    workspace_id: str | None = None,
    target_id: str | None = None,
    target_name: str | None = None,
    trigger_type: str | None = None,
    attempt_number: int = 1,
    message: str = "",
    error_code: str | None = None,
    entity_counts: dict[str, int] | None = None,
    details: dict[str, object] | None = None,
    journal_entry_id: str | None = None,
    started_at: datetime | None = None,
    finished_at: datetime | None = None,
    actor_details: dict[str, object] | None = None,
) -> IntegrationExecutionRecord | None:
    if executions is None:
        return None
    started = started_at or datetime.utcnow()
    finished = finished_at or started
    actor_payload = dict(actor_details or {})
    correlation_id = ensure_integration_correlation_id(actor_payload)
    record = IntegrationExecutionRecord(
        id=f"iex-{uuid4().hex[:12]}",
        execution_kind=execution_kind,
        target_type=target_type,
        source_system=source_system,
        status=status,
        valid=valid,
        organization_id=organization_id,
        workspace_id=workspace_id,
        target_id=target_id,
        target_name=target_name,
        trigger_type=trigger_type,
        actor_mode=integration_actor_mode(actor_payload),
        actor_id=integration_actor_id(actor_payload),
        correlation_id=correlation_id,
        attempt_number=max(1, int(attempt_number)),
        message=message,
        error_code=error_code,
        entity_counts={
            str(key): int(value)
            for key, value in dict(entity_counts or {}).items()
        },
        details=dict(details or {}),
        journal_entry_id=journal_entry_id,
        started_at=started,
        finished_at=finished,
        duration_ms=integration_duration_ms(started, finished),
    )
    return executions.save(record)
