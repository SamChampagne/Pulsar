# Pulsar API — multi-stage image.
#
# Build from the REPO ROOT (the build context must be the monorepo root so pnpm
# workspace resolution and the shared/database package builds work):
#   docker build -f apps/api/Dockerfile -t pulsar-api .
#
# Build order mirrors the root package.json `build` script: shared -> database
# (prisma generate + tsc) -> api. Migrations are NOT run at build time — see the
# CMD note below and docs/runbook.md.

FROM node:20-alpine AS base
RUN corepack enable
WORKDIR /app

# --- deps: install workspace dependencies (cached while only manifests change) ---
FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/shared/package.json packages/shared/package.json
COPY packages/database/package.json packages/database/package.json
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN pnpm install --frozen-lockfile

# --- build: shared -> database (generate+build) -> api (matches root "build" script) ---
FROM deps AS build
COPY packages/shared packages/shared
COPY packages/database packages/database
COPY apps/api apps/api
RUN pnpm --filter @pulsar/shared build \
 && pnpm --filter @pulsar/database generate \
 && pnpm --filter @pulsar/database build \
 && pnpm --filter @pulsar/api build

# --- runtime: production image ---
FROM base AS runtime
ENV NODE_ENV=production
# Only API_PORT is honored by the app (apps/api/src/main.ts reads
# config.get('API_PORT', 3000) — there is no generic PORT fallback).
ENV API_PORT=3000
COPY --from=build /app /app
EXPOSE 3000

# `prisma generate` must run again here (not just in the build stage) so the
# query engine binary matches THIS image's libc (alpine/musl) — the same
# posture as any cross-stage Prisma build. Database migrations are a deploy-time
# operation, run explicitly against the target database, NEVER baked into the
# image:
#   pnpm --filter @pulsar/database exec prisma migrate deploy
CMD ["sh", "-c", "pnpm --filter @pulsar/database exec prisma generate && node apps/api/dist/main.js"]
