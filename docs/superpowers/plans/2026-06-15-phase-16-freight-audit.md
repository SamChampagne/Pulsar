# Phase 16 — Freight Audit autonome — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Audit incoming carrier invoices against frozen `Load.estimatedCost`, flag overcharges, let an autonomous agent open disputes through the governance queue, and measure recovered savings.

**Architecture:** A new decoupled `IncomingCarrierInvoice`/`IncomingInvoiceLine` pair in the Billing module; a deterministic `FreightAuditService` matches each line to a Load by reference and reuses the buy-side `evaluateReconciliation` + tolerances for the variance verdict; intake emits a `carrier-invoice.received` domain event that the phase-12 policy turns into a `FREIGHT_AUDIT` operational task; two new agent tools (`audit_carrier_invoice` READ, `dispute_carrier_invoice` SENSITIVE) let the always-on agent (phases 13/14) audit and propose disputes through the existing `ProposedAction` gate; recovered savings (`KEEP_EXPECTED` resolutions) surface via a savings endpoint.

**Tech Stack:** `@pulsar/shared` (pure), NestJS 11 + Prisma 6, SvelteKit 5, Jest (api) + vitest (shared).

**Design spec:** `docs/superpowers/specs/2026-06-15-phase-16-freight-audit-design.md`

**Branch:** `phase-16` (created off phase-15 tip; design doc is its first commit). Do NOT switch branches.

**Conventions:** enums in `@pulsar/shared` mirrored in `schema.prisma` (rule 3); status changes via state machine (rule 2); never recompute `Load.estimatedCost` (rule 16); agent mutating tools go through the `ProposedAction` gate (rules 22/29); every query tenant-scoped (rule 1); module endpoints `@RequireModule(MODULE_KEYS.BILLING)` (rule 5); audit sensitive mutations (rule 6); rebuild shared/database after editing; `pnpm build` + `pnpm test` before green.

---

## File Structure

**Create:**
- `packages/shared/src/workflows/freight-audit.workflow.ts` (+ `.spec.ts`) — `FreightAuditStatus`, `canTransitionFreightAudit`.
- `apps/api/src/modules/billing/freight-audit/freight-audit.service.ts` (+ `.spec.ts`).
- `apps/api/src/modules/billing/freight-audit/dto/freight-audit.dto.ts`.
- `apps/api/src/modules/billing/freight-audit/freight-audit.controller.ts`.
- `apps/api/test/phase16-freight-audit.e2e-spec.ts`.
- `apps/web/src/routes/(app)/billing/freight-audit/+page.svelte` + `[id]/+page.svelte`.

**Modify:**
- `packages/shared/src/index.ts` — export the workflow.
- `packages/shared/src/operating/policies.ts` (+ `.spec.ts`) — `CARRIER_INVOICE_RECEIVED` event + FREIGHT_AUDIT policy.
- `packages/shared/src/permissions.ts` — 2 freight-audit permission keys + catalog.
- `packages/database/prisma/schema.prisma` — 2 models + `FreightAuditStatus` enum (24th migration).
- `apps/api/src/modules/billing/billing.module.ts` — provide/export `FreightAuditService`, register controller, import OperatingModule (DomainEvents).
- `apps/api/src/core/agents/tool-registry.ts` — `ToolServices.freightAudit` + 2 tool defs.
- `apps/api/src/core/agents/agents.module.ts` — import BillingModule, inject `FreightAuditService` into `AGENT_TOOL_SERVICES`.
- `CLAUDE.md`, `ROADMAP.md`, `docs/etat-du-projet.md`.

---

## Task 1: Shared — freight-audit state machine

**Files:** Create `packages/shared/src/workflows/freight-audit.workflow.ts` + `.spec.ts`; Modify `index.ts`.

- [ ] **Step 1: Write the failing test** — `freight-audit.workflow.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { FreightAuditStatus, canTransitionFreightAudit } from './freight-audit.workflow';

describe('canTransitionFreightAudit', () => {
  it('allows the audit + dispute + pay paths', () => {
    expect(canTransitionFreightAudit(FreightAuditStatus.RECEIVED, FreightAuditStatus.MATCHED)).toBe(true);
    expect(canTransitionFreightAudit(FreightAuditStatus.RECEIVED, FreightAuditStatus.FLAGGED)).toBe(true);
    expect(canTransitionFreightAudit(FreightAuditStatus.FLAGGED, FreightAuditStatus.DISPUTED)).toBe(true);
    expect(canTransitionFreightAudit(FreightAuditStatus.FLAGGED, FreightAuditStatus.RESOLVED)).toBe(true);
    expect(canTransitionFreightAudit(FreightAuditStatus.DISPUTED, FreightAuditStatus.RESOLVED)).toBe(true);
    expect(canTransitionFreightAudit(FreightAuditStatus.MATCHED, FreightAuditStatus.PAID)).toBe(true);
    expect(canTransitionFreightAudit(FreightAuditStatus.RESOLVED, FreightAuditStatus.PAID)).toBe(true);
  });
  it('rejects invalid jumps', () => {
    expect(canTransitionFreightAudit(FreightAuditStatus.RECEIVED, FreightAuditStatus.PAID)).toBe(false);
    expect(canTransitionFreightAudit(FreightAuditStatus.PAID, FreightAuditStatus.DISPUTED)).toBe(false);
    expect(canTransitionFreightAudit(FreightAuditStatus.MATCHED, FreightAuditStatus.DISPUTED)).toBe(false);
    expect(canTransitionFreightAudit(FreightAuditStatus.RESOLVED, FreightAuditStatus.FLAGGED)).toBe(false);
  });
});
```

- [ ] **Step 2: Run → FAIL** — `pnpm --filter @pulsar/shared test -- freight-audit.workflow`.

- [ ] **Step 3: Implement** — `packages/shared/src/workflows/freight-audit.workflow.ts`:

```ts
// Pure. Mirrored in packages/database schema.prisma (phase 16).

export enum FreightAuditStatus {
  RECEIVED = 'RECEIVED',
  MATCHED = 'MATCHED',
  FLAGGED = 'FLAGGED',
  DISPUTED = 'DISPUTED',
  RESOLVED = 'RESOLVED',
  PAID = 'PAID',
}

const TRANSITIONS: Record<FreightAuditStatus, FreightAuditStatus[]> = {
  [FreightAuditStatus.RECEIVED]: [FreightAuditStatus.MATCHED, FreightAuditStatus.FLAGGED],
  [FreightAuditStatus.MATCHED]: [FreightAuditStatus.PAID],
  [FreightAuditStatus.FLAGGED]: [FreightAuditStatus.DISPUTED, FreightAuditStatus.RESOLVED, FreightAuditStatus.MATCHED],
  [FreightAuditStatus.DISPUTED]: [FreightAuditStatus.RESOLVED],
  [FreightAuditStatus.RESOLVED]: [FreightAuditStatus.PAID],
  [FreightAuditStatus.PAID]: [],
};

/** Re-audit from FLAGGED back to MATCHED/FLAGGED is allowed (a corrected invoice). */
export function canTransitionFreightAudit(from: FreightAuditStatus, to: FreightAuditStatus): boolean {
  if (from === to) return true; // re-audit / idempotent no-op
  return (TRANSITIONS[from] ?? []).includes(to);
}
```
> Note: `FLAGGED → MATCHED` is included so a re-audit of a corrected invoice can clear the flag. `from === to` returns true so re-audit that stays FLAGGED is a no-op (matches the buy-side reconcile pattern).

- [ ] **Step 4: Export** — in `packages/shared/src/index.ts`, with the other `./workflows/*` exports, add:
```ts
export * from './workflows/freight-audit.workflow';
```

- [ ] **Step 5: Run + build** — `pnpm --filter @pulsar/shared test -- freight-audit.workflow` (PASS); `pnpm --filter @pulsar/shared build` (clean).

- [ ] **Step 6: Commit**
```bash
git add packages/shared/src/workflows/freight-audit.workflow.ts packages/shared/src/workflows/freight-audit.workflow.spec.ts packages/shared/src/index.ts
git commit -m "feat(shared): freight-audit state machine (canTransitionFreightAudit)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Shared — domain event + FREIGHT_AUDIT policy

**Files:** Modify `packages/shared/src/operating/policies.ts` (+ `.spec.ts`).

READ `policies.ts` first (Task earlier in this session shows its shape: `DOMAIN_EVENT_TYPES`, `POLICIES: Policy[]`, `TaskSpec`, `resolvePolicies`).

- [ ] **Step 1: Add a failing test** to `packages/shared/src/operating/policies.spec.ts`:

```ts
import { resolvePolicies, DOMAIN_EVENT_TYPES } from './policies';

describe('FREIGHT_AUDIT policy', () => {
  it('maps carrier-invoice.received to a FREIGHT_AUDIT task (AUTO)', () => {
    const specs = resolvePolicies({ type: DOMAIN_EVENT_TYPES.CARRIER_INVOICE_RECEIVED, payload: { invoiceId: 'inv1', carrierId: 'c1' } });
    expect(specs).toHaveLength(1);
    expect(specs[0].category).toBe('FREIGHT_AUDIT');
    expect(specs[0].subjectType).toBe('incoming-carrier-invoice');
    expect(specs[0].subjectId).toBe('inv1');
    expect(specs[0].dedupKey).toBe('FREIGHT_AUDIT:inv1');
    expect(specs[0].assignHint).toBe('AUTO');
  });
});
```
(Use the spec file's existing import style — match `policies.spec.ts`.)

- [ ] **Step 2: Run → FAIL** — `pnpm --filter @pulsar/shared test -- policies.spec`.

- [ ] **Step 3: Implement** — in `policies.ts`:

3a. Add to `DOMAIN_EVENT_TYPES`:
```ts
  CARRIER_INVOICE_RECEIVED: 'carrier-invoice.received',
```

3b. Add a policy to the `POLICIES` array:
```ts
  {
    eventType: DOMAIN_EVENT_TYPES.CARRIER_INVOICE_RECEIVED,
    produce: (e) => {
      const invoiceId = str(e.payload.invoiceId);
      return [
        {
          type: OperationalTaskType.EXCEPTION,
          category: 'FREIGHT_AUDIT',
          severity: 'WARNING',
          title: 'Carrier invoice received — audit required',
          subjectType: 'incoming-carrier-invoice',
          subjectId: invoiceId,
          dedupKey: `FREIGHT_AUDIT:${invoiceId}`,
          details: { ...e.payload },
          assignHint: 'AUTO',
        },
      ];
    },
  },
```
(`str` helper already exists in the file.)

- [ ] **Step 4: Run + build** — `pnpm --filter @pulsar/shared test -- policies.spec` (PASS); `pnpm --filter @pulsar/shared build` (clean).

- [ ] **Step 5: Commit**
```bash
git add packages/shared/src/operating/policies.ts packages/shared/src/operating/policies.spec.ts
git commit -m "feat(shared): carrier-invoice.received → FREIGHT_AUDIT task policy

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Shared — freight-audit permissions

**Files:** Modify `packages/shared/src/permissions.ts`.

- [ ] **Step 1: Add the keys** — in the `BILLING` block of the permission map, after `INVOICES_PAY`:
```ts
    FREIGHT_AUDIT_READ: 'billing.freight-audit.read',
    FREIGHT_AUDIT_MANAGE: 'billing.freight-audit.manage',
```

- [ ] **Step 2: Add catalog entries** — with the other `billing(...)` catalog lines:
```ts
  billing(PERMISSIONS.BILLING.FREIGHT_AUDIT_READ, 'View incoming carrier invoices and audit results'),
  billing(PERMISSIONS.BILLING.FREIGHT_AUDIT_MANAGE, 'Audit, dispute and resolve incoming carrier invoices'),
```

- [ ] **Step 3: Build** — `pnpm --filter @pulsar/shared build` → clean. (`ALL_PERMISSION_KEYS` picks them up; the seed assigns them to the tenant admin role on reseed.)

- [ ] **Step 4: Commit**
```bash
git add packages/shared/src/permissions.ts
git commit -m "feat(shared): billing.freight-audit.read|manage permissions

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Prisma — incoming invoice entities (24th migration)

**Files:** Modify `packages/database/prisma/schema.prisma`.

READ the existing `Invoice`/`InvoiceLine`/`Carrier`/`Load`/`Tenant` models first to match relation style + the `Tenant`/`Carrier` back-relation convention.

- [ ] **Step 1: Add the enum** (near the other billing enums):
```prisma
enum FreightAuditStatus {
  RECEIVED
  MATCHED
  FLAGGED
  DISPUTED
  RESOLVED
  PAID
}
```

- [ ] **Step 2: Add the models**:
```prisma
model IncomingCarrierInvoice {
  id                  String             @id @default(cuid())
  tenantId            String
  carrierId           String
  carrierInvoiceNumber String
  currency            String             @default("CAD")
  chargedTotal        Decimal
  receivedAt          DateTime           @default(now())
  status              FreightAuditStatus @default(RECEIVED)
  matchedTotal        Decimal?
  varianceTotal       Decimal?
  varianceGross       Decimal?
  recoveredAmount     Decimal            @default(0)
  resolution          String?
  disputeReasonCode   String?
  disputeNote         String?
  auditedAt           DateTime?
  resolvedAt          DateTime?
  paidAt              DateTime?
  sourceRef           String             @default("manual")
  disputedByAgentId   String?
  createdById         String?
  createdAt           DateTime           @default(now())
  updatedAt           DateTime           @updatedAt

  tenant  Tenant                 @relation(fields: [tenantId], references: [id])
  carrier Carrier                @relation(fields: [carrierId], references: [id])
  lines   IncomingInvoiceLine[]

  @@index([tenantId, status])
  @@map("incoming_carrier_invoices")
}

