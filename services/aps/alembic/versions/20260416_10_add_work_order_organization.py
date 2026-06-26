"""Scope work orders by organization.

Revision ID: 20260416_10
Revises: 20260416_09
Create Date: 2026-04-16
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "20260416_10"
down_revision = "20260416_09"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "work_orders",
        sa.Column("organization_id", sa.String(length=64), nullable=True),
    )
    op.create_foreign_key(
        "fk_work_orders_organization_id_organizations",
        "work_orders",
        "organizations",
        ["organization_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index(
        "ix_work_orders_organization_id", "work_orders", ["organization_id"]
    )


def downgrade() -> None:
    op.drop_index("ix_work_orders_organization_id", table_name="work_orders")
    op.drop_constraint(
        "fk_work_orders_organization_id_organizations",
        "work_orders",
        type_="foreignkey",
    )
    op.drop_column("work_orders", "organization_id")
