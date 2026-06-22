# Tressage automatique v1 (arc B) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permettre à la plateforme de réagir : un événement métier déclenche automatiquement une opération whitelistée dans un autre module (déterministe, idempotente, anti-boucle, auditée), via une extension `RUN_ACTION` du moteur `AutomationRule` existant + l'émission des événements de cycle de vie manquants.

**Architecture:** On émet 5 nouveaux `DomainEvent`. On étend le `RuleAction` (`@pulsar/shared`) d'une variante `RUN_ACTION` pointant une clé du `REACTION_CATALOG` pur. Un `ReactionExecutorService` (API) mappe chaque clé à un handler réutilisant les services métier ; `DomainEventsService.processPending` exécute les commandes de réaction après la création des tâches, avec un ledger d'idempotence (`ReactionExecution`) et un tag anti-boucle (`DomainEvent.reactionRuleId` via AsyncLocalStorage). 2 tressages built-in seedés + l'éditeur web existant étendu.

**Tech Stack:** NestJS + Prisma ; `@pulsar/shared` (TS pur, vitest) ; class-validator ; `AsyncLocalStorage` (node:async_hooks, API-only) ; SvelteKit ; Jest e2e.

## Global Constraints

- **Whitelist sûre & réversible uniquement** : seules les opérations du `REACTION_CATALOG` s'auto-exécutent (créer pick, facture brouillon, avancer statut interne). Jamais d'effet externe / argent sortant (backlog).
- **Idempotence** : `ReactionExecution @@unique([tenantId, eventId, ruleId])` ; une commande déjà exécutée est skippée.
- **Anti-boucle single-hop** : les `DomainEvent` émis pendant une réaction portent `reactionRuleId` ; `processPending` n'évalue PAS les règles `RUN_ACTION` pour un événement tagué (les `CREATE_TASK` et agents continuent).
- **Best-effort & isolé** : un échec de réaction est loggé + `ReactionExecution.status=FAILED` + audité ; ne throw jamais, ne bloque ni l'événement ni les autres réactions/tâches (règle 27).
- **Audit** : chaque exécution via `AuditLogsService.log` avec l'acteur = **service-account du tenant** (règle 13) et la cause (`ruleId`/`eventId`).
- **Module gating** : une réaction dont un `requiredModules` est désactivé pour le tenant est un no-op.
- **Règle 1 (tenant isolation)** partout. **Règle 2** : aucun nouveau statut métier, aucune state machine modifiée. **Règle 7** : rebuild `@pulsar/shared`/`@pulsar/database` après modif.
- **`@pulsar/shared` browser-safe** : pas d'import Node dans les fichiers shared (AsyncLocalStorage vit côté API uniquement).
- **Permissions** : réutiliser `core.automation.rules.read|manage` (existantes) — aucune nouvelle.
- Les invariants des services réutilisés sont préservés (pick = règle 33 ; facture brouillon = anti-double-billing 7.3).

---

## File Structure

**Créés :**
- `packages/shared/src/automation/reactions.ts` — `ReactionDescriptor` + `REACTION_CATALOG` + `reactionByKey`.
- `packages/shared/src/automation/reactions.spec.ts`, additions à `rules.spec.ts` (ou nouveau) pour `produceRuleReaction`.
- `apps/api/src/core/automation/reaction-executor.service.ts` — handlers + contexte anti-boucle (AsyncLocalStorage) + idempotence.
- `apps/api/test/cross-module-automation.e2e-spec.ts`.

**Modifiés :**
- `packages/shared/src/operating/policies.ts` — `DOMAIN_EVENT_TYPES` += 5.
- `packages/shared/src/automation/rules.ts` — `RuleAction` union + `ReactionCommand` + `produceRuleReaction` + descriptors des 5 events dans `AUTOMATION_EVENT_CATALOG`.
- `packages/shared/src/index.ts` — export `reactions`.
- `packages/database/prisma/schema.prisma` — `ReactionExecution` model + `DomainEvent.reactionRuleId`.
- `apps/api/src/core/operating/domain-events.service.ts` — `emit` lit l'ALS (stamp `reactionRuleId`) ; `processPending` exécute les réactions (ledger + skip si tagué).
- `apps/api/src/core/automation/custom-rule.resolver.ts` — retourne `{ taskSpecs, reactionCommands }`.
- `apps/api/src/core/automation/dto/automation-rule.dto.ts` — `RuleActionDto` accepte `RUN_ACTION`.
- `apps/api/src/core/automation/automation-rules.service.ts` — valide `RUN_ACTION` contre le catalogue.
- `apps/api/src/core/automation/automation.module.ts` (ou le module qui fournit le resolver) — déclare `ReactionExecutorService`, importe les modules métier (WMS/Billing) pour les handlers.
- Services émetteurs : `transport-orders.service.ts` (plan), `loads.service.ts` (dispatch, complete), `yard/visits/visits.service.ts` (checkOut), `wms/receiving/receiving.service.ts` (post).
- `packages/database/prisma/seed.ts` (ou le fichier seed) — 2 règles built-in.
- `apps/web/src/routes/(app)/automation/+page.svelte` — éditeur étendu `RUN_ACTION`.
- `docs/etat-du-projet.md`, `CLAUDE.md`.