model IncomingInvoiceLine {
  id             String   @id @default(cuid())
  invoiceId      String
  lineRef        String
  description    String?
  chargedAmount  Decimal
  matchedLoadId  String?
  expectedAmount Decimal?
  variance       Decimal?

  invoice IncomingCarrierInvoice @relation(fields: [invoiceId], references: [id], onDelete: Cascade)

  @@index([invoiceId])
  @@map("incoming_invoice_lines")
}
```

- [ ] **Step 3: Add back-relations** — in `model Tenant` add `incomingCarrierInvoices IncomingCarrierInvoice[]`; in `model Carrier` add `incomingCarrierInvoices IncomingCarrierInvoice[]`. (Match the existing back-relation arrays on those models.)

- [ ] **Step 4: Migrate + build** (DB up):
```bash
cd packages/database
pnpm exec dotenv -e ../../.env -- prisma migrate dev --name phase16_freight_audit
cd ../..
pnpm --filter @pulsar/database build
```
Expected: migration with `CREATE TYPE "FreightAuditStatus"`, `CREATE TABLE "incoming_carrier_invoices"` + `"incoming_invoice_lines"` (FK + indexes). Build clean. If drift/reset prompted, STOP and report.

- [ ] **Step 5: Reseed** (so the admin role gets the new perms from Task 3 + clean state): `pnpm db:seed`.

- [ ] **Step 6: Commit**
```bash
git add packages/database/prisma/schema.prisma packages/database/prisma/migrations
git commit -m "feat(db): IncomingCarrierInvoice + IncomingInvoiceLine + FreightAuditStatus (24th migration)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: API — FreightAuditService (the matching engine)

**Files:** Create `apps/api/src/modules/billing/freight-audit/freight-audit.service.ts`, `dto/freight-audit.dto.ts`, `freight-audit.service.spec.ts`.

This is the core. It depends on Tasks 1–4. READ `apps/api/src/modules/billing/invoices.service.ts` (the `tolerances()` reader + `reconcile` TOCTOU pattern to mirror) and `apps/api/src/core/operating/domain-events.service.ts` (`emit(tenantId, type, subject, payload)`).

- [ ] **Step 1: DTOs** — create `dto/freight-audit.dto.ts`:

```ts
import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsIn, IsNumber, IsOptional, IsString, ValidateNested } from 'class-validator';
import { DisputeReasonCode } from '@pulsar/shared';

class IncomingLineDto {
  @IsString() lineRef!: string;
  @IsOptional() @IsString() description?: string;
  @IsNumber() chargedAmount!: number;
}

export class CreateIncomingInvoiceDto {
  @IsString() carrierId!: string;
  @IsString() carrierInvoiceNumber!: string;
  @IsOptional() @IsString() currency?: string;
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => IncomingLineDto)
  lines!: IncomingLineDto[];
}

export class FreightDisputeDto {
  @IsIn(Object.values(DisputeReasonCode)) reasonCode!: DisputeReasonCode;
  @IsOptional() @IsString() note?: string;
}

export class FreightResolveDto {
  @IsIn(['ACCEPT_CHARGED', 'KEEP_EXPECTED']) resolution!: 'ACCEPT_CHARGED' | 'KEEP_EXPECTED';
  @IsIn(Object.values(DisputeReasonCode)) reasonCode!: DisputeReasonCode;
  @IsOptional() @IsString() note?: string;
}

export class FreightPayDto {
  @IsOptional() @IsString() paidAt?: string;
}
```

- [ ] **Step 2: Write the failing test** — `freight-audit.service.spec.ts`:

```ts
import { FreightAuditStatus } from '@pulsar/shared';
import { FreightAuditService } from './freight-audit.service';

function makeService(loads: Record<string, { id: string; estimatedCost: number | null }>) {
  const invoice: any = {
    id: 'inv1', tenantId: 't1', carrierId: 'c1', currency: 'CAD', status: FreightAuditStatus.RECEIVED,
    lines: [
      { id: 'l1', lineRef: 'LD-1', chargedAmount: 100 },
      { id: 'l2', lineRef: 'LD-2', chargedAmount: 500 },
    ],
  };
  const updates: any = { header: null, lines: [] };
  const prisma = {
    incomingCarrierInvoice: {
      findFirst: async () => invoice,
      updateMany: async ({ where, data }: any) => { if (where.status === undefined || invoice.status === where.status || (where.status?.in ?? []).includes(invoice.status)) { updates.header = data; Object.assign(invoice, data); return { count: 1 }; } return { count: 0 }; },
    },
    incomingInvoiceLine: { update: async ({ where, data }: any) => { updates.lines.push({ where, data }); return {}; } },
    load: { findFirst: async ({ where }: any) => loads[where.loadNumber] ?? null },
    tenantModule: { findFirst: async () => ({ settings: {} }) },
    $transaction: async (ops: any[]) => Promise.all(ops),
  } as any;
  const audit = { log: async () => undefined } as any;
  const domainEvents = { emit: async () => undefined } as any;
  return { svc: new FreightAuditService(prisma, audit, domainEvents), invoice, updates };
}

describe('FreightAuditService.audit', () => {
  it('FLAGGED when a matched line is overcharged beyond tolerance', async () => {
    // LD-1 expected 100 (match), LD-2 expected 400 but charged 500 → +100 variance
    const { svc, invoice } = makeService({ 'LD-1': { id: 'a', estimatedCost: 100 }, 'LD-2': { id: 'b', estimatedCost: 400 } });
    const res = await svc.audit('t1', 'u1', 'inv1');
    expect(res.status).toBe(FreightAuditStatus.FLAGGED);
    expect(Number(invoice.varianceTotal)).toBe(100);
  });
  it('MATCHED when within tolerance', async () => {
    const { svc, invoice } = makeService({ 'LD-1': { id: 'a', estimatedCost: 100 }, 'LD-2': { id: 'b', estimatedCost: 500 } });
    const res = await svc.audit('t1', 'u1', 'inv1');
    expect(res.status).toBe(FreightAuditStatus.MATCHED);
  });
  it('FLAGGED when a line cannot be matched to a load (unverifiable)', async () => {
    const { svc, invoice } = makeService({ 'LD-1': { id: 'a', estimatedCost: 100 } }); // LD-2 missing
    const res = await svc.audit('t1', 'u1', 'inv1');
    expect(res.status).toBe(FreightAuditStatus.FLAGGED);
  });
});
```
> The mock returns the invoice by reference; `audit` mutates header fields via `updateMany`. The `res` is the re-read invoice — return `this.get(...)` which the mock's `findFirst` serves (same object). Assert on `invoice` after.

