"""Add runtime locks for integration automation jobs.

Revision ID: 20260423_18
Revises: 20260423_17
Create Date: 2026-04-23
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "20260423_18"
down_revision = "20260423_17"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing = {column["name"] for column in inspector.get_columns("integration_automation_jobs")}
    if "lock_owner" not in existing:
        op.add_column(
            "integration_automation_jobs",
            sa.Column("lock_owner", sa.String(length=128), nullable=True),
        )
    if "locked_until" not in existing:
        op.add_column(
            "integration_automation_jobs",
            sa.Column("locked_until", sa.DateTime(), nullable=True),
        )
        op.create_index(
            "ix_integration_automation_jobs_locked_until",
            "integration_automation_jobs",
            ["locked_until"],
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing = {column["name"] for column in inspector.get_columns("integration_automation_jobs")}
    indexes = {index["name"] for index in inspector.get_indexes("integration_automation_jobs")}
    if "locked_until" in existing:
        if "ix_integration_automation_jobs_locked_until" in indexes:
            op.drop_index(
                "ix_integration_automation_jobs_locked_until",
                table_name="integration_automation_jobs",
            )
        op.drop_column("integration_automation_jobs", "locked_until")
    if "lock_owner" in existing:
        op.drop_column("integration_automation_jobs", "lock_owner")
