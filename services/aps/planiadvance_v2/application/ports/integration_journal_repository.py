"""Port: append-only journal of ERP/MES integration exchanges."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Protocol


@dataclass(frozen=True, slots=True)
class IntegrationJournalEntry:
    id: str
    action: str
    source_system: str
    status: str
    valid: bool
    organization_id: str | None = None
    workspace_id: str | None = None
    error_count: int = 0
    warning_count: int = 0
    entity_counts: dict[str, int] = field(default_factory=dict)
    details: dict[str, object] = field(default_factory=dict)
    created_at: datetime = field(default_factory=datetime.utcnow)


class IntegrationJournalRepository(Protocol):
    def save(self, entry: IntegrationJournalEntry) -> None: ...

    def list_recent(
        self,
        limit: int = 20,
        *,
        source_system: str | None = None,
        action: str | None = None,
        organization_id: str | None = None,
        workspace_id: str | None = None,
    ) -> list[IntegrationJournalEntry]: ...
