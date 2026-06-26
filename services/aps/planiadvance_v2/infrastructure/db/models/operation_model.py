"""Operation ORM model + its dependency and eligibility join tables.

Unlike V1 (which stored operations as JSON blobs), V2 uses proper
normalized tables:

- ``operations``: one row per operation
- ``operation_dependencies``: link table for op → op dependencies
- ``operation_eligible_machines``: link table for op → machine eligibility

This enables proper relational queries (find all ops on machine X, etc.)
and keeps foreign-key integrity at the DB level.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    String,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ..base import Base


class OperationModel(Base):
    __tablename__ = "operations"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    work_order_id: Mapped[str] = mapped_column(
        ForeignKey("work_orders.id", ondelete="CASCADE"), nullable=False, index=True
    )
    sequence: Mapped[int] = mapped_column(Integer, nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    duration_minutes: Mapped[int] = mapped_column(Integer, nullable=False)
    setup_minutes: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="pending")

    # Sequence-dependent setup: family tag for setup matrix lookup.
    setup_family: Mapped[str | None] = mapped_column(String(64), nullable=True, default=None)
    material_requirements_json: Mapped[list | None] = mapped_column(
        JSON, nullable=True, default=None
    )

    # Preemption support: allow splitting across working windows.
    preemptible: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    min_chunk_minutes: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # Execution and time-fence state fed by MES/planner interactions.
    actual_start: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    actual_machine_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    actual_end: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    remaining_duration_minutes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    firm_until: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    frozen_until: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    work_order = relationship("WorkOrderModel", back_populates="operations")
    eligible_machines: Mapped[list[OperationEligibleMachineModel]] = relationship(
        cascade="all, delete-orphan", back_populates="operation"
    )
    dependencies: Mapped[list[OperationDependencyModel]] = relationship(
        cascade="all, delete-orphan",
        foreign_keys="OperationDependencyModel.operation_id",
        back_populates="operation",
    )
    resource_requirements: Mapped[list[OperationResourceRequirementModel]] = relationship(
        cascade="all, delete-orphan", back_populates="operation"
    )
    routing_alternatives: Mapped[list[OperationRoutingAlternativeModel]] = relationship(
        cascade="all, delete-orphan", back_populates="operation"
    )


class OperationEligibleMachineModel(Base):
    __tablename__ = "operation_eligible_machines"
    __table_args__ = (
        UniqueConstraint("operation_id", "machine_id", name="uq_op_machine"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    operation_id: Mapped[str] = mapped_column(
        ForeignKey("operations.id", ondelete="CASCADE"), nullable=False
    )
    machine_id: Mapped[str] = mapped_column(
        ForeignKey("machines.id", ondelete="RESTRICT"), nullable=False
    )

    operation = relationship("OperationModel", back_populates="eligible_machines")


class OperationDependencyModel(Base):
    __tablename__ = "operation_dependencies"
    __table_args__ = (
        UniqueConstraint("operation_id", "depends_on_id", name="uq_op_dep"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    operation_id: Mapped[str] = mapped_column(
        ForeignKey("operations.id", ondelete="CASCADE"), nullable=False
    )
    depends_on_id: Mapped[str] = mapped_column(
        ForeignKey("operations.id", ondelete="CASCADE"), nullable=False
    )
    dependency_type: Mapped[str] = mapped_column(
        String(32), nullable=False, default="finish_to_start"
    )
    lag_minutes: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    max_wait_minutes: Mapped[int | None] = mapped_column(Integer, nullable=True)

    operation = relationship(
        "OperationModel",
        back_populates="dependencies",
        foreign_keys=[operation_id],
    )


class OperationResourceRequirementModel(Base):
    """Link table: how many units of a resource an operation requires."""

    __tablename__ = "operation_resource_requirements"
    __table_args__ = (
        UniqueConstraint("operation_id", "resource_id", name="uq_op_resource"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    operation_id: Mapped[str] = mapped_column(
        ForeignKey("operations.id", ondelete="CASCADE"), nullable=False
    )
    resource_id: Mapped[str] = mapped_column(
        ForeignKey("resources.id", ondelete="RESTRICT"), nullable=False
    )
    units: Mapped[int] = mapped_column(Integer, nullable=False, default=1)

    operation = relationship("OperationModel", back_populates="resource_requirements")


class OperationRoutingAlternativeModel(Base):
    """Routing alternative: a concrete way of performing an operation on a specific machine."""

    __tablename__ = "operation_routing_alternatives"
    __table_args__ = (
        UniqueConstraint("operation_id", "machine_id", name="uq_op_routing_machine"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    operation_id: Mapped[str] = mapped_column(
        ForeignKey("operations.id", ondelete="CASCADE"), nullable=False
    )
    machine_id: Mapped[str] = mapped_column(String(64), nullable=False)
    duration_minutes: Mapped[int] = mapped_column(Integer, nullable=False)
    setup_minutes: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # Resource requirements stored as JSON: [{"resource_id": "R1", "units": 2}, ...]
    resource_requirements_json: Mapped[list | None] = mapped_column(
        JSON, nullable=True, default=None
    )

    operation = relationship("OperationModel", back_populates="routing_alternatives")
