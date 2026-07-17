# Deployment / ops runbook

Concise reference for running Pulsar outside of local dev: required config,
container build/run, health checks, graceful shutdown, the current
single-instance ceiling, and basic backup/restore. Read [CLAUDE.md](../CLAUDE.md)
and [docs/getting-started.md](./getting-started.md) for the dev workflow this
builds on.

## 1. Required environment

All variables are listed with placeholders in [`.env.example`](../.env.example)
at the repo root. Copy it and fill in real values — never commit real secrets.

| Variable | Required | Notes |
| --- | --- | --- |
| `DATABASE_URL` | yes | Postgres connection string. |
| `JWT_SECRET` | yes | Session signing. Boot refuses the published example in production (`assertProductionSecrets`, `apps/api/src/common/boot-checks.ts`). |
| `JWT_EXPIRES_IN`, `REFRESH_EXPIRES_DAYS` | no | Defaults are fine for most deployments. |
| `PLATFORM_ADMIN_EMAIL`, `PLATFORM_ADMIN_PASSWORD` | yes | Cross-tenant platform admin. Boot refuses the default password in production. |
| `ENCRYPTION_KEY` | yes | 32 bytes, base64 — encrypts secrets at rest (agent runtime API keys, IMAP password). `CryptoService` refuses to start without it. |
| `CORS_ORIGINS` | recommended in prod | Comma-separated allowlist of exact origins, e.g. `https://app.example.com`. `*` allows all. Unset falls back to the single-origin dev default `API_CORS_ORIGIN` — see §2. |
| `API_PORT` | no | Default `3000`. This is the **only** port variable the app reads (no generic `PORT` fallback) — `apps/api/src/main.ts`. |
| `API_URL`, `WEB_URL` | yes in prod | Public base URLs used to build links (OIDC redirects, tender/tracking/driver links, email links). |
| `EMAIL_DRIVER` (+`SMTP_*`) | yes | `log` (dev/CI, logs only) or `smtp` for real delivery. |
| `STORAGE_DRIVER` (+`S3_*` / `STORAGE_LOCAL_DIR`) | yes | `local` (filesystem, dev only — not durable across container restarts/redeploys) or `s3` (any S3-compatible bucket). **Use `s3` in production**; `local` storage is lost when the container is replaced. |
| Agent runtime (`AGENT_SESSION_SECRET`, `HERMES_ACP_CMD/ARGS/CWD`, `PULSAR_MCP_URL`, `HERMES_HOME_ROOT`) | only if using AI employee-agents | Best-effort subsystem — see §7. Requires the vendored `hermes-agent/` Python venv (`pnpm agents:setup`), which is **not** part of the API container image (see §3). |
| APS (`APS_PORT`, `APS_API_KEY`, `APS_DATABASE_URL`, `APS_AUTOSTART`) | only if using manufacturing/APS planning | Same posture as the agent runtime: vendored Python sidecar (`services/aps`, `pnpm aps:setup`), not part of the API image. Set `APS_AUTOSTART=false` if you run it as its own container/process instead. |

## 2. CORS

`apps/api/src/main.ts` resolves the CORS origin option like this:

- If `CORS_ORIGINS` is set: split on commas, trim, and use that as the
  allowlist. A literal `*` anywhere in the list allows all origins. **Only**
  these origins are allowed — this is the production knob.
- If `CORS_ORIGINS` is unset: fall back to the pre-existing single-origin
  `API_CORS_ORIGIN` (default `http://localhost:5173`) — unchanged dev behavior.

Set `CORS_ORIGINS` explicitly in every non-dev environment.

Note the web SPA calls the API via relative paths (`/api/v1/...`,
`apps/web/src/lib/api/client.ts`), i.e. it expects to be served from the same
origin as the API (typically via a reverse proxy routing `/api/**` to the API
and everything else to the static web build) or via an explicit CORS-enabled
cross-origin setup if the API and reverse proxy are on different exposed
domains. Configure whichever your ingress/reverse proxy does, and set
`CORS_ORIGINS` to match.

## 3. Containers

Two images, built from the **repo root** as build context (pnpm workspace
resolution needs the whole monorepo):

```bash
docker build -f apps/api/Dockerfile -t pulsar-api .
docker build -f apps/web/Dockerfile -t pulsar-web .
```

- **`apps/api/Dockerfile`**: `node:20-alpine`, multi-stage. Installs with pnpm,
  builds in the same order as the root `build` script (`shared` → `database`
  [`prisma generate` + `tsc`] → `api`). The runtime stage re-runs
  `prisma generate` (so the query engine binary matches the alpine/musl image)
  and then starts `node apps/api/dist/main.js`. Exposes `3000` (`API_PORT`).
