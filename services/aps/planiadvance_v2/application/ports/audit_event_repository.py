"""Port: append-only audit log for sensitive events.

Captures who did what, when, from where. Distinct from the integration
journal (which tracks ERP/MES exchange semantics). The two coexist —
integration imports/exports go to the journal, login + publish + admin
events go here.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Protocol


@dataclass(frozen=True, slots=True)
class AuditEvent:
    id: str
    action: str
    status: str
    organization_id: str | None = None
    workspace_id: str | None = None
    user_id: str | None = None
    ip_address: str | None = None
    subject: str | None = None
    details: dict[str, object] = field(default_factory=dict)
    created_at: datetime = field(default_factory=datetime.utcnow)


class AuditEventRepository(Protocol):
    def save(self, event: AuditEvent) -> None: ...

    def list_recent(
        self,
        limit: int = 50,
        *,
        organization_id: str | None = None,
        workspace_id: str | None = None,
        action: str | None = None,
    ) -> list[AuditEvent]: ...
