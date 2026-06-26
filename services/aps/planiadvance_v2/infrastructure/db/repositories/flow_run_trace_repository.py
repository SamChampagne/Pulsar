from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from ....application.ports.flow_run_trace_repository import FlowRunTrace
from ..models.flow_run_trace_model import FlowRunTraceModel


def _to_dataclass(row: FlowRunTraceModel) -> FlowRunTrace:
    return FlowRunTrace(
        id=row.id,
        flow_id=row.flow_id,
        run_id=row.run_id,
        block_id=row.block_id,
        block_type=row.block_type,
        status=row.status,
        duration_ms=row.duration_ms,
        error_message=row.error_message,
        organization_id=row.organization_id,
        workspace_id=row.workspace_id,
        input_payload=dict(row.input_payload or {}),
        output_payload=dict(row.output_payload or {}),
        started_at=row.started_at,
    )


class SqlFlowRunTraceRepository:
    def __init__(self, session: Session) -> None:
        self._session = session

    def save_many(self, traces: list[FlowRunTrace]) -> None:
        if not traces:
            return
        self._session.add_all(
            [
                FlowRunTraceModel(
                    id=t.id,
                    organization_id=t.organization_id,
                    workspace_id=t.workspace_id,
                    flow_id=t.flow_id,
                    run_id=t.run_id,
                    block_id=t.block_id,
                    block_type=t.block_type,
                    status=t.status,
                    duration_ms=t.duration_ms,
                    error_message=t.error_message,
                    input_payload=dict(t.input_payload or {}),
                    output_payload=dict(t.output_payload or {}),
                    started_at=t.started_at,
                )
                for t in traces
            ]
        )
        self._session.flush()

    def list_for_run(
        self,
        *,
        flow_id: str,
        run_id: str,
        organization_id: str | None = None,
        workspace_id: str | None = None,
    ) -> list[FlowRunTrace]:
        stmt = select(FlowRunTraceModel).where(
            FlowRunTraceModel.flow_id == flow_id,
            FlowRunTraceModel.run_id == run_id,
        )
        if organization_id is not None:
            stmt = stmt.where(FlowRunTraceModel.organization_id == organization_id)
        if workspace_id is not None:
            stmt = stmt.where(FlowRunTraceModel.workspace_id == workspace_id)
        stmt = stmt.order_by(FlowRunTraceModel.started_at.asc())
        return [_to_dataclass(row) for row in self._session.execute(stmt).scalars()]