- [ ] **Step 3: Run → FAIL** — `pnpm --filter @pulsar/api test -- freight-audit.service`.

- [ ] **Step 4: Implement** — `freight-audit.service.ts`:

```ts
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  AuditAction,
  FreightAuditStatus,
  MODULE_KEYS,
  canTransitionFreightAudit,
  evaluateReconciliation,
} from '@pulsar/shared';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogsService } from '../../../core/audit-logs/audit-logs.service';
import { DomainEventsService } from '../../../core/operating/domain-events.service';
import { CreateIncomingInvoiceDto, FreightDisputeDto, FreightResolveDto } from './dto/freight-audit.dto';

const invoiceInclude = { lines: true, carrier: { select: { id: true, code: true, name: true } } } as const;
const round = (n: number) => Math.round(n * 100) / 100;

@Injectable()
export class FreightAuditService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
    private readonly domainEvents: DomainEventsService,
  ) {}

  private async get(tenantId: string, id: string) {
    const invoice = await this.prisma.incomingCarrierInvoice.findFirst({ where: { id, tenantId }, include: invoiceInclude });
    if (!invoice) throw new NotFoundException('Incoming carrier invoice not found');
    return invoice;
  }

  list(tenantId: string, status?: FreightAuditStatus) {
    return this.prisma.incomingCarrierInvoice.findMany({
      where: { tenantId, ...(status ? { status } : {}) },
      orderBy: { receivedAt: 'desc' },
      take: 50,
      include: invoiceInclude,
    });
  }

  getOne(tenantId: string, id: string) {
    return this.get(tenantId, id);
  }

  /** Intake: persist the carrier's invoice + lines, emit the domain event (best-effort). */
  async create(tenantId: string, userId: string, dto: CreateIncomingInvoiceDto) {
    const chargedTotal = round(dto.lines.reduce((a, l) => a + l.chargedAmount, 0));
    const created = await this.prisma.incomingCarrierInvoice.create({
      data: {
        tenantId,
        carrierId: dto.carrierId,
        carrierInvoiceNumber: dto.carrierInvoiceNumber,
        currency: dto.currency ?? 'CAD',
        chargedTotal,
        createdById: userId,
        lines: { create: dto.lines.map((l) => ({ lineRef: l.lineRef, description: l.description, chargedAmount: l.chargedAmount })) },
      },
      include: invoiceInclude,
    });
    await this.audit.log({ tenantId, userId, action: AuditAction.CREATE, entityType: 'incoming-carrier-invoice', entityId: created.id, after: { carrierInvoiceNumber: dto.carrierInvoiceNumber, lines: dto.lines.length } });
    await this.domainEvents.emit(tenantId, 'carrier-invoice.received', { type: 'incoming-carrier-invoice', id: created.id }, { invoiceId: created.id, carrierId: dto.carrierId });
    return created;
  }

  /** Tenant billing tolerances (defaults 2 % / 25) — same source as the buy-side reconcile. */
  private async tolerances(tenantId: string) {
    const tm = await this.prisma.tenantModule.findFirst({ where: { tenantId, module: { key: MODULE_KEYS.BILLING } } });
    const s = (tm?.settings ?? {}) as { tolerancePct?: unknown; toleranceAbsolute?: unknown };
    const sane = (v: unknown, fb: number) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : fb; };
    return { tolerancePct: sane(s.tolerancePct, 2), toleranceAbsolute: sane(s.toleranceAbsolute, 25) };
  }

  /** Deterministic match: each line → Load by loadNumber (tenant + carrier scoped), variance vs frozen estimatedCost. */
  async audit(tenantId: string, userId: string, id: string) {
    const invoice = await this.get(tenantId, id);
    if (invoice.status !== FreightAuditStatus.RECEIVED && invoice.status !== FreightAuditStatus.FLAGGED) {
      throw new BadRequestException('Only RECEIVED or FLAGGED invoices can be (re-)audited');
    }
    let unmatched = 0;
    const lineWrites = [];
    const matched: { expected: number; invoiced: number }[] = [];
    for (const line of invoice.lines) {
      const load = await this.prisma.load.findFirst({
        where: { tenantId, carrierId: invoice.carrierId, loadNumber: line.lineRef },
        select: { id: true, estimatedCost: true },
      });
      if (!load || load.estimatedCost === null) {
        unmatched++;
        lineWrites.push(this.prisma.incomingInvoiceLine.update({ where: { id: line.id }, data: { matchedLoadId: null, expectedAmount: null, variance: null } }));
        continue;
      }
      const expected = Number(load.estimatedCost);
      const invoiced = Number(line.chargedAmount);
      matched.push({ expected, invoiced });
      lineWrites.push(this.prisma.incomingInvoiceLine.update({ where: { id: line.id }, data: { matchedLoadId: load.id, expectedAmount: expected, variance: round(invoiced - expected) } }));
    }
    const outcome = evaluateReconciliation(matched, await this.tolerances(tenantId));
    const matchedTotal = round(matched.reduce((a, m) => a + m.expected, 0));
    const next = outcome.withinTolerance && unmatched === 0 ? FreightAuditStatus.MATCHED : FreightAuditStatus.FLAGGED;
    if (!canTransitionFreightAudit(invoice.status as FreightAuditStatus, next)) {
      throw new BadRequestException(`Cannot move freight audit from ${invoice.status} to ${next}`);
    }
    const tx = await this.prisma.$transaction([
      ...lineWrites,
      this.prisma.incomingCarrierInvoice.updateMany({
        where: { id, tenantId, status: { in: [FreightAuditStatus.RECEIVED, FreightAuditStatus.FLAGGED] } },
        data: { status: next, matchedTotal, varianceTotal: outcome.varianceTotal, varianceGross: outcome.varianceGross, auditedAt: new Date() },
      }),
    ]);
    if ((tx[tx.length - 1] as { count: number }).count === 0) throw new BadRequestException('Invoice state changed concurrently — retry');
    await this.audit.log({ tenantId, userId, action: AuditAction.STATUS_CHANGE, entityType: 'incoming-carrier-invoice', entityId: id, before: { status: invoice.status }, after: { status: next, varianceGross: outcome.varianceGross, unmatched } });
    return this.get(tenantId, id);
  }

  async dispute(tenantId: string, actorId: string, id: string, dto: FreightDisputeDto, agentId?: string) {
    const invoice = await this.get(tenantId, id);
    if (!canTransitionFreightAudit(invoice.status as FreightAuditStatus, FreightAuditStatus.DISPUTED)) {
      throw new BadRequestException(`Only FLAGGED invoices can be disputed`);
    }
    const { count } = await this.prisma.incomingCarrierInvoice.updateMany({
      where: { id, tenantId, status: FreightAuditStatus.FLAGGED },
      data: { status: FreightAuditStatus.DISPUTED, disputeReasonCode: dto.reasonCode, disputeNote: dto.note, disputedByAgentId: agentId ?? null },
    });
    if (count === 0) throw new BadRequestException('Only FLAGGED invoices can be disputed');
    await this.audit.log({ tenantId, userId: actorId, action: AuditAction.STATUS_CHANGE, entityType: 'incoming-carrier-invoice', entityId: id, before: { status: invoice.status }, after: { status: 'DISPUTED', reasonCode: dto.reasonCode } });
    return this.get(tenantId, id);
  }

  /** KEEP_EXPECTED books the recovered overcharge (variance > 0). ACCEPT_CHARGED recovers nothing. */
  async resolve(tenantId: string, userId: string, id: string, dto: FreightResolveDto) {
    const invoice = await this.get(tenantId, id);
    if (!canTransitionFreightAudit(invoice.status as FreightAuditStatus, FreightAuditStatus.RESOLVED)) {
      throw new BadRequestException('Only DISPUTED invoices can be resolved');
    }
    const variance = Number(invoice.varianceTotal ?? 0);
    const recovered = dto.resolution === 'KEEP_EXPECTED' && variance > 0 ? round(variance) : 0;
    const { count } = await this.prisma.incomingCarrierInvoice.updateMany({
      where: { id, tenantId, status: FreightAuditStatus.DISPUTED },
      data: { status: FreightAuditStatus.RESOLVED, resolution: dto.resolution, disputeReasonCode: dto.reasonCode, disputeNote: dto.note, recoveredAmount: recovered, resolvedAt: new Date() },
    });
    if (count === 0) throw new BadRequestException('Only DISPUTED invoices can be resolved');
    await this.audit.log({ tenantId, userId, action: AuditAction.STATUS_CHANGE, entityType: 'incoming-carrier-invoice', entityId: id, before: { status: 'DISPUTED' }, after: { status: 'RESOLVED', resolution: dto.resolution, recovered } });
    return this.get(tenantId, id);
  }

  async markPaid(tenantId: string, userId: string, id: string, paidAt?: string) {
    const invoice = await this.get(tenantId, id);
    if (!canTransitionFreightAudit(invoice.status as FreightAuditStatus, FreightAuditStatus.PAID)) {
      throw new BadRequestException('Only MATCHED or RESOLVED invoices can be paid');
    }
    const { count } = await this.prisma.incomingCarrierInvoice.updateMany({
      where: { id, tenantId, status: { in: [FreightAuditStatus.MATCHED, FreightAuditStatus.RESOLVED] } },
      data: { status: FreightAuditStatus.PAID, paidAt: paidAt ? new Date(paidAt) : new Date() },
    });
    if (count === 0) throw new BadRequestException('Only MATCHED or RESOLVED invoices can be paid');
    await this.audit.log({ tenantId, userId, action: AuditAction.STATUS_CHANGE, entityType: 'incoming-carrier-invoice', entityId: id, after: { status: 'PAID' } });
    return this.get(tenantId, id);
  }

  /** Recovered-savings rollup (the real $ deferred from phase 15). */
  async savings(tenantId: string, days = 30) {
    const since = new Date(Date.now() - days * 86_400_000);
    const resolved = await this.prisma.incomingCarrierInvoice.findMany({
      where: { tenantId, status: { in: [FreightAuditStatus.RESOLVED, FreightAuditStatus.PAID] }, resolvedAt: { gte: since } },
      select: { recoveredAmount: true, disputedByAgentId: true },
    });
    const tenantTotal = round(resolved.reduce((a, r) => a + Number(r.recoveredAmount), 0));
    const byAgentMap = new Map<string, number>();
    for (const r of resolved) {
      if (!r.disputedByAgentId) continue;
      byAgentMap.set(r.disputedByAgentId, round((byAgentMap.get(r.disputedByAgentId) ?? 0) + Number(r.recoveredAmount)));
    }
    return { tenantTotal, byAgent: [...byAgentMap].map(([agentId, recovered]) => ({ agentId, recovered })) };
  }
}
```

