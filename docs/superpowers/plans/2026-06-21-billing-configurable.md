# Billing configurable v1 (arc C) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rendre Billing adaptable par tenant (5 règles de processus + champs personnalisés sur les factures entrantes/relevés), en réutilisant et **généralisant** l'infra du socle TMS, défauts = comportement actuel.

**Architecture:** Branche partie de `tms-configurable-socle` (infra champs-perso + type `string` + préfixes de séquence présents). On ajoute des descripteurs `billing`, on paramètre `evaluateReconciliation` d'un `mode`, on généralise `CustomFieldsService` (param `module`) en le déplaçant en `core/custom-fields`, on consomme les réglages aux points Billing, et on câble les champs perso sur l'intake freight-audit.

**Tech Stack:** NestJS + Prisma ; `@pulsar/shared` (TS pur, vitest) ; class-validator ; SvelteKit (Svelte 5 runes) ; Jest e2e.

## Global Constraints

- **Défauts = comportement actuel exact.** Tout descripteur a un défaut identique au codé en dur ; aucun champ perso par défaut. `toleranceMode` défaut `MAX` = formule actuelle.
- **Règle 1** tenant isolation (définitions + valeurs). **Règle 2** aucun nouveau statut / state machine — gates par réglage dans les transitions existantes. **Règle 3** enum `CustomFieldEntity` mirroré shared↔Prisma. **Règle 8** compteur indexé sur la clé de séquence, jamais le préfixe. **Règle 14** config auditée. **Règle 16** `priceDetail`/coût figé jamais recalculé ; `defaultCurrency` n'affecte que la création.
- **Règle 7** rebuild `@pulsar/shared`/`@pulsar/database` après modif. **`@pulsar/shared` browser-safe** (pas d'import Node).
- **Aucune nouvelle permission** : config sous `core.modules.read|manage` ; valeurs sous `billing.*`.
- `customData` toujours validé par `validateCustomFields` avant persistance (règle 35 du socle).
- Garder la suite e2e `tms-configurable` (présente sur cette branche) VERTE après la généralisation du service.

---

## File Structure

**Créés :**
- `apps/api/src/core/custom-fields/custom-fields.service.ts` — service généralisé (déplacé depuis transportation, param `module`).
- `apps/api/src/core/custom-fields/custom-fields.module.ts` — `CustomFieldsModule` (provide+export `CustomFieldsService`).
- `apps/api/src/modules/billing/custom-fields/billing-custom-fields.controller.ts` — `GET/PUT /billing/custom-fields`.
- `apps/api/test/billing-configurable.e2e-spec.ts`.

**Modifiés :**
- `packages/shared/src/config/module-settings.ts` — descripteurs `billing`.
- `packages/shared/src/billing/reconciliation.ts` — param `mode`.
- `packages/shared/src/config/custom-fields.ts` — `CustomFieldEntity` += 2.
- `packages/database/prisma/schema.prisma` — enum + `customData` sur `IncomingCarrierInvoice`, `CustomerInvoice`.
- `apps/api/src/prisma/sequences.service.ts` — `PREFIX_SETTING` module-aware + 2 clés billing.
- `apps/api/src/modules/transportation/custom-fields/custom-fields.controller.ts` + `transport-orders.service.ts` + `loads.service.ts` + `transportation.module.ts` — consomment le service généralisé en passant `'transportation'`.
- `apps/api/src/modules/billing/invoices.service.ts` (toleranceMode, defaultCurrency) ; `billing/freight-audit/freight-audit.service.ts` (toleranceMode, defaultCurrency, customData) ; `billing/customer-invoices.service.ts` (autoSendOnApproval, defaultCurrency) ; `billing/freight-audit/dto/freight-audit.dto.ts` (customData) ; `billing/billing.module.ts` (import CustomFieldsModule, billing custom-fields controller).
- `apps/web/src/lib/modules/navigation.ts` (entrée Configuration Billing) ; `settings/modules/[key]/+page.svelte` (CustomFieldsEditor pour billing) ; `billing/freight-audit/+page.svelte` (CustomFieldInputs + display).
- `docs/etat-du-projet.md`, `CLAUDE.md`.

---

## Task 1: `@pulsar/shared` — billing descriptors + reconciliation mode + entity enum

**Files:**
- Modify: `packages/shared/src/config/module-settings.ts`, `packages/shared/src/billing/reconciliation.ts`, `packages/shared/src/config/custom-fields.ts`
- Test: `packages/shared/src/config/module-settings.spec.ts`, `packages/shared/src/billing/reconciliation.spec.ts` (create if absent)

**Interfaces:**
- Produces: billing descriptors (`autoSendOnApproval` bool default false ; `toleranceMode` enum MAX/MIN default MAX ; `invoiceNumberPrefix` string default INV ; `customerInvoiceNumberPrefix` string default CINV ; `defaultCurrency` string default CAD) ; `evaluateReconciliation(lines, tolerance, mode?: 'MAX'|'MIN')` ; `CustomFieldEntity` += `INCOMING_CARRIER_INVOICE`, `CUSTOMER_INVOICE`.

- [ ] **Step 1: Write the failing tests**

Add to `packages/shared/src/config/module-settings.spec.ts`:

```ts
describe('billing process descriptors', () => {
  it('defaults equal current behavior', () => {
    const d = resolveSettings(catalogFor('billing')!, {});
    expect(d.tolerancePct).toBe(2);            // existing, unchanged
    expect(d.toleranceAbsolute).toBe(25);      // existing, unchanged
    expect(d.autoSendOnApproval).toBe(false);
    expect(d.toleranceMode).toBe('MAX');
    expect(d.invoiceNumberPrefix).toBe('INV');
    expect(d.customerInvoiceNumberPrefix).toBe('CINV');
    expect(d.defaultCurrency).toBe('CAD');
  });
});
```

Create `packages/shared/src/billing/reconciliation.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { evaluateReconciliation } from './reconciliation';

const lines = [{ expected: 1000, invoiced: 1040 }]; // gross variance 40
const tol = { tolerancePct: 2, toleranceAbsolute: 25 }; // pct of 1040 = 20.8; max=25, min=20.8

describe('evaluateReconciliation mode', () => {
  it('MAX (default) uses max(absolute, pct) — 40 > 25 → outside', () => {
    expect(evaluateReconciliation(lines, tol).withinTolerance).toBe(false);
    expect(evaluateReconciliation(lines, tol, 'MAX').withinTolerance).toBe(false);
  });
  it('a within-MAX case: gross 20 ≤ 25', () => {
    expect(evaluateReconciliation([{ expected: 1000, invoiced: 1020 }], tol, 'MAX').withinTolerance).toBe(true);
  });
  it('MIN tightens: threshold = min(25, 20.8)=20.8 → gross 20 still in, gross 22 out', () => {
    expect(evaluateReconciliation([{ expected: 1000, invoiced: 1020 }], tol, 'MIN').withinTolerance).toBe(true);
    expect(evaluateReconciliation([{ expected: 1000, invoiced: 1022 }], tol, 'MIN').withinTolerance).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @pulsar/shared test`
Expected: FAIL (descriptors absent; `mode` param unused).

- [ ] **Step 3: Add billing descriptors**

In `module-settings.ts`, in the `module: 'billing'` settings array (after the two existing tolerance entries):

```ts
      { key: 'autoSendOnApproval', label: 'Envoi auto du relevé à l’approbation', type: 'boolean', default: false },
      {
        key: 'toleranceMode', label: 'Mode de tolérance', type: 'enum', default: 'MAX',
        help: 'MAX = seuil = max(absolu, %). MIN = seuil = min (plus strict).',
        options: [ { value: 'MAX', label: 'Max (défaut)' }, { value: 'MIN', label: 'Min (strict)' } ],
      },
      { key: 'invoiceNumberPrefix', label: 'Préfixe n° facture transporteur', type: 'string', default: 'INV', pattern: '^[A-Z0-9]{1,6}$', maxLength: 6 },
      { key: 'customerInvoiceNumberPrefix', label: 'Préfixe n° relevé client', type: 'string', default: 'CINV', pattern: '^[A-Z0-9]{1,6}$', maxLength: 6 },
      { key: 'defaultCurrency', label: 'Devise par défaut', type: 'string', default: 'CAD', pattern: '^[A-Z]{3}$', maxLength: 3 },
```

- [ ] **Step 4: Add `mode` to `evaluateReconciliation`**

In `reconciliation.ts`, change the signature + threshold:

```ts
export function evaluateReconciliation(
  lines: ReconciliationLine[],
  tolerance: ReconciliationTolerance,
  mode: 'MAX' | 'MIN' = 'MAX',
): ReconciliationOutcome {
  const invoicedTotal = round(lines.reduce((acc, l) => acc + l.invoiced, 0));
  const varianceTotal = round(lines.reduce((acc, l) => acc + (l.invoiced - l.expected), 0));
  const varianceGross = round(lines.reduce((acc, l) => acc + Math.abs(l.invoiced - l.expected), 0));
  const pct = (invoicedTotal * tolerance.tolerancePct) / 100;
  const threshold = mode === 'MIN'
    ? Math.min(tolerance.toleranceAbsolute, pct)
    : Math.max(tolerance.toleranceAbsolute, pct);
  return { invoicedTotal, varianceTotal, varianceGross, withinTolerance: varianceGross <= threshold };
}
```
(Existing 2-arg callers keep MAX behaviour via the default.)

- [ ] **Step 5: Extend `CustomFieldEntity`**

In `packages/shared/src/config/custom-fields.ts`, add to the enum:

```ts
  INCOMING_CARRIER_INVOICE = 'INCOMING_CARRIER_INVOICE',
  CUSTOMER_INVOICE = 'CUSTOMER_INVOICE',
```

- [ ] **Step 6: Run tests + full shared suite**

Run: `pnpm --filter @pulsar/shared test`
Expected: PASS (new + existing).

- [ ] **Step 7: Rebuild + commit**

```bash
pnpm --filter @pulsar/shared build
git add packages/shared/src
git commit -m "feat(shared): billing process descriptors + reconciliation mode + billing custom-field entities"
```

---

## Task 2: Migration — billing custom-field entities + customData columns

**Files:**
- Modify: `packages/database/prisma/schema.prisma`

**Interfaces:**
- Produces: Prisma enum `CustomFieldEntity` += `INCOMING_CARRIER_INVOICE`, `CUSTOMER_INVOICE` (mirror shared) ; `customData Json?` on `IncomingCarrierInvoice` + `CustomerInvoice`.

- [ ] **Step 1: Edit schema**

In `schema.prisma`: add the two values to the `CustomFieldEntity` enum (mirror shared, rule 3). Add `customData Json?` to models `IncomingCarrierInvoice` and `CustomerInvoice`.

- [ ] **Step 2: Migrate (non-interactive, drift-safe)**

This branch is stacked on `tms-configurable-socle`; the shared local DB carries migrations from several branches. **Do NOT `migrate reset`; do NOT add another branch's migration to this branch.** Use the safe procedure:
```bash
pnpm db:up
pnpm --filter @pulsar/database exec prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --script
```
Capture ONLY the new statements (the `ALTER TYPE ... ADD VALUE` for the 2 enum values + the 2 `ALTER TABLE ... ADD COLUMN "customData" JSONB`). Write them into a new folder `packages/database/prisma/migrations/<TS>_billing_custom_fields/migration.sql`. Apply: `prisma db execute --file <that file> --schema prisma/schema.prisma`. Record: `prisma migrate resolve --applied <TS>_billing_custom_fields`. Then `pnpm db:generate` + `pnpm --filter @pulsar/database build`.
> Postgres note: `ALTER TYPE ... ADD VALUE` cannot run inside a transaction block with other statements in some setups — if `db execute` rejects the combined script, split the enum `ADD VALUE`s and the `ADD COLUMN`s into separate executes (still one migration.sql file is fine for the recorded migration; the runtime apply may need two `db execute` calls). Report what you did.

- [ ] **Step 3: Verify + commit**

Confirm `git diff --name-only <merge-base-with-tms-socle>..HEAD -- packages/database/prisma/migrations` shows ONLY this branch's new migration (plus the TMS socle's, which is inherited from the base branch — that's expected since we branched from it). The NEW folder is `billing_custom_fields`.
```bash
git add packages/database/prisma/schema.prisma packages/database/prisma/migrations
git commit -m "feat(db): billing custom-field entities + customData on incoming/customer invoices"
```

---

## Task 3: Generalize `CustomFieldsService` to `core/custom-fields` (module param)

**Files:**
- Create: `apps/api/src/core/custom-fields/custom-fields.service.ts`, `apps/api/src/core/custom-fields/custom-fields.module.ts`
- Delete: `apps/api/src/modules/transportation/custom-fields/custom-fields.service.ts`
- Modify: `apps/api/src/modules/transportation/custom-fields/custom-fields.controller.ts`, `transport-orders/transport-orders.service.ts`, `loads/loads.service.ts`, `transportation/transportation.module.ts`

**Interfaces:**
- Produces: `CustomFieldsService` with `module` as the FIRST param on each method:
  - `listDefinitions(module: string, tenantId: string, entityType: CustomFieldEntity): Promise<CustomFieldDefinition[]>`
  - `replaceDefinitions(module: string, tenantId: string, entityType: CustomFieldEntity, defs): Promise<CustomFieldDefinition[]>`
  - `validateValues(module: string, tenantId: string, entityType: CustomFieldEntity, data: unknown, opts?): Promise<CustomFieldValues | undefined>`
  - `CustomFieldsModule` provides + exports `CustomFieldsService`.

- [ ] **Step 1: Move + parameterize the service**

Create `apps/api/src/core/custom-fields/custom-fields.service.ts` as a copy of the current transportation service, but REMOVE the `const MODULE = 'transportation'` and add `module: string` as the first parameter of `listDefinitions`, `replaceDefinitions`, `validateValues`; use that `module` in every `where: { tenantId, module, entityType }` and `data: { module, ... }`. Delete the old transportation copy.

```ts
import { BadRequestException, Injectable } from '@nestjs/common';
import { CustomFieldType, validateCustomFields, validateDefinitions, type CustomFieldDefinition, type CustomFieldValues, type CustomFieldEntity } from '@pulsar/shared';
import { Prisma } from '@pulsar/database';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class CustomFieldsService {
  constructor(private readonly prisma: PrismaService) {}

  async listDefinitions(module: string, tenantId: string, entityType: CustomFieldEntity): Promise<CustomFieldDefinition[]> {
    const rows = await this.prisma.customFieldDefinition.findMany({ where: { tenantId, module, entityType }, orderBy: { sortOrder: 'asc' } });
    return rows.map((r) => ({ key: r.key, label: r.label, type: r.type as CustomFieldType, options: (r.options as { value: string; label: string }[] | null) ?? undefined, required: r.required, showInList: r.showInList, sortOrder: r.sortOrder }));
  }

  async replaceDefinitions(module: string, tenantId: string, entityType: CustomFieldEntity, defs: CustomFieldDefinition[]): Promise<CustomFieldDefinition[]> {
    const check = validateDefinitions(defs);
    if (!check.ok) throw new BadRequestException(check.errors.join('; '));
    await this.prisma.$transaction([
      this.prisma.customFieldDefinition.deleteMany({ where: { tenantId, module, entityType } }),
      this.prisma.customFieldDefinition.createMany({ data: defs.map((d, i) => ({ tenantId, module, entityType, key: d.key, label: d.label, type: d.type, options: d.options != null ? (d.options as Prisma.InputJsonValue) : Prisma.DbNull, required: d.required ?? false, showInList: d.showInList ?? false, sortOrder: d.sortOrder ?? i })) }),
    ]);
    return this.listDefinitions(module, tenantId, entityType);
  }

  async validateValues(module: string, tenantId: string, entityType: CustomFieldEntity, data: unknown, opts: { partial?: boolean } = {}): Promise<CustomFieldValues | undefined> {
    const defs = await this.listDefinitions(module, tenantId, entityType);
    if (defs.length === 0 && (data === undefined || data === null)) return undefined;
    const res = validateCustomFields(defs, data ?? {}, opts);
    if (!res.ok) throw new BadRequestException(res.errors.join('; '));
    return res.value;
  }
}
```

- [ ] **Step 2: CustomFieldsModule**

```ts
import { Module } from '@nestjs/common';
import { CustomFieldsService } from './custom-fields.service';
@Module({ providers: [CustomFieldsService], exports: [CustomFieldsService] })
export class CustomFieldsModule {}
```
(`PrismaService` is global.)

- [ ] **Step 3: Update transportation consumers to pass `'transportation'`**

- `transportation.module.ts`: remove `CustomFieldsService` from its own `providers` (it now comes from `CustomFieldsModule`); add `CustomFieldsModule` to `imports`. Keep the transportation `custom-fields.controller` registered.
- `transportation/custom-fields/custom-fields.controller.ts`: inject `CustomFieldsService` (from core) and pass `'transportation'` as the first arg in both handlers.
- `transport-orders.service.ts` + `loads.service.ts`: every `this.customFields.validateValues(tenantId, ENTITY, dto.customData, {...})` becomes `this.customFields.validateValues('transportation', tenantId, ENTITY, dto.customData, {...})`. Update the constructor import path to `core/custom-fields/custom-fields.service`.

- [ ] **Step 4: Typecheck + run the TMS e2e (must stay green)**

```bash
pnpm typecheck
pnpm db:up && pnpm db:seed
cd apps/api && npx jest --config test/jest-e2e.json --runInBand --testPathPattern="tms-configurable"
```
Expected: typecheck clean (no NEW errors); `tms-configurable` still green (the generalization must not regress TMS custom fields).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/core/custom-fields apps/api/src/modules/transportation
git commit -m "refactor(api): generalize CustomFieldsService to core (module param), keep TMS green"
```

---

## Task 4: Billing process rules (toleranceMode / autoSendOnApproval / defaultCurrency / prefixes)

**Files:**
- Modify: `apps/api/src/prisma/sequences.service.ts` ; `billing/invoices.service.ts` ; `billing/freight-audit/freight-audit.service.ts` ; `billing/customer-invoices.service.ts`

**Interfaces:**
- Consumes: `moduleSettings.resolve(tenantId, 'billing')` (services already resolve billing for tolerances) ; `evaluateReconciliation(..., mode)` (Task 1).

- [ ] **Step 1: Module-aware prefixes in SequencesService**

Change `PREFIX_SETTING` to carry the module, and make `prefixFor` resolve that module:

```ts
const PREFIX_SETTING: Partial<Record<SequenceKey, { module: string; settingKey: string }>> = {
  'transport-order': { module: 'transportation', settingKey: 'documentPrefixTransportOrder' },
  shipment: { module: 'transportation', settingKey: 'documentPrefixShipment' },
  load: { module: 'transportation', settingKey: 'documentPrefixLoad' },
  invoice: { module: 'billing', settingKey: 'invoiceNumberPrefix' },
  'customer-invoice': { module: 'billing', settingKey: 'customerInvoiceNumberPrefix' },
};
```
In `prefixFor`, use `const entry = PREFIX_SETTING[key]; if (!entry) return PREFIXES[key];` then `catalogFor(entry.module)`, `moduleDefinition.findUnique({ where: { key: entry.module } })`, and `settings[entry.settingKey]`. Counter stays keyed on `key` (rule 8).

- [ ] **Step 2: `toleranceMode` in reconcile + audit**

In `invoices.service.ts` `reconcile()` and `freight-audit.service.ts` `audit()`: where they call `evaluateReconciliation(lines, tolerances)`, also read the mode and pass it. The services already have a `tolerances(tenantId)` helper resolving `billing` settings — extend it (or add a sibling read) to also return `mode = s.toleranceMode as 'MAX'|'MIN'`, and call `evaluateReconciliation(lines, { tolerancePct, toleranceAbsolute }, mode)`.

- [ ] **Step 3: `autoSendOnApproval` in customer-invoice approve**

In `customer-invoices.service.ts` `approve(...)`, after the APPROVED transition commits, read `billing` settings; if `autoSendOnApproval === true`, attempt `this.send(tenantId, userId, id)` wrapped best-effort:
```ts
const s = await this.moduleSettings.resolve(tenantId, 'billing');
if (s.autoSendOnApproval === true) {
  try { await this.send(tenantId, userId, id); } catch { /* no email / send failed: stays APPROVED, best-effort */ }
}
```
Inject `ModuleSettingsService` if `customer-invoices.service` doesn't already have it (confirm; `invoices.service` does). `send()` already requires APPROVED + customer email and transitions to SENT — reusing it keeps the state machine intact (rule 2).

- [ ] **Step 4: `defaultCurrency` at creation**

In the three create paths where `'CAD'` is currently the hardcoded default (`invoices.service` createDraft, `freight-audit.service` create, `customer-invoices.service` createDrafts/groupByCurrency), replace the literal fallback with the resolved `billing` setting `defaultCurrency` when the DTO/source provides none. Only the *fallback* changes; an explicit currency is untouched. (For customer invoices grouped by currency, `defaultCurrency` only applies if a rated order has no currency — keep existing per-currency grouping otherwise.)

- [ ] **Step 5: Typecheck**

Run: `pnpm typecheck`
Expected: no NEW errors. (Behaviour verified by Task 7 e2e.)

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/prisma/sequences.service.ts apps/api/src/modules/billing
git commit -m "feat(api): configurable billing process rules (toleranceMode/autoSend/defaultCurrency/prefixes)"
```

---

## Task 5: Billing custom fields API (definitions + freight-audit intake values)

**Files:**
- Create: `apps/api/src/modules/billing/custom-fields/billing-custom-fields.controller.ts`
- Modify: `billing/billing.module.ts` ; `billing/freight-audit/dto/freight-audit.dto.ts` ; `billing/freight-audit/freight-audit.service.ts` ; `billing/customer-invoices.service.ts` (projection)

**Interfaces:**
- Consumes: `CustomFieldsService` (Task 3, from `CustomFieldsModule`) with the `module` first-arg ; `CustomFieldEntity.INCOMING_CARRIER_INVOICE` / `CUSTOMER_INVOICE` (Task 1).
- Produces: `GET/PUT /billing/custom-fields?entityType=` ; `customData` accepted on freight-audit intake, validated + persisted + projected.

- [ ] **Step 1: Billing custom-fields controller**

Mirror the transportation controller, gated for billing:

```ts
import { Body, Controller, Get, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '@pulsar/shared';
import { CustomFieldEntity, MODULE_KEYS, PERMISSIONS } from '@pulsar/shared';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RequireModule } from '../../../common/decorators/require-module.decorator';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { Audit } from '../../../common/decorators/audit.decorator';
import { AuditAction } from '@pulsar/shared';
import { CustomFieldsService } from '../../../core/custom-fields/custom-fields.service';
import { ReplaceCustomFieldsDto } from '../../transportation/custom-fields/dto/custom-field.dto';

@ApiTags('billing')
@ApiBearerAuth()
@RequireModule(MODULE_KEYS.BILLING)
@Controller('billing/custom-fields')
export class BillingCustomFieldsController {
  constructor(private readonly service: CustomFieldsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.CORE.MODULES_READ)
  list(@CurrentUser() user: AuthUser, @Query('entityType') entityType: CustomFieldEntity) {
    return this.service.listDefinitions('billing', user.tenantId, entityType);
  }

  @Put()
  @Audit('custom-field-definition', AuditAction.UPDATE)
  @RequirePermissions(PERMISSIONS.CORE.MODULES_MANAGE)
  replace(@CurrentUser() user: AuthUser, @Body() dto: ReplaceCustomFieldsDto) {
    return this.service.replaceDefinitions('billing', user.tenantId, dto.entityType, dto.definitions as never);
  }
}
```
> Reuse the `ReplaceCustomFieldsDto` from the transportation custom-fields dto (it's entity-agnostic). If importing across modules is awkward, move that DTO to `core/custom-fields/dto/` and import from there in both controllers (cleaner — do this if the import path is ugly). Confirm decorator import paths from a sibling billing controller.

- [ ] **Step 2: Register in billing.module.ts**

Add `CustomFieldsModule` to `imports`; add `BillingCustomFieldsController` to `controllers`.

- [ ] **Step 3: Accept + validate + persist `customData` on freight-audit intake**

In `freight-audit/dto/freight-audit.dto.ts` `CreateIncomingInvoiceDto`, add `@IsOptional() @IsObject() customData?: Record<string, unknown>;`. In `freight-audit.service.ts` `create(...)`, inject `CustomFieldsService`; before persisting, `const customData = await this.customFields.validateValues('billing', tenantId, CustomFieldEntity.INCOMING_CARRIER_INVOICE, dto.customData, { partial: false });` and include `...(customData !== undefined ? { customData } : {})` in the `prisma.incomingCarrierInvoice.create` data. Ensure GET projections include `customData` (add to `select` if a restricting select is used; if `include`/no select, it's already returned).

- [ ] **Step 4: CustomerInvoice projection (display-only)**

`CustomerInvoice.customData` has no UI input (auto-generated) — ensure the GET list/detail projections for customer invoices include `customData` so defined fields can display. No validation/write path needed in v1 (values come via API/migration only). Note this in the report.

- [ ] **Step 5: Typecheck**

Run: `pnpm typecheck`
Expected: no NEW errors.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/billing apps/api/src/core/custom-fields
git commit -m "feat(api): billing custom-fields definitions + customData on freight-audit intake"
```

---

## Task 6: Web — Billing config + custom-field editor/inputs

**Files:**
- Modify: `apps/web/src/lib/modules/navigation.ts` ; `apps/web/src/routes/(app)/settings/modules/[key]/+page.svelte` ; `apps/web/src/routes/(app)/billing/freight-audit/+page.svelte`

**Interfaces:**
- Consumes: `GET/PUT /modules/billing/settings` (generic ModuleSettings panel, already works) ; `GET/PUT /billing/custom-fields` ; `<CustomFieldsEditor>` + `<CustomFieldInputs>` (from the socle).

- [ ] **Step 1: Billing config nav entry**

In `navigation.ts`, add under the Billing domain a `{ href: '/settings/modules/billing', label: 'Configuration', perm: PERMISSIONS.CORE.MODULES_MANAGE }` link (mirror the transportation/fleet config entries). The generic `<ModuleSettings module="billing" />` panel already renders the new descriptors (enum/boolean/string) — no panel change needed.

- [ ] **Step 2: Mount CustomFieldsEditor for billing**

In `settings/modules/[key]/+page.svelte`, the block that mounts `<CustomFieldsEditor>` for `transportation` — extend it to also mount for `key === 'billing'`, passing the billing entity types (`INCOMING_CARRIER_INVOICE`, `CUSTOMER_INVOICE`) and the `/billing/custom-fields` endpoints. If `<CustomFieldsEditor>` hardcodes the transportation endpoint/entity list, parameterize it by `module` + an entity list prop (confirm — generalize minimally).

- [ ] **Step 3: CustomFieldInputs on freight-audit intake**

In `billing/freight-audit/+page.svelte`, in the manual intake modal: load `INCOMING_CARRIER_INVOICE` definitions (`GET /billing/custom-fields?entityType=INCOMING_CARRIER_INVOICE`), init `let customData = $state<Record<string,unknown>>({})`, render `<CustomFieldInputs definitions bind:data={customData} />` after the native fields, include `customData` in the create POST body, reset on close. Display `customData` values (showInList defs) in the list/detail using the shared `fmtCustomValue` helper from `$lib/format`.

- [ ] **Step 4: Build web**

Run: `pnpm --filter @pulsar/web build`
Expected: build OK (no NEW errors).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src
git commit -m "feat(web): billing config entry + custom-field editor/inputs on freight-audit"
```

---

## Task 7: e2e `billing-configurable` + docs

**Files:**
- Create: `apps/api/test/billing-configurable.e2e-spec.ts`
- Modify: `docs/etat-du-projet.md`, `CLAUDE.md`

**Interfaces:**
- Consumes: everything, over HTTP. Reference harnesses: `tms-configurable.e2e-spec.ts` (settings PUT + custom fields + second tenant via Prisma), and an existing billing e2e if present for the invoice flow.

- [ ] **Step 1: Write the e2e**

Settings via `PUT /modules/billing/settings { settings: {...} }`. Cases:
- `autoSendOnApproval=true`: create a customer with email, draft+approve a customer invoice → status `SENT` (email driver is `log` in CI — assert the status transition, not a real email). With a customer WITHOUT email → approve leaves it `APPROVED` (no error).
- `toleranceMode=MIN`: reconcile a carrier invoice whose gross variance sits between min and max of the tolerance bounds → flagged/disputed under MIN, would be within under MAX (mirror the unit fixtures with real amounts).
- Prefix: `invoiceNumberPrefix='FAC'` → next carrier invoice number starts `FAC-`, counter not reset; `customerInvoiceNumberPrefix='REL'` similarly.
- `defaultCurrency='USD'`: create an invoice with no currency → persisted USD.
- Custom fields: `PUT /billing/custom-fields` a required SELECT on `INCOMING_CARRIER_INVOICE` → freight-audit intake without it = 400 → out-of-options = 400 → valid = 201 and GET returns `customData`. Tenant isolation: second tenant sees `[]` (insert a foreign-tenant definition via Prisma, assert tenant A's GET excludes it — the meaningful pattern).
- Defaults: with nothing configured, existing billing flows unchanged.

Stub `AgentRuntimeService` + `AgentWorkerService` (no-op) if the billing test app boot wakes them (mirror prior suites).

- [ ] **Step 2: Run**

```bash
pnpm db:up && pnpm db:seed
cd apps/api && npx jest --config test/jest-e2e.json --runInBand --testPathPattern="billing-configurable"
```
Expected: green. Then run the full e2e once (`npx jest --config test/jest-e2e.json --runInBand`) and report counts; note known pre-existing flakes (phase13/phase16 cross-suite), don't chase if unrelated.

- [ ] **Step 3: Browser check (best-effort)**

`pnpm dev`, login admin: Réglages → Billing → Configuration (toggle autoSend, set a prefix, define a field on INCOMING_CARRIER_INVOICE) → freight-audit intake shows the field; approve a customer invoice with autoSend on → SENT. (If headless-only, note it; e2e is the guarantee.)

- [ ] **Step 4: Docs**

`docs/etat-du-projet.md`: session line "Billing configurable v1 (arc C — gabarit pour les autres modules)". `CLAUDE.md`: if a new invariant merits it (e.g. "`CustomFieldsService` est générique core, paramétré par `module` ; chaque module branche son contrôleur `<module>/custom-fields`"), add a concise rule (note the cross-branch rule-number collision).

- [ ] **Step 5: Commit**

```bash
git add apps/api/test/billing-configurable.e2e-spec.ts docs/etat-du-projet.md CLAUDE.md
git commit -m "test(api): billing-configurable e2e + docs"
```

---

## Self-review notes (résolu)

- **Spec coverage:** 5 process rules (Task1 descriptors + Task4 application + Task1 reconciliation mode) ; custom fields (Task1 enum + Task2 migration + Task3 generalized service + Task5 billing controller/intake + Task6 web) ; tests (Task1 unit + Task7 e2e). ✔
- **Type consistency:** `evaluateReconciliation(lines, tolerance, mode?)` default MAX (Task1) consumed in Task4. `CustomFieldsService.{list,replace,validate}` gain `module` first-arg (Task3) consumed by transportation (Task3) + billing (Task5). `CustomFieldEntity` values (Task1) used in Task5/Task6. ✔
- **Points à confirmer au fil de l'eau:** Postgres `ALTER TYPE ADD VALUE` transaction restriction (Task2) ; whether `customer-invoices.service` already injects `ModuleSettingsService` (Task3/4) ; `<CustomFieldsEditor>`/`<CustomFieldInputs>` parameterization by module/entity-list (Task6) ; `ReplaceCustomFieldsDto` location (reuse vs move to core, Task5) ; exact `'CAD'` hardcode sites (Task4) ; billing GET projections include customData (Task5).
- **YAGNI:** autoApproveBelowAmount/roundingMode/autoResolutionCode/recoveryCalculation deferred (backlog) ; no custom fields on auto-generated carrier `Invoice` ; CUSTOMER_INVOICE values display/API-only in v1.
- **Stacked-branch hygiene:** branched from `tms-configurable-socle`; Task2 migration must add ONLY `billing_custom_fields` beyond the inherited TMS migration; Task3 touches TMS files but keeps `tms-configurable` e2e green.
