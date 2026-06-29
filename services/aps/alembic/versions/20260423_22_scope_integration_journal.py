"""scope integration journal by tenant and workspace

Revision ID: 20260423_22
Revises: 20260423_21
Create Date: 2026-04-23
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "20260423_22"
down_revision = "20260423_21"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "integration_journal",
        sa.Column("organization_id", sa.String(length=64), nullable=True),
    )
    op.add_column(
        "integration_journal",
        sa.Column("workspace_id", sa.String(length=64), nullable=True),
    )
    op.create_index(
        "ix_integration_journal_organization_id",
        "integration_journal",
        ["organization_id"],
    )
    op.create_index(
        "ix_integration_journal_workspace_id",
        "integration_journal",
        ["workspace_id"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_integration_journal_workspace_id",
        table_name="integration_journal",
    )
    op.drop_index(
        "ix_integration_journal_organization_id",
        table_name="integration_journal",
    )
    op.drop_column("integration_journal", "workspace_id")
    op.drop_column("integration_journal", "organization_id")