---

## Task 1: `@pulsar/shared` — events, catalogue de réactions, `RUN_ACTION`

**Files:**
- Modify: `packages/shared/src/operating/policies.ts`, `packages/shared/src/automation/rules.ts`, `packages/shared/src/index.ts`
- Create: `packages/shared/src/automation/reactions.ts`, `packages/shared/src/automation/reactions.spec.ts`

**Interfaces:**
- Produces:
  - `DOMAIN_EVENT_TYPES` += `TRANSPORT_ORDER_PLANNED='transport-order.planned'`, `LOAD_DISPATCHED='load.dispatched'`, `LOAD_COMPLETED='load.completed'`, `YARD_VISIT_CHECKED_OUT='yard.visit.checked-out'`, `WMS_RECEIPT_POSTED='wms.receipt.posted'`.
  - `interface ReactionDescriptor { key: string; label: string; module: string; requiredModules: string[]; description: string; argKeys: string[] }`
  - `REACTION_CATALOG: ReactionDescriptor[]` (2 entries) ; `reactionByKey(key): ReactionDescriptor | undefined`.
  - `RuleAction = CreateTaskAction | RunActionAction` where `RunActionAction = { kind: 'RUN_ACTION'; action: string; args: Record<string, string> }`.
  - `interface ReactionCommand { ruleId: string; action: string; args: Record<string, string> }`
  - `produceRuleReaction(rule: AutomationRuleLike, event: DomainEventInput): ReactionCommand | null`

- [ ] **Step 1: Write the failing tests**

Create `packages/shared/src/automation/reactions.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { REACTION_CATALOG, reactionByKey } from './reactions';
import { produceRuleReaction, type AutomationRuleLike } from './rules';

describe('REACTION_CATALOG', () => {
  it('contains the 2 v1 reactions with required modules', () => {
    const keys = REACTION_CATALOG.map((r) => r.key);
    expect(keys).toContain('create_picks_for_order');
    expect(keys).toContain('draft_customer_invoice');
    expect(reactionByKey('create_picks_for_order')?.requiredModules).toContain('wms');
    expect(reactionByKey('draft_customer_invoice')?.requiredModules).toContain('billing');
    expect(reactionByKey('nope')).toBeUndefined();
  });
});

describe('produceRuleReaction', () => {
  const rule: AutomationRuleLike = {
    id: 'r1', eventType: 'transport-order.planned', match: 'ALL', conditions: [],
    action: { kind: 'RUN_ACTION', action: 'create_picks_for_order', args: { orderId: '{orderId}' } },
  };
  it('interpolates args from the payload', () => {
    const cmd = produceRuleReaction(rule, { type: 'transport-order.planned', payload: { orderId: 'O-1' } });
    expect(cmd).toEqual({ ruleId: 'r1', action: 'create_picks_for_order', args: { orderId: 'O-1' } });
  });
  it('returns null for a CREATE_TASK rule', () => {
    const taskRule: AutomationRuleLike = { ...rule, action: { kind: 'CREATE_TASK', category: 'X', severity: 'INFO', titleTemplate: 't', assignHint: 'AUTO' } };
    expect(produceRuleReaction(taskRule, { type: 'transport-order.planned', payload: {} })).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @pulsar/shared test`
Expected: FAIL (`./reactions` missing; `produceRuleReaction` undefined).

- [ ] **Step 3: Add the 5 event types**

In `packages/shared/src/operating/policies.ts`, add to the `DOMAIN_EVENT_TYPES` object:

```ts
  TRANSPORT_ORDER_PLANNED: 'transport-order.planned',
  LOAD_DISPATCHED: 'load.dispatched',
  LOAD_COMPLETED: 'load.completed',
  YARD_VISIT_CHECKED_OUT: 'yard.visit.checked-out',
  WMS_RECEIPT_POSTED: 'wms.receipt.posted',
```

- [ ] **Step 4: Create `reactions.ts`**

```ts
// Pure, browser-safe.
export interface ReactionDescriptor {
  key: string;
  label: string;
  /** Owning module of the operation (display). */
  module: string;
  /** Modules that must be enabled for the tenant or the reaction is a no-op. */
  requiredModules: string[];
  description: string;
  /** Argument keys the handler expects (mapped from the event payload via templates). */
  argKeys: string[];
}

export const REACTION_CATALOG: ReactionDescriptor[] = [
  {
    key: 'create_picks_for_order',
    label: 'Créer les pick orders de la commande',
    module: 'wms',
    requiredModules: ['wms'],
    description:
      'Pour chaque shipment de la commande dont l’origine est un entrepôt, crée un pick order lié (s’il n’en a pas déjà un).',
    argKeys: ['orderId'],
  },
  {
    key: 'draft_customer_invoice',
    label: 'Créer un relevé client brouillon',
    module: 'billing',
    requiredModules: ['billing'],
    description:
      'Crée un relevé client brouillon pour les clients des commandes livrées du load (anti-double-billing).',
    argKeys: ['loadId'],
  },
];

const BY_KEY = new Map(REACTION_CATALOG.map((r) => [r.key, r]));
export function reactionByKey(key: string): ReactionDescriptor | undefined {
  return BY_KEY.get(key);
}
```

