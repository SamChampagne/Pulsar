# Finance — Taxes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Apply multi-rate tax templates to customer (sell-side) and carrier (buy-side) invoices — compute tax, store the breakdown, carry `totalAmount` to net+tax, and split the approval GL entry into net revenue/expense + per-line tax accounts.

**Architecture:** New `TaxTemplate` + `TaxTemplateLine` master in the billing module; a pure `computeTax` helper in `@pulsar/shared`; `taxAmount`/`taxTemplateId`/`taxDetail` columns on both invoice models. A default template auto-applies at draft creation; a `PATCH :id/tax` endpoint overrides/clears it on a DRAFT. The existing best-effort approve auto-post is extended to split the credit/debit across the tax accounts.

**Tech Stack:** NestJS, Prisma/PostgreSQL (`@pulsar/database`), SvelteKit Svelte-5 SPA, `@pulsar/shared`, Vitest (shared unit), Jest+supertest (api e2e seeded DB).

## Global Constraints

- Tenant isolation: filter by `tenantId` from `@CurrentUser()` (rule 1).
- Enums mirrored shared↔Prisma (rule 3); rebuild shared+database after enum/schema changes (rule 7): `pnpm --filter @pulsar/shared build && pnpm --filter @pulsar/database build`.
- Prisma only via `@pulsar/database` (rule 4).
- Every endpoint `@RequirePermissions(...)`; controller `@RequireModule(MODULE_KEYS.BILLING)` (rule 5). New perms `billing.taxes.read|manage` in the catalog.
- Audit on tax application + template mutations (rule 6).
- FK in write payloads validated via OwnershipService (rule 9).
- GL via `LedgerService.post` (best-effort approve auto-post, gated `ledgerAutoPost`), balanced (`isBalanced`), idempotent (rule 41). Tax accounts referenced by template lines MUST exist in the chart (`ensureChart` seeds DEFAULT_CHART).
- Money: `Decimal @db.Decimal(12,2)` (rate is `Decimal(7,4)`); Number only at compute/`isBalanced` boundary; round to 2dp on amounts.
- `totalAmount` = net + taxAmount (GROSS = amount owed); no tax → taxAmount 0, total = net (unchanged). net is recovered as `totalAmount − taxAmount`.
- Web: `$state`+`$effect`+`api<T>()`, components from `$lib/components/ui`, Badge tones from the valid Tone union ONLY, Decimal-as-string coercion. Verify web with `pnpm --filter @pulsar/web typecheck` (svelte-check), NOT just vite build.

---

### Task 1: Shared — TaxTemplateType enum + computeTax + DEFAULT_CHART accounts

**Files:**
- Create: `packages/shared/src/billing/tax.ts`
- Create: `packages/shared/src/billing/tax.spec.ts`
- Modify: `packages/shared/src/billing/ledger.ts` (add 2 chart accounts)
- Modify: `packages/shared/src/index.ts` (re-export `./billing/tax`)

**Interfaces produced:** `enum TaxTemplateType { SALES, PURCHASE }`; `interface TaxLineInput { description; rate; accountCode }`; `interface TaxBreakdownLine { description; rate; accountCode; amount }`; `interface TaxComputation { taxAmount; lines }`; `computeTax(net: number, lines: TaxLineInput[]): TaxComputation`.

- [ ] **Step 1: Failing test**

```ts
// packages/shared/src/billing/tax.spec.ts
import { describe, it, expect } from 'vitest';
import { computeTax, TaxTemplateType } from './tax';

describe('computeTax', () => {
  it('single rate on net', () => {
    const r = computeTax(100, [{ description: 'GST', rate: 5, accountCode: '2100' }]);
    expect(r.taxAmount).toBe(5);
    expect(r.lines).toEqual([{ description: 'GST', rate: 5, accountCode: '2100', amount: 5 }]);
  });
  it('multi-rate flat on net', () => {
    const r = computeTax(100, [
      { description: 'GST', rate: 5, accountCode: '2100' },
      { description: 'QST', rate: 9.975, accountCode: '2100' },
    ]);
    expect(r.lines.map((l) => l.amount)).toEqual([5, 9.98]);
    expect(r.taxAmount).toBe(14.98);
  });
  it('empty lines → zero', () => {
    expect(computeTax(100, [])).toEqual({ taxAmount: 0, lines: [] });
  });
  it('rounds each line to 2dp', () => {
    const r = computeTax(33.33, [{ description: 'GST', rate: 5, accountCode: '2100' }]);
    expect(r.lines[0].amount).toBe(1.67); // 1.6665 → 1.67
  });
  it('enum values', () => {
    expect(TaxTemplateType.SALES).toBe('SALES');
    expect(TaxTemplateType.PURCHASE).toBe('PURCHASE');
  });
});
```

