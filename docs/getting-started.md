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

## OSRM routing engine (optional, phase 10)

Without OSRM (`ROUTING_DRIVER=none`, the default), everything works: distances are entered
manually or estimated as the crow flies (shown with an "estimate" badge). For real road
distances locally:

````bash
# 1. Download an OSM extract (Québec ≈ 350 MB) into ./osrm-data
mkdir -p osrm-data
curl -L -o osrm-data/region.osm.pbf \
  https://download.geofabrik.de/north-america/canada/quebec-latest.osm.pbf

# 2. Prepare the extract (one-time, ~10 min; disposable containers)
docker run --rm -t -v ./osrm-data:/data ghcr.io/project-osrm/osrm-backend:v6.0.0 \
  osrm-extract -p /opt/car.lua /data/region.osm.pbf
docker run --rm -t -v ./osrm-data:/data ghcr.io/project-osrm/osrm-backend:v6.0.0 \
  osrm-partition /data/region.osrm
docker run --rm -t -v ./osrm-data:/data ghcr.io/project-osrm/osrm-backend:v6.0.0 \
  osrm-customize /data/region.osrm

# 3. Start the server (opt-in profile — not started by pnpm db:up)
docker compose --profile osrm up -d osrm
curl "http://localhost:5000/route/v1/driving/-73.5674,45.5019;-71.2075,46.8131?overview=false"
````

Then in `.env`: `ROUTING_DRIVER=osrm` and `OSRM_HOST=http://localhost:5000`.
Geocoding: `GEOCODING_DRIVER=nominatim` uses the public Nominatim service (1 req/s,
persistent cache in DB) — suitable for development and low-volume use; self-host
Nominatim before any intensive use.

## Troubleshooting

- **`@pulsar/shared` not found at runtime** — run `pnpm --filter @pulsar/shared build`
  (the API consumes its `dist/`). `pnpm setup` does this for you.
- **Prisma client out of date** — `pnpm db:generate` after any schema change.
- **Port conflicts** — change `API_PORT` in `.env` (web proxy target is set in
  `apps/web/vite.config.ts`).
- **DB connection refused** — `docker compose ps`; the healthcheck must be green before migrating.
