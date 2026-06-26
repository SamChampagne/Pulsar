from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, String
from sqlalchemy.orm import Mapped, mapped_column

from ..base import Base


class UserSessionRevocationModel(Base):
    __tablename__ = "user_session_revocations"

    user_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    revoked_before_iat: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    revoked_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
