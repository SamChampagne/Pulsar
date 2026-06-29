"""SQLAlchemy engine / session factory wiring.

V2 uses the **sync** SQLAlchemy API with ``psycopg`` (psycopg3). The
previous version used async (asyncpg) but the extra complexity was not
paying off: the APS engine is CPU-bound, and all use cases run in request
scope. Sync SQLAlchemy gives us cleaner tests, simpler transaction
management and identical throughput for this workload.
"""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from functools import lru_cache

from sqlalchemy import create_engine
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from ...config import get_settings
from .migrations import run_migrations


class SessionFactory:
    """Thin wrapper around SQLAlchemy's ``sessionmaker`` that yields
    transactional sessions via a context manager.
    """

    def __init__(self, engine: Engine) -> None:
        self._engine = engine
        self._sessionmaker = sessionmaker(
            bind=engine, expire_on_commit=False, autoflush=False
        )

    @property
    def engine(self) -> Engine:
        return self._engine

    @contextmanager
    def session(self) -> Iterator[Session]:
        """Yield a session with automatic commit / rollback semantics."""
        session = self._sessionmaker()
        try:
            yield session
            session.commit()
        except Exception:
            session.rollback()
            raise
        finally:
            session.close()


@lru_cache(maxsize=1)
def get_session_factory() -> SessionFactory:
    settings = get_settings()
    engine = create_engine(
        settings.database_url,
        pool_pre_ping=True,
        pool_size=5,
        max_overflow=5,
        pool_timeout=10,
        pool_recycle=1800,
        connect_args={"connect_timeout": 5},
        future=True,
    )
    return SessionFactory(engine=engine)


def init_schema(factory: SessionFactory | None = None) -> None:
    """Apply schema migrations up to the current head revision.

    Local Docker/dev now uses the same migration path as any real
    deployment, which avoids silent schema drift when the SQLAlchemy
    models gain new columns.
    """
    factory = factory or get_session_factory()
    run_migrations(str(factory.engine.url))