- **`apps/web/Dockerfile`**: builds the static SPA (`pnpm --filter @pulsar/web
  build`, output `apps/web/build/` per `adapter-static`'s default), then serves
  it from an `nginx:alpine` stage. The nginx config is rendered at container
  start by the official image's `envsubst` step from
  `apps/web/nginx.conf.template` → `/etc/nginx/conf.d/default.conf`:
  - `try_files $uri $uri/ /index.html` — SvelteKit deep-link fallback.
  - **`location /api/ { proxy_pass ${PULSAR_API_UPSTREAM}; }`** — the SPA calls
    the API via relative `/api/v1/...` paths, so nginx reverse-proxies them to
    the API **from the same origin** (no CORS needed). `PULSAR_API_UPSTREAM`
    defaults to `http://api:3000` (the compose service name) and is overridable
    per environment. SSE endpoints (agent chat, OAuth device-code) are proxied
    unbuffered. This is the tested same-origin path — see the smoke compose below.
- **Base image & pnpm**: both Dockerfiles use `node:22-alpine` (matches local
  dev and CI) and install `pnpm@10` directly (matching CI's
  `pnpm/action-setup version: 10`) rather than via corepack — corepack's shim
  resolves the LATEST pnpm, whose sqlite-backed store requires `node:sqlite` and
  fails the container install. The root `tsconfig.base.json` (extended by every
  package tsconfig) is copied into the build stage.
- **Migrations are never run inside the image build.** Apply them explicitly
  at deploy time, against the target database:
  ```bash
  pnpm --filter @pulsar/database exec prisma migrate deploy
  ```
  (or run the equivalent inside a one-off container using the API image, with
  `DATABASE_URL` pointed at the target Postgres.)
- The Hermes agent runtime and APS engine are optional Python sidecars
  (`hermes-agent/`, `services/aps/`) provisioned via `pnpm agents:setup` /
  `pnpm aps:setup`. They are **not** included in the `apps/api` image in this
  first pass — if you need them in production, provision them as separate
  sidecar containers/processes reachable per the env vars in §1; absent them,
  the API degrades gracefully (agent runtime → 503 on agent endpoints, APS →
  503 via `ApsClient`, per CLAUDE.md rule 24/32).
- `.dockerignore` (repo root) excludes `node_modules`, build outputs, `.git`,
  the Python venvs, vendored sub-projects (`PlaniAdvanceV2`, `fleetbase`), and
  `.env*` (except `.env.example`).

### Reproducible same-origin smoke (`docker-compose.smoke.yml`)

A self-contained compose file at the repo root proves the containerized
same-origin deployment end to end: `postgres` → a one-shot `migrate` service
(`prisma migrate deploy` + seed) → `api` (internal only, **never published**) →
`web`/nginx (the **only** published port, reverse-proxying `/api` to the API).
It uses throwaway secrets (deliberately not the published examples, so the
production boot checks pass) and `NODE_ENV=production`, so it also exercises the
production boot path.

```bash
docker build -f apps/api/Dockerfile -t pulsar-api:rc .
docker build -f apps/web/Dockerfile -t pulsar-web:rc .
docker compose -f docker-compose.smoke.yml up -d            # db → migrate → api → web
curl -fsS http://localhost:8080/api/v1/health/ready         # via the web origin (nginx → api)
curl -fsS http://localhost:8080/loads                       # SPA deep link → index.html
docker compose -f docker-compose.smoke.yml down -v          # teardown + drop the volume
```

S3 and SMTP are not required for the smoke (local storage + `log` email driver).
The agent runtime (Hermes) and APS engine stay optional/best-effort
(`APS_AUTOSTART=false`); the API degrades to 503 on those subsystems and never
crashes (rule 24).

## 4. Health checks

- `GET /api/v1/health/live` — liveness (`apps/api/src/core/health`). Always
  200 while the process is up; use for container liveness probes.
- `GET /api/v1/health/ready` — readiness. Checks Postgres (`SELECT 1`) —
  **this is the only check that can flip readiness to `error`**. The agent
  runtime and APS engine checks are informative only (`installed: boolean`)
  and never fail readiness — they're optional/best-effort subsystems. Returns
  503 when not ready. Use for container readiness/startup probes and load
  balancer health checks.

## 5. Graceful shutdown

- `main.ts` calls `app.enableShutdownHooks()`, so Nest's `OnModuleDestroy` /
  `OnApplicationShutdown` lifecycle runs on `SIGTERM`/`SIGINT` (what
  orchestrators send on scale-down, redeploy, or `docker stop`).
- `AgentRuntimeService.onModuleDestroy` kills every still-live Hermes child
  process (one process per open agent conversation) so none survive as
  orphans. Best-effort — a failed `kill()` is logged, never thrown.
- `ApsRuntimeService.onModuleDestroy` (pre-existing) stops the managed APS
  engine child process the same way.
- Both are non-blocking and non-throwing by construction (CLAUDE.md rule 24):
  shutdown always proceeds even if a child was already dead or unkillable.
- Give the container a shutdown grace period (e.g. Kubernetes
  `terminationGracePeriodSeconds`) long enough for in-flight HTTP requests and
  child-process teardown — a few seconds is generally enough given the above
  is synchronous best-effort cleanup, not a drain loop.

## 6. Scaling: what's in-memory today, and the path to Redis

Pulsar currently assumes **a single API process**. Several components hold
state in the process's memory that would silently desync across replicas:

| Component | Where | Why it blocks horizontal scaling |
| --- | --- | --- |
| Module-activation cache | `TenantModulesCacheService` (30 s in-memory cache, `ModulesGuard`) | A module toggled on tenant A's request might not be visible to instance B for up to 30 s — usually harmless, but a real inconsistency window. |
| Agent worker dispatcher | `AgentWorkerService` (in-memory queue + concurrency caps, phase 13) | Global/tenant/agent concurrency caps are per-process; two replicas would each think they have the full budget, over-running the intended caps. Enqueued wakeups aren't shared — a task enqueued against instance A won't be picked up by instance B. |
| Live Hermes sessions | `AgentRuntimeService` (`Map<sessionId, LiveSession>`, one child process per conversation) | A conversation's live session is pinned to the process that opened it. A request routed to a different replica would find the session not "live" and have to resume it (extra latency, and only works because Hermes sessions are resumable — see `resumeSession`). |
| Nominatim geocoding throttle | `core/routing` (1 req/s best-effort throttle) | Per-process rate limiting; N replicas could collectively exceed the intended shared rate against the public Nominatim endpoint. |

**Migration path**: introduce Redis (or an equivalent shared store) for (a) the
module-activation cache (swap the in-memory TTL map for a `SETEX`-backed one),
(b) a durable/shared job queue for the agent dispatcher (e.g. BullMQ on Redis)
so concurrency caps and wakeups are enforced cluster-wide, and (c) either
sticky-session routing for live Hermes conversations (route by
`sessionId`/`agentId` at the load balancer) or a shared session registry so any
replica can resume the right child — the ACP resume path already exists and
would carry this. The Nominatim throttle would move to a Redis token bucket
shared by all replicas. None of this is implemented yet; today, run exactly
one API instance (vertical scaling only) or accept the inconsistency windows
above.

## 7. Best-effort subsystems (recap)

Both the agent runtime and the APS engine are designed to degrade gracefully:
a missing install, a crashed child, or a down dependency never crashes the
core API — callers get a `503` and (for agents) the governance layer routes
mutating tool calls through `ProposedAction` regardless (CLAUDE.md rules
22–24, 32). Nothing here changes that behavior; this runbook only adds
container packaging, configurable CORS, and shutdown hooks around it.

## 8. Backup / restore

- **PostgreSQL**: back up with `pg_dump` (logical) on a schedule matching your
  RPO, or use your managed Postgres provider's point-in-time-recovery /
  snapshot feature if available. Restore with `pg_restore` (or provider
  restore) into a fresh instance, then point `DATABASE_URL` at it — do **not**
  run `prisma migrate deploy` against a restored dump without first checking
  `_prisma_migrations` matches the schema in `packages/database/prisma/migrations`
  for the code version you're restoring alongside.
- **File storage** (`STORAGE_DRIVER=s3`): rely on your bucket provider's
  versioning/replication (e.g. S3 versioning + cross-region replication, or
  the MinIO/R2 equivalent). There is no separate Pulsar-level backup of
  uploaded documents — `DocumentsService` only proxies to whatever the driver
  points at. If you must use `STORAGE_DRIVER=local` (dev/single-node only),
  back up `STORAGE_LOCAL_DIR` (default `apps/api/storage`) alongside the
  database — it is **not** durable across container replacement and is not
  recommended for production.
- Test restores periodically; a backup that was never restored is unverified.
