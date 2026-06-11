# Phase 7.3 — Billing sell-side : plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implémenter la spec [2026-06-11-phase7-3-billing-sell-side-design.md](../specs/2026-06-11-phase7-3-billing-sell-side-design.md) : relevés de facturation client (`CustomerInvoice`) tarifés au rating engine avec les tarifs client, cycle DRAFT→APPROVED→SENT→PAID, suppression de brouillon, regroupement par devise, snapshots figés.

**Architecture:** Nouvelle paire de modèles dédiée (le buy-side `Invoice` ne bouge pas). `RatingService.rateOrder()` réutilise la résolution 7.1 (lanes, carburant daté, `calculateRateCost`) avec les tarifs `customerId`. Le service sell-side suit les patterns buy-side (séquence, audit explicite, machine à états partagée) avec les transitions en `updateMany` conditionnel (anti-TOCTOU). Wording « billing statement / relevé » partout.

**Tech stack:** NestJS + Prisma, SvelteKit (Svelte 5 runes), vitest (shared), jest (API), supertest (e2e). Branche : `phase-7-3`.

---

## Carte des fichiers

| Fichier | Rôle |
| ------- | ---- |
| `packages/shared/src/enums/billing.ts` | + `CustomerInvoiceStatus` |
| `packages/shared/src/workflows/customer-invoice.workflow.ts` (+ test) | Machine à états DRAFT→APPROVED→SENT→PAID |
| `packages/shared/src/permissions.ts` | + 4 clés `billing.customer-invoices.*` |
| `packages/database/prisma/schema.prisma` + migration | `CustomerInvoice`, `CustomerInvoiceLine`, enum miroir |
| `packages/database/prisma/seed.ts` | + tarif client de démo sur la lane city |
| `apps/api/src/prisma/sequences.service.ts` | + clé `customer-invoice` → `CINV` |
| `apps/api/src/modules/transportation/rating/rating.service.ts` | + `rateOrder()` (tarifs client, date de réf = livraison réelle) |
| `apps/api/src/modules/billing/customer-invoices.service.ts` (nouveau) | Billable, génération par devise, delete-draft, approve/send/pay |
| `apps/api/src/modules/billing/customer-invoices.controller.ts` (nouveau) | 8 endpoints |
| `apps/api/src/modules/billing/billing.module.ts` | Enregistrement |
| `apps/api/test/phase7-3-sell-side.e2e-spec.ts` | Suite e2e |
| `apps/web/src/routes/(app)/invoices/+page.svelte` | Onglets Carrier / Customer statements |
| Docs (TODO/ROADMAP/etat/data-model/collaboration) | Mise à jour finale |

**Conventions (rappels CLAUDE.md)** : transitions via la machine à états (règle 2), numéros via `SequencesService` (règle 8), audit explicite before/after sur les transitions (règle 14), `@RequireModule(MODULE_KEYS.BILLING)`, tenantId du JWT partout.

---

### Task 1 : Enum + machine à états + permissions (shared, TDD)

**Files:**
- Modify: `packages/shared/src/enums/billing.ts`
- Create: `packages/shared/src/workflows/customer-invoice.workflow.ts`
- Modify: `packages/shared/src/workflows/__tests__/workflows.spec.ts` (ajouter un describe)
- Modify: `packages/shared/src/permissions.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1 : Test (échec attendu)** — dans `packages/shared/src/workflows/__tests__/workflows.spec.ts`, ajouter (imports en tête de fichier à compléter) :

```ts
import { CustomerInvoiceStatus } from '../../enums/billing';
import { canTransitionCustomerInvoice } from '../customer-invoice.workflow';

describe('customer invoice workflow', () => {
  it('follows DRAFT → APPROVED → SENT → PAID strictly', () => {
    expect(canTransitionCustomerInvoice(CustomerInvoiceStatus.DRAFT, CustomerInvoiceStatus.APPROVED)).toBe(true);
    expect(canTransitionCustomerInvoice(CustomerInvoiceStatus.APPROVED, CustomerInvoiceStatus.SENT)).toBe(true);
    expect(canTransitionCustomerInvoice(CustomerInvoiceStatus.SENT, CustomerInvoiceStatus.PAID)).toBe(true);
  });

  it('refuses skips and backward moves', () => {
    expect(canTransitionCustomerInvoice(CustomerInvoiceStatus.DRAFT, CustomerInvoiceStatus.SENT)).toBe(false);
    expect(canTransitionCustomerInvoice(CustomerInvoiceStatus.DRAFT, CustomerInvoiceStatus.PAID)).toBe(false);
    expect(canTransitionCustomerInvoice(CustomerInvoiceStatus.APPROVED, CustomerInvoiceStatus.DRAFT)).toBe(false);
    expect(canTransitionCustomerInvoice(CustomerInvoiceStatus.PAID, CustomerInvoiceStatus.SENT)).toBe(false);
  });
});
```

Run `pnpm --filter @pulsar/shared test` → FAIL.

- [ ] **Step 2 : Implémenter**

`enums/billing.ts` — ajouter à la fin :

```ts
/** Customer billing statement lifecycle (sell-side). Mirrored in schema.prisma.
 *  Wording note: emails/UI say "billing statement", not "invoice", until taxes exist. */
