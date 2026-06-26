"""Add operation actual machine field.

Revision ID: 20260416_15
Revises: 20260416_14
Create Date: 2026-04-16
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "20260416_15"
down_revision = "20260416_14"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "operations",
        sa.Column("actual_machine_id", sa.String(64), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("operations", "actual_machine_id")
