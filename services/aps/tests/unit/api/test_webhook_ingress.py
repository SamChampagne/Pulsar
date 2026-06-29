"""V1.2 P3 — public webhook ingress route.

POST /integration/webhooks/{token} lets an external system (typically
Odoo, but the design is connector-agnostic) push events to APS instead
of being polled. The token in the URL is the deterministic SHA-256
prefix of ``flow_id:block_id`` — NOT a secret. The HMAC-SHA256
signature in ``X-Webhook-Signature`` is what authenticates the call.

These tests pin the contract:

1. **Unknown token → 404** with a generic body that doesn't confirm
   which tokens are live. A brute-force probe sees the same response
   as a legitimately stale URL.
2. **No secret configured on the block → 403**. A trigger_webhook
   block with an empty secret is the explicit "endpoint disabled"
   state. Fail-closed: never run an unauthenticated trigger that
   could write to the plant.
3. **Missing X-Webhook-Signature header → 401**. The header is the
   only auth surface; absence is rejection.
4. **Wrong signature → 401**, computed in constant time to defeat
   timing attacks.
5. **Valid signature → 200**, the flow runs, and an
   ``integration.webhook_received`` audit event lands with the
   token + trigger block + run_id.

Slice 1 limits: the inbound payload bytes are signed and counted but
NOT yet plumbed through to downstream blocks. The trigger_webhook
block keeps emitting its placeholder ``trigger_event`` until the
follow-on slice wires the payload into ``_execute_block``.
"""

from __future__ import annotations

import hashlib
import hmac
from contextlib import asynccontextmanager
from datetime import datetime
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from planiadvance_v2.api.dependencies import (
    get_audit_event_repository,
    get_integration_flow_repository,
    get_run_integration_flow,
    get_webhook_event_dedup_repository,
)
from planiadvance_v2.api.routes import integration as integration_route
from planiadvance_v2.application.ports import (
    IntegrationFlow,
    IntegrationFlowBlock,
)
from planiadvance_v2.application.use_cases.webhook_token import (
    webhook_token_for,
)
from planiadvance_v2.infrastructure.in_memory.repositories import (
    InMemoryAuditEventRepository,
    InMemoryIntegrationFlowRepository,
    InMemoryWebhookEventDedupRepository,
)


class _CapturingRunner:
    """Records the RunIntegrationFlowInput the route forwards.

    Returns a minimal RunIntegrationFlowOutput-shaped object so the
    route can serialise the response without dragging the real
    use case (with all its DB-backed adapters) into the test."""

    def __init__(self) -> None:
        self.calls: list = []

    def execute(self, command):
        self.calls.append(command)
        return SimpleNamespace(
            flow=SimpleNamespace(
                id=command.flow_id,
                name="webhook-flow",
                source_system="erp",
                organization_id=command.organization_id,
                workspace_id=command.workspace_id,
                is_enabled=True,
                blocks=[],
                last_status="ok",
                last_message="ok",
                last_run_at=datetime(2026, 5, 22, 12, 0, 0),
                created_by_user_id=None,
                created_at=datetime(2026, 5, 22, 12, 0, 0),
                updated_at=datetime(2026, 5, 22, 12, 0, 0),
            ),
            status="ok",
            message="Flow completed",
            block_results=[],
            result={},
            execution_scope={
                "run_id": "run-webhook-1",
                "block_ids": [],
                "block_count": 0,
                "started_at": "2026-05-22T12:00:00",
                "completed_at": "2026-05-22T12:00:00",
                "final_block_id": None,
                "wall_time_ms": 0,
            },
            journal_entry=None,
        )


_FLOW_ID = "flow-webhook"
_BLOCK_ID = "trig-1"
_SECRET = "shared-secret-min-16-chars"
_TOKEN = webhook_token_for(flow_id=_FLOW_ID, block_id=_BLOCK_ID)


def _flow_with_webhook(secret: str | None) -> IntegrationFlow:
    config: dict[str, object] = {}
    if secret is not None:
        config["secret"] = secret
    return IntegrationFlow(
        id=_FLOW_ID,
        name="Webhook-driven flow",
        source_system="erp",
        organization_id="org-a",
        workspace_id="ws-a",
        is_enabled=True,
        blocks=[
            IntegrationFlowBlock(
                id=_BLOCK_ID,
                block_type="trigger_webhook",
                name="Inbound webhook",
                config=config,
            ),
        ],
    )