- [ ] **Step 5: Extend `RuleAction` + add `produceRuleReaction`**

In `packages/shared/src/automation/rules.ts`, change the `RuleAction` definition:

```ts
export interface CreateTaskAction {
  kind: 'CREATE_TASK';
  category: string;
  severity: Severity;
  titleTemplate: string;
  assignHint: AssignHint;
  subjectField?: string;
  subjectType?: string;
}

export interface RunActionAction {
  kind: 'RUN_ACTION';
  /** A REACTION_CATALOG key. */
  action: string;
  /** Arg templates interpolated from the event payload, e.g. { orderId: '{orderId}' }. */
  args: Record<string, string>;
}

export type RuleAction = CreateTaskAction | RunActionAction;

export interface ReactionCommand {
  ruleId: string;
  action: string;
  args: Record<string, string>;
}
```

`produceRuleTaskSpec` must guard on kind (return null if not CREATE_TASK). At the top of `produceRuleTaskSpec`, after resolving subjectId:

```ts
  if (rule.action.kind !== 'CREATE_TASK') return null;
```
(and reference `rule.action` as `CreateTaskAction` thereafter — TypeScript narrows after the guard).

Add the new pure function:

```ts
/** Produces a ReactionCommand for a RUN_ACTION rule (args interpolated), or null otherwise. */
export function produceRuleReaction(
  rule: AutomationRuleLike,
  event: DomainEventInput,
): ReactionCommand | null {
  if (rule.action.kind !== 'RUN_ACTION') return null;
  const payload = event.payload ?? {};
  const args: Record<string, string> = {};
  for (const [k, tpl] of Object.entries(rule.action.args)) {
    args[k] = interpolateTemplate(tpl, payload);
  }
  return { ruleId: rule.id, action: rule.action.action, args };
}
```

- [ ] **Step 6: Add the 5 event descriptors to `AUTOMATION_EVENT_CATALOG`**

In the same file, append 5 `AutomationEventDescriptor` entries (drives the builder dropdowns). Example for the two that have built-in reactions (add all 5, payload fields per Task 3 emit sites):

```ts
  {
    type: DOMAIN_EVENT_TYPES.TRANSPORT_ORDER_PLANNED,
    label: 'Commande planifiée',
    description: 'Une commande a été planifiée (ses shipments existent).',
    fields: [f('orderId', 'ID commande'), f('orderNumber', 'N° commande'), f('shipmentCount', 'Nb shipments', 'number')],
    defaultSubjectField: 'orderId',
  },
  {
    type: DOMAIN_EVENT_TYPES.LOAD_DISPATCHED,
    label: 'Load dispatché',
    description: 'Un load est passé en dispatché.',
    fields: [f('loadId', 'ID load'), f('loadNumber', 'N° load'), f('carrierId', 'ID transporteur')],
    defaultSubjectField: 'loadId',
  },
  {
    type: DOMAIN_EVENT_TYPES.LOAD_COMPLETED,
    label: 'Load livré',
    description: 'Un load est livré/complété.',
    fields: [f('loadId', 'ID load'), f('loadNumber', 'N° load')],
    defaultSubjectField: 'loadId',
  },
  {
    type: DOMAIN_EVENT_TYPES.YARD_VISIT_CHECKED_OUT,
    label: 'Départ de cour',
    description: 'Une visite de cour a été clôturée (check-out).',
    fields: [f('visitId', 'ID visite'), f('visitNumber', 'N° visite')],
    defaultSubjectField: 'visitId',
  },
  {
    type: DOMAIN_EVENT_TYPES.WMS_RECEIPT_POSTED,
    label: 'Réception postée',
    description: 'Une réception entrepôt a été postée (stock disponible).',
    fields: [f('receiptId', 'ID réception'), f('number', 'N° réception')],
    defaultSubjectField: 'receiptId',
  },
```

- [ ] **Step 7: Export from barrel**

In `packages/shared/src/index.ts`, after `export * from './automation/rules';` add:

```ts
export * from './automation/reactions';
```

- [ ] **Step 8: Run tests + the full shared suite**

Run: `pnpm --filter @pulsar/shared test`
Expected: PASS (new + existing, no regression). If `produceRuleTaskSpec`'s narrowing breaks an existing test, fix the type access.

- [ ] **Step 9: Rebuild + commit**

```bash
pnpm --filter @pulsar/shared build
git add packages/shared/src
git commit -m "feat(shared): RUN_ACTION rule action + reaction catalogue + 5 lifecycle events"
```

---

## Task 2: Migration — `ReactionExecution` + `DomainEvent.reactionRuleId`

**Files:**
- Modify: `packages/database/prisma/schema.prisma`

**Interfaces:**
- Produces: model `ReactionExecution` (idempotency ledger) + `DomainEvent.reactionRuleId String?`.

- [ ] **Step 1: Add the model + column**

In `schema.prisma`, add `reactionRuleId String?` to the `DomainEvent` model. Add a new model:

```prisma
model ReactionExecution {
  id        String   @id @default(cuid())
  tenantId  String
  eventId   String
  ruleId    String
  action    String
  status    String   // 'EXECUTED' | 'FAILED'
  error     String?
  createdAt DateTime @default(now())

  @@unique([tenantId, eventId, ruleId])
  @@index([tenantId, createdAt])
  @@map("reaction_executions")
}
```

- [ ] **Step 2: Migrate (non-interactive) + build**

```bash
pnpm db:up
pnpm --filter @pulsar/database exec prisma migrate dev --name cross_module_reactions
pnpm --filter @pulsar/database build
```
Expected: migration applied. (If "URL must start with prisma://" later: `pnpm db:generate`.) Note: the shared dev DB may carry unrelated migrations from other branches — do NOT `migrate reset`; if `migrate dev` reports drift you cannot resolve cleanly, STOP and report.

- [ ] **Step 3: Commit**

```bash
git add packages/database/prisma/schema.prisma packages/database/prisma/migrations
git commit -m "feat(db): ReactionExecution ledger + DomainEvent.reactionRuleId"
```

---

## Task 3: B1 — emit the 5 lifecycle events

**Files:**
- Modify: `transport-orders.service.ts` (plan), `loads.service.ts` (dispatch + complete), `yard/visits/visits.service.ts` (checkOut), `wms/receiving/receiving.service.ts` (post)

**Interfaces:**
- Consumes: `DomainEventsService.emit(tenantId, type, subject, payload)` (already injected in services that emit, e.g. tenders; inject it where absent). `DOMAIN_EVENT_TYPES` (Task 1).
- Produces: 5 events emitted best-effort with the payload fields named in Task 1's descriptors.

- [ ] **Step 1: Emit `transport-order.planned`**

In `transport-orders.service.ts` `plan(...)`, after the shipments are created/committed, add (best-effort, never blocking — mirror how tenders.service emits):

```ts
await this.domainEvents.emit(
  tenantId,
  DOMAIN_EVENT_TYPES.TRANSPORT_ORDER_PLANNED,
  { type: 'transport-order', id: orderId },
  { orderId, orderNumber: order.orderNumber, shipmentCount: createdShipments.length },
);
```
Inject `DomainEventsService` in the constructor if not present (import from `core/operating/domain-events.service`). Use the actual variable names for the order + created shipments in that method.

- [ ] **Step 2: Emit `load.dispatched` and `load.completed`**

In `loads.service.ts` `dispatch()` (after the transaction succeeds) and `complete()` (after the transaction succeeds), add:

```ts
// dispatch():
await this.domainEvents.emit(tenantId, DOMAIN_EVENT_TYPES.LOAD_DISPATCHED, { type: 'load', id }, { loadId: id, loadNumber: load.loadNumber, carrierId: load.carrierId ?? null });
// complete():
await this.domainEvents.emit(tenantId, DOMAIN_EVENT_TYPES.LOAD_COMPLETED, { type: 'load', id }, { loadId: id, loadNumber: load.loadNumber });
```
`loads.service` already emits webhooks in these methods — place the domain event next to those, and inject `DomainEventsService` if absent.

- [ ] **Step 3: Emit `yard.visit.checked-out`**

In `yard/visits/visits.service.ts` `checkOut(...)`, after the checkout transaction (the service already emits `yard.visit.checked-in`/`detention`, so `domainEvents` is injected), add:

```ts
await this.domainEvents.emit(tenantId, DOMAIN_EVENT_TYPES.YARD_VISIT_CHECKED_OUT, { type: 'yard-visit', id: visitId }, { visitId, visitNumber: visit.visitNumber });
```

- [ ] **Step 4: Emit `wms.receipt.posted`**

In `wms/receiving/receiving.service.ts`, in the method that posts a receipt (DRAFT→POSTED), after success, add:

```ts
await this.domainEvents.emit(tenantId, DOMAIN_EVENT_TYPES.WMS_RECEIPT_POSTED, { type: 'wms-receipt', id: receiptId }, { receiptId, number: receipt.number });
```
Inject `DomainEventsService` if absent (confirm `DomainEventsModule`/service is importable from this module; it is a core service used elsewhere).

- [ ] **Step 5: Typecheck**

