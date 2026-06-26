"""add integration credentials

Revision ID: 20260427_27
Revises: 20260423_26
Create Date: 2026-04-27
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "20260427_27"
down_revision = "20260423_26"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "integration_credentials",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("organization_id", sa.String(length=64), nullable=True),
        sa.Column("workspace_id", sa.String(length=64), nullable=True),
        sa.Column("name", sa.String(length=128), nullable=False),
        sa.Column("source_system", sa.String(length=64), nullable=False),
        sa.Column("auth_type", sa.String(length=32), nullable=False),
        sa.Column("auth_header_name", sa.String(length=128), nullable=True),
        sa.Column("username", sa.String(length=128), nullable=True),
        sa.Column("secret_ref", sa.String(length=255), nullable=True),
        sa.Column("is_enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_by_user_id", sa.String(length=64), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_integration_credentials_organization_id"),
        "integration_credentials",
        ["organization_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_integration_credentials_workspace_id"),
        "integration_credentials",
        ["workspace_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_integration_credentials_source_system"),
        "integration_credentials",
        ["source_system"],
        unique=False,
    )
    op.create_index(
        op.f("ix_integration_credentials_created_at"),
        "integration_credentials",
        ["created_at"],
        unique=False,
    )
    op.add_column(
        "integration_connectors",
        sa.Column("credential_id", sa.String(length=64), nullable=True),
    )
    op.create_index(
        op.f("ix_integration_connectors_credential_id"),
        "integration_connectors",
        ["credential_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        op.f("ix_integration_connectors_credential_id"),
        table_name="integration_connectors",
    )
    op.drop_column("integration_connectors", "credential_id")
    op.drop_index(
        op.f("ix_integration_credentials_created_at"),
        table_name="integration_credentials",
    )
    op.drop_index(
        op.f("ix_integration_credentials_source_system"),
        table_name="integration_credentials",
    )
    op.drop_index(
        op.f("ix_integration_credentials_workspace_id"),
        table_name="integration_credentials",
    )
    op.drop_index(
        op.f("ix_integration_credentials_organization_id"),
        table_name="integration_credentials",
    )
    op.drop_table("integration_credentials")
