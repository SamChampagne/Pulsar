# Control Tower de flux v1 (arc A) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rendre visible le système nerveux inter-modules existant via une page `/analytics/flow` à 3 vues (timeline causale, tracé de parcours d'entité, carte de flux) + 2 outils agent READ, le tout calculé à la lecture.

**Architecture:** Helpers purs dans `@pulsar/shared/analytics/flow.ts` reconstituent les chaînes de causalité à partir de données existantes (`DomainEvent.id` ← `OperationalTask.sourceEventId` ← `ProposedAction.triggeredByRef "task:<id>"`). Un `FlowService` (dans `AnalyticsModule`) fait les requêtes tenant-scopées read-time et appelle les helpers ; un `FlowController` expose 3 endpoints ; 2 outils agent READ réutilisent `FlowService` ; une page web à onglets consomme le tout en polling.

**Tech Stack:** NestJS + Prisma ; SvelteKit (Svelte 5 runes) ; `@pulsar/shared` (TS pur, vitest) ; zod (schémas d'outils agent) ; Jest e2e HTTP.

## Global Constraints

- **Lecture seule.** Aucune mutation. Les outils agent sont **tier READ** (exécution directe, pas de file `ProposedAction`).
- **Calculé à la lecture** (règle 30) : aucune table de rollup, aucun store. Les calculs vivent dans `@pulsar/shared` (purs, testés).
- **Règle 1 — tenant isolation** : toute requête filtre par `tenantId` du JWT (`@CurrentUser()`).
- **Règle 26** : aucune projection n'expose `secretHash`/`serviceUserId` d'un agent ; les `FlowAction` ne portent que `agentId` (jamais de secret).
- **Règle 21** : les outils agent passent par le registre `core/agents/tool-registry.ts` (un outil = {tier, permission, module, schéma zod, handler}), réutilisant un service via `AGENT_TOOL_SERVICES`.
- **Règle 7** : après modif de `packages/shared`, rebuild (`pnpm --filter @pulsar/shared build`) avant l'API.
- **`@pulsar/shared` browser-safe** : aucun import Node dans `flow.ts`.
- Endpoints gated `@RequireModule(MODULE_KEYS.ANALYTICS)` + `@RequirePermissions(PERMISSIONS.ANALYTICS.READ)`.
- Résultats **bornés** (limite dure, défaut 200) — aucun scan non borné.

---

## File Structure

**Créés :**
- `packages/shared/src/analytics/flow.ts` — types + helpers purs (`moduleOfEventType`, `moduleOfSubjectType`, `buildFlowChains`, `buildFlowMap`, `buildEntityTrace`).
- `packages/shared/src/analytics/flow.spec.ts` — tests unitaires.
- `apps/api/src/modules/analytics/flow.service.ts` — requêtes read-time + appel des helpers.
- `apps/api/src/modules/analytics/flow.controller.ts` — `GET /analytics/flow/{timeline,trace,map}`.
- `apps/api/test/flow-control-tower.e2e-spec.ts` — e2e.
- `apps/web/src/routes/(app)/analytics/flow/+page.svelte` — page 3 onglets.

**Modifiés :**
- `packages/shared/src/index.ts` — export de `analytics/flow`.
- `packages/database/prisma/schema.prisma` — index `DomainEvent[tenantId, subjectType, subjectId]`.
- `apps/api/src/modules/analytics/analytics.module.ts` — déclare `FlowService`/`FlowController`, exporte `FlowService`.
- `apps/api/src/core/agents/tool-registry.ts` — interface `ToolServices` += `flow`, + 2 `ToolDef` READ.
- `apps/api/src/core/agents/agents.module.ts` — adapter `AGENT_TOOL_SERVICES` câble `FlowService` ; import d'`AnalyticsModule`.
- `apps/web/src/lib/modules/navigation.ts` — entrée nav `/analytics/flow`.
- `apps/web/src/routes/(app)/analytics/+page.svelte` — lien vers `/analytics/flow`.
- `docs/etat-du-projet.md`, `CLAUDE.md` (si invariant le mérite).

---

## Task 1: `@pulsar/shared/analytics/flow.ts` — types + helpers purs

**Files:**
- Create: `packages/shared/src/analytics/flow.ts`
- Create: `packages/shared/src/analytics/flow.spec.ts`
- Modify: `packages/shared/src/index.ts`

**Interfaces:**
- Produces (exact, consumed by Tasks 3/4/5):
  - `type FlowModule = 'TRANSPORTATION' | 'WMS' | 'YARD' | 'FLEET' | 'BILLING' | 'CUSTOMER_PORTAL' | 'CORE'`
  - `interface FlowEvent { id: string; type: string; module: FlowModule; subjectType: string | null; subjectId: string | null; at: string }`
  - `interface FlowTask { id: string; category: string; status: string; severity: string; subjectType: string | null; subjectId: string | null; sourceEventId: string | null; assigneeAgentId: string | null; at: string }`
  - `interface FlowAction { id: string; tool: string; status: string; agentId: string; triggeredByRef: string | null; autoApproved: boolean; at: string }`
  - `interface FlowChain { event: FlowEvent | null; tasks: FlowTask[]; actions: FlowAction[]; modules: FlowModule[]; crossModule: boolean; startedAt: string; lastAt: string }`
  - `interface FlowMapNode { module: FlowModule; eventCount: number }`
  - `interface FlowMapEdge { from: FlowModule; to: FlowModule; count: number }`
  - `interface FlowMap { nodes: FlowMapNode[]; edges: FlowMapEdge[] }`
  - `type EntityStageStatus = 'PENDING' | 'ACTIVE' | 'DONE' | 'BLOCKED'`
  - `interface EntityTraceStage { stage: string; module: FlowModule; status: EntityStageStatus; at: string | null; refs: string[] }`
  - `interface EntityTrace { rootType: string; rootId: string; stages: EntityTraceStage[] }`
  - `function moduleOfEventType(type: string): FlowModule`
  - `function moduleOfSubjectType(subjectType: string | null): FlowModule`
  - `function buildFlowChains(events: FlowEvent[], tasks: FlowTask[], actions: FlowAction[]): FlowChain[]`
  - `function buildFlowMap(chains: FlowChain[]): FlowMap`
  - `function buildEntityTrace(input: EntityTraceInput): EntityTrace` where
    `interface EntityTraceInput { rootType: 'TRANSPORT_ORDER' | 'SHIPMENT' | 'LOAD'; rootId: string; createdAt: string | null; pickedAt: string | null; pickBlocked: boolean; dispatchedAt: string | null; yardAt: string | null; deliveredAt: string | null; billedAt: string | null; refs: { shipments: string[]; loads: string[]; pickOrders: string[]; yardVisits: string[]; invoices: string[] } }`

- [ ] **Step 1: Write the failing tests**

`packages/shared/src/analytics/flow.spec.ts` (vitest — match the import style of existing specs):

```ts
import { describe, it, expect } from 'vitest';
import {
  moduleOfEventType,
  moduleOfSubjectType,
  buildFlowChains,
  buildFlowMap,
  buildEntityTrace,
  type FlowEvent,
  type FlowTask,
  type FlowAction,
} from './flow';

describe('moduleOfEventType', () => {
  it('maps prefixes to modules', () => {
    expect(moduleOfEventType('wms.pick.completed')).toBe('WMS');
    expect(moduleOfEventType('yard.visit.detention')).toBe('YARD');
    expect(moduleOfEventType('fleet.asset.maintenance')).toBe('FLEET');
    expect(moduleOfEventType('tender.declined')).toBe('TRANSPORTATION');
    expect(moduleOfEventType('stop.delayed')).toBe('TRANSPORTATION');
    expect(moduleOfEventType('driver.exception')).toBe('TRANSPORTATION');
    expect(moduleOfEventType('carrier-invoice.received')).toBe('BILLING');
    expect(moduleOfEventType('portal.change-request')).toBe('CUSTOMER_PORTAL');
    expect(moduleOfEventType('something.unknown')).toBe('CORE');
  });
});

describe('moduleOfSubjectType', () => {
  it('maps subject types to modules', () => {
    expect(moduleOfSubjectType('load')).toBe('TRANSPORTATION');
    expect(moduleOfSubjectType('shipment')).toBe('TRANSPORTATION');
    expect(moduleOfSubjectType('stop')).toBe('TRANSPORTATION');
    expect(moduleOfSubjectType('yard-visit')).toBe('YARD');
    expect(moduleOfSubjectType('dock-appointment')).toBe('YARD');
    expect(moduleOfSubjectType('vehicle')).toBe('FLEET');
    expect(moduleOfSubjectType('trailer')).toBe('FLEET');
    expect(moduleOfSubjectType('invoice')).toBe('BILLING');
    expect(moduleOfSubjectType(null)).toBe('CORE');
    expect(moduleOfSubjectType('nope')).toBe('CORE');
  });
});

describe('buildFlowChains', () => {
  const ev: FlowEvent = { id: 'e1', type: 'wms.pick.completed', module: 'WMS', subjectType: 'shipment', subjectId: 's1', at: '2026-06-21T10:00:00.000Z' };
  const task: FlowTask = { id: 't1', category: 'FULFILLMENT_READY', status: 'RESOLVED', severity: 'INFO', subjectType: 'shipment', subjectId: 's1', sourceEventId: 'e1', assigneeAgentId: 'a1', at: '2026-06-21T10:01:00.000Z' };
  const action: FlowAction = { id: 'p1', tool: 'assign_shipment', status: 'EXECUTED', agentId: 'a1', triggeredByRef: 'task:t1', autoApproved: true, at: '2026-06-21T10:02:00.000Z' };

  it('links event -> task -> action into one chain', () => {
    const chains = buildFlowChains([ev], [task], [action]);
    expect(chains).toHaveLength(1);
    const c = chains[0];
    expect(c.event?.id).toBe('e1');
    expect(c.tasks.map((t) => t.id)).toEqual(['t1']);
    expect(c.actions.map((a) => a.id)).toEqual(['p1']);
    expect(c.modules).toContain('WMS');
    expect(c.modules).toContain('TRANSPORTATION'); // task subject = shipment
    expect(c.crossModule).toBe(true);
    expect(c.startedAt).toBe('2026-06-21T10:00:00.000Z');
    expect(c.lastAt).toBe('2026-06-21T10:02:00.000Z');
  });

  it('emits an event-only chain when no task references it', () => {
    const chains = buildFlowChains([ev], [], []);
    expect(chains).toHaveLength(1);
    expect(chains[0].tasks).toEqual([]);
    expect(chains[0].crossModule).toBe(false);
  });

  it('emits an orphan-task chain (event null) when sourceEventId has no matching event', () => {
    const orphan: FlowTask = { ...task, id: 't2', sourceEventId: 'missing' };
    const chains = buildFlowChains([], [orphan], []);
    expect(chains).toHaveLength(1);
    expect(chains[0].event).toBeNull();
    expect(chains[0].tasks.map((t) => t.id)).toEqual(['t2']);
  });
});

describe('buildFlowMap', () => {
  it('counts module event nodes and cross-module edges from chains', () => {
    const chains = buildFlowChains(
      [{ id: 'e1', type: 'wms.pick.completed', module: 'WMS', subjectType: 'shipment', subjectId: 's1', at: '2026-06-21T10:00:00.000Z' }],
      [{ id: 't1', category: 'FULFILLMENT_READY', status: 'OPEN', severity: 'INFO', subjectType: 'shipment', subjectId: 's1', sourceEventId: 'e1', assigneeAgentId: null, at: '2026-06-21T10:01:00.000Z' }],
      [],
    );
    const map = buildFlowMap(chains);
    expect(map.nodes.find((n) => n.module === 'WMS')?.eventCount).toBe(1);
    expect(map.edges).toContainEqual({ from: 'WMS', to: 'TRANSPORTATION', count: 1 });
  });
});

describe('buildEntityTrace', () => {
  it('derives stage statuses with a blocked pick', () => {
    const trace = buildEntityTrace({
      rootType: 'TRANSPORT_ORDER', rootId: 'o1',
      createdAt: '2026-06-21T09:00:00.000Z', pickedAt: null, pickBlocked: true,
      dispatchedAt: null, yardAt: null, deliveredAt: null, billedAt: null,
      refs: { shipments: ['s1'], loads: [], pickOrders: ['pk1'], yardVisits: [], invoices: [] },
    });
    const byStage = Object.fromEntries(trace.stages.map((s) => [s.stage, s.status]));
    expect(byStage['Créée']).toBe('DONE');
    expect(byStage['Préparée']).toBe('BLOCKED');
    expect(byStage['Dispatchée']).toBe('PENDING');
    expect(trace.rootId).toBe('o1');
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @pulsar/shared test`
Expected: FAIL (module `./flow` does not exist).

- [ ] **Step 3: Implement `flow.ts`**

```ts
// Pure, browser-safe. No Node imports.

export type FlowModule =
  | 'TRANSPORTATION' | 'WMS' | 'YARD' | 'FLEET' | 'BILLING' | 'CUSTOMER_PORTAL' | 'CORE';

export interface FlowEvent { id: string; type: string; module: FlowModule; subjectType: string | null; subjectId: string | null; at: string; }
export interface FlowTask { id: string; category: string; status: string; severity: string; subjectType: string | null; subjectId: string | null; sourceEventId: string | null; assigneeAgentId: string | null; at: string; }
export interface FlowAction { id: string; tool: string; status: string; agentId: string; triggeredByRef: string | null; autoApproved: boolean; at: string; }

export interface FlowChain {
  event: FlowEvent | null;
  tasks: FlowTask[];
  actions: FlowAction[];
  modules: FlowModule[];
  crossModule: boolean;
  startedAt: string;
  lastAt: string;
}

export interface FlowMapNode { module: FlowModule; eventCount: number; }
export interface FlowMapEdge { from: FlowModule; to: FlowModule; count: number; }
export interface FlowMap { nodes: FlowMapNode[]; edges: FlowMapEdge[]; }

export type EntityStageStatus = 'PENDING' | 'ACTIVE' | 'DONE' | 'BLOCKED';
export interface EntityTraceStage { stage: string; module: FlowModule; status: EntityStageStatus; at: string | null; refs: string[]; }
export interface EntityTrace { rootType: string; rootId: string; stages: EntityTraceStage[]; }

export interface EntityTraceInput {
  rootType: 'TRANSPORT_ORDER' | 'SHIPMENT' | 'LOAD';
  rootId: string;
  createdAt: string | null;
  pickedAt: string | null;
  pickBlocked: boolean;
  dispatchedAt: string | null;
  yardAt: string | null;
  deliveredAt: string | null;
  billedAt: string | null;
  refs: { shipments: string[]; loads: string[]; pickOrders: string[]; yardVisits: string[]; invoices: string[]; };
}

const EVENT_PREFIX_MODULE: Record<string, FlowModule> = {
  wms: 'WMS', yard: 'YARD', fleet: 'FLEET',
  tender: 'TRANSPORTATION', stop: 'TRANSPORTATION', driver: 'TRANSPORTATION',
  'carrier-invoice': 'BILLING', portal: 'CUSTOMER_PORTAL',
};

export function moduleOfEventType(type: string): FlowModule {
  const prefix = type.split('.')[0];
  return EVENT_PREFIX_MODULE[prefix] ?? 'CORE';
}

const SUBJECT_MODULE: Record<string, FlowModule> = {
  load: 'TRANSPORTATION', shipment: 'TRANSPORTATION', stop: 'TRANSPORTATION', 'transport-order': 'TRANSPORTATION',
  'yard-visit': 'YARD', 'dock-appointment': 'YARD',
  vehicle: 'FLEET', trailer: 'FLEET',
  'pick-order': 'WMS', 'wms-item': 'WMS', bin: 'WMS', 'cycle-count': 'WMS',
  invoice: 'BILLING', 'carrier-invoice': 'BILLING',
};

export function moduleOfSubjectType(subjectType: string | null): FlowModule {
  if (!subjectType) return 'CORE';
  return SUBJECT_MODULE[subjectType] ?? 'CORE';
}

function uniq<T>(xs: T[]): T[] { return [...new Set(xs)]; }
function minIso(xs: string[]): string { return xs.reduce((a, b) => (a < b ? a : b)); }
function maxIso(xs: string[]): string { return xs.reduce((a, b) => (a > b ? a : b)); }

export function buildFlowChains(events: FlowEvent[], tasks: FlowTask[], actions: FlowAction[]): FlowChain[] {
  const actionsByTask = new Map<string, FlowAction[]>();
  for (const a of actions) {
    const ref = a.triggeredByRef && a.triggeredByRef.startsWith('task:') ? a.triggeredByRef.slice('task:'.length) : null;
    if (!ref) continue;
    const list = actionsByTask.get(ref) ?? [];
    list.push(a);
    actionsByTask.set(ref, list);
  }

  const tasksByEvent = new Map<string, FlowTask[]>();
  const orphanTasks: FlowTask[] = [];
  const eventIds = new Set(events.map((e) => e.id));
  for (const t of tasks) {
    if (t.sourceEventId && eventIds.has(t.sourceEventId)) {
      const list = tasksByEvent.get(t.sourceEventId) ?? [];
      list.push(t);
      tasksByEvent.set(t.sourceEventId, list);
    } else {
      orphanTasks.push(t);
    }
  }

  const chainFrom = (event: FlowEvent | null, chainTasks: FlowTask[]): FlowChain => {
    const chainActions = chainTasks.flatMap((t) => actionsByTask.get(t.id) ?? []);
    const modules = uniq<FlowModule>([
      ...(event ? [event.module] : []),
      ...chainTasks.map((t) => moduleOfSubjectType(t.subjectType)),
    ]);
    const times = [
      ...(event ? [event.at] : []),
      ...chainTasks.map((t) => t.at),
      ...chainActions.map((a) => a.at),
    ];
    return {
      event,
      tasks: chainTasks,
      actions: chainActions,
      modules,
      crossModule: modules.length > 1,
      startedAt: times.length ? minIso(times) : (event?.at ?? ''),
      lastAt: times.length ? maxIso(times) : (event?.at ?? ''),
    };
  };

  const chains: FlowChain[] = [];
  for (const e of events) chains.push(chainFrom(e, tasksByEvent.get(e.id) ?? []));
  for (const t of orphanTasks) chains.push(chainFrom(null, [t]));
  return chains.sort((a, b) => (a.lastAt < b.lastAt ? 1 : a.lastAt > b.lastAt ? -1 : 0));
}

export function buildFlowMap(chains: FlowChain[]): FlowMap {
  const nodeCounts = new Map<FlowModule, number>();
  const edgeCounts = new Map<string, FlowMapEdge>();
  for (const c of chains) {
    if (c.event) nodeCounts.set(c.event.module, (nodeCounts.get(c.event.module) ?? 0) + 1);
    const from = c.event?.module ?? 'CORE';
    for (const t of c.tasks) {
      const to = moduleOfSubjectType(t.subjectType);
      if (to === from) continue; // self/intra → not an edge
      const key = `${from}->${to}`;
      const e = edgeCounts.get(key) ?? { from, to, count: 0 };
      e.count += 1;
      edgeCounts.set(key, e);
    }
  }
  return {
    nodes: [...nodeCounts.entries()].map(([module, eventCount]) => ({ module, eventCount })),
    edges: [...edgeCounts.values()],
  };
}

export function buildEntityTrace(input: EntityTraceInput): EntityTrace {
  const stage = (
    name: string, module: FlowModule, at: string | null, blocked: boolean, refs: string[],
  ): EntityTraceStage => ({
    stage: name, module, status: blocked ? 'BLOCKED' : at ? 'DONE' : 'PENDING', at, refs,
  });
  const stages: EntityTraceStage[] = [
    stage('Créée', 'TRANSPORTATION', input.createdAt, false, [input.rootId]),
    stage('Préparée', 'WMS', input.pickedAt, input.pickBlocked, input.refs.pickOrders),
    stage('Dispatchée', 'TRANSPORTATION', input.dispatchedAt, false, input.refs.loads),
    stage('Cour', 'YARD', input.yardAt, false, input.refs.yardVisits),
    stage('Livrée', 'TRANSPORTATION', input.deliveredAt, false, input.refs.shipments),
    stage('Facturée', 'BILLING', input.billedAt, false, input.refs.invoices),
  ];
  return { rootType: input.rootType, rootId: input.rootId, stages };
}
```

- [ ] **Step 4: Export from the barrel**

Dans `packages/shared/src/index.ts`, après la ligne `export * from './analytics/control-tower';` (ou à côté des exports analytics) :

```ts
export * from './analytics/flow';
```

- [ ] **Step 5: Run to verify pass**

Run: `pnpm --filter @pulsar/shared test`
Expected: PASS.

- [ ] **Step 6: Rebuild + commit**

```bash
pnpm --filter @pulsar/shared build
git add packages/shared/src/analytics/flow.ts packages/shared/src/analytics/flow.spec.ts packages/shared/src/index.ts
git commit -m "feat(shared): flow causality/map/trace pure helpers"
```

---

## Task 2: Migration — index `DomainEvent[tenantId, subjectType, subjectId]`

**Files:**
- Modify: `packages/database/prisma/schema.prisma`

**Interfaces:**
- Produces: a composite index enabling the entity-trace query `DomainEvent.findMany({ where: { tenantId, subjectType, subjectId } })`.

- [ ] **Step 1: Add the index**

Dans le modèle `DomainEvent` de `schema.prisma`, à côté des `@@index` existants (`[status, createdAt]`, `[tenantId, type, createdAt]`), ajouter :

```prisma
  @@index([tenantId, subjectType, subjectId])
```

- [ ] **Step 2: Generate + apply (non-interactive)**

Run (DB up + seeded; non-interactive name):
```bash
pnpm db:up
pnpm --filter @pulsar/database exec prisma migrate dev --name flow_event_subject_index
```
Expected: migration créée + appliquée, client régénéré. (Si crash `URL must start with prisma://` ensuite : `pnpm db:generate`.)

- [ ] **Step 3: Build database package**

```bash
pnpm --filter @pulsar/database build
```

- [ ] **Step 4: Commit**

```bash
git add packages/database/prisma/schema.prisma packages/database/prisma/migrations
git commit -m "feat(db): index DomainEvent by (tenantId, subjectType, subjectId) for entity trace"
```

---

## Task 3: API — `FlowService` + `FlowController` (3 endpoints)

**Files:**
- Create: `apps/api/src/modules/analytics/flow.service.ts`
- Create: `apps/api/src/modules/analytics/flow.controller.ts`
- Modify: `apps/api/src/modules/analytics/analytics.module.ts`

**Interfaces:**
- Consumes: `buildFlowChains`, `buildFlowMap`, `buildEntityTrace`, `moduleOfEventType`, `FlowEvent`/`FlowTask`/`FlowAction` (Task 1) ; `PrismaService` (global). DomainEvent/OperationalTask/ProposedAction Prisma models.
- Produces:
  - `FlowService.timeline(tenantId, opts: { days: number; modules?: string[]; types?: string[]; crossOnly?: boolean; limit: number }): Promise<{ chains: FlowChain[] }>`
  - `FlowService.map(tenantId, days: number): Promise<FlowMap>`
  - `FlowService.trace(tenantId, entityType: 'TRANSPORT_ORDER'|'SHIPMENT'|'LOAD', entityId: string): Promise<EntityTrace>`
  - `GET /analytics/flow/timeline`, `/analytics/flow/map`, `/analytics/flow/trace`.

- [ ] **Step 1: Implement `FlowService`**

Note: this service is verified by the Task 6 e2e (no dedicated unit test — the pure logic is unit-tested in Task 1). Map Prisma rows → the `FlowEvent`/`FlowTask`/`FlowAction` shapes, then call the pure helpers.

```ts
import { Injectable, NotFoundException } from '@nestjs/common';
import {
  buildFlowChains, buildFlowMap, buildEntityTrace, moduleOfEventType,
  type FlowEvent, type FlowTask, type FlowAction, type FlowMap, type EntityTrace,
} from '@pulsar/shared';
import { PrismaService } from '../../prisma/prisma.service';

interface TimelineOpts { days: number; modules?: string[]; types?: string[]; crossOnly?: boolean; limit: number; }

@Injectable()
export class FlowService {
  constructor(private readonly prisma: PrismaService) {}

  private since(days: number): Date { return new Date(Date.now() - days * 86_400_000); }

  async timeline(tenantId: string, opts: TimelineOpts): Promise<{ chains: ReturnType<typeof buildFlowChains> }> {
    const since = this.since(opts.days);
    const [events, tasks, actions] = await Promise.all([
      this.prisma.domainEvent.findMany({
        where: { tenantId, createdAt: { gte: since }, ...(opts.types?.length ? { type: { in: opts.types } } : {}) },
        orderBy: { createdAt: 'desc' }, take: opts.limit,
        select: { id: true, type: true, subjectType: true, subjectId: true, createdAt: true },
      }),
      this.prisma.operationalTask.findMany({
        where: { tenantId, createdAt: { gte: since } }, orderBy: { createdAt: 'desc' }, take: opts.limit,
        select: { id: true, category: true, status: true, severity: true, subjectType: true, subjectId: true, sourceEventId: true, assigneeAgentId: true, createdAt: true },
      }),
      this.prisma.proposedAction.findMany({
        where: { tenantId, proposedAt: { gte: since } }, orderBy: { proposedAt: 'desc' }, take: opts.limit,
        select: { id: true, tool: true, status: true, agentId: true, triggeredByRef: true, autoApproved: true, proposedAt: true },
      }),
    ]);

    const fEvents: FlowEvent[] = events.map((e) => ({
      id: e.id, type: e.type, module: moduleOfEventType(e.type),
      subjectType: e.subjectType, subjectId: e.subjectId, at: e.createdAt.toISOString(),
    }));
    const fTasks: FlowTask[] = tasks.map((t) => ({
      id: t.id, category: t.category, status: t.status, severity: String(t.severity),
      subjectType: t.subjectType, subjectId: t.subjectId, sourceEventId: t.sourceEventId,
      assigneeAgentId: t.assigneeAgentId, at: t.createdAt.toISOString(),
    }));
    const fActions: FlowAction[] = actions.map((a) => ({
      id: a.id, tool: a.tool, status: a.status, agentId: a.agentId,
      triggeredByRef: a.triggeredByRef, autoApproved: a.autoApproved, at: a.proposedAt.toISOString(),
    }));

    let chains = buildFlowChains(fEvents, fTasks, fActions);
    if (opts.crossOnly) chains = chains.filter((c) => c.crossModule);
    if (opts.modules?.length) chains = chains.filter((c) => c.modules.some((m) => opts.modules!.includes(m)));
    return { chains: chains.slice(0, opts.limit) };
  }

  async map(tenantId: string, days: number): Promise<FlowMap> {
    const { chains } = await this.timeline(tenantId, { days, limit: 2000 });
    return buildFlowMap(chains);
  }

  async trace(tenantId: string, entityType: 'TRANSPORT_ORDER' | 'SHIPMENT' | 'LOAD', entityId: string): Promise<EntityTrace> {
    // Resolve the root order id from whatever entity was given.
    let orderId = entityId;
    if (entityType === 'SHIPMENT') {
      const s = await this.prisma.shipment.findFirst({ where: { id: entityId, tenantId }, select: { transportOrderId: true } });
      if (!s) throw new NotFoundException('Shipment not found');
      orderId = s.transportOrderId;
    } else if (entityType === 'LOAD') {
      const leg = await this.prisma.shipment.findFirst({ where: { loadId: entityId, tenantId }, select: { transportOrderId: true } });
      if (!leg) throw new NotFoundException('Load has no shipments');
      orderId = leg.transportOrderId;
    }
    const order = await this.prisma.transportOrder.findFirst({
      where: { id: orderId, tenantId },
      select: {
        id: true, createdAt: true,
        shipments: {
          select: {
            id: true, loadId: true, status: true, actualDeliveryAt: true,
            pickOrders: { select: { id: true, status: true } },
          },
        },
      },
    });
    if (!order) throw new NotFoundException('Order not found');

    const shipments = order.shipments;
    const loadIds = [...new Set(shipments.map((s) => s.loadId).filter((x): x is string => !!x))];
    const pickOrders = shipments.flatMap((s) => s.pickOrders);
    const yardVisits = loadIds.length
      ? await this.prisma.yardVisit.findMany({ where: { tenantId, /* soft link via trailer/appointment if present */ }, select: { id: true, checkInAt: true }, take: 50 })
          .then((vs) => vs) // best-effort; refine if a direct FK exists
      : [];
    const invoices = await this.prisma.incomingCarrierInvoice.findMany({
      where: { tenantId, loadId: { in: loadIds.length ? loadIds : ['__none__'] } },
      select: { id: true, createdAt: true },
    });

    // Derive stage timestamps (best-effort, read-only).
    const dispatchedAt = shipments.some((s) => ['DISPATCHED', 'IN_TRANSIT', 'DELIVERED', 'CLOSED'].includes(s.status))
      ? order.createdAt.toISOString() : null; // refined: use load.dispatchedAt if available
    const deliveredAt = shipments.length && shipments.every((s) => ['DELIVERED', 'CLOSED'].includes(s.status))
      ? (shipments.map((s) => s.actualDeliveryAt).filter(Boolean).sort().pop() as Date | undefined)?.toISOString() ?? null : null;
    const pickStatuses = pickOrders.map((p) => p.status);
    const pickedAt = pickStatuses.length && pickStatuses.every((s) => ['COMPLETED'].includes(s)) ? order.createdAt.toISOString() : null;
    const pickBlocked = false;

    return buildEntityTrace({
      rootType: entityType, rootId: order.id,
      createdAt: order.createdAt.toISOString(),
      pickedAt, pickBlocked,
      dispatchedAt,
      yardAt: yardVisits.length ? (yardVisits[0] as { checkInAt?: Date }).checkInAt?.toISOString() ?? null : null,
      deliveredAt,
      billedAt: invoices.length ? invoices[0].createdAt.toISOString() : null,
      refs: {
        shipments: shipments.map((s) => s.id),
        loads: loadIds,
        pickOrders: pickOrders.map((p) => p.id),
        yardVisits: yardVisits.map((v) => (v as { id: string }).id),
        invoices: invoices.map((i) => i.id),
      },
    });
  }
}
```

> IMPLEMENTER NOTE: confirm the exact Prisma field/relation names before finalizing `trace()` — read the `Shipment`, `Load`, `PickOrder`, `IncomingCarrierInvoice`, `YardVisit` models in `schema.prisma`. The Yard link is soft (no guaranteed FK from a load to a yard visit) — if there is no clean correlation, leave `yardAt: null` and `yardVisits: []` for v1 and note it (the stage simply shows PENDING). Prefer using `Load.dispatchedAt`/`Load.completedAt` for the dispatched/delivered timestamps if present (read the Load model). Keep it read-only and tenant-scoped (every `where` carries `tenantId`). The `severity` enum stringifies via `String(...)`.

- [ ] **Step 2: Implement `FlowController`**

```ts
import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '@pulsar/shared';
import { MODULE_KEYS, PERMISSIONS } from '@pulsar/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequireModule } from '../../common/decorators/require-module.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { FlowService } from './flow.service';

const DEFAULT_DAYS = 7;
const VALID_DAYS = [1, 7, 30];
const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 500;

@ApiTags('analytics')
@ApiBearerAuth()
@RequireModule(MODULE_KEYS.ANALYTICS)
@Controller('analytics/flow')
export class FlowController {
  constructor(private readonly flow: FlowService) {}

  private days(raw?: string): number {
    const n = raw ? Number(raw) : DEFAULT_DAYS;
    return VALID_DAYS.includes(n) ? n : DEFAULT_DAYS;
  }

  @Get('timeline')
  @RequirePermissions(PERMISSIONS.ANALYTICS.READ)
  timeline(
    @CurrentUser() user: AuthUser,
    @Query('days') days?: string,
    @Query('modules') modules?: string,
    @Query('types') types?: string,
    @Query('crossOnly') crossOnly?: string,
    @Query('limit') limit?: string,
  ) {
    const lim = Math.min(Math.max(limit ? Number(limit) : DEFAULT_LIMIT, 1), MAX_LIMIT);
    return this.flow.timeline(user.tenantId, {
      days: this.days(days),
      modules: modules ? modules.split(',').filter(Boolean) : undefined,
      types: types ? types.split(',').filter(Boolean) : undefined,
      crossOnly: crossOnly === 'true',
      limit: lim,
    });
  }

  @Get('map')
  @RequirePermissions(PERMISSIONS.ANALYTICS.READ)
  map(@CurrentUser() user: AuthUser, @Query('days') days?: string) {
    return this.flow.map(user.tenantId, this.days(days));
  }

  @Get('trace')
  @RequirePermissions(PERMISSIONS.ANALYTICS.READ)
  trace(
    @CurrentUser() user: AuthUser,
    @Query('entityType') entityType: 'TRANSPORT_ORDER' | 'SHIPMENT' | 'LOAD',
    @Query('entityId') entityId: string,
  ) {
    return this.flow.trace(user.tenantId, entityType, entityId);
  }
}
```

- [ ] **Step 3: Register in `AnalyticsModule`**

Modifier `analytics.module.ts` : ajouter `FlowController` aux `controllers`, `FlowService` aux `providers`, et **exporter** `FlowService` (consommé par les outils agent, Task 4) :

```ts
@Module({
  controllers: [ControlTowerController, ScorecardsController, FlowController],
  providers: [ControlTowerService, ScorecardsService, FlowService],
  exports: [FlowService],
})
export class AnalyticsModule {}
```

- [ ] **Step 4: Typecheck**

Run: `pnpm typecheck`
Expected: pas de NOUVELLE erreur (les pré-existantes fleet/wms/yard spec TS2554 ne comptent pas).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/analytics
git commit -m "feat(api): flow service + controller (timeline/map/trace, read-time)"
```

---

## Task 4: Agent tools — `get_flow_timeline` + `trace_entity` (READ)

**Files:**
- Modify: `apps/api/src/core/agents/tool-registry.ts`
- Modify: `apps/api/src/core/agents/agents.module.ts`

**Interfaces:**
- Consumes: `FlowService` (Task 3, exported from `AnalyticsModule`).
- Produces: 2 READ `ToolDef` ; `ToolServices.flow` member.

- [ ] **Step 1: Extend `ToolServices` and add the tools**

Dans `tool-registry.ts`, ajouter à l'interface `ToolServices` :

```ts
  flow: {
    timeline(tenantId: string, opts: { days?: number; modules?: string[]; crossOnly?: boolean; limit?: number }): Promise<unknown>;
    trace(tenantId: string, entityType: 'TRANSPORT_ORDER' | 'SHIPMENT' | 'LOAD', entityId: string): Promise<unknown>;
  };
```

Ajouter au `TOOL_REGISTRY` (le helper `A = PERMISSIONS.ANALYTICS` peut être ajouté à côté de `const T = PERMISSIONS.TRANSPORTATION`) :

```ts
  {
    name: 'get_flow_timeline',
    description: 'Read the cross-module activity timeline with causality chains (event → task → agent action). Read-only.',
    tier: RiskTier.READ,
    permission: PERMISSIONS.ANALYTICS.READ,
    module: MODULE_KEYS.ANALYTICS,
    inputSchema: z.object({
      days: z.number().int().positive().optional(),
      modules: z.array(z.string()).optional(),
      crossOnly: z.boolean().optional(),
      limit: z.number().int().positive().optional(),
    }),
    run: (args, ctx) => ctx.services.flow.timeline(ctx.principal.user.tenantId, args),
  },
  {
    name: 'trace_entity',
    description: 'Trace a transport order / shipment / load across modules (created → picked → dispatched → yard → delivered → billed). Read-only.',
    tier: RiskTier.READ,
    permission: PERMISSIONS.ANALYTICS.READ,
    module: MODULE_KEYS.ANALYTICS,
    inputSchema: z.object({
      entityType: z.enum(['TRANSPORT_ORDER', 'SHIPMENT', 'LOAD']),
      entityId: z.string().min(1),
    }),
    run: (args, ctx) =>
      ctx.services.flow.trace(
        ctx.principal.user.tenantId,
        args.entityType as 'TRANSPORT_ORDER' | 'SHIPMENT' | 'LOAD',
        args.entityId as string,
      ),
  },
```

- [ ] **Step 2: Wire the adapter in `agents.module.ts`**

Lire `agents.module.ts` pour voir comment `AGENT_TOOL_SERVICES` est construit (la factory qui implémente `ToolServices`). Ajouter le membre `flow` câblé sur `FlowService` :

```ts
  flow: {
    timeline: (tenantId, opts) => flowService.timeline(tenantId, { days: opts.days ?? 7, limit: opts.limit ?? 200, modules: opts.modules, crossOnly: opts.crossOnly }),
    trace: (tenantId, entityType, entityId) => flowService.trace(tenantId, entityType, entityId),
  },
```

S'assurer qu'`AgentsModule` **importe `AnalyticsModule`** (qui exporte `FlowService`) et que `FlowService` est injecté dans la factory comme les autres services (suivre exactement le pattern des services déjà câblés, ex. l'analytics carrierScorecards / operatingTasks).

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: pas de NOUVELLE erreur. (L'adapter doit satisfaire la nouvelle forme `ToolServices.flow`.)

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/core/agents
git commit -m "feat(agents): READ tools get_flow_timeline + trace_entity"
```

---

## Task 5: Web — page `/analytics/flow` (3 onglets) + nav

**Files:**
- Create: `apps/web/src/routes/(app)/analytics/flow/+page.svelte`
- Modify: `apps/web/src/lib/modules/navigation.ts`
- Modify: `apps/web/src/routes/(app)/analytics/+page.svelte`

**Interfaces:**
- Consumes: `GET /analytics/flow/{timeline,map,trace}` (Task 3).

- [ ] **Step 1: Build the page with 3 tabs**

Créer `+page.svelte` (Svelte 5 runes, `api` client, composants `$lib/components/ui`). Trois onglets via un `let tab = $state<'timeline'|'trace'|'map'>('timeline')` :
- **Timeline** : `$state` + `load()` déclenché par `$effect` appelant `api('/analytics/flow/timeline', { query: { days, crossOnly } })` ; rendu d'une liste de `chains` (chaque chaîne : event → tasks → actions, dépliable). Filtres days (1/7/30) + toggle crossOnly. Polling ~30 s onglet visible (réutiliser le pattern de `OpsMap`/dashboard : `setInterval` + `document.visibilityState`, nettoyé en `onDestroy`/`$effect` cleanup).
- **Tracé** : un champ de recherche (entityType select + entityId) → `api('/analytics/flow/trace', { query: { entityType, entityId } })` → rendu vertical des `stages` (badge de statut PENDING/ACTIVE/DONE/BLOCKED, horodatage, refs).
- **Carte** : `api('/analytics/flow/map', { query: { days } })` → rendu des `nodes` (modules + eventCount) et `edges` (from→to count). v1 : un rendu simple (liste/tableau d'arêtes + pastilles de nœuds) ; pas de lib graphe (zéro dépendance). Un layout visuel plus riche pourra venir en v1.1.

Suivre le pattern de page existant (erreurs dans une string locale, `Skeleton` au chargement, `Badge`/`Card`/`Field`/`Select`). Réutiliser les helpers de format/sévérité existants.

- [ ] **Step 2: Add nav entry**

Dans `navigation.ts`, domaine `analytics`, ajouter un lien `{ href: '/analytics/flow', label: 'Flux', perm: PERMISSIONS.ANALYTICS.READ }` (suivre la forme des liens existants du domaine analytics).

- [ ] **Step 3: Link from the analytics overview**

Dans `analytics/+page.svelte`, ajouter une carte/lien « Flux » vers `/analytics/flow` (à côté des cartes Control Tower / Scorecards existantes).

- [ ] **Step 4: Build web**

Run: `pnpm --filter @pulsar/web build`
Expected: build OK (pas de nouvelle erreur de type Svelte).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src
git commit -m "feat(web): /analytics/flow page (timeline/trace/map) + nav"
```

---

## Task 6: e2e `flow-control-tower` + docs

**Files:**
- Create: `apps/api/test/flow-control-tower.e2e-spec.ts`
- Modify: `docs/etat-du-projet.md`, `CLAUDE.md` (si invariant le mérite)

**Interfaces:**
- Consumes: tout ce qui précède, via HTTP. Réutiliser le harnais d'un e2e existant (bootstrap app, login admin, master data à codes uniques) — référence : `apps/api/test/dispatch-workbench.e2e-spec.ts` et un e2e qui émet un DomainEvent (ex. tender decline → `apps/api/test/...` ; ou émettre directement via un parcours).

- [ ] **Step 1: Write the e2e**

Cas :
- **Timeline + causalité** : provoquer un événement réel qui crée une tâche (le plus simple : un parcours `tender.declined` — créer order→plan→load→tender→decline ; OU insérer un `DomainEvent` + faire tourner `processPending`). Puis `GET /analytics/flow/timeline?days=7` → la réponse contient une chaîne dont `event.type` correspond et `tasks` non vide (chaîne event→task reconstituée).
- **Trace** : `GET /analytics/flow/trace?entityType=TRANSPORT_ORDER&entityId=<order>` → renvoie `stages` avec `Créée=DONE` et les étapes suivantes cohérentes avec l'état réel.
- **Map** : `GET /analytics/flow/map?days=7` → `nodes`/`edges` (au moins un nœud pour le module de l'événement émis).
- **Isolation tenant** : un second tenant (créé via Prisma, comme dans l'e2e tms-configurable) ne voit pas le flux du premier (`timeline` retourne 0 chaîne le concernant).
- **Gating** : sans le module ANALYTICS / sans la permission, 403 (suivre le pattern des autres e2e analytics si présents, sinon vérifier au moins le happy path gated).

- [ ] **Step 2: Run the suite**

Run: `pnpm db:up && pnpm db:migrate && pnpm db:seed && cd apps/api && npx jest --config test/jest-e2e.json --runInBand --testPathPattern="flow-control-tower"`
Expected: vert. Puis lancer la suite complète une fois (`pnpm test:e2e`) pour confirmer zéro régression.

- [ ] **Step 3: Browser check (best-effort)**

`pnpm dev`, login `admin@pulsar.dev / admin123`, ouvrir `/analytics/flow` : la timeline montre l'activité, le tracé d'une commande montre ses étapes, la carte montre les modules. (Si non réalisable en headless, le noter ; l'e2e est la garantie.)

- [ ] **Step 4: Update docs**

- `docs/etat-du-projet.md` : ligne de session « Control Tower de flux v1 (arc A) ».
- `CLAUDE.md` : si un invariant le mérite (ex. « le flux est calculé à la lecture depuis DomainEvent/OperationalTask/ProposedAction via les helpers purs `@pulsar/shared/analytics/flow` ; aucun rollup ; les outils flux sont READ »), ajouter une règle numérotée.

- [ ] **Step 5: Commit**

```bash
git add apps/api/test/flow-control-tower.e2e-spec.ts docs/etat-du-projet.md CLAUDE.md
git commit -m "test(api): flow-control-tower e2e + docs"
```

---

## Self-review notes (résolu)

- **Couverture spec :** épine causalité (Task 1 `buildFlowChains`) ; Vue 1 timeline (Task 3 `timeline` + Task 5 onglet) ; Vue 2 tracé (Task 1 `buildEntityTrace` + Task 3 `trace` + Task 5 onglet) ; Vue 3 carte (Task 1 `buildFlowMap` + Task 3 `map` + Task 5 onglet) ; outils agent READ (Task 4) ; migration index (Task 2) ; tests (Task 1 unit + Task 6 e2e). ✔
- **Type consistency :** `FlowEvent`/`FlowTask`/`FlowAction`/`FlowChain`/`FlowMap`/`EntityTrace` définis en Task 1, consommés tels quels en Tasks 3/4/5. `timeline(tenantId, opts)` / `trace(tenantId, entityType, entityId)` cohérents entre FlowService (Task 3), ToolServices (Task 4) et l'adapter. ✔
- **Points à confirmer au fil de l'eau (signalés dans les steps) :** noms exacts des champs/relations Prisma pour `trace()` (Shipment.transportOrderId, Load.dispatchedAt/completedAt, PickOrder.status, IncomingCarrierInvoice.loadId/createdAt, lien Yard soft → possiblement `yardVisits: []` en v1) ; forme exacte de la factory `AGENT_TOOL_SERVICES` dans `agents.module.ts` + import d'`AnalyticsModule` ; runner de test `@pulsar/shared` = vitest ; pattern de polling web (OpsMap).
- **YAGNI :** carte de flux = rendu simple sans lib graphe ; pas de SSE ; pas de nouveaux events (arc B).
