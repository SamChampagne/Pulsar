# Configurable WMS / Yard / Fleet Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replay the TMS/Billing configurable pattern on WMS, Yard and Fleet — tenant custom fields on each module's core documents/assets, plus configurable process rules (document prefixes + Yard spot-conflict policy).

**Architecture:** No new mechanism. Extend the shared `CustomFieldEntity` enum and `MODULE_SETTINGS_CATALOG`, add `OVERRIDABLE` prefix entries in `SequencesService`, add 7 `customData Json?` columns, and branch one `<module>/custom-fields` controller per module (exact copy of the transportation controller). The web config route `/settings/modules/[key]` is already generic — only the `CustomFieldsEditor` per-module branch and two nav links are added. Defaults equal current behavior throughout.

**Tech Stack:** NestJS + Prisma (apps/api), SvelteKit Svelte 5 runes (apps/web), `@pulsar/shared` pure helpers, vitest (unit) + supertest (e2e), pnpm workspaces.

## Global Constraints

- **Defaults = current behavior** — every new setting's `default` equals today's hardcoded value (`RC`/`PK`/`YV`/`DA` prefixes, `spotConflictPolicy='BLOCK'`). Activating a module changes nothing until a setting is edited or a custom field is defined.
- **Rule 1** — every definition AND value query is `tenantId`-scoped from `@CurrentUser()`.
- **Rule 2** — no new status, no state-machine change (rules 32/33/34 intact).
- **Rule 3** — `CustomFieldEntity` enum values mirrored verbatim in `schema.prisma`.
- **Rule 6 / 14** — definition writes carry `@Audit('custom-field-definition', AuditAction.UPDATE)`.
- **Rule 8** — numbers only via `SequencesService.nextNumber`; counter keyed on the `SequenceKey`, never the prefix.
- **Rule 35** — `customData` is validated via `CustomFieldsService.validateValues(...)` before EVERY persist (create `{ partial: false }`, update `{ partial: true }`).
- **Rule 36** — controller per module gated `@RequireModule(MODULE_KEYS.<X>)` + `<module>.manage` (write) / `core.modules.read` (definition read).
- **Rebuild after shared/database edits** (`pnpm --filter @pulsar/shared build`, `pnpm db:generate`) — the API consumes their `dist/`.
- Run all commands from the repo root `C:\Users\samol\IntebecProject\Pulsar`. The dev DB is reset-friendly (seed-only data).

**Canonical templates to copy (read once):**
- Controller: `apps/api/src/modules/transportation/custom-fields/custom-fields.controller.ts`
- DTO: `apps/api/src/modules/transportation/custom-fields/dto/custom-field.dto.ts`
- Core service (do NOT modify): `apps/api/src/core/custom-fields/custom-fields.service.ts` — `listDefinitions(module, tenantId, entityType)`, `replaceDefinitions(...)`, `validateValues(module, tenantId, entityType, data, { partial })`.
- customData injection reference: `apps/api/src/modules/transportation/transport-orders/transport-orders.service.ts` (constructor injects `CustomFieldsService`; create/update call `validateValues` then spread `...(customData !== undefined ? { customData: customData as Prisma.InputJsonValue } : {})`).

---

### Task 1: Shared — enum values, setting catalogs, prefix overrides

**Files:**
- Modify: `packages/shared/src/config/custom-fields.ts:1-7` (enum)
- Modify: `packages/shared/src/config/module-settings.ts` (catalog: add `wms`, `yard`; `fleet` unchanged)
- Modify: `apps/api/src/prisma/sequences.service.ts:42-48` (`PREFIX_SETTING`)
- Test: `packages/shared/src/config/module-settings.spec.ts`

**Interfaces:**
- Produces: `CustomFieldEntity.{RECEIPT, PICK_ORDER, YARD_VISIT, DOCK_APPOINTMENT, VEHICLE, TRAILER, MAINTENANCE_ORDER}`; catalog entries for modules `'wms'`/`'yard'`; `spotConflictPolicy` resolves to `'BLOCK'|'WARN'` (default `'BLOCK'`).

- [ ] **Step 1: Extend the `CustomFieldEntity` enum.** In `packages/shared/src/config/custom-fields.ts`, replace the enum body (lines 1-7) with:

