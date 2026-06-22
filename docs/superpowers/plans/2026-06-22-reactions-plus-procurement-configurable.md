# Arc E — Reactions+ & Procurement Configurable Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add three deterministic cross-module `RUN_ACTION` reactions and make the Procurement module configurable (custom fields on RFP + configurable RFP document prefix).

**Architecture:** Part 1 extends `REACTION_CATALOG` (`@pulsar/shared`) and the `ReactionExecutorService` switch with three idempotent handlers that reuse existing business services via lazy `ModuleRef.get`. Part 2 replays the proven custom-fields pattern (generic `CustomFieldsService`, per-module controller, `customData Json?` column, web editor + inputs) on the RFP entity, plus a configurable prefix via `MODULE_SETTINGS_CATALOG` + `SequencesService.OVERRIDABLE`. Defaults equal current behavior throughout.

**Tech Stack:** NestJS + Prisma (apps/api), SvelteKit Svelte 5 runes (apps/web), `@pulsar/shared` pure helpers, vitest (unit) + supertest (e2e), pnpm workspaces.

## Global Constraints

- **Defaults = current behavior.** No reaction rule is seeded (the 3 reactions are *available* in the catalogue; operators wire them via the automation editor). `documentPrefixRfp` defaults to `RFP` (= current static value). No custom field is seeded.
- **Rule 38 (reactions):** handlers are deterministic + idempotent + best-effort; no external effects (email/3rd-party). Service resolution is lazy `require()` + `moduleRef.get(Service, { strict: false })` (AutomationModule never statically imports business modules). Anti-loop single-hop is unchanged.
- **Rule 35:** `customData` validated via `CustomFieldsService.validateValues('procurement', tenantId, CustomFieldEntity.RFP, data, { partial })` before every persist (create `{partial:false}`, update `{partial:true}`).
- **Rule 36:** `procurement/custom-fields` controller gated `@RequireModule(MODULE_KEYS.PROCUREMENT)` + `core.modules.read` (GET) / `core.modules.manage` (PUT) + `@Audit('custom-field-definition', AuditAction.UPDATE)`.
- **Rule 8:** RFP numbers stay via `SequencesService.nextNumber(tenantId, 'rfp')`; counter keyed on `'rfp'`, never the prefix.
- **Rule 2:** transitions only via `canTransition*`; no new status. **Rule 1:** tenant-scoped from `@CurrentUser()`.
- **Rebuild after shared/database edits** (`pnpm --filter @pulsar/shared build`, `pnpm db:generate`).
- Run commands from repo root `C:\Users\samol\IntebecProject\Pulsar` (Git Bash). Dev DB is reset-friendly. Do NOT run `prisma migrate reset` (needs human consent) — if drift, report BLOCKED. Do NOT create git worktrees; commit directly to branch `arc-e-reactions-procurement`.

**Canonical templates (read once):**
- Reaction executor pattern (switch + lazy-resolve + idempotent handler): `apps/api/src/core/automation/reaction-executor.service.ts:97-174` (the two existing handlers `createPicksForOrder` / `draftCustomerInvoice`).
- Custom-fields controller/DTO to copy: `apps/api/src/modules/transportation/custom-fields/{custom-fields.controller.ts,dto/custom-field.dto.ts}`.
- customData injection reference: `apps/api/src/modules/transportation/transport-orders/transport-orders.service.ts`.

---

### Task 1: Shared — catalogue reactions, RFP entity, RFP prefix

**Files:**
- Modify: `packages/shared/src/automation/reactions.ts` (append 3 descriptors)
- Modify: `packages/shared/src/config/custom-fields.ts` (enum += RFP)
- Modify: `packages/shared/src/config/module-settings.ts` (procurement catalog += documentPrefixRfp)
- Modify: `apps/api/src/prisma/sequences.service.ts` (`PREFIX_SETTING` += rfp)
- Test: `packages/shared/src/automation/reactions.spec.ts`

**Interfaces:**
- Produces: reaction keys `open_maintenance_order`, `assign_dock_appointment`, `close_delivered_transport_order`; `CustomFieldEntity.RFP`; `documentPrefixRfp` (default `RFP`).

- [ ] **Step 1: Append the 3 reaction descriptors** to the `REACTION_CATALOG` array in `reactions.ts`:

