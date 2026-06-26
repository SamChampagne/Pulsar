"""Add workspace scope to master planning data.

Revision ID: 20260423_17
Revises: 20260420_16
Create Date: 2026-04-23
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "20260423_17"
down_revision = "20260420_16"
branch_labels = None
depends_on = None


TABLES = (
    "calendars",
    "machines",
    "resources",
    "inventory_items",
    "supply_lots",
    "work_orders",
)


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    for table_name in TABLES:
        if "workspace_id" not in {column["name"] for column in inspector.get_columns(table_name)}:
            op.add_column(
                table_name,
                sa.Column("workspace_id", sa.String(length=64), nullable=True),
            )
            op.create_index(
                f"ix_{table_name}_workspace_id",
                table_name,
                ["workspace_id"],
            )
        op.execute(
            sa.text(
                f"UPDATE {table_name} "
                "SET workspace_id = 'default' "
                "WHERE workspace_id IS NULL AND organization_id IS NOT NULL"
            )
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    for table_name in reversed(TABLES):
        if "workspace_id" in {column["name"] for column in inspector.get_columns(table_name)}:
            op.drop_index(f"ix_{table_name}_workspace_id", table_name=table_name)
            op.drop_column(table_name, "workspace_id")
