"""Add workspaces for product-level planning organization.

Revision ID: 20260412_04
Revises: 20260412_03
Create Date: 2026-04-12
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "20260412_04"
down_revision = "20260412_03"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "workspaces",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("name", sa.String(length=128), nullable=False),
        sa.Column("description", sa.Text(), nullable=False, server_default=""),
        sa.Column("is_default", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.PrimaryKeyConstraint("id"),
    )
    op.execute(
        sa.text(
            """
            INSERT INTO workspaces (id, name, description, is_default, is_active)
            VALUES ('default', 'Default Workspace', 'Default planning workspace', true, true)
            """
        )
    )


def downgrade() -> None:
    op.drop_table("workspaces")
