# CRM Module (AI-native) — Design Spec

**Date:** 2026-06-22
**Module key:** `crm` (`MODULE_KEYS.CRM`)
**Status:** approved (brainstorm), pending plan

## Goal

Add a CRM module to Pulsar — an Attio-style relational CRM (Companies + People +
Deals + Activities) deeply integrated with Pulsar's existing entities and worked
by the always-on AI workforce. A "Commercial (SDR) IA" employee picks up CRM
exceptions (stale deals, due follow-ups) and acts on them, governed by the
existing ProposedAction queue.

## Decisions (from brainstorm)

1. **Unified Attio model**: Companies + People + Deals + Activities, relational,
   pipeline + timeline.
2. **CRM Company is a SEPARATE entity** with optional soft links to an existing
   `Customer` and/or `Carrier`. A prospect is not yet a Customer; winning a deal
   converts/links to a Customer.
3. **Big v1**: ship the full CRM AND the always-on commercial agent integration.
4. **Fixed deal stages** for v1 (configurable later via the config framework).
5. **No real outbound email** in v1: the SDR agent logs/drafts follow-ups and
   advances/flags deals; sending external email stays human (or v2).

## Hard rules this module must follow

- Tenant isolation (rule 1): every query filters `tenantId` from the JWT.
- Status changes via state machines (rule 2): deal stage via `canTransitionDeal`
  in `@pulsar/shared/crm`.
- Enums in `@pulsar/shared` mirrored in `schema.prisma` (rule 3).
- Permissions (rule 5): `crm.read` / `crm.manage`; controllers `@RequireModule(MODULE_KEYS.CRM)`.
- Audit (rule 6): deal stage changes + conversions call `AuditLogsService.log`.
- FK ownership (rule 9): `customerId`/`carrierId`/`companyId`/`contactId`/`dealId`
  checked with `OwnershipService.assertOwnedIfSet`.
- Agent tools via the registry (rule 21); MUTATING tools enqueue ProposedAction
  (rule 22); always-on wake via the existing dispatcher (rules 24/28); auto-act
  vs propose via `evaluatePolicy` (rule 29).
- Operating tasks change status only via `canTransitionOperationalTask`; policies
  are pure in `@pulsar/shared/operating` (rule 27).

## Data model (new Prisma models, all tenant-scoped + indexed)

### `CrmCompany`
- `id, tenantId, name`
- `domain String?` (web domain), `industry String?`
- `status CrmCompanyStatus @default(PROSPECT)` — enum `PROSPECT | ACTIVE | INACTIVE`
- `ownerUserId String?`
- `customerId String?` (soft link to `Customer`), `carrierId String?` (soft link to `Carrier`)
- `customData Json?` (future configurable fields; validated by CustomFieldsService when used)
- `createdAt, updatedAt`
- `@@index([tenantId])`, `@@index([tenantId, status])`
- Relations: contacts `CrmContact[]`, deals `CrmDeal[]`, activities `CrmActivity[]`

### `CrmContact`
- `id, tenantId, name`
- `companyId String?` (FK CrmCompany), `title String?`, `email String?`, `phone String?`
- `ownerUserId String?`, `createdAt, updatedAt`
- `@@index([tenantId])`, `@@index([tenantId, companyId])`

### `CrmDeal`
- `id, tenantId, title, companyId` (FK CrmCompany, required)
- `stage CrmDealStage @default(LEAD)` — enum `LEAD | QUALIFIED | PROPOSAL | WON | LOST`
- `amount Decimal?`, `currency String @default("CAD")`
- `ownerUserId String?`, `expectedCloseDate DateTime?`
- `lastActivityAt DateTime?` (maintained on activity create; drives stale detection)
- `convertedCustomerId String?` (set on WON→convert)
- `createdAt, updatedAt`
- `@@index([tenantId])`, `@@index([tenantId, stage])`, `@@index([tenantId, lastActivityAt])`

