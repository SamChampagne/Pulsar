"""add work_order.firmness

Revision ID: 20260522_35
Revises: 20260522_34
Create Date: 2026-05-22

V1.2 Cas 2 — distinguish firm orders (real customer commitments)
from forecast / tentative ones pushed by an ERP forecasting module.
Drives objective lateness weight + greedy tiebreak so the engine
fights for firm due dates harder than for forecast ones.

Default 'firm' on the column so pre-existing WOs behave exactly
like before — no silent demotion of historical data.
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "20260522_35"
down_revision = "20260522_34"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "work_orders",
        sa.Column(
            "firmness",
            sa.String(length=16),
            nullable=False,
            server_default="firm",
        ),
    )


def downgrade() -> None:
    op.drop_column("work_orders", "firmness")