export enum CustomerInvoiceStatus {
  DRAFT = 'DRAFT',
  APPROVED = 'APPROVED',
  SENT = 'SENT',
  PAID = 'PAID',
}
```

`workflows/customer-invoice.workflow.ts` :

```ts
import { CustomerInvoiceStatus } from '../enums/billing';

// Deleting a DRAFT is NOT a transition — it is a DELETE that frees the orders
// (see spec invariant 2). APPROVED+ statements are immutable.
export const CUSTOMER_INVOICE_TRANSITIONS: Record<CustomerInvoiceStatus, CustomerInvoiceStatus[]> = {
  [CustomerInvoiceStatus.DRAFT]: [CustomerInvoiceStatus.APPROVED],
  [CustomerInvoiceStatus.APPROVED]: [CustomerInvoiceStatus.SENT],
  [CustomerInvoiceStatus.SENT]: [CustomerInvoiceStatus.PAID],
  [CustomerInvoiceStatus.PAID]: [],
};

export function canTransitionCustomerInvoice(
  from: CustomerInvoiceStatus,
  to: CustomerInvoiceStatus,
): boolean {
  return CUSTOMER_INVOICE_TRANSITIONS[from]?.includes(to) ?? false;
}
```

`permissions.ts` — bloc `BILLING` (après `INVOICES_PAY`) :

```ts
    CUSTOMER_INVOICES_READ: 'billing.customer-invoices.read',
    CUSTOMER_INVOICES_MANAGE: 'billing.customer-invoices.manage',
    CUSTOMER_INVOICES_SEND: 'billing.customer-invoices.send',
    CUSTOMER_INVOICES_PAY: 'billing.customer-invoices.pay',
```

et au catalogue (après la ligne `INVOICES_PAY`) :

```ts
  billing(PERMISSIONS.BILLING.CUSTOMER_INVOICES_READ, 'View customer billing statements'),
  billing(PERMISSIONS.BILLING.CUSTOMER_INVOICES_MANAGE, 'Draft, approve and delete customer billing statements'),
  billing(PERMISSIONS.BILLING.CUSTOMER_INVOICES_SEND, 'Send customer billing statements'),
  billing(PERMISSIONS.BILLING.CUSTOMER_INVOICES_PAY, 'Mark customer billing statements as paid'),
```

`index.ts` — ajouter `export * from './workflows/customer-invoice.workflow';` à côté des autres workflows.

- [ ] **Step 3 : Vérifier + build + commit**

`pnpm --filter @pulsar/shared test` → PASS ; `pnpm --filter @pulsar/shared build` ; `pnpm typecheck` → PASS.

```bash
git add packages/shared/src
git commit -m "feat(shared): customer-invoice status enum, state machine and permissions"
```

---

### Task 2 : Schéma Prisma + migration + séquence + seed

**Files:**
- Modify: `packages/database/prisma/schema.prisma`
- Create: migration `<ts>_phase7_3_customer_invoices`
- Modify: `apps/api/src/prisma/sequences.service.ts`
- Modify: `packages/database/prisma/seed.ts`

- [ ] **Step 1 : Schéma** — après le bloc `InvoiceLine`, ajouter :

```prisma
enum CustomerInvoiceStatus {
  DRAFT
  APPROVED
  SENT
  PAID
}

// Customer billing statement (sell-side): delivered orders priced with the
// CUSTOMER's rates (rating engine 7.1), one statement per currency encountered.
// Wording: emails/UI say "billing statement" until taxes exist (spec 7.3).
model CustomerInvoice {
  id            String                @id @default(cuid())
  tenantId      String
  invoiceNumber String
  customerId    String
  status        CustomerInvoiceStatus @default(DRAFT)
  currency      String                @default("CAD")
  totalAmount   Decimal               @db.Decimal(12, 2)
  approvedAt    DateTime?
  sentAt        DateTime?
  paidAt        DateTime?
  createdAt     DateTime              @default(now())
  updatedAt     DateTime              @updatedAt

  tenant   Tenant                @relation(fields: [tenantId], references: [id])
  customer Customer              @relation(fields: [customerId], references: [id])
  lines    CustomerInvoiceLine[]

  @@unique([tenantId, invoiceNumber])
  @@index([tenantId, status])
  @@index([tenantId, customerId])
  @@map("customer_invoices")
}

