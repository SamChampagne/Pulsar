# CRM Module (AI-native) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an Attio-style CRM module (Companies/People/Deals/Activities) with a deal pipeline, activity timeline, and an always-on commercial (SDR) AI employee that works CRM exceptions — fully integrated into Pulsar.

**Architecture:** New business module `crm` following the CLAUDE.md module recipe. New Prisma models (CrmCompany/CrmContact/CrmDeal/CrmActivity), pure enums + deal state machine in `@pulsar/shared/crm`, NestJS services/controllers under `apps/api/src/modules/crm/`, SvelteKit pages under `apps/web/src/routes/(app)/crm/`. AI integration reuses the existing operating/agent infra: new task categories + policies + a detection cron + CRM agent tools + a role preset.

**Tech Stack:** NestJS, Prisma, SvelteKit (Svelte 5 runes), `@pulsar/shared`, class-validator, zod (agent tools), jest (api unit + e2e), vitest (shared/web).

## Global Constraints

- Tenant isolation: every query filters `tenantId` from `@CurrentUser()`; never trust a body tenantId. (rule 1)
- Deal stage changes go through `canTransitionDeal` in `@pulsar/shared/crm`; never `update({ stage })` without the check. (rule 2)
- Enums live in `@pulsar/shared` and are mirrored in `schema.prisma` with identical value names; rebuild shared + database after changes. (rules 3, 7)
- Apps import Prisma via `@pulsar/database`, never `@prisma/client` directly. (rule 4)
- Every endpoint: `@RequirePermissions(...)`; CRM controllers also `@RequireModule(MODULE_KEYS.CRM)` at class level. New permission keys go in `packages/shared/src/permissions.ts`. (rule 5)
- Deal stage changes + conversions call `AuditLogsService.log()`. (rule 6)
- Every FK in a write payload checked with `OwnershipService.assertOwnedIfSet`. (rule 9)
- Agent tools go through the registry (`core/agents/tools/crm.tools.ts`); MUTATING tools enqueue a ProposedAction via `handleMutatingTool`; READ run live. (rules 21, 22)
- OperationalTask status only via `canTransitionOperationalTask`; policies pure in `@pulsar/shared/operating`; tasks idempotent on `(tenantId, dedupKey)`. (rule 27)
- Lists return `Paginated<T>` via `paginationArgs`/`paginated` from `apps/api/src/common/pagination.ts`. Document numbers via `SequencesService.nextNumber()`. (rule 8)
- Prettier only; FR UI labels; web pattern `$state` + `$effect`-load + `api<T>()`.

---

### Task 1: Shared — module key, permissions, CRM enums + deal state machine

**Files:**
- Modify: `packages/shared/src/modules.ts` (add `CRM: 'crm'` to `MODULE_KEYS`; add `MODULE_CATALOG` entry)
- Modify: `packages/shared/src/permissions.ts` (add `CRM` permission group + catalog rows)
- Create: `packages/shared/src/crm/crm.workflow.ts`
- Create: `packages/shared/src/crm/crm.workflow.spec.ts`
- Modify: `packages/shared/src/index.ts` (export `./crm/crm.workflow`)

**Interfaces:**
- Produces: enums `CrmCompanyStatus` (`PROSPECT|ACTIVE|INACTIVE`), `CrmDealStage` (`LEAD|QUALIFIED|PROPOSAL|WON|LOST`), `CrmActivityType` (`NOTE|CALL|EMAIL|MEETING|TASK`); `canTransitionDeal(from: CrmDealStage, to: CrmDealStage): boolean`; `isDealOpen(stage: CrmDealStage): boolean`; `MODULE_KEYS.CRM`; `PERMISSIONS.CRM.READ='crm.read'`, `PERMISSIONS.CRM.MANAGE='crm.manage'`.

- [ ] **Step 1: Write the failing test** — `packages/shared/src/crm/crm.workflow.spec.ts`

```ts
import { describe, it, expect } from 'vitest';
import { CrmDealStage, canTransitionDeal, isDealOpen } from './crm.workflow';

describe('canTransitionDeal', () => {
  it('moves freely among active stages', () => {
    expect(canTransitionDeal(CrmDealStage.LEAD, CrmDealStage.QUALIFIED)).toBe(true);
    expect(canTransitionDeal(CrmDealStage.PROPOSAL, CrmDealStage.QUALIFIED)).toBe(true); // back ok
  });
  it('active stages can close to WON or LOST', () => {
    expect(canTransitionDeal(CrmDealStage.PROPOSAL, CrmDealStage.WON)).toBe(true);
    expect(canTransitionDeal(CrmDealStage.LEAD, CrmDealStage.LOST)).toBe(true);
  });
  it('WON and LOST are terminal', () => {
    expect(canTransitionDeal(CrmDealStage.WON, CrmDealStage.PROPOSAL)).toBe(false);
    expect(canTransitionDeal(CrmDealStage.LOST, CrmDealStage.LEAD)).toBe(false);
    expect(canTransitionDeal(CrmDealStage.WON, CrmDealStage.LOST)).toBe(false);
  });
  it('no-op transition is false', () => {
    expect(canTransitionDeal(CrmDealStage.LEAD, CrmDealStage.LEAD)).toBe(false);
  });
});

describe('isDealOpen', () => {
  it('open for active stages, closed for terminal', () => {
    expect(isDealOpen(CrmDealStage.LEAD)).toBe(true);
    expect(isDealOpen(CrmDealStage.WON)).toBe(false);
    expect(isDealOpen(CrmDealStage.LOST)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — `cd packages/shared && npx vitest run src/crm/crm.workflow.spec.ts` → FAIL (module not found).

- [ ] **Step 3: Implement** — `packages/shared/src/crm/crm.workflow.ts`

```ts
// Pure, browser-safe. No Node imports.
export enum CrmCompanyStatus { PROSPECT = 'PROSPECT', ACTIVE = 'ACTIVE', INACTIVE = 'INACTIVE' }
export enum CrmDealStage { LEAD = 'LEAD', QUALIFIED = 'QUALIFIED', PROPOSAL = 'PROPOSAL', WON = 'WON', LOST = 'LOST' }
export enum CrmActivityType { NOTE = 'NOTE', CALL = 'CALL', EMAIL = 'EMAIL', MEETING = 'MEETING', TASK = 'TASK' }

