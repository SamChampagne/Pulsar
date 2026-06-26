from __future__ import annotations

from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from ....application.ports import FlowBlockInput, IntegrationFlow, IntegrationFlowBlock
from ...scoping import ScopedRepositoryMixin
from ..models import IntegrationFlowModel


class SqlIntegrationFlowRepository(ScopedRepositoryMixin[IntegrationFlow]):
    def __init__(self, session: Session) -> None:
        self._session = session

    def save(self, flow: IntegrationFlow) -> IntegrationFlow:
        now = datetime.utcnow()
        row = IntegrationFlowModel(
            id=flow.id,
            organization_id=flow.organization_id,
            workspace_id=flow.workspace_id,
            name=flow.name,
            source_system=flow.source_system,
            is_enabled=flow.is_enabled,
            blocks=[self._block_to_json(block) for block in flow.blocks],
            last_status=flow.last_status,
            last_message=flow.last_message,
            last_run_at=flow.last_run_at,
            created_by_user_id=flow.created_by_user_id,
            created_at=flow.created_at,
            updated_at=now,
        )
        merged = self._session.merge(row)
        self._session.flush()
        return self._to_port(merged)

    def get(
        self,
        flow_id: str,
        *,
        organization_id: str | None = None,
    ) -> IntegrationFlow | None:
        stmt = select(IntegrationFlowModel).where(IntegrationFlowModel.id == flow_id)
        if organization_id is not None:
            stmt = stmt.where(IntegrationFlowModel.organization_id == organization_id)
        row = self._session.execute(stmt).scalar_one_or_none()
        return self._to_port(row) if row else None

    def list_for_scope(
        self,
        *,
        organization_id: str | None = None,
        workspace_id: str | None = None,
        limit: int = 50,
    ) -> list[IntegrationFlow]:
        stmt = select(IntegrationFlowModel).order_by(IntegrationFlowModel.created_at.desc())
        if organization_id is not None:
            stmt = stmt.where(IntegrationFlowModel.organization_id == organization_id)
        if workspace_id is not None:
            stmt = stmt.where(IntegrationFlowModel.workspace_id == workspace_id)
        rows = self._session.execute(stmt.limit(limit)).scalars().all()
        return [self._to_port(row) for row in rows]

    def find_by_webhook_token(
        self, token: str
    ) -> tuple[IntegrationFlow, IntegrationFlowBlock] | None:
        # The webhook token is the SHA-256 prefix of ``{flow_id}:{block_id}``,
        # which we cannot reverse. Enumerate the (small) set of flows
        # carrying a trigger_webhook block and match by computed token.
        # Volumes stay tractable: a planning floor has dozens of flows,
        # not thousands, and the JSON ``blocks`` field is small. If
        # volumes ever grow we precompute a token→(flow_id, block_id)
        # lookup table on save; the port shape already supports that.
        from ....application.use_cases.webhook_token import webhook_token_for

        stmt = select(IntegrationFlowModel)
        rows = self._session.execute(stmt).scalars().all()
        for row in rows:
            flow = self._to_port(row)
            for block in flow.blocks:
                if block.block_type != "trigger_webhook":
                    continue
                candidate = webhook_token_for(flow_id=flow.id, block_id=block.id)
                if candidate == token:
                    return flow, block
        return None

    @staticmethod
    def _block_to_json(block: IntegrationFlowBlock) -> dict[str, object]:
        return {
            "id": block.id,
            "block_type": block.block_type,
            "name": block.name,
            "input_block_id": block.input_block_id,
            "inputs": [
                {
                    "source_block_id": edge.source_block_id,
                    "edge_type": edge.edge_type,
                    "case_value": edge.case_value,
                }
                for edge in block.inputs
            ],
            "config": dict(block.config),
        }

    @classmethod
    def _to_port(cls, row: IntegrationFlowModel) -> IntegrationFlow:
        return IntegrationFlow(
            id=row.id,
            organization_id=row.organization_id,
            workspace_id=row.workspace_id,
            name=row.name,
            source_system=row.source_system,
            is_enabled=row.is_enabled,
            blocks=[
                IntegrationFlowBlock(
                    id=str(block.get("id", "")),
                    block_type=str(block.get("block_type", "")),
                    name=(
                        str(block["name"])
                        if block.get("name") is not None
                        else None
                    ),
                    input_block_id=(
                        str(block["input_block_id"])
                        if block.get("input_block_id") is not None
                        else None
                    ),
                    inputs=[
                        FlowBlockInput(
                            source_block_id=str(edge.get("source_block_id", "")),
                            edge_type=str(edge.get("edge_type", "data")),
                            case_value=(
                                str(edge["case_value"])
                                if edge.get("case_value") is not None
                                else None
                            ),
                        )
                        for edge in (block.get("inputs") or [])
                        if isinstance(edge, dict)
                    ],
                    config=(
                        dict(block.get("config", {}))
                        if isinstance(block.get("config"), dict)
                        else {}
                    ),
                )
                for block in row.blocks or []
                if isinstance(block, dict)
            ],
            last_status=row.last_status,
            last_message=row.last_message,
            last_run_at=row.last_run_at,
            created_by_user_id=row.created_by_user_id,
            created_at=row.created_at,
            updated_at=row.updated_at,
        )
