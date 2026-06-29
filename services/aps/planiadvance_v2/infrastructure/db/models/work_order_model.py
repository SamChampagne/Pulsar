"""Work order ORM model."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ..base import Base


class WorkOrderModel(Base):
    __tablename__ = "work_orders"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    organization_id: Mapped[str | None] = mapped_column(
        ForeignKey("organizations.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    workspace_id: Mapped[str | None] = mapped_column(
        String(64), nullable=True, index=True
    )
    product_id: Mapped[str] = mapped_column(String(64), nullable=False)
    quantity: Mapped[int] = mapped_column(Integer, nullable=False)
    due_date: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    release_date: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    priority: Mapped[int] = mapped_column(Integer, nullable=False, default=2)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="released")
    # V1.2 Cas 2 — firm / forecast / tentative. Default "firm" so any
    # legacy WO without an explicit firmness behaves like a real
    # customer order (no surprise demotion of existing data).
    firmness: Mapped[str] = mapped_column(
        String(16), nullable=False, default="firm", server_default="firm"
    )

    # Lot-sizing policy. mode is "none"/"fixed"/"min_max".
    lot_sizing_mode: Mapped[str] = mapped_column(String(16), nullable=False, default="none")
    lot_sizing_lot_size: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    lot_sizing_min: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    lot_sizing_max: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    operations: Mapped[list[OperationModel]] = relationship(  # type: ignore[name-defined]  # noqa: F821
        back_populates="work_order",
        cascade="all, delete-orphan",
        order_by="OperationModel.sequence",
    )