```ts
  {
    key: 'open_maintenance_order',
    label: 'Ouvrir un ordre de maintenance',
    module: 'fleet',
    requiredModules: ['fleet'],
    description:
      'À l\'échéance d\'un entretien préventif, ouvre un ordre de maintenance pour l\'asset dû (s\'il n\'en a pas déjà un d\'ouvert).',
    argKeys: ['assetKind', 'assetId', 'scheduleId', 'name'],
  },
  {
    key: 'assign_dock_appointment',
    label: 'Affecter au quai du rendez-vous',
    module: 'yard',
    requiredModules: ['yard'],
    description:
      'À l\'arrivée d\'une visite liée à un rendez-vous quai, l\'affecte automatiquement au spot du rendez-vous (si libre).',
    argKeys: ['visitId'],
  },
  {
    key: 'close_delivered_transport_order',
    label: 'Fermer les ordres livrés',
    module: 'transportation',
    requiredModules: ['transportation'],
    description:
      'À la complétion d\'un load, ferme les ordres de transport entièrement livrés (COMPLETED → CLOSED).',
    argKeys: ['loadId'],
  },
```

- [ ] **Step 2: Add `RFP` to `CustomFieldEntity`** in `packages/shared/src/config/custom-fields.ts` — append `RFP = 'RFP',` to the enum (after the existing fleet values).

- [ ] **Step 3: Add `documentPrefixRfp` to the procurement catalog.** In `module-settings.ts`, inside the existing `{ module: 'procurement', settings: [...] }` entry, append:

```ts
      { key: 'documentPrefixRfp', label: 'Préfixe n° RFP', type: 'string', default: 'RFP', pattern: '^[A-Z0-9]{1,6}$', maxLength: 6 },
```

- [ ] **Step 4: Register the prefix override.** In `apps/api/src/prisma/sequences.service.ts`, add to `PREFIX_SETTING`:

```ts
  rfp: { module: 'procurement', settingKey: 'documentPrefixRfp' },
```

- [ ] **Step 5: Write the failing unit test** in `reactions.spec.ts`:

```ts
import { REACTION_CATALOG, reactionByKey } from './reactions';

describe('arc E reactions in catalogue', () => {
  it.each(['open_maintenance_order', 'assign_dock_appointment', 'close_delivered_transport_order'])(
    'exposes %s with required module + argKeys',
    (key) => {
      const d = reactionByKey(key);
      expect(d).toBeDefined();
      expect(d!.requiredModules.length).toBeGreaterThan(0);
      expect(d!.argKeys.length).toBeGreaterThan(0);
    },
  );
});
```

- [ ] **Step 6: Run the test + build shared.** Run: `pnpm --filter @pulsar/shared test -- reactions` (expect PASS), then `pnpm --filter @pulsar/shared build` (expect tsc exit 0).

- [ ] **Step 7: Commit.**

```bash
git add packages/shared/src/automation/reactions.ts packages/shared/src/automation/reactions.spec.ts packages/shared/src/config/custom-fields.ts packages/shared/src/config/module-settings.ts apps/api/src/prisma/sequences.service.ts
git commit -m "feat(shared): arc E reactions catalogue + RFP custom-field entity + RFP prefix"
```

---

### Task 2: Database — migration (RFP enum value + customData on Rfp)

**Files:**
- Modify: `packages/database/prisma/schema.prisma` (enum `CustomFieldEntity` += `RFP`; `model Rfp` += `customData Json?`)
- Create: `packages/database/prisma/migrations/<ts>_arc_e_rfp_custom_data/migration.sql` (generated)

**Interfaces:**
- Produces: Prisma client with `Rfp.customData` and `CustomFieldEntity.RFP`.

- [ ] **Step 1: Mirror the enum value.** In `schema.prisma`, add `RFP` to `enum CustomFieldEntity` (verbatim, rule 3).

- [ ] **Step 2: Add the column.** In `model Rfp` (line ~2436), add `customData Json?` (near other optional columns, before `createdAt`).

- [ ] **Step 3: Create + apply the migration.** Run: `pnpm db:migrate -- --name arc_e_rfp_custom_data`. If the flag triggers an interactive TTY, use the non-interactive equivalent: `pnpm --filter @pulsar/database exec dotenv -e ../../.env -- prisma migrate dev --name arc_e_rfp_custom_data`. Expected: one new migration applied, client regenerated. If drift wants a reset → STOP, report BLOCKED.

- [ ] **Step 4: Verify.** Run: `docker exec pulsar-db psql -U pulsar -d pulsar -tAc "SELECT column_name FROM information_schema.columns WHERE table_name='rfps' AND column_name='customData';"`. Expected: one row `customData`. (Confirm the physical table name first with `\dt rfp*` if unsure; Rfp may map to `rfps`.)

