"""Scope machines by organization.

Revision ID: 20260416_11
Revises: 20260416_10
Create Date: 2026-04-16
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "20260416_11"
down_revision = "20260416_10"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "machines",
        sa.Column("organization_id", sa.String(length=64), nullable=True),
    )
    op.create_foreign_key(
        "fk_machines_organization_id_organizations",
        "machines",
        "organizations",
        ["organization_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index(
        "ix_machines_organization_id", "machines", ["organization_id"]
    )


def downgrade() -> None:
    op.drop_index("ix_machines_organization_id", table_name="machines")
    op.drop_constraint(
        "fk_machines_organization_id_organizations",
        "machines",
        type_="foreignkey",
    )
    op.drop_column("machines", "organization_id")
