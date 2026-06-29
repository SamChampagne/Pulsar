"""Add integration automation jobs.

Revision ID: 20260420_16
Revises: 20260416_15
Create Date: 2026-04-20
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "20260420_16"
down_revision = "20260416_15"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "integration_automation_jobs",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("organization_id", sa.String(length=64), nullable=True),
        sa.Column("workspace_id", sa.String(length=64), nullable=True),
        sa.Column("name", sa.String(length=128), nullable=False),
        sa.Column("direction", sa.String(length=16), nullable=False),
        sa.Column("trigger_type", sa.String(length=32), nullable=False),
        sa.Column("source_system", sa.String(length=64), nullable=False),
        sa.Column("is_enabled", sa.Boolean(), nullable=False),
        sa.Column("config", sa.JSON(), nullable=False),
        sa.Column("last_status", sa.String(length=32), nullable=True),
        sa.Column("last_message", sa.String(length=512), nullable=True),
        sa.Column("last_run_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_integration_automation_jobs_created_at",
        "integration_automation_jobs",
        ["created_at"],
    )
    op.create_index(
        "ix_integration_automation_jobs_direction",
        "integration_automation_jobs",
        ["direction"],
    )
    op.create_index(
        "ix_integration_automation_jobs_organization_id",
        "integration_automation_jobs",
        ["organization_id"],
    )
    op.create_index(
        "ix_integration_automation_jobs_source_system",
        "integration_automation_jobs",
        ["source_system"],
    )
    op.create_index(
        "ix_integration_automation_jobs_trigger_type",
        "integration_automation_jobs",
        ["trigger_type"],
    )
    op.create_index(
        "ix_integration_automation_jobs_workspace_id",
        "integration_automation_jobs",
        ["workspace_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_integration_automation_jobs_workspace_id", "integration_automation_jobs")
    op.drop_index("ix_integration_automation_jobs_trigger_type", "integration_automation_jobs")
    op.drop_index("ix_integration_automation_jobs_source_system", "integration_automation_jobs")
    op.drop_index("ix_integration_automation_jobs_organization_id", "integration_automation_jobs")
    op.drop_index("ix_integration_automation_jobs_direction", "integration_automation_jobs")
    op.drop_index("ix_integration_automation_jobs_created_at", "integration_automation_jobs")
    op.drop_table("integration_automation_jobs")