- [ ] **Step 5: Rebuild database package.** Run: `pnpm --filter @pulsar/database build`. Expected exit 0.

- [ ] **Step 6: Commit.**

```bash
git add packages/database/prisma/schema.prisma packages/database/prisma/migrations
git commit -m "feat(db): customData on Rfp + CustomFieldEntity.RFP"
```

---

### Task 3: API — three reaction handlers

**Files:**
- Modify: `apps/api/src/core/automation/reaction-executor.service.ts` (3 switch cases + 3 private handlers)
- Test: `apps/api/test/cross-module-automation.e2e-spec.ts` is the existing reaction e2e (new cases land in Task 6; this task is covered by typecheck + Task 6).

**Interfaces:**
- Consumes: `MaintenanceService.create(tenantId, userId, dto: CreateMaintenanceOrderDto)` where dto = `{ vehicleId?|trailerId?, type: MaintenanceType, description, ... }`; `VisitsService.assign(tenantId, userId, visitId, dto: { spotId: string })`; `TransportOrdersService.close(tenantId, userId, id)`; `MaintenanceType.PREVENTIVE`, `TransportOrderStatus.COMPLETED` from `@pulsar/shared`.
- Produces: handlers for the 3 reaction keys.

- [ ] **Step 1: Add the three switch cases** in `dispatch()` (after the existing two, before `default`):

```ts
      case 'open_maintenance_order':
        return this.openMaintenanceOrder(tenantId, sysUserId, command.args);
      case 'assign_dock_appointment':
        return this.assignDockAppointment(tenantId, sysUserId, command.args['visitId']);
      case 'close_delivered_transport_order':
        return this.closeDeliveredTransportOrder(tenantId, sysUserId, command.args['loadId']);
```

- [ ] **Step 2: Implement `openMaintenanceOrder`** (append as a private method, mirroring the lazy-resolve pattern of `createPicksForOrder`):

```ts
  private async openMaintenanceOrder(
    tenantId: string,
    userId: string,
    args: Record<string, string>,
  ): Promise<void> {
    const assetKind = args['assetKind'];
    const assetId = args['assetId'];
    if (!assetId || (assetKind !== 'vehicle' && assetKind !== 'trailer')) return;

    // Idempotent: skip if an open (non-terminal) WO already exists for this asset.
    const open = await this.prisma.maintenanceOrder.findFirst({
      where: {
        tenantId,
        ...(assetKind === 'vehicle' ? { vehicleId: assetId } : { trailerId: assetId }),
        status: { notIn: ['COMPLETED', 'CANCELLED'] },
      },
      select: { id: true },
    });
    if (open) return;

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { MaintenanceService } = require('../../modules/fleet/maintenance/maintenance.service') as typeof import('../../modules/fleet/maintenance/maintenance.service');
    const maintenance = this.moduleRef.get(MaintenanceService, { strict: false });
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { CreateMaintenanceOrderDto } = require('../../modules/fleet/maintenance/dto/maintenance.dto') as typeof import('../../modules/fleet/maintenance/dto/maintenance.dto');
    const { MaintenanceType } = require('@pulsar/shared') as typeof import('@pulsar/shared');

    const dto = new CreateMaintenanceOrderDto();
    if (assetKind === 'vehicle') dto.vehicleId = assetId;
    else dto.trailerId = assetId;
    dto.type = MaintenanceType.PREVENTIVE;
    dto.description = args['name'] || 'Entretien préventif planifié';
    await maintenance.create(tenantId, userId, dto);
  }
```

- [ ] **Step 3: Implement `assignDockAppointment`:**

```ts
  private async assignDockAppointment(
    tenantId: string,
    userId: string,
    visitId: string,
  ): Promise<void> {
    if (!visitId) return;
    const visit = await this.prisma.yardVisit.findFirst({
      where: { id: visitId, tenantId },
      select: { id: true, spotId: true, appointmentId: true },
    });
    if (!visit || visit.spotId || !visit.appointmentId) return; // already placed or no appointment
    const appt = await this.prisma.dockAppointment.findFirst({
      where: { id: visit.appointmentId, tenantId },
      select: { spotId: true },
    });
    if (!appt?.spotId) return;

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { VisitsService } = require('../../modules/yard/visits/visits.service') as typeof import('../../modules/yard/visits/visits.service');
    const visits = this.moduleRef.get(VisitsService, { strict: false });
    try {
      await visits.assign(tenantId, userId, visitId, { spotId: appt.spotId } as never);
    } catch (err) {
      // Spot became occupied (spotConflictPolicy=BLOCK) → benign no-op for an auto-assign.
      if (err instanceof ConflictException) return;
      throw err;
    }
  }
```

