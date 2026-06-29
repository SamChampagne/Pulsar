"""Scope secondary planning inputs by organization.

Revision ID: 20260416_13
Revises: 20260416_12
Create Date: 2026-04-16
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "20260416_13"
down_revision = "20260416_12"
branch_labels = None
depends_on = None


def upgrade() -> None:
    for table_name in ("calendars", "resources", "inventory_items", "supply_lots"):
        op.add_column(
            table_name,
            sa.Column("organization_id", sa.String(length=64), nullable=True),
        )
        op.create_index(
            f"ix_{table_name}_organization_id",
            table_name,
            ["organization_id"],
        )


def downgrade() -> None:
    for table_name in ("supply_lots", "inventory_items", "resources", "calendars"):
        op.drop_index(f"ix_{table_name}_organization_id", table_name=table_name)
        op.drop_column(table_name, "organization_id")
