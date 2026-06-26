"""Port: append-only integration execution ledger.

The journal answers "what exchange happened?" This ledger answers
"what execution attempt ran, against which target, by whom, and how did
it finish?" without storing full payload bodies.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Protocol


@dataclass(frozen=True, slots=True)
class IntegrationExecutionRecord:
    id: str
    execution_kind: str
    target_type: str
    source_system: str
    status: str
    valid: bool
    organization_id: str | None = None
    workspace_id: str | None = None
    target_id: str | None = None
    target_name: str | None = None
    trigger_type: str | None = None
    actor_mode: str | None = None
    actor_id: str | None = None
    correlation_id: str | None = None
    attempt_number: int = 1
    message: str = ""
    error_code: str | None = None
    entity_counts: dict[str, int] = field(default_factory=dict)
    details: dict[str, object] = field(default_factory=dict)
    journal_entry_id: str | None = None
    started_at: datetime = field(default_factory=datetime.utcnow)
    finished_at: datetime = field(default_factory=datetime.utcnow)
    duration_ms: int = 0


class IntegrationExecutionRepository(Protocol):
    def save(
        self,
        record: IntegrationExecutionRecord,
    ) -> IntegrationExecutionRecord: ...

    def list_recent(
        self,
        limit: int = 50,
        *,
        organization_id: str | None = None,
        workspace_id: str | None = None,
        execution_kind: str | None = None,
        target_type: str | None = None,
        target_id: str | None = None,
        source_system: str | None = None,
        status: str | None = None,
    ) -> list[IntegrationExecutionRecord]: ...
