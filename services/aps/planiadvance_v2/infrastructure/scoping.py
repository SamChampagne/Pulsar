"""Tenant scoping primitives shared by every repository implementation.

The motivation (F-401): tenant scoping used to be enforced by convention.
Use cases received bare repositories and were expected to call
``list_for_organization`` or the ``list_scoped`` helper. Any new use case
that forgot the helper and called ``list_all`` directly leaked rows
across tenants.

This module turns the convention into a contract:

- :class:`TenantScope` carries the active organization / workspace ids.
- Repositories expose ``with_scope(scope)`` which returns a scoped view.
- The scoped view's default ``list()`` and ``get()`` filter automatically.
- :class:`MissingTenantScopeError` fires when a scoped operation is called
  without a scope. Routes that legitimately need cross-tenant data must
  call ``list_all_unscoped()`` (e.g. admin / reporting).

The point: future use cases cannot leak data by being naive — the only
way to bypass the scope is to explicitly type ``unscoped``.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Generic, Protocol, TypeVar

T = TypeVar("T")


class MissingTenantScopeError(RuntimeError):
    """Raised when a scoped repository operation is called with no scope."""


@dataclass(frozen=True, slots=True)
class TenantScope:
    """Active tenant scope for a repository operation.

    Both fields are optional so unauthenticated local-dev calls still
    work (they get an unscoped repo and must opt in to scoped methods
    explicitly).
    """

    organization_id: str | None = None
    workspace_id: str | None = None

    @classmethod
    def unscoped(cls) -> TenantScope:
        return cls()

    @classmethod
    def for_organization(cls, organization_id: str) -> TenantScope:
        return cls(organization_id=organization_id)

    @classmethod
    def for_workspace(
        cls,
        *,
        organization_id: str,
        workspace_id: str,
    ) -> TenantScope:
        return cls(organization_id=organization_id, workspace_id=workspace_id)

    @property
    def is_set(self) -> bool:
        return self.organization_id is not None

    def require_organization(self) -> str:
        if self.organization_id is None:
            raise MissingTenantScopeError(
                "This operation requires a tenant scope (organization_id). "
                "Either build the repository with TenantScope.for_organization(...) "
                "or call list_all_unscoped() to opt into cross-tenant access."
            )
        return self.organization_id


class _TenantAwareBacking(Protocol[T]):
    """Backing repository surface required to build a scoped view.

    Every tenant-aware in-memory or SQL repository already provides these
    three methods (``list_all`` / ``list_for_scope`` / ``get``) so the
    scoped view can be assembled around them without rewriting each repo.
    """

    def list_all(self) -> list[T]: ...
    def list_for_scope(
        self,
        *,
        organization_id: str | None = None,
        workspace_id: str | None = None,
    ) -> list[T]: ...
    def get(self, entity_id: str) -> T | None: ...


class ScopedReadView(Generic[T]):
    """Read-only scoped view exposed by every tenant-aware repository.

    Construct via ``backing.with_scope(scope)``. The view's default
    ``list()`` and ``get()`` apply the scope automatically. Cross-tenant
    callers must opt in explicitly via ``list_all_unscoped()``.
    """

    __slots__ = ("_backing", "_scope")

    def __init__(self, backing: _TenantAwareBacking[T], scope: TenantScope) -> None:
        self._backing = backing
        self._scope = scope

    @property
    def scope(self) -> TenantScope:
        return self._scope

    def list(self) -> list[T]:
        if not self._scope.is_set:
            raise MissingTenantScopeError(
                "Repository.list() requires a tenant scope. Build the repo "
                "with TenantScope.for_organization(...) or call "
                "list_all_unscoped() to opt into cross-tenant access."
            )
        return self._backing.list_for_scope(
            organization_id=self._scope.organization_id,
            workspace_id=self._scope.workspace_id,
        )

    def get(self, entity_id: str) -> T | None:
        row = self._backing.get(entity_id)
        if row is None:
            return None
        if not self._row_in_scope(row):
            return None
        return row

    def list_all_unscoped(self) -> list[T]:
        return self._backing.list_all()

    def _row_in_scope(self, row: T) -> bool:
        if self._scope.organization_id is not None:
            row_org = getattr(row, "organization_id", None)
            if row_org is not None and row_org != self._scope.organization_id:
                return False
        if self._scope.workspace_id is not None:
            row_ws = getattr(row, "workspace_id", None)
            if row_ws is not None and row_ws != self._scope.workspace_id:
                return False
        return True


class ScopedRepositoryMixin(Generic[T]):
    """Mixin for tenant-aware repositories.

    Adding this to a repository class gives it the F-401 ``with_scope(scope)``
    factory method. The host class must provide ``list_all``, ``list_for_scope``,
    and ``get`` — every tenant-aware repository in the codebase already does.
    """

    def with_scope(self, scope: TenantScope) -> ScopedReadView[T]:
        return ScopedReadView(self, scope)  # type: ignore[arg-type]
