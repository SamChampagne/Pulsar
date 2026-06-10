# CLAUDE.md — Pulsar

Guidance for AI coding sessions in this repository.

## What this is

Pulsar is a **multi-tenant modular logistics SaaS**. Platform core (auth/RBAC/audit/module
registry) + business modules activable per tenant. First module: **Transportation (TMS)**.
Read [PRODUCT_SPEC.md](./PRODUCT_SPEC.md) for domain context, [ROADMAP.md](./ROADMAP.md) and
[TODO.md](./TODO.md) for what to build next.

## Layout

| Path                | Contents                                                                |
| ------------------- | ----------------------------------------------------------------------- |
| `apps/api`          | NestJS REST API. `src/core/*` = platform, `src/modules/*` = business    |
| `apps/web`          | SvelteKit **SPA** (Svelte 5 runes, `ssr=false`, adapter-static)         |
| `packages/shared`   | Source of truth: status enums, state machines, permission catalog, types|
| `packages/database` | Prisma schema + seed; re-exports `@prisma/client`                       |

## Commands

```bash
pnpm setup        # install + prisma generate + build shared/database
pnpm db:up        # start postgres (docker)
pnpm db:migrate   # prisma migrate dev (run from repo root)
pnpm db:seed      # seed catalogs + demo tenant (admin@pulsar.dev / admin123, tenant: acme)
pnpm dev          # api :3000 + web :5173 (web proxies /api → :3000)
pnpm build        # build everything (order matters: shared → database → api → web)
pnpm typecheck    # all workspaces
pnpm test         # unit tests (state machines in packages/shared)
pnpm test:e2e     # full workflow over HTTP — needs a seeded DB (db:up + db:migrate + db:seed)
```

Swagger: http://localhost:3000/api/docs. Env: copy `.env.example` → `.env` at the repo root.

## Hard rules

1. **Tenant isolation**: every query on tenant-scoped tables MUST filter by `tenantId` taken from
   the JWT (`@CurrentUser()`). Never trust a tenantId from the request body.
2. **Status changes go through the state machines** in `packages/shared/src/workflows`. Never
   `update({ status })` directly without a `canTransition*` check.
3. **Enums live in `packages/shared`** and are mirrored in `schema.prisma` with identical value
   names. Change both together; regenerate (`pnpm db:generate`) and migrate.
4. **Apps import Prisma via `@pulsar/database`**, never `@prisma/client` directly.
5. **Permissions**: every new endpoint needs `@RequirePermissions(...)`; business-module
   controllers also need `@RequireModule(MODULE_KEYS.X)` at class level. New permission keys go
   in `packages/shared/src/permissions.ts` (catalog) and are picked up by the seed.
6. **Audit**: status changes and sensitive mutations call `AuditLogsService.log()`.
7. After changing `packages/shared` or `packages/database`, **rebuild them** (`pnpm setup` or the
   package's `build` script) — the API consumes their `dist/`.

## Adding a business module (the recipe)

1. Reserve the key in `packages/shared/src/modules.ts` (it's probably already in `MODULE_CATALOG`;
   flip `available: true`).
2. Add permission keys to `packages/shared/src/permissions.ts`.
3. Add Prisma models (with `tenantId` + indexes), migrate, reseed.
4. Create `apps/api/src/modules/<key>/` with controllers gated by
   `@RequireModule(MODULE_KEYS.<KEY>)`, register in `app.module.ts`.
5. Add navigation in `apps/web/src/routes/(app)/+layout.svelte` conditioned on
   `$auth.tenant.enabledModules`.
6. Reseed or enable via `PATCH /api/v1/modules/<key>`.

## Conventions

- REST: `/api/v1/...`, plural resources, workflow actions as `POST :id/<verb>`
  (see [docs/api-conventions.md](./docs/api-conventions.md)).
- Lists return `Paginated<T>` (`items/total/page/pageSize`); use `paginationArgs`/`paginated`
  helpers from `apps/api/src/common/pagination.ts`.
- DTO validation with class-validator; update DTOs use `PartialType` from `@nestjs/swagger`.
- Web pages follow the existing pattern: `$state` + `$effect`-triggered `load()`, `api<T>()`
  client from `$lib/api/client`, errors in a local `error` string.
- Prettier is the only formatter (`pnpm format`); no ESLint configured yet.

## Hard rules (continued)

8. Document numbers (TO/SH/LD) come from `SequencesService.nextNumber()` — never generate them
   any other way.
9. Every foreign key accepted in a write payload must be checked with
   `OwnershipService.assertOwned(IfSet)` before persisting.
10. Public (`/public/**`) payloads must never expose `tenantId` or internal references — build
    explicit projections (see docs/collaboration.md). Capability tokens come from
    `randomBytes(24).toString('base64url')`.
11. Anything that changes a load's rate, route distance or shipment mix must call
    `LoadCostService.recompute()`.
12. Files go through `DocumentsService.upload/download` (FILE_STORAGE driver) — never touch the
    filesystem or S3 directly from feature code.

## Known gotchas / debt (don't "fix" silently, see TODO.md)

- Permissions are embedded in the JWT → role changes apply at next **refresh** (15 min max).
- `ModulesGuard` uses a 30 s in-memory cache (single-process; Redis when scaling out).
- Email: `EMAIL_DRIVER=log` in dev/CI (logs only); only tender links are emailed today.
- Webhooks are fire-and-forget (no outbox/retries yet).
- Auto-tender chains advance best-effort: a failure logs and leaves the load PLANNED.
- Web route building is v0: stops auto-generated from shipments (pickups then deliveries);
  manual reordering is a phase-1 leftover.
- The e2e suites (`apps/api/test/*.e2e-spec.ts`) need a running, seeded database; they create
  their own master data with unique codes so reruns are safe.