```ts
export enum CustomFieldEntity {
  TRANSPORT_ORDER = 'TRANSPORT_ORDER',
  SHIPMENT = 'SHIPMENT',
  LOAD = 'LOAD',
  INCOMING_CARRIER_INVOICE = 'INCOMING_CARRIER_INVOICE',
  CUSTOMER_INVOICE = 'CUSTOMER_INVOICE',
  RECEIPT = 'RECEIPT',
  PICK_ORDER = 'PICK_ORDER',
  YARD_VISIT = 'YARD_VISIT',
  DOCK_APPOINTMENT = 'DOCK_APPOINTMENT',
  VEHICLE = 'VEHICLE',
  TRAILER = 'TRAILER',
  MAINTENANCE_ORDER = 'MAINTENANCE_ORDER',
}
```

- [ ] **Step 2: Add the `wms` and `yard` catalogs.** In `packages/shared/src/config/module-settings.ts`, inside the `MODULE_SETTINGS_CATALOG` array, add these two entries (place them next to the existing `fleet` entry; do not touch `fleet`):

```ts
  {
    module: 'wms',
    settings: [
      { key: 'documentPrefixReceipt', label: 'Préfixe n° réception', type: 'string', default: 'RC', pattern: '^[A-Z0-9]{1,6}$', maxLength: 6 },
      { key: 'documentPrefixPickOrder', label: 'Préfixe n° pick order', type: 'string', default: 'PK', pattern: '^[A-Z0-9]{1,6}$', maxLength: 6 },
    ],
  },
  {
    module: 'yard',
    settings: [
      { key: 'documentPrefixYardVisit', label: 'Préfixe n° visite cour', type: 'string', default: 'YV', pattern: '^[A-Z0-9]{1,6}$', maxLength: 6 },
      { key: 'documentPrefixDockAppointment', label: 'Préfixe n° rendez-vous quai', type: 'string', default: 'DA', pattern: '^[A-Z0-9]{1,6}$', maxLength: 6 },
      {
        key: 'spotConflictPolicy',
        label: 'Conflit d\'emplacement de cour',
        help: 'BLOCK = refuse (409) une 2ᵉ visite active sur un spot occupé. WARN = laisse passer avec un avertissement.',
        type: 'enum',
        default: 'BLOCK',
        options: [
          { value: 'BLOCK', label: 'Bloquer (refuser)' },
          { value: 'WARN', label: 'Avertir (laisser passer)' },
        ],
      },
    ],
  },
```

- [ ] **Step 3: Register the prefix overrides.** In `apps/api/src/prisma/sequences.service.ts`, extend `PREFIX_SETTING` (lines 42-48) with four entries:

```ts
  receipt: { module: 'wms', settingKey: 'documentPrefixReceipt' },
  'pick-order': { module: 'wms', settingKey: 'documentPrefixPickOrder' },
  'yard-visit': { module: 'yard', settingKey: 'documentPrefixYardVisit' },
  'dock-appointment': { module: 'yard', settingKey: 'documentPrefixDockAppointment' },
```

- [ ] **Step 4: Write the failing unit test.** In `packages/shared/src/config/module-settings.spec.ts`, add:

```ts
import { catalogFor, resolveSettings } from './module-settings';

describe('wms/yard configurable catalogs', () => {
  it('wms prefixes default to RC/PK', () => {
    const cat = catalogFor('wms')!;
    const r = resolveSettings(cat, {});
    expect(r.documentPrefixReceipt).toBe('RC');
    expect(r.documentPrefixPickOrder).toBe('PK');
  });
  it('yard defaults preserve current behavior (YV/DA, BLOCK)', () => {
    const cat = catalogFor('yard')!;
    const r = resolveSettings(cat, {});
    expect(r.documentPrefixYardVisit).toBe('YV');
    expect(r.documentPrefixDockAppointment).toBe('DA');
    expect(r.spotConflictPolicy).toBe('BLOCK');
  });
  it('spotConflictPolicy rejects unknown values, falls back to default', () => {
    const cat = catalogFor('yard')!;
    expect(resolveSettings(cat, { spotConflictPolicy: 'NOPE' }).spotConflictPolicy).toBe('BLOCK');
    expect(resolveSettings(cat, { spotConflictPolicy: 'WARN' }).spotConflictPolicy).toBe('WARN');
  });
});
```

