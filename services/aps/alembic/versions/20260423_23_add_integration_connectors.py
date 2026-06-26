"""add integration connectors

Revision ID: 20260423_23
Revises: 20260423_22
Create Date: 2026-04-23
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "20260423_23"
down_revision = "20260423_22"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "integration_connectors",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("organization_id", sa.String(length=64), nullable=True),
        sa.Column("workspace_id", sa.String(length=64), nullable=True),
        sa.Column("name", sa.String(length=128), nullable=False),
        sa.Column("endpoint_url", sa.String(length=512), nullable=False),
        sa.Column("source_system", sa.String(length=64), nullable=False),
        sa.Column("connector_type", sa.String(length=32), nullable=False),
        sa.Column("method", sa.String(length=16), nullable=False),
        sa.Column("auth_type", sa.String(length=32), nullable=False),
        sa.Column("auth_header_name", sa.String(length=128), nullable=True),
        sa.Column("username", sa.String(length=128), nullable=True),
        sa.Column("secret_ref", sa.String(length=255), nullable=True),
        sa.Column("static_headers", sa.JSON(), nullable=False),
        sa.Column("timeout_seconds", sa.Integer(), nullable=False),
        sa.Column("is_enabled", sa.Boolean(), nullable=False),
        sa.Column("created_by_user_id", sa.String(length=64), nullable=True),
        sa.Column("last_tested_at", sa.DateTime(), nullable=True),
        sa.Column("last_test_status", sa.String(length=32), nullable=True),
        sa.Column("last_test_message", sa.String(length=512), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_integration_connectors_created_at",
        "integration_connectors",
        ["created_at"],
    )
    op.create_index(
        "ix_integration_connectors_organization_id",
        "integration_connectors",
        ["organization_id"],
    )
    op.create_index(
        "ix_integration_connectors_source_system",
        "integration_connectors",
        ["source_system"],
    )
    op.create_index(
        "ix_integration_connectors_workspace_id",
        "integration_connectors",
        ["workspace_id"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_integration_connectors_workspace_id",
        table_name="integration_connectors",
    )
    op.drop_index(
        "ix_integration_connectors_source_system",
        table_name="integration_connectors",
    )
    op.drop_index(
        "ix_integration_connectors_organization_id",
        table_name="integration_connectors",
    )
    op.drop_index(
        "ix_integration_connectors_created_at",
        table_name="integration_connectors",
    )
    op.drop_table("integration_connectors")
