"""add integration api clients

Revision ID: 20260423_21
Revises: 20260423_20
Create Date: 2026-04-23
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "20260423_21"
down_revision = "20260423_20"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "integration_api_clients",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("organization_id", sa.String(length=64), nullable=True),
        sa.Column("workspace_id", sa.String(length=64), nullable=True),
        sa.Column("name", sa.String(length=128), nullable=False),
        sa.Column("source_system", sa.String(length=64), nullable=True),
        sa.Column("key_prefix", sa.String(length=32), nullable=False),
        sa.Column("key_hash", sa.String(length=128), nullable=False),
        sa.Column("scopes", sa.JSON(), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("created_by_user_id", sa.String(length=64), nullable=True),
        sa.Column("expires_at", sa.DateTime(), nullable=True),
        sa.Column("last_used_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("key_hash"),
    )
    op.create_index(
        "ix_integration_api_clients_created_at",
        "integration_api_clients",
        ["created_at"],
    )
    op.create_index(
        "ix_integration_api_clients_expires_at",
        "integration_api_clients",
        ["expires_at"],
    )
    op.create_index(
        "ix_integration_api_clients_is_active",
        "integration_api_clients",
        ["is_active"],
    )
    op.create_index(
        "ix_integration_api_clients_key_hash",
        "integration_api_clients",
        ["key_hash"],
    )
    op.create_index(
        "ix_integration_api_clients_organization_id",
        "integration_api_clients",
        ["organization_id"],
    )
    op.create_index(
        "ix_integration_api_clients_source_system",
        "integration_api_clients",
        ["source_system"],
    )
    op.create_index(
        "ix_integration_api_clients_workspace_id",
        "integration_api_clients",
        ["workspace_id"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_integration_api_clients_workspace_id",
        table_name="integration_api_clients",
    )
    op.drop_index(
        "ix_integration_api_clients_source_system",
        table_name="integration_api_clients",
    )
    op.drop_index(
        "ix_integration_api_clients_organization_id",
        table_name="integration_api_clients",
    )
    op.drop_index(
        "ix_integration_api_clients_key_hash",
        table_name="integration_api_clients",
    )
    op.drop_index(
        "ix_integration_api_clients_is_active",
        table_name="integration_api_clients",
    )
    op.drop_index(
        "ix_integration_api_clients_expires_at",
        table_name="integration_api_clients",
    )
    op.drop_index(
        "ix_integration_api_clients_created_at",
        table_name="integration_api_clients",
    )
    op.drop_table("integration_api_clients")
