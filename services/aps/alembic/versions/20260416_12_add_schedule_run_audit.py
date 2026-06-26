"""Persist audited scheduling run inputs.

Revision ID: 20260416_12
Revises: 20260416_11
Create Date: 2026-04-16
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "20260416_12"
down_revision = "20260416_11"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "schedules",
        sa.Column("organization_id", sa.String(length=64), nullable=True),
    )
    op.add_column("schedules", sa.Column("horizon_start", sa.DateTime(), nullable=True))
    op.add_column("schedules", sa.Column("horizon_end", sa.DateTime(), nullable=True))
    op.add_column(
        "schedules",
        sa.Column(
            "objective_json",
            sa.JSON(),
            nullable=False,
            server_default=sa.text("'{}'::json"),
        ),
    )
    op.add_column(
        "schedules",
        sa.Column(
            "transfer_times_json",
            sa.JSON(),
            nullable=False,
            server_default=sa.text("'{}'::json"),
        ),
    )
    op.add_column(
        "schedules",
        sa.Column(
            "input_snapshot_json",
            sa.JSON(),
            nullable=False,
            server_default=sa.text("'{}'::json"),
        ),
    )
    op.add_column(
        "schedules",
        sa.Column(
            "input_snapshot_hash",
            sa.String(length=64),
            nullable=False,
            server_default=sa.text("''"),
        ),
    )
    op.add_column(
        "schedules",
        sa.Column(
            "engine_version",
            sa.String(length=64),
            nullable=False,
            server_default=sa.text("'aps-engine.v1'"),
        ),
    )
    op.create_index("ix_schedules_organization_id", "schedules", ["organization_id"])


def downgrade() -> None:
    op.drop_index("ix_schedules_organization_id", table_name="schedules")
    op.drop_column("schedules", "engine_version")
    op.drop_column("schedules", "input_snapshot_hash")
    op.drop_column("schedules", "input_snapshot_json")
    op.drop_column("schedules", "transfer_times_json")
    op.drop_column("schedules", "objective_json")
    op.drop_column("schedules", "horizon_end")
    op.drop_column("schedules", "horizon_start")
    op.drop_column("schedules", "organization_id")