### `CrmActivity` (append-only timeline)
- `id, tenantId, type CrmActivityType` — enum `NOTE | CALL | EMAIL | MEETING | TASK`
- Polymorphic subject (soft FKs, at least one set): `companyId String?`, `contactId String?`, `dealId String?`
- `body String`
- `dueAt DateTime?`, `doneAt DateTime?` (TASK follow-ups)
- Authorship: `createdByUserId String?` XOR `agentId String?` (agent actions stamp the agent)
- `createdAt`
- `@@index([tenantId])`, `@@index([tenantId, dealId])`, `@@index([tenantId, companyId])`, `@@index([tenantId, type, doneAt])` (due-task scan)

Migration: new migration; reseed adds demo CRM data (a few companies/contacts/deals
+ one stale deal + one due TASK to exercise the agent).

## Shared (`@pulsar/shared/crm`, pure, browser-safe)

- Enums: `CrmCompanyStatus`, `CrmDealStage`, `CrmActivityType` (mirrored in schema).
- `canTransitionDeal(from, to): boolean` — state machine. Allowed: any active
  stage → any active stage forward/back among LEAD/QUALIFIED/PROPOSAL; any active
  → WON or LOST; WON/LOST are terminal (no transition out). Unit-tested.
- `isDealOpen(stage)` helper (stage not in WON/LOST).

## API (`apps/api/src/modules/crm/`)

All routes `@RequireModule(MODULE_KEYS.CRM)` + `@RequirePermissions(crm.read|manage)`,
tenant-scoped, `Paginated<T>` for lists, DTOs class-validator.

- `companies`: `GET /crm/companies` (filter by status, q), `GET /crm/companies/:id`
  (with contacts + deals + recent activities), `POST`, `PATCH :id`, soft archive.
- `contacts`: `GET /crm/contacts` (filter companyId), `GET :id`, `POST`, `PATCH :id`.
- `deals`: `GET /crm/deals` (filter stage/company), `GET :id`, `POST`, `PATCH :id`,
  `POST :id/advance` `{stage}` (via `canTransitionDeal` + claim-safe `updateMany`,
  audited), `POST :id/convert` (WON only → if `company.customerId` already set,
  link it; else create a `Customer` from the company — name from company, `code`
  from `SequencesService` (new key `customer`, prefix `CUST-`) since
  `Customer.code` is required + unique per tenant — then set `convertedCustomerId`
  + `company.customerId` in one tx, audited).
- `activities`: `GET /crm/activities` (filter dealId/companyId/contactId), `POST`
  (sets `deal.lastActivityAt` in same tx when dealId), `POST :id/complete` (TASK).
- `pipeline`: `GET /crm/pipeline` → deals grouped by stage (board payload).

`CrmModule` registered in `app.module.ts`. No static import of TransportationModule
(reuse Customer via PrismaService / a thin lookup; conversion creates a `Customer`
row directly, tenant-scoped, following the existing Customer create shape).

## Permissions & module catalog

- `packages/shared/src/permissions.ts`: `CRM.READ='crm.read'`, `CRM.MANAGE='crm.manage'`
  added to catalog (picked up by seed).
- `packages/shared/src/modules.ts`: `MODULE_KEYS.CRM='crm'` + `MODULE_CATALOG` entry
  (`available:true`, not core).

## Web (`apps/web/src/routes/(app)/crm/`)

New nav domain "CRM" (conditioned on `enabledModules`). Pages:
- `/crm` → **Pipeline** kanban: columns per `CrmDealStage`, cards (title, company,
  amount, owner), drag card between columns → `POST /deals/:id/advance` (reuse the
  native HTML5 drag pattern from YardPlan; optimistic + revert on error).
- `/crm/companies` → list + side panel (company detail: contacts, deals, **activity
  timeline**, "log activity" composer, convert button when a WON deal exists).
- `/crm/contacts` → list + side panel.
- Follows existing web patterns ($state + $effect load, `api<T>()`, Paginated, Card/Badge).

## AI workforce integration ("à notre sauce")

### Operating task categories (new)
- `CRM_STALE_DEAL` — open deal (stage in LEAD/QUALIFIED/PROPOSAL) with
  `lastActivityAt` older than N days (default 7) or null + created > N days ago.
