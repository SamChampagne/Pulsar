"""Add integration journal for ERP/MES exchanges.

Revision ID: 20260414_08
Revises: 20260414_07
Create Date: 2026-04-14
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "20260414_08"
down_revision = "20260414_07"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "integration_journal" in inspector.get_table_names():
        return
    op.create_table(
        "integration_journal",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("action", sa.String(length=32), nullable=False),
        sa.Column("source_system", sa.String(length=64), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("valid", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("error_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("warning_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column(
            "entity_counts",
            sa.JSON(),
            nullable=False,
            server_default=sa.text("'{}'::json"),
        ),
        sa.Column(
            "details",
            sa.JSON(),
            nullable=False,
            server_default=sa.text("'{}'::json"),
        ),
        sa.Column(
            "created_at",
            sa.DateTime(),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
    )
    op.create_index(
        "ix_integration_journal_action",
        "integration_journal",
        ["action"],
        unique=False,
    )
    op.create_index(
        "ix_integration_journal_source_system",
        "integration_journal",
        ["source_system"],
        unique=False,
    )
    op.create_index(
        "ix_integration_journal_status",
        "integration_journal",
        ["status"],
        unique=False,
    )
    op.create_index(
        "ix_integration_journal_created_at",
        "integration_journal",
        ["created_at"],
        unique=False,
    )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "integration_journal" not in inspector.get_table_names():
        return
    op.drop_index("ix_integration_journal_created_at", table_name="integration_journal")
    op.drop_index("ix_integration_journal_status", table_name="integration_journal")
    op.drop_index("ix_integration_journal_source_system", table_name="integration_journal")
    op.drop_index("ix_integration_journal_action", table_name="integration_journal")
    op.drop_table("integration_journal")
