"""add revoked_auth_tokens

Revision ID: 20260518_31
Revises: 20260510_30
Create Date: 2026-05-18

V1.2 P3 — session revocation. The v1 planner session token is a
stateless HMAC-signed claim that cannot be invalidated before its
``exp`` claim. POST /auth/logout used to be a no-op stub; this
migration introduces the persistence layer that makes "logout"
actually invalidate the bearer.

Stores SHA-256 hashes only (never raw tokens). ``expires_at`` mirrors
the token's signed ``exp`` so a periodic purge can drop entries that
would already fail signature verification.
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "20260518_31"
down_revision = "20260510_30"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "revoked_auth_tokens",
        sa.Column("token_hash", sa.String(length=64), primary_key=True),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.Column("revoked_at", sa.DateTime(), nullable=False),
    )
    op.create_index(
        "ix_revoked_auth_tokens_expires_at",
        "revoked_auth_tokens",
        ["expires_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_revoked_auth_tokens_expires_at", table_name="revoked_auth_tokens")
    op.drop_table("revoked_auth_tokens")
