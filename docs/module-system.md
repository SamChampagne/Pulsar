# Module system

Pulsar is a platform core + business modules activable **per tenant**. This is the mechanism that
lets one codebase serve customers who bought only the TMS, and later customers who add Fleet,
Yard, WMS, Portal, Analytics or Billing.

## The three layers

1. **Catalog (code)** — `packages/shared/src/modules.ts` declares every module key and its
   metadata (`MODULE_CATALOG`). Planned modules are declared with `available: false` so keys are
   reserved from day one.
2. **Catalog (database)** — the seed upserts the catalog into `module_definitions`. Per-tenant
   activation lives in `tenant_modules (tenantId, moduleId, enabled, settings)`.
3. **Enforcement (runtime)**:
   - API: business controllers carry `@RequireModule(MODULE_KEYS.TRANSPORTATION)` at class level;
     the global `ModulesGuard` returns 403 if the tenant hasn't enabled the module.
   - Web: the login response includes `tenant.enabledModules`; navigation sections render only
     for enabled modules.

## Management API

```
GET   /api/v1/modules          → catalog with enabled state for the caller's tenant
PATCH /api/v1/modules/:key     → { "enabled": true|false }   (permission core.modules.manage)
```

Rules enforced by `ModuleRegistryService`: `core` cannot be toggled; a module with
`available: false` cannot be enabled.

## Adding a new module

See the step-by-step recipe in [CLAUDE.md](../CLAUDE.md#adding-a-business-module-the-recipe).
In short: flip `available` in the shared catalog → add permission keys → add Prisma models →
create `apps/api/src/modules/<key>/` gated by `@RequireModule` → conditional navigation in the
web shell → reseed.

## Design notes

- Module *settings* (per-tenant JSON on `tenant_modules`) exist in the schema but have no UI yet.
- `ModulesGuard` queries the DB on each guarded request; an in-memory cache with short TTL is
  planned (phase 2) — keep the guard as the single enforcement point so the cache lands in one place.
- Cross-module dependencies (e.g. Billing needs Transportation) are not modeled yet; add a
  `dependsOn` array to `ModuleDescriptor` when the need appears.
