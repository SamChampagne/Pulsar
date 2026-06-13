# CLAUDE.md — Pulsar

Guidance for AI coding sessions in this repository.

## What this is

Pulsar is a **multi-tenant modular logistics SaaS**. Platform core (auth/RBAC/audit/module
registry) + business modules activable per tenant. Three live modules: **Transportation (TMS)**,
**Customer Portal**, **Billing**. Phases 0–5 are shipped.
**Start with [docs/etat-du-projet.md](./docs/etat-du-projet.md)** (status + what to do next),
then [ROADMAP.md](./ROADMAP.md) / [TODO.md](./TODO.md); domain context in
[PRODUCT_SPEC.md](./PRODUCT_SPEC.md).

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

## Hard rules (continued, phase 4)

13. API-key requests act as the tenant's hidden service account
    (`service-account@pulsar.local`, DISABLED). Never make that account loginable, and never
    attribute key actions to a fake/non-User id.
14. Master-data create/update endpoints carry `@Audit(entityType, action)`; new ones must too.
    Workflow services keep explicit `AuditLogsService.log` calls (before/after state).
15. Public pages of a business module must re-check module activation in the service
    (`TenantModulesCacheService`) — public routes bypass ModulesGuard (see PortalService).

## Hard rules (continued, phase 7)

16. Le snapshot `Load.costDetail` est figé : jamais de recompute sur un load COMPLETED,
    et le rapprochement de factures lit `estimatedCost`/`costDetail`, jamais un recalcul.
17. Le lane matching passe par les clés normalisées (`@pulsar/shared` rating/lane-key) et
    l'ordre `compareLanes` — ne jamais réimplémenter la normalisation ou le tie-break.
18. Tout endpoint qui modifie poids/volume/palettes d'un shipment ASSIGNÉ à un load doit
    re-déclencher `checkCapacity` sur ce load (niveau warning) ; et toute écriture de
    `Shipment.loadId` doit maintenir `shipment_load_legs` dans la même transaction.

## Hard rules (continued, phase 10)

19. Tout appel OSRM/Nominatim passe par `RoutingService` (core/routing) — best-effort,
    timeout 3 s, jamais bloquant. `Route.distanceSource = MANUAL` n'est JAMAIS écrasé
    par un recalcul ; `geometry` est purement display (jamais d'usage billing).
20. Le payload public de suivi n'expose qu'UNE position (la dernière, load non livré)
    et les coordonnées origine/destination du shipment — jamais d'historique ni les
    autres stops d'une tournée. `active-map` n'embarque pas de géométrie.

## Hard rules (continued, phase 11)

21. Les outils exposés à un agent passent TOUJOURS par le registre
    (`core/agents/tool-registry.ts`) : un outil = {tier, permission, module, schéma zod,
    handler}. Jamais exposer une opération en appelant un contrôleur directement ; le
    handler réutilise les services métier existants via l'adaptateur `AGENT_TOOL_SERVICES`.
22. Un outil `MUTATING`/`SENSITIVE` ne s'exécute JAMAIS dans le handler MCP : il est mis en
    file comme `ProposedAction`. Seul `ProposedActionsService.approve` exécute le vrai appel,
    après re-vérification du statut (claim atomique `updateMany PENDING→APPROVED`) et des
    plafonds, attribué au service-user de l'agent et audité avec l'approbateur. READ/LOW
    s'exécutent en direct.
23. La portée d'un agent = ses `permissions` ∩ modules activés du tenant ∩
    `caps.toolAllowlist` (filtré dans `buildAgentMcpServer`). `caps.autoApprove` est le SEUL
    contournement de la file (exécution directe d'un outil mutating sans humain) ; l'audit
    repose alors sur les services métier sous-jacents (`@Audit`/`AuditLogsService.log`).
    Les plafonds (`evaluateAmountCap`/`evaluateRateCap`) et l'idempotence
    (`deriveIdempotencyKey`) vivent dans `@pulsar/shared` — ne pas les réimplémenter.
24. (palier 2a) Les **agents-employés** tournent sur Hermes via ACP — **un processus enfant
    par conversation** (isolation tenant : l'enregistrement MCP de Hermes est process-global) —
    et sont configurés ENTIÈREMENT dans Pulsar (l'entité `Agent` : persona/rôle/modèle/autonomie).
    Leurs appels d'outils passent TOUJOURS par la file de gouvernance palier 1 + les plafonds :
    le chemin d'auto-approbation (autonomie `ACT_LOW`/`AUTONOMOUS`) applique LUI AUSSI le plafond
    montant (`mcp-server.factory.ts`) — l'autonomie ne lève jamais les caps. Le runtime d'agent
    est best-effort et isolé : Hermes indisponible ⇒ 503, jamais de crash du cœur de Pulsar.
25. (R1 — runtime managé) Le runtime Hermes s'installe via `pnpm agents:setup` (venv Python
    provisionné par **uv**, CPython 3.12 autonome) et se configure ENTIÈREMENT dans Pulsar,
    **par tenant** (`AgentRuntimeConfig`) : soit une clé API **chiffrée via `CryptoService`**
    (jamais renvoyée en clair), soit un login OAuth dont les jetons vivent dans le `HERMES_HOME`
    par tenant — jamais dans la BD Pulsar. La liste des providers vient du catalogue
    `RUNTIME_PROVIDERS` de `@pulsar/shared` (**pure data, browser-safe, aucun import Node**).
26. (R2 — espace agents) L'UI des agents est de premier ordre : `/agents` (roster de cartes
    employés) + `/agents/[id]` (profil & config guidée, activité, chat). `GET /agents/:id` et
    `GET /agents/:id/activity` n'exposent JAMAIS `secretHash`/`serviceUserId` (projection via le
    `agentSelect` partagé) ; les presets de rôle vivent dans `AGENT_ROLE_PRESETS` de
    `@pulsar/shared` (pure data).

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
- Email: `EMAIL_DRIVER=log` in dev/CI (logs only). Senders: tender links, invitations/resets,
  delivered notices.
- Webhooks go through a durable outbox (`webhook_deliveries`, 5 retries with backoff).
- Auto-tender chains advance best-effort: a failure logs and leaves the load PLANNED.
- Web route building is v0: stops auto-generated from shipments (pickups then deliveries);
  manual reordering is a phase-1 leftover.
- The e2e suites (`apps/api/test/*.e2e-spec.ts`) need a running, seeded database; they create
  their own master data with unique codes so reruns are safe.
