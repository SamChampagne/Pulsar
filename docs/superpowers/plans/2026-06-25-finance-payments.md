# Finance — Paiements (Payment Entry) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a first-class Payment Entry to the Billing module — payments (customer receipts / carrier payments) allocated across one or more open invoices, posted to the double-entry ledger, with per-invoice outstanding tracking.

**Architecture:** New `Payment` + `PaymentAllocation` entities and a small `ModeOfPayment` master in the existing `billing` module. Submitting a payment posts a balanced journal entry through the existing `LedgerService.post` (idempotent, transactional with the submit) and increments each allocated invoice's `amountPaid`; cancelling posts a reversing entry. The legacy `mark-paid`/`pay` endpoints are rewritten to create a full-allocation Payment so there is a single accounting path.

**Tech Stack:** NestJS (API), Prisma/PostgreSQL (`@pulsar/database`), SvelteKit Svelte-5-runes SPA (web), `@pulsar/shared` (enums, state machines, permission/config catalogs), Vitest (shared unit tests), Jest+supertest (API e2e against a seeded DB).

## Global Constraints

- Tenant isolation: every query filters by `tenantId` from `@CurrentUser()` (rule 1).
- Status changes ONLY via `canTransitionPayment` (`@pulsar/shared/workflows`) + conditional `updateMany` claim (rule 2).
- Enums live in `@pulsar/shared` and are mirrored verbatim in `schema.prisma` (rule 3). Rebuild shared + database after changing them (rule 7): `pnpm --filter @pulsar/shared build && pnpm --filter @pulsar/database build`.
- Apps import Prisma via `@pulsar/database`, never `@prisma/client` (rule 4).
- Every endpoint carries `@RequirePermissions(...)`; the controller carries `@RequireModule(MODULE_KEYS.BILLING)` (rule 5). New permission keys go in `packages/shared/src/permissions.ts` (rule 5).
- Sensitive mutations call `AuditLogsService.log()` (rule 6).
- Document numbers via `SequencesService.nextNumber()` (rule 8); the counter is keyed on the SequenceKey, never the prefix.
- Foreign keys in write payloads validated with `OwnershipService.assertOwned(IfSet)` (rule 9).
- GL posts go through `LedgerService.post`, balanced (`isBalanced`), idempotent on `(tenantId, sourceType, sourceId, sourceKind)` (rule 41).
- Money columns are `Decimal @db.Decimal(12,2)`; convert `Decimal→Number` only at the `isBalanced`/JSON boundary.
- Web pages follow the existing pattern: `$state` + `$effect`-triggered `load()`, `api<T>()` from `$lib/api/client`, components from `$lib/components/ui`, toasts from `$lib/stores/toast`.
- Prettier only (`pnpm format`). Verify with `pnpm --filter @pulsar/api typecheck` and `pnpm --filter @pulsar/web typecheck` (web script is `typecheck`, not `check`).

---

### Task 1: Shared — payment enums + state machine

**Files:**
- Create: `packages/shared/src/billing/payment.workflow.ts`
- Create: `packages/shared/src/billing/payment.workflow.spec.ts`
- Modify: `packages/shared/src/index.ts` (re-export the new module)

**Interfaces:**
- Produces: `enum PaymentType { RECEIVE, PAY }`, `enum PaymentStatus { DRAFT, SUBMITTED, CANCELLED }`, `enum PaymentPartyType { CUSTOMER, CARRIER }`, `enum PaymentTargetType { CUSTOMER_INVOICE, CARRIER_INVOICE }`, `canTransitionPayment(from, to): boolean`, `isPaymentOpen(s): boolean`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/shared/src/billing/payment.workflow.spec.ts
import { describe, it, expect } from 'vitest';
import { PaymentStatus, canTransitionPayment, isPaymentOpen } from './payment.workflow';

