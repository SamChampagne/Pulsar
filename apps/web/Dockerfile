# Pulsar web — static SPA build (SvelteKit + adapter-static, ssr=false) served
# by nginx. No Node runtime dependency added just to serve static files.
#
# Build from the REPO ROOT (workspace resolution needs the monorepo):
#   docker build -f apps/web/Dockerfile -t pulsar-web .

# Node 22 matches local dev, CI, and CLAUDE.md. pnpm is pinned to 10 to match CI
# (pnpm/action-setup version: 10) — installed directly rather than via corepack,
# whose shim otherwise resolves the LATEST pnpm (11.13.1), whose sqlite-backed
# store needs node:sqlite and both crashes the install and hard-fails on ignored
# build scripts in a clean container.
FROM node:22-alpine AS base
RUN npm install -g pnpm@10
WORKDIR /app

FROM base AS deps
# tsconfig.base.json is extended by the shared package's tsconfig — without it
# the shared build falls back to compiler defaults (ES3 target) and fails.
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
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
# Same-origin: the nginx entrypoint renders this template (envsubst) into
# /etc/nginx/conf.d/default.conf at startup, substituting ${PULSAR_API_UPSTREAM}
# so the SPA's relative /api/v1/... calls proxy to the API from the same origin.
COPY apps/web/nginx.conf.template /etc/nginx/templates/default.conf.template
ENV PULSAR_API_UPSTREAM=http://api:3000
EXPOSE 80
