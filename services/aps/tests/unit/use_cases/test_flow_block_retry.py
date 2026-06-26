"""Phase 7 — per-block retry policy. Runner re-runs `_execute_block` up to
`retry_max_attempts` times, sleeping `retry_backoff_seconds * (attempt-1)`
between tries. Exhausted retries route to the error edge (Slice B) or fail
the flow (legacy)."""

from __future__ import annotations

import pytest

from planiadvance_v2.application.ports import (
    IntegrationFlow,
    IntegrationFlowBlock,
)
from planiadvance_v2.application.use_cases.integration_flows import (
    _run_block_with_retry,
)


class _FakeRunner:
    """Stand-in for RunIntegrationFlow that records calls and raises N times."""

    def __init__(self, *, raise_count: int):
        self._raise_count = raise_count
        self.call_count = 0

    def _execute_block(
        self,
        *,
        flow,
        block,
        input_value,
        organization_id,
        workspace_id,
        trigger_payload=None,
    ):
        self.call_count += 1
        if self.call_count <= self._raise_count:
            raise RuntimeError(f"flake #{self.call_count}")
        return ({"kind": "ok", "attempt": self.call_count}, "ready", "ok")


def _block(
    *, max_attempts: int = 1, backoff_seconds: float = 0.0
) -> IntegrationFlowBlock:
    return IntegrationFlowBlock(
        id="b1",
        block_type="call_connector_api",
        config={
            "retry_max_attempts": max_attempts,
            "retry_backoff_seconds": backoff_seconds,
        },
    )


def _flow_with(block):
    return IntegrationFlow(
        id="f", name="retry test", source_system="studio_v2", blocks=[block]
    )


def test_retry_succeeds_on_third_attempt():
    runner = _FakeRunner(raise_count=2)
    block = _block(max_attempts=3, backoff_seconds=0.0)
    output, status, _message = _run_block_with_retry(
        runner,
        flow=_flow_with(block),
        block=block,
        input_value=None,
        organization_id=None,
        workspace_id=None,
    )
    assert runner.call_count == 3
    assert status == "ready"
    assert output["kind"] == "ok"


def test_retry_default_is_single_attempt():
    """No retry config = 1 attempt, raise propagates."""
    runner = _FakeRunner(raise_count=1)
    block = IntegrationFlowBlock(id="b1", block_type="call_connector_api")
    with pytest.raises(RuntimeError):
        _run_block_with_retry(
            runner,
            flow=_flow_with(block),
            block=block,
            input_value=None,
            organization_id=None,
            workspace_id=None,
        )
    assert runner.call_count == 1


def test_retry_exhaustion_raises_last_exception():
    runner = _FakeRunner(raise_count=999)
    block = _block(max_attempts=3, backoff_seconds=0.0)
    with pytest.raises(RuntimeError):
        _run_block_with_retry(
            runner,
            flow=_flow_with(block),
            block=block,
            input_value=None,
            organization_id=None,
            workspace_id=None,
        )
    assert runner.call_count == 3


def test_retry_calls_sleep_with_increasing_backoff(monkeypatch):
    sleeps: list[float] = []
    monkeypatch.setattr(
        "planiadvance_v2.application.use_cases.integration_flows.time.sleep",
        lambda s: sleeps.append(s),
    )
    runner = _FakeRunner(raise_count=2)
    block = _block(max_attempts=3, backoff_seconds=0.5)
    _run_block_with_retry(
        runner,
        flow=_flow_with(block),
        block=block,
        input_value=None,
        organization_id=None,
        workspace_id=None,
    )
    # Two failures → two sleeps. Linear backoff: 0.5*1=0.5, 0.5*2=1.0.
    assert sleeps == [0.5, 1.0]