describe('canTransitionPayment', () => {
  it('DRAFT → SUBMITTED and DRAFT → CANCELLED', () => {
    expect(canTransitionPayment(PaymentStatus.DRAFT, PaymentStatus.SUBMITTED)).toBe(true);
    expect(canTransitionPayment(PaymentStatus.DRAFT, PaymentStatus.CANCELLED)).toBe(true);
  });
  it('SUBMITTED → CANCELLED only', () => {
    expect(canTransitionPayment(PaymentStatus.SUBMITTED, PaymentStatus.CANCELLED)).toBe(true);
    expect(canTransitionPayment(PaymentStatus.SUBMITTED, PaymentStatus.DRAFT)).toBe(false);
  });
  it('CANCELLED is terminal', () => {
    expect(canTransitionPayment(PaymentStatus.CANCELLED, PaymentStatus.SUBMITTED)).toBe(false);
    expect(canTransitionPayment(PaymentStatus.CANCELLED, PaymentStatus.DRAFT)).toBe(false);
  });
  it('isPaymentOpen true only for DRAFT/SUBMITTED', () => {
    expect(isPaymentOpen(PaymentStatus.DRAFT)).toBe(true);
    expect(isPaymentOpen(PaymentStatus.SUBMITTED)).toBe(true);
    expect(isPaymentOpen(PaymentStatus.CANCELLED)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @pulsar/shared test -- payment.workflow`
Expected: FAIL — cannot resolve `./payment.workflow`.

- [ ] **Step 3: Write the implementation**

```ts
// packages/shared/src/billing/payment.workflow.ts
export enum PaymentType { RECEIVE = 'RECEIVE', PAY = 'PAY' }
export enum PaymentStatus { DRAFT = 'DRAFT', SUBMITTED = 'SUBMITTED', CANCELLED = 'CANCELLED' }
export enum PaymentPartyType { CUSTOMER = 'CUSTOMER', CARRIER = 'CARRIER' }
export enum PaymentTargetType { CUSTOMER_INVOICE = 'CUSTOMER_INVOICE', CARRIER_INVOICE = 'CARRIER_INVOICE' }

export const PAYMENT_TRANSITIONS: Record<PaymentStatus, PaymentStatus[]> = {
  [PaymentStatus.DRAFT]: [PaymentStatus.SUBMITTED, PaymentStatus.CANCELLED],
  [PaymentStatus.SUBMITTED]: [PaymentStatus.CANCELLED],
  [PaymentStatus.CANCELLED]: [],
};

export function canTransitionPayment(from: PaymentStatus, to: PaymentStatus): boolean {
  return PAYMENT_TRANSITIONS[from]?.includes(to) ?? false;
}

/** Open = not in a terminal state (CANCELLED). */
export function isPaymentOpen(s: PaymentStatus): boolean {
  return s !== PaymentStatus.CANCELLED;
}
```

- [ ] **Step 4: Re-export from the package index**

In `packages/shared/src/index.ts`, add alongside the other billing/workflow exports:

```ts
export * from './billing/payment.workflow';
```

(If a `./billing` barrel already exists, add the line there and ensure it is re-exported from `index.ts`. Confirm with `grep -n "payment.workflow\|/billing" packages/shared/src/index.ts`.)

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @pulsar/shared test -- payment.workflow`
Expected: PASS (4 tests).

- [ ] **Step 6: Build shared**

Run: `pnpm --filter @pulsar/shared build`
Expected: `tsc` exits 0.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/billing/payment.workflow.ts packages/shared/src/billing/payment.workflow.spec.ts packages/shared/src/index.ts
git commit -m "feat(shared): payment enums + canTransitionPayment state machine"
```

---

### Task 2: Shared — permissions, billing config (bankAccountCode, paymentNumberPrefix)

**Files:**
- Modify: `packages/shared/src/permissions.ts`
- Modify: `packages/shared/src/config/module-settings.ts`

**Interfaces:**
- Produces: `PERMISSIONS.BILLING.PAYMENTS_READ = 'billing.payments.read'`, `PERMISSIONS.BILLING.PAYMENTS_MANAGE = 'billing.payments.manage'`; billing settings `bankAccountCode` (default `'1010'`) and `paymentNumberPrefix` (default `'PAY'`).

- [ ] **Step 1: Add permission keys**

In `packages/shared/src/permissions.ts`, inside the `BILLING:` block (after `LEDGER_MANAGE`):

```ts
    PAYMENTS_READ: 'billing.payments.read',
    PAYMENTS_MANAGE: 'billing.payments.manage',
```

- [ ] **Step 2: Add them to the catalog list**

In the same file, in the `billing(...)` catalog section (after the customer-invoice entries):

```ts
  billing(PERMISSIONS.BILLING.PAYMENTS_READ, 'View payments'),
  billing(PERMISSIONS.BILLING.PAYMENTS_MANAGE, 'Record and submit payments'),
```

- [ ] **Step 3: Add billing config settings**

In `packages/shared/src/config/module-settings.ts`, inside the `billing` settings array (after `expenseAccountCode`):

```ts
      { key: 'bankAccountCode', label: 'Compte bancaire', type: 'string', default: '1010', pattern: '^[0-9A-Z]{1,10}$', maxLength: 10 },
      { key: 'paymentNumberPrefix', label: 'Préfixe n° paiement', type: 'string', default: 'PAY', pattern: '^[A-Z0-9]{1,6}$', maxLength: 6 },
```

- [ ] **Step 4: Build shared**

Run: `pnpm --filter @pulsar/shared build`
Expected: exits 0.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/permissions.ts packages/shared/src/config/module-settings.ts
git commit -m "feat(shared): billing.payments perms + bankAccountCode/paymentNumberPrefix config"
```

---

### Task 3: Database — Prisma models + amountPaid + migration

**Files:**
- Modify: `packages/database/prisma/schema.prisma`
- Migration: `packages/database/prisma/migrations/<timestamp>_finance_payments/migration.sql` (generated)

**Interfaces:**
- Produces: tables `payments`, `payment_allocations`, `modes_of_payment`; columns `invoices.amount_paid`, `customer_invoices.amount_paid`; Prisma client models `Payment`, `PaymentAllocation`, `ModeOfPayment`.

- [ ] **Step 1: Add enums (mirror shared verbatim)**

In `schema.prisma`, near the other billing enums:

```prisma
enum PaymentType      { RECEIVE  PAY }
enum PaymentStatus    { DRAFT  SUBMITTED  CANCELLED }
enum PaymentPartyType { CUSTOMER  CARRIER }
enum PaymentTargetType { CUSTOMER_INVOICE  CARRIER_INVOICE }
```

- [ ] **Step 2: Add the models** (verbatim from the spec)

```prisma
model ModeOfPayment {
  id          String    @id @default(cuid())
  tenantId    String
  name        String
  accountCode String
  isDefault   Boolean   @default(false)
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt
  tenant      Tenant    @relation(fields: [tenantId], references: [id])
  payments    Payment[]
  @@unique([tenantId, name])
  @@index([tenantId])
  @@map("modes_of_payment")
}

model Payment {
  id              String              @id @default(cuid())
  tenantId        String
  paymentNumber   String
  type            PaymentType
  status          PaymentStatus       @default(DRAFT)
  partyType       PaymentPartyType
  partyId         String
  modeOfPaymentId String
  date            DateTime
  currency        String              @default("CAD")
  totalAmount     Decimal             @db.Decimal(12, 2)
  reference       String?
  note            String?
  submittedAt     DateTime?
  cancelledAt     DateTime?
  createdById     String?
  createdAt       DateTime            @default(now())
  updatedAt       DateTime            @updatedAt
  tenant          Tenant              @relation(fields: [tenantId], references: [id])
  modeOfPayment   ModeOfPayment       @relation(fields: [modeOfPaymentId], references: [id])
  allocations     PaymentAllocation[]
  @@unique([tenantId, paymentNumber])
  @@index([tenantId, status])
  @@index([tenantId, partyType, partyId])
  @@map("payments")
}

model PaymentAllocation {
  id         String            @id @default(cuid())
  tenantId   String
  paymentId  String
  targetType PaymentTargetType
  targetId   String
  amount     Decimal           @db.Decimal(12, 2)
  payment    Payment           @relation(fields: [paymentId], references: [id], onDelete: Cascade)
  @@index([tenantId, targetType, targetId])
  @@index([tenantId, paymentId])
  @@map("payment_allocations")
}
```

- [ ] **Step 3: Add `amountPaid` to both invoice models**

In `model Invoice` (after `totalAmount`):
```prisma
  amountPaid    Decimal       @default(0) @db.Decimal(12, 2)
```
In `model CustomerInvoice` (after `totalAmount`):
```prisma
  amountPaid    Decimal               @default(0) @db.Decimal(12, 2)
```

- [ ] **Step 4: Add back-relations on `Tenant`**

In `model Tenant`, add to the relation list:
```prisma
  payments        Payment[]
  modesOfPayment  ModeOfPayment[]
```

- [ ] **Step 5: Create and apply the migration**

Run (from repo root, DB up via `pnpm db:up`):
`pnpm db:migrate -- --name finance_payments`
Expected: migration created and applied, no drift.

- [ ] **Step 6: Build database package (regen client)**

Run: `pnpm --filter @pulsar/database build`
Expected: exits 0; `Payment`, `ModeOfPayment`, `PaymentAllocation` available on the client.

- [ ] **Step 7: Commit**

```bash
git add packages/database/prisma/schema.prisma packages/database/prisma/migrations
git commit -m "feat(db): Payment/PaymentAllocation/ModeOfPayment + invoice amountPaid"
```

---

### Task 4: API — register the `payment` sequence key

**Files:**
- Modify: `apps/api/src/prisma/sequences.service.ts`

**Interfaces:**
- Produces: `SequencesService.nextNumber(tenantId, 'payment')` → `PAY-000001` (prefix overridable by billing `paymentNumberPrefix`).

- [ ] **Step 1: Extend the union, prefixes, and setting map**

Add `| 'payment'` to the `SequenceKey` union; add `payment: 'PAY',` to `PREFIXES`; add to `PREFIX_SETTING`:
```ts
  payment: { module: 'billing', settingKey: 'paymentNumberPrefix' },
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @pulsar/api typecheck`
Expected: exits 0 (the `Record<SequenceKey, string>` for PREFIXES forces you to add the key).

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/prisma/sequences.service.ts
git commit -m "feat(api): payment sequence key (PAY-, configurable prefix)"
```

---

### Task 5: API — ModeOfPayment master (service + controller) + seed defaults

**Files:**
- Create: `apps/api/src/modules/billing/modes-of-payment.service.ts`
- Create: `apps/api/src/modules/billing/modes-of-payment.controller.ts`
- Create: `apps/api/src/modules/billing/dto/mode-of-payment.dto.ts`
- Modify: `apps/api/src/modules/billing/billing.module.ts`
- Modify: `packages/database/prisma/seed.ts` (default modes for tenant `acme`)

**Interfaces:**
- Produces: `ModesOfPaymentService.list(tenantId)`, `.create(tenantId, dto)`, `.update(tenantId, id, dto)`, `.remove(tenantId, id)`, `.resolveAccountCode(tenantId, modeId): Promise<string>`.

- [ ] **Step 1: DTOs**

```ts
// apps/api/src/modules/billing/dto/mode-of-payment.dto.ts
import { PartialType } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, Length, Matches } from 'class-validator';

export class CreateModeOfPaymentDto {
  @IsString() @Length(1, 60) name!: string;
  @IsString() @Matches(/^[0-9A-Z]{1,10}$/) accountCode!: string;
  @IsOptional() @IsBoolean() isDefault?: boolean;
}
export class UpdateModeOfPaymentDto extends PartialType(CreateModeOfPaymentDto) {}
```

- [ ] **Step 2: Service**

```ts
// apps/api/src/modules/billing/modes-of-payment.service.ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateModeOfPaymentDto, UpdateModeOfPaymentDto } from './dto/mode-of-payment.dto';

@Injectable()
export class ModesOfPaymentService {
  constructor(private readonly prisma: PrismaService) {}

  list(tenantId: string) {
    return this.prisma.modeOfPayment.findMany({ where: { tenantId }, orderBy: { name: 'asc' } });
  }

  create(tenantId: string, dto: CreateModeOfPaymentDto) {
    return this.prisma.modeOfPayment.create({ data: { tenantId, ...dto } });
  }

  async update(tenantId: string, id: string, dto: UpdateModeOfPaymentDto) {
    const found = await this.prisma.modeOfPayment.findFirst({ where: { id, tenantId }, select: { id: true } });
    if (!found) throw new NotFoundException('Mode of payment not found');
    return this.prisma.modeOfPayment.update({ where: { id }, data: dto });
  }

  async remove(tenantId: string, id: string) {
    const found = await this.prisma.modeOfPayment.findFirst({ where: { id, tenantId }, select: { id: true } });
    if (!found) throw new NotFoundException('Mode of payment not found');
    await this.prisma.modeOfPayment.delete({ where: { id } });
    return { deleted: true };
  }

  async resolveAccountCode(tenantId: string, modeId: string): Promise<string> {
    const mode = await this.prisma.modeOfPayment.findFirst({ where: { id: modeId, tenantId }, select: { accountCode: true } });
    if (!mode) throw new NotFoundException('Mode of payment not found');
    return mode.accountCode;
  }
}
```

- [ ] **Step 3: Controller**

```ts
// apps/api/src/modules/billing/modes-of-payment.controller.ts
import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '@pulsar/shared';
import { MODULE_KEYS, PERMISSIONS } from '@pulsar/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequireModule } from '../../common/decorators/require-module.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CreateModeOfPaymentDto, UpdateModeOfPaymentDto } from './dto/mode-of-payment.dto';
import { ModesOfPaymentService } from './modes-of-payment.service';

@ApiTags('billing')
@ApiBearerAuth()
@RequireModule(MODULE_KEYS.BILLING)
@Controller('billing/modes-of-payment')
export class ModesOfPaymentController {
  constructor(private readonly service: ModesOfPaymentService) {}

  @Get() @RequirePermissions(PERMISSIONS.BILLING.PAYMENTS_READ)
  list(@CurrentUser() user: AuthUser) { return this.service.list(user.tenantId); }

  @Post() @RequirePermissions(PERMISSIONS.BILLING.PAYMENTS_MANAGE)
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateModeOfPaymentDto) { return this.service.create(user.tenantId, dto); }

  @Patch(':id') @RequirePermissions(PERMISSIONS.BILLING.PAYMENTS_MANAGE)
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateModeOfPaymentDto) { return this.service.update(user.tenantId, id, dto); }

  @Delete(':id') @RequirePermissions(PERMISSIONS.BILLING.PAYMENTS_MANAGE)
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) { return this.service.remove(user.tenantId, id); }
}
```

- [ ] **Step 4: Wire into BillingModule**

In `billing.module.ts`, import and add `ModesOfPaymentController` to `controllers` and `ModesOfPaymentService` to `providers` + `exports`.

- [ ] **Step 5: Seed default modes**

In `packages/database/prisma/seed.ts`, where the `acme` tenant + billing settings are seeded, add (resolve `acmeTenantId` from the existing variable):

```ts
for (const m of [
  { name: 'Espèces', accountCode: '1000', isDefault: true },
  { name: 'Banque', accountCode: '1010', isDefault: false },
]) {
  await prisma.modeOfPayment.upsert({
    where: { tenantId_name: { tenantId: acmeTenantId, name: m.name } },
    update: { accountCode: m.accountCode, isDefault: m.isDefault },
    create: { tenantId: acmeTenantId, ...m },
  });
}
```

- [ ] **Step 6: Typecheck + reseed**

Run: `pnpm --filter @pulsar/api typecheck` (expected 0 errors) then `pnpm db:seed` (expected: completes; two modes upserted).

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/billing/modes-of-payment.* apps/api/src/modules/billing/dto/mode-of-payment.dto.ts apps/api/src/modules/billing/billing.module.ts packages/database/prisma/seed.ts
git commit -m "feat(api): ModeOfPayment master + default seed (Espèces/Banque)"
```