- [ ] **Step 2: Run RED** — `pnpm --filter @pulsar/shared test -- tax` → FAIL (cannot resolve `./tax`).

- [ ] **Step 3: Implement**

```ts
// packages/shared/src/billing/tax.ts
export enum TaxTemplateType { SALES = 'SALES', PURCHASE = 'PURCHASE' }

export interface TaxLineInput { description: string; rate: number; accountCode: string }
export interface TaxBreakdownLine { description: string; rate: number; accountCode: string; amount: number }
export interface TaxComputation { taxAmount: number; lines: TaxBreakdownLine[] }

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

/** v1: every rate applied to the same net base (flat). Each line amount rounded to 2dp. */
export function computeTax(net: number, lines: TaxLineInput[]): TaxComputation {
  const out: TaxBreakdownLine[] = lines.map((l) => ({
    description: l.description,
    rate: l.rate,
    accountCode: l.accountCode,
    amount: round2((net * l.rate) / 100),
  }));
  const taxAmount = round2(out.reduce((s, l) => s + l.amount, 0));
  return { taxAmount, lines: out };
}
```

- [ ] **Step 4: Extend DEFAULT_CHART** — in `packages/shared/src/billing/ledger.ts`, add to the `DEFAULT_CHART` array (after the existing entries):

```ts
  { code: '1010', name: 'Banque', type: AccountType.ASSET },
  { code: '1150', name: 'Taxes à recouvrer', type: AccountType.ASSET },
```
(`1010` closes a latent gap: the Payments "Banque" mode references account 1010, which was missing from the chart. `1150` is the purchase input-tax account. SALES tax uses the existing `2100 Taxes à payer`.)

- [ ] **Step 5: Re-export** — in `packages/shared/src/index.ts` add `export * from './billing/tax';` next to the other `./billing/*` exports.

- [ ] **Step 6: Run GREEN + build** — `pnpm --filter @pulsar/shared test -- tax` (5 pass) then `pnpm --filter @pulsar/shared build` (exit 0).

- [ ] **Step 7: Commit**
```bash
git add packages/shared/src/billing/tax.ts packages/shared/src/billing/tax.spec.ts packages/shared/src/billing/ledger.ts packages/shared/src/index.ts
git commit -m "feat(shared): TaxTemplateType + computeTax + chart accounts (1010 bank, 1150 input tax)"
```

---

### Task 2: Shared — billing.taxes permissions

**Files:** Modify `packages/shared/src/permissions.ts`.
**Produces:** `PERMISSIONS.BILLING.TAXES_READ='billing.taxes.read'`, `TAXES_MANAGE='billing.taxes.manage'`.

- [ ] **Step 1:** In the `BILLING:` block add:
```ts
    TAXES_READ: 'billing.taxes.read',
    TAXES_MANAGE: 'billing.taxes.manage',
```
- [ ] **Step 2:** In the `billing(...)` catalog list add:
```ts
  billing(PERMISSIONS.BILLING.TAXES_READ, 'View tax templates'),
  billing(PERMISSIONS.BILLING.TAXES_MANAGE, 'Manage tax templates'),
```
- [ ] **Step 3:** `pnpm --filter @pulsar/shared build` (exit 0).
- [ ] **Step 4: Commit**
```bash
git add packages/shared/src/permissions.ts
git commit -m "feat(shared): billing.taxes.read|manage permissions"
```

---

### Task 3: Database — TaxTemplate models + invoice tax columns + migration

**Files:** Modify `packages/database/prisma/schema.prisma`; generated migration.
**Produces:** tables `tax_templates`, `tax_template_lines`; columns `customer_invoices.tax_amount/tax_template_id/tax_detail`, `invoices.tax_amount/tax_template_id/tax_detail`.

