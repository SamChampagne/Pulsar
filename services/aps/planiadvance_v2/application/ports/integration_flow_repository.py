"""Port: persisted integration flow definitions for block-based orchestration."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Protocol


@dataclass(slots=True)
class FlowBlockInput:
    """One incoming DAG edge into a flow block.

    Phase 6 introduces typed edges. Legacy linear flows keep using
    ``IntegrationFlowBlock.input_block_id`` (single edge, edge_type='data');
    DAG-aware blocks (logic_branch_*, logic_merge, and their downstreams)
    populate the ``inputs`` list instead.
    """

    source_block_id: str
    edge_type: str = "data"  # data | branch_true | branch_false | branch_case
    case_value: str | None = None  # populated for edge_type='branch_case'


@dataclass(slots=True)
class IntegrationFlowBlock:
    id: str
    block_type: str
    name: str | None = None
    input_block_id: str | None = None
    inputs: list[FlowBlockInput] = field(default_factory=list)
    config: dict[str, object] = field(default_factory=dict)


@dataclass(slots=True)
class IntegrationFlow:
    id: str
    name: str
    source_system: str
    organization_id: str | None = None
    workspace_id: str | None = None
    is_enabled: bool = True
    blocks: list[IntegrationFlowBlock] = field(default_factory=list)
    last_status: str | None = None
    last_message: str | None = None
    last_run_at: datetime | None = None
    created_by_user_id: str | None = None
    created_at: datetime = field(default_factory=datetime.utcnow)
    updated_at: datetime = field(default_factory=datetime.utcnow)


class IntegrationFlowRepository(Protocol):
    def save(self, flow: IntegrationFlow) -> IntegrationFlow: ...

    def get(
        self,
        flow_id: str,
        *,
        organization_id: str | None = None,
    ) -> IntegrationFlow | None: ...

    def list_for_scope(
        self,
        *,
        organization_id: str | None = None,
        workspace_id: str | None = None,
        limit: int = 50,
    ) -> list[IntegrationFlow]: ...

    def find_by_webhook_token(
        self, token: str
    ) -> tuple[IntegrationFlow, IntegrationFlowBlock] | None:
        """Resolve a public webhook token to the flow + trigger block.

        V1.2 P3 webhook ingress. The token is the deterministic
        16-char SHA-256 prefix of ``f"{flow_id}:{block_id}"`` produced
        by :func:`webhook_token.webhook_token_for`. Returns the owning
        flow + its ``trigger_webhook`` block so the route can pull
        the HMAC secret from the block's config before authenticating
        the inbound call.

        Returns ``None`` when no matching block exists — the route
        MUST treat this as 404 (same response as a bad-token brute
        force, never confirms which tokens are live).
        """
        ...