---

### Task 6: API — PaymentsService (create/patch/open-invoices/submit/cancel + GL)

**Files:**
- Create: `apps/api/src/modules/billing/payments.service.ts`

**Interfaces:**
- Consumes: `LedgerService.post`, `ModesOfPaymentService.resolveAccountCode`, `ModuleSettingsService.resolve`, `SequencesService.nextNumber`, `OwnershipService`, `AuditLogsService.log`.
- Produces: `PaymentsService.{list,get,create,update,openInvoices,submit,cancel}` with the signatures used by the controller in Task 7.

**Key rules baked in:** allocation `amount ≤ outstanding`; sum(allocations) `≤ totalAmount`; party↔target type coherence; submit posts GL transactionally; cancel reverses.

- [ ] **Step 1: Implement the service**

```ts
// apps/api/src/modules/billing/payments.service.ts
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  AuditAction, PaymentPartyType, PaymentStatus, PaymentTargetType, PaymentType,
  canTransitionPayment,
} from '@pulsar/shared';
import { Prisma } from '@pulsar/database';
import { PrismaService } from '../../prisma/prisma.service';
import { SequencesService } from '../../prisma/sequences.service';
import { AuditLogsService } from '../../core/audit-logs/audit-logs.service';
import { OwnershipService } from '../../core/ownership/ownership.service';
import { ModuleSettingsService } from '../../core/module-registry/module-settings.service';
import { LedgerService } from './ledger/ledger.service';
import { ModesOfPaymentService } from './modes-of-payment.service';

interface AllocationInput { targetType: PaymentTargetType; targetId: string; amount: number }
interface CreatePaymentInput {
  type: PaymentType; partyType: PaymentPartyType; partyId: string; modeOfPaymentId: string;
  date: string; currency?: string; totalAmount: number; reference?: string; note?: string;
  allocations: AllocationInput[];
}

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sequences: SequencesService,
    private readonly audit: AuditLogsService,
    private readonly ownership: OwnershipService,
    private readonly moduleSettings: ModuleSettingsService,
    private readonly ledger: LedgerService,
    private readonly modes: ModesOfPaymentService,
  ) {}

  list(tenantId: string, status?: PaymentStatus, type?: PaymentType) {
    return this.prisma.payment.findMany({
      where: { tenantId, status, type },
      orderBy: { createdAt: 'desc' },
      include: { modeOfPayment: true, allocations: true },
    });
  }

  async get(tenantId: string, id: string) {
    const p = await this.prisma.payment.findFirst({
      where: { id, tenantId },
      include: { modeOfPayment: true, allocations: true },
    });
    if (!p) throw new NotFoundException('Payment not found');
    return p;
  }

  /** Open invoices (outstanding > 0) of a party, for the allocation screen. */
  async openInvoices(tenantId: string, partyType: PaymentPartyType, partyId: string) {
    if (partyType === PaymentPartyType.CUSTOMER) {
      const rows = await this.prisma.customerInvoice.findMany({
        where: { tenantId, customerId: partyId, status: { in: ['APPROVED', 'SENT'] } },
        select: { id: true, invoiceNumber: true, totalAmount: true, amountPaid: true, currency: true },
        orderBy: { createdAt: 'asc' },
      });
      return rows
        .map((r) => ({ ...r, targetType: PaymentTargetType.CUSTOMER_INVOICE, outstanding: Number(r.totalAmount) - Number(r.amountPaid) }))
        .filter((r) => r.outstanding > 0);
    }
    const rows = await this.prisma.invoice.findMany({
      where: { tenantId, carrierId: partyId, status: { in: ['APPROVED'] } },
      select: { id: true, invoiceNumber: true, totalAmount: true, amountPaid: true, currency: true },
      orderBy: { createdAt: 'asc' },
    });
    return rows
      .map((r) => ({ ...r, targetType: PaymentTargetType.CARRIER_INVOICE, outstanding: Number(r.totalAmount) - Number(r.amountPaid) }))
      .filter((r) => r.outstanding > 0);
  }

  private assertPartyTargetCoherence(partyType: PaymentPartyType, allocations: AllocationInput[]) {
    const expected = partyType === PaymentPartyType.CUSTOMER ? PaymentTargetType.CUSTOMER_INVOICE : PaymentTargetType.CARRIER_INVOICE;
    for (const a of allocations) {
      if (a.targetType !== expected) throw new BadRequestException('Allocation target does not match party type');
      if (a.amount <= 0) throw new BadRequestException('Allocation amount must be positive');
    }
    const sum = allocations.reduce((s, a) => s + a.amount, 0);
    return sum;
  }

  private async assertPartyOwned(tenantId: string, partyType: PaymentPartyType, partyId: string) {
    if (partyType === PaymentPartyType.CUSTOMER) await this.ownership.assertOwned(tenantId, 'customer', partyId);
    else await this.ownership.assertOwned(tenantId, 'carrier', partyId);
  }

  async create(tenantId: string, userId: string, input: CreatePaymentInput) {
    await this.assertPartyOwned(tenantId, input.partyType, input.partyId);
    await this.modes.resolveAccountCode(tenantId, input.modeOfPaymentId); // validates ownership/existence
    const allocSum = this.assertPartyTargetCoherence(input.partyType, input.allocations);
    if (allocSum > input.totalAmount + 1e-9) throw new BadRequestException('Allocations exceed payment amount');

    const settings = await this.moduleSettings.resolve(tenantId, 'billing');
    const currency = input.currency ?? (settings.defaultCurrency as string);
    const paymentNumber = await this.sequences.nextNumber(tenantId, 'payment');

    const payment = await this.prisma.payment.create({
      data: {
        tenantId, paymentNumber, type: input.type, partyType: input.partyType, partyId: input.partyId,
        modeOfPaymentId: input.modeOfPaymentId, date: new Date(input.date), currency,
        totalAmount: new Prisma.Decimal(input.totalAmount), reference: input.reference, note: input.note,
        createdById: userId,
        allocations: { create: input.allocations.map((a) => ({ tenantId, targetType: a.targetType, targetId: a.targetId, amount: new Prisma.Decimal(a.amount) })) },
      },
      include: { allocations: true, modeOfPayment: true },
    });
    await this.audit.log({ tenantId, userId, action: AuditAction.CREATE, entityType: 'payment', entityId: payment.id, after: { paymentNumber, status: payment.status } });
    return payment;
  }

  async update(tenantId: string, userId: string, id: string, input: Partial<CreatePaymentInput>) {
    const existing = await this.get(tenantId, id);
    if (existing.status !== PaymentStatus.DRAFT) throw new BadRequestException('Only DRAFT payments can be edited');
    if (input.allocations) this.assertPartyTargetCoherence(existing.partyType, input.allocations);
    const data: Prisma.PaymentUpdateInput = {};
    if (input.totalAmount != null) data.totalAmount = new Prisma.Decimal(input.totalAmount);
    if (input.reference !== undefined) data.reference = input.reference;
    if (input.note !== undefined) data.note = input.note;
    if (input.date) data.date = new Date(input.date);
    const updated = await this.prisma.$transaction(async (tx) => {
      if (input.allocations) {
        await tx.paymentAllocation.deleteMany({ where: { paymentId: id } });
        await tx.paymentAllocation.createMany({ data: input.allocations.map((a) => ({ tenantId, paymentId: id, targetType: a.targetType, targetId: a.targetId, amount: new Prisma.Decimal(a.amount) })) });
      }
      return tx.payment.update({ where: { id }, data, include: { allocations: true, modeOfPayment: true } });
    });
    await this.audit.log({ tenantId, userId, action: AuditAction.UPDATE, entityType: 'payment', entityId: id, after: { status: updated.status } });
    return updated;
  }

  /** Post the GL (transactional with the submit) + increment amountPaid + flip fully-paid invoices to PAID. */
  async submit(tenantId: string, userId: string, id: string) {
    const payment = await this.get(tenantId, id);
    if (!canTransitionPayment(payment.status as PaymentStatus, PaymentStatus.SUBMITTED)) {
      throw new BadRequestException(`Cannot submit a ${payment.status} payment`);
    }
    if (payment.allocations.length === 0) throw new BadRequestException('Payment has no allocations');

    const settings = await this.moduleSettings.resolve(tenantId, 'billing');
    const modeAccount = await this.modes.resolveAccountCode(tenantId, payment.modeOfPaymentId);
    const arAccount = settings.arAccountCode as string;
    const apAccount = settings.apAccountCode as string;
    const allocated = payment.allocations.reduce((s, a) => s + Number(a.amount), 0);

    // GL lines (rule 41 — balanced, double entry).
    const lines =
      payment.type === PaymentType.RECEIVE
        ? [{ accountCode: modeAccount, debit: allocated }, { accountCode: arAccount, credit: allocated }]
        : [{ accountCode: apAccount, debit: allocated }, { accountCode: modeAccount, credit: allocated }];

    await this.prisma.$transaction(async (tx) => {
      // claim DRAFT→SUBMITTED (TOCTOU)
      const claim = await tx.payment.updateMany({
        where: { id, tenantId, status: PaymentStatus.DRAFT },
        data: { status: PaymentStatus.SUBMITTED, submittedAt: new Date() },
      });
      if (claim.count === 0) throw new BadRequestException('Payment is no longer DRAFT');

      for (const a of payment.allocations) {
        if (a.targetType === PaymentTargetType.CUSTOMER_INVOICE) {
          const inv = await tx.customerInvoice.findFirst({ where: { id: a.targetId, tenantId }, select: { totalAmount: true, amountPaid: true, status: true } });
          if (!inv) throw new BadRequestException('Allocated customer invoice not found');
          const newPaid = Number(inv.amountPaid) + Number(a.amount);
          if (newPaid > Number(inv.totalAmount) + 1e-9) throw new BadRequestException('Allocation exceeds invoice outstanding');
          await tx.customerInvoice.update({ where: { id: a.targetId }, data: { amountPaid: new Prisma.Decimal(newPaid), ...(newPaid >= Number(inv.totalAmount) - 1e-9 ? { status: 'PAID', paidAt: new Date() } : {}) } });
        } else {
          const inv = await tx.invoice.findFirst({ where: { id: a.targetId, tenantId }, select: { totalAmount: true, amountPaid: true, status: true } });
          if (!inv) throw new BadRequestException('Allocated carrier invoice not found');
          const newPaid = Number(inv.amountPaid) + Number(a.amount);
          if (newPaid > Number(inv.totalAmount) + 1e-9) throw new BadRequestException('Allocation exceeds invoice outstanding');
          await tx.invoice.update({ where: { id: a.targetId }, data: { amountPaid: new Prisma.Decimal(newPaid), ...(newPaid >= Number(inv.totalAmount) - 1e-9 ? { status: 'PAID', paidAt: new Date() } : {}) } });
        }
      }
      // Post GL inside the same transaction via the transactional ledger entrypoint (Task 6b).
      await this.ledger.postTx(tx, tenantId, {
        date: payment.date, memo: `Payment ${payment.paymentNumber}`,
        sourceType: 'payment', sourceId: payment.id, sourceKind: null, lines,
      }, userId);
    });

    await this.audit.log({ tenantId, userId, action: AuditAction.UPDATE, entityType: 'payment', entityId: id, before: { status: 'DRAFT' }, after: { status: 'SUBMITTED' } });
    return this.get(tenantId, id);
  }

  async cancel(tenantId: string, userId: string, id: string) {
    const payment = await this.get(tenantId, id);
    if (!canTransitionPayment(payment.status as PaymentStatus, PaymentStatus.CANCELLED)) {
      throw new BadRequestException(`Cannot cancel a ${payment.status} payment`);
    }
    const wasSubmitted = payment.status === PaymentStatus.SUBMITTED;
    const settings = await this.moduleSettings.resolve(tenantId, 'billing');
    const modeAccount = await this.modes.resolveAccountCode(tenantId, payment.modeOfPaymentId);
    const arAccount = settings.arAccountCode as string;
    const apAccount = settings.apAccountCode as string;
    const allocated = payment.allocations.reduce((s, a) => s + Number(a.amount), 0);
    // Reversal = swap debit/credit.
    const lines =
      payment.type === PaymentType.RECEIVE
        ? [{ accountCode: modeAccount, credit: allocated }, { accountCode: arAccount, debit: allocated }]
        : [{ accountCode: apAccount, credit: allocated }, { accountCode: modeAccount, debit: allocated }];

    await this.prisma.$transaction(async (tx) => {
      const claim = await tx.payment.updateMany({
        where: { id, tenantId, status: payment.status },
        data: { status: PaymentStatus.CANCELLED, cancelledAt: new Date() },
      });
      if (claim.count === 0) throw new BadRequestException('Payment changed concurrently');

      if (wasSubmitted) {
        for (const a of payment.allocations) {
          if (a.targetType === PaymentTargetType.CUSTOMER_INVOICE) {
            const inv = await tx.customerInvoice.findFirst({ where: { id: a.targetId, tenantId }, select: { totalAmount: true, amountPaid: true, status: true } });
            if (!inv) continue;
            const newPaid = Math.max(0, Number(inv.amountPaid) - Number(a.amount));
            await tx.customerInvoice.update({ where: { id: a.targetId }, data: { amountPaid: new Prisma.Decimal(newPaid), ...(inv.status === 'PAID' && newPaid < Number(inv.totalAmount) ? { status: 'APPROVED', paidAt: null } : {}) } });
          } else {
            const inv = await tx.invoice.findFirst({ where: { id: a.targetId, tenantId }, select: { totalAmount: true, amountPaid: true, status: true } });
            if (!inv) continue;
            const newPaid = Math.max(0, Number(inv.amountPaid) - Number(a.amount));
            await tx.invoice.update({ where: { id: a.targetId }, data: { amountPaid: new Prisma.Decimal(newPaid), ...(inv.status === 'PAID' && newPaid < Number(inv.totalAmount) ? { status: 'APPROVED', paidAt: null } : {}) } });
          }
        }
        await this.ledger.postTx(tx, tenantId, {
          date: new Date(), memo: `Reversal of payment ${payment.paymentNumber}`,
          sourceType: 'payment', sourceId: payment.id, sourceKind: 'reversal', lines,
        }, userId);
      }
    });
    await this.audit.log({ tenantId, userId, action: AuditAction.UPDATE, entityType: 'payment', entityId: id, before: { status: payment.status }, after: { status: 'CANCELLED' } });
    return this.get(tenantId, id);
  }
}
```

