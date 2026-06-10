# Phase 6D — Rapprochement de factures transporteur : plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capturer la facture réellement reçue du transporteur sur le brouillon existant (montants attendus = coûts estimés), rapprocher automatiquement avec tolérance sur l'écart **brut** (Σ|écart ligne| — attrape les écarts compensés), router en litige hors tolérance, re-rapprocher une facture corrigée, marquer payée, exporter en CSV.

**Architecture:** Pas de nouvelle entité : `Invoice`/`InvoiceLine` gagnent les champs de rapprochement. La règle de tolérance est une fonction pure dans `packages/shared` (`evaluateReconciliation`), testée en vitest ; la machine à états `Invoice` (DRAFT → APPROVED|DISPUTED, DISPUTED → APPROVED, APPROVED → PAID) rejoint les workflows shared (règle 2). Tolérances par tenant dans `TenantModule.settings` du module billing (défauts 2 % / 25). `disputeReasonCode` reste null à l'entrée automatique en litige (décision documentée au spec) — il qualifie le diagnostic humain à la résolution.

**Tech Stack:** packages/shared (vitest), Prisma, NestJS, SvelteKit.

**Référence spec:** spec phase 6 section 3. **Dépendance:** plan 6A pour la config jest unitaire API (facultative ici — l'essentiel des tests unitaires est en vitest côté shared) ; aucun lien avec 6B/6C.

---

### Task 1: Shared — enums, state machine, fonction de tolérance (TDD)

**Files:**
- Modify: `packages/shared/src/enums/billing.ts`
- Create: `packages/shared/src/workflows/invoice.workflow.ts`
- Create: `packages/shared/src/billing/reconciliation.ts`
- Test: `packages/shared/src/billing/__tests__/reconciliation.spec.ts`
- Modify: `packages/shared/src/workflows/__tests__/workflows.spec.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: Étendre les enums billing**

`packages/shared/src/enums/billing.ts` devient :

```ts
/** Billing module enums. Source of truth; mirrored in the Prisma schema. */
export enum InvoiceStatus {
  DRAFT = 'DRAFT',
  APPROVED = 'APPROVED',
  DISPUTED = 'DISPUTED',
  PAID = 'PAID',
}

/**
 * Codified dispute reasons — the basis for future per-carrier variance stats.
 * Deliberately NOT set automatically when a reconciliation lands in DISPUTED:
 * the code qualifies the human diagnosis at resolution time, and a wrong
 * automatic default would pollute exactly those statistics.
 */
export enum DisputeReasonCode {
  RATE_MISMATCH = 'RATE_MISMATCH',
  QUANTITY_MISMATCH = 'QUANTITY_MISMATCH',
  UNEXPECTED_CHARGE = 'UNEXPECTED_CHARGE',
  DUPLICATE_BILLING = 'DUPLICATE_BILLING',
  OTHER = 'OTHER',
}
```

- [ ] **Step 2: Tests vitest qui échouent**

`packages/shared/src/billing/__tests__/reconciliation.spec.ts` :

```ts
import { describe, expect, it } from 'vitest';
import { evaluateReconciliation } from '../reconciliation';

const TOL = { tolerancePct: 2, toleranceAbsolute: 25 };

describe('evaluateReconciliation', () => {
  it('approves when the gross variance is within tolerance', () => {
    const outcome = evaluateReconciliation([{ expected: 800, invoiced: 810 }], TOL);
    expect(outcome.invoicedTotal).toBe(810);
    expect(outcome.varianceTotal).toBe(10);
    expect(outcome.varianceGross).toBe(10);
    expect(outcome.withinTolerance).toBe(true);
  });

  it('catches compensating line errors (net 0, gross over) — the blind-spot test', () => {
    const outcome = evaluateReconciliation(
      [
        { expected: 400, invoiced: 500 },
        { expected: 400, invoiced: 300 },
      ],
      TOL,
    );
    expect(outcome.varianceTotal).toBe(0);
    expect(outcome.varianceGross).toBe(200);
    expect(outcome.withinTolerance).toBe(false);
  });

  it('uses max(absolute, pct) as a floor for small invoices', () => {
    // gross 20 ≤ max(25, 2% of 120 = 2.4) → within tolerance thanks to the floor
    const outcome = evaluateReconciliation([{ expected: 100, invoiced: 120 }], TOL);
    expect(outcome.withinTolerance).toBe(true);
  });

  it('the pct side dominates on large invoices', () => {
    // gross 150 ≤ max(25, 2% of 10150 = 203) → within tolerance
    const outcome = evaluateReconciliation([{ expected: 10000, invoiced: 10150 }], TOL);
    expect(outcome.withinTolerance).toBe(true);
  });

  it('rounds to cents', () => {
    const outcome = evaluateReconciliation([{ expected: 0.1, invoiced: 0.3 }], TOL);
    expect(outcome.varianceGross).toBe(0.2);
  });
});
```

Dans `packages/shared/src/workflows/__tests__/workflows.spec.ts`, ajouter un bloc :

```ts
import { canTransitionInvoice } from '../invoice.workflow';
import { InvoiceStatus } from '../../enums/billing';

describe('invoice workflow', () => {
  it('allows the reconciliation paths', () => {
    expect(canTransitionInvoice(InvoiceStatus.DRAFT, InvoiceStatus.APPROVED)).toBe(true);
    expect(canTransitionInvoice(InvoiceStatus.DRAFT, InvoiceStatus.DISPUTED)).toBe(true);
    expect(canTransitionInvoice(InvoiceStatus.DISPUTED, InvoiceStatus.APPROVED)).toBe(true);
    expect(canTransitionInvoice(InvoiceStatus.APPROVED, InvoiceStatus.PAID)).toBe(true);
  });

  it('blocks the invalid paths', () => {
    expect(canTransitionInvoice(InvoiceStatus.PAID, InvoiceStatus.DRAFT)).toBe(false);
    expect(canTransitionInvoice(InvoiceStatus.APPROVED, InvoiceStatus.DISPUTED)).toBe(false);
    expect(canTransitionInvoice(InvoiceStatus.DISPUTED, InvoiceStatus.PAID)).toBe(false);
  });
});
```

(adapter les imports au style du fichier existant — il importe déjà les autres workflows.)

- [ ] **Step 3: Lancer, vérifier l'échec**

Run: `pnpm --filter @pulsar/shared test`
Expected: FAIL — modules inexistants.

- [ ] **Step 4: Implémenter**

`packages/shared/src/workflows/invoice.workflow.ts` :

```ts
import { InvoiceStatus } from '../enums/billing';

export const INVOICE_TRANSITIONS: Record<InvoiceStatus, InvoiceStatus[]> = {
  // reconcile() routes DRAFT to APPROVED (within tolerance) or DISPUTED.
  [InvoiceStatus.DRAFT]: [InvoiceStatus.APPROVED, InvoiceStatus.DISPUTED],
  // resolve-dispute or a corrected-invoice re-reconcile; staying DISPUTED is a no-op.
  [InvoiceStatus.DISPUTED]: [InvoiceStatus.APPROVED],
  [InvoiceStatus.APPROVED]: [InvoiceStatus.PAID],
  [InvoiceStatus.PAID]: [],
};

export function canTransitionInvoice(from: InvoiceStatus, to: InvoiceStatus): boolean {
  return INVOICE_TRANSITIONS[from]?.includes(to) ?? false;
}
```

`packages/shared/src/billing/reconciliation.ts` :

```ts
export interface ReconciliationLine {
  /** Expected amount (the draft line, from the estimated load cost). */
  expected: number;
  /** Amount on the carrier's actual invoice. */
  invoiced: number;
}

export interface ReconciliationTolerance {
  /** Percent of the invoiced total. */
  tolerancePct: number;
  /** Absolute floor, in the invoice currency — protects small invoices. */
  toleranceAbsolute: number;
}

export interface ReconciliationOutcome {
  invoicedTotal: number;
  /** Net (signed) variance — display only. */
  varianceTotal: number;
  /** Sum of |line variance| — carries the tolerance check. |net| ≤ gross, so a
   *  single gross test also catches compensating line errors (+100/−100). */
  varianceGross: number;
  withinTolerance: boolean;
}

const round = (n: number) => Math.round(n * 100) / 100;

/**
 * Tolerance threshold = max(absolute, invoicedTotal × pct/100): the absolute
 * value floors small invoices. Some customers will want min() (stricter) — that
 * becomes a third `toleranceMode` setting the day it is asked for.
 */
export function evaluateReconciliation(
  lines: ReconciliationLine[],
  tolerance: ReconciliationTolerance,
): ReconciliationOutcome {
  const invoicedTotal = round(lines.reduce((acc, l) => acc + l.invoiced, 0));
  const varianceTotal = round(lines.reduce((acc, l) => acc + (l.invoiced - l.expected), 0));
  const varianceGross = round(
    lines.reduce((acc, l) => acc + Math.abs(l.invoiced - l.expected), 0),
  );
  const threshold = Math.max(
    tolerance.toleranceAbsolute,
    (invoicedTotal * tolerance.tolerancePct) / 100,
  );
  return { invoicedTotal, varianceTotal, varianceGross, withinTolerance: varianceGross <= threshold };
}
```

Dans `packages/shared/src/index.ts`, ajouter :

```ts
export * from './workflows/invoice.workflow';
export * from './billing/reconciliation';
```

- [ ] **Step 5: Lancer, vérifier le succès, rebuild (règle 7)**

Run: `pnpm --filter @pulsar/shared test && pnpm --filter @pulsar/shared build`
Expected: PASS + build OK.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/
git commit -m "feat(shared): invoice workflow (DISPUTED/PAID) + gross-variance reconciliation"
```

---

### Task 2: Permission `billing.invoices.pay`

**Files:**
- Modify: `packages/shared/src/permissions.ts`

- [ ] **Step 1: Ajouter la clé**

Dans `PERMISSIONS.BILLING` :

```ts
    INVOICES_PAY: 'billing.invoices.pay',
```

Dans `PERMISSION_CATALOG`, après les deux entrées billing :

```ts
  billing(PERMISSIONS.BILLING.INVOICES_PAY, 'Mark carrier invoices as paid'),
```

- [ ] **Step 2: Rebuild + reseed (le seed assigne toutes les permissions au rôle admin)**

Run: `pnpm --filter @pulsar/shared build && pnpm db:seed`
Expected: log `Seeded 42 permissions, ...` (40 existantes + pay ; ajuster le compte réel).

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/permissions.ts
git commit -m "feat(shared): billing.invoices.pay permission"
```

---

### Task 3: Prisma — champs de rapprochement (règle 3 : miroir des enums)

**Files:**
- Modify: `packages/database/prisma/schema.prisma`

- [ ] **Step 1: Éditer le schéma**

1. Remplacer l'enum `InvoiceStatus` :

```prisma
enum InvoiceStatus {
  DRAFT
  APPROVED
  DISPUTED
  PAID
}
```

2. Ajouter l'enum :

```prisma
enum DisputeReasonCode {
  RATE_MISMATCH
  QUANTITY_MISMATCH
  UNEXPECTED_CHARGE
  DUPLICATE_BILLING
  OTHER
}
```

3. Dans `model Invoice`, après `approvedAt DateTime?`, ajouter :

```prisma
  // --- Reconciliation against the carrier's actual invoice -------------------
  carrierInvoiceNumber String?
  invoicedTotal        Decimal?           @db.Decimal(12, 2)
  // Net (signed) variance — display; the tolerance rides on varianceGross.
  varianceTotal        Decimal?           @db.Decimal(12, 2)
  varianceGross        Decimal?           @db.Decimal(12, 2)
  // Null until a human qualifies the dispute at resolution time (deliberate).
  disputeReasonCode    DisputeReasonCode?
  disputeNote          String?
  reconciledAt         DateTime?
  paidAt               DateTime?
```

4. Dans `model InvoiceLine`, après `amount` :

```prisma
  invoicedAmount Decimal? @db.Decimal(12, 2)
  variance       Decimal? @db.Decimal(12, 2)
```

5. Mettre à jour le commentaire du modèle `Invoice` (« Approval freezes it (v1 — no payment tracking yet). » → « Reconciled against the carrier's actual invoice (tolerance on gross variance), disputed when over, PAID tracked. »)

- [ ] **Step 2: Migrer + rebuild**

Run: `pnpm db:migrate` (nom : `invoice_reconciliation`) puis `pnpm --filter @pulsar/database build`
Expected: OK.

- [ ] **Step 3: Commit**

```bash
git add packages/database/prisma/
git commit -m "feat(db): invoice reconciliation fields and dispute reason enum"
```

---

### Task 4: API — reconcile / resolve-dispute / mark-paid / export CSV

**Files:**
- Modify: `apps/api/src/modules/billing/invoices.service.ts`
- Modify: `apps/api/src/modules/billing/invoices.controller.ts`
- Create: `apps/api/src/modules/billing/dto/reconcile.dto.ts`

- [ ] **Step 1: DTOs**

`apps/api/src/modules/billing/dto/reconcile.dto.ts` :

```ts
import { Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { DisputeReasonCode } from '@pulsar/shared';

class ReconcileLineDto {
  @IsString()
  lineId!: string;

  @IsNumber()
  invoicedAmount!: number;
}

export class ReconcileInvoiceDto {
  @IsString()
  carrierInvoiceNumber!: string;

  /** Lines omitted here default to the expected amount. */
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReconcileLineDto)
  lines!: ReconcileLineDto[];
}

export class ResolveDisputeDto {
  @IsIn(['ACCEPT_INVOICED', 'KEEP_EXPECTED'])
  resolution!: 'ACCEPT_INVOICED' | 'KEEP_EXPECTED';

  @IsIn(Object.values(DisputeReasonCode))
  reasonCode!: DisputeReasonCode;

  @IsOptional()
  @IsString()
  note?: string;
}

export class MarkPaidDto {
  @IsOptional()
  @IsDateString()
  paidAt?: string;
}
```

- [ ] **Step 2: Service — ajouter les méthodes**

Dans `apps/api/src/modules/billing/invoices.service.ts` :

1. Imports — remplacer la ligne d'import shared et ajouter MODULE_KEYS :

```ts
import {
  AuditAction,
  canTransitionInvoice,
  evaluateReconciliation,
  InvoiceStatus,
  LoadStatus,
  MODULE_KEYS,
} from '@pulsar/shared';
import { ReconcileInvoiceDto, ResolveDisputeDto } from './dto/reconcile.dto';
```

2. `list` gagne un filtre statut optionnel :

```ts
  list(tenantId: string, status?: InvoiceStatus) {
    return this.prisma.invoice.findMany({
      where: { tenantId, ...(status ? { status } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: invoiceInclude,
    });
  }
```

3. Ajouter à la fin de la classe :

```ts
  /** Tenant tolerances from the billing module settings (defaults: 2 % / 25). */
  private async tolerances(tenantId: string) {
    const tenantModule = await this.prisma.tenantModule.findFirst({
      where: { tenantId, module: { key: MODULE_KEYS.BILLING } },
    });
    const settings = (tenantModule?.settings ?? {}) as {
      tolerancePct?: number;
      toleranceAbsolute?: number;
    };
    return {
      tolerancePct: settings.tolerancePct ?? 2,
      toleranceAbsolute: settings.toleranceAbsolute ?? 25,
    };
  }

  /**
   * Captures the carrier's actual invoice and routes by tolerance on the GROSS
   * variance (catches compensating line errors). Allowed from DRAFT and from
   * DISPUTED (corrected invoice: amounts are overwritten, tolerance re-evaluated;
   * staying DISPUTED is a state no-op). disputeReasonCode stays null here on
   * purpose — it qualifies the human diagnosis at resolution time.
   */
  async reconcile(tenantId: string, userId: string, id: string, dto: ReconcileInvoiceDto) {
    const invoice = await this.get(tenantId, id);
    if (invoice.status !== InvoiceStatus.DRAFT && invoice.status !== InvoiceStatus.DISPUTED) {
      throw new BadRequestException('Only DRAFT or DISPUTED invoices can be reconciled');
    }
    const byLine = new Map(dto.lines.map((l) => [l.lineId, l.invoicedAmount]));
    for (const lineId of byLine.keys()) {
      if (!invoice.lines.some((l) => l.id === lineId)) {
        throw new BadRequestException(`Line ${lineId} does not belong to this invoice`);
      }
    }
    const computed = invoice.lines.map((line) => {
      const expected = Number(line.amount);
      const invoiced = byLine.get(line.id) ?? expected;
      return {
        id: line.id,
        expected,
        invoiced,
        variance: Math.round((invoiced - expected) * 100) / 100,
      };
    });
    const outcome = evaluateReconciliation(computed, await this.tolerances(tenantId));
    const next = outcome.withinTolerance ? InvoiceStatus.APPROVED : InvoiceStatus.DISPUTED;
    if (next !== invoice.status && !canTransitionInvoice(invoice.status, next)) {
      throw new BadRequestException(`Cannot move invoice from ${invoice.status} to ${next}`);
    }

    await this.prisma.$transaction([
      ...computed.map((c) =>
        this.prisma.invoiceLine.update({
          where: { id: c.id },
          data: { invoicedAmount: c.invoiced, variance: c.variance },
        }),
      ),
      this.prisma.invoice.update({
        where: { id },
        data: {
          carrierInvoiceNumber: dto.carrierInvoiceNumber,
          invoicedTotal: outcome.invoicedTotal,
          varianceTotal: outcome.varianceTotal,
          varianceGross: outcome.varianceGross,
          reconciledAt: new Date(),
          status: next,
          ...(next === InvoiceStatus.APPROVED ? { approvedAt: new Date() } : {}),
        },
      }),
    ]);
    await this.audit.log({
      tenantId,
      userId,
      action: AuditAction.STATUS_CHANGE,
      entityType: 'invoice',
      entityId: id,
      before: { status: invoice.status },
      after: {
        status: next,
        carrierInvoiceNumber: dto.carrierInvoiceNumber,
        invoicedTotal: outcome.invoicedTotal,
        varianceGross: outcome.varianceGross,
      },
    });
    return this.get(tenantId, id);
  }

  /** Human resolution of a dispute. ACCEPT_INVOICED pays the carrier's figure;
   *  KEEP_EXPECTED pays ours (the carrier issues a credit note out of band). */
  async resolveDispute(tenantId: string, userId: string, id: string, dto: ResolveDisputeDto) {
    const invoice = await this.get(tenantId, id);
    if (invoice.status !== InvoiceStatus.DISPUTED) {
      throw new BadRequestException('Only DISPUTED invoices can be resolved');
    }
    if (dto.resolution === 'ACCEPT_INVOICED' && invoice.invoicedTotal === null) {
      throw new BadRequestException('No invoiced total recorded on this invoice');
    }
    const resolved = await this.prisma.invoice.update({
      where: { id },
      data: {
        status: InvoiceStatus.APPROVED,
        approvedAt: new Date(),
        disputeReasonCode: dto.reasonCode,
        disputeNote: dto.note,
        ...(dto.resolution === 'ACCEPT_INVOICED'
          ? { totalAmount: invoice.invoicedTotal! }
          : {}),
      },
      include: invoiceInclude,
    });
    await this.audit.log({
      tenantId,
      userId,
      action: AuditAction.STATUS_CHANGE,
      entityType: 'invoice',
      entityId: id,
      before: { status: InvoiceStatus.DISPUTED },
      after: { status: InvoiceStatus.APPROVED, resolution: dto.resolution, reasonCode: dto.reasonCode },
    });
    return resolved;
  }

  async markPaid(tenantId: string, userId: string, id: string, paidAt?: string) {
    const invoice = await this.get(tenantId, id);
    if (!canTransitionInvoice(invoice.status as InvoiceStatus, InvoiceStatus.PAID)) {
      throw new BadRequestException('Only APPROVED invoices can be marked paid');
    }
    const paid = await this.prisma.invoice.update({
      where: { id },
      data: { status: InvoiceStatus.PAID, paidAt: paidAt ? new Date(paidAt) : new Date() },
      include: invoiceInclude,
    });
    await this.audit.log({
      tenantId,
      userId,
      action: AuditAction.STATUS_CHANGE,
      entityType: 'invoice',
      entityId: id,
      before: { status: invoice.status },
      after: { status: InvoiceStatus.PAID, paidAt: paid.paidAt },
    });
    return paid;
  }

  /** Filtered list as CSV (expected/invoiced/variance per invoice).
   *  Own query, NOT list(): the list endpoint takes 50 for the UI — an export
   *  silently truncated to 50 invoices would produce wrong reports. */
  async exportCsv(tenantId: string, status?: InvoiceStatus): Promise<string> {
    const invoices = await this.prisma.invoice.findMany({
      where: { tenantId, ...(status ? { status } : {}) },
      orderBy: { createdAt: 'desc' },
      include: invoiceInclude,
    });
    const escape = (value: unknown) => {
      const s = value === null || value === undefined ? '' : String(value);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const header = [
      'invoiceNumber',
      'carrier',
      'status',
      'currency',
      'expectedTotal',
      'invoicedTotal',
      'varianceTotal',
      'varianceGross',
      'carrierInvoiceNumber',
      'disputeReasonCode',
      'approvedAt',
      'paidAt',
      'createdAt',
    ];
    const rows = invoices.map((inv) =>
      [
        inv.invoiceNumber,
        inv.carrier.name,
        inv.status,
        inv.currency,
        inv.totalAmount,
        inv.invoicedTotal,
        inv.varianceTotal,
        inv.varianceGross,
        inv.carrierInvoiceNumber,
        inv.disputeReasonCode,
        inv.approvedAt?.toISOString(),
        inv.paidAt?.toISOString(),
        inv.createdAt.toISOString(),
      ]
        .map(escape)
        .join(','),
    );
    return [header.join(','), ...rows].join('\n');
  }
```

- [ ] **Step 3: Controller — nouveaux endpoints**

Dans `apps/api/src/modules/billing/invoices.controller.ts` :

1. Imports supplémentaires :

```ts
import { Res } from '@nestjs/common';
import type { Response } from 'express';
import type { InvoiceStatus } from '@pulsar/shared';
import { MarkPaidDto, ReconcileInvoiceDto, ResolveDisputeDto } from './dto/reconcile.dto';
```

2. `list` accepte `?status=` :

```ts
  @Get()
  @RequirePermissions(PERMISSIONS.BILLING.INVOICES_READ)
  list(@CurrentUser() user: AuthUser, @Query('status') status?: InvoiceStatus) {
    return this.invoices.list(user.tenantId, status);
  }
```

3. Ajouter — **attention** : `export.csv` doit être déclaré AVANT la route `:id` (sinon Nest matche `:id`) :

```ts
  @Get('export.csv')
  @RequirePermissions(PERMISSIONS.BILLING.INVOICES_READ)
  async exportCsv(
    @CurrentUser() user: AuthUser,
    @Res() res: Response,
    @Query('status') status?: InvoiceStatus,
  ) {
    const csv = await this.invoices.exportCsv(user.tenantId, status);
    res
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', 'attachment; filename="invoices.csv"')
      .send(csv);
  }

  @Post(':id/reconcile')
  @RequirePermissions(PERMISSIONS.BILLING.INVOICES_MANAGE)
  reconcile(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: ReconcileInvoiceDto,
  ) {
    return this.invoices.reconcile(user.tenantId, user.id, id, dto);
  }

  @Post(':id/resolve-dispute')
  @RequirePermissions(PERMISSIONS.BILLING.INVOICES_MANAGE)
  resolveDispute(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: ResolveDisputeDto,
  ) {
    return this.invoices.resolveDispute(user.tenantId, user.id, id, dto);
  }

  @Post(':id/mark-paid')
  @RequirePermissions(PERMISSIONS.BILLING.INVOICES_PAY)
  markPaid(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: MarkPaidDto) {
    return this.invoices.markPaid(user.tenantId, user.id, id, dto.paidAt);
  }
```

- [ ] **Step 4: Typecheck + commit**

Run: `pnpm --filter @pulsar/api typecheck`
Expected: exit 0.

```bash
git add apps/api/src/modules/billing/
git commit -m "feat(api): invoice reconciliation, dispute resolution, payment, CSV export"
```

---

### Task 5: Web — page factures (rapprochement, litige, paiement, export)

**Files:**
- Modify: `apps/web/src/routes/(app)/invoices/+page.svelte` (réécriture)

- [ ] **Step 1: Réécrire la page**

Remplacer le contenu par (mêmes patterns : `$state`, `$effect`, `api<T>`, toasts) :

```svelte
<script lang="ts">
  import type { Paginated } from '@pulsar/shared';
  import { api, ApiError } from '$lib/api/client';
  import { getAccessToken } from '$lib/stores/auth';
  import StatusBadge from '$lib/components/StatusBadge.svelte';
  import { toast } from '$lib/stores/toast';

  interface LineRow {
    id: string;
    description: string;
    amount: string;
    invoicedAmount: string | null;
    variance: string | null;
  }
  interface InvoiceRow {
    id: string;
    invoiceNumber: string;
    status: string;
    currency: string;
    totalAmount: string;
    invoicedTotal: string | null;
    varianceTotal: string | null;
    varianceGross: string | null;
    carrierInvoiceNumber: string | null;
    disputeReasonCode: string | null;
    disputeNote: string | null;
    approvedAt: string | null;
    paidAt: string | null;
    createdAt: string;
    carrier: { id: string; name: string };
    lines: LineRow[];
  }
  interface CarrierOption {
    id: string;
    name: string;
  }

  const REASON_CODES = [
    'RATE_MISMATCH',
    'QUANTITY_MISMATCH',
    'UNEXPECTED_CHARGE',
    'DUPLICATE_BILLING',
    'OTHER',
  ];

  let invoices = $state<InvoiceRow[]>([]);
  let carriers = $state<CarrierOption[]>([]);
  let selectedCarrierId = $state('');
  let statusFilter = $state('');
  let expanded = $state('');
  let error = $state('');

  // Reconcile form state (per expanded invoice)
  let carrierInvoiceNumber = $state('');
  let invoicedAmounts = $state<Record<string, string>>({});

  // Dispute resolution form state
  let resolution = $state<'ACCEPT_INVOICED' | 'KEEP_EXPECTED'>('ACCEPT_INVOICED');
  let reasonCode = $state('RATE_MISMATCH');
  let disputeNote = $state('');

  async function load() {
    try {
      invoices = await api<InvoiceRow[]>('/billing/invoices', {
        query: { status: statusFilter || undefined },
      });
      const result = await api<Paginated<CarrierOption>>('/transportation/carriers', {
        query: { pageSize: 100 },
      });
      carriers = result.items;
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'Failed to load invoices';
    }
  }

  function expand(invoice: InvoiceRow) {
    expanded = expanded === invoice.id ? '' : invoice.id;
    carrierInvoiceNumber = invoice.carrierInvoiceNumber ?? '';
    invoicedAmounts = Object.fromEntries(
      invoice.lines.map((l) => [l.id, l.invoicedAmount ?? l.amount]),
    );
  }

  async function draft() {
    try {
      const created = await api<InvoiceRow>('/billing/invoices/draft', {
        method: 'POST',
        body: { carrierId: selectedCarrierId },
      });
      toast.success(`${created.invoiceNumber} drafted (${created.lines.length} load(s))`);
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to draft invoice');
    }
  }

  async function reconcile(invoice: InvoiceRow) {
    try {
      const result = await api<InvoiceRow>(`/billing/invoices/${invoice.id}/reconcile`, {
        method: 'POST',
        body: {
          carrierInvoiceNumber,
          lines: invoice.lines.map((l) => ({
            lineId: l.id,
            invoicedAmount: Number(invoicedAmounts[l.id] ?? l.amount),
          })),
        },
      });
      toast.success(
        result.status === 'APPROVED'
          ? `${invoice.invoiceNumber} reconciled — within tolerance, approved`
          : `${invoice.invoiceNumber} disputed (gross variance ${result.varianceGross})`,
      );
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to reconcile');
    }
  }

  async function resolve(invoice: InvoiceRow) {
    try {
      await api(`/billing/invoices/${invoice.id}/resolve-dispute`, {
        method: 'POST',
        body: { resolution, reasonCode, note: disputeNote || undefined },
      });
      toast.success(`${invoice.invoiceNumber} dispute resolved`);
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to resolve dispute');
    }
  }

  async function approve(invoice: InvoiceRow) {
    try {
      await api(`/billing/invoices/${invoice.id}/approve`, { method: 'POST' });
      toast.success(`${invoice.invoiceNumber} approved (self-billing, no reconciliation)`);
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to approve');
    }
  }

  async function markPaid(invoice: InvoiceRow) {
    try {
      await api(`/billing/invoices/${invoice.id}/mark-paid`, { method: 'POST', body: {} });
      toast.success(`${invoice.invoiceNumber} marked paid`);
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to mark paid');
    }
  }

  async function exportCsv() {
    const query = statusFilter ? `?status=${statusFilter}` : '';
    const res = await fetch(`/api/v1/billing/invoices/export.csv${query}`, {
      headers: { Authorization: `Bearer ${getAccessToken()}` },
    });
    if (!res.ok) {
      toast.error('Export failed');
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'invoices.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  $effect(() => {
    void statusFilter;
    void load();
  });
</script>

<div class="page-header">
  <h1>Carrier invoices</h1>
  <div style="display: flex; gap: 8px;">
    <select bind:value={statusFilter} style="width: 140px;">
      <option value="">All statuses</option>
      <option value="DRAFT">Draft</option>
      <option value="DISPUTED">Disputed</option>
      <option value="APPROVED">Approved</option>
      <option value="PAID">Paid</option>
    </select>
    <button class="btn btn-sm" onclick={exportCsv}>Export CSV</button>
    <select bind:value={selectedCarrierId} style="width: 220px;">
      <option value="" disabled>Draft for carrier…</option>
      {#each carriers as c (c.id)}<option value={c.id}>{c.name}</option>{/each}
    </select>
    <button class="btn" disabled={!selectedCarrierId} onclick={draft}>Generate draft</button>
  </div>
</div>

<p class="muted">
  A draft bundles the carrier's completed, not-yet-invoiced loads at their estimated cost
  (the expected amount). Reconcile it against the carrier's actual invoice: within tolerance
  it is approved automatically; over tolerance it goes to dispute.
</p>

{#if error}
  <p class="error-text">{error}</p>
{/if}

<div class="card" style="padding: 0;">
  <table>
    <thead>
      <tr>
        <th>Invoice #</th>
        <th>Carrier</th>
        <th>Expected</th>
        <th>Invoiced</th>
        <th>Variance (net / gross)</th>
        <th>Status</th>
        <th></th>
      </tr>
    </thead>
    <tbody>
      {#each invoices as invoice (invoice.id)}
        <tr>
          <td>
            <button class="linklike" onclick={() => expand(invoice)}>
              <strong>{invoice.invoiceNumber}</strong>
            </button>
          </td>
          <td>{invoice.carrier.name}</td>
          <td>{Number(invoice.totalAmount).toLocaleString()} {invoice.currency}</td>
          <td>
            {invoice.invoicedTotal !== null
              ? `${Number(invoice.invoicedTotal).toLocaleString()} ${invoice.currency}`
              : '—'}
          </td>
          <td>
            {invoice.varianceGross !== null
              ? `${Number(invoice.varianceTotal).toLocaleString()} / ${Number(invoice.varianceGross).toLocaleString()}`
              : '—'}
          </td>
          <td><StatusBadge status={invoice.status} /></td>
          <td style="text-align: right;">
            {#if invoice.status === 'DRAFT'}
              <button class="btn btn-sm" onclick={() => approve(invoice)}>Approve as-is</button>
            {:else if invoice.status === 'APPROVED'}
              <button class="btn btn-sm" onclick={() => markPaid(invoice)}>Mark paid</button>
            {/if}
          </td>
        </tr>
        {#if expanded === invoice.id}
          <tr>
            <td colspan="7" style="background: var(--color-bg);">
              <table>
                <tbody>
                  {#each invoice.lines as line (line.id)}
                    <tr>
                      <td>{line.description}</td>
                      <td style="text-align: right;">
                        {Number(line.amount).toLocaleString()} {invoice.currency}
                      </td>
                      <td style="text-align: right; width: 160px;">
                        {#if invoice.status === 'DRAFT' || invoice.status === 'DISPUTED'}
                          <input
                            type="number"
                            step="0.01"
                            bind:value={invoicedAmounts[line.id]}
                            style="width: 120px; text-align: right;"
                          />
                        {:else if line.invoicedAmount !== null}
                          {Number(line.invoicedAmount).toLocaleString()}
                          {#if line.variance !== null && Number(line.variance) !== 0}
                            <span class="error-text">({Number(line.variance) > 0 ? '+' : ''}{line.variance})</span>
                          {/if}
                        {:else}
                          —
                        {/if}
                      </td>
                    </tr>
                  {/each}
                </tbody>
              </table>

              {#if invoice.status === 'DRAFT' || invoice.status === 'DISPUTED'}
                <div style="display: flex; gap: 8px; padding: 8px; align-items: center;">
                  <input
                    placeholder="Carrier invoice #"
                    bind:value={carrierInvoiceNumber}
                    style="width: 200px;"
                  />
                  <button
                    class="btn btn-sm"
                    disabled={!carrierInvoiceNumber}
                    onclick={() => reconcile(invoice)}
                  >
                    {invoice.status === 'DISPUTED' ? 'Re-reconcile (corrected invoice)' : 'Reconcile'}
                  </button>
                </div>
              {/if}

              {#if invoice.status === 'DISPUTED'}
                <div style="display: flex; gap: 8px; padding: 8px; align-items: center;">
                  <select bind:value={resolution} style="width: 180px;">
                    <option value="ACCEPT_INVOICED">Pay invoiced amount</option>
                    <option value="KEEP_EXPECTED">Pay expected amount</option>
                  </select>
                  <select bind:value={reasonCode} style="width: 200px;">
                    {#each REASON_CODES as code (code)}<option value={code}>{code}</option>{/each}
                  </select>
                  <input placeholder="Note (optional)" bind:value={disputeNote} style="flex: 1;" />
                  <button class="btn btn-sm" onclick={() => resolve(invoice)}>Resolve dispute</button>
                </div>
              {/if}

              {#if invoice.disputeReasonCode}
                <p class="muted" style="padding: 0 8px;">
                  Dispute: {invoice.disputeReasonCode}{invoice.disputeNote ? ` — ${invoice.disputeNote}` : ''}
                </p>
              {/if}
            </td>
          </tr>
        {/if}
      {:else}
        <tr><td colspan="7" class="muted">No invoices yet.</td></tr>
      {/each}
    </tbody>
  </table>
</div>

<style>
  .linklike {
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
    color: var(--color-primary);
    font-size: 13px;
  }
</style>
```

Note : vérifier que `getAccessToken` est bien exporté par `$lib/stores/auth` (il l'est — utilisé par `client.ts`).

- [ ] **Step 2: Typecheck web + commit**

Run: `pnpm --filter @pulsar/web typecheck`
Expected: exit 0.

```bash
git add apps/web/src/routes/
git commit -m "feat(web): invoice reconciliation UI (dispute, payment, CSV export)"
```

---

### Task 6: Suite e2e rapprochement

**Files:**
- Create: `apps/api/test/phase6-billing.e2e-spec.ts`

- [ ] **Step 1: Écrire la suite**

```ts
/**
 * E2E for phase 6 — carrier invoice reconciliation: tolerance on the GROSS
 * variance (compensating errors caught), corrected-invoice re-reconcile,
 * dispute resolution, payment, CSV export.
 * Prerequisites: reachable PostgreSQL with the seed applied (admin role must
 * hold billing.invoices.pay — reseed after the permission catalog change).
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Phase 6 — billing reconciliation (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let token: string;

  const suffix = `P6B${Date.now().toString(36).toUpperCase()}`;
  const ids = { customer: '', origin: '', destination: '', carrier: '', rate: '' };
  const auth = () => ({ Authorization: `Bearer ${token}` });

  /** Runs one order through to a COMPLETED load (FLAT 800 → estimatedCost 800). */
  async function completedLoad(): Promise<string> {
    const order = await request(http)
      .post('/api/v1/transportation/transport-orders')
      .set(auth())
      .send({
        customerId: ids.customer,
        originLocationId: ids.origin,
        destinationLocationId: ids.destination,
      })
      .expect(201);
    const orderId = order.body.id;
    await request(http)
      .post(`/api/v1/transportation/transport-orders/${orderId}/confirm`)
      .set(auth())
      .expect(201);
    const planned = await request(http)
      .post(`/api/v1/transportation/transport-orders/${orderId}/plan`)
      .set(auth())
      .send({})
      .expect(201);
    const shipmentId = planned.body.shipments[0].id;
    const load = await request(http)
      .post('/api/v1/transportation/loads')
      .set(auth())
      .send({})
      .expect(201);
    await request(http)
      .post(`/api/v1/transportation/shipments/${shipmentId}/assign-load`)
      .set(auth())
      .send({ loadId: load.body.id })
      .expect(201);
    await request(http)
      .post(`/api/v1/transportation/loads/${load.body.id}/assign`)
      .set(auth())
      .send({ carrierId: ids.carrier, rateId: ids.rate })
      .expect(201);
    for (const verb of ['dispatch', 'start-transit', 'complete']) {
      await request(http)
        .post(`/api/v1/transportation/loads/${load.body.id}/${verb}`)
        .set(auth())
        .expect(201);
    }
    return load.body.id;
  }

  async function draftInvoice(): Promise<{ id: string; lines: { id: string }[] }> {
    const invoice = await request(http)
      .post('/api/v1/billing/invoices/draft')
      .set(auth())
      .send({ carrierId: ids.carrier })
      .expect(201);
    return invoice.body;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
    );
    await app.init();
    http = app.getHttpServer();

    const login = await request(http)
      .post('/api/v1/auth/login')
      .send({ email: 'admin@pulsar.dev', password: 'admin123', tenant: 'acme' })
      .expect(200);
    token = login.body.accessToken;

    await request(http)
      .patch('/api/v1/modules/billing')
      .set(auth())
      .send({ enabled: true })
      .expect(200);

    const customer = await request(http)
      .post('/api/v1/transportation/customers')
      .set(auth())
      .send({ code: `${suffix}-CUST`, name: 'Recon Customer' })
      .expect(201);
    ids.customer = customer.body.id;
    for (const [field, code] of [
      ['origin', `${suffix}-ORI`],
      ['destination', `${suffix}-DST`],
    ] as const) {
      const location = await request(http)
        .post('/api/v1/transportation/locations')
        .set(auth())
        .send({ code, name: code, type: 'WAREHOUSE', addressLine1: '1 Test', city: 'Sherbrooke' })
        .expect(201);
      ids[field] = location.body.id;
    }
    const carrier = await request(http)
      .post('/api/v1/transportation/carriers')
      .set(auth())
      .send({ code: `${suffix}-CARR`, name: 'Recon Carrier' })
      .expect(201);
    ids.carrier = carrier.body.id;
    const rate = await request(http)
      .post('/api/v1/transportation/rates')
      .set(auth())
      .send({ name: `${suffix} flat`, rateType: 'FLAT', baseAmount: 800, carrierId: ids.carrier })
      .expect(201);
    ids.rate = rate.body.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('within tolerance → auto-approved → paid', async () => {
    await completedLoad();
    const invoice = await draftInvoice();
    const reconciled = await request(http)
      .post(`/api/v1/billing/invoices/${invoice.id}/reconcile`)
      .set(auth())
      .send({
        carrierInvoiceNumber: `${suffix}-CARRINV-1`,
        // 810 vs 800: gross 10 ≤ max(25, 2% × 810) → approved automatically
        lines: [{ lineId: invoice.lines[0].id, invoicedAmount: 810 }],
      })
      .expect(201);
    expect(reconciled.body.status).toBe('APPROVED');
    expect(Number(reconciled.body.varianceGross)).toBe(10);

    const paid = await request(http)
      .post(`/api/v1/billing/invoices/${invoice.id}/mark-paid`)
      .set(auth())
      .send({})
      .expect(201);
    expect(paid.body.status).toBe('PAID');
    expect(paid.body.paidAt).toBeTruthy();
    await request(http)
      .post(`/api/v1/billing/invoices/${invoice.id}/mark-paid`)
      .set(auth())
      .send({})
      .expect(400);
  });

  it('compensating line errors (net 0) go to DISPUTED — the blind-spot test', async () => {
    await completedLoad();
    await completedLoad();
    const invoice = await draftInvoice();
    expect(invoice.lines).toHaveLength(2);
    const reconciled = await request(http)
      .post(`/api/v1/billing/invoices/${invoice.id}/reconcile`)
      .set(auth())
      .send({
        carrierInvoiceNumber: `${suffix}-CARRINV-2`,
        lines: [
          { lineId: invoice.lines[0].id, invoicedAmount: 900 }, // +100
          { lineId: invoice.lines[1].id, invoicedAmount: 700 }, // −100
        ],
      })
      .expect(201);
    expect(Number(reconciled.body.varianceTotal)).toBe(0);
    expect(Number(reconciled.body.varianceGross)).toBe(200);
    expect(reconciled.body.status).toBe('DISPUTED');
    expect(reconciled.body.disputeReasonCode).toBeNull();

    // The carrier sends a corrected invoice: re-reconcile from DISPUTED.
    const corrected = await request(http)
      .post(`/api/v1/billing/invoices/${invoice.id}/reconcile`)
      .set(auth())
      .send({
        carrierInvoiceNumber: `${suffix}-CARRINV-2b`,
        lines: [
          { lineId: invoice.lines[0].id, invoicedAmount: 800 },
          { lineId: invoice.lines[1].id, invoicedAmount: 800 },
        ],
      })
      .expect(201);
    expect(corrected.body.status).toBe('APPROVED');
  });

  it('over tolerance → DISPUTED → human resolution (pay invoiced) → paid', async () => {
    await completedLoad();
    const invoice = await draftInvoice();
    const disputed = await request(http)
      .post(`/api/v1/billing/invoices/${invoice.id}/reconcile`)
      .set(auth())
      .send({
        carrierInvoiceNumber: `${suffix}-CARRINV-3`,
        lines: [{ lineId: invoice.lines[0].id, invoicedAmount: 900 }],
      })
      .expect(201);
    expect(disputed.body.status).toBe('DISPUTED');

    const resolved = await request(http)
      .post(`/api/v1/billing/invoices/${invoice.id}/resolve-dispute`)
      .set(auth())
      .send({ resolution: 'ACCEPT_INVOICED', reasonCode: 'RATE_MISMATCH', note: 'Fuel revision' })
      .expect(201);
    expect(resolved.body.status).toBe('APPROVED');
    expect(Number(resolved.body.totalAmount)).toBe(900);
    expect(resolved.body.disputeReasonCode).toBe('RATE_MISMATCH');

    await request(http)
      .post(`/api/v1/billing/invoices/${invoice.id}/mark-paid`)
      .set(auth())
      .send({})
      .expect(201);
  });

  it('exports the filtered list as CSV', async () => {
    const res = await request(http)
      .get('/api/v1/billing/invoices/export.csv?status=PAID')
      .set(auth())
      .expect(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.text.split('\n')[0]).toContain('invoiceNumber');
    expect(res.text).toContain(`${suffix}-CARRINV-1`);
  });
});
```

- [ ] **Step 2: Lancer (DB seedée + reseed permissions)**

Run: `pnpm db:seed && pnpm test:e2e`
Expected: PASS (la nouvelle suite et les anciennes — la suite phase 5 reste verte : `approve` direct depuis DRAFT existe toujours).

- [ ] **Step 3: Commit**

```bash
git add apps/api/test/phase6-billing.e2e-spec.ts
git commit -m "test(api): invoice reconciliation e2e (gross tolerance, re-reconcile, dispute)"
```

---

### Task 7: Vérification finale du plan D

- [ ] **Step 1: Tout relancer**

```bash
pnpm typecheck && pnpm test && pnpm test:e2e
```

Expected: exit 0 partout.

- [ ] **Step 2: Vérification manuelle UI**

`pnpm dev` → `/invoices` : générer un brouillon, saisir un n° de facture transporteur et des montants, vérifier l'approbation auto dans la tolérance, le passage en litige hors tolérance (+ résolution), le bouton « Mark paid », l'export CSV.
