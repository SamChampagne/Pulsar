"""add webhook_event_dedup

Revision ID: 20260522_34
Revises: 20260522_33
Create Date: 2026-05-22

V1.2 P3 webhook idempotency. The public webhook ingress route (slice
1/2) accepts retries from external vendors — Odoo, MES, anything — on
timeout / network blip. Without dedup, the same POST executes the
flow twice (double-pushes to Odoo, double-imports a snapshot).

This table stores ``(token, idempotency_key)`` → cached response so
a retry within the TTL returns the original run_id instead of
re-running the flow. ``body_hash`` is SHA-256 of the raw POST bytes;
a same-key replay with a different body is a key-reuse bug on the
caller side and yields a 409.
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "20260522_34"
down_revision = "20260522_33"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "webhook_event_dedup",
        sa.Column("token", sa.String(length=64), primary_key=True),
        sa.Column("idempotency_key", sa.String(length=128), primary_key=True),
        sa.Column("body_hash", sa.String(length=64), nullable=False),
        sa.Column("run_id", sa.String(length=64), nullable=True),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("recorded_at", sa.DateTime(), nullable=False),
    )
    op.create_index(
        "ix_webhook_event_dedup_recorded_at",
        "webhook_event_dedup",
        ["recorded_at"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_webhook_event_dedup_recorded_at",
        table_name="webhook_event_dedup",
    )
    op.drop_table("webhook_event_dedup")