- [ ] **Step 2: Typecheck (will fail until Task 6b adds `postTx`)**

Run: `pnpm --filter @pulsar/api typecheck`
Expected: FAIL on `this.ledger.postTx` — resolved in Task 6b. Proceed to 6b before committing.

---

### Task 6b: API — transactional ledger entrypoint `LedgerService.postTx`

**Files:**
- Modify: `apps/api/src/modules/billing/ledger/ledger.service.ts`

**Interfaces:**
- Produces: `LedgerService.postTx(tx: Prisma.TransactionClient, tenantId, input: PostInput, userId?)` — same validation/idempotence as `post`, but runs on a caller-supplied transaction so the GL write commits/rolls back with the payment. Existing `post()` is refactored to delegate: `post(...) { return this.prisma.$transaction((tx) => this.postTx(tx, ...)) }`.

- [ ] **Step 1: Refactor `post` into `postTx`**

Extract the existing balance-check + account-resolution + idempotence + insert body into `async postTx(tx, tenantId, input, userId?)`, replacing `this.prisma` calls with `tx`. Keep the P2002 idempotent no-op handling. Then:

```ts
async post(tenantId: string, input: PostInput, userId?: string) {
  return this.prisma.$transaction((tx) => this.postTx(tx, tenantId, input, userId));
}
```