model CustomerInvoiceLine {
  id                String  @id @default(cuid())
  customerInvoiceId String
  // One line per order; the unique prevents double-billing an order. Freed by
  // deleting a DRAFT statement (cascade) — the only escape path by design.
  transportOrderId  String  @unique
  description       String
  amount            Decimal @db.Decimal(12, 2)
  // Frozen sell-side snapshot (customer rate as used + inputs + lines), same
  // self-contained structure as Load.costDetail. Never recomputed once APPROVED.
  priceDetail       Json

  customerInvoice CustomerInvoice @relation(fields: [customerInvoiceId], references: [id], onDelete: Cascade)
  transportOrder  TransportOrder  @relation(fields: [transportOrderId], references: [id], onDelete: Restrict)

  @@map("customer_invoice_lines")
}
```

Relations inverses : `Tenant.customerInvoices CustomerInvoice[]`, `Customer.customerInvoices CustomerInvoice[]`, `TransportOrder.customerInvoiceLine CustomerInvoiceLine?`.

- [ ] **Step 2 : Migration** — `prisma validate`, puis générer (`--create-only`, ou à la main comme les migrations 7.x si refus non-interactif — création pure de tables, pas de piège RENAME ici), vérifier le SQL (2 CREATE TABLE + enum + FKs : ligne→facture CASCADE, ligne→ordre RESTRICT), appliquer, drift check exit 0, `pnpm --filter @pulsar/database build`.

- [ ] **Step 3 : Séquence** — dans `sequences.service.ts` : `SequenceKey` gagne `'customer-invoice'`, `PREFIXES` gagne `'customer-invoice': 'CINV'`.

- [ ] **Step 4 : Seed** — après le bloc rate 7.1 (`Demo CWT grid (city lane)`), ajouter un tarif CLIENT de démo (mêmes garde-fous d'idempotence) :

```ts
  const customerRateName = 'Demo customer flat (city lane)';
  const existingCustomerRate = await prisma.rate.findFirst({
    where: { tenantId: tenant.id, name: customerRateName },
  });
  if (!existingCustomerRate) {
    await prisma.rate.create({
      data: {
        tenantId: tenant.id,
        name: customerRateName,
        customerId: customer.id,
        laneId: cityLane.id,
        rateType: 'FLAT',
        baseAmount: 1450,
        status: 'ACTIVE',
      },
    });
  }
```

(`customer` et `cityLane` sont les variables existantes du seed.) `pnpm db:seed` deux fois → vert.

- [ ] **Step 5 : Commit**

```bash
git add packages/database/prisma apps/api/src/prisma/sequences.service.ts
git commit -m "feat(db): customer invoice tables (CINV sequence), demo customer rate"
```

---

### Task 3 : `RatingService.rateOrder()` (tarifs client)

**Files:**
- Modify: `apps/api/src/modules/transportation/rating/rating.service.ts`
- Modify: `apps/api/src/modules/transportation/rating/rating.service.spec.ts`

- [ ] **Step 1 : Test jest (échec attendu)** — ajouter au spec :

```ts
describe('orderReferenceDate', () => {
  const service = new RatingService(null as never);
  it('uses the latest actual delivery of the shipments', () => {
    const date = service.orderReferenceDate([
      { actualDeliveryAt: new Date('2026-07-01') },
      { actualDeliveryAt: new Date('2026-07-03') },
      { actualDeliveryAt: null },
    ]);
    expect(date.toISOString()).toBe(new Date('2026-07-03').toISOString());
  });
  it('falls back to now when nothing is delivered yet', () => {
    const before = Date.now();
    expect(service.orderReferenceDate([{ actualDeliveryAt: null }]).getTime()).toBeGreaterThanOrEqual(before);
  });
});
```

- [ ] **Step 2 : Implémenter** — dans `rating.service.ts` :

(a) Méthode publique pure :

```ts
  /** Sell-side reference date: the real delivery (latest actualDeliveryAt), else today. */
  orderReferenceDate(shipments: { actualDeliveryAt: Date | null }[]): Date {
    const dates = shipments
      .map((s) => s.actualDeliveryAt)
      .filter((d): d is Date => d !== null)
      .map((d) => d.getTime());
    return dates.length > 0 ? new Date(Math.max(...dates)) : new Date();
  }
