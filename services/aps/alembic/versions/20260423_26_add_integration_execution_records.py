"""add integration execution records

Revision ID: 20260423_26
Revises: 20260423_25
Create Date: 2026-04-23 23:59:59
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "20260423_26"
down_revision = "20260423_25"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "integration_execution_records",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("organization_id", sa.String(length=64), nullable=True),
        sa.Column("workspace_id", sa.String(length=64), nullable=True),
        sa.Column("execution_kind", sa.String(length=32), nullable=False),
        sa.Column("target_type", sa.String(length=32), nullable=False),
        sa.Column("target_id", sa.String(length=64), nullable=True),
        sa.Column("target_name", sa.String(length=128), nullable=True),
        sa.Column("source_system", sa.String(length=64), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("valid", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("trigger_type", sa.String(length=32), nullable=True),
        sa.Column("actor_mode", sa.String(length=32), nullable=True),
        sa.Column("actor_id", sa.String(length=128), nullable=True),
        sa.Column("correlation_id", sa.String(length=64), nullable=True),
        sa.Column("attempt_number", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("message", sa.String(length=512), nullable=False, server_default=""),
        sa.Column("error_code", sa.String(length=64), nullable=True),
        sa.Column("entity_counts", sa.JSON(), nullable=False),
        sa.Column("details", sa.JSON(), nullable=False),
        sa.Column("journal_entry_id", sa.String(length=64), nullable=True),
        sa.Column("started_at", sa.DateTime(), nullable=False),
        sa.Column("finished_at", sa.DateTime(), nullable=False),
        sa.Column("duration_ms", sa.Integer(), nullable=False, server_default="0"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_integration_execution_records_organization_id"),
        "integration_execution_records",
        ["organization_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_integration_execution_records_workspace_id"),
        "integration_execution_records",
        ["workspace_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_integration_execution_records_execution_kind"),
        "integration_execution_records",
        ["execution_kind"],
        unique=False,
    )
    op.create_index(
        op.f("ix_integration_execution_records_target_type"),
        "integration_execution_records",
        ["target_type"],
        unique=False,
    )
    op.create_index(
        op.f("ix_integration_execution_records_target_id"),
        "integration_execution_records",
        ["target_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_integration_execution_records_source_system"),
        "integration_execution_records",
        ["source_system"],
        unique=False,
    )
    op.create_index(
        op.f("ix_integration_execution_records_status"),
        "integration_execution_records",
        ["status"],
        unique=False,
    )
    op.create_index(
        op.f("ix_integration_execution_records_correlation_id"),
        "integration_execution_records",
        ["correlation_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_integration_execution_records_started_at"),
        "integration_execution_records",
        ["started_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        op.f("ix_integration_execution_records_started_at"),
        table_name="integration_execution_records",
    )
    op.drop_index(
        op.f("ix_integration_execution_records_correlation_id"),
        table_name="integration_execution_records",
    )
    op.drop_index(
        op.f("ix_integration_execution_records_status"),
        table_name="integration_execution_records",
    )
    op.drop_index(
        op.f("ix_integration_execution_records_source_system"),
        table_name="integration_execution_records",
    )
    op.drop_index(
        op.f("ix_integration_execution_records_target_id"),
        table_name="integration_execution_records",
    )
    op.drop_index(
        op.f("ix_integration_execution_records_target_type"),
        table_name="integration_execution_records",
    )
    op.drop_index(
        op.f("ix_integration_execution_records_execution_kind"),
        table_name="integration_execution_records",
    )
    op.drop_index(
        op.f("ix_integration_execution_records_workspace_id"),
        table_name="integration_execution_records",
    )
    op.drop_index(
        op.f("ix_integration_execution_records_organization_id"),
        table_name="integration_execution_records",
    )
    op.drop_table("integration_execution_records")
