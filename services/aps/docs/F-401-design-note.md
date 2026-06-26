# F-401 — ScopedRepositoryFactory pattern (design note)

**Status:** designed, not yet implemented
**Severity:** medium
**Effort:** M (1-2 days)
**Source:** J0 audit section 4.4

## Problem

Tenant scoping today is enforced by convention only:
- Use cases receive bare `XRepository` ports.
- Scoping happens at use-case call sites via `list_scoped(repo, organization_id, workspace_id)`.
- A new use case that forgets to call `list_scoped` and uses `repo.list_all()` directly will silently leak cross-tenant data.
- The audit found no current leak, but the surface is unguarded — every new use case is one missed guard away from a leak.

Today's mitigations (after this session's fixes):
- F-006: dashboard route now scopes via `validate_schedule_scope`.
- F-202: `verify_payload_workspace_in_org` rejects payload workspace_id that does not belong to the org.
- F-403: `IntegrationPrincipal.require_organization_id()` gives a clear opt-in error for tenant-less calls.

These are pointwise fixes. F-401 is the framework-level guard that makes future leaks impossible by construction.

## Proposed pattern: ScopedSession + ScopedRepository

### Layer 1 — ScopedSession

A thin wrapper that bundles (`Session`, `organization_id`, `workspace_id`) and is created once per request from `TenantContext`.

```python
# planiadvance_v2/infrastructure/db/scoped_session.py

@dataclass(frozen=True)
class ScopedSession:
    session: Session
    organization_id: str | None
    workspace_id: str | None

    @classmethod
    def from_tenant(cls, session: Session, tenant: TenantContext) -> "ScopedSession":
        return cls(
            session=session,
            organization_id=tenant.organization_id,
            workspace_id=tenant.workspace_id,
        )
```

### Layer 2 — ScopedRepository base

Repositories that can leak (machine, work_order, schedule, etc.) gain a constructor that accepts `ScopedSession` instead of `Session`. They expose:

- `list()` — automatically applies tenant scope if `organization_id` is set; raises `MissingTenantScopeError` if called when scope is REQUIRED but absent
- `list_all_unscoped()` — explicit cross-tenant query, must be explicitly chosen by the caller (e.g., admin/reporting use cases)
- `get(id)` — same scoping logic; returns None if the row exists but in a different tenant

The default `list()` of every scoped repo MUST go through the scope. Adding new methods that bypass scope requires explicit `_unscoped` suffix.

### Layer 3 — Dependency wiring

`api/dependencies.py` uses `ScopedSession.from_tenant(session, tenant)` to build the per-request session, then passes it to repositories.

### Layer 4 — Use cases

Use cases continue to receive `XRepository` ports. They are unchanged. The scope enforcement happens inside the repository layer, not at the use-case call site. `list_scoped` becomes obsolete.

## Migration plan

This pattern requires changes in:

1. New file: `infrastructure/db/scoped_session.py`
2. Each tenant-aware SQL repository (~10 files in `infrastructure/db/repositories/`):
   - Update constructor to accept `ScopedSession`
   - Rewrite `list_all` → `list` with auto-scope
   - Add `list_all_unscoped` for explicit opt-in cross-tenant
3. `api/dependencies.py` — every `get_<repo>` factory updated to build `ScopedSession`
4. `api/dependencies.py` — every `get_<use_case>` factory updated to pass the new repos
5. Tests: update fixtures that build repositories directly (in-memory tests should mirror the same pattern for consistency)

Estimated effort: M (1-2 days of focused work). Touches ~20 files but the change in each file is mechanical.

## Acceptance criteria

- New code review: any new SQL repository method that does not include the `_unscoped` suffix MUST be auto-scoped — failure to scope raises at runtime
- Integration test: a use case that bypasses scope (regression test) raises `MissingTenantScopeError` instead of returning cross-tenant data
- All existing tests still pass (the pattern is additive — `list_all` becomes `list_all_unscoped` for tests that explicitly want cross-tenant)
- Documentation: a one-page `docs/tenant-scoping-pattern.md` explains the pattern for future developers

## Why defer to a fresh session

This is the kind of structural work where the value comes from doing it carefully and consistently. Touching 20 files mechanically at the end of a long execution session is high risk. A fresh session with focused attention will produce a cleaner result.

## When to do it

Before starting J2 (Reports module) and beyond. Reports will introduce new use cases that access work_orders, schedules, and machines — without F-401 in place, each new report becomes another opportunity to forget scoping.
