"""Add persisted operation material requirements.

Revision ID: 20260414_05
Revises: 20260412_04
Create Date: 2026-04-14
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "20260414_05"
down_revision = "20260412_04"
branch_labels = None
depends_on = None


def _has_column(inspector: sa.Inspector, table_name: str, column_name: str) -> bool:
    return any(
        column["name"] == column_name for column in inspector.get_columns(table_name)
    )


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if not _has_column(inspector, "operations", "material_requirements_json"):
        op.add_column(
            "operations",
            sa.Column("material_requirements_json", sa.JSON(), nullable=True),
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if _has_column(inspector, "operations", "material_requirements_json"):
        op.drop_column("operations", "material_requirements_json")
