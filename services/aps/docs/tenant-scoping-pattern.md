# Tenant scoping pattern (F-401)

PlaniAdvance V2 is multi-tenant. Every domain entity that belongs to a
customer (work orders, machines, schedules, calendars, integration
artefacts…) carries an `organization_id` and, optionally, a
`workspace_id`. The risk we engineered around is *cross-tenant leak*: a
use case that lists rows without applying the tenant scope returns rows
from every customer at once.

This document explains the pattern that closes that risk.

## TL;DR for new use-case authors

```python
from planiadvance_v2.infrastructure.scoping import TenantScope

# In an API route:
scope = TenantScope.for_organization(tenant.organization_id)  # or .for_workspace(...)
machines = machine_repo.with_scope(scope).list()
# `list()` ALWAYS filters by tenant. Calling it on an unscoped repo raises
# MissingTenantScopeError. Cross-tenant access requires the explicit
# `list_all_unscoped()` call below.

# Admin / reporting (cross-tenant) — must be deliberate:
all_machines = machine_repo.with_scope(TenantScope.unscoped()).list_all_unscoped()
```

The repository contract guarantees you cannot accidentally call
`list()` and get cross-tenant rows. If you forget to scope, you get an
exception, not a silent leak.

## The problem we solved

Before F-401, scoping was a convention enforced at every call site:

```python
# OLD pattern (still works for back-compat, but easy to get wrong):
machines = list_scoped(machine_repo, tenant.organization_id, tenant.workspace_id)
# vs the leaky one:
machines = machine_repo.list_all()   # returns every customer's machines
```

The audit (`docs/engine-audit-2026-05.md` finding F-401) found no current
leak, but the surface was unguarded — every new use case was one missed
helper-call away from cross-tenant data exposure. F-006/F-202/F-403 fixed
specific routes; F-401 fixes the contract so future routes can't reintroduce
the risk.

## The mechanism

Two pieces in `planiadvance_v2/infrastructure/scoping.py`:

### 1. `TenantScope`

Frozen dataclass holding `organization_id` and `workspace_id`. Build it
explicitly:

| Constructor | Meaning |
|-------------|---------|
| `TenantScope.unscoped()` | No scope. Calling `list()` raises `MissingTenantScopeError`. |
| `TenantScope.for_organization(org_id)` | Filter by org only. |
| `TenantScope.for_workspace(organization_id=..., workspace_id=...)` | Filter by both. |

### 2. `ScopedReadView` returned by `repo.with_scope(scope)`

Every tenant-aware repository (SQL and in-memory) inherits from
`ScopedRepositoryMixin[T]`, which adds one method:

```python
def with_scope(self, scope: TenantScope) -> ScopedReadView[T]: ...
```

The view exposes three methods:

| Method | Behaviour |
|--------|-----------|
| `list()` | Auto-scopes via `repo.list_for_scope(...)`. Raises `MissingTenantScopeError` if the scope is unset. |
| `get(entity_id)` | Returns `None` if the row exists but belongs to a different tenant — the row is hidden, never leaked. |
| `list_all_unscoped()` | Explicit cross-tenant escape hatch. Use only for admin / reporting / migration code. |

The view is a thin wrapper: writes (`add`, `delete`, etc.) still go on
the bare repository. Scope is only relevant for reads.

## Wiring it from a route

Routes already resolve a `TenantContext` via the `get_tenant_context`
dependency. Build the scope from that context:

```python
from planiadvance_v2.api.dependencies import get_tenant_scope_from_context
from planiadvance_v2.api.tenant import TenantContext, get_tenant_context

@router.get("/machines")
def list_machines(
    tenant: TenantContext = Depends(get_tenant_context),
    machines: SqlMachineRepository = Depends(get_machines_repo),
):
    scope = get_tenant_scope_from_context(
        organization_id=tenant.organization_id,
        workspace_id=tenant.workspace_id,
    )
    return machines.with_scope(scope).list()
```

Anonymous calls (no headers) get an unscoped repo. They MUST opt into
`list_all_unscoped()` to read anything; they can no longer call `list()`
"by default" and accidentally see every tenant.

## What about existing code?

The pattern is **additive**. Existing methods (`list_all`,
`list_for_organization`, `list_for_scope`) still exist and still work.
The historical `list_scoped(repo, org_id, ws_id)` helper in
`application/use_cases/tenant_scope.py` is unchanged.

You should:

- **New code** — always go through `repo.with_scope(scope).list()`.
- **Touched legacy code** — migrate it to the new pattern as you edit it.
- **Untouched legacy code** — leave it; it is already covered by F-006 /
  F-202 / F-403 point fixes.

## Acceptance / regression test

`tests/unit/infrastructure/test_scoped_repository.py` is the framework
guard. It exercises the contract on:

- `InMemoryMachineRepository` (the in-memory pattern)
- `SqlMachineRepository` against sqlite in-memory (the SQL adapter)

If a future repository forgets to inherit from `ScopedRepositoryMixin`,
or `list_for_scope` regresses, the test catches it. A hostile use case
that calls `repo.with_scope(...).list()` with the wrong tenant cannot
return rows from another tenant — that is the exact leak F-401 prevents.

## Related fixes

- **F-006** — dashboard endpoint org-check (point fix, commit `31cce18`).
- **F-202** — payload workspace_id validation (point fix, commit `cf540a7`).
- **F-403** — IntegrationPrincipal anonymous flag (point fix, commit `8b522d8`).
- **F-401** — this pattern (framework guard, this document).
