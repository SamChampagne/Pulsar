"""Add structured dependency semantics to operation dependencies.

Revision ID: 20260414_07
Revises: 20260414_06
Create Date: 2026-04-14
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "20260414_07"
down_revision = "20260414_06"
branch_labels = None
depends_on = None


def _column_names(inspector: sa.Inspector, table_name: str) -> set[str]:
    return {column["name"] for column in inspector.get_columns(table_name)}


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if "operation_dependencies" not in inspector.get_table_names():
        return

    columns = _column_names(inspector, "operation_dependencies")
    if "dependency_type" not in columns:
        op.add_column(
            "operation_dependencies",
            sa.Column(
                "dependency_type",
                sa.String(length=32),
                nullable=False,
                server_default="finish_to_start",
            ),
        )
    if "lag_minutes" not in columns:
        op.add_column(
            "operation_dependencies",
            sa.Column(
                "lag_minutes",
                sa.Integer(),
                nullable=False,
                server_default="0",
            ),
        )
    if "max_wait_minutes" not in columns:
        op.add_column(
            "operation_dependencies",
            sa.Column(
                "max_wait_minutes",
                sa.Integer(),
                nullable=True,
            ),
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if "operation_dependencies" not in inspector.get_table_names():
        return

    columns = _column_names(inspector, "operation_dependencies")
    if "max_wait_minutes" in columns:
        op.drop_column("operation_dependencies", "max_wait_minutes")
    if "lag_minutes" in columns:
        op.drop_column("operation_dependencies", "lag_minutes")
    if "dependency_type" in columns:
        op.drop_column("operation_dependencies", "dependency_type")
