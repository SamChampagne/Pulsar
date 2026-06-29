"""Add planning control plane state and events.

Revision ID: 20260423_20
Revises: 20260423_19
Create Date: 2026-04-23
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "20260423_20"
down_revision = "20260423_19"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if not inspector.has_table("planning_workspace_state"):
        op.create_table(
            "planning_workspace_state",
            sa.Column("id", sa.String(length=160), nullable=False),
            sa.Column("organization_id", sa.String(length=64), nullable=True),
            sa.Column("workspace_id", sa.String(length=64), nullable=False),
            sa.Column("active_baseline_schedule_id", sa.String(length=64), nullable=True),
            sa.Column("active_candidate_schedule_id", sa.String(length=64), nullable=True),
            sa.Column(
                "candidate_status",
                sa.String(length=32),
                nullable=False,
                server_default="none",
            ),
            sa.Column(
                "candidate_edit_count",
                sa.Integer(),
                nullable=False,
                server_default="0",
            ),
            sa.Column("last_event_type", sa.String(length=64), nullable=True),
            sa.Column("updated_by_user_id", sa.String(length=64), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index(
            "ix_planning_workspace_state_organization_id",
            "planning_workspace_state",
            ["organization_id"],
        )
        op.create_index(
            "ix_planning_workspace_state_workspace_id",
            "planning_workspace_state",
            ["workspace_id"],
        )
        op.create_index(
            "ix_planning_workspace_state_active_baseline_schedule_id",
            "planning_workspace_state",
            ["active_baseline_schedule_id"],
        )
        op.create_index(
            "ix_planning_workspace_state_active_candidate_schedule_id",
            "planning_workspace_state",
            ["active_candidate_schedule_id"],
        )

    if not inspector.has_table("planning_events"):
        op.create_table(
            "planning_events",
            sa.Column("id", sa.String(length=64), nullable=False),
            sa.Column("organization_id", sa.String(length=64), nullable=True),
            sa.Column("workspace_id", sa.String(length=64), nullable=False),
            sa.Column("event_type", sa.String(length=64), nullable=False),
            sa.Column("schedule_id", sa.String(length=64), nullable=True),
            sa.Column("baseline_schedule_id", sa.String(length=64), nullable=True),
            sa.Column("candidate_schedule_id", sa.String(length=64), nullable=True),
            sa.Column("source_schedule_id", sa.String(length=64), nullable=True),
            sa.Column(
                "edit_count",
                sa.Integer(),
                nullable=False,
                server_default="0",
            ),
            sa.Column("payload", sa.JSON(), nullable=False),
            sa.Column("created_by_user_id", sa.String(length=64), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.PrimaryKeyConstraint("id"),
        )
        for column_name in (
            "organization_id",
            "workspace_id",
            "event_type",
            "schedule_id",
            "baseline_schedule_id",
            "candidate_schedule_id",
            "source_schedule_id",
            "created_at",
        ):
            op.create_index(
                f"ix_planning_events_{column_name}",
                "planning_events",
                [column_name],
            )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if inspector.has_table("planning_events"):
        indexes = {index["name"] for index in inspector.get_indexes("planning_events")}
        for column_name in (
            "created_at",
            "source_schedule_id",
            "candidate_schedule_id",
            "baseline_schedule_id",
            "schedule_id",
            "event_type",
            "workspace_id",
            "organization_id",
        ):
            index_name = f"ix_planning_events_{column_name}"
            if index_name in indexes:
                op.drop_index(index_name, table_name="planning_events")
        op.drop_table("planning_events")
    if inspector.has_table("planning_workspace_state"):
        indexes = {
            index["name"]
            for index in inspector.get_indexes("planning_workspace_state")
        }
        for index_name in (
            "ix_planning_workspace_state_active_candidate_schedule_id",
            "ix_planning_workspace_state_active_baseline_schedule_id",
            "ix_planning_workspace_state_workspace_id",
            "ix_planning_workspace_state_organization_id",
        ):
            if index_name in indexes:
                op.drop_index(index_name, table_name="planning_workspace_state")
        op.drop_table("planning_workspace_state")