- [ ] **Step 4: Implement `closeDeliveredTransportOrder`:**

```ts
  private async closeDeliveredTransportOrder(
    tenantId: string,
    userId: string,
    loadId: string,
  ): Promise<void> {
    if (!loadId) return;
    const shipments = await this.prisma.shipment.findMany({
      where: { tenantId, loadId },
      select: { transportOrderId: true },
    });
    const orderIds = [...new Set(shipments.map((s) => s.transportOrderId).filter(Boolean))] as string[];
    if (orderIds.length === 0) return;
    const orders = await this.prisma.transportOrder.findMany({
      where: { tenantId, id: { in: orderIds }, status: 'COMPLETED' },
      select: { id: true },
    });
    if (orders.length === 0) return;

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { TransportOrdersService } = require('../../modules/transportation/transport-orders/transport-orders.service') as typeof import('../../modules/transportation/transport-orders/transport-orders.service');
    const orderSvc = this.moduleRef.get(TransportOrdersService, { strict: false });
    for (const o of orders) {
      await orderSvc.close(tenantId, userId, o.id); // COMPLETED → CLOSED (canTransition)
    }
  }
```

- [ ] **Step 5: Ensure `ConflictException` is imported** at the top of `reaction-executor.service.ts` (add to the `@nestjs/common` import alongside `BadRequestException`).

- [ ] **Step 6: Typecheck.** Run: `pnpm --filter @pulsar/api typecheck`. Expected: 0 errors. (If `args` typing complains, note `command.args` is `Record<string,string>`.)

- [ ] **Step 7: Commit.**

```bash
git add apps/api/src/core/automation/reaction-executor.service.ts
git commit -m "feat(api): arc E reaction handlers (maintenance/dock-assign/close-order)"
```

---

### Task 4: API — procurement custom-fields + RFP customData

**Files:**
- Create: `apps/api/src/modules/procurement/custom-fields/custom-fields.controller.ts` + `dto/custom-field.dto.ts`
- Modify: `apps/api/src/modules/procurement/procurement.module.ts` (import CustomFieldsModule, register controller)
- Modify: `apps/api/src/modules/procurement/procurement.service.ts` (`createRfp`/`updateRfp` customData) + `dto/create-rfp.dto.ts`

**Interfaces:**
- Consumes: `CustomFieldsService.validateValues('procurement', tenantId, CustomFieldEntity.RFP, data, { partial })`.
- Produces: `GET/PUT /procurement/custom-fields`; RFP create/update accept+return `customData`.

- [ ] **Step 1: Create the DTO** at `apps/api/src/modules/procurement/custom-fields/dto/custom-field.dto.ts` — byte-for-byte identical to `apps/api/src/modules/transportation/custom-fields/dto/custom-field.dto.ts`.

- [ ] **Step 2: Create the controller** at `apps/api/src/modules/procurement/custom-fields/custom-fields.controller.ts`, copying the transportation controller with substitutions `@ApiTags('procurement/custom-fields')`, `@RequireModule(MODULE_KEYS.PROCUREMENT)`, `@Controller('procurement/custom-fields')`, and both service calls use `'procurement'`:

```ts
import { Body, Controller, Get, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '@pulsar/shared';
import { AuditAction, CustomFieldEntity, MODULE_KEYS, PERMISSIONS } from '@pulsar/shared';
import { Audit } from '../../../common/decorators/audit.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RequireModule } from '../../../common/decorators/require-module.decorator';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { CustomFieldsService } from '../../../core/custom-fields/custom-fields.service';
import { ReplaceCustomFieldsDto } from './dto/custom-field.dto';

@ApiTags('procurement/custom-fields')
@ApiBearerAuth()
@RequireModule(MODULE_KEYS.PROCUREMENT)
@Controller('procurement/custom-fields')
export class CustomFieldsController {
  constructor(private readonly service: CustomFieldsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.CORE.MODULES_READ)
  list(@CurrentUser() user: AuthUser, @Query('entityType') entityType: CustomFieldEntity) {
    return this.service.listDefinitions('procurement', user.tenantId, entityType);
  }

  @Put()
  @Audit('custom-field-definition', AuditAction.UPDATE)
  @RequirePermissions(PERMISSIONS.CORE.MODULES_MANAGE)
  replace(@CurrentUser() user: AuthUser, @Body() dto: ReplaceCustomFieldsDto) {
    return this.service.replaceDefinitions('procurement', user.tenantId, dto.entityType, dto.definitions as never);
  }
}
```