- [ ] **Step 5: Run test + build** — `pnpm --filter @pulsar/api test -- freight-audit.service` (3 PASS); `pnpm --filter @pulsar/api build` (the service isn't wired into a module yet — tsc still compiles; build clean).

- [ ] **Step 6: Commit**
```bash
git add apps/api/src/modules/billing/freight-audit/
git commit -m "feat(api): FreightAuditService — deterministic carrier-invoice matching + dispute + savings

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: API — controller + Billing module wiring

**Files:** Create `freight-audit.controller.ts`; Modify `billing.module.ts`.

- [ ] **Step 1: Controller** — `apps/api/src/modules/billing/freight-audit/freight-audit.controller.ts`:

```ts
import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '@pulsar/shared';
import { FreightAuditStatus, MODULE_KEYS, PERMISSIONS } from '@pulsar/shared';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { RequireModule } from '../../../common/decorators/require-module.decorator';
import { FreightAuditService } from './freight-audit.service';
import { CreateIncomingInvoiceDto, FreightDisputeDto, FreightResolveDto, FreightPayDto } from './dto/freight-audit.dto';

@ApiTags('billing/freight-audit')
@ApiBearerAuth()
@RequireModule(MODULE_KEYS.BILLING)
@Controller('freight-audit')
export class FreightAuditController {
  constructor(private readonly service: FreightAuditService) {}

  @Get('savings')
  @RequirePermissions(PERMISSIONS.BILLING.FREIGHT_AUDIT_READ)
  savings(@CurrentUser() user: AuthUser, @Query('days') days?: string) {
    return this.service.savings(user.tenantId, days ? Number(days) : 30);
  }

  @Get('incoming-invoices')
  @RequirePermissions(PERMISSIONS.BILLING.FREIGHT_AUDIT_READ)
  list(@CurrentUser() user: AuthUser, @Query('status') status?: FreightAuditStatus) {
    return this.service.list(user.tenantId, status);
  }

  @Get('incoming-invoices/:id')
  @RequirePermissions(PERMISSIONS.BILLING.FREIGHT_AUDIT_READ)
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.getOne(user.tenantId, id);
  }

  @Post('incoming-invoices')
  @RequirePermissions(PERMISSIONS.BILLING.FREIGHT_AUDIT_MANAGE)
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateIncomingInvoiceDto) {
    return this.service.create(user.tenantId, user.id, dto);
  }

  @Post('incoming-invoices/:id/audit')
  @RequirePermissions(PERMISSIONS.BILLING.FREIGHT_AUDIT_MANAGE)
  audit(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.audit(user.tenantId, user.id, id);
  }

  @Post('incoming-invoices/:id/dispute')
  @RequirePermissions(PERMISSIONS.BILLING.FREIGHT_AUDIT_MANAGE)
  dispute(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: FreightDisputeDto) {
    return this.service.dispute(user.tenantId, user.id, id, dto);
  }

  @Post('incoming-invoices/:id/resolve')
  @RequirePermissions(PERMISSIONS.BILLING.FREIGHT_AUDIT_MANAGE)
  resolve(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: FreightResolveDto) {
    return this.service.resolve(user.tenantId, user.id, id, dto);
  }

  @Post('incoming-invoices/:id/pay')
  @RequirePermissions(PERMISSIONS.BILLING.FREIGHT_AUDIT_MANAGE)
  pay(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: FreightPayDto) {
    return this.service.markPaid(user.tenantId, user.id, id, dto.paidAt);
  }
}
```
> Confirm `RequireModule` decorator import path against an existing business controller (e.g. `invoices.controller.ts`); match it. Route order: `savings` + `incoming-invoices` literals before `:id` params (they're distinct path segments so no shadow, but keep `savings` first).

- [ ] **Step 2: Wire BillingModule** — modify `billing.module.ts`:
- Import `forwardRef` from `@nestjs/common`, `OperatingModule` from `../../core/operating/operating.module`, and the freight-audit controller/service.
- Add `forwardRef(() => OperatingModule)` to `imports` (FreightAuditService needs `DomainEventsService`).
- Add `FreightAuditController` to `controllers`, `FreightAuditService` to `providers`, and `FreightAuditService` to a new `exports: [FreightAuditService]` (Task 7's agent adapter injects it).

```ts
@Module({
  imports: [AuditLogsModule, EmailModule, TransportationModule, forwardRef(() => OperatingModule)],
  controllers: [InvoicesController, CustomerInvoicesController, FreightAuditController],
  providers: [InvoicesService, CustomerInvoicesService, FreightAuditService],
  exports: [FreightAuditService],
})
export class BillingModule {}
```

- [ ] **Step 3: Build + DI boot check** — `pnpm --filter @pulsar/api build` (clean). The OperatingModule↔AgentsModule↔BillingModule import graph may form a cycle once Task 7 adds AgentsModule→BillingModule; for now (Task 6) BillingModule→OperatingModule(forwardRef) should resolve. If build/boot complains, the forwardRef on OperatingModule import is the lever. Run an existing billing-ish e2e if quick to confirm boot, else defer to Task 9 e2e.

- [ ] **Step 4: Commit**
```bash
git add apps/api/src/modules/billing/freight-audit/freight-audit.controller.ts apps/api/src/modules/billing/billing.module.ts
git commit -m "feat(api): freight-audit controller + Billing module wiring

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: API — agent tools (audit + dispute) + AgentsModule wiring