def _build_client(
    flow: IntegrationFlow | None,
) -> tuple[
    TestClient,
    _CapturingRunner,
    InMemoryAuditEventRepository,
    InMemoryWebhookEventDedupRepository,
]:
    app = FastAPI()
    app.include_router(integration_route.router)

    @asynccontextmanager
    async def _noop_lifespan(_app):
        yield

    app.router.lifespan_context = _noop_lifespan

    flows_repo = InMemoryIntegrationFlowRepository()
    if flow is not None:
        flows_repo.save(flow)
    runner = _CapturingRunner()
    audit = InMemoryAuditEventRepository()
    dedup = InMemoryWebhookEventDedupRepository()

    app.dependency_overrides[get_integration_flow_repository] = lambda: flows_repo
    app.dependency_overrides[get_run_integration_flow] = lambda: runner
    app.dependency_overrides[get_audit_event_repository] = lambda: audit
    app.dependency_overrides[get_webhook_event_dedup_repository] = lambda: dedup

    return TestClient(app), runner, audit, dedup


def _sign(secret: str, body: bytes) -> str:
    return "sha256=" + hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()


@pytest.fixture
def configured_client():
    return _build_client(_flow_with_webhook(_SECRET))


@pytest.fixture
def unsecured_client():
    return _build_client(_flow_with_webhook(None))


def test_unknown_token_returns_404(configured_client) -> None:
    """A token that doesn't resolve to any flow's trigger_webhook
    block returns a generic 404. The body must NOT echo any flow ids
    or hint at whether the token "almost matched"."""

    client, runner, audit, _dedup = configured_client
    response = client.post(
        "/integration/webhooks/0000000000000000",
        content=b"{}",
        headers={"X-Webhook-Signature": _sign(_SECRET, b"{}")},
    )

    assert response.status_code == 404
    assert response.json()["detail"]["error"] == "webhook_not_found"
    # The runner was never invoked — a 404 means the lookup failed
    # before the route had any business calling RunIntegrationFlow.
    assert runner.calls == []
    # No audit event for an unknown token: a brute-force scan must
    # not flood the audit log with spam.
    assert audit.list_recent() == []


def test_block_without_secret_returns_403(unsecured_client) -> None:
    """A trigger_webhook block with no configured secret means the
    operator has not yet enabled the public endpoint. Fail-closed:
    403 with a clear message, never dispatch the flow."""

    client, runner, _audit, _dedup = unsecured_client
    response = client.post(
        f"/integration/webhooks/{_TOKEN}",
        content=b"{}",
        headers={"X-Webhook-Signature": _sign(_SECRET, b"{}")},
    )

    assert response.status_code == 403
    assert response.json()["detail"]["error"] == "webhook_secret_required"
    assert runner.calls == []


def test_missing_signature_header_returns_401(configured_client) -> None:
    """The signature header IS the auth surface. Without it the
    server has no way to know the caller possesses the shared
    secret — 401."""

    client, runner, _audit, _dedup = configured_client
    response = client.post(
        f"/integration/webhooks/{_TOKEN}",
        content=b"{}",
    )

    assert response.status_code == 401
    assert response.json()["detail"]["error"] == "webhook_signature_missing"
    assert runner.calls == []


def test_wrong_signature_returns_401(configured_client) -> None:
    """A signature computed with the wrong secret must fail
    constant-time comparison. The 401 body must NOT echo back the
    expected signature (timing-attack hardening: if we leaked the
    expected value, the secret would be brute-forceable from one
    request)."""

    client, runner, _audit, _dedup = configured_client
    body = b'{"work_orders": []}'
    bad_signature = _sign("wrong-secret", body)
    response = client.post(
        f"/integration/webhooks/{_TOKEN}",
        content=body,
        headers={"X-Webhook-Signature": bad_signature},
    )

    assert response.status_code == 401
    assert response.json()["detail"]["error"] == "webhook_signature_invalid"
    # Sanity: the response message must NOT contain the real
    # signature digest (would let an attacker reverse-engineer the
    # secret from one failed request).
    expected = hmac.new(_SECRET.encode(), body, hashlib.sha256).hexdigest()
    assert expected not in response.text
    assert runner.calls == []