The audit call inside stays (it uses `this.audit`, not the tx). Account-code resolution must read through `tx`.

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @pulsar/api typecheck`
Expected: 0 errors (Task 6 now resolves).

- [ ] **Step 3: Commit (Tasks 6 + 6b together — they compile as a unit)**

```bash
git add apps/api/src/modules/billing/payments.service.ts apps/api/src/modules/billing/ledger/ledger.service.ts
git commit -m "feat(api): PaymentsService (allocate/submit/cancel) + transactional LedgerService.postTx"
```

---

### Task 7: API — PaymentsController + DTOs + module wiring

**Files:**
- Create: `apps/api/src/modules/billing/dto/payment.dto.ts`
- Create: `apps/api/src/modules/billing/payments.controller.ts`
- Modify: `apps/api/src/modules/billing/billing.module.ts`

**Interfaces:**
- Consumes: `PaymentsService`.
- Produces endpoints: `GET /billing/payments`, `GET /billing/payments/open-invoices`, `GET /billing/payments/:id`, `POST /billing/payments`, `PATCH /billing/payments/:id`, `POST /billing/payments/:id/submit`, `POST /billing/payments/:id/cancel`.

- [ ] **Step 1: DTOs**

```ts
// apps/api/src/modules/billing/dto/payment.dto.ts
import { PartialType } from '@nestjs/swagger';
import { PaymentPartyType, PaymentTargetType, PaymentType } from '@pulsar/shared';
import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsDateString, IsEnum, IsNumber, IsOptional, IsPositive, IsString, Length, Min, ValidateNested } from 'class-validator';