```

(b) `rateOrder` — même mécanique que `rateOptions` mais ordre + tarifs client, et il RETOURNE le meilleur (pas une liste) :

```ts
  /**
   * Sell-side rating of a delivered order with the CUSTOMER's rates (status
   * ACTIVE, customerId = order.customerId, lane match or customer catch-all).
   * Returns the cheapest evaluation (deterministic compareRateOptions order)
   * with a self-contained snapshot, or null when no rate applies.
   */
  async rateOrder(tenantId: string, orderId: string): Promise<RateEvaluation | null> {
    const order = await this.prisma.transportOrder.findFirst({
      where: { id: orderId, tenantId },
      select: {
        customerId: true,
        totalWeightKg: true,
        totalVolumeM3: true,
        palletCount: true,
        originLocation: { select: { id: true, city: true, state: true, country: true } },
        destinationLocation: { select: { id: true, city: true, state: true, country: true } },
        shipments: { select: { actualDeliveryAt: true } },
      },
    });
    if (!order) return null;
    const date = this.orderReferenceDate(order.shipments);

    const rates = await this.prisma.rate.findMany({
      where: {
        tenantId,
        status: RateStatus.ACTIVE,
        customerId: order.customerId,
        AND: [
          {
            OR: [
              { laneId: null },
              {
                lane: {
                  originKey: { in: candidateEndpointKeys(order.originLocation) },
                  destinationKey: { in: candidateEndpointKeys(order.destinationLocation) },
                },
              },
            ],
          },
          { OR: [{ validFrom: null }, { validFrom: { lte: date } }] },
          { OR: [{ validTo: null }, { validTo: { gte: date } }] },
        ],
      },
      include: rateDetailInclude,
    });

    // Reuse evaluate() through an order-shaped LoadForRating: the metrics come
    // from the order totals; no accessorials sell-side in v1 (spec §2).
    const orderAsLoad = {
      id: orderId,
      route: null,
      shipments: [
        {
          weightKg: order.totalWeightKg,
          palletCount: order.palletCount,
          plannedPickupEarly: null,
        },
      ],
      accessorials: [],
    };

    const candidates = rates
      .map((rate) => ({ rate, evaluation: this.evaluate(rate, orderAsLoad, date) }))
      .filter((c): c is { rate: RateDetail; evaluation: RateEvaluation } => c.evaluation !== null)
      .map(({ rate, evaluation }) => ({
        rateId: rate.id,
        currency: rate.currency,
        laneSpecificity: rate.lane
          ? {
              total:
                ENDPOINT_SPECIFICITY[rate.lane.originType as keyof typeof ENDPOINT_SPECIFICITY] +
                ENDPOINT_SPECIFICITY[rate.lane.destinationType as keyof typeof ENDPOINT_SPECIFICITY],
            }
          : null,
        missingAccessorials: evaluation.breakdown.missingAccessorials,
        breakdown: evaluation.breakdown,
        evaluation,
      }))
      .sort(compareRateOptions);

    return candidates[0]?.evaluation ?? null;
  }
```

⚠️ Notes d'intégration : (1) `evaluate()` lit `metricsOf(load)` qui somme `weightKg`/`palletCount` des shipments et le `volumeM3` n'est PAS dans `CostMetrics` (le moteur ne cote pas au volume) — passer le poids/palettes de la commande comme un pseudo-shipment unique est exact. (2) Vérifier la signature réelle de `compareRateOptions` (exportée en 7.1) et adapter la forme des candidats à ce qu'elle attend. (3) Si `LoadForRating` n'accepte pas la forme, élargir le type local plutôt que dupliquer `evaluate`.

- [ ] **Step 3 : Vérifier + commit** — `pnpm test` (jest vert), `pnpm typecheck`.

```bash
git add apps/api/src/modules/transportation/rating
git commit -m "feat(api): RatingService.rateOrder — sell-side rating with customer rates at real-delivery date"
```

---

### Task 4 : CustomerInvoicesService + controller + module

**Files:**
- Create: `apps/api/src/modules/billing/customer-invoices.service.ts`
- Create: `apps/api/src/modules/billing/customer-invoices.controller.ts`
- Modify: `apps/api/src/modules/billing/billing.module.ts` (enregistrer ; importer le module transportation OU le provider RatingService — vérifier comment billing.module importe ses dépendances ; RatingService est un provider de TransportationModule, NON exporté → l'exporter depuis TransportationModule et importer TransportationModule dans BillingModule, OU déclarer RatingService aussi dans BillingModule (même classe, DI séparée — acceptable car sans état). Préférer : exporter RatingService de TransportationModule et l'importer.)

- [ ] **Step 1 : Service** — `customer-invoices.service.ts` :

```ts
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  AuditAction,
  CustomerInvoiceStatus,
  TransportOrderStatus,
  canTransitionCustomerInvoice,
} from '@pulsar/shared';
import { Prisma } from '@pulsar/database';
import { PrismaService } from '../../prisma/prisma.service';
import { OwnershipService } from '../../prisma/ownership.service';
import { SequencesService } from '../../prisma/sequences.service';
import { AuditLogsService } from '../../core/audit-logs/audit-logs.service';
import { EmailService } from '../../core/email/email.service';
import { RatingService } from '../transportation/rating/rating.service';

const statementInclude = {
  customer: { select: { id: true, code: true, name: true, email: true } },
  lines: {
    include: {
      transportOrder: { select: { id: true, orderNumber: true, customerReference: true } },
    },
  },
} as const;

