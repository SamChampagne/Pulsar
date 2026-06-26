"""Add retry state for integration automation jobs.

Revision ID: 20260423_19
Revises: 20260423_18
Create Date: 2026-04-23
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "20260423_19"
down_revision = "20260423_18"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing = {column["name"] for column in inspector.get_columns("integration_automation_jobs")}
    if "attempt_count" not in existing:
        op.add_column(
            "integration_automation_jobs",
            sa.Column("attempt_count", sa.Integer(), nullable=False, server_default="0"),
        )
        op.alter_column("integration_automation_jobs", "attempt_count", server_default=None)
    if "next_attempt_at" not in existing:
        op.add_column(
            "integration_automation_jobs",
            sa.Column("next_attempt_at", sa.DateTime(), nullable=True),
        )
        op.create_index(
            "ix_integration_automation_jobs_next_attempt_at",
            "integration_automation_jobs",
            ["next_attempt_at"],
        )
    if "last_error_code" not in existing:
        op.add_column(
            "integration_automation_jobs",
            sa.Column("last_error_code", sa.String(length=64), nullable=True),
        )
    if "last_error_at" not in existing:
        op.add_column(
            "integration_automation_jobs",
            sa.Column("last_error_at", sa.DateTime(), nullable=True),
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing = {column["name"] for column in inspector.get_columns("integration_automation_jobs")}
    indexes = {index["name"] for index in inspector.get_indexes("integration_automation_jobs")}
    if "last_error_at" in existing:
        op.drop_column("integration_automation_jobs", "last_error_at")
    if "last_error_code" in existing:
        op.drop_column("integration_automation_jobs", "last_error_code")
    if "next_attempt_at" in existing:
        if "ix_integration_automation_jobs_next_attempt_at" in indexes:
            op.drop_index(
                "ix_integration_automation_jobs_next_attempt_at",
                table_name="integration_automation_jobs",
            )
        op.drop_column("integration_automation_jobs", "next_attempt_at")
    if "attempt_count" in existing:
        op.drop_column("integration_automation_jobs", "attempt_count")
