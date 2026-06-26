"""Port: persisted per-block traces of an integration flow run.

Each row captures one block's slice of one run: which inputs the block
saw, which outputs it produced, status, duration, and any error message.
Traces are written by `RunIntegrationFlow.execute` after the run
completes; the Studio v2 UI reads them back hours later via
``GET /integration/flows/{flow_id}/runs/{run_id}/trace`` to populate
the bottom-panel Input/Output/Logs tabs.

Sensitive fields are masked server-side (see ``_flow_trace_masking``)
before they ever reach this repository — the UI cannot un-mask.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Protocol


@dataclass(frozen=True, slots=True)
class FlowRunTrace:
    id: str
    flow_id: str
    run_id: str
    block_id: str
    block_type: str
    status: str  # ok | failed | skipped
    duration_ms: int = 0
    error_message: str | None = None
    organization_id: str | None = None
    workspace_id: str | None = None
    input_payload: dict[str, object] = field(default_factory=dict)
    output_payload: dict[str, object] = field(default_factory=dict)
    started_at: datetime = field(default_factory=datetime.utcnow)


class FlowRunTraceRepository(Protocol):
    def save_many(self, traces: list[FlowRunTrace]) -> None: ...

    def list_for_run(
        self,
        *,
        flow_id: str,
        run_id: str,
        organization_id: str | None = None,
        workspace_id: str | None = None,
    ) -> list[FlowRunTrace]: ...
