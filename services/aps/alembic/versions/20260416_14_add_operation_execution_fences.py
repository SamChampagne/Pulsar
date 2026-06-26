"""Add operation execution and planning fence fields.

Revision ID: 20260416_14
Revises: 20260416_13
Create Date: 2026-04-16
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "20260416_14"
down_revision = "20260416_13"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("operations", sa.Column("actual_start", sa.DateTime(), nullable=True))
    op.add_column("operations", sa.Column("actual_end", sa.DateTime(), nullable=True))
    op.add_column(
        "operations",
        sa.Column("remaining_duration_minutes", sa.Integer(), nullable=True),
    )
    op.add_column("operations", sa.Column("firm_until", sa.DateTime(), nullable=True))
    op.add_column("operations", sa.Column("frozen_until", sa.DateTime(), nullable=True))


def downgrade() -> None:
    op.drop_column("operations", "frozen_until")
    op.drop_column("operations", "firm_until")
    op.drop_column("operations", "remaining_duration_minutes")
    op.drop_column("operations", "actual_end")
    op.drop_column("operations", "actual_start")