const ACTIVE_STAGES: CrmDealStage[] = [CrmDealStage.LEAD, CrmDealStage.QUALIFIED, CrmDealStage.PROPOSAL];

export function isDealOpen(stage: CrmDealStage): boolean {
  return ACTIVE_STAGES.includes(stage);
}

/** Active stages move freely among themselves and can close to WON/LOST. Terminal stages never transition. */
export function canTransitionDeal(from: CrmDealStage, to: CrmDealStage): boolean {
  if (from === to) return false;
  if (!isDealOpen(from)) return false; // WON/LOST terminal
  if (isDealOpen(to)) return true; // any active -> any other active
  return to === CrmDealStage.WON || to === CrmDealStage.LOST;
}
```

- [ ] **Step 4: Add module key + permissions.** In `packages/shared/src/modules.ts`, add to `MODULE_KEYS` (after `CARRIER_PORTAL`): `CRM: 'crm',`. Add a `MODULE_CATALOG` entry mirroring the FLEET entry:

```ts
  {
    key: MODULE_KEYS.CRM,
    name: 'CRM',
    description: 'Commercial relationships: companies, contacts, deals pipeline and activity timeline, worked by an AI commercial agent.',
    isCore: false,
    available: true,
  },
```

In `packages/shared/src/permissions.ts`, add a `CRM` group next to the others:

```ts
  CRM: {
    READ: 'crm.read',
    MANAGE: 'crm.manage',
  },
```

and add catalog rows (mirror the existing `core(...)`/module helper used in the file — match the FLEET rows' style):

```ts
  // CRM
  <moduleHelper>(PERMISSIONS.CRM.READ, 'View CRM companies, contacts, deals and activities'),
  <moduleHelper>(PERMISSIONS.CRM.MANAGE, 'Create and manage CRM records, advance and convert deals'),
```
(Read `permissions.ts` first to use the exact helper name + array the FLEET rows live in.)

- [ ] **Step 5: Export** — in `packages/shared/src/index.ts` add `export * from './crm/crm.workflow';`.

- [ ] **Step 6: Run shared suite** — `cd packages/shared && npx vitest run` → all pass (new spec green; existing role-presets spec still green — permission keys valid). Then `pnpm build` (shared).

- [ ] **Step 7: Commit** — `git add packages/shared && git commit -m "feat(crm): shared enums, deal state machine, module key + permissions"`

---

### Task 2: Database — Prisma models + migration + demo seed

**Files:**
- Modify: `packages/database/prisma/schema.prisma` (4 models + 3 enums + relations on Tenant/Customer/Carrier as needed)
- Modify: `packages/database/prisma/seed.ts` (demo CRM data for the acme tenant)

**Interfaces:**
- Produces: Prisma models `CrmCompany`, `CrmContact`, `CrmDeal`, `CrmActivity` with the fields from the spec; enums `CrmCompanyStatus`, `CrmDealStage`, `CrmActivityType` (identical values to shared).

- [ ] **Step 1: Add enums + models** to `schema.prisma` (place enums near other enums; models near other tenant models). Use exactly:

```prisma
enum CrmCompanyStatus { PROSPECT ACTIVE INACTIVE }
enum CrmDealStage { LEAD QUALIFIED PROPOSAL WON LOST }
enum CrmActivityType { NOTE CALL EMAIL MEETING TASK }

model CrmCompany {
  id         String           @id @default(cuid())
  tenantId   String
  name       String
  domain     String?
  industry   String?
  status     CrmCompanyStatus @default(PROSPECT)
  ownerUserId String?
  customerId String?
  carrierId  String?
  customData Json?
  createdAt  DateTime         @default(now())
  updatedAt  DateTime         @updatedAt
  tenant     Tenant           @relation(fields: [tenantId], references: [id])
  contacts   CrmContact[]
  deals      CrmDeal[]
  activities CrmActivity[]
  @@index([tenantId])
  @@index([tenantId, status])
}