- [ ] **Step 3: Register in the procurement module.** In `procurement.module.ts`: `import { CustomFieldsModule } from '../../core/custom-fields/custom-fields.module';` + `import { CustomFieldsController } from './custom-fields/custom-fields.controller';`, add `CustomFieldsModule` to `imports`, `CustomFieldsController` to `controllers`. Inject `CustomFieldsService` into `ProcurementService` (constructor) — `CustomFieldsModule` exports it.

- [ ] **Step 4: Add `customData?` to the RFP DTO.** In `create-rfp.dto.ts`, add (import `IsObject`, `IsOptional`):

```ts
  @IsOptional() @IsObject() customData?: Record<string, unknown>;
```

(`UpdateRfpDto = PartialType(CreateRfpDto)` so it inherits the field.)

- [ ] **Step 5: Validate + persist in `createRfp`/`updateRfp`.** In `procurement.service.ts` `createRfp`, before `prisma.rfp.create`:

```ts
const customData = await this.customFields.validateValues(
  'procurement', tenantId, CustomFieldEntity.RFP, dto.customData, { partial: false },
);
```

and add to the create `data`: `...(customData !== undefined ? { customData: customData as Prisma.InputJsonValue } : {})`. In `updateRfp`, the same with `{ partial: true }`, spread into the `data` passed to `rfp.updateMany`. Ensure the RFP GET (detail at line ~86 and list) returns `customData` (if a `select` excludes it, add `customData: true`; if it returns the row/`include`, it's already returned). Import `CustomFieldEntity` and `Prisma` if not present.

- [ ] **Step 6: Typecheck.** Run: `pnpm --filter @pulsar/api typecheck`. Expected: 0 errors. Fix any procurement spec harness that instantiates `ProcurementService` with positional args (add the customFields mock).

- [ ] **Step 7: Commit.**

```bash
git add apps/api/src/modules/procurement
git commit -m "feat(api): procurement custom-fields controller + customData on RFP"
```

---

### Task 5: Web — procurement custom-fields editor + RFP inputs

**Files:**
- Modify: `apps/web/src/lib/components/settings/CustomFieldsEditor.svelte` (procurement branch → RFP)
- Modify: `apps/web/src/routes/(app)/settings/modules/[key]/+page.svelte` (procurement branch)
- Modify: the RFP create/edit page (`apps/web/src/routes/(app)/procurement/...` — locate the RFP create form)

**Interfaces:**
- Consumes: `GET /procurement/custom-fields?entityType=RFP`; `<CustomFieldInputs>`; `<CustomFieldsEditor module>`.

- [ ] **Step 1: Add the PROCUREMENT entity list** to `CustomFieldsEditor.svelte`:

```ts
  const PROCUREMENT_ENTITY_TYPES: EntityTypeDef[] = [
    { value: 'RFP', label: 'RFP' },
  ];
```

and extend the `entityTypes` `$derived` with `moduleProp === 'procurement' ? PROCUREMENT_ENTITY_TYPES : ...`.

- [ ] **Step 2: Branch the config page** in `[key]/+page.svelte`:

```svelte
{:else if key === 'procurement'}
  <div class="mt-6">
    <CustomFieldsEditor module="procurement" />
  </div>
```

- [ ] **Step 3: Render inputs on the RFP create form.** Find the procurement RFP create form under `apps/web/src/routes/(app)/procurement/` (inspect; it is where `POST /procurement/rfps` is called). Apply the transport-orders pattern: import `CustomFieldInputs`, add `rfpFieldDefs = $state<CustomFieldDef[]>([])` + `customData = $state<Record<string, unknown>>({})`, fetch on form open `api<CustomFieldDef[]>('/procurement/custom-fields', { query: { entityType: 'RFP' } }).catch(() => [])`, render `{#if rfpFieldDefs.length > 0}<CustomFieldInputs definitions={rfpFieldDefs} bind:data={customData} />{/if}` under the native fields, include `customData: Object.keys(customData).length > 0 ? customData : undefined` in the create body, reset `customData = {}` on open. (The Procurement "Configuration" nav link already exists in `navigation.ts`.)

- [ ] **Step 4: svelte-check.** Run: `pnpm --filter @pulsar/web check`. Expected: no new errors. Do NOT run the browser step — the controller verifies in the browser.

- [ ] **Step 5: Commit.**

```bash
git add apps/web/src/lib/components/settings/CustomFieldsEditor.svelte "apps/web/src/routes/(app)/settings/modules/[key]/+page.svelte" "apps/web/src/routes/(app)/procurement"
git commit -m "feat(web): procurement config (RFP custom fields editor + inputs)"
```

---

### Task 6: End-to-end tests

**Files:**
- Modify: `apps/api/test/cross-module-automation.e2e-spec.ts` (add 3 reaction cases) OR create `apps/api/test/arc-e-reactions.e2e-spec.ts`
- Create: `apps/api/test/procurement-configurable.e2e-spec.ts`

**Interfaces:** Consumes all endpoints above + the existing e2e bootstrap (login as seeded admin, unique codes, enable modules, `PUT /api/v1/modules/<module>/settings`).

- [ ] **Step 1: Reaction e2e.** For each of the 3 reactions, create a `RUN_ACTION` automation rule (`POST /automation/rules` with `eventType` + `action: { kind:'RUN_ACTION', action:'<key>', args:{...templates} }`), drive the real trigger, run the worker (`processPending` via the existing helper or wait for `processCron`), then assert:
  - `open_maintenance_order`: a preventive WO now exists for the due asset; firing again (2nd event) creates NO second WO (idempotent — open WO present).
  - `assign_dock_appointment`: a checked-in visit with an appointment whose spot is set ends up assigned to that spot + a `YardMove` row; 2nd run = no-op (visit already has spot).
  - `close_delivered_transport_order`: an order at `COMPLETED` for a completed load becomes `CLOSED`; 2nd run = no-op. Module-disabled tenant = no-op.
  Follow the bootstrap style of `cross-module-automation.e2e-spec.ts` (it already seeds the service-account user and master data).

- [ ] **Step 2: Procurement e2e** (`procurement-configurable.e2e-spec.ts`, mirror `tms-configurable.e2e-spec.ts`):
  - Prefix: `PUT /api/v1/modules/procurement/settings` `{ documentPrefixRfp: 'RFQ' }` → next `POST /procurement/rfps` number starts `RFQ-`; create a 2nd → counter incremented (not reset). Reset settings in `afterAll`.
  - Custom fields: `PUT /procurement/custom-fields` define a required `SELECT` on `RFP` → create RFP without value = 400 → out-of-options = 400 → valid = 201 with `customData` in the GET projection.
  - Tenant isolation: tenant B's definitions absent from tenant A's `GET /procurement/custom-fields`.
  - Default: with no prefix set, a created RFP keeps `RFP-`.

- [ ] **Step 3: Run the suites.** Ensure DB up + seeded. Run: `pnpm --filter @pulsar/api test:e2e -- arc-e-reactions` and `pnpm --filter @pulsar/api test:e2e -- procurement-configurable`. Expected: green.

- [ ] **Step 4: Full gate.** Run: `pnpm test && pnpm typecheck`. Expected: 0 failures.

- [ ] **Step 5: Commit.**

```bash
git add apps/api/test
git commit -m "test(api): e2e for arc E reactions + procurement configurable"
```

---

## Self-review notes

- **Spec coverage:** Part 1 (3 reactions) → Task 1 (catalogue) + Task 3 (handlers) + Task 6 (e2e incl. idempotence). Part 2: RFP custom fields → Task 1 (enum) + Task 2 (column) + Task 4 (API) + Task 5 (web) + Task 6 (e2e); RFP prefix → Task 1 (catalog + OVERRIDABLE) + Task 6 (e2e). Bid/Award explicitly out of scope per spec §2.1. Migration/permissions (§3) → Task 2 + "no new permission".
- **Placeholder scan:** every code step shows code; handler bodies are concrete; the one "locate the RFP create form" (Task 5 Step 3) is a find-then-apply-known-pattern instruction with the full pattern given.
- **Type consistency:** reaction keys identical across Task 1 (catalogue), Task 3 (switch), Task 6 (rules); module string `'procurement'` consistent (controller, validateValues, PREFIX_SETTING); `CustomFieldEntity.RFP` consistent (shared enum, schema, controller default, web entity list); event names match emitters (`fleet.maintenance.due`, `yard.visit-checked-in`, `load.completed`).
- **Known dependency:** Task 3 assumes the `fleet.maintenance.due` payload carries `assetKind`/`assetId`/`name` (confirmed at `maintenance-schedules.service.ts:277`). If a field is missing at implementation, enrich that `emit` (best-effort) as part of Task 3.