interface RatedOrder {
  orderId: string;
  orderNumber: string;
  amount: number;
  currency: string;
  snapshot: Prisma.InputJsonValue;
}

interface UnratableOrder {
  orderId: string;
  orderNumber: string;
  reason: 'NO_APPLICABLE_RATE';
}

/** Groups rated orders by the winning rate's currency — one statement per currency. */
export function groupByCurrency(rated: RatedOrder[]): Map<string, RatedOrder[]> {
  const groups = new Map<string, RatedOrder[]>();
  for (const r of rated) {
    const group = groups.get(r.currency) ?? [];
    group.push(r);
    groups.set(r.currency, group);
  }
  return groups;
}

/**
 * Customer billing statements (sell-side). Delivered orders are priced with the
 * customer's rates at draft time; the snapshot freezes on the line. Never bills
 * 0 by accident: unratable orders are excluded and surfaced with their reason.
 */
@Injectable()
export class CustomerInvoicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ownership: OwnershipService,
    private readonly sequences: SequencesService,
    private readonly audit: AuditLogsService,
    private readonly email: EmailService,
    private readonly rating: RatingService,
  ) {}

  list(tenantId: string, status?: CustomerInvoiceStatus, customerId?: string) {
    return this.prisma.customerInvoice.findMany({
      where: { tenantId, ...(status ? { status } : {}), ...(customerId ? { customerId } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: statementInclude,
    });
  }

  async get(tenantId: string, id: string) {
    const statement = await this.prisma.customerInvoice.findFirst({
      where: { id, tenantId },
      include: statementInclude,
    });
    if (!statement) throw new NotFoundException('Billing statement not found');
    return statement;
  }

  /** Rates every billable order of the customer; nothing is persisted. */
  private async rateBillableOrders(tenantId: string, customerId: string) {
    await this.ownership.assertOwned('customer', customerId, tenantId);
    const orders = await this.prisma.transportOrder.findMany({
      where: {
        tenantId,
        customerId,
        status: { in: [TransportOrderStatus.COMPLETED, TransportOrderStatus.CLOSED] },
        customerInvoiceLine: null,
      },
      orderBy: { createdAt: 'asc' },
      select: { id: true, orderNumber: true },
    });

    const rated: RatedOrder[] = [];
    const unratable: UnratableOrder[] = [];
    for (const order of orders) {
      const evaluation = await this.rating.rateOrder(tenantId, order.id);
      if (evaluation) {
        rated.push({
          orderId: order.id,
          orderNumber: order.orderNumber,
          amount: evaluation.breakdown.total,
          currency: evaluation.currency,
          snapshot: evaluation.snapshot,
        });
      } else {
        unratable.push({ orderId: order.id, orderNumber: order.orderNumber, reason: 'NO_APPLICABLE_RATE' });
      }
    }
    return { rated, unratable };
  }

  /** Preview: what the next generation would bill (and what it would skip, with reasons). */
  async billable(tenantId: string, customerId: string) {
    const { rated, unratable } = await this.rateBillableOrders(tenantId, customerId);
    return {
      ratable: rated.map(({ snapshot: _snapshot, ...r }) => r),
      unratable,
    };
  }

  /** Generates DRAFT statements — one per currency encountered (spec currency rule). */
  async createDrafts(tenantId: string, userId: string, customerId: string) {
    const { rated, unratable } = await this.rateBillableOrders(tenantId, customerId);
    if (rated.length === 0) {
      throw new BadRequestException({
        message: 'No ratable delivered orders for this customer',
        unratable,
      });
    }

    const invoices = [];
    for (const [currency, group] of groupByCurrency(rated)) {
      const total = group.reduce((acc, r) => acc + r.amount, 0);
      const invoice = await this.prisma.customerInvoice.create({
        data: {
          tenantId,
          invoiceNumber: await this.sequences.nextNumber(tenantId, 'customer-invoice'),
          customerId,
          currency,
          totalAmount: Math.round(total * 100) / 100,
          lines: {
            create: group.map((r) => ({
              transportOrderId: r.orderId,
              description: `Order ${r.orderNumber}`,
              amount: r.amount,
              priceDetail: r.snapshot,
            })),
          },
        },
        include: statementInclude,
      });
      await this.audit.log({
        tenantId,
        userId,
        action: AuditAction.CREATE,
        entityType: 'customer-invoice',
        entityId: invoice.id,
        after: { invoiceNumber: invoice.invoiceNumber, customerId, currency, lines: group.length },
      });
      invoices.push(invoice);
    }
    return { invoices, unratable };
  }

  /** The only escape path of a draft: deletion frees the orders (cascade on lines). */
  async deleteDraft(tenantId: string, userId: string, id: string) {
    const statement = await this.get(tenantId, id);
    if (statement.status !== CustomerInvoiceStatus.DRAFT) {
      throw new BadRequestException('Only DRAFT statements can be deleted');
    }
    await this.prisma.customerInvoice.delete({ where: { id } });
    await this.audit.log({
      tenantId,
      userId,
      action: AuditAction.DELETE,
      entityType: 'customer-invoice',
      entityId: id,
      before: {
        invoiceNumber: statement.invoiceNumber,
        status: statement.status,
        orders: statement.lines.map((l) => l.transportOrder.orderNumber),
      },
    });
    return { deleted: true };
  }

  /** Conditional-update transition (anti-TOCTOU): the WHERE carries the expected status. */
  private async transition(
    tenantId: string,
    userId: string,
    id: string,
    from: CustomerInvoiceStatus,
    to: CustomerInvoiceStatus,
    extra: Prisma.CustomerInvoiceUpdateManyMutationInput = {},
  ) {
    if (!canTransitionCustomerInvoice(from, to)) {
      throw new BadRequestException(`Invalid transition ${from} → ${to}`);
    }
    const { count } = await this.prisma.customerInvoice.updateMany({
      where: { id, tenantId, status: from },
      data: { status: to, ...extra },
    });
    if (count === 0) {
      throw new BadRequestException(`Statement is not ${from}`);
    }
    await this.audit.log({
      tenantId,
      userId,
      action: AuditAction.STATUS_CHANGE,
      entityType: 'customer-invoice',
      entityId: id,
      before: { status: from },
      after: { status: to },
    });
    return this.get(tenantId, id);
  }

  approve(tenantId: string, userId: string, id: string) {
    return this.transition(tenantId, userId, id, CustomerInvoiceStatus.DRAFT, CustomerInvoiceStatus.APPROVED, {
      approvedAt: new Date(),
    });
  }

  /** Emails the statement summary to the customer contact; no email, no SENT. */
  async send(tenantId: string, userId: string, id: string) {
    const statement = await this.get(tenantId, id);
    if (statement.status !== CustomerInvoiceStatus.APPROVED) {
      throw new BadRequestException('Only APPROVED statements can be sent');
    }
    if (!statement.customer.email) {
      throw new BadRequestException('Customer has no email address on file');
    }
    const rows = statement.lines
      .map(
        (l) =>
          `<tr><td>${l.transportOrder.orderNumber}</td><td>${l.description}</td><td style="text-align:right">${l.amount} ${statement.currency}</td></tr>`,
      )
      .join('');
    const sent = await this.email.send({
      to: statement.customer.email,
      subject: `Billing statement ${statement.invoiceNumber}`,
      html: [
        `<p>Please find below your billing statement <strong>${statement.invoiceNumber}</strong>.</p>`,
        `<table><tr><th>Order</th><th>Description</th><th>Amount</th></tr>${rows}</table>`,
        `<p><strong>Total: ${statement.totalAmount} ${statement.currency}</strong></p>`,
      ].join('\n'),
      text: `Billing statement ${statement.invoiceNumber} — total ${statement.totalAmount} ${statement.currency}`,
    });
    if (!sent) {
      throw new BadRequestException('Email could not be sent — statement not marked SENT');
    }
    return this.transition(tenantId, userId, id, CustomerInvoiceStatus.APPROVED, CustomerInvoiceStatus.SENT, {
      sentAt: new Date(),
    });
  }

  markPaid(tenantId: string, userId: string, id: string, paidAt?: string) {
    return this.transition(tenantId, userId, id, CustomerInvoiceStatus.SENT, CustomerInvoiceStatus.PAID, {
      paidAt: paidAt ? new Date(paidAt) : new Date(),
    });
  }
}
```

⚠️ Vérifier la signature réelle d'`EmailService.send` (retourne-t-elle un booléen ? — voir l'usage `const sent = await this.email.send` dans `tenders.service.ts`) et adapter.

- [ ] **Step 2 : Controller** — `customer-invoices.controller.ts` :

```ts
import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthUser, CustomerInvoiceStatus } from '@pulsar/shared';
import { MODULE_KEYS, PERMISSIONS } from '@pulsar/shared';
import { IsDateString, IsOptional, IsString } from 'class-validator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequireModule } from '../../common/decorators/require-module.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CustomerInvoicesService } from './customer-invoices.service';

