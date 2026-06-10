# Pulsar

**Pulsar** is a modular logistics platform (B2B SaaS). Its first commercial module is a
**manufacturing TMS** (Transportation Management System): transport orders, shipments, loads,
routing, carrier execution, tracking and proof of delivery.

> 📄 Product vision and scope: [PRODUCT_SPEC.md](./PRODUCT_SPEC.md) · Roadmap: [ROADMAP.md](./ROADMAP.md) · Docs: [docs/](./docs)

## Architecture at a glance

```
pulsar/
├── apps/
│   ├── api/          NestJS REST API (JWT auth, RBAC, multi-tenant, module registry)
│   └── web/          SvelteKit web app (SPA)
├── packages/
│   ├── shared/       Domain contracts: enums, state machines, permission catalog, API types
│   └── database/     Prisma schema, migrations, seed, re-exported Prisma client
├── docs/             Architecture & domain documentation
└── docker-compose.yml  PostgreSQL 16 for local development
```

- **Multi-tenant** from day one (shared schema, `tenantId` on every business table — see [docs/multi-tenancy.md](./docs/multi-tenancy.md)).
- **Modular**: business modules (transportation, then fleet, yard, WMS…) can be enabled/disabled per tenant ([docs/module-system.md](./docs/module-system.md)).
- **Stack**: SvelteKit + TypeScript / NestJS + TypeScript / PostgreSQL / Prisma / pnpm workspaces.

## Quick start

Prerequisites: Node ≥ 20, pnpm, Docker.

```bash
# 1. Configure environment
cp .env.example .env

# 2. Install dependencies, generate Prisma client, build shared packages
pnpm setup

# 3. Start PostgreSQL
pnpm db:up

# 4. Create schema and seed demo data
pnpm db:migrate     # or: pnpm db:push (no migration files)
pnpm db:seed

# 5. Run API (http://localhost:3000) and web (http://localhost:5173)
pnpm dev
```

Sign in with the seeded demo account: **admin@pulsar.dev / admin123** (tenant `acme`).
API documentation (Swagger): http://localhost:3000/api/docs

## Useful scripts

| Script            | Description                                  |
| ----------------- | -------------------------------------------- |
| `pnpm dev`        | API + web in watch mode                      |
| `pnpm build`      | Build all workspaces                         |
| `pnpm typecheck`  | Type-check all workspaces                    |
| `pnpm db:migrate` | Create/apply a Prisma migration              |
| `pnpm db:seed`    | Seed catalogs + demo tenant + sample data    |
| `pnpm db:studio`  | Open Prisma Studio                           |
| `pnpm format`     | Prettier on the whole repo                   |

## Documentation

- [docs/guide-fonctionnel.md](./docs/guide-fonctionnel.md) 🇫🇷 — guide fonctionnel (concepts
  métier, parcours utilisateur, règles de gestion)
- [docs/getting-started.md](./docs/getting-started.md) — full local setup walkthrough
- [docs/architecture.md](./docs/architecture.md) — monorepo, API layering, guards
- [docs/data-model.md](./docs/data-model.md) — domain model and TMS workflow
- [docs/multi-tenancy.md](./docs/multi-tenancy.md) — isolation strategy
- [docs/module-system.md](./docs/module-system.md) — per-tenant module activation
- [docs/api-conventions.md](./docs/api-conventions.md) — REST conventions
- [CLAUDE.md](./CLAUDE.md) — instructions for AI coding sessions
- [TODO.md](./TODO.md) — structured task list by phase
