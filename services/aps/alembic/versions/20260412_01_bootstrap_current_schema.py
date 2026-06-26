"""Bootstrap current schema and patch legacy dev databases.

Revision ID: 20260412_01
Revises:
Create Date: 2026-04-12
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "20260412_01"
down_revision = None
branch_labels = None
depends_on = None


def _table_names(inspector: sa.Inspector) -> set[str]:
    return set(inspector.get_table_names())


def _has_table(inspector: sa.Inspector, name: str) -> bool:
    return name in _table_names(inspector)


def _has_column(inspector: sa.Inspector, table_name: str, column_name: str) -> bool:
    return any(
        column["name"] == column_name for column in inspector.get_columns(table_name)
    )


def _create_table_if_missing(inspector: sa.Inspector, name: str, *columns, **kwargs) -> None:
    if not _has_table(inspector, name):
        op.create_table(name, *columns, **kwargs)


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    _create_table_if_missing(
        inspector,
        "calendars",
        sa.Column("id", sa.String(length=64), primary_key=True, nullable=False),
        sa.Column("name", sa.String(length=128), nullable=False),
    )

    inspector = sa.inspect(bind)
    _create_table_if_missing(
        inspector,
        "work_orders",
        sa.Column("id", sa.String(length=64), primary_key=True, nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("product_id", sa.String(length=64), nullable=False),
        sa.Column("quantity", sa.Integer(), nullable=False),
        sa.Column("due_date", sa.DateTime(), nullable=False),
        sa.Column("release_date", sa.DateTime(), nullable=False),
        sa.Column("priority", sa.Integer(), nullable=False, server_default=sa.text("2")),
        sa.Column(
            "status",
            sa.String(length=32),
            nullable=False,
            server_default=sa.text("'released'"),
        ),
        sa.Column(
            "lot_sizing_mode",
            sa.String(length=16),
            nullable=False,
            server_default=sa.text("'none'"),
        ),
        sa.Column(
            "lot_sizing_lot_size",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("0"),
        ),
        sa.Column(
            "lot_sizing_min",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("0"),
        ),
        sa.Column(
            "lot_sizing_max",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("0"),
        ),
    )

    inspector = sa.inspect(bind)
    _create_table_if_missing(
        inspector,
        "resources",
        sa.Column("id", sa.String(length=64), primary_key=True, nullable=False),
        sa.Column("name", sa.String(length=128), nullable=False),
        sa.Column("capacity", sa.Integer(), nullable=False),
        sa.Column("calendar_id", sa.String(length=64), nullable=True),
        sa.Column(
            "tags",
            sa.JSON(),
            nullable=False,
            server_default=sa.text("'[]'::json"),
        ),
        sa.ForeignKeyConstraint(
            ["calendar_id"],
            ["calendars.id"],
            ondelete="SET NULL",
        ),
    )

    inspector = sa.inspect(bind)
    _create_table_if_missing(
        inspector,
        "machines",
        sa.Column("id", sa.String(length=64), primary_key=True, nullable=False),
        sa.Column("name", sa.String(length=128), nullable=False),
        sa.Column("calendar_id", sa.String(length=64), nullable=False),
        sa.Column(
            "efficiency",
            sa.Float(),
            nullable=False,
            server_default=sa.text("1.0"),
        ),
        sa.Column(
            "capabilities",
            sa.JSON(),
            nullable=False,
            server_default=sa.text("'[]'::json"),
        ),
        sa.Column("setup_matrix_json", sa.JSON(), nullable=True),
        sa.Column("maintenance_windows_json", sa.JSON(), nullable=True),
        sa.ForeignKeyConstraint(
            ["calendar_id"],
            ["calendars.id"],
            ondelete="RESTRICT",
        ),
    )

    inspector = sa.inspect(bind)
    _create_table_if_missing(
        inspector,
        "schedules",
        sa.Column("id", sa.String(length=64), primary_key=True, nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.Column(
            "metrics",
            sa.JSON(),
            nullable=False,
            server_default=sa.text("'{}'::json"),
        ),
        sa.Column(
            "strategy",
            sa.String(length=64),
            nullable=False,
            server_default=sa.text("'unknown'"),
        ),
        sa.Column(
            "solver_status",
            sa.String(length=32),
            nullable=False,
            server_default=sa.text("'unknown'"),
        ),
        sa.Column(
            "objective_value",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("0"),
        ),
        sa.Column(
            "wall_time_ms",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("0"),
        ),
        sa.Column(
            "diagnostics",
            sa.JSON(),
            nullable=False,
            server_default=sa.text("'{}'::json"),
        ),
    )

    inspector = sa.inspect(bind)
    _create_table_if_missing(
        inspector,
        "calendar_shifts",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("calendar_id", sa.String(length=64), nullable=False),
        sa.Column("weekday", sa.Integer(), nullable=False),
        sa.Column("start_time", sa.Time(), nullable=False),
        sa.Column("end_time", sa.Time(), nullable=False),
        sa.ForeignKeyConstraint(
            ["calendar_id"],
            ["calendars.id"],
            ondelete="CASCADE",
        ),
    )

    inspector = sa.inspect(bind)
    _create_table_if_missing(
        inspector,
        "operations",
        sa.Column("id", sa.String(length=64), primary_key=True, nullable=False),
        sa.Column("work_order_id", sa.String(length=64), nullable=False),
        sa.Column("sequence", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("duration_minutes", sa.Integer(), nullable=False),
        sa.Column(
            "setup_minutes",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("0"),
        ),
        sa.Column(
            "status",
            sa.String(length=32),
            nullable=False,
            server_default=sa.text("'pending'"),
        ),
        sa.Column("setup_family", sa.String(length=64), nullable=True),
        sa.Column(
            "preemptible",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
        sa.Column(
            "min_chunk_minutes",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("0"),
        ),
        sa.ForeignKeyConstraint(
            ["work_order_id"],
            ["work_orders.id"],
            ondelete="CASCADE",
        ),
    )
    inspector = sa.inspect(bind)
    if not any(index["name"] == "ix_operations_work_order_id" for index in inspector.get_indexes("operations")):
        op.create_index("ix_operations_work_order_id", "operations", ["work_order_id"], unique=False)

    inspector = sa.inspect(bind)
    _create_table_if_missing(
        inspector,
        "operation_eligible_machines",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("operation_id", sa.String(length=64), nullable=False),
        sa.Column("machine_id", sa.String(length=64), nullable=False),
        sa.ForeignKeyConstraint(
            ["operation_id"],
            ["operations.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["machine_id"],
            ["machines.id"],
            ondelete="RESTRICT",
        ),
        sa.UniqueConstraint("operation_id", "machine_id", name="uq_op_machine"),
    )

    inspector = sa.inspect(bind)
    _create_table_if_missing(
        inspector,
        "operation_dependencies",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("operation_id", sa.String(length=64), nullable=False),
        sa.Column("depends_on_id", sa.String(length=64), nullable=False),
        sa.ForeignKeyConstraint(
            ["operation_id"],
            ["operations.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["depends_on_id"],
            ["operations.id"],
            ondelete="CASCADE",
        ),
        sa.UniqueConstraint("operation_id", "depends_on_id", name="uq_op_dep"),
    )

    inspector = sa.inspect(bind)
    _create_table_if_missing(
        inspector,
        "operation_resource_requirements",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("operation_id", sa.String(length=64), nullable=False),
        sa.Column("resource_id", sa.String(length=64), nullable=False),
        sa.Column(
            "units",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("1"),
        ),
        sa.ForeignKeyConstraint(
            ["operation_id"],
            ["operations.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["resource_id"],
            ["resources.id"],
            ondelete="RESTRICT",
        ),
        sa.UniqueConstraint("operation_id", "resource_id", name="uq_op_resource"),
    )

    inspector = sa.inspect(bind)
    _create_table_if_missing(
        inspector,
        "operation_routing_alternatives",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("operation_id", sa.String(length=64), nullable=False),
        sa.Column("machine_id", sa.String(length=64), nullable=False),
        sa.Column("duration_minutes", sa.Integer(), nullable=False),
        sa.Column(
            "setup_minutes",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("0"),
        ),
        sa.Column("resource_requirements_json", sa.JSON(), nullable=True),
        sa.ForeignKeyConstraint(
            ["operation_id"],
            ["operations.id"],
            ondelete="CASCADE",
        ),
        sa.UniqueConstraint("operation_id", "machine_id", name="uq_op_routing_machine"),
    )

    inspector = sa.inspect(bind)
    _create_table_if_missing(
        inspector,
        "scheduled_operations",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("schedule_id", sa.String(length=64), nullable=False),
        sa.Column("operation_id", sa.String(length=64), nullable=False),
        sa.Column("work_order_id", sa.String(length=64), nullable=False),
        sa.Column("machine_id", sa.String(length=64), nullable=False),
        sa.Column("setup_start", sa.DateTime(), nullable=False),
        sa.Column("start", sa.DateTime(), nullable=False),
        sa.Column("end", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(
            ["schedule_id"],
            ["schedules.id"],
            ondelete="CASCADE",
        ),
    )
    inspector = sa.inspect(bind)
    scheduled_indexes = {index["name"] for index in inspector.get_indexes("scheduled_operations")}
    if "ix_scheduled_operations_schedule_id" not in scheduled_indexes:
        op.create_index("ix_scheduled_operations_schedule_id", "scheduled_operations", ["schedule_id"], unique=False)
    if "ix_scheduled_operations_operation_id" not in scheduled_indexes:
        op.create_index("ix_scheduled_operations_operation_id", "scheduled_operations", ["operation_id"], unique=False)
    if "ix_scheduled_operations_work_order_id" not in scheduled_indexes:
        op.create_index("ix_scheduled_operations_work_order_id", "scheduled_operations", ["work_order_id"], unique=False)
    if "ix_scheduled_operations_machine_id" not in scheduled_indexes:
        op.create_index("ix_scheduled_operations_machine_id", "scheduled_operations", ["machine_id"], unique=False)

    inspector = sa.inspect(bind)

    def add_column_if_missing(table_name: str, column: sa.Column) -> None:
        nonlocal inspector
        if not _has_column(inspector, table_name, column.name):
            op.add_column(table_name, column)
            inspector = sa.inspect(bind)

    add_column_if_missing(
        "work_orders",
        sa.Column(
            "lot_sizing_mode",
            sa.String(length=16),
            nullable=False,
            server_default=sa.text("'none'"),
        ),
    )
    add_column_if_missing(
        "work_orders",
        sa.Column(
            "lot_sizing_lot_size",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("0"),
        ),
    )
    add_column_if_missing(
        "work_orders",
        sa.Column(
            "lot_sizing_min",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("0"),
        ),
    )
    add_column_if_missing(
        "work_orders",
        sa.Column(
            "lot_sizing_max",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("0"),
        ),
    )

    add_column_if_missing("operations", sa.Column("setup_family", sa.String(length=64), nullable=True))
    add_column_if_missing(
        "operations",
        sa.Column(
            "preemptible",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )
    add_column_if_missing(
        "operations",
        sa.Column(
            "min_chunk_minutes",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("0"),
        ),
    )

    add_column_if_missing(
        "machines",
        sa.Column("setup_matrix_json", sa.JSON(), nullable=True),
    )
    add_column_if_missing(
        "machines",
        sa.Column("maintenance_windows_json", sa.JSON(), nullable=True),
    )

    add_column_if_missing(
        "resources",
        sa.Column("calendar_id", sa.String(length=64), nullable=True),
    )
    add_column_if_missing(
        "resources",
        sa.Column(
            "tags",
            sa.JSON(),
            nullable=False,
            server_default=sa.text("'[]'::json"),
        ),
    )

    add_column_if_missing(
        "schedules",
        sa.Column(
            "strategy",
            sa.String(length=64),
            nullable=False,
            server_default=sa.text("'unknown'"),
        ),
    )
    add_column_if_missing(
        "schedules",
        sa.Column(
            "solver_status",
            sa.String(length=32),
            nullable=False,
            server_default=sa.text("'unknown'"),
        ),
    )
    add_column_if_missing(
        "schedules",
        sa.Column(
            "objective_value",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("0"),
        ),
    )
    add_column_if_missing(
        "schedules",
        sa.Column(
            "wall_time_ms",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("0"),
        ),
    )
    add_column_if_missing(
        "schedules",
        sa.Column(
            "diagnostics",
            sa.JSON(),
            nullable=False,
            server_default=sa.text("'{}'::json"),
        ),
    )


def downgrade() -> None:
    raise NotImplementedError("Downgrade is intentionally not supported for the bootstrap schema revision.")