**Files:** Modify `apps/api/src/core/agents/tool-registry.ts`, `apps/api/src/core/agents/agents.module.ts`.

This adds the two freight-audit tools to the registry and wires `FreightAuditService` into the `AGENT_TOOL_SERVICES` adapter. ⚠️ DI: AgentsModule will import BillingModule; BillingModule imports `forwardRef(OperatingModule)`; OperatingModule imports `forwardRef(AgentsModule)`. This is a 3-module cycle — use `forwardRef` on the AgentsModule→BillingModule import (and keep BillingModule→OperatingModule forwardRef) and verify the app boots (run a quick e2e). Mirror the phase-14 cycle-resolution approach: build, then boot-check, add forwardRef where Nest's resolver complains.

READ `tool-registry.ts` (the `ToolServices` interface + `ToolDef` shape + `dispute`/`amountFrom` examples) and `agents.module.ts` (the `AGENT_TOOL_SERVICES` `useFactory`/`inject`).

- [ ] **Step 1: Extend `ToolServices`** — in `tool-registry.ts`, add to the interface:
```ts
  freightAudit: {
    audit(tenantId: string, userId: string, invoiceId: string): Promise<unknown>;
    dispute(tenantId: string, actorId: string, invoiceId: string, dto: { reasonCode: string; note?: string }, agentId?: string): Promise<unknown>;
    variance(tenantId: string, invoiceId: string): Promise<number | undefined>;
  };
```
> `variance` is a tiny read helper for `amountFrom` (the dispute cap). Add it to `FreightAuditService` (Task 5 file) — a method `async varianceOf(tenantId, id): Promise<number | undefined>` returning `Number(invoice.varianceTotal ?? undefined)`; OR derive `amountFrom` from args. SIMPLER: have the agent pass the disputed amount in args. To avoid an extra DB read in `amountFrom` (which is sync), the dispute tool's `amountFrom` reads an OPTIONAL `amount` arg the agent supplies (like `tender_load` does). Use that pattern — see Step 3. So DROP `variance` from ToolServices; `amountFrom` uses `args.amount`.

Final `ToolServices.freightAudit`:
```ts
  freightAudit: {
    audit(tenantId: string, userId: string, invoiceId: string): Promise<unknown>;
    dispute(tenantId: string, actorId: string, invoiceId: string, dto: { reasonCode: string; note?: string }, agentId?: string): Promise<unknown>;
  };
```

