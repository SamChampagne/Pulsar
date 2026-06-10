# Architecture

## Monorepo

pnpm workspaces, TypeScript everywhere:

```
apps/
  api/        NestJS — the only process talking to the database
  web/        SvelteKit SPA — talks to the API over REST
packages/
  shared/     Pure TypeScript, no runtime deps. Domain contracts shared front/back:
              status enums, workflow state machines, permission & module catalogs, API types.
  database/   Prisma schema + seed. Re-exports @prisma/client so apps never depend on it directly.
```

Dependency direction (build order): `shared` → `database` → `api` / `web`.
`shared` is the **source of truth** for enums and permission keys; the Prisma schema mirrors enum
values, and the seed writes the catalogs into the database.

## API layering (apps/api)

```
src/
  main.ts              bootstrap: /api/v1 prefix, validation pipe, CORS, Swagger (/api/docs)
  app.module.ts        wires modules + global guards
  prisma/              PrismaService (global)
  common/              decorators, guards, pagination, shared DTOs
  core/                platform modules: auth, tenants, users, roles, permissions,
                       audit-logs, documents, notifications, integrations, module-registry
  modules/
    transportation/    business module: one folder per aggregate
                       (customers, locations, carriers, drivers, vehicles, trailers,
                        rates, transport-orders, shipments, loads, routes, tracking)
```

### Request pipeline

```mermaid
sequenceDiagram
  participant W as Web (SPA)
  participant G1 as JwtAuthGuard
  participant G2 as ModulesGuard
  participant G3 as PermissionsGuard
  participant C as Controller
  participant S as Service
  participant DB as PostgreSQL

  W->>G1: GET /api/v1/transportation/loads (Bearer JWT)
  G1->>G1: verify token → request.user { id, tenantId, permissions }
  G1->>G2: ok
  G2->>DB: tenant_modules: "transportation" enabled for tenantId?
  G2->>G3: ok (else 403)
  G3->>G3: user.permissions ⊇ @RequirePermissions? (else 403)
  G3->>C: ok
  C->>S: list(user.tenantId, query)
  S->>DB: WHERE tenantId = ... (always)
  DB-->>W: Paginated<Load>
```

Every request passes three global guards, in order:

1. **JwtAuthGuard** — validates the Bearer token (skipped on `@Public()` endpoints). The JWT
   payload (user id, tenantId, permission keys) becomes `request.user`.
2. **ModulesGuard** — if the controller carries `@RequireModule(key)`, verifies the module is
   enabled for the caller's tenant (`tenant_modules` table). This is what makes modules
   activable per tenant.
3. **PermissionsGuard** — if the handler carries `@RequirePermissions(...)`, verifies the JWT
   permission set contains them all.

Services receive `tenantId` explicitly from controllers (taken from `@CurrentUser()`) and filter
every query with it — see [multi-tenancy.md](./multi-tenancy.md).

### Workflow enforcement

Status transitions for TransportOrder/Shipment/Load are defined once in
`packages/shared/src/workflows` and enforced in services (`canTransition*`). Invalid transitions
return 400. Status changes write an `audit_logs` row and, for execution events, a
`tracking_events` row.

## Web app (apps/web)

- SvelteKit in **SPA mode** (`ssr=false`, adapter-static with `index.html` fallback): JWT lives
  client-side; SSR will be revisited with SSO/session auth.
- `src/lib/api/client.ts` — typed fetch wrapper (Bearer header, 401 → redirect `/login`).
- `src/lib/stores/auth.ts` — session store persisted in localStorage.
- Route group `(app)` carries the authenticated shell (sidebar + guard). Navigation entries are
  conditioned on `tenant.enabledModules`, so a tenant without the TMS sees no TMS menu.
- Dev server proxies `/api` → `http://localhost:3000` (no CORS during development).

## Decisions & trade-offs (v0)

| Decision                          | Rationale / revisit point                                  |
| --------------------------------- | ---------------------------------------------------------- |
| Shared DB, `tenantId` column      | Cheapest to operate; revisit schema-per-tenant on demand    |
| Permissions embedded in JWT       | No per-request DB hit; role changes apply at next login — revisit with refresh tokens |
| ModulesGuard queries DB per req   | Correctness first; cache planned (phase 2)                  |
| Count-based document numbering    | Simple; replace with per-tenant sequences (phase 1)         |
| REST (not GraphQL)                | Predictable, cacheable, easy to integrate for B2B customers |
| SPA (not SSR)                     | JWT-only auth; flip when sessions/SSO arrive                |