def test_valid_signature_invokes_flow_and_records_audit(
    configured_client,
) -> None:
    """Happy path: signed correctly → 200, flow dispatched, audit
    event emitted with the token + trigger block + run_id. The
    actor_details forwarded to RunIntegrationFlow must mark the
    source as "webhook" so the trace UI can distinguish from a
    Studio Run click."""

    client, runner, audit, _dedup = configured_client
    body = b'{"work_orders": [{"id": "WO-001"}]}'
    response = client.post(
        f"/integration/webhooks/{_TOKEN}",
        content=body,
        headers={"X-Webhook-Signature": _sign(_SECRET, body)},
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["flow_id"] == _FLOW_ID
    assert payload["run_id"] == "run-webhook-1"
    assert payload["status"] == "ok"

    # Runner received the correct flow + actor_details.
    assert len(runner.calls) == 1
    command = runner.calls[0]
    assert command.flow_id == _FLOW_ID
    assert command.organization_id == "org-a"
    assert command.workspace_id == "ws-a"
    assert command.actor_details["source"] == "webhook"
    assert command.actor_details["token"] == _TOKEN
    assert command.actor_details["block_id"] == _BLOCK_ID
    assert command.actor_details["body_bytes"] == len(body)

    # Audit row landed under the flow's organisation, not under any
    # logged-in user (the webhook caller has no tenant identity).
    events = audit.list_recent()
    assert len(events) == 1
    event = events[0]
    assert event.action == "integration.webhook_received"
    assert event.organization_id == "org-a"
    assert event.user_id is None
    assert event.subject == _FLOW_ID
    assert event.details["trigger_block_id"] == _BLOCK_ID
    assert event.details["run_id"] == "run-webhook-1"


def test_json_object_payload_threads_to_use_case(configured_client) -> None:
    """V1.2 P3 slice 2 — a JSON object body must arrive intact in
    RunIntegrationFlowInput.trigger_payload so downstream blocks can
    route on it. The actor_details ``payload_kind`` field also
    flips to ``json_object`` for ops observability (incident-response
    can grep "how many webhook calls today actually had a payload")."""

    client, runner, _audit, _dedup = configured_client
    body = b'{"work_orders": [{"id": "WO-001", "priority": "rush"}]}'
    response = client.post(
        f"/integration/webhooks/{_TOKEN}",
        content=body,
        headers={"X-Webhook-Signature": _sign(_SECRET, body)},
    )

    assert response.status_code == 200, response.text
    assert len(runner.calls) == 1
    command = runner.calls[0]
    assert command.trigger_payload == {
        "work_orders": [{"id": "WO-001", "priority": "rush"}]
    }
    assert command.actor_details["payload_kind"] == "json_object"


def test_non_json_body_falls_back_to_no_payload(configured_client) -> None:
    """Senders that POST non-JSON (HTML form, binary) are still
    accepted — the HMAC already authenticated them. The trigger_payload
    stays None so the trigger_webhook block falls back to its
    no-payload placeholder. actor_details.payload_kind = "non_json"
    so an audit query can flag legitimate-but-misconfigured senders."""

    client, runner, _audit, _dedup = configured_client
    body = b"not-json-at-all"
    response = client.post(
        f"/integration/webhooks/{_TOKEN}",
        content=body,
        headers={"X-Webhook-Signature": _sign(_SECRET, body)},
    )

    assert response.status_code == 200
    command = runner.calls[0]
    assert command.trigger_payload is None
    assert command.actor_details["payload_kind"] == "non_json"


def test_json_array_payload_is_wrapped_under_value(configured_client) -> None:
    """A JSON array is valid JSON but the trigger_webhook output
    contract expects an object (downstream blocks dereference
    $.payload.field). Wrap the raw value under a "value" key so the
    contract holds; senders that need direct access can still see
    {"payload": {"value": [...]}} consistently."""

    client, runner, _audit, _dedup = configured_client
    body = b'["WO-001", "WO-002"]'
    response = client.post(
        f"/integration/webhooks/{_TOKEN}",
        content=body,
        headers={"X-Webhook-Signature": _sign(_SECRET, body)},
    )

    assert response.status_code == 200
    command = runner.calls[0]
    assert command.trigger_payload == {"value": ["WO-001", "WO-002"]}
    assert command.actor_details["payload_kind"] == "json_wrapped"


def test_idempotency_key_replay_returns_cached_run_id(configured_client) -> None:
    """V1.2 P3 slice 3 — vendor retry semantics.

    A vendor that POSTs the same idempotency-key + same body twice
    (typical timeout+retry sequence) must see the FIRST run_id
    again, not a second freshly-dispatched run. Without this dedup,
    a push_schedule flow would double-write to Odoo on every
    network blip."""

    client, runner, _audit, dedup = configured_client
    body = b'{"order": "WO-001"}'
    headers = {
        "X-Webhook-Signature": _sign(_SECRET, body),
        "X-Webhook-Idempotency-Key": "vendor-event-42",
    }

    first = client.post(f"/integration/webhooks/{_TOKEN}", content=body, headers=headers)
    second = client.post(f"/integration/webhooks/{_TOKEN}", content=body, headers=headers)

    assert first.status_code == 200, first.text
    assert second.status_code == 200, second.text
    # Same run_id on both — the cached response wins.
    assert first.json()["run_id"] == second.json()["run_id"] == "run-webhook-1"
    # First response is fresh, second is the explicit replay flag.
    assert first.json()["idempotent_replay"] is False
    assert second.json()["idempotent_replay"] is True
    # The runner ran exactly once: the second POST short-circuited
    # at the dedup gate, never reaching RunIntegrationFlow.execute.
    assert len(runner.calls) == 1
    # The dedup row exists with the right shape: same token, same
    # key, body_hash bound to THIS body so a future drift surfaces
    # as the conflict path below.
    cached = dedup.find(token=_TOKEN, idempotency_key="vendor-event-42")
    assert cached is not None
    assert cached.run_id == "run-webhook-1"


def test_idempotency_key_with_mismatched_body_returns_409(
    configured_client,
) -> None:
    """Stripe-style key reuse detection. A caller that resubmits the
    same idempotency key but with a DIFFERENT body is almost
    certainly a configuration bug (e.g. accidentally hard-coded a
    constant key in their HTTP client). Returning 200 + the cached
    response would silently swallow whatever the new body was
    supposed to do. 409 surfaces the drift at the vendor's audit
    layer so their incident response can catch it."""

    client, runner, _audit, _dedup = configured_client

    def headers_for(body: bytes) -> dict[str, str]:
        return {
            "X-Webhook-Signature": _sign(_SECRET, body),
            "X-Webhook-Idempotency-Key": "vendor-event-99",
        }

    body_one = b'{"order": "WO-001"}'
    body_two = b'{"order": "WO-002"}'

    first = client.post(
        f"/integration/webhooks/{_TOKEN}",
        content=body_one,
        headers=headers_for(body_one),
    )
    assert first.status_code == 200
    # Same key, different body — 409.
    second = client.post(
        f"/integration/webhooks/{_TOKEN}",
        content=body_two,
        headers=headers_for(body_two),
    )
    assert second.status_code == 409
    assert second.json()["detail"]["error"] == "webhook_idempotency_conflict"
    # The second body NEVER reached the runner — exactly one flow
    # dispatch, the conflict rejection blocked the second one.
    assert len(runner.calls) == 1


def test_no_idempotency_key_bypasses_dedup(configured_client) -> None:
    """Senders that don't set the header keep the slice-1 behavior:
    every POST executes. The dedup table stays empty so a future
    sender that DOES start using the header sees a fresh state."""

    client, runner, _audit, dedup = configured_client
    body = b'{"order": "WO-001"}'
    headers = {"X-Webhook-Signature": _sign(_SECRET, body)}

    client.post(f"/integration/webhooks/{_TOKEN}", content=body, headers=headers)
    client.post(f"/integration/webhooks/{_TOKEN}", content=body, headers=headers)

    # Both POSTs dispatched the flow — no dedup short-circuit.
    assert len(runner.calls) == 2
    # The dedup repo was untouched (white-box on the test-only
    # store): legacy callers don't pollute the table.
    assert dedup._entries == {}  # noqa: SLF001 — white-box on test store


def test_per_token_rate_limit_returns_429(configured_client) -> None:
    """V1.2 P3 — per-token rate limit defends against a runaway vendor
    or a scanner brute-forcing the token. The bucket is keyed on the
    URL token so vendors don't share each other's quota; the limit
    fires BEFORE signature check so a scanner doesn't burn SQL on
    each probe."""

    client, runner, _audit, _dedup = configured_client
    from planiadvance_v2.api.security import _rate_limit_windows
    from planiadvance_v2.config import get_settings

    # The bucket is process-wide; reset only this token's slot so we
    # start from a clean count without disturbing other tests.
    _rate_limit_windows.pop(f"webhook:{_TOKEN}", None)

    settings = get_settings()
    original = settings.webhook_rate_limit_per_minute
    settings.webhook_rate_limit_per_minute = 3
    body = b"{}"
    headers = {"X-Webhook-Signature": _sign(_SECRET, body)}
    try:
        # 3 calls within the quota — all 200.
        for _ in range(3):
            ok = client.post(
                f"/integration/webhooks/{_TOKEN}",
                content=body,
                headers=headers,
            )
            assert ok.status_code == 200, ok.text
        # 4th call trips the limiter.
        over = client.post(
            f"/integration/webhooks/{_TOKEN}",
            content=body,
            headers=headers,
        )
        assert over.status_code == 429
        assert over.json()["detail"]["error"] == "rate_limit_exceeded"
    finally:
        settings.webhook_rate_limit_per_minute = original
        _rate_limit_windows.pop(f"webhook:{_TOKEN}", None)


def test_signature_uses_constant_time_compare(configured_client) -> None:
    """White-box: a single hex digit off in the signature must still
    fail. We don't measure wall-time here (flaky) but we DO assert
    the route rejects a 'close' digest just like a wildly-different
    one — which is the visible effect of compare_digest."""

    client, runner, _audit, _dedup = configured_client
    body = b"{}"
    correct = _sign(_SECRET, body)
    # Flip the last hex digit.
    tampered = correct[:-1] + ("0" if correct[-1] != "0" else "1")
    response = client.post(
        f"/integration/webhooks/{_TOKEN}",
        content=body,
        headers={"X-Webhook-Signature": tampered},
    )

    assert response.status_code == 401
    assert runner.calls == []