model CrmContact {
  id          String      @id @default(cuid())
  tenantId    String
  name        String
  companyId   String?
  title       String?
  email       String?
  phone       String?
  ownerUserId String?
  createdAt   DateTime    @default(now())
  updatedAt   DateTime    @updatedAt
  tenant      Tenant      @relation(fields: [tenantId], references: [id])
  company     CrmCompany? @relation(fields: [companyId], references: [id])
  @@index([tenantId])
  @@index([tenantId, companyId])
}

model CrmDeal {
  id                  String       @id @default(cuid())
  tenantId            String
  title               String
  companyId           String
  stage               CrmDealStage @default(LEAD)
  amount              Decimal?
  currency            String       @default("CAD")
  ownerUserId         String?
  expectedCloseDate   DateTime?
  lastActivityAt      DateTime?
  convertedCustomerId String?
  createdAt           DateTime     @default(now())
  updatedAt           DateTime     @updatedAt
  tenant              Tenant       @relation(fields: [tenantId], references: [id])
  company             CrmCompany   @relation(fields: [companyId], references: [id])
  @@index([tenantId])
  @@index([tenantId, stage])
  @@index([tenantId, lastActivityAt])
}

model CrmActivity {
  id              String          @id @default(cuid())
  tenantId        String
  type            CrmActivityType
  companyId       String?
  contactId       String?
  dealId          String?
  body            String
  dueAt           DateTime?
  doneAt          DateTime?
  createdByUserId String?
  agentId         String?
  createdAt       DateTime        @default(now())
  tenant          Tenant          @relation(fields: [tenantId], references: [id])
  company         CrmCompany?     @relation(fields: [companyId], references: [id])
  @@index([tenantId])
  @@index([tenantId, dealId])
  @@index([tenantId, companyId])
  @@index([tenantId, type, doneAt])
}
```
Add the back-relations on `Tenant` (`crmCompanies CrmCompany[]`, `crmContacts CrmContact[]`, `crmDeals CrmDeal[]`, `crmActivities CrmActivity[]`). Do NOT add relations on Customer/Carrier (links are soft FKs `customerId`/`carrierId`, validated in service).

- [ ] **Step 2: Migrate + generate** — from repo root: `pnpm db:migrate` (name it `crm_module`), then `pnpm db:generate`. Then rebuild database package: `pnpm --filter @pulsar/database build`.
  - Expected: migration applies; `@prisma/client` exposes the new models. (If the API dev server is running, stop it first to avoid the EPERM/no-engine gotcha, then regenerate.)

- [ ] **Step 3: Seed demo data** — append to `seed.ts` (acme tenant), creating: 2 `CrmCompany` (one ACTIVE linked to an existing acme Customer, one PROSPECT), 2 `CrmContact`, 3 `CrmDeal` (one PROPOSAL **stale** — `lastActivityAt` 10 days ago, one QUALIFIED recent, one WON), and one `CrmActivity` TASK with `dueAt` in the past + `doneAt` null. Use upserts keyed on a stable name so reseeds are idempotent. Mirror the existing seed style in `seed.ts`.

- [ ] **Step 4: Run seed** — `pnpm db:seed` → no error; query confirms rows exist.

- [ ] **Step 5: Commit** — `git add packages/database && git commit -m "feat(crm): prisma models, migration, demo seed"`

---

### Task 3: API — CrmModule + companies & contacts (CRUD)

**Files:**
- Create: `apps/api/src/modules/crm/crm.module.ts`
- Create: `apps/api/src/modules/crm/companies.service.ts`, `companies.controller.ts`, `dto/company.dto.ts`
- Create: `apps/api/src/modules/crm/contacts.service.ts`, `contacts.controller.ts`, `dto/contact.dto.ts`
- Modify: `apps/api/src/app.module.ts` (register `CrmModule`)
- Create: `apps/api/test/crm-module.e2e-spec.ts` (companies + contacts portion)

**Interfaces:**
- Produces: `CompaniesService.{list,get,create,update}`, `ContactsService.{list,get,create,update}` (all `(tenantId, ...)`), used by deals/activities/agent-tools later.

- [ ] **Step 1: Scaffold the module mirroring an existing simple module.** Read `apps/api/src/modules/fleet/` (module + a service + controller + dto) as the reference for structure, gating, pagination, ownership, audit. Create `CrmModule` importing `PrismaModule` and whatever shared core modules fleet imports (OwnershipService, AuditLogsService, SequencesService). Controllers class-level: `@RequireModule(MODULE_KEYS.CRM)`.

- [ ] **Step 2: CompaniesService** — `list(tenantId, q)` returns `Paginated<CrmCompany>` (filter `status?`, `q?` name contains), `get(tenantId, id)` includes contacts + deals + latest 20 activities (ordered desc), `create(tenantId, dto)` validates `customerId`/`carrierId` via `OwnershipService.assertOwnedIfSet`, `update(tenantId, id, dto)` tenant-scoped. All tenant-scoped.

- [ ] **Step 3: company DTOs** — `CreateCompanyDto` (name required; domain/industry/status/ownerUserId/customerId/carrierId optional, class-validator), `UpdateCompanyDto extends PartialType(CreateCompanyDto)`. `status` validated `@IsEnum(CrmCompanyStatus)`.

- [ ] **Step 4: CompaniesController** — `GET /crm/companies`, `GET /crm/companies/:id`, `POST /crm/companies`, `PATCH /crm/companies/:id`. `read` perm on GET, `manage` on writes.

- [ ] **Step 5: Contacts** — same shape: `ContactsService` (`list` filter `companyId?`), DTOs (`companyId` validated via OwnershipService against CrmCompany), `ContactsController` `/crm/contacts`.

- [ ] **Step 6: Register + e2e (CRUD).** Register `CrmModule` in `app.module.ts`. Write `crm-module.e2e-spec.ts` creating its own master data with unique codes (mirror `yard-module.e2e-spec.ts` setup): login admin, enable `crm` module on acme (`PATCH /api/v1/modules/crm`), create a company, a contact, list them, get the company (assert contacts present), patch the company. Run: `pnpm --filter @pulsar/api test:e2e -- crm-module` (needs seeded DB up).

- [ ] **Step 7: Commit** — `git add apps/api && git commit -m "feat(crm): companies + contacts API (CRUD) + e2e"`

---

### Task 4: API — deals (CRUD + advance + convert) + activities + pipeline

**Files:**
- Create: `apps/api/src/modules/crm/deals.service.ts`, `deals.controller.ts`, `dto/deal.dto.ts`
- Create: `apps/api/src/modules/crm/activities.service.ts`, `activities.controller.ts`, `dto/activity.dto.ts`
- Modify: `apps/api/src/modules/crm/crm.module.ts` (register new providers/controllers)
- Modify: `apps/api/test/crm-module.e2e-spec.ts` (deals/activities/pipeline/convert)
- Modify: `apps/api/src/common/sequences*.ts` only if a new `customer` sequence key must be registered (check first; reuse existing if present)

**Interfaces:**
- Consumes: `CompaniesService`; `canTransitionDeal`/`isDealOpen`/`CrmDealStage` from `@pulsar/shared`; `SequencesService.nextNumber`, `AuditLogsService.log`, `OwnershipService`.
- Produces: `DealsService.{list,get,create,update,advance,convert}`, `ActivitiesService.{list,create,complete}`, `DealsService.pipeline(tenantId)`.

- [ ] **Step 1: DealsService.advance (state-machine + claim-safe).**

```ts
async advance(tenantId: string, id: string, userId: string, toStage: CrmDealStage) {
  const deal = await this.prisma.crmDeal.findFirstOrThrow({ where: { id, tenantId } });
  if (!canTransitionDeal(deal.stage as CrmDealStage, toStage)) {
    throw new BadRequestException(`Cannot move deal from ${deal.stage} to ${toStage}`);
  }
  const res = await this.prisma.crmDeal.updateMany({
    where: { id, tenantId, stage: deal.stage }, // TOCTOU claim
    data: { stage: toStage },
  });
  if (res.count === 0) throw new BadRequestException('Deal changed concurrently; retry');
  await this.audit.log(tenantId, userId, 'crm-deal', id, 'ADVANCE', { before: { stage: deal.stage }, after: { stage: toStage } });
  return this.get(tenantId, id);
}
```

- [ ] **Step 2: DealsService.convert (WON → Customer).**

```ts
async convert(tenantId: string, id: string, userId: string) {
  const deal = await this.prisma.crmDeal.findFirstOrThrow({ where: { id, tenantId }, include: { company: true } });
  if (deal.stage !== CrmDealStage.WON) throw new BadRequestException('Only WON deals can be converted');
  return this.prisma.$transaction(async (tx) => {
    let customerId = deal.company.customerId;
    if (!customerId) {
      const code = await this.sequences.nextNumber(tenantId, 'customer'); // prefix CUST- (register key if missing)
      const customer = await tx.customer.create({ data: { tenantId, code, name: deal.company.name } });
      customerId = customer.id;
      await tx.crmCompany.update({ where: { id: deal.companyId }, data: { customerId, status: 'ACTIVE' } });
    }
    await tx.crmDeal.update({ where: { id }, data: { convertedCustomerId: customerId } });
    await this.audit.log(tenantId, userId, 'crm-deal', id, 'CONVERT', { after: { convertedCustomerId: customerId } });
    return { dealId: id, customerId };
  });
}
```
If `SequencesService` has no `customer` key, register it (prefix `CUST-`) following how other keys are declared. (Read `sequences` first.)

- [ ] **Step 3: ActivitiesService.create (maintains deal.lastActivityAt).**

```ts
async create(tenantId: string, input: CreateActivityInput, author: { userId?: string; agentId?: string }) {
  // at least one subject ref required; validate refs via OwnershipService.assertOwnedIfSet
  return this.prisma.$transaction(async (tx) => {
    const activity = await tx.crmActivity.create({ data: {
      tenantId, type: input.type, body: input.body,
      companyId: input.companyId ?? null, contactId: input.contactId ?? null, dealId: input.dealId ?? null,
      dueAt: input.dueAt ?? null,
      createdByUserId: author.userId ?? null, agentId: author.agentId ?? null,
    }});
    if (input.dealId) await tx.crmDeal.updateMany({ where: { id: input.dealId, tenantId }, data: { lastActivityAt: new Date() } });
    return activity;
  });
}
```
`complete(tenantId, id)` sets `doneAt = new Date()` (tenant-scoped updateMany).

- [ ] **Step 4: DealsService.pipeline** — returns `{ stage, deals: [...] }[]` for the active+terminal stages (deals grouped by stage, each with company name + amount + owner), tenant-scoped.

- [ ] **Step 5: DTOs + controllers.** `CreateDealDto` (title, companyId required; stage/amount/currency/ownerUserId/expectedCloseDate optional), `AdvanceDealDto` (`@IsEnum(CrmDealStage) stage`), `CreateActivityDto` (`@IsEnum(CrmActivityType) type`, body required, optional subject ids + dueAt). Controllers: `/crm/deals` (CRUD + `POST :id/advance` + `POST :id/convert`), `/crm/activities` (`GET`, `POST`, `POST :id/complete`), `GET /crm/pipeline`. Gating + perms as Task 3.

- [ ] **Step 6: e2e.** Extend `crm-module.e2e-spec.ts`: create deal → advance LEAD→QUALIFIED→PROPOSAL (ok) → advance PROPOSAL→LEAD (ok) → advance to WON → convert (assert a Customer created + `convertedCustomerId` set) → advance WON→LOST rejected 400. Create an activity on the deal → assert `lastActivityAt` set. `GET /crm/pipeline` returns grouped deals. Run e2e.

- [ ] **Step 7: Commit** — `git add apps/api && git commit -m "feat(crm): deals (advance/convert) + activities + pipeline + e2e"`

---

### Task 5: API — CRM exceptions cron + policies + playbooks + flow mapping

**Files:**
- Modify: `packages/shared/src/operating/policies.ts` (add `DOMAIN_EVENT_TYPES.CRM_DEAL_STALE='crm.deal.stale'`, `CRM_FOLLOWUP_DUE='crm.followup.due'` + two `POLICIES` entries)
- Modify: `packages/shared/src/operating/playbooks.ts` (add `CRM_STALE_DEAL`, `CRM_FOLLOWUP_DUE` entries)
- Modify: `packages/shared/src/operating/policies.spec.ts` + `playbooks.spec.ts` (cover the new entries)
- Modify: `packages/shared/src/analytics/flow.ts` (map `crm` event prefix + `deal`/`company`/`contact` subjects → `'CRM'`; add `'CRM'` to `FlowModule`) + `flow.spec.ts`
- Create: `apps/api/src/modules/crm/crm-exceptions.service.ts`
- Modify: `apps/api/src/modules/crm/crm.module.ts` (provide CrmExceptionsService; ensure DomainEventsService available)

**Interfaces:**
- Consumes: `DomainEventsService.emit`, `@Cron`, `CrmDealStage`/`isDealOpen`.
- Produces: domain events `crm.deal.stale` (payload `{ dealId, companyId, stage, daysSinceActivity }`), `crm.followup.due` (payload `{ activityId, dealId?, companyId?, dueAt }`); tasks `CRM_STALE_DEAL`/`CRM_FOLLOWUP_DUE`.

- [ ] **Step 1: Policies (pure) + tests.** Add the two event types and POLICIES entries (mirror the `STOP_DELAYED` entry). `CRM_DEAL_STALE` → task category `'CRM_STALE_DEAL'`, severity WARNING, subjectType `'deal'`, subjectId `dealId`, dedupKey `CRM_STALE_DEAL:${dealId}`, `assignHint: 'AUTO'`. `CRM_FOLLOWUP_DUE` → category `'CRM_FOLLOWUP_DUE'`, subjectType `'crm-activity'`, subjectId `activityId`, dedupKey `CRM_FOLLOWUP_DUE:${activityId}`, `assignHint: 'AUTO'`. Add assertions to `policies.spec.ts`.

- [ ] **Step 2: Playbooks + tests.** Add to `PLAYBOOKS`:

```ts
  CRM_STALE_DEAL: { slaMinutes: 1440, priority: NotificationLevel.WARNING, checklist: [
    "Examiner l'historique du deal et de la société",
    'Journaliser une relance (appel/email) appropriée',
    'Faire avancer ou requalifier le deal selon la réponse attendue',
    'Planifier la prochaine étape si nécessaire',
  ]},
  CRM_FOLLOWUP_DUE: { slaMinutes: 240, priority: NotificationLevel.WARNING, checklist: [
    'Relire la tâche de relance et son contexte',
    "Exécuter la relance (journaliser l'activité)",
    'Marquer la relance comme effectuée',
    'Créer la prochaine relance si le cycle continue',
  ]},
