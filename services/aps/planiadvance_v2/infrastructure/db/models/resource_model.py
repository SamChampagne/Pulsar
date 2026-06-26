"""Resource ORM model: secondary resources with finite capacity."""

from __future__ import annotations

from sqlalchemy import JSON, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from ..base import Base


class ResourceModel(Base):
    __tablename__ = "resources"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    capacity: Mapped[int] = mapped_column(Integer, nullable=False)
    calendar_id: Mapped[str | None] = mapped_column(
        ForeignKey("calendars.id", ondelete="SET NULL"), nullable=True, default=None
    )
    tags: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
    organization_id: Mapped[str | None] = mapped_column(
        String(64), nullable=True, index=True
    )
    workspace_id: Mapped[str | None] = mapped_column(
        String(64), nullable=True, index=True
    )
