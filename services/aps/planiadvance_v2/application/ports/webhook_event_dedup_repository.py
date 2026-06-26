"""Port: idempotency dedup for inbound webhook calls.

External systems (Odoo, MES vendors, anything) retry on timeout or
network blip. Without dedup, the same POST executes the flow twice —
double-pushes to Odoo, double-imports a snapshot, etc. This port
records ``(token, idempotency_key)`` → ``run_id + body_hash`` so a
retry returns the original response instead of re-running the flow.

Stripe-style semantics: a same-key replay with the SAME body_hash
returns the cached response. A same-key replay with a DIFFERENT
body_hash is a key-reuse bug on the caller side and yields a 409 so
the vendor's incident response can catch the configuration drift.

Storage shape: ``(token, idempotency_key)`` is the composite key.
``body_hash`` is SHA-256 of the raw POST bytes (binds the cached
response to the exact request). ``run_id`` lets the vendor's audit
trail line up with our trace UI. ``recorded_at`` drives TTL purge.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Protocol


@dataclass(frozen=True, slots=True)
class WebhookEventRecord:
    token: str
    idempotency_key: str
    body_hash: str
    run_id: str | None
    status: str
    recorded_at: datetime


class WebhookEventDedupRepository(Protocol):
    def find(self, *, token: str, idempotency_key: str) -> WebhookEventRecord | None:
        """Return the cached record for (token, key) or None.

        Default-allow on unknown key: a missing record means the
        request has not been processed before. The route MUST treat
        ``None`` as "execute normally".
        """

    def record(
        self,
        *,
        token: str,
        idempotency_key: str,
        body_hash: str,
        run_id: str | None,
        status: str,
        recorded_at: datetime,
    ) -> None:
        """Persist the dedup row. Idempotent — a second record with
        the same (token, key) keeps the FIRST record (first-writer
        wins). Same contract as the SQL adapter's
        ``ON CONFLICT DO NOTHING``.
        """

    def purge_expired(self, *, now: datetime, max_age_hours: int) -> int:
        """Drop rows older than ``now - max_age_hours``.

        Once the TTL is past, a fresh-looking replay should be
        treated as a NEW request (the vendor's retry window has
        closed and any duplicate is probably operator-initiated).
        Returns the number of rows removed.
        """