- [ ] **Step 5: Run unit tests, expect FAIL then PASS.** Run: `pnpm --filter @pulsar/shared test -- module-settings`. Expected: the new tests pass once Steps 1-2 are in (they exercise only shared code).

- [ ] **Step 6: Rebuild shared (rule 7).** Run: `pnpm --filter @pulsar/shared build`. Expected: `tsc` exits 0.

- [ ] **Step 7: Commit.**

```bash
git add packages/shared/src/config/custom-fields.ts packages/shared/src/config/module-settings.ts packages/shared/src/config/module-settings.spec.ts apps/api/src/prisma/sequences.service.ts
git commit -m "feat(shared): custom-field entities + wms/yard setting catalogs + prefix overrides"
```

---

### Task 2: Database — migration for enum values + customData columns

**Files:**
- Modify: `packages/database/prisma/schema.prisma` (enum `CustomFieldEntity` at line 1886; add `customData Json?` to 7 models: `Vehicle` 616, `Trailer` 650, `MaintenanceOrder` 1797, `Receipt` 2091, `PickOrder` 2129, `YardVisit` 2221, `DockAppointment` 2274)
- Create: `packages/database/prisma/migrations/<timestamp>_configurable_wms_yard_fleet/migration.sql` (generated)

**Interfaces:**
- Produces: Prisma client with `customData` on the 7 models and the 7 new enum values.

- [ ] **Step 1: Mirror the enum in the schema.** In `packages/database/prisma/schema.prisma`, add the 7 new values to `enum CustomFieldEntity` (matching Task 1 Step 1 names exactly): `RECEIPT PICK_ORDER YARD_VISIT DOCK_APPOINTMENT VEHICLE TRAILER MAINTENANCE_ORDER`.

- [ ] **Step 2: Add `customData Json?` to each of the 7 models.** Inside each model block add a line (mirror the existing TransportOrder placement, e.g. near other optional columns):

```prisma
  customData            Json?
```

Apply to `Vehicle`, `Trailer`, `MaintenanceOrder`, `Receipt`, `PickOrder`, `YardVisit`, `DockAppointment`.