- `CRM_FOLLOWUP_DUE` — a `TASK` activity with `dueAt <= now` and `doneAt == null`.

### Detection cron
`CrmExceptionsService` (`@Cron(EVERY_HOUR)`, best-effort, never throws) scans the
tenant's deals/tasks and emits `DomainEvent`s (`crm.deal.stale`, `crm.followup.due`)
— mirrors `delay-detection`/`tender-expiry`. Idempotent via task dedupKey.

### Policies & playbooks (`@pulsar/shared/operating`)
- Policies map `crm.deal.stale` → `CRM_STALE_DEAL` task, `crm.followup.due` →
  `CRM_FOLLOWUP_DUE` task (pure, unit-tested).
- `PLAYBOOKS` entries for both categories (checklists: review history, log a
  follow-up, advance or flag the deal, etc.). The wake prompt already consumes
  these generically.
- `moduleOfEventType`/`moduleOfSubjectType` (analytics/flow) extended for `crm.*`
  / `deal`/`company`/`contact` subjects → 'CRM'.

### Agent tools (`apps/api/src/core/agents/tools/crm.tools.ts`, in the registry)
- READ: `crm_list_deals` (filter stage/stale), `crm_get_company` (with deals +
  recent activities), `crm_list_activities` (by deal).
- MUTATING: `crm_log_activity` (NOTE/CALL/EMAIL/MEETING draft + record),
  `crm_advance_deal` (stage via canTransitionDeal), `crm_create_followup`
  (create a TASK activity with dueAt).
- All `module: MODULE_KEYS.CRM`, permission `crm.read`/`crm.manage`. MUTATING run
  through `handleMutatingTool` (queue/auto per autonomy). No SENSITIVE in v1
  (no external send). Handlers reuse the CRM services via `AGENT_TOOL_SERVICES`.

### Role preset (`@pulsar/shared/agents/role-presets.ts`)
- `id: 'crm-sdr'`, label "Agent commercial (SDR) 24/7", persona, alwaysOn:true,
  handlesCategories `['CRM_STALE_DEAL','CRM_FOLLOWUP_DUE']`, suggestedPermissions
  `['crm.read','crm.manage','core.operating.tasks.read','core.operating.tasks.manage']`,
  suggestedAutonomy AUTONOMOUS, `suggestedMaxAmountPerAction: 1000` (nominal:
  CRM actions carry no monetary amount so the cap never binds, but a positive
  value keeps the always-on preset invariant — see role-presets.spec). Emoji 🤝
  in the modal (`PRESET_EMOJI`).

## Out of scope (v1, YAGNI)

Email/calendar sync; external/web enrichment; fully custom objects & attributes
(stages stay fixed; `customData` reserved for later config); automatic outbound
email; lead scoring/forecasting analytics; bulk import.

## Testing

- Unit (`@pulsar/shared`): `canTransitionDeal` / `isDealOpen`; CRM policies
  (event→task spec); CRM playbooks presence; role-preset validity (existing
  suite already checks permissions are real keys).
- e2e (`apps/api/test/crm-module.e2e-spec.ts`, own master data, rerun-safe):
  company/contact/deal/activity CRUD; deal advance (valid + invalid transition
  rejected); convert WON→Customer; pipeline payload; activity sets lastActivityAt;
  one full agent loop — make a deal stale → run exceptions cron (or call the
  detection path) → task auto-assigned to a crm-sdr agent → run-now → agent logs
  activity / advances → task RESOLVED.
- Browser verification: pipeline drag, company timeline, log activity.

## Build order (layers; the plan will expand into tasks)

1. shared: enums + `canTransitionDeal` + module key + permissions (+ tests).
2. database: Prisma models + migration + reseed demo data.
3. api: CRM services + controllers + DTOs (CRUD, advance, convert, pipeline) + e2e.
4. api: CRM exceptions cron + policies + playbooks + flow mapping.
5. api: CRM agent tools + registry wiring + role preset.
6. web: nav + pipeline kanban + companies/contacts + timeline + log activity.
7. verify (e2e + browser + a live agent loop).
