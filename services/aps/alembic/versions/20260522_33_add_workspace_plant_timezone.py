"""add workspace.plant_timezone

Revision ID: 20260522_33
Revises: 20260522_32
Create Date: 2026-05-22

V1.2 P2.4b — per-workspace plant timezone. Closes the symmetric
gap left by P2.4 (display side), which proved naive ISOs render
verbatim under any browser TZ. The EDIT side still needs to know
WHICH TZ to interpret browser-local drag-drop times in — that's
``plant_timezone``.

Default ``'UTC'`` means legacy single-region workspaces behave
exactly like before (server_default fills in any pre-existing
rows). Multi-region pilots set the column per workspace via the
Settings UI follow-on slice.
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "20260522_33"
down_revision = "20260522_32"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "workspaces",
        sa.Column(
            "plant_timezone",
            sa.String(length=64),
            nullable=False,
            server_default="UTC",
        ),
    )


def downgrade() -> None:
    op.drop_column("workspaces", "plant_timezone")