- [ ] **Step 3: Create + apply the migration.** Run: `pnpm db:migrate -- --name configurable_wms_yard_fleet`. Expected: a new migration folder is created, applied, and Prisma client regenerated; "Found 0 errors". (If the dev DB drifts, see the project's reset note — dev data is seed-only.)

- [ ] **Step 4: Verify the columns exist.** Run: `docker exec pulsar-db psql -U pulsar -d pulsar -tAc "SELECT table_name, column_name FROM information_schema.columns WHERE column_name='customData' AND table_name IN ('vehicles','trailers','maintenance_orders','receipts','pick_orders','yard_visits','dock_appointments') ORDER BY table_name;"`. Expected: 7 rows.

- [ ] **Step 5: Rebuild database package.** Run: `pnpm --filter @pulsar/database build`. Expected: exit 0.

- [ ] **Step 6: Commit.**

```bash
git add packages/database/prisma/schema.prisma packages/database/prisma/migrations
git commit -m "feat(db): customData on wms/yard/fleet entities + CustomFieldEntity values"
```

---

### Task 3: WMS API — custom-fields controller + Receipt/PickOrder customData

**Files:**
- Create: `apps/api/src/modules/wms/custom-fields/custom-fields.controller.ts`
- Create: `apps/api/src/modules/wms/custom-fields/dto/custom-field.dto.ts`
- Modify: `apps/api/src/modules/wms/wms.module.ts` (import `CustomFieldsModule`, register controller)
- Modify: `apps/api/src/modules/wms/receiving/receiving.service.ts` (+ its `*.module.ts` / DTO) — Receipt create/update
- Modify: `apps/api/src/modules/wms/picking/picking.service.ts` (+ DTO) — PickOrder create
- Test: `apps/api/test/configurable-wms.e2e-spec.ts` (created in Task 9; injection verified there)

**Interfaces:**
- Consumes: `CustomFieldsService.validateValues('wms', tenantId, CustomFieldEntity.RECEIPT|PICK_ORDER, data, { partial })`; `MODULE_KEYS.WMS`; `PERMISSIONS.WMS.*`.
- Produces: `GET/PUT /wms/custom-fields`; Receipt & PickOrder accept+return `customData`.

- [ ] **Step 1: Create the DTO** at `apps/api/src/modules/wms/custom-fields/dto/custom-field.dto.ts` — byte-for-byte identical to the transportation DTO (`apps/api/src/modules/transportation/custom-fields/dto/custom-field.dto.ts`). No substitutions needed (it references the shared enums).

- [ ] **Step 2: Create the controller** at `apps/api/src/modules/wms/custom-fields/custom-fields.controller.ts`, copying the transportation controller with these exact substitutions: `@ApiTags('wms/custom-fields')`, `@RequireModule(MODULE_KEYS.WMS)`, `@Controller('wms/custom-fields')`, and both service calls use the module string `'wms'`:

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

@ApiTags('wms/custom-fields')
@ApiBearerAuth()
@RequireModule(MODULE_KEYS.WMS)
@Controller('wms/custom-fields')
export class CustomFieldsController {
  constructor(private readonly service: CustomFieldsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.CORE.MODULES_READ)
  list(@CurrentUser() user: AuthUser, @Query('entityType') entityType: CustomFieldEntity) {
    return this.service.listDefinitions('wms', user.tenantId, entityType);
  }

  @Put()
  @Audit('custom-field-definition', AuditAction.UPDATE)
  @RequirePermissions(PERMISSIONS.CORE.MODULES_MANAGE)
  replace(@CurrentUser() user: AuthUser, @Body() dto: ReplaceCustomFieldsDto) {
    return this.service.replaceDefinitions('wms', user.tenantId, dto.entityType, dto.definitions as never);
  }
}
```

- [ ] **Step 3: Register in the WMS module.** In `apps/api/src/modules/wms/wms.module.ts`: add `import { CustomFieldsModule } from '../../core/custom-fields/custom-fields.module';` and `import { CustomFieldsController } from './custom-fields/custom-fields.controller';`, add `CustomFieldsModule` to the `imports` array, and `CustomFieldsController` to the `controllers` array.

- [ ] **Step 4: Inject customData into Receipt.** In the Receipt DTOs (the create/update DTO files under `receiving/dto/`), add `@IsOptional() @IsObject() customData?: Record<string, unknown>;` (import `IsObject`, `IsOptional` from `class-validator`). In `receiving.service.ts`: inject `private readonly customFields: CustomFieldsService` in the constructor (and add `CustomFieldsModule` to `receiving`'s module imports if it is a separate module; otherwise it resolves from the WMS module import in Step 3). In `create()`, before `prisma.receipt.create`:

```ts
const customData = await this.customFields.validateValues(
  'wms', tenantId, CustomFieldEntity.RECEIPT, dto.customData, { partial: false },
);
```

and in the `data: { ... }` object add `...(customData !== undefined ? { customData: customData as Prisma.InputJsonValue } : {})`. Mirror in `update()` with `{ partial: true }`. Ensure the GET projections (list + detail) return `customData` (Prisma returns it by default unless a `select` excludes it — if a `select` is used, add `customData: true`).

- [ ] **Step 5: Inject customData into PickOrder.** Same pattern in `picking/dto/` + `picking.service.ts` `create()`, using `CustomFieldEntity.PICK_ORDER`. (PickOrder has no update-of-fields path in scope; create only.)

- [ ] **Step 6: Typecheck the API.** Run: `pnpm --filter @pulsar/api typecheck` (or rely on the dev watch printing "Found 0 errors"). Expected: 0 errors.

- [ ] **Step 7: Commit.**

```bash
git add apps/api/src/modules/wms
git commit -m "feat(api): wms custom-fields controller + customData on receipt/pick-order"
```

---

### Task 4: WMS web — custom-fields editor branch, inputs, nav link

**Files:**
- Modify: `apps/web/src/lib/components/settings/CustomFieldsEditor.svelte` (add WMS entity list + mapping)
- Modify: `apps/web/src/routes/(app)/settings/modules/[key]/+page.svelte` (add `wms` branch)
- Modify: `apps/web/src/lib/modules/navigation.ts` (add WMS Configuration link)
- Modify: WMS receiving + picking pages (`apps/web/src/routes/(app)/wms/receiving/+page.svelte`, `apps/web/src/routes/(app)/wms/picking/+page.svelte`) — render `<CustomFieldInputs>` in create forms

**Interfaces:**
- Consumes: `GET /wms/custom-fields?entityType=RECEIPT|PICK_ORDER`; `<CustomFieldInputs definitions data />` (already fixed for undefined binds).

- [ ] **Step 1: Add WMS entity types to the editor.** In `CustomFieldsEditor.svelte`, after `BILLING_ENTITY_TYPES` add:

```ts
  const WMS_ENTITY_TYPES: EntityTypeDef[] = [
    { value: 'RECEIPT', label: 'Réception' },
    { value: 'PICK_ORDER', label: 'Pick order' },
  ];
```

and extend the `entityTypes` `$derived` to map `moduleProp === 'wms' ? WMS_ENTITY_TYPES : ...` (chain after billing).

- [ ] **Step 2: Branch the config page.** In `[key]/+page.svelte`, add after the billing branch:

```svelte
{:else if key === 'wms'}
  <div class="mt-6">
    <CustomFieldsEditor module="wms" />
  </div>
```

- [ ] **Step 3: Add the nav Configuration link.** In `navigation.ts`, inside the WMS module's nav groups (key `'wms'`, around line 163-189), add an ADMINISTRATION group mirroring the transportation one:

```ts
{ href: '/settings/modules/wms', label: 'Configuration' },
```

(Follow the exact group shape used by the transportation module's `Configuration` entry — check lines ~150-152 for the `href: '/settings/modules/transportation'` group and copy its structure.)

- [ ] **Step 4: Render inputs on the receiving create form.** In `wms/receiving/+page.svelte`: import `CustomFieldInputs` and a `CustomFieldDef` type, add `orderFieldDefs = $state<CustomFieldDef[]>([])` and `customData = $state<Record<string, unknown>>({})`, fetch defs in the form-open handler (`api<CustomFieldDef[]>('/wms/custom-fields', { query: { entityType: 'RECEIPT' } }).catch(() => [])`), render `{#if orderFieldDefs.length > 0}<CustomFieldInputs definitions={orderFieldDefs} bind:data={customData} />{/if}` under the native fields, and include `customData: Object.keys(customData).length > 0 ? customData : undefined` in the create body. Mirror the transport-orders page (`apps/web/src/routes/(app)/transport-orders/+page.svelte:161-202,562-566`).

- [ ] **Step 5: Render inputs on the picking create form.** Same as Step 4 in `wms/picking/+page.svelte` with `entityType: 'PICK_ORDER'`.

- [ ] **Step 6: Verify in the browser.** With `pnpm dev` running and logged in (admin@pulsar.dev / admin123): go to `/settings/modules/wms`, define a TEXT field on RECEIPT, save; open the receiving create form and confirm the field renders and round-trips (create → GET shows `customData`). Capture a screenshot.

- [ ] **Step 7: Commit.**

```bash
git add apps/web/src/lib/components/settings/CustomFieldsEditor.svelte "apps/web/src/routes/(app)/settings/modules/[key]/+page.svelte" apps/web/src/lib/modules/navigation.ts "apps/web/src/routes/(app)/wms"
git commit -m "feat(web): wms config (custom fields editor + inputs + nav)"
```

---

### Task 5: Yard API — controller + Visit/Appointment customData + spotConflictPolicy

**Files:**
- Create: `apps/api/src/modules/yard/custom-fields/custom-fields.controller.ts` + `dto/custom-field.dto.ts`
- Modify: `apps/api/src/modules/yard/yard.module.ts`
- Modify: `apps/api/src/modules/yard/visits/visits.service.ts` (customData on create; `spotConflictPolicy` at `assignToSpot` line ~130) + DTO
- Modify: `apps/api/src/modules/yard/appointments/appointments.service.ts` (customData on create) + DTO

**Interfaces:**
- Consumes: `CustomFieldsService.validateValues('yard', ...)`; `ModuleSettingsService.resolve(tenantId, 'yard')` (or the direct `TenantModulesCacheService` path already used in the service for other settings) → `spotConflictPolicy`.
- Produces: `GET/PUT /yard/custom-fields`; YardVisit & DockAppointment accept+return `customData`; `assignToSpot` returns `{ ...visit, spotWarnings?: string[] }` when policy is `WARN`.

- [ ] **Step 1: Create DTO + controller** under `apps/api/src/modules/yard/custom-fields/`, copying Task 3 Steps 1-2 with substitutions `'yard'` / `MODULE_KEYS.YARD` / `@Controller('yard/custom-fields')` / `@ApiTags('yard/custom-fields')`.

- [ ] **Step 2: Register in `yard.module.ts`** (import `CustomFieldsModule` + `CustomFieldsController`, add to `imports`/`controllers`) — same as Task 3 Step 3.

- [ ] **Step 3: customData on YardVisit create** in `visits.service.ts` + visit create DTO, using `CustomFieldEntity.YARD_VISIT` — same pattern as Task 3 Step 4 (inject `CustomFieldsService`).

- [ ] **Step 4: customData on DockAppointment create** in `appointments.service.ts` + DTO, using `CustomFieldEntity.DOCK_APPOINTMENT`.

- [ ] **Step 5: Write the failing spotConflictPolicy unit test.** In `apps/api/src/modules/yard/visits/visits.service.spec.ts`, add a test that, with a stubbed settings resolver returning `{ spotConflictPolicy: 'WARN' }` and an occupied spot (`occ > 0`), `assignToSpot` resolves (no throw) and the result has a non-empty `spotWarnings`; and with `'BLOCK'` it throws `ConflictException`. (Mirror the existing spec's stubbing style — `sequences`/prisma fakes already present in that file.)

- [ ] **Step 6: Implement the policy branch.** In `visits.service.ts` `assignToSpot` (the `if (occ > 0) throw new ConflictException('Spot already occupied')` at ~line 130): resolve `spotConflictPolicy` from the yard settings (reuse however the service already reads settings; if none yet, inject `ModuleSettingsService` and call `resolve(tenantId, 'yard')`). Then:

```ts
const policy = settings.spotConflictPolicy as 'BLOCK' | 'WARN';
const spotWarnings: string[] = [];
if (occ > 0) {
  if (policy === 'BLOCK') throw new ConflictException('Spot already occupied');
  spotWarnings.push('Spot already occupied');
}
```

Thread `spotWarnings` onto the returned object (`return { ...visit, ...(spotWarnings.length ? { spotWarnings } : {}) }`). The derived-occupancy query and the in-transaction `YardMove` write (rule 34) are unchanged — the warning path still writes the move.

- [ ] **Step 7: Run the unit test.** Run: `pnpm --filter @pulsar/api test -- visits.service`. Expected: PASS.

- [ ] **Step 8: Commit.**

```bash
git add apps/api/src/modules/yard
git commit -m "feat(api): yard custom-fields + customData + configurable spotConflictPolicy"
```

---

### Task 6: Yard web — editor branch, inputs, nav link

**Files:** same set as Task 4, for yard.

- [ ] **Step 1: Add YARD entity types** to `CustomFieldsEditor.svelte`:

```ts
  const YARD_ENTITY_TYPES: EntityTypeDef[] = [
    { value: 'YARD_VISIT', label: 'Visite de cour' },
    { value: 'DOCK_APPOINTMENT', label: 'Rendez-vous quai' },
  ];
```

and extend the `entityTypes` `$derived` with `moduleProp === 'yard' ? YARD_ENTITY_TYPES : ...`.

- [ ] **Step 2: Branch the config page** in `[key]/+page.svelte`:

```svelte
{:else if key === 'yard'}
  <div class="mt-6">
    <CustomFieldsEditor module="yard" />
  </div>
```

- [ ] **Step 3: Add the Yard Configuration nav link** in `navigation.ts` (yard module, key `'yard'`, ~line 197-209): `{ href: '/settings/modules/yard', label: 'Configuration' }`.

- [ ] **Step 4: Render inputs** on the yard visit create form (`/yard/gate` check-in or `/yard/+page.svelte`, wherever a visit is created) with `entityType: 'YARD_VISIT'`, and on the appointment create form (`/yard/appointments`) with `entityType: 'DOCK_APPOINTMENT'` — same pattern as Task 4 Step 4. If `assignToSpot` returns `spotWarnings`, surface them as a non-blocking toast/inline notice on the page.

- [ ] **Step 5: Browser verify** — define a field on YARD_VISIT, confirm it renders + round-trips; trigger a spot conflict with `spotConflictPolicy=WARN` and confirm the visit is created with a warning shown. Screenshot.

- [ ] **Step 6: Commit.**

```bash
git add apps/web/src/lib/components/settings/CustomFieldsEditor.svelte "apps/web/src/routes/(app)/settings/modules/[key]/+page.svelte" apps/web/src/lib/modules/navigation.ts "apps/web/src/routes/(app)/yard"
git commit -m "feat(web): yard config (custom fields editor + inputs + spot-conflict warning + nav)"
```

---

### Task 7: Fleet API — controller + Vehicle/Trailer/MaintenanceOrder customData

**Files:**
- Create: `apps/api/src/modules/fleet/custom-fields/custom-fields.controller.ts` + `dto/custom-field.dto.ts`
- Modify: `apps/api/src/modules/fleet/fleet.module.ts`
- Modify: `apps/api/src/modules/fleet/maintenance/maintenance.service.ts` (+ DTO) — MaintenanceOrder customData
- Modify: the **transportation** Vehicle & Trailer services/DTOs (`apps/api/src/modules/transportation/.../vehicles*`, `.../trailers*`) — customData validated against `module='fleet'`

**Interfaces:**
- Consumes: `CustomFieldsService.validateValues('fleet', tenantId, CustomFieldEntity.VEHICLE|TRAILER|MAINTENANCE_ORDER, data, { partial })`.
- Produces: `GET/PUT /fleet/custom-fields`; Vehicle, Trailer, MaintenanceOrder accept+return `customData`.

- [ ] **Step 1: Create DTO + controller** under `apps/api/src/modules/fleet/custom-fields/`, substitutions `'fleet'` / `MODULE_KEYS.FLEET` / `@Controller('fleet/custom-fields')` / `@ApiTags('fleet/custom-fields')`.

- [ ] **Step 2: Register in `fleet.module.ts`** (import `CustomFieldsModule` + controller).

- [ ] **Step 3: customData on MaintenanceOrder** create/update in `maintenance.service.ts` + DTO, `CustomFieldEntity.MAINTENANCE_ORDER`, module `'fleet'`.

- [ ] **Step 4: customData on Vehicle & Trailer (cross-module — rule 32).** The Vehicle/Trailer CRUD lives in the transportation module. In those services/DTOs, add `customData?` to the create/update DTOs and call `this.customFields.validateValues('fleet', tenantId, CustomFieldEntity.VEHICLE /* or TRAILER */, dto.customData, { partial })` — note the module string is `'fleet'`, not `'transportation'`. Inject `CustomFieldsService` (already exported by `CustomFieldsModule`, already imported in `transportation.module.ts`). Spread `customData` into the create/update data and include it in GET projections.

- [ ] **Step 5: Typecheck.** Run: `pnpm --filter @pulsar/api typecheck`. Expected: 0 errors.

- [ ] **Step 6: Commit.**

```bash
git add apps/api/src/modules/fleet apps/api/src/modules/transportation
git commit -m "feat(api): fleet custom-fields + customData on vehicle/trailer/maintenance-order"
```

---

### Task 8: Fleet web — editor branch + inputs

**Files:** `CustomFieldsEditor.svelte`, `[key]/+page.svelte`, fleet asset/maintenance pages. (Fleet Configuration nav link already exists.)

- [ ] **Step 1: Add FLEET entity types** to `CustomFieldsEditor.svelte`:

```ts
  const FLEET_ENTITY_TYPES: EntityTypeDef[] = [
    { value: 'VEHICLE', label: 'Véhicule' },
    { value: 'TRAILER', label: 'Remorque' },
    { value: 'MAINTENANCE_ORDER', label: 'Ordre de maintenance' },
  ];
```

and extend `entityTypes` `$derived` with `moduleProp === 'fleet' ? FLEET_ENTITY_TYPES : ...`.

- [ ] **Step 2: Branch the config page** in `[key]/+page.svelte`:

```svelte
{:else if key === 'fleet'}
  <div class="mt-6">
    <CustomFieldsEditor module="fleet" />
  </div>
```

- [ ] **Step 3: Render inputs** on the vehicle, trailer (under the transportation roster pages `/assets` or `/fleet` — wherever vehicles/trailers are created/edited) and maintenance-order create forms, fetching `/fleet/custom-fields?entityType=VEHICLE|TRAILER|MAINTENANCE_ORDER` — same pattern as Task 4 Step 4.

- [ ] **Step 4: Browser verify** — define a field on VEHICLE from `/settings/modules/fleet`, confirm it renders on the vehicle form and round-trips. Screenshot.

- [ ] **Step 5: Commit.**

```bash
git add apps/web/src/lib/components/settings/CustomFieldsEditor.svelte "apps/web/src/routes/(app)/settings/modules/[key]/+page.svelte" "apps/web/src/routes/(app)/fleet" "apps/web/src/routes/(app)/assets"
git commit -m "feat(web): fleet config (custom fields editor + inputs)"
```

---

### Task 9: End-to-end tests

**Files:**
- Create: `apps/api/test/configurable-wms-yard-fleet.e2e-spec.ts`

**Interfaces:**
- Consumes: all endpoints above. Uses the existing e2e bootstrap (login as seeded admin, create master data with unique codes, enable modules).

- [ ] **Step 1: Write the e2e suite.** Follow the structure of `apps/api/test/tms-configurable.e2e-spec.ts`. Cover:
  - **Prefixes:** `PUT /wms/custom-fields` not needed here — instead `PATCH` the wms module settings to `{ documentPrefixReceipt: 'RCV' }`, create a receipt, assert its number starts with `RCV-`; create a second, assert the counter incremented (not reset). Repeat for `pick-order` (PK→`PKX`), `yard-visit` (YV→`YVX`), `dock-appointment` (DA→`DAX`).
  - **Yard spotConflictPolicy:** with default (`BLOCK`), assign two active visits to one spot → 2nd returns 409. Set `{ spotConflictPolicy: 'WARN' }`, repeat → 2nd succeeds with non-empty `spotWarnings` and a `YardMove` row exists.
  - **Custom fields round-trip (one per module):** define a required `SELECT` on `RECEIPT` (wms), `YARD_VISIT` (yard), `VEHICLE` (fleet); create without value → 400; with out-of-options value → 400; with a valid value → 201 and `customData` present in the GET projection.
  - **Tenant isolation:** definitions created for tenant A are absent from tenant B's `GET /<module>/custom-fields`.
  - **Defaults:** with no setting/field configured, an existing receipt/visit/vehicle creation path still succeeds (`RC-`/`YV-` prefixes, no 409 change).

- [ ] **Step 2: Run the suite.** Ensure DB is up + seeded (`pnpm db:up && pnpm db:migrate && pnpm db:seed`), then run: `pnpm --filter @pulsar/api test:e2e -- configurable-wms-yard-fleet`. Expected: all green.

- [ ] **Step 3: Run the full unit + e2e gate.** Run: `pnpm test && pnpm typecheck`. Expected: 0 failures.

- [ ] **Step 4: Commit.**

```bash
git add apps/api/test/configurable-wms-yard-fleet.e2e-spec.ts
git commit -m "test(api): e2e for configurable wms/yard/fleet"
```

---

## Self-review notes

- **Spec coverage:** A.1 WMS prefixes → Task 1+3+9; A.2 Yard prefixes + spotConflictPolicy → Task 1+5+9; A.3 Fleet (no new prefix) → catalog untouched, custom fields only → Task 7+8; B entities (7) → Task 2 (columns) + Tasks 3/5/7 (validation) + Tasks 4/6/8 (UI); Vehicle/Trailer cross-module coupling → Task 7 Step 4 explicit. Migration/permissions (§C) → Task 2 + "no new permission" noted. Tests (§D) → Task 1 (unit) + Task 9 (e2e).
- **Placeholder scan:** no TBD/TODO; every code step shows code; controller/DTO copies give the full text and explicit substitutions.
- **Type consistency:** enum names identical across Task 1 (shared) and Task 2 (schema); module strings (`'wms'`/`'yard'`/`'fleet'`) consistent between controllers, `validateValues` calls, and `PREFIX_SETTING`; `spotConflictPolicy` values `'BLOCK'|'WARN'` consistent between catalog default, unit test, and the service branch.
- **Known follow-up:** the dynamic `/settings/modules/[key]` route already renders `ModuleSettings` for any catalog module, so no new config *pages* are created — only `CustomFieldsEditor` branches and nav links. (Corrects the spec's "pages à créer" wording.)
