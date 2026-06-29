from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from ..base import Base


class IntegrationBindingModel(Base):
    __tablename__ = "integration_bindings"
    __table_args__ = (
        UniqueConstraint(
            "entity_type",
            "source_system",
            "external_ref",
            name="uq_integration_binding_key",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    entity_type: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    source_system: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    external_ref: Mapped[str] = mapped_column(String(255), nullable=False)
    internal_id: Mapped[str] = mapped_column(String(128), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, default=datetime.utcnow
    )
