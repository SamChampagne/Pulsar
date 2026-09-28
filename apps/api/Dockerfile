# Pulsar API — multi-stage image.
#
# Build from the REPO ROOT (the build context must be the monorepo root so pnpm
# workspace resolution and the shared/database package builds work):
#   docker build -f apps/api/Dockerfile -t pulsar-api .
#
# Build order mirrors the root package.json `build` script: shared -> database
# (prisma generate + tsc) -> api. Migrations are NOT run at build time — see the
# CMD note below and docs/runbook.md.

# Node 22 matches local dev, CI, and CLAUDE.md. pnpm is pinned to 10 to match CI
# (pnpm/action-setup version: 10) — installed directly rather than via corepack,
# whose shim otherwise resolves the LATEST pnpm (11.13.1), whose sqlite-backed
# store needs node:sqlite and both crashes the install and hard-fails on ignored
# build scripts in a clean container.
FROM node:22-alpine AS base
RUN npm install -g pnpm@10
WORKDIR /app

# --- deps: install workspace dependencies (cached while only manifests change) ---
FROM base AS deps
# tsconfig.base.json is extended by every package's tsconfig — without it the
# shared/database/api tsc builds fall back to compiler defaults (ES3 target) and
# fail with downlevel-iteration / missing-module errors.
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
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
ENV PULSAR_REPO_ROOT=/app
COPY --from=build /app /app
RUN mkdir -p /app/storage && chown node:node /app/storage
USER node
EXPOSE 3000

# No `prisma generate` at startup: the build stage already generated the client
# for this exact libc (build and runtime share the node:22-alpine base, so the
# musl query-engine binary in the copied node_modules/.prisma matches). Removing
# it shaves several seconds off every boot. Database migrations remain a
# deploy-time operation, run explicitly against the target DB, NEVER baked into
# the image:
#   pnpm --filter @pulsar/database exec prisma migrate deploy
CMD ["node", "apps/api/dist/main.js"]