class DraftStatementsDto {
  @IsString()
  customerId!: string;
}

class MarkStatementPaidDto {
  @IsOptional()
  @IsDateString()
  paidAt?: string;
}

@ApiTags('billing')
@ApiBearerAuth()
@RequireModule(MODULE_KEYS.BILLING)
@Controller('billing/customer-invoices')
export class CustomerInvoicesController {
  constructor(private readonly statements: CustomerInvoicesService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.BILLING.CUSTOMER_INVOICES_READ)
  list(
    @CurrentUser() user: AuthUser,
    @Query('status') status?: CustomerInvoiceStatus,
    @Query('customerId') customerId?: string,
  ) {
    return this.statements.list(user.tenantId, status, customerId);
  }

  /** Preview: ratable orders with amounts + unratable ones with reasons. */
  @Get('billable')
  @RequirePermissions(PERMISSIONS.BILLING.CUSTOMER_INVOICES_READ)
  billable(@CurrentUser() user: AuthUser, @Query('customerId') customerId: string) {
    return this.statements.billable(user.tenantId, customerId);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.BILLING.CUSTOMER_INVOICES_READ)
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.statements.get(user.tenantId, id);
  }

  /** One DRAFT statement per currency encountered among the customer's billable orders. */
  @Post()
  @RequirePermissions(PERMISSIONS.BILLING.CUSTOMER_INVOICES_MANAGE)
  create(@CurrentUser() user: AuthUser, @Body() dto: DraftStatementsDto) {
    return this.statements.createDrafts(user.tenantId, user.id, dto.customerId);
  }

  /** DRAFT only — frees the orders for regeneration (the draft escape path). */
  @Delete(':id')
  @RequirePermissions(PERMISSIONS.BILLING.CUSTOMER_INVOICES_MANAGE)
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.statements.deleteDraft(user.tenantId, user.id, id);
  }

  @Post(':id/approve')
  @RequirePermissions(PERMISSIONS.BILLING.CUSTOMER_INVOICES_MANAGE)
  approve(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.statements.approve(user.tenantId, user.id, id);
  }

  @Post(':id/send')
  @RequirePermissions(PERMISSIONS.BILLING.CUSTOMER_INVOICES_SEND)
  send(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.statements.send(user.tenantId, user.id, id);
  }

  @Post(':id/pay')
  @RequirePermissions(PERMISSIONS.BILLING.CUSTOMER_INVOICES_PAY)
  markPaid(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: MarkStatementPaidDto) {
    return this.statements.markPaid(user.tenantId, user.id, id, dto.paidAt);
  }
}
```

- [ ] **Step 3 : Module** — lire `billing.module.ts` ; exporter `RatingService` depuis `TransportationModule` (`exports: [RatingService]`) et ajouter `TransportationModule` aux imports de `BillingModule` ; enregistrer controller + service.

- [ ] **Step 4 : Test jest du groupement** — `apps/api/src/modules/billing/customer-invoices.service.spec.ts` :

```ts
import { groupByCurrency } from './customer-invoices.service';

