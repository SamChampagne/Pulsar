"""add integration flows

Revision ID: 20260423_24
Revises: 20260423_23
Create Date: 2026-04-23 23:45:00
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "20260423_24"
down_revision = "20260423_23"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "integration_flows",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("organization_id", sa.String(length=64), nullable=True),
        sa.Column("workspace_id", sa.String(length=64), nullable=True),
        sa.Column("name", sa.String(length=128), nullable=False),
        sa.Column("source_system", sa.String(length=64), nullable=False),
        sa.Column("is_enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("blocks", sa.JSON(), nullable=False),
        sa.Column("last_status", sa.String(length=32), nullable=True),
        sa.Column("last_message", sa.String(length=512), nullable=True),
        sa.Column("last_run_at", sa.DateTime(), nullable=True),
        sa.Column("created_by_user_id", sa.String(length=64), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_integration_flows_organization_id"),
        "integration_flows",
        ["organization_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_integration_flows_workspace_id"),
        "integration_flows",
        ["workspace_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_integration_flows_source_system"),
        "integration_flows",
        ["source_system"],
        unique=False,
    )
    op.create_index(
        op.f("ix_integration_flows_created_at"),
        "integration_flows",
        ["created_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_integration_flows_created_at"), table_name="integration_flows")
    op.drop_index(op.f("ix_integration_flows_source_system"), table_name="integration_flows")
    op.drop_index(op.f("ix_integration_flows_workspace_id"), table_name="integration_flows")
    op.drop_index(
        op.f("ix_integration_flows_organization_id"),
        table_name="integration_flows",
    )
    op.drop_table("integration_flows")
