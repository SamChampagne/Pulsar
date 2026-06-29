"""SQLAlchemy declarative base.

Isolated in its own file so that models can import ``Base`` without
pulling in session / engine wiring (which would cause import cycles during
Alembic autogeneration).
"""

from __future__ import annotations

from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    """Project-wide declarative base."""

    pass