- [ ] **Step 2: Add the tool defs** — append to `TOOL_REGISTRY` (use `PERMISSIONS.BILLING.FREIGHT_AUDIT_*`, `MODULE_KEYS.BILLING`, `DisputeReasonCode`):
```ts
  {
    name: 'audit_carrier_invoice',
    description: 'Run the deterministic match of an incoming carrier invoice against expected load costs. Returns the variance summary and per-line results. Read-only.',
    tier: RiskTier.READ,
    permission: PERMISSIONS.BILLING.FREIGHT_AUDIT_READ,
    module: MODULE_KEYS.BILLING,
    inputSchema: z.object({ invoiceId: z.string().min(1) }),
    run: (args, ctx) => ctx.services.freightAudit.audit(ctx.principal.user.tenantId, ctx.principal.user.id, args.invoiceId as string),
  },
  {
    name: 'dispute_carrier_invoice',
    description: 'Open a dispute on a FLAGGED incoming carrier invoice. SENSITIVE — goes through the approval queue.',
    tier: RiskTier.SENSITIVE,
    permission: PERMISSIONS.BILLING.FREIGHT_AUDIT_MANAGE,
    module: MODULE_KEYS.BILLING,
    inputSchema: z.object({
      invoiceId: z.string().min(1),
      reasonCode: z.string().min(1),
      note: z.string().optional(),
      // `amount` (the disputed overcharge) is accepted for the cap check only.
      amount: z.number().optional(),
    }),
    run: (args, ctx) =>
      ctx.services.freightAudit.dispute(
        ctx.principal.user.tenantId,
        ctx.principal.user.id,
        args.invoiceId as string,
        { reasonCode: args.reasonCode as string, note: args.note as string | undefined },
        ctx.principal.agentId,
      ),
    amountFrom: (args) => (typeof args.amount === 'number' ? args.amount : undefined),
  },
```
> `audit_carrier_invoice` runs `audit()` which mutates status RECEIVED→MATCHED/FLAGGED. That's a state change but it's deterministic bookkeeping, idempotent, and not an outward action — keep it READ tier so the agent can run it live (it must audit before it can decide to dispute). The genuinely sensitive act (opening a dispute) is the SENSITIVE tool that queues. This matches the design (agent audits live, proposes the dispute).

- [ ] **Step 3: Wire the adapter** — in `agents.module.ts`:
- Add `import { forwardRef } ...` (already imported) and `import { BillingModule } from '../../modules/billing/billing.module';` and `import { FreightAuditService } from '../../modules/billing/freight-audit/freight-audit.service';`.
- Add `forwardRef(() => BillingModule)` to `imports`.
- Add `FreightAuditService` to the `AGENT_TOOL_SERVICES` provider's `inject` array and `useFactory` params, and add the `freightAudit` adapter object to the returned `ToolServices`:
```ts
        freightAudit: {
          audit: (t, u, id) => freightAudit.audit(t, u, id),
          dispute: (t, a, id, dto, agentId) => freightAudit.dispute(t, a, id, dto as never, agentId),
        },
```
(add `freightAudit: FreightAuditService` to the factory signature + `FreightAuditService` to `inject`).

- [ ] **Step 4: Build + DI boot check**
- `pnpm --filter @pulsar/api build` → clean.
- Boot-check the DI cycle: run an existing agents e2e against the seeded DB to confirm the app boots: `pnpm --filter @pulsar/api test:e2e -- phase11-agents` (or phase13/14). If Nest throws a circular-dependency error, adjust forwardRef on the AgentsModule↔BillingModule / BillingModule↔OperatingModule edges until it resolves (do whatever it takes; the cycle is real and forwardRef is the tool). Report which edges needed forwardRef.

- [ ] **Step 5: Commit**
```bash
git add apps/api/src/core/agents/tool-registry.ts apps/api/src/core/agents/agents.module.ts
git commit -m "feat(api): audit_carrier_invoice + dispute_carrier_invoice agent tools

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Web — freight-audit pages + nav

**Files:** Create `apps/web/src/routes/(app)/billing/freight-audit/+page.svelte` + `[id]/+page.svelte`; Modify the app nav (`apps/web/src/routes/(app)/+layout.svelte`).

READ an existing billing page (e.g. the invoices list/detail under `apps/web/src/routes/(app)/billing/`) and `+layout.svelte` first to match patterns (Card/Badge/Button, `api()`, `$state`/`$effect`, nav gating on `$auth.tenant.enabledModules`).

- [ ] **Step 1: List page** — `freight-audit/+page.svelte`: load `GET /freight-audit/incoming-invoices`, render a table (carrier, carrierInvoiceNumber, chargedTotal, status badge, varianceGross), a header showing `GET /freight-audit/savings` `tenantTotal` ("Économies récupérées (30 j)"), and a link to each `[id]`. Match the existing billing list page's markup. Include a minimal "create" affordance (a form/modal posting `POST /freight-audit/incoming-invoices` with carrierId + carrierInvoiceNumber + lines) OR defer create to API/agent only — keep the list+detail+savings as the core; a create form is optional (note if deferred).

- [ ] **Step 2: Detail page** — `freight-audit/[id]/+page.svelte`: load `GET /freight-audit/incoming-invoices/:id`; show header (status, totals, variance, recoveredAmount), the lines table (lineRef, chargedAmount, matchedLoadId, expectedAmount, variance), and action buttons gated by status: `Auditer` (POST :id/audit) when RECEIVED/FLAGGED, `Disputer` (POST :id/dispute with a reasonCode select) when FLAGGED, `Résoudre` (POST :id/resolve with resolution + reasonCode) when DISPUTED, `Payer` (POST :id/pay) when MATCHED/RESOLVED. Refresh after each. Use `loading`/`disabled` on buttons (phase-13 idiom).

- [ ] **Step 3: Nav** — in `+layout.svelte`, add a "Freight Audit" link under the Billing section, conditioned on `$auth.tenant.enabledModules` including the billing key (match how existing billing links are gated).

- [ ] **Step 4: Build + typecheck** — `pnpm --filter @pulsar/web build` (clean); `pnpm --filter @pulsar/web typecheck` (0 errors).

- [ ] **Step 5: Commit**
```bash
git add "apps/web/src/routes/(app)/billing/freight-audit/" "apps/web/src/routes/(app)/+layout.svelte"
git commit -m "feat(web): freight-audit pages (incoming invoices, line matching, dispute) + nav

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Phase-16 e2e

**Files:** Create `apps/api/test/phase16-freight-audit.e2e-spec.ts`.

