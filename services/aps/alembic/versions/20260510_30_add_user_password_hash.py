"""add password_hash to user_accounts

Revision ID: 20260510_30
Revises: 20260507_29
Create Date: 2026-05-10

Real-auth slice 1 — store a bcrypt hash per user so /auth/login can
verify a password instead of granting a session to anyone who knows
the user id. Nullable on this migration: existing demo / pilot
accounts keep working on selector login until they get a password
set via the admin flow (slice 3) or via auth_seed_password on
bootstrap.
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "20260510_30"
down_revision = "20260507_29"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "user_accounts",
        sa.Column("password_hash", sa.String(length=128), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("user_accounts", "password_hash")
