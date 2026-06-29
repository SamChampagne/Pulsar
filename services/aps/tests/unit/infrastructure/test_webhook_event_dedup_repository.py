"""V1.2 P3 — in-memory WebhookEventDedupRepository contract.

The HTTP-layer idempotency tests prove the end-to-end story; this
file pins the repository contract on its own. A future SQL or
Redis implementation must satisfy the same shape: default-allow
on unknown (token, key), first-writer wins, body_hash binds the
cached response to the exact request, purge by recorded_at age.
"""

from __future__ import annotations

from datetime import datetime, timedelta

from planiadvance_v2.infrastructure.in_memory.repositories import (
    InMemoryWebhookEventDedupRepository,
)


def test_find_returns_none_for_unknown_key() -> None:
    """Default-allow on unknown keys. A fresh idempotency key must
    be treated as "execute normally"; a regression that returned a
    sentinel here would mass-block legitimate first-time webhook
    calls."""

    repo = InMemoryWebhookEventDedupRepository()
    assert repo.find(token="t1", idempotency_key="never-seen") is None


def test_record_then_find_round_trips_fields() -> None:
    repo = InMemoryWebhookEventDedupRepository()
    now = datetime(2026, 5, 22, 12, 0, 0)
    repo.record(
        token="abc",
        idempotency_key="key-1",
        body_hash="hash-abc",
        run_id="run-7",
        status="completed",
        recorded_at=now,
    )
    record = repo.find(token="abc", idempotency_key="key-1")
    assert record is not None
    assert record.run_id == "run-7"
    assert record.body_hash == "hash-abc"
    assert record.status == "completed"
    assert record.recorded_at == now


def test_record_is_first_writer_wins() -> None:
    """A retried record() call MUST NOT overwrite the original.
    Two simultaneous vendor retries that race to insert: the first
    wins, the second is a no-op, and a subsequent find() always
    sees the FIRST run_id. This contract is what makes the route's
    'return cached response' correct under concurrent retries."""

    repo = InMemoryWebhookEventDedupRepository()
    now = datetime(2026, 5, 22, 12, 0, 0)
    repo.record(
        token="t",
        idempotency_key="k",
        body_hash="h1",
        run_id="run-first",
        status="completed",
        recorded_at=now,
    )
    repo.record(
        token="t",
        idempotency_key="k",
        body_hash="h2",
        run_id="run-second",
        status="failed",
        recorded_at=now + timedelta(seconds=1),
    )
    record = repo.find(token="t", idempotency_key="k")
    assert record is not None
    assert record.run_id == "run-first"
    assert record.body_hash == "h1"


def test_token_scopes_the_key_space() -> None:
    """Two flows can legitimately use the SAME idempotency_key
    without colliding — they're scoped under their respective
    tokens. A regression that ignored token would conflate
    independent flows."""

    repo = InMemoryWebhookEventDedupRepository()
    now = datetime(2026, 5, 22, 12, 0, 0)
    repo.record(
        token="flow-a",
        idempotency_key="key",
        body_hash="hA",
        run_id="run-a",
        status="completed",
        recorded_at=now,
    )
    repo.record(
        token="flow-b",
        idempotency_key="key",
        body_hash="hB",
        run_id="run-b",
        status="completed",
        recorded_at=now,
    )
    a = repo.find(token="flow-a", idempotency_key="key")
    b = repo.find(token="flow-b", idempotency_key="key")
    assert a is not None and a.run_id == "run-a"
    assert b is not None and b.run_id == "run-b"


def test_purge_expired_drops_old_rows() -> None:
    """Once the TTL is past, a fresh-looking replay should be
    treated as a NEW request — the vendor's retry window has
    closed. The purge call keeps the table bounded without a
    separate scheduled job; the route runs it opportunistically
    after every successful dispatch."""

    repo = InMemoryWebhookEventDedupRepository()
    base = datetime(2026, 5, 22, 12, 0, 0)
    repo.record(
        token="t",
        idempotency_key="stale",
        body_hash="h",
        run_id="r",
        status="completed",
        recorded_at=base - timedelta(hours=48),
    )
    repo.record(
        token="t",
        idempotency_key="fresh",
        body_hash="h",
        run_id="r2",
        status="completed",
        recorded_at=base - timedelta(hours=1),
    )

    removed = repo.purge_expired(now=base, max_age_hours=24)

    assert removed == 1
    assert repo.find(token="t", idempotency_key="stale") is None
    assert repo.find(token="t", idempotency_key="fresh") is not None
