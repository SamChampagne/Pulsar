"""Inventory ORM model."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, Float, String
from sqlalchemy.orm import Mapped, mapped_column

from ..base import Base


class InventoryItemModel(Base):
    __tablename__ = "inventory_items"

    material_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    quantity_on_hand: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    as_of: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, default=None)
    organization_id: Mapped[str | None] = mapped_column(
        String(64), nullable=True, index=True
    )
    workspace_id: Mapped[str | None] = mapped_column(
        String(64), nullable=True, index=True
    )
