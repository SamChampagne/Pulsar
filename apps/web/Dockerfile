# Pulsar web — static SPA build (SvelteKit + adapter-static, ssr=false) served
# by nginx. No Node runtime dependency added just to serve static files.
#
# Build from the REPO ROOT (workspace resolution needs the monorepo):
#   docker build -f apps/web/Dockerfile -t pulsar-web .

FROM node:20-alpine AS base
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/shared/package.json packages/shared/package.json
COPY packages/database/package.json packages/database/package.json
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY packages/shared packages/shared
COPY apps/web apps/web
# @pulsar/web only depends on @pulsar/shared (consumed as TS source directly via
# the vite alias in apps/web/vite.config.ts) — no @pulsar/database build needed.
RUN pnpm --filter @pulsar/shared build \
 && pnpm --filter @pulsar/web build

# adapter-static (fallback: 'index.html', apps/web/svelte.config.js) writes the
# SPA to apps/web/build/ — matches the `vite build` output for this adapter.
FROM nginx:alpine AS runtime
COPY --from=build /app/apps/web/build /usr/share/nginx/html
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
