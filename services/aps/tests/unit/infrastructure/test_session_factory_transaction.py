"""V1.2 P0.2 — regression for the transactional guarantee on import flows.

The V1.2 audit raised the concern that ``ImportPlanningSnapshot``
performs multiple ``repo.add()`` calls in sequence without an explicit
transaction wrapper. If the 4th add() raised, would the previous three
already be written?

Reading the code shows the answer is "no": every request goes through
``SessionFactory.session()`` (infrastructure/db/session.py), which is a
context manager that commits on clean exit and rolls back on any
exception. The use case never needs to think about it.

This test pins that contract so a refactor of session.py can't silently
downgrade the guarantee. We use an in-memory SQLite engine to avoid the
real Postgres dependency, with a tiny one-column table; the persistence
mechanics (commit/rollback semantics) are identical.
"""

from __future__ import annotations

import pytest
from sqlalchemy import Column, Integer, String, Table, create_engine, select
from sqlalchemy.orm import DeclarativeBase

from planiadvance_v2.infrastructure.db.session import SessionFactory


class _Base(DeclarativeBase):
    pass


_widgets = Table(
    "widgets",
    _Base.metadata,
    Column("id", Integer, primary_key=True),
    Column("name", String, nullable=False),
)


@pytest.fixture
def factory() -> SessionFactory:
    engine = create_engine("sqlite:///:memory:", future=True)
    _Base.metadata.create_all(engine)
    return SessionFactory(engine=engine)


def test_commit_on_clean_exit(factory: SessionFactory) -> None:
    with factory.session() as session:
        session.execute(_widgets.insert().values(id=1, name="alpha"))
        session.execute(_widgets.insert().values(id=2, name="beta"))

    with factory.session() as session:
        rows = session.execute(select(_widgets.c.name).order_by(_widgets.c.id)).all()

    assert [row[0] for row in rows] == ["alpha", "beta"]


def test_rollback_on_exception_mid_transaction(factory: SessionFactory) -> None:
    """The single most important transactional property for the import
    use case: if anything raises mid-loop, no partial state survives.

    The use case writes calendars, then machines, then resources, then
    work orders. If the 3rd add() raises (FK violation, invalid data,
    network hiccup against a dependent service), the calendars and
    machines that were added before MUST NOT persist — otherwise the
    next replay sees them as already-imported and the user is stuck.
    """

    class _DeliberateFailure(Exception):
        pass

    with pytest.raises(_DeliberateFailure):
        with factory.session() as session:
            session.execute(_widgets.insert().values(id=1, name="calendar"))
            session.execute(_widgets.insert().values(id=2, name="machine"))
            # Simulate the 3rd entity blowing up — e.g. resource import
            # hits a constraint, or the upstream API drops the connection.
            raise _DeliberateFailure("simulated mid-import error")

    with factory.session() as session:
        rows = session.execute(select(_widgets.c.id)).all()

    # Both previous inserts must be gone. If this assertion ever fails,
    # ImportPlanningSnapshot's transaction safety is broken — fix
    # SessionFactory.session() before merging anything else.
    assert rows == []


def test_rollback_reraises_the_original_exception(factory: SessionFactory) -> None:
    """The context manager must not swallow the failure: the route layer
    relies on the exception bubbling up to translate it into the right
    HTTP status (422 for ValidationError, 500 for everything else)."""

    class _Boom(Exception):
        pass

    with pytest.raises(_Boom, match="explicit"):
        with factory.session() as session:
            session.execute(_widgets.insert().values(id=99, name="x"))
            raise _Boom("explicit error from the use case")