Run: `pnpm typecheck`
Expected: no NEW errors. (Behaviour verified by Task 8 e2e; emits are best-effort.)

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules
git commit -m "feat(api): emit planned/dispatched/completed/checked-out/receipt-posted domain events"
```

---

## Task 4: `ReactionExecutorService` — handlers + anti-loop context + idempotency

**Files:**
- Create: `apps/api/src/core/automation/reaction-executor.service.ts`
- Modify: the module that owns automation (`automation.module.ts` or `operating.module.ts` — wherever `CustomRuleResolver` is provided) to provide `ReactionExecutorService` and import the business modules (WMS picking, Billing customer-invoices).

**Interfaces:**
- Consumes: `REACTION_CATALOG`/`reactionByKey` (Task 1) ; `PickingService.create(tenantId, userId, { locationId, shipmentId })` ; `CustomerInvoicesService.createDrafts(tenantId, userId, customerId)` ; `PrismaService` ; `AuditLogsService` ; `TenantModulesCacheService` (module gating).
- Produces:
  - `runInReactionContext<T>(ruleId: string, fn: () => Promise<T>): Promise<T>` (AsyncLocalStorage) + `currentReactionRuleId(): string | null`.
  - `executeCommand(tenantId: string, eventId: string, command: ReactionCommand): Promise<void>` — idempotent (claim `ReactionExecution`), module-gated, best-effort (never throws), audited.

- [ ] **Step 1: Implement the service**

```ts
import { Injectable, Logger } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';
import { reactionByKey, type ReactionCommand, AuditAction } from '@pulsar/shared';
import { Prisma } from '@pulsar/database';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { TenantModulesCacheService } from '../../prisma/tenant-modules-cache.service';
import { PickingService } from '../../modules/wms/picking/picking.service';
import { CustomerInvoicesService } from '../../modules/billing/customer-invoices.service';

const als = new AsyncLocalStorage<{ reactionRuleId: string }>();
export function currentReactionRuleId(): string | null {
  return als.getStore()?.reactionRuleId ?? null;
}

@Injectable()
export class ReactionExecutorService {
  private readonly logger = new Logger(ReactionExecutorService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
    private readonly modules: TenantModulesCacheService,
    private readonly picking: PickingService,
    private readonly customerInvoices: CustomerInvoicesService,
  ) {}

  runInReactionContext<T>(ruleId: string, fn: () => Promise<T>): Promise<T> {
    return als.run({ reactionRuleId: ruleId }, fn);
  }

