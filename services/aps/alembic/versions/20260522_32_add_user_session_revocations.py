"""add user_session_revocations

Revision ID: 20260522_32
Revises: 20260518_31
Create Date: 2026-05-22

V1.2 P3.2b — admin-initiated session revocation. Hash-keyed
``revoked_auth_tokens`` (revision 31) only revokes one bearer at a
time; this table covers the "log everyone out NOW for user X" path
without enumerating their outstanding token hashes.

One row per user (PK). ``revoked_before_iat`` is the signed-iat
cutoff: tokens with ``iat`` strictly older than this are treated as
revoked. ``revoked_at`` is informational (audit trail).
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "20260522_32"
down_revision = "20260518_31"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "user_session_revocations",
        sa.Column("user_id", sa.String(length=64), primary_key=True),
        sa.Column("revoked_before_iat", sa.DateTime(), nullable=False),
        sa.Column("revoked_at", sa.DateTime(), nullable=False),
    )
    op.create_index(
        "ix_user_session_revocations_revoked_before_iat",
        "user_session_revocations",
        ["revoked_before_iat"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_user_session_revocations_revoked_before_iat",
        table_name="user_session_revocations",
    )
    op.drop_table("user_session_revocations")
