"""F-401 regression: cross-tenant leak prevention contract.

These tests guard the contract every tenant-aware repository must respect
under the ScopedSession pattern (F-401):

1. A naive call to ``repo.list()`` under tenant A's scope MUST NOT see
   tenant B's rows.
2. Cross-tenant access requires the explicit ``list_all_unscoped()`` opt-in.
3. Calling scoped methods without a scope raises ``MissingTenantScopeError``.
4. ``get(id)`` hides rows that exist but belong to another tenant.

Without this contract, every new use case in J2/J3 is one missed scoping
call away from a silent multi-tenant data leak. Point fixes F-006/F-202/
F-403 protect specific routes; this test guards the *framework*.
"""

from __future__ import annotations

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from planiadvance_v2.domain.entities import Machine
from planiadvance_v2.infrastructure.db.base import Base
from planiadvance_v2.infrastructure.db.models import MachineModel  # noqa: F401
from planiadvance_v2.infrastructure.db.repositories import SqlMachineRepository
from planiadvance_v2.infrastructure.in_memory.repositories import (
    InMemoryMachineRepository,
)
from planiadvance_v2.infrastructure.scoping import (
    MissingTenantScopeError,
    TenantScope,
)


def _machine(
    machine_id: str,
    *,
    organization_id: str | None,
    workspace_id: str | None = None,
) -> Machine:
    return Machine(
        id=machine_id,
        name=machine_id,
        calendar_id="CAL",
        organization_id=organization_id,
        workspace_id=workspace_id,
    )


class TestScopedRepositoryContract:
    def test_list_returns_only_current_tenant_rows(self):
        backing = InMemoryMachineRepository(
            [
                _machine("M-A1", organization_id="org-a"),
                _machine("M-A2", organization_id="org-a", workspace_id="plant-a"),
                _machine("M-B", organization_id="org-b"),
            ]
        )
        scope = TenantScope.for_organization("org-a")
        repo = backing.with_scope(scope)

        visible = {m.id for m in repo.list()}

        assert visible == {"M-A1", "M-A2"}, (
            "ScopedRepository.list() leaked rows from another tenant — this is "
            "the regression F-401 prevents."
        )

    def test_list_filters_by_workspace_when_provided(self):
        backing = InMemoryMachineRepository(
            [
                _machine(
                    "M-A-PLANT-A",
                    organization_id="org-a",
                    workspace_id="plant-a",
                ),
                _machine(
                    "M-A-PLANT-B",
                    organization_id="org-a",
                    workspace_id="plant-b",
                ),
                _machine(
                    "M-B-PLANT-A",
                    organization_id="org-b",
                    workspace_id="plant-a",
                ),
            ]
        )
        scope = TenantScope.for_workspace(
            organization_id="org-a",
            workspace_id="plant-a",
        )
        repo = backing.with_scope(scope)

        visible = {m.id for m in repo.list()}

        assert visible == {"M-A-PLANT-A"}, (
            "Workspace scope must filter to that workspace within the org."
        )

    def test_get_hides_cross_tenant_rows(self):
        backing = InMemoryMachineRepository(
            [
                _machine("M-A", organization_id="org-a"),
                _machine("M-B", organization_id="org-b"),
            ]
        )
        scope = TenantScope.for_organization("org-a")
        repo = backing.with_scope(scope)

        assert repo.get("M-A") is not None
        assert repo.get("M-B") is None, "ScopedRepository.get() must hide cross-tenant rows."

    def test_list_raises_when_scope_required_but_missing(self):
        backing = InMemoryMachineRepository([_machine("M-A", organization_id="org-a")])
        repo = backing.with_scope(TenantScope.unscoped())

        with pytest.raises(MissingTenantScopeError):
            repo.list()

    def test_list_all_unscoped_is_explicit_escape_hatch(self):
        backing = InMemoryMachineRepository(
            [
                _machine("M-A", organization_id="org-a"),
                _machine("M-B", organization_id="org-b"),
            ]
        )
        scope = TenantScope.for_organization("org-a")
        repo = backing.with_scope(scope)

        visible = {m.id for m in repo.list_all_unscoped()}

        assert visible == {"M-A", "M-B"}, (
            "list_all_unscoped() is the documented escape hatch and must not apply scope filtering."
        )


class TestScopedSqlRepositoryContract:
    """Same contract, exercised against the SQLAlchemy adapter.

    Uses sqlite in-memory so the test stays in the unit suite. The SQL
    repository's ``list_for_scope`` already filters by tenant; F-401 wraps
    that behind the explicit ``with_scope().list()`` API so naive callers
    cannot bypass it.
    """

    @pytest.fixture
    def session(self):
        engine = create_engine("sqlite+pysqlite:///:memory:", future=True)
        Base.metadata.create_all(engine)
        Session = sessionmaker(bind=engine, expire_on_commit=False, autoflush=False)
        with Session() as session:
            yield session

    def _seed_two_tenant_machines(self, session) -> SqlMachineRepository:
        repo = SqlMachineRepository(session)
        repo.add(_machine("M-A1", organization_id="org-a"))
        repo.add(_machine("M-A2", organization_id="org-a", workspace_id="plant-a"))
        repo.add(_machine("M-B", organization_id="org-b"))
        session.flush()
        return repo

    def test_sql_list_returns_only_current_tenant_rows(self, session):
        repo = self._seed_two_tenant_machines(session)
        scope = TenantScope.for_organization("org-a")

        scoped = repo.with_scope(scope)

        visible = {m.id for m in scoped.list()}

        assert visible == {"M-A1", "M-A2"}

    def test_sql_get_hides_cross_tenant_rows(self, session):
        repo = self._seed_two_tenant_machines(session)
        scope = TenantScope.for_organization("org-a")

        scoped = repo.with_scope(scope)

        assert scoped.get("M-A1") is not None
        assert scoped.get("M-B") is None

    def test_sql_list_raises_when_scope_required_but_missing(self, session):
        repo = self._seed_two_tenant_machines(session)

        scoped = repo.with_scope(TenantScope.unscoped())

        with pytest.raises(MissingTenantScopeError):
            scoped.list()

    def test_sql_list_all_unscoped_is_explicit_escape_hatch(self, session):
        repo = self._seed_two_tenant_machines(session)
        scope = TenantScope.for_organization("org-a")

        scoped = repo.with_scope(scope)

        visible = {m.id for m in scoped.list_all_unscoped()}

        assert visible == {"M-A1", "M-A2", "M-B"}
