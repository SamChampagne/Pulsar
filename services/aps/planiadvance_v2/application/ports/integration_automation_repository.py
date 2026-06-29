"""Port: persisted ERP/MES automation jobs.

Automation jobs describe how external systems should exchange data with the
APS. The MVP records configuration and manual runs; a worker can later execute
the same jobs without changing the API contract.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Protocol


@dataclass(slots=True)
class IntegrationAutomationJob:
    id: str
    name: str
    direction: str
    trigger_type: str
    source_system: str
    organization_id: str | None = None
    workspace_id: str | None = None
    is_enabled: bool = True
    config: dict[str, object] = field(default_factory=dict)
    last_status: str | None = None
    last_message: str | None = None
    last_run_at: datetime | None = None
    lock_owner: str | None = None
    locked_until: datetime | None = None
    attempt_count: int = 0
    next_attempt_at: datetime | None = None
    last_error_code: str | None = None
    last_error_at: datetime | None = None
    created_at: datetime = field(default_factory=datetime.utcnow)
    updated_at: datetime = field(default_factory=datetime.utcnow)


class IntegrationAutomationRepository(Protocol):
    def save(self, job: IntegrationAutomationJob) -> IntegrationAutomationJob: ...

    def get(
        self,
        job_id: str,
        *,
        organization_id: str | None = None,
    ) -> IntegrationAutomationJob | None: ...

    def list_for_scope(
        self,
        *,
        organization_id: str | None = None,
        workspace_id: str | None = None,
        limit: int = 50,
    ) -> list[IntegrationAutomationJob]: ...

    def try_claim(
        self,
        job_id: str,
        *,
        owner_id: str,
        locked_until: datetime,
        now: datetime,
        organization_id: str | None = None,
    ) -> IntegrationAutomationJob | None: ...

    def release_claim(
        self,
        job_id: str,
        *,
        owner_id: str,
        now: datetime,
        organization_id: str | None = None,
    ) -> IntegrationAutomationJob | None: ...