- [ ] **Step 1: Enum (mirror shared)**
```prisma
enum TaxTemplateType { SALES  PURCHASE }
```
- [ ] **Step 2: Models** (verbatim from the spec's Prisma block — `TaxTemplate` + `TaxTemplateLine`, `rate Decimal @db.Decimal(7,4)`, cascade line→template, `@@unique([tenantId, name])`, indexes, `@@map`).
- [ ] **Step 3: Invoice columns** — after `amountPaid` on BOTH `CustomerInvoice` and `Invoice`:
```prisma
  taxAmount     Decimal       @default(0) @db.Decimal(12, 2)
  taxTemplateId String?
  taxDetail     Json?
```
- [ ] **Step 4: Tenant back-relation** — add `taxTemplates TaxTemplate[]` to `model Tenant`.
- [ ] **Step 5: Migrate** — `pnpm db:up` then `pnpm db:migrate -- --name finance_taxes` (additive; new tables + nullable/defaulted columns).
- [ ] **Step 6: Build client** — `pnpm --filter @pulsar/database build` (exit 0).
- [ ] **Step 7: Commit**
```bash
git add packages/database/prisma/schema.prisma packages/database/prisma/migrations
git commit -m "feat(db): TaxTemplate/TaxTemplateLine + invoice tax columns"
```

---

### Task 4: API — TaxTemplatesService + controller + DTO + module wiring + seed

**Files:**
- Create: `apps/api/src/modules/billing/tax-templates.service.ts`, `tax-templates.controller.ts`, `dto/tax-template.dto.ts`
- Modify: `apps/api/src/modules/billing/billing.module.ts`
- Modify: `packages/database/prisma/seed.ts`

**Produces:** `TaxTemplatesService.{list,get,create,update,remove,resolveDefault(tenantId,type),getWithLines(tenantId,id)}`.

- [ ] **Step 1: DTO**
```ts
// apps/api/src/modules/billing/dto/tax-template.dto.ts
import { PartialType } from '@nestjs/swagger';
import { TaxTemplateType } from '@pulsar/shared';
import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsBoolean, IsEnum, IsInt, IsNumber, IsOptional, IsString, Length, Matches, Min, ValidateNested } from 'class-validator';

export class TaxTemplateLineDto {
  @IsString() @Length(1, 60) description!: string;
  @IsNumber() @Min(0) rate!: number;
  @IsString() @Matches(/^[0-9A-Z]{1,10}$/) accountCode!: string;
  @IsOptional() @IsInt() sortOrder?: number;
}
export class CreateTaxTemplateDto {
  @IsString() @Length(1, 80) name!: string;
  @IsEnum(TaxTemplateType) type!: TaxTemplateType;
  @IsOptional() @IsBoolean() isDefault?: boolean;
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => TaxTemplateLineDto) lines!: TaxTemplateLineDto[];
}
export class UpdateTaxTemplateDto extends PartialType(CreateTaxTemplateDto) {}
```

- [ ] **Step 2: Service** — tenant-scoped CRUD; on create/update with `isDefault: true`, clear `isDefault` on other templates of the SAME type (in a transaction); lines replaced on update; `resolveDefault(tenantId, type)` returns the default template (with lines) or null.

```ts
// apps/api/src/modules/billing/tax-templates.service.ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { TaxTemplateType } from '@pulsar/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateTaxTemplateDto, UpdateTaxTemplateDto } from './dto/tax-template.dto';

@Injectable()
export class TaxTemplatesService {
  constructor(private readonly prisma: PrismaService) {}

  list(tenantId: string, type?: TaxTemplateType) {
    return this.prisma.taxTemplate.findMany({ where: { tenantId, type }, include: { lines: { orderBy: { sortOrder: 'asc' } } }, orderBy: { name: 'asc' } });
  }
  async get(tenantId: string, id: string) {
    const t = await this.prisma.taxTemplate.findFirst({ where: { id, tenantId }, include: { lines: { orderBy: { sortOrder: 'asc' } } } });
    if (!t) throw new NotFoundException('Tax template not found');
    return t;
  }
  resolveDefault(tenantId: string, type: TaxTemplateType) {
    return this.prisma.taxTemplate.findFirst({ where: { tenantId, type, isDefault: true }, include: { lines: { orderBy: { sortOrder: 'asc' } } } });
  }
  async create(tenantId: string, dto: CreateTaxTemplateDto) {
    return this.prisma.$transaction(async (tx) => {
      if (dto.isDefault) await tx.taxTemplate.updateMany({ where: { tenantId, type: dto.type }, data: { isDefault: false } });
      return tx.taxTemplate.create({
        data: { tenantId, name: dto.name, type: dto.type, isDefault: dto.isDefault ?? false,
          lines: { create: dto.lines.map((l, i) => ({ tenantId, description: l.description, rate: l.rate, accountCode: l.accountCode, sortOrder: l.sortOrder ?? i })) } },
        include: { lines: { orderBy: { sortOrder: 'asc' } } },
      });
    });
  }
  async update(tenantId: string, id: string, dto: UpdateTaxTemplateDto) {
    const existing = await this.prisma.taxTemplate.findFirst({ where: { id, tenantId }, select: { id: true, type: true } });
    if (!existing) throw new NotFoundException('Tax template not found');
    const type = dto.type ?? existing.type;
    return this.prisma.$transaction(async (tx) => {
      if (dto.isDefault) await tx.taxTemplate.updateMany({ where: { tenantId, type }, data: { isDefault: false } });
      if (dto.lines) {
        await tx.taxTemplateLine.deleteMany({ where: { templateId: id } });
        await tx.taxTemplateLine.createMany({ data: dto.lines.map((l, i) => ({ tenantId, templateId: id, description: l.description, rate: l.rate, accountCode: l.accountCode, sortOrder: l.sortOrder ?? i })) });
      }
      return tx.taxTemplate.update({
        where: { id },
        data: { name: dto.name, type: dto.type, isDefault: dto.isDefault },
        include: { lines: { orderBy: { sortOrder: 'asc' } } },
      });
    });
  }
  async remove(tenantId: string, id: string) {
    const found = await this.prisma.taxTemplate.findFirst({ where: { id, tenantId }, select: { id: true } });
    if (!found) throw new NotFoundException('Tax template not found');
    await this.prisma.taxTemplate.delete({ where: { id } });
    return { deleted: true };
  }
}
```

- [ ] **Step 3: Controller** — `@Controller('billing/tax-templates')`, `@RequireModule(MODULE_KEYS.BILLING)`; GET list/`:id` → `TAXES_READ`; POST/PATCH/DELETE → `TAXES_MANAGE`. Mirror the ModesOfPaymentController shape (CurrentUser, decorators).

- [ ] **Step 4: Wire BillingModule** — add controller to `controllers`, service to `providers` + `exports` (consumed by the invoice services).

- [ ] **Step 5: Seed** — in `seed.ts`, upsert SALES templates (`Canada GST 5%` default → line GST 5 → '2100'; `Canada HST 15%` → HST 15 → '2100'; `Québec GST+QST` → GST 5 + QST 9.975 → '2100') and a PURCHASE default (`Achat GST 5%` → GST 5 → '1150') for the acme tenant. Upsert on `(tenantId, name)`; recreate lines each run (deleteMany by templateId then create) for idempotence. Also run the chart seed so `1010`/`1150` exist (the existing `DEFAULT_CHART` seed loop will pick them up).

- [ ] **Step 6: Verify** — `pnpm --filter @pulsar/api typecheck` (0) then `pnpm db:seed` (templates + new accounts upserted).

- [ ] **Step 7: Commit**
```bash
git add apps/api/src/modules/billing/tax-templates.* apps/api/src/modules/billing/dto/tax-template.dto.ts apps/api/src/modules/billing/billing.module.ts packages/database/prisma/seed.ts
git commit -m "feat(api): TaxTemplate CRUD + seed (Canada GST/HST/QST) + chart accounts"
```

---

### Task 5: API — apply tax to CUSTOMER invoices + split approve GL

**Files:** Modify `apps/api/src/modules/billing/customer-invoices.service.ts`, `customer-invoices.controller.ts`.

- [ ] **Step 1: Inject** `TaxTemplatesService` into `CustomerInvoicesService`.
- [ ] **Step 2: createDraft UNCHANGED** — do NOT auto-apply any tax at draft creation. Invoices are created tax-free (taxAmount 0, total = net). Tax is applied ONLY via the explicit endpoint below. (This keeps every existing invoice/GL total unchanged — no e2e ripple.)
- [ ] **Step 3: applyTax method + endpoint** — `applyTax(tenantId, userId, id, taxTemplateId | null)`: load DRAFT (else 400); `net = Number(totalAmount) - Number(taxAmount)`; if null → clear (taxAmount 0, taxDetail null, taxTemplateId null, total = net); else load template (ownership, must be SALES type else 400), recompute, write; audit. Controller: `PATCH :id/tax` body `{ taxTemplateId: string | null }`, gated `CUSTOMER_INVOICES_MANAGE`.
- [ ] **Step 4: Split approve GL** — in `approve`, replace the single `CR Revenue = amount` with: `Dr AR = totalAmount`; `Cr Revenue = totalAmount - taxAmount`; for each line in `taxDetail.lines` (guard taxDetail shape): `Cr line.accountCode = line.amount`. Keep `sourceType/sourceId/sourceKind='approved'`, best-effort try/catch, `ledgerAutoPost` gate. When taxAmount 0 / no taxDetail, behavior is unchanged (CR Revenue = total).
- [ ] **Step 5: Verify** — `pnpm --filter @pulsar/api typecheck` (0) + `pnpm --filter @pulsar/api build` (0).
- [ ] **Step 6: Commit**
```bash
git add apps/api/src/modules/billing/customer-invoices.service.ts apps/api/src/modules/billing/customer-invoices.controller.ts
git commit -m "feat(api): apply tax to customer invoices + split approve GL (revenue/tax)"
```

---

### Task 6: API — apply tax to CARRIER invoices + split approve GL

**Files:** Modify `apps/api/src/modules/billing/invoices.service.ts`, `invoices.controller.ts`.

- [ ] **Step 1: Inject** `TaxTemplatesService` into `InvoicesService`.
- [ ] **Step 2: draft creation UNCHANGED** — no auto-apply. Carrier invoices created tax-free; tax applied only via the explicit endpoint below.
- [ ] **Step 3: applyTax method + endpoint** — `PATCH /billing/invoices/:id/tax` body `{ taxTemplateId: string | null }`, DRAFT-only, template must be PURCHASE type, gated `INVOICES_MANAGE`; recompute net = total − taxAmount; audit.
- [ ] **Step 4: Split approve GL** — in the carrier approve auto-post: `Dr Expense = totalAmount - taxAmount`; for each `taxDetail.lines`: `Dr line.accountCode = line.amount`; `Cr AP = totalAmount`. Keep idempotence/source/best-effort. taxAmount 0 → unchanged (Dr Expense = total / Cr AP = total).
- [ ] **Step 5: Verify** — typecheck + build (0).
- [ ] **Step 6: Commit**
```bash
git add apps/api/src/modules/billing/invoices.service.ts apps/api/src/modules/billing/invoices.controller.ts
git commit -m "feat(api): apply tax to carrier invoices + split approve GL (expense/input-tax/AP)"
```

---

### Task 7: API — taxes e2e

**Files:** Create `apps/api/test/taxes.e2e-spec.ts`.

- [ ] **Step 1:** Mirror `billing-ledger.e2e-spec.ts` bootstrap. Cover:
  1. Create a SALES template (GST 5% → 2100) via `POST /billing/tax-templates`.
  2. Create a customer invoice with net 100 (existing creation path) → assert it starts tax-free (taxAmount 0, total 100); then `PATCH :id/tax {taxTemplateId}` → assert taxAmount=5, total=105.
  3. Approve → assert a balanced `sourceType='customer-invoice' sourceKind='approved'` GL entry: AR(1100) debit 105, Revenue(4000) credit 100, Tax(2100) credit 5.
  4. `PATCH :id/tax {taxTemplateId:null}` on a fresh DRAFT → taxAmount 0, total 100.
  5. Type mismatch: applying a PURCHASE template to a customer invoice → 400.
  6. Carrier invoice symmetric: PURCHASE template (GST 5% → 1150), approve → Expense(5000) debit net, Tax(1150) debit, AP(2000) credit gross.
  7. Tenant isolation: second tenant 404 on the first tenant's template.
- [ ] **Step 2:** Run `pnpm --filter @pulsar/api test:e2e -- taxes` (DB up+seeded). All pass. If a clean bootstrap is impossible, report BLOCKED — never a hollow/skipped test.
- [ ] **Step 3: Commit**
```bash
git add apps/api/test/taxes.e2e-spec.ts
git commit -m "test(api): taxes e2e (apply/split-GL/clear/type-mismatch/isolation)"
```

---

### Task 8: Web — tax templates management in config

**Files:** Create `apps/web/src/lib/components/billing/TaxTemplates.svelte`; modify `apps/web/src/routes/(app)/billing/config/+page.svelte`.

- [ ] **Step 1:** CRUD component over `/billing/tax-templates`: list (name, type badge, default badge, rows summary), create/edit modal with a repeatable line editor (description/rate/accountCode), delete confirm. Mirror `ModesOfPayment.svelte` for idiom; valid Badge tones only; Number-coerce `rate`.
- [ ] **Step 2:** Mount `<TaxTemplates />` on the billing config page below `ModesOfPayment` (`<div class="mt-6">`).
- [ ] **Step 3:** `pnpm --filter @pulsar/web typecheck` (0 errors).
- [ ] **Step 4: Commit**
```bash
git add "apps/web/src/lib/components/billing/TaxTemplates.svelte" "apps/web/src/routes/(app)/billing/config/+page.svelte"
git commit -m "feat(web): manage tax templates in billing config"
```

---

### Task 9: Web — tax breakdown + selector on customer invoice page

**Files:** Modify `apps/web/src/routes/(app)/invoices/+page.svelte` (customer statements list/detail) OR the dedicated customer-invoice page if separate — locate the page that renders customer statements first.

- [ ] **Step 1:** Display net / tax (breakdown rows from `taxDetail`) / total on the statement view. On a DRAFT, render a tax-template `<Select>` (options from `GET /billing/tax-templates?type=SALES`, plus an "Aucune" option) that calls `PATCH /billing/customer-invoices/:id/tax { taxTemplateId }` and reloads. Number-coerce Decimals.
- [ ] **Step 2:** `pnpm --filter @pulsar/web typecheck` (0).
- [ ] **Step 3: Commit**
```bash
git commit -m "feat(web): customer invoice tax breakdown + template selector"
```

---

### Task 10: Web — tax breakdown + selector on carrier invoice page

**Files:** Modify the carrier invoice page (`apps/web/src/routes/(app)/invoices/+page.svelte` or its detail — locate it).

- [ ] **Step 1:** Same as Task 9 but for carrier invoices: breakdown + `type=PURCHASE` template selector calling `PATCH /billing/invoices/:id/tax`. DRAFT-only.
- [ ] **Step 2:** typecheck 0.
- [ ] **Step 3: Commit**
```bash
git commit -m "feat(web): carrier invoice tax breakdown + template selector"
```

---

### Task 11: Final verification + docs

- [ ] **Step 1:** `pnpm typecheck` (0), `pnpm test` (shared incl tax.spec green).
- [ ] **Step 2:** `pnpm db:up && pnpm db:migrate && pnpm db:seed && pnpm --filter @pulsar/api test:e2e` — full suite. Because tax is NEVER auto-applied (explicit PATCH only), existing invoice/GL totals are unchanged — there should be NO regression in phase6/phase7-3/billing-ledger. If any suite DOES break, treat it as a real regression to investigate (not an expected re-point). Confirm any pre-existing flake in isolation.
- [ ] **Step 3:** Docs: CLAUDE.md "Hard rules (continued)" entry 43 for Taxes (tax via TaxTemplate; computeTax pure; totalAmount = net+tax; approve GL split revenue/expense + per-line tax account; tax accounts must exist in chart). Note in `docs/etat-du-projet.md`.
- [ ] **Step 4:** Commit fixups + docs.

---

## Self-Review notes (author)
- Coverage: enum+helper+chart (T1), perms (T2), models (T3), CRUD+seed (T4), customer apply+GL (T5), carrier apply+GL (T6), e2e (T7), web config+invoice UIs (T8-10), verify+docs (T11). All spec sections mapped. Item-tax/tax-rules/withholding/compound-tax explicitly deferred.
- **Decision (no auto-apply):** tax is applied ONLY via the explicit `PATCH :id/tax` endpoint; createDraft never auto-applies, so existing invoices/GL/totals are unchanged and NO existing e2e suite should break. `isDefault` is a UI pre-selection hint only. This deliberately trades a small bit of "magic" for a tiny blast radius — the right call for a financial total.
- Type consistency: `computeTax` signature + `TaxComputation` shape consumed identically in T5/T6; `resolveDefault(tenantId,type)` produced in T4 consumed in T5/T6.
