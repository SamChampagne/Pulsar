# Multi-tenancy

## Strategy: shared database, shared schema

Every tenant-scoped table carries a `tenantId` column (indexed, usually part of a composite
unique like `@@unique([tenantId, code])`). One PostgreSQL database serves all tenants.

Why this model first:

- cheapest to operate and migrate (one schema, one migration run),
- good enough isolation for the target segment when enforced rigorously,
- the data model keeps a `Tenant` FK everywhere, so moving a tenant to its own schema/database
  later is a data migration, not a redesign.

## Enforcement rules (non-negotiable)

1. The tenant id comes **only from the JWT** (`request.user.tenantId`), set at login. It is never
   read from a request body, query param or header.
2. Every service method takes `tenantId` as its first argument and includes it in **every**
   `where` clause (reads, updates, deletes). Get-by-id is always `findFirst({ where: { id, tenantId } })`.
3. Cross-tenant uniqueness is expressed as composite constraints (`[tenantId, email]`,
   `[tenantId, orderNumber]`, …) — never global uniques on business fields.
4. Catalogs that are intentionally platform-wide (permissions, module definitions) have **no**
   `tenantId` — that's the documented exception.

## Login & tenant resolution

`POST /auth/login` accepts `email + password (+ tenant slug)`. The same email may exist in
several tenants (`@@unique([tenantId, email])`); the optional slug disambiguates. The issued JWT
pins the session to one tenant. Switching tenants = logging in again (a tenant-switcher is a
later UX feature).

## Known gaps / future hardening

- **Write-path referential checks**: create/update DTOs referencing other entities
  (customerId, locationId, carrierId…) should verify those rows belong to the same tenant.
  Read paths are tenant-filtered, but a forged cross-tenant id on a write currently links rows
  across tenants. Planned phase 1 (see TODO.md).
- **Defense in depth**: consider PostgreSQL Row-Level Security keyed on a session variable, or a
  Prisma client extension auto-injecting `tenantId`, as a second enforcement layer.
- **Per-tenant rate limiting and quotas** once public-facing.
