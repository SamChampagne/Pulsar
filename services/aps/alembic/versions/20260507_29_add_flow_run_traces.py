"""add integration flow run traces

Revision ID: 20260507_29
Revises: 20260507_28
Create Date: 2026-05-07

Studio v2 phase 3 — persist per-block input/output payloads after each
integration flow run so the UI bottom panel can re-show the data flow
hours later. Org-scoped, masked server-side before persistence.
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "20260507_29"
down_revision = "20260507_28"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "integration_flow_run_traces",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("organization_id", sa.String(length=64), nullable=True),
        sa.Column("workspace_id", sa.String(length=64), nullable=True),
        sa.Column("flow_id", sa.String(length=64), nullable=False),
        sa.Column("run_id", sa.String(length=64), nullable=False),
        sa.Column("block_id", sa.String(length=128), nullable=False),
        sa.Column("block_type", sa.String(length=64), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column(
            "duration_ms",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("0"),
        ),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("input_payload", sa.JSON(), nullable=False),
        sa.Column("output_payload", sa.JSON(), nullable=False),
        sa.Column("started_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_integration_flow_run_traces_organization_id",
        "integration_flow_run_traces",
        ["organization_id"],
    )
    op.create_index(
        "ix_integration_flow_run_traces_workspace_id",
        "integration_flow_run_traces",
        ["workspace_id"],
    )
    op.create_index(
        "ix_integration_flow_run_traces_flow_id",
        "integration_flow_run_traces",
        ["flow_id"],
    )
    op.create_index(
        "ix_integration_flow_run_traces_run_id",
        "integration_flow_run_traces",
        ["run_id"],
    )
    op.create_index(
        "ix_integration_flow_run_traces_started_at",
        "integration_flow_run_traces",
        ["started_at"],
    )
    op.create_index(
        "idx_flow_run_traces_flow_run",
        "integration_flow_run_traces",
        ["flow_id", "run_id"],
    )


def downgrade() -> None:
    op.drop_index(
        "idx_flow_run_traces_flow_run", table_name="integration_flow_run_traces"
    )
    op.drop_index(
        "ix_integration_flow_run_traces_started_at",
        table_name="integration_flow_run_traces",
    )
    op.drop_index(
        "ix_integration_flow_run_traces_run_id",
        table_name="integration_flow_run_traces",
    )
    op.drop_index(
        "ix_integration_flow_run_traces_flow_id",
        table_name="integration_flow_run_traces",
    )
    op.drop_index(
        "ix_integration_flow_run_traces_workspace_id",
        table_name="integration_flow_run_traces",
    )
    op.drop_index(
        "ix_integration_flow_run_traces_organization_id",
        table_name="integration_flow_run_traces",
    )
    op.drop_table("integration_flow_run_traces")
