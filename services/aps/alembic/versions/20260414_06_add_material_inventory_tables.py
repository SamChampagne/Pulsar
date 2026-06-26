"""Add persisted inventory and supply tables for material-aware scheduling.

Revision ID: 20260414_06
Revises: 20260414_05
Create Date: 2026-04-14
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "20260414_06"
down_revision = "20260414_05"
branch_labels = None
depends_on = None


def _has_table(inspector: sa.Inspector, table_name: str) -> bool:
    return table_name in inspector.get_table_names()


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if not _has_table(inspector, "inventory_items"):
        op.create_table(
            "inventory_items",
            sa.Column("material_id", sa.String(length=64), nullable=False),
            sa.Column("quantity_on_hand", sa.Float(), nullable=False, server_default="0"),
            sa.Column("as_of", sa.DateTime(), nullable=True),
            sa.PrimaryKeyConstraint("material_id"),
        )

    if not _has_table(inspector, "supply_lots"):
        op.create_table(
            "supply_lots",
            sa.Column("id", sa.String(length=64), nullable=False),
            sa.Column("material_id", sa.String(length=64), nullable=False),
            sa.Column("quantity", sa.Float(), nullable=False),
            sa.Column("available_at", sa.DateTime(), nullable=False),
            sa.Column("source_type", sa.String(length=32), nullable=False, server_default="supply"),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index("ix_supply_lots_material_id", "supply_lots", ["material_id"])


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if _has_table(inspector, "supply_lots"):
        op.drop_index("ix_supply_lots_material_id", table_name="supply_lots")
        op.drop_table("supply_lots")
    if _has_table(inspector, "inventory_items"):
        op.drop_table("inventory_items")