  /** Idempotent, module-gated, best-effort. Never throws. */
  async executeCommand(tenantId: string, eventId: string, command: ReactionCommand): Promise<void> {
    const descriptor = reactionByKey(command.action);
    if (!descriptor) {
      this.logger.warn(`Unknown reaction "${command.action}" (rule ${command.ruleId})`);
      return;
    }
    // Module gating — no-op if a required module is disabled.
    for (const m of descriptor.requiredModules) {
      const enabled = await this.modules.isEnabled(tenantId, m).catch(() => false);
      if (!enabled) return;
    }
    // Idempotency claim: insert the ledger row; on unique conflict, already executed → skip.
    try {
      await this.prisma.reactionExecution.create({
        data: { tenantId, eventId, ruleId: command.ruleId, action: command.action, status: 'EXECUTED' },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return; // already done
      this.logger.error(`reaction ledger insert failed: ${String(e)}`);
      return;
    }
    // Execute the handler inside the anti-loop context.
    try {
      await this.runInReactionContext(command.ruleId, () => this.dispatch(tenantId, command));
      await this.audit.log({
        tenantId,
        action: AuditAction.UPDATE,
        entityType: 'reaction',
        entityId: `${command.ruleId}:${eventId}`,
        after: { action: command.action, args: command.args, status: 'EXECUTED' },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`reaction ${command.action} (rule ${command.ruleId}) failed: ${msg}`);
      await this.prisma.reactionExecution.updateMany({
        where: { tenantId, eventId, ruleId: command.ruleId },
        data: { status: 'FAILED', error: msg.slice(0, 500) },
      });
      await this.audit.log({
        tenantId, action: AuditAction.UPDATE, entityType: 'reaction',
        entityId: `${command.ruleId}:${eventId}`, after: { action: command.action, status: 'FAILED', error: msg.slice(0, 500) },
      }).catch(() => undefined);
    }
  }

  private async dispatch(tenantId: string, command: ReactionCommand): Promise<void> {
    const sysUserId = await this.serviceAccountUserId(tenantId);
    switch (command.action) {
      case 'create_picks_for_order':
        return this.createPicksForOrder(tenantId, sysUserId, command.args.orderId);
      case 'draft_customer_invoice':
        return this.draftCustomerInvoice(tenantId, sysUserId, command.args.loadId);
    }
  }

  private async createPicksForOrder(tenantId: string, userId: string, orderId: string): Promise<void> {
    if (!orderId) return;
    const shipments = await this.prisma.shipment.findMany({
      where: { tenantId, transportOrderId: orderId, originLocation: { type: 'WAREHOUSE' } },
      select: { id: true, originLocationId: true, pickOrders: { select: { id: true } } },
    });
    for (const s of shipments) {
      if (s.pickOrders.length > 0) continue; // idempotent at the business level
      await this.picking.create(tenantId, userId, { locationId: s.originLocationId, shipmentId: s.id } as never);
    }
  }

  private async draftCustomerInvoice(tenantId: string, userId: string, loadId: string): Promise<void> {
    if (!loadId) return;
    const shipments = await this.prisma.shipment.findMany({
      where: { tenantId, loadId },
      select: { transportOrder: { select: { customerId: true } } },
    });
    const customerIds = [...new Set(shipments.map((s) => s.transportOrder.customerId))];
    for (const customerId of customerIds) {
      await this.customerInvoices.createDrafts(tenantId, userId, customerId); // anti-double-billing is internal
    }
  }

  private async serviceAccountUserId(tenantId: string): Promise<string> {
    const user = await this.prisma.user.findFirst({
      where: { tenantId, email: 'service-account@pulsar.local' },
      select: { id: true },
    });
    if (!user) throw new Error('service-account user missing for tenant');
    return user.id;
  }
}
```

> IMPLEMENTER NOTES (confirm against real code; adapt without changing the contract):
> - `TenantModulesCacheService` method to check a module: confirm the exact name (`isEnabled(tenantId, key)` or similar) and the module key strings (`'wms'`, `'billing'` — match `MODULE_KEYS`).
> - `CreatePickOrderDto` shape: confirm fields (`locationId`, `shipmentId`) — the `as never` cast is a placeholder; use the real DTO type. `PickingService.create` may create an empty pick (no lines) — that is the intended v1 braid (shipment enters the picking queue). Confirm it does not throw on zero lines; if it requires lines, the handler creates the pick without lines or the plan is adjusted — report if it throws.
> - `CustomerInvoicesService.createDrafts(tenantId, userId, customerId)` — confirm signature + that it is idempotent/anti-double-billing (phase 7.3 `transportOrderId @unique`). It drafts from the customer's delivered orders; calling it for a load's customers drafts those orders.
> - The service-account resolution: confirm `service-account@pulsar.local` is the correct per-tenant system user (rule 13). If a shared helper exists for "system user id", use it.
> - `AuditLogsService.log` signature + `AuditAction` import (mirror existing usage).

- [ ] **Step 2: Register in the module + imports**

In the module providing `CustomRuleResolver` (find it — `automation.module.ts` or `operating.module.ts`): add `ReactionExecutorService` to `providers` and **export it** (consumed by `DomainEventsService` in Task 5). Add `imports` for the modules exporting `PickingService` (WMS module) and `CustomerInvoicesService` (Billing module) — confirm those services are exported by their modules; if not, export them. Watch for DI cycles (WMS/Billing importing back into operating) — if a cycle appears, report it (a `forwardRef` may be needed; flag before using).

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: no NEW errors.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/core/automation
git commit -m "feat(api): ReactionExecutorService (handlers, idempotency, anti-loop context)"
```

---

## Task 5: Wire reactions into the event pipeline + DTO/validation

**Files:**
- Modify: `apps/api/src/core/automation/custom-rule.resolver.ts`, `apps/api/src/core/operating/domain-events.service.ts`, `apps/api/src/core/automation/dto/automation-rule.dto.ts`, `apps/api/src/core/automation/automation-rules.service.ts`

**Interfaces:**
- Consumes: `produceRuleReaction`, `ReactionCommand`, `reactionByKey` (Task 1) ; `ReactionExecutorService.executeCommand` + `currentReactionRuleId` (Task 4).
- Produces: `CustomRuleResolver.resolve` returns `{ taskSpecs: TaskSpec[]; reactionCommands: ReactionCommand[] }` ; `processPending` executes reactions ; `emit` stamps `reactionRuleId`.

- [ ] **Step 1: Resolver returns reaction commands too**

In `custom-rule.resolver.ts`, change the return type to `{ taskSpecs: TaskSpec[]; reactionCommands: ReactionCommand[] }`. For each enabled rule whose conditions match: if `action.kind === 'CREATE_TASK'` push `produceRuleTaskSpec(...)`; if `'RUN_ACTION'` push `produceRuleReaction(...)`. Keep the existing best-effort try/catch per rule and top-level. Update the existing call sites accordingly.

- [ ] **Step 2: `emit` stamps `reactionRuleId` from the ALS**

In `domain-events.service.ts` `emit(...)`, set the column from the reaction context:

```ts
import { currentReactionRuleId } from '../automation/reaction-executor.service';
// ...
data: { tenantId, type, subjectType: subject?.type ?? null, subjectId: subject?.id ?? null, payload, reactionRuleId: currentReactionRuleId() },
```
(Adapt to the real `create` data shape.)

- [ ] **Step 3: `processPending` executes reactions (skip if tagged)**

In `processPending`, after the task-creation loop for an event, fetch the event's `reactionRuleId` (select it when loading the event). Then:

```ts
// Reactions: skip entirely for reaction-originated events (anti-loop, single hop).
if (!event.reactionRuleId) {
  const { reactionCommands } = customResult; // resolver now returns both
  for (const command of reactionCommands) {
    await this.reactionExecutor.executeCommand(event.tenantId, event.id, command);
  }
}
```
Inject `ReactionExecutorService`. Keep everything best-effort: wrap the reaction loop so a failure never breaks event processing (executeCommand already never throws, but guard defensively). Ensure `resolve` is called once and both task specs + reaction commands are used. (CREATE_TASK rules still run for tagged events — only the reaction execution is skipped.)

- [ ] **Step 4: DTO accepts `RUN_ACTION`**

In `automation-rule.dto.ts`, relax `RuleActionDto`: `kind` `@IsIn(['CREATE_TASK','RUN_ACTION'])`; make `category`/`severity`/`titleTemplate`/`assignHint` `@IsOptional()`; add optional `action?: string` and `args?: Record<string,string>` (`@IsOptional() @IsObject()`). Semantic validation happens in the service (Step 5).

- [ ] **Step 5: Service validates `RUN_ACTION` against the catalogue**

In `automation-rules.service.ts` `create`/`update`, before persisting, validate the action:
- if `kind==='CREATE_TASK'`: require `category`, `severity`, `titleTemplate`, `assignHint` (else `BadRequestException`).
- if `kind==='RUN_ACTION'`: require `reactionByKey(action)` to exist (else `BadRequestException('Unknown reaction')`) and `args` to be an object.

```ts
import { reactionByKey } from '@pulsar/shared';
// in create/update, given dto.action:
if (dto.action.kind === 'RUN_ACTION') {
  if (!reactionByKey(dto.action.action)) throw new BadRequestException(`Unknown reaction "${dto.action.action}"`);
}
```

- [ ] **Step 6: Typecheck**

Run: `pnpm typecheck`
Expected: no NEW errors.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/core
git commit -m "feat(api): execute RUN_ACTION reactions in processPending (idempotent, anti-loop, validated)"
```

---

## Task 6: Seed the 2 built-in rules

**Files:**
- Modify: `packages/database/prisma/seed.ts` (or the seed entrypoint — confirm the file)

**Interfaces:**
- Consumes: `DOMAIN_EVENT_TYPES`, the reaction keys (Task 1). Creates `AutomationRule` rows for the demo tenant (and any newly-provisioned tenant if the seed templates that).

- [ ] **Step 1: Seed the built-in rules (idempotent upsert)**

In the seed, for the demo tenant, upsert two `AutomationRule` rows (use a stable id or a find-or-create keyed on name+eventType so reseeding doesn't duplicate):

```ts
// Rule 1: order planned -> create picks
await prisma.automationRule.create({ data: {
  tenantId, name: 'Auto-pick à la planification', eventType: 'transport-order.planned',
  enabled: true, match: 'ALL', conditions: [],
  action: { kind: 'RUN_ACTION', action: 'create_picks_for_order', args: { orderId: '{orderId}' } },
  createdById: adminUserId,
}});
// Rule 2: load completed -> draft customer invoice
await prisma.automationRule.create({ data: {
  tenantId, name: 'Relevé client à la livraison', eventType: 'load.completed',
  enabled: true, match: 'ALL', conditions: [],
  action: { kind: 'RUN_ACTION', action: 'draft_customer_invoice', args: { loadId: '{loadId}' } },
  createdById: adminUserId,
}});
```
Guard against duplicates on reseed (e.g. `findFirst` by `(tenantId, name)` then skip, or `upsert` on a unique). Match the seed's existing style/variable names (`tenantId`, admin user id).

- [ ] **Step 2: Reseed to verify**

```bash
pnpm db:seed
```
Expected: seed completes; the 2 rules exist for the demo tenant (re-runnable without duplication).

- [ ] **Step 3: Commit**

```bash
git add packages/database
git commit -m "feat(db): seed built-in cross-module reaction rules"
```

---

## Task 7: Web — extend the Automatisations editor for `RUN_ACTION`

**Files:**
- Modify: `apps/web/src/routes/(app)/automation/+page.svelte`

**Interfaces:**
- Consumes: `GET/POST/PATCH/DELETE` automation rules (existing) ; the reaction catalogue (fetch from an endpoint OR import the shared `REACTION_CATALOG` if the web imports `@pulsar/shared`).

- [ ] **Step 1: Add action-kind toggle + RUN_ACTION fields**

In the rule create/edit form, add a selector for `action.kind` (`CREATE_TASK` | `RUN_ACTION`). When `RUN_ACTION`: show a `<Select>` of reactions (label + key from `REACTION_CATALOG` — import from `@pulsar/shared`, it's pure/browser-safe) and, for each `argKeys` of the chosen reaction, an `<Input>` for the template (default `{<argKey>}`). When `CREATE_TASK`: keep the existing fields. Build the `action` payload accordingly on submit. Match the page's existing Svelte 5 runes + `$lib/components/ui` patterns; keep CREATE_TASK behaviour unchanged.

- [ ] **Step 2: Display the action kind in the rules list**

Show whether each rule is a task or a reaction (badge), and for reactions the reaction label. Read-only display from the rule's `action.kind`.

- [ ] **Step 3: Build web**

Run: `pnpm --filter @pulsar/web build`
Expected: build OK (no NEW errors).

- [ ] **Step 4: Commit**

```bash
git add apps/web/src
git commit -m "feat(web): automation editor supports RUN_ACTION reactions"
```

---

## Task 8: e2e `cross-module-automation` + docs

**Files:**
- Create: `apps/api/test/cross-module-automation.e2e-spec.ts`
- Modify: `docs/etat-du-projet.md`, `CLAUDE.md`

**Interfaces:**
- Consumes: everything, over HTTP + the Nest app's services. Reference harnesses: `apps/api/test/dispatch-workbench.e2e-spec.ts`, `apps/api/test/tms-configurable.e2e-spec.ts` (second tenant via Prisma), and any e2e that drives `processPending` (`app.get(DomainEventsService).processPending(...)`).

- [ ] **Step 1: Write the e2e**

Cases (drive real flows, then run the worker):
- **Emit**: plan an order → a `transport-order.planned` DomainEvent exists for the tenant; complete a load → `load.completed` exists.
- **Built-in WMS braid**: with the seeded rule active, plan an order whose shipment origin is a `WAREHOUSE` location, run `processPending`, then assert a `PickOrder` linked to that shipment was created (and exactly one — idempotent on re-run).
- **Built-in Billing braid**: complete a delivered load, run `processPending`, assert a DRAFT customer invoice exists for the order's customer.
- **Idempotence**: run `processPending` twice (or re-insert the same event id is impossible — instead re-trigger the same event scenario) → no duplicate pick / a single `ReactionExecution` row per (eventId, ruleId).
- **Anti-loop**: assert that a DomainEvent created during a reaction carries `reactionRuleId` and that `RUN_ACTION` rules are NOT evaluated for it (no cascade). (If hard to observe directly, assert no second-order reaction ledger row appears.)
- **Module disabled**: disable WMS for a tenant → the pick reaction is a no-op (no PickOrder, no EXECUTED ledger row) — or assert via a fresh tenant without WMS.
- **Rule disabled**: set the rule `enabled=false` → no action on the event.
- **Best-effort**: (optional) a reaction whose handler fails leaves `ReactionExecution=FAILED` and does not break event processing.
- **Tenant isolation**: a second tenant's rule/event does not act on the first tenant's data.

Stub `AgentRuntimeService` AND `AgentWorkerService` (no-op) in the test module to avoid waking the live dispatcher (mirror the pattern from `flow-control-tower.e2e-spec.ts` / phase11b).

- [ ] **Step 2: Run the suite**

```bash
pnpm db:up && pnpm db:seed
cd apps/api && npx jest --config test/jest-e2e.json --runInBand --testPathPattern="cross-module-automation"
```
Expected: green. Then run the full e2e suite once (`npx jest --config test/jest-e2e.json --runInBand`) and report counts + any pre-existing flake (phase13 cross-suite timing flake is known, not caused here).

- [ ] **Step 3: Browser check (best-effort)**

`pnpm dev`, login `admin@pulsar.dev/admin123`: open `/automation`, see the 2 built-in reaction rules; plan an order with a warehouse-origin shipment → confirm a pick appears in `/wms/picking`; create a RUN_ACTION rule via the editor. (If headless-only, note it; the e2e is the guarantee.)

- [ ] **Step 4: Update docs**

- `docs/etat-du-projet.md`: session line "Tressage automatique v1 (arc B)".
- `CLAUDE.md`: add a hard rule — e.g. "Les réactions déterministes (`RUN_ACTION`) ne s'exécutent que via `ReactionExecutorService` : whitelist `REACTION_CATALOG`, idempotentes (`ReactionExecution` unique (tenantId,eventId,ruleId)), anti-boucle single-hop (`DomainEvent.reactionRuleId` ⇒ pas de RUN_ACTION ré-évalué), best-effort, auditées service-account ; jamais d'effet externe (gouverné par les agents)." Keep concise; note the rule-number collision risk with the other unmerged branches.

- [ ] **Step 5: Commit**

```bash
git add apps/api/test/cross-module-automation.e2e-spec.ts docs/etat-du-projet.md CLAUDE.md
git commit -m "test(api): cross-module-automation e2e + docs"
```

---

## Self-review notes (résolu)

- **Spec coverage:** B1 events (Task 1 types + Task 3 emits) ; RUN_ACTION + catalogue (Task 1) ; migration ledger + tag (Task 2) ; executor/handlers/idempotency/anti-loop/audit/module-gating (Task 4) ; pipeline wiring + DTO/validation (Task 5) ; built-in rules seed (Task 6) ; configurable editor extension (Task 7) ; tests + docs (Task 8). Safety model (whitelist/idempotent/anti-loop/best-effort/audit/gating) covered across Tasks 1/2/4/5. ✔
- **Type consistency:** `RuleAction` union, `ReactionCommand`, `produceRuleReaction`, `REACTION_CATALOG`/`reactionByKey` defined in Task 1 and consumed unchanged in Tasks 4/5/7. `resolve` returns `{ taskSpecs, reactionCommands }` (Task 5) consumed in `processPending` (Task 5). `executeCommand(tenantId, eventId, command)` + `currentReactionRuleId()` (Task 4) consumed by `emit`/`processPending` (Task 5). ✔
- **Points à confirmer au fil de l'eau (signalés dans les steps):** `TenantModulesCacheService.isEnabled` exact name + module key strings ; `CreatePickOrderDto` shape + whether `PickingService.create` tolerates zero lines ; `CustomerInvoicesService.createDrafts` signature/idempotency ; service-account user resolution (rule 13) ; the module that provides `CustomRuleResolver` + DI cycle risk when importing WMS/Billing ; seed file entrypoint + admin user var ; whether the web imports `@pulsar/shared` directly for `REACTION_CATALOG`.
- **YAGNI:** 2 reactions only ; single-hop ; one action per rule ; no external-effect actions (backlog §8).
