"""Add integration bindings for idempotent ERP imports.

Revision ID: 20260412_03
Revises: 20260412_02
Create Date: 2026-04-12
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "20260412_03"
down_revision = "20260412_02"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "integration_bindings",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("entity_type", sa.String(length=32), nullable=False),
        sa.Column("source_system", sa.String(length=64), nullable=False),
        sa.Column("external_ref", sa.String(length=255), nullable=False),
        sa.Column("internal_id", sa.String(length=128), nullable=False),
        sa.Column(
            "updated_at",
            sa.DateTime(),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.UniqueConstraint(
            "entity_type",
            "source_system",
            "external_ref",
            name="uq_integration_binding_key",
        ),
    )
    op.create_index(
        "ix_integration_bindings_entity_type",
        "integration_bindings",
        ["entity_type"],
        unique=False,
    )
    op.create_index(
        "ix_integration_bindings_source_system",
        "integration_bindings",
        ["source_system"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_integration_bindings_source_system", table_name="integration_bindings")
    op.drop_index("ix_integration_bindings_entity_type", table_name="integration_bindings")
    op.drop_table("integration_bindings")