```
Cover both in `playbooks.spec.ts` (e.g. `getPlaybook('CRM_STALE_DEAL').checklist.length > 0`).

- [ ] **Step 3: Flow mapping + tests.** In `flow.ts`: add `'CRM'` to `FlowModule` union; `EVENT_PREFIX_MODULE.crm = 'CRM'`; `SUBJECT_MODULE` add `deal:'CRM', company:'CRM', contact:'CRM', 'crm-activity':'CRM'`. Add assertions to `flow.spec.ts`.

- [ ] **Step 4: Rebuild shared** — `pnpm --filter @pulsar/shared build`. Run shared suite green.

- [ ] **Step 5: CrmExceptionsService cron.** Mirror `delay-detection.service.ts`. `@Cron(CronExpression.EVERY_HOUR) detect()` calls `tick(now)`; `tick` is unit-testable (inject prisma + domainEvents). Logic: for each tenant with crm enabled (or just scan all tenants' open deals — simplest: scan all open deals), find open deals (`isDealOpen`) whose `lastActivityAt` < now-7d (or null && createdAt < now-7d) → emit `crm.deal.stale`; find `CrmActivity` TASK with `dueAt <= now && doneAt == null` → emit `crm.followup.due`. Best-effort, never throws (wrap in try/catch + logger like delay-detection). Idempotency handled downstream by task dedupKey.

- [ ] **Step 6: Commit** — `git add packages/shared apps/api && git commit -m "feat(crm): operating policies, playbooks, flow mapping + stale/follow-up detection cron"`

---

### Task 6: API — CRM agent tools + role preset

**Files:**
- Create: `apps/api/src/core/agents/tools/crm.tools.ts`
- Modify: `apps/api/src/core/agents/tool-registry.ts` (import + spread `crmTools`)
- Modify: `apps/api/src/core/agents/tool-types.ts` (`ToolServices.crm` shape)
- Modify: the `AGENT_TOOL_SERVICES` provider wiring (where ToolServices is assembled — find the provider that builds it, e.g. in the agents module) to include the CRM services
- Modify: `packages/shared/src/agents/role-presets.ts` (+ `.spec.ts`) (add `crm-sdr` preset)
- Modify: `apps/web/src/lib/components/agents/RegisterAgentModal.svelte` (`PRESET_EMOJI['crm-sdr']='🤝'`)

**Interfaces:**
- Consumes: `DealsService`, `CompaniesService`, `ActivitiesService` (via ToolServices); `MODULE_KEYS.CRM`, `PERMISSIONS.CRM.*`, `RiskTier`.
- Produces: tools `crm_list_deals`, `crm_get_company`, `crm_list_activities` (READ); `crm_log_activity`, `crm_advance_deal`, `crm_create_followup` (MUTATING). Role preset `crm-sdr`.

- [ ] **Step 1: ToolServices.crm shape.** In `tool-types.ts` add to `ToolServices`:

```ts
  crm: {
    listDeals(tenantId: string, query: object): Promise<unknown>;
    getCompany(tenantId: string, id: string): Promise<unknown>;
    listActivities(tenantId: string, query: object): Promise<unknown>;
    logActivity(tenantId: string, input: object, author: { agentId?: string; userId?: string }): Promise<unknown>;
    advanceDeal(tenantId: string, id: string, userId: string, stage: string): Promise<unknown>;
    createFollowup(tenantId: string, input: object, author: { agentId?: string }): Promise<unknown>;
  };
