"""Add product context fields to persisted schedules.

Revision ID: 20260412_02
Revises: 20260412_01
Create Date: 2026-04-12
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "20260412_02"
down_revision = "20260412_01"
branch_labels = None
depends_on = None


def _has_column(inspector: sa.Inspector, table_name: str, column_name: str) -> bool:
    return any(
        column["name"] == column_name for column in inspector.get_columns(table_name)
    )


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if not _has_column(inspector, "schedules", "workspace_id"):
        op.add_column(
            "schedules",
            sa.Column(
                "workspace_id",
                sa.String(length=64),
                nullable=False,
                server_default=sa.text("'default'"),
            ),
        )

    inspector = sa.inspect(bind)
    if not _has_column(inspector, "schedules", "scenario_name"):
        op.add_column(
            "schedules",
            sa.Column(
                "scenario_name",
                sa.String(length=128),
                nullable=False,
                server_default=sa.text("'Default Scenario'"),
            ),
        )

    inspector = sa.inspect(bind)
    if not _has_column(inspector, "schedules", "lifecycle_status"):
        op.add_column(
            "schedules",
            sa.Column(
                "lifecycle_status",
                sa.String(length=32),
                nullable=False,
                server_default=sa.text("'draft'"),
            ),
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if _has_column(inspector, "schedules", "lifecycle_status"):
        op.drop_column("schedules", "lifecycle_status")

    inspector = sa.inspect(bind)
    if _has_column(inspector, "schedules", "scenario_name"):
        op.drop_column("schedules", "scenario_name")

    inspector = sa.inspect(bind)
    if _has_column(inspector, "schedules", "workspace_id"):
        op.drop_column("schedules", "workspace_id")