describe('groupByCurrency', () => {
  it('one group per currency, order preserved', () => {
    const groups = groupByCurrency([
      { orderId: '1', orderNumber: 'TO-1', amount: 100, currency: 'CAD', snapshot: {} },
      { orderId: '2', orderNumber: 'TO-2', amount: 200, currency: 'USD', snapshot: {} },
      { orderId: '3', orderNumber: 'TO-3', amount: 300, currency: 'CAD', snapshot: {} },
    ]);
    expect([...groups.keys()]).toEqual(['CAD', 'USD']);
    expect(groups.get('CAD')!.map((r) => r.orderId)).toEqual(['1', '3']);
  });
});
```

- [ ] **Step 5 : Vérifier + commit** — `pnpm typecheck && pnpm test` → PASS.

```bash
git add apps/api/src/modules/billing apps/api/src/modules/transportation/transportation.module.ts
git commit -m "feat(api): customer billing statements — rating-priced drafts per currency, draft deletion, approve/send/pay with conditional transitions"
```

---

### Task 5 : Suite e2e

**Files:**
- Create: `apps/api/test/phase7-3-sell-side.e2e-spec.ts`

- [ ] **Step 1 : Écrire la suite** (squelette standard : login seedé, suffixe unique ; activer le module billing comme `phase5.e2e-spec.ts` le fait). Scénario complet :

1. Master data : customer (avec `email`), 2 locations (city/state/country), carrier, **tarif CLIENT** FLAT 500 CAD sur lane CITY (status ACTIVE via PATCH), **2ᵉ tarif client** FLAT 400 **USD** catch-all (laneId null) pour le test multi-devises — NOTE : le rating prend le moins cher par `compareRateOptions` (tri par devise d'abord) — pour rendre le test déterministe, créer le tarif USD pour un AUTRE customer OU pour le même client mais avec `validTo` passé puis l'activer seulement pour le test devise (préférer : 3 commandes — 2 cotées CAD, puis activer le tarif USD AVANT la 3ᵉ → vérifier 2 factures générées, une par devise... simplification acceptée : voir step e2e 6).
2. Commande → confirm → plan → load → assign carrier → dispatch → transit → complete (livrée).
3. `GET /billing/customer-invoices/billable?customerId=` → la commande est `ratable` avec montant 500 CAD ; une commande d'un client SANS tarif → `unratable` avec `NO_APPLICABLE_RATE`.
4. `POST /billing/customer-invoices` → 1 facture DRAFT, `invoiceNumber` matche `/^CINV-\d{6}$/`, ligne avec `priceDetail.version === 1`, `priceDetail.result.total === 500`.
5. **Anti-double-facturation** : seconde génération → 400 (`No ratable delivered orders`).
6. **Multi-devises** : livrer 2 nouvelles commandes du même client, activer un 2ᵉ tarif client USD moins cher sur la même lane AVANT la génération → `POST` → 2 factures (une CAD si un tarif CAD reste gagnant sur l'une, une USD) — SI le rating fait gagner USD partout, ajuster pour que les 2 devises coexistent (ex. le tarif USD a `validFrom` postérieur à la livraison de la 1ʳᵉ commande). L'assertion ferme : `invoices.length === 2` et devises distinctes. (Itérer sur la mécanique exacte en exécutant — c'est le test le plus délicat de la suite.)
7. **Invariant** : PATCH du tarif client (baseAmount 99999) → `GET` la facture → `totalAmount` et `priceDetail` inchangés.
8. **Sortie de brouillon** : `DELETE` la facture DRAFT → 200 → la commande réapparaît dans `billable` → regénération OK. `DELETE` sur une APPROVED → 400.
9. Transitions : approve → send (le client a un email ; `sentAt` non null) → pay (`paidAt`). Tentatives invalides : send sur DRAFT → 400 ; pay sur APPROVED → 400.

⚠️ Statuts : aligner sur l'observé (POST 201, DELETE 200…). Ne JAMAIS modifier l'API pour faire passer un test — BLOCKED si bug réel.

- [ ] **Step 2 : Itérer puis full run** — suite seule d'abord, puis `pnpm test:e2e` complet (12 suites) → tout vert ; `pnpm test`, `pnpm typecheck`.

- [ ] **Step 3 : Commit**

```bash
git add apps/api/test
git commit -m "test(e2e): phase 7.3 — sell-side statements: rating-priced drafts, currency split, draft escape, frozen snapshot, full lifecycle"
```

---

### Task 6 : Web — onglets Carrier / Customer statements

**Files:**
- Modify: `apps/web/src/routes/(app)/invoices/+page.svelte`

- [ ] **Step 1 :** Lire la page actuelle (buy-side). La restructurer en deux onglets (`$state` `activeTab: 'carrier' | 'customer'`, deux boutons en tête, contenu conditionnel) :
  - Onglet **Carrier invoices** : le contenu existant, inchangé.
  - Onglet **Customer statements** : sélecteur de client (GET /transportation/customers pageSize 100) → bouton « Preview billable » (`GET /billing/customer-invoices/billable?customerId=`) affichant deux listes : ratable (orderNumber + montant + devise) et unratable (orderNumber + badge motif) → bouton « Generate statements » (`POST`, toast du nombre de factures créées + devise(s)) → liste des relevés (`GET /billing/customer-invoices`, colonnes number/customer/status/currency/total/dates) → détail dépliable par relevé : lignes (orderNumber, description, montant) avec snapshot `priceDetail` dépliable (réutiliser l'idiome du snapshot 7.1 du load detail), boutons d'action selon statut : Approve (DRAFT), Send (APPROVED — confirmation « sends an email to the customer »), Mark paid (SENT), **Delete draft** (DRAFT, confirmation).
  - Wording UI : « Customer statements » / « billing statement » — jamais « invoice » seul pour le sell-side.
- [ ] **Step 2 :** `pnpm typecheck && pnpm build` → PASS.
- [ ] **Step 3 : Commit**

```bash
git add "apps/web/src/routes/(app)/invoices"
git commit -m "feat(web): customer statements tab — billable preview with reasons, per-currency generation, lifecycle actions, draft deletion"
```

---

### Task 7 : Docs + vérification finale

**Files:**
- Modify: `TODO.md`, `ROADMAP.md`, `docs/etat-du-projet.md`, `docs/data-model.md`, `docs/collaboration.md`

- [ ] **Step 1 :** RÈGLE ABSOLUE (leçon 7.1) : documenter depuis le code livré. TODO : cocher 7.3 (détail) ; ROADMAP : ✅ 7.3 + **note « taxes (TPS/TVQ/TVA) = premier ajout post-7.3 si des clients facturent réellement »** ; etat-du-projet : ligne 7.3, chiffres réels (compter), prochaine session → 7.4 ; data-model : section CustomerInvoice/Line + invariants (snapshot figé, DELETE-DRAFT seule sortie) + règle devise ; collaboration.md : le courriel « billing statement » (canal, wording).
- [ ] **Step 2 :** Gates : `pnpm typecheck && pnpm build && pnpm test && pnpm test:e2e` → tout vert (échec → BLOCKED).
- [ ] **Step 3 : Commit**

```bash
git add TODO.md ROADMAP.md docs
git commit -m "docs: phase 7.3 sell-side statements shipped — model, invariants, currency rule, tax note"
```