export class AllocationDto {
  @IsEnum(PaymentTargetType) targetType!: PaymentTargetType;
  @IsString() targetId!: string;
  @IsNumber() @IsPositive() amount!: number;
}
export class CreatePaymentDto {
  @IsEnum(PaymentType) type!: PaymentType;
  @IsEnum(PaymentPartyType) partyType!: PaymentPartyType;
  @IsString() partyId!: string;
  @IsString() modeOfPaymentId!: string;
  @IsDateString() date!: string;
  @IsOptional() @IsString() @Length(3, 3) currency?: string;
  @IsNumber() @Min(0) totalAmount!: number;
  @IsOptional() @IsString() reference?: string;
  @IsOptional() @IsString() note?: string;
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => AllocationDto) allocations!: AllocationDto[];
}
export class UpdatePaymentDto extends PartialType(CreatePaymentDto) {}
```

- [ ] **Step 2: Controller** (note: `open-invoices` is declared before `:id` so it is not shadowed)

```ts
// apps/api/src/modules/billing/payments.controller.ts
import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '@pulsar/shared';
import { MODULE_KEYS, PaymentPartyType, PaymentStatus, PaymentType, PERMISSIONS } from '@pulsar/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequireModule } from '../../common/decorators/require-module.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CreatePaymentDto, UpdatePaymentDto } from './dto/payment.dto';
import { PaymentsService } from './payments.service';

@ApiTags('billing')
@ApiBearerAuth()
@RequireModule(MODULE_KEYS.BILLING)
@Controller('billing/payments')
export class PaymentsController {
  constructor(private readonly service: PaymentsService) {}

  @Get() @RequirePermissions(PERMISSIONS.BILLING.PAYMENTS_READ)
  list(@CurrentUser() user: AuthUser, @Query('status') status?: PaymentStatus, @Query('type') type?: PaymentType) {
    return this.service.list(user.tenantId, status, type);
  }

  @Get('open-invoices') @RequirePermissions(PERMISSIONS.BILLING.PAYMENTS_READ)
  openInvoices(@CurrentUser() user: AuthUser, @Query('partyType') partyType: PaymentPartyType, @Query('partyId') partyId: string) {
    return this.service.openInvoices(user.tenantId, partyType, partyId);
  }