```

- [ ] **Step 2: crm.tools.ts** mirroring `fleet.tools.ts`. READ tools call services directly; MUTATING tools (`crm_log_activity`, `crm_advance_deal`, `crm_create_followup`) declare `tier: RiskTier.MUTATING`, `permission: PERMISSIONS.CRM.MANAGE`, `module: MODULE_KEYS.CRM`. Example:

```ts
import { z } from 'zod';
import { PERMISSIONS, MODULE_KEYS, RiskTier } from '@pulsar/shared';
import type { ToolDef } from '../tool-types';

export const crmTools: ToolDef[] = [
  { name: 'crm_list_deals', description: 'List CRM deals (optionally by stage or only stale/open).', tier: RiskTier.READ, permission: PERMISSIONS.CRM.READ, module: MODULE_KEYS.CRM,
    inputSchema: z.object({ stage: z.string().optional() }),
    run: (args, ctx) => ctx.services.crm.listDeals(ctx.principal.user.tenantId, args) },
  { name: 'crm_get_company', description: 'Get a CRM company with its contacts, deals and recent activities.', tier: RiskTier.READ, permission: PERMISSIONS.CRM.READ, module: MODULE_KEYS.CRM,
    inputSchema: z.object({ companyId: z.string().min(1) }),
    run: (args, ctx) => ctx.services.crm.getCompany(ctx.principal.user.tenantId, args.companyId) },
  { name: 'crm_list_activities', description: 'List activities for a deal or company.', tier: RiskTier.READ, permission: PERMISSIONS.CRM.READ, module: MODULE_KEYS.CRM,
    inputSchema: z.object({ dealId: z.string().optional(), companyId: z.string().optional() }),
    run: (args, ctx) => ctx.services.crm.listActivities(ctx.principal.user.tenantId, args) },
  { name: 'crm_log_activity', description: 'Record a CRM activity (note/call/email/meeting) on a deal/company/contact.', tier: RiskTier.MUTATING, permission: PERMISSIONS.CRM.MANAGE, module: MODULE_KEYS.CRM,
    inputSchema: z.object({ type: z.enum(['NOTE','CALL','EMAIL','MEETING']), body: z.string().min(1), dealId: z.string().optional(), companyId: z.string().optional(), contactId: z.string().optional() }),
    run: (args, ctx) => ctx.services.crm.logActivity(ctx.principal.user.tenantId, args, { agentId: ctx.principal.agentId }) },
  { name: 'crm_advance_deal', description: 'Advance a deal to a new stage (LEAD/QUALIFIED/PROPOSAL/WON/LOST).', tier: RiskTier.MUTATING, permission: PERMISSIONS.CRM.MANAGE, module: MODULE_KEYS.CRM,
    inputSchema: z.object({ dealId: z.string().min(1), stage: z.enum(['LEAD','QUALIFIED','PROPOSAL','WON','LOST']) }),
    run: (args, ctx) => ctx.services.crm.advanceDeal(ctx.principal.user.tenantId, args.dealId, ctx.principal.user.id, args.stage) },
  { name: 'crm_create_followup', description: 'Create a follow-up TASK activity with a due date.', tier: RiskTier.MUTATING, permission: PERMISSIONS.CRM.MANAGE, module: MODULE_KEYS.CRM,
    inputSchema: z.object({ body: z.string().min(1), dealId: z.string().optional(), companyId: z.string().optional(), dueAt: z.string().optional() }),
    run: (args, ctx) => ctx.services.crm.createFollowup(ctx.principal.user.tenantId, args, { agentId: ctx.principal.agentId }) },
];
```
(Verify `ctx.principal.agentId` and `ctx.principal.user.id` field names against `agent-principal.ts`; adjust to the real shape. `crm_advance_deal`/`crm_create_followup` run through the governance gate automatically because they are MUTATING — do NOT call them directly outside the registry.)

- [ ] **Step 3: Register tools + wire services.** Add `import { crmTools }` + spread into `TOOL_REGISTRY` in `tool-registry.ts`. Find where `AGENT_TOOL_SERVICES` is provided (the factory/provider assembling `ToolServices`) and add the `crm` object delegating to `DealsService`/`CompaniesService`/`ActivitiesService` (`logActivity`/`createFollowup` stamp `agentId`; `advanceDeal` maps to `DealsService.advance`). Ensure `CrmModule` exports those services and the agents module imports them (or resolve via `ModuleRef` if a cycle would form — check imports first; prefer exporting services from CrmModule and importing CrmModule where the provider lives).

- [ ] **Step 4: Role preset + emoji + tests.** Add to `AGENT_ROLE_PRESETS`:

```ts
  {
    id: 'crm-sdr',
    label: 'Agent commercial (SDR) 24/7',
    persona: "Je suis l'agent commercial 24/7. Je relance les deals en stagnation et les tâches de suivi dues : j'examine l'historique, je journalise une relance et je fais avancer ou requalifie le deal, puis je clôture l'exception.",
    suggestedPermissions: ['crm.read','crm.manage','core.operating.tasks.read','core.operating.tasks.manage'],
    suggestedAutonomy: AgentAutonomy.AUTONOMOUS,
    alwaysOn: true,
    handlesCategories: ['CRM_STALE_DEAL','CRM_FOLLOWUP_DUE'],
    suggestedMaxAmountPerAction: 1000,
  },