Reuse the phase-14/15 bootstrap (FakeAgentRuntimeService, login admin@pulsar.dev/acme, `prisma = app.get(PrismaService)`, token-minting `/mcp` driver, `afterAll` cleanup). The acme tenant must have BILLING enabled — enable it via prisma if not (find the tenantModule for billing and set enabled, or call the modules toggle endpoint). Seed a Carrier + two COMPLETED Loads with `estimatedCost` and `loadNumber`s.

- [ ] **Step 1: Scenarios** (adapt to real behavior; never weaken intent):
1. **Human audit path**: `POST /freight-audit/incoming-invoices` with carrierId + 2 lines (lineRef = the two load numbers; one charged == estimatedCost, one charged 25%+ over) → `POST :id/audit` → status FLAGGED, line variances correct, matchedLoadId set. `POST :id/dispute` {reasonCode} → DISPUTED. `POST :id/resolve` {resolution:'KEEP_EXPECTED', reasonCode} → RESOLVED, recoveredAmount == the overcharge. `GET /freight-audit/savings` → tenantTotal >= recoveredAmount.
2. **Within tolerance**: an invoice where both lines match estimatedCost → audit → MATCHED → `POST :id/pay` → PAID.
3. **Unmatched line forces FLAGGED**: a line with a lineRef that's not a load → audit → FLAGGED.
4. **estimatedCost frozen (rule 16)**: capture a load's estimatedCost before audit; after audit, re-read → unchanged.
5. **Agent path**: register an always-on agent handling 'FREIGHT_AUDIT' (caps.alwaysOn + handlesCategories:['FREIGHT_AUDIT'], permissions incl. billing.freight-audit.read|manage, autonomy PROPOSE). Intake an invoice → `domainEvents.processPending` → an OperationalTask category FREIGHT_AUDIT assigned to the agent. Drive the agent via the `/mcp` token (like phase-14): call `audit_carrier_invoice` (READ → runs live, returns summary) then `dispute_carrier_invoice` {invoiceId, reasonCode, amount} → response `queued` PENDING; assert a `ProposedAction` tool=`dispute_carrier_invoice`, status PENDING, riskTier SENSITIVE, triggeredByRef = `task:<id>`.
6. **Isolation**: a line referencing a load of another carrier → unmatched (the carrier-scoped `findFirst`).

- [ ] **Step 2: Run** — `pnpm db:migrate && pnpm db:seed` if needed; `pnpm --filter @pulsar/api test:e2e -- phase16-freight-audit` → all pass, run 2×. Regression: `pnpm --filter @pulsar/api test:e2e -- phase13-workforce phase14-autonomy phase15a-control-tower phase16-freight-audit`.

- [ ] **Step 3: Commit**
```bash
git add apps/api/test/phase16-freight-audit.e2e-spec.ts
git commit -m "test(api): phase-16 e2e — audit/dispute/resolve, savings, agent dispute via gate, rule-16 frozen cost

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: Rule 31 + docs + full verification

**Files:** `CLAUDE.md`, `ROADMAP.md`, `docs/etat-du-projet.md`.

- [ ] **Step 1: Hard rule 31 in `CLAUDE.md`** — after the phase-15 rule 30 block, add the "## Hard rules (continued, phase 16)" block with rule 31 verbatim from the design spec §G.

- [ ] **Step 2: `ROADMAP.md`** — mark phase 16 shipped (`✅ **16 — Freight Audit autonome**`), one-line summary (decoupled incoming invoice, deterministic matching vs frozen estimatedCost, dispute agent via the governance queue, recovered-savings KPI; 24th migration, rule 31). Match the phase-15 entry style.

- [ ] **Step 3: `docs/etat-du-projet.md`** — note phase 16 shipped; migrations 23→24; next = phase 17 (continuous planning) or Act III modules. Match the doc's format.

- [ ] **Step 4: Full verification**
```bash
pnpm build
pnpm test
pnpm --filter @pulsar/api test:e2e -- phase13-workforce phase14-autonomy phase15a-control-tower phase16-freight-audit
```
All pass (build shared→database→api→web; all unit suites; e2e green). If anything fails, STOP and report BLOCKED with exact output (docs-only edits fine).

- [ ] **Step 5: Commit**
```bash
git add CLAUDE.md ROADMAP.md docs/etat-du-projet.md
git commit -m "docs(phase-16): hard rule 31 + roadmap/status — autonomous freight audit shipped

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review (completed during planning)

**Spec coverage:**
- Decoupled incoming-invoice entities → Task 4. ✅
- State machine → Task 1. ✅
- Deterministic matching vs frozen estimatedCost + reuse evaluateReconciliation/tolerances → Task 5. ✅
- Dispute/resolve/markPaid + recovered savings → Task 5. ✅
- Domain event + FREIGHT_AUDIT policy → Task 2; intake emit → Task 5. ✅
- Agent tools (READ audit, SENSITIVE dispute via gate) → Task 7. ✅
- Permissions + module gating → Tasks 3, 6. ✅
- Savings endpoint (the $ deferred from phase 15) → Tasks 5, 6. ✅
- Web → Task 8. Rule 31 → Task 10. ✅
- Tests: unit (workflow, policy, service) + e2e (audit/dispute/resolve/savings/agent/isolation/rule-16) → Tasks 1,2,5,9. ✅

**Placeholder scan:** Task 8 marks the create form as optional (list/detail/savings is the core) — explicit scope note, not a vague placeholder. Task 9 allows direct-prisma seeding/BILLING-enable for determinism (explicit). All code steps carry complete code.

**Type consistency:** `FreightAuditStatus`/`canTransitionFreightAudit` (Task 1) used in Tasks 5/6/9. `evaluateReconciliation` reused (existing signature). `ToolServices.freightAudit` (Task 7) matches `FreightAuditService.audit/dispute` signatures (Task 5). `DisputeReasonCode` reused for reason codes. Event type `carrier-invoice.received` consistent between Task 2 (policy) and Task 5 (emit). Permission keys consistent between Tasks 3, 6, 7.

**Known/accepted:** DI cycle Operating↔Agents↔Billing resolved via forwardRef (Tasks 6/7) — flagged with a boot-check, mirroring phase-14's proven approach. `audit_carrier_invoice` is READ tier despite mutating audit bookkeeping (deterministic, idempotent, must run before the agent can decide to dispute — the SENSITIVE act is the dispute, which queues). Multi-currency not converted (same-currency assumed; cross-currency lines would mis-compare — out of scope, documented).
