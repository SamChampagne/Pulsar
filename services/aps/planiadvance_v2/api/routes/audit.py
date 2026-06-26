"""J7 — read-only access to the audit event log.

Lists the most recent audit events scoped to the active tenant. The
operator and admins use this to answer "who published the bad
scenario?", "did anyone log in from an unexpected IP?", etc.

This endpoint is intentionally tenant-scoped: callers can only see
events for the org they signed into. A future cross-tenant admin
view (for support engineers) would live behind a different
permission and isn't included here.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query

from ...infrastructure.db.repositories import SqlAuditEventRepository
from ..dependencies import get_audit_event_repository
from ..tenant import TenantContext, get_tenant_context

router = APIRouter(prefix="/audit", tags=["audit"])


@router.get("/events")
def list_audit_events(
    tenant: TenantContext = Depends(get_tenant_context),
    repository: SqlAuditEventRepository = Depends(get_audit_event_repository),
    limit: int = Query(50, ge=1, le=500),
    action: str | None = Query(None),
) -> dict:
    if tenant.organization_id is None:
        raise HTTPException(
            status_code=401,
            detail={
                "error": "tenant_required",
                "message": "Audit log is scoped to the active tenant; sign in first.",
            },
        )
    events = repository.list_recent(
        limit=limit,
        organization_id=tenant.organization_id,
        action=action,
    )
    return {
        "events": [
            {
                "id": event.id,
                "action": event.action,
                "status": event.status,
                "organization_id": event.organization_id,
                "workspace_id": event.workspace_id,
                "user_id": event.user_id,
                "ip_address": event.ip_address,
                "subject": event.subject,
                "details": event.details,
                "created_at": event.created_at.isoformat(),
            }
            for event in events
        ],
        "total": len(events),
    }
