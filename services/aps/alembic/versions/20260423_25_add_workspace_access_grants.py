"""add workspace access grants

Revision ID: 20260423_25
Revises: 20260423_24
Create Date: 2026-04-23 23:59:00
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "20260423_25"
down_revision = "20260423_24"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "workspace_access_grants",
        sa.Column("workspace_id", sa.String(length=64), nullable=False),
        sa.Column("user_id", sa.String(length=64), nullable=False),
        sa.Column("organization_id", sa.String(length=64), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["user_accounts.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("workspace_id", "user_id"),
        sa.UniqueConstraint("workspace_id", "user_id", name="uq_workspace_access_grant"),
    )
    op.create_index(
        op.f("ix_workspace_access_grants_organization_id"),
        "workspace_access_grants",
        ["organization_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_workspace_access_grants_user_id"),
        "workspace_access_grants",
        ["user_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        op.f("ix_workspace_access_grants_user_id"),
        table_name="workspace_access_grants",
    )
    op.drop_index(
        op.f("ix_workspace_access_grants_organization_id"),
        table_name="workspace_access_grants",
    )
    op.drop_table("workspace_access_grants")