  @Get(':id') @RequirePermissions(PERMISSIONS.BILLING.PAYMENTS_READ)
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) { return this.service.get(user.tenantId, id); }

  @Post() @RequirePermissions(PERMISSIONS.BILLING.PAYMENTS_MANAGE)
  create(@CurrentUser() user: AuthUser, @Body() dto: CreatePaymentDto) { return this.service.create(user.tenantId, user.id, dto); }

  @Patch(':id') @RequirePermissions(PERMISSIONS.BILLING.PAYMENTS_MANAGE)
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdatePaymentDto) { return this.service.update(user.tenantId, user.id, id, dto); }

  @Post(':id/submit') @RequirePermissions(PERMISSIONS.BILLING.PAYMENTS_MANAGE)
  submit(@CurrentUser() user: AuthUser, @Param('id') id: string) { return this.service.submit(user.tenantId, user.id, id); }

  @Post(':id/cancel') @RequirePermissions(PERMISSIONS.BILLING.PAYMENTS_MANAGE)
  cancel(@CurrentUser() user: AuthUser, @Param('id') id: string) { return this.service.cancel(user.tenantId, user.id, id); }
}
```

- [ ] **Step 3: Wire into BillingModule**

Add `PaymentsController` to `controllers`, `PaymentsService` to `providers` + `exports`. Ensure `OwnershipService`'s module (`OwnershipModule`/core) is imported if not already transitively available; `ModuleRegistryModule` (ModuleSettingsService) is already imported.

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @pulsar/api typecheck`
Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/billing/payments.controller.ts apps/api/src/modules/billing/dto/payment.dto.ts apps/api/src/modules/billing/billing.module.ts
git commit -m "feat(api): payments controller + DTOs"
```

---

### Task 8: API — route legacy mark-paid through Payment

**Files:**
- Modify: `apps/api/src/modules/billing/invoices.service.ts` (carrier `markPaid`)
- Modify: `apps/api/src/modules/billing/customer-invoices.service.ts` (`markPaid`)

**Interfaces:**
- Consumes: `PaymentsService.create` + `.submit`.
- Behavior: `markPaid(tenantId, userId, id, paidAt?)` resolves the invoice's default mode of payment (the tenant's `isDefault` mode, else the first), creates a full-allocation Payment (`amount = totalAmount − amountPaid`) dated `paidAt ?? now`, and submits it. Remove the previous inline GL "paid" auto-post so the only `sourceType='payment'` post exists.

- [ ] **Step 1: Inject `PaymentsService` and add a default-mode helper**

Add `PaymentsService` to both services' constructors (Billing module already provides it). Add a private helper:

```ts
private async defaultModeId(tenantId: string): Promise<string> {
  const mode = await this.prisma.modeOfPayment.findFirst({ where: { tenantId }, orderBy: [{ isDefault: 'desc' }, { name: 'asc' }], select: { id: true } });
  if (!mode) throw new BadRequestException('No mode of payment configured');
  return mode.id;
}
```

- [ ] **Step 2: Rewrite carrier `markPaid`**

Replace the body that flipped status + posted GL with:

```ts
async markPaid(tenantId: string, userId: string, id: string, paidAt?: string) {
  const inv = await this.prisma.invoice.findFirst({ where: { id, tenantId }, select: { id: true, status: true, totalAmount: true, amountPaid: true, carrierId: true, currency: true } });
  if (!inv) throw new NotFoundException('Invoice not found');
  if (inv.status !== 'APPROVED') throw new BadRequestException('Only APPROVED invoices can be paid');
  const outstanding = Number(inv.totalAmount) - Number(inv.amountPaid);
  if (outstanding <= 0) throw new BadRequestException('Invoice already settled');
  const payment = await this.payments.create(tenantId, userId, {
    type: PaymentType.PAY, partyType: PaymentPartyType.CARRIER, partyId: inv.carrierId,
    modeOfPaymentId: await this.defaultModeId(tenantId), date: paidAt ?? new Date().toISOString(),
    currency: inv.currency, totalAmount: outstanding,
    allocations: [{ targetType: PaymentTargetType.CARRIER_INVOICE, targetId: inv.id, amount: outstanding }],
  });
  return this.payments.submit(tenantId, userId, payment.id);
}
```

Import `PaymentType, PaymentPartyType, PaymentTargetType` from `@pulsar/shared`.

- [ ] **Step 3: Rewrite customer `markPaid`** (analogous — repeat in full)

```ts
async markPaid(tenantId: string, userId: string, id: string, paidAt?: string) {
  const inv = await this.prisma.customerInvoice.findFirst({ where: { id, tenantId }, select: { id: true, status: true, totalAmount: true, amountPaid: true, customerId: true, currency: true } });
  if (!inv) throw new NotFoundException('Statement not found');
  if (inv.status !== 'APPROVED' && inv.status !== 'SENT') throw new BadRequestException('Only APPROVED/SENT statements can be paid');
  const outstanding = Number(inv.totalAmount) - Number(inv.amountPaid);
  if (outstanding <= 0) throw new BadRequestException('Statement already settled');
  const payment = await this.payments.create(tenantId, userId, {
    type: PaymentType.RECEIVE, partyType: PaymentPartyType.CUSTOMER, partyId: inv.customerId,
    modeOfPaymentId: await this.defaultModeId(tenantId), date: paidAt ?? new Date().toISOString(),
    currency: inv.currency, totalAmount: outstanding,
    allocations: [{ targetType: PaymentTargetType.CUSTOMER_INVOICE, targetId: inv.id, amount: outstanding }],
  });
  return this.payments.submit(tenantId, userId, payment.id);
}
```

- [ ] **Step 4: Remove the old GL "paid" auto-post**

Search both services for the ledger post that fired on mark-paid (e.g. `sourceType: 'invoice'` with a `paid`/payment `sourceKind`, or a `cashAccountCode` post inside the old `markPaid`). Delete only that paid-path post — leave the approve-path auto-posts (revenue/AR, expense/AP recognition) intact. Confirm with `grep -n "sourceType" apps/api/src/modules/billing/*.service.ts`.

- [ ] **Step 5: Guard against a DI cycle**

If `PaymentsService` ↔ `Invoices/CustomerInvoices` create a circular provider graph (PaymentsService does NOT depend on them, so it should not), no `forwardRef` is needed. Typecheck + boot will reveal cycles. If Nest reports a cycle, wrap the inject with `@Inject(forwardRef(() => PaymentsService))`.

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter @pulsar/api typecheck`
Expected: 0 errors.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/billing/invoices.service.ts apps/api/src/modules/billing/customer-invoices.service.ts
git commit -m "feat(api): route mark-paid through Payment (single accounting path)"
```

---

### Task 9: API — e2e workflow test

**Files:**
- Create: `apps/api/test/payments.e2e-spec.ts`

**Interfaces:**
- Consumes: HTTP API. Needs a running seeded DB (`pnpm db:up && pnpm db:migrate && pnpm db:seed`).

- [ ] **Step 1: Write the e2e test** (mirror an existing suite's bootstrap, e.g. `apps/api/test/billing.e2e-spec.ts`, for login + tenant/module setup; create master data with unique codes for rerun safety)

Cover, against a customer with one APPROVED statement of total `100.00`:
1. `POST /billing/payments` RECEIVE allocating `40.00` → `201`; `submit` → statement `amountPaid=40`, status stays `APPROVED`.
2. Second payment allocating `60.00` → submit → statement status `PAID`, `amountPaid=100`.
3. `GET /billing/ledger/trial-balance` (or journal) shows two balanced `sourceType='payment'` entries; AR credited `100`, cash/bank debited `100`.
4. `POST /billing/payments/:id/cancel` on the second payment → reversing entry posted; statement back to `APPROVED`, `amountPaid=40`.
5. Repeat the happy path for a carrier invoice (`PAY`): AP debited, cash credited.
6. Tenant isolation: a second tenant's token gets `404` on `GET /billing/payments/:id` of the first tenant's payment.
7. Over-allocation: allocating `150.00` against a `100.00` statement → `400`.

- [ ] **Step 2: Run the suite**

Run: `pnpm --filter @pulsar/api test:e2e -- payments`
Expected: all cases PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/api/test/payments.e2e-spec.ts
git commit -m "test(api): payments e2e (partial/full/cancel/isolation/over-allocation)"
```

---

### Task 10: Web — payments list page + nav

**Files:**
- Create: `apps/web/src/routes/(app)/billing/payments/+page.svelte`
- Modify: `apps/web/src/lib/modules/navigation.ts` (add a "Paiements" link under the Finance/Billing domain, `perm: PERMISSIONS.BILLING.PAYMENTS_READ`)

**Interfaces:**
- Consumes: `GET /billing/payments`.

- [ ] **Step 1: Build the list page** — follow `apps/web/src/routes/(app)/invoices/+page.svelte` for structure: `$state` rows, `$effect` → `load()` calling `api<Payment[]>('/billing/payments')`, a `PageHeader` with count, a `Table`/`Card` listing `paymentNumber`, type badge (RECEIVE/PAY), party, date, `totalAmount`, status badge, and a KPI card for total outstanding (sum of `totalAmount` of SUBMITTED minus… simply show submitted total for v1). A "Nouvelle écriture de paiement" button linking to the create flow (Task 11). Use `$lib/components/ui` + `$lib/stores/toast`.

- [ ] **Step 2: Add nav link** in `navigation.ts` under the Finance/Billing domain `links` array:
```ts
{ href: '/billing/payments', label: 'Paiements', perm: PERMISSIONS.BILLING.PAYMENTS_READ },
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @pulsar/web typecheck`
Expected: 0 errors (warnings ok).

- [ ] **Step 4: Commit**

```bash
git add "apps/web/src/routes/(app)/billing/payments/+page.svelte" apps/web/src/lib/modules/navigation.ts
git commit -m "feat(web): payments list + nav"
```

---

### Task 11: Web — create/allocate flow + detail page

**Files:**
- Create: `apps/web/src/routes/(app)/billing/payments/new/+page.svelte`
- Create: `apps/web/src/routes/(app)/billing/payments/[id]/+page.svelte`

**Interfaces:**
- Consumes: `GET /billing/payments/open-invoices`, `GET /billing/modes-of-payment`, `POST /billing/payments`, `POST /billing/payments/:id/submit`, `POST /billing/payments/:id/cancel`, `GET /billing/payments/:id`.

- [ ] **Step 1: Create flow** — form: choose `type` (RECEIVE/PAY) → choose party (customer list for RECEIVE, carrier list for PAY; reuse existing list endpoints `/transportation/customers` and `/transportation/carriers`) → on party change fetch `open-invoices?partyType=&partyId=` → render a table with one editable `amount` input per open invoice (prefilled to outstanding, clamped to outstanding), a live "total alloué" and a "reste" vs the payment `totalAmount` → pick mode of payment + date + reference → `POST /billing/payments` then `POST :id/submit` (or save DRAFT then submit). Validate client-side: at least one allocation > 0; allocations ≤ outstanding; sum ≤ totalAmount. On success `goto('/billing/payments/' + id)` + toast.

- [ ] **Step 2: Detail page** — load payment, show header (number, type, party, mode, date, status badge), allocations table, and action buttons by status: SUBMITTED → "Annuler" (cancel); DRAFT → "Soumettre"/"Annuler". Reload after action + toast.

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @pulsar/web typecheck`
Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add "apps/web/src/routes/(app)/billing/payments/new/+page.svelte" "apps/web/src/routes/(app)/billing/payments/[id]/+page.svelte"
git commit -m "feat(web): payment create/allocate flow + detail"
```

---

### Task 12: Web — modes of payment management in config

**Files:**
- Modify: `apps/web/src/routes/(app)/billing/config/+page.svelte`
- Create: `apps/web/src/lib/components/billing/ModesOfPayment.svelte`

**Interfaces:**
- Consumes: `GET/POST/PATCH/DELETE /billing/modes-of-payment`.

- [ ] **Step 1: Component** — a small CRUD list: name + accountCode + isDefault, add/edit/delete rows. Mirror the simplest existing master UI for styling.

- [ ] **Step 2: Mount it** in `billing/config/+page.svelte` below the existing `ModuleSettings`/`CustomFieldsEditor`:
```svelte
<div class="mt-6"><ModesOfPayment /></div>
```
(import from `$lib/components/billing/ModesOfPayment.svelte`).

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @pulsar/web typecheck`
Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add "apps/web/src/routes/(app)/billing/config/+page.svelte" apps/web/src/lib/components/billing/ModesOfPayment.svelte
git commit -m "feat(web): manage modes of payment in billing config"
```

---

### Task 13: Final verification

- [ ] **Step 1: Full typecheck + shared unit tests**

Run: `pnpm typecheck` (all workspaces) — expected 0 errors.
Run: `pnpm test` (shared unit) — expected `canTransitionPayment` green.

- [ ] **Step 2: e2e (seeded DB)**

Run: `pnpm db:up && pnpm db:migrate && pnpm db:seed && pnpm --filter @pulsar/api test:e2e -- payments`
Expected: payments suite green; no regressions in existing billing e2e (`pnpm --filter @pulsar/api test:e2e -- billing`).

- [ ] **Step 3: Manual smoke (optional)** — `pnpm dev`, log in (admin@pulsar.dev), enable Billing, create a customer statement, record a partial then full payment, confirm trial balance balances and the statement flips to PAID.

- [ ] **Step 4: Commit any fixups + update docs**

If the existing billing e2e referenced the old mark-paid GL behavior, update those expectations. Update `docs/etat-du-projet.md` to note Payments shipped. Commit.

---

## Self-Review notes (author)

- **Spec coverage:** Payment/Allocation/ModeOfPayment models (T3,T5), state machine (T1), allocation rules + submit/cancel GL (T6/6b), mark-paid migration (T8), permissions/config/sequence (T2,T4), UI list/create/detail/config (T10–12), seed (T5), tests (T1,T9). AR/AP ageing + reconciliation explicitly deferred (out of scope). All spec sections mapped.
- **Idempotence:** GL posts keyed `sourceType='payment'` (+`sourceKind='reversal'` for cancel) — distinct tuples, both idempotent via the existing unique constraint.
- **Type consistency:** enum names identical across shared/Prisma/DTOs; `postTx(tx, tenantId, input, userId)` consumed in T6 is produced in T6b; `defaultModeId`/`resolveAccountCode` names consistent across T5/T6/T8.
- **Open risk flagged for the implementer:** the exact location of the legacy mark-paid GL post (T8 Step 4) must be confirmed by grep before deleting — do not remove approve-path posts.
