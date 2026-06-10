# Getting started

## Prerequisites

- Node.js ≥ 20
- pnpm ≥ 9 (`corepack enable` or `npm i -g pnpm`)
- Docker (for PostgreSQL)

## Setup

```bash
git clone <repo> pulsar && cd pulsar

# 1. Environment — one .env at the repo root, read by every workspace
cp .env.example .env

# 2. Install deps, generate the Prisma client, build shared packages
pnpm setup

# 3. Database
pnpm db:up        # docker compose up -d db (postgres 16 on :5432)
pnpm db:migrate   # creates the schema (prompts for a migration name)
pnpm db:seed      # permission/module catalogs + demo tenant + sample TMS data

# 4. Run
pnpm dev          # api → http://localhost:3000, web → http://localhost:5173
```

## Demo credentials

| Field    | Value             |
| -------- | ----------------- |
| Email    | `admin@pulsar.dev`|
| Password | `admin123`        |
| Tenant   | `acme` (optional unless the email exists in several tenants) |

## Verifying the install

1. http://localhost:3000/api/docs shows the Swagger UI.
2. Sign in on http://localhost:5173 — the dashboard shows seeded counts.
3. Walk the workflow: *Transport Orders* → confirm the seeded `TO-000001` → *Plan* (creates a
   shipment). Then via Swagger: create a load (`POST /transportation/loads`), assign the shipment
   (`POST /transportation/shipments/:id/assign-load`), assign the seeded carrier
   (`POST /transportation/loads/:id/assign`), then `dispatch` → `start-transit` → `complete`.

## Troubleshooting

- **`@pulsar/shared` not found at runtime** — run `pnpm --filter @pulsar/shared build`
  (the API consumes its `dist/`). `pnpm setup` does this for you.
- **Prisma client out of date** — `pnpm db:generate` after any schema change.
- **Port conflicts** — change `API_PORT` in `.env` (web proxy target is set in
  `apps/web/vite.config.ts`).
- **DB connection refused** — `docker compose ps`; the healthcheck must be green before migrating.
