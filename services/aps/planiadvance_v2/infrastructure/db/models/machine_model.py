"""Machine ORM model.

Stores all machine configuration including advanced industrial features:
- ``setup_matrix_json``: sequence-dependent setup time matrix (JSON)
- ``maintenance_windows_json``: planned downtime windows (JSON list)
"""

from __future__ import annotations

from sqlalchemy import JSON, Float, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from ..base import Base


class MachineModel(Base):
    __tablename__ = "machines"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    calendar_id: Mapped[str] = mapped_column(
        ForeignKey("calendars.id", ondelete="RESTRICT"), nullable=False
    )
    efficiency: Mapped[float] = mapped_column(Float, nullable=False, default=1.0)
    capabilities: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
    organization_id: Mapped[str | None] = mapped_column(
        ForeignKey("organizations.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    workspace_id: Mapped[str | None] = mapped_column(
        String(64), nullable=True, index=True
    )

    # Sequence-dependent setup time matrix.
    # JSON structure: {"default_minutes": int, "initial_minutes": int,
    #   "transitions": [{"from": str, "to": str, "minutes": int}, ...]}
    # NULL means no matrix (use per-operation fixed setup).
    setup_matrix_json: Mapped[dict | None] = mapped_column(
        JSON, nullable=True, default=None
    )

    # Planned maintenance windows.
    # JSON structure: [{"start": ISO8601, "end": ISO8601}, ...]
    maintenance_windows_json: Mapped[list | None] = mapped_column(
        JSON, nullable=True, default=None
    )
