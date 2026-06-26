"""Record an event to the append-only audit log.

This is intentionally a tiny use case (more like a helper) so callers
can `record_audit_event(repo, action="auth.login", status="ok", ...)`
without each touching the AuditEvent dataclass + uuid + datetime
plumbing.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from ..ports import AuditEvent, AuditEventRepository


def record_audit_event(
    repository: AuditEventRepository,
    *,
    action: str,
    status: str,
    organization_id: str | None = None,
    workspace_id: str | None = None,
    user_id: str | None = None,
    ip_address: str | None = None,
    subject: str | None = None,
    details: dict[str, object] | None = None,
    now: datetime | None = None,
) -> AuditEvent:
    event = AuditEvent(
        id=uuid.uuid4().hex,
        action=action,
        status=status,
        organization_id=organization_id,
        workspace_id=workspace_id,
        user_id=user_id,
        ip_address=ip_address,
        subject=subject,
        details=dict(details or {}),
        created_at=now or datetime.utcnow(),
    )
    repository.save(event)
    return event