```
`role-presets.spec.ts` already asserts always-on invariants (categories + operating.tasks.read|manage + positive cap) and that permission keys are valid — it will cover this preset automatically; add `expect(ids).toContain('crm-sdr')` to the "exposes the expected always-on roles" test. Add `'crm-sdr': '🤝'` to `PRESET_EMOJI` in `RegisterAgentModal.svelte`.

- [ ] **Step 5: Build + tests.** `pnpm --filter @pulsar/shared build`; api typecheck (`cd apps/api && npx tsc --noEmit`); shared suite + role-presets spec green.

- [ ] **Step 6: Commit** — `git add -A && git commit -m "feat(crm): governed agent tools + crm-sdr always-on role preset"`

---

### Task 7: Web — CRM nav + pipeline kanban

**Files:**
- Modify: `apps/web/src/routes/(app)/+layout.svelte` (add CRM domain to nav, gated on `enabledModules.includes('crm')`)
- Create: `apps/web/src/routes/(app)/crm/+page.svelte` (pipeline)
- Create: `apps/web/src/lib/api` usage as existing

**Interfaces:**
- Consumes: `GET /crm/pipeline`, `POST /crm/deals/:id/advance`.

- [ ] **Step 1: Nav.** Add a CRM domain (icon 🤝/Users) to the two-rail nav in `+layout.svelte`, conditioned on `$auth.tenant.enabledModules` including `'crm'`, with contextual links: Pipeline (`/crm`), Sociétés (`/crm/companies`), Contacts (`/crm/contacts`). Mirror how Yard/Fleet domains are declared.

- [ ] **Step 2: Pipeline page.** `/crm/+page.svelte`: load `GET /crm/pipeline`, render one column per stage (LEAD/QUALIFIED/PROPOSAL/WON/LOST) with deal cards (title, company, amount, owner). Native HTML5 drag (mirror `YardPlan.svelte`): dragging a card to another column calls `POST /crm/deals/:id/advance {stage}`, optimistic update + revert + error toast on failure. FR labels, `$state`+`$effect` load, `api<T>()`.

- [ ] **Step 3: Verify build** — `pnpm --filter @pulsar/web build` (do NOT run api build while dev watch is up) + `npx svelte-check --workspace apps/web` → 0 errors.

- [ ] **Step 4: Commit** — `git add apps/web && git commit -m "feat(crm): nav + deal pipeline kanban"`

---

### Task 8: Web — companies & contacts (list + side panel + timeline + log activity + convert)

**Files:**
- Create: `apps/web/src/routes/(app)/crm/companies/+page.svelte`
- Create: `apps/web/src/routes/(app)/crm/contacts/+page.svelte`
- Create: `apps/web/src/lib/components/crm/ActivityTimeline.svelte`, `LogActivity.svelte` (small focused components)

**Interfaces:**
- Consumes: `/crm/companies`, `/crm/companies/:id`, `/crm/contacts`, `/crm/activities` (+ `POST`, `POST :id/complete`), `POST /crm/deals/:id/convert`.

- [ ] **Step 1: Companies list + side panel.** List (paginated, filter by status, search). Selecting a row opens a side panel (mirror the master-data list+panel pattern, e.g. carriers/customers pages): company fields, its contacts, its deals (with stage badge), and an **ActivityTimeline** of its activities; a **LogActivity** composer (type + body → `POST /crm/activities`); a "Convertir en client" button shown when the company has a WON deal not yet converted → `POST /crm/deals/:id/convert` (toast the created customer).

- [ ] **Step 2: ActivityTimeline + LogActivity components.** `ActivityTimeline.svelte` renders activities desc (icon per type, body, author = user or "🤖 agent", relative time, TASK shows due/done). `LogActivity.svelte` is a small form (type select NOTE/CALL/EMAIL/MEETING/TASK + body + optional dueAt for TASK) calling a passed `onLogged` callback.

- [ ] **Step 3: Contacts list + panel.** List (filter companyId, search) + side panel (contact fields, company link, its activities).

- [ ] **Step 4: Verify build** — `pnpm --filter @pulsar/web build` + `svelte-check` → 0 errors.

- [ ] **Step 5: Commit** — `git add apps/web && git commit -m "feat(crm): companies + contacts pages, activity timeline, log activity, convert"`

---

### Task 9: Verify — full autonomous agent loop + browser

**Files:** none (verification) — may add a focused e2e assertion to `crm-module.e2e-spec.ts`.

- [ ] **Step 1: e2e agent loop.** Extend `crm-module.e2e-spec.ts`: create an always-on `crm-sdr` agent (POST /agents with the preset caps + perms) on acme; create a deal + make it stale (set `lastActivityAt` 10d ago via a direct service/db call in the test, or create the seed stale deal); invoke the detection path (`CrmExceptionsService.tick(now)` directly, or emit `crm.deal.stale`); run `DomainEventsService.processPending`; assert a `CRM_STALE_DEAL` task was created and auto-assigned to the agent. (Full Hermes run is environment-dependent — assert up to task creation/assignment in e2e; the live agent action is verified manually in Step 2.)

- [ ] **Step 2: Manual runtime verification.** With `pnpm dev` + a configured `crm-sdr` agent (created from the modal) + Anthropic credits: confirm the stale deal generates a task, the agent wakes (run-now or cron), logs an activity / advances the deal, and resolves the task (`proposedActionCount >= 1`, task RESOLVED). Capture the run + the deal's new activity.

- [ ] **Step 3: Browser verification.** `/crm` pipeline drag moves a deal across stages; company side panel shows contacts + deals + activity timeline; log an activity; convert a WON deal → customer created.

- [ ] **Step 4: Final commit (if any test added)** — `git add -A && git commit -m "test(crm): autonomous agent loop e2e + verification"`

---

## Self-Review

- **Spec coverage:** data model (T2), shared enums+state machine (T1), API CRUD+advance+convert+pipeline+activities (T3,T4), permissions+module key (T1), web pipeline+companies+contacts+timeline (T7,T8), AI categories+policies+playbooks+cron (T5), agent tools+preset (T6), flow mapping (T5), tests+verification (each task + T9). All spec sections mapped.
- **Placeholders:** none — concrete code/paths given; mechanical CRUD explicitly mirrors named reference files (fleet/yard) which the implementer reads.
- **Type consistency:** `CrmDealStage`/`CrmCompanyStatus`/`CrmActivityType` value names identical in shared (T1) + schema (T2) + DTOs/tools; `canTransitionDeal` signature consistent across T1/T4/T6; categories `CRM_STALE_DEAL`/`CRM_FOLLOWUP_DUE` consistent across T5 (policies/playbooks) + T6 (preset handlesCategories) + T9.
- **Known check-first items flagged inline:** exact `permissions.ts` helper name (T1.4), `SequencesService` `customer` key existence (T4.2), `ToolServices` provider location + `principal` field names (T6), nav declaration pattern (T7.1).
