# Control Tower Reactions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface cross-module `RUN_ACTION` reactions in the Flow Control Tower (`/analytics/flow`) — in the timeline chains, on the inter-module map, and as a KPI strip.

**Architecture:** Read-time only (rule 30): `flow.service` adds a 4th parallel query for `ReactionExecution`, maps rows to a new pure `FlowReaction` type (module resolved from the reaction catalogue), and passes them to the existing pure helpers `buildFlowChains`/`buildFlowMap` (extended) plus a new `deriveReactionKpis`. No store, no migration. The web page renders the new data with existing component styles.

**Tech Stack:** NestJS + Prisma (apps/api), SvelteKit Svelte 5 runes (apps/web), `@pulsar/shared` pure helpers, vitest (unit) + supertest (e2e), pnpm.

## Global Constraints

- **Rule 30:** all computed at read-time from `AgentRun`/`ProposedAction`/`OperationalTask`/`AuditLog`/`DomainEvent` + now `ReactionExecution`; no rollup store, NO migration; ratio/merge logic lives in pure, tested `@pulsar/shared` helpers.
- **Rule 1:** the `reactionExecution` query filters `tenantId`.
- **Rule 26:** projections never expose `secretHash`/`serviceUserId` (the reaction path touches none — keep it that way).
- **Back-compat:** with zero reactions, the timeline/map output is identical to today. `buildFlowChains([...], [...], [...], [])` must equal the current 3-arg behavior; existing `FlowMapEdge` consumers must still work (new `kind` field defaults to `'event'`).
- **No new permission:** `/analytics/flow` already gated by `analytics.read`.
- **Rebuild `@pulsar/shared` after edits** (`pnpm --filter @pulsar/shared build`). Run from repo root `C:\Users\samol\IntebecProject\Pulsar` (Git Bash). Commit directly to branch `arc-f-control-tower` (NO git worktree).

**Canonical files (read once):**
- Pure helpers: `packages/shared/src/analytics/flow.ts` (has `FlowEvent/FlowChain/FlowMap`, `buildFlowChains`, `buildFlowMap`, `moduleOfEventType`, `moduleOfSubjectType`).
- Reaction catalogue: `packages/shared/src/automation/reactions.ts` (`reactionByKey(key)` → `{ module: 'wms'|'billing'|... }`).
- Service: `apps/api/src/modules/analytics/flow.service.ts` (`timeline()` reads 3 sources in parallel and maps them; `map()` reuses `timeline()`).
- Web page: `apps/web/src/routes/(app)/analytics/flow/+page.svelte` (tabs `'timeline' | 'trace' | 'map'`).

---

### Task 1: Shared — FlowReaction type + helper extensions + KPIs

**Files:**
- Modify: `packages/shared/src/analytics/flow.ts`
- Test: `packages/shared/src/analytics/flow.spec.ts`

**Interfaces:**
- Produces: `FlowReaction` type; `FlowChain.reactions: FlowReaction[]`; `buildFlowChains(events, tasks, actions, reactions)`; `FlowMapEdge.kind: 'event'|'reaction'`; `moduleOfReaction(action: string): FlowModule`; `deriveReactionKpis(reactions): ReactionKpis`.

- [ ] **Step 1: Add the `FlowReaction` type + `reactions` on `FlowChain`.** In `flow.ts`, after the `FlowAction` interface add:

```ts
export interface FlowReaction { id: string; action: string; status: string; module: FlowModule; eventId: string; at: string; }
```

and add `reactions: FlowReaction[];` to the `FlowChain` interface.

- [ ] **Step 2: Add `kind` to `FlowMapEdge`.** Change the interface to:

```ts
export interface FlowMapEdge { from: FlowModule; to: FlowModule; count: number; kind: 'event' | 'reaction'; }
```

- [ ] **Step 3: Add `moduleOfReaction`.** After `moduleOfSubjectType`, add (imports `reactionByKey` from the automation module — both are pure/browser-safe within `@pulsar/shared`):

```ts
import { reactionByKey } from '../automation/reactions';

const MODULE_KEY_TO_FLOW: Record<string, FlowModule> = {
  transportation: 'TRANSPORTATION', wms: 'WMS', yard: 'YARD', fleet: 'FLEET',
  billing: 'BILLING', 'customer-portal': 'CUSTOMER_PORTAL',
};

export function moduleOfReaction(action: string): FlowModule {
  const m = reactionByKey(action)?.module;
  return (m && MODULE_KEY_TO_FLOW[m]) ?? 'CORE';
}
```

(Put the `import` at the top of the file with the other imports — `flow.ts` currently has none; add it as the first line.)

- [ ] **Step 4: Extend `buildFlowChains` to a 4th param.** Change the signature to `buildFlowChains(events: FlowEvent[], tasks: FlowTask[], actions: FlowAction[], reactions: FlowReaction[] = [])` (default `[]` preserves back-compat). Inside, build a `reactionsByEvent` map and attach to each chain:

```ts
  const reactionsByEvent = new Map<string, FlowReaction[]>();
  for (const r of reactions) {
    const list = reactionsByEvent.get(r.eventId) ?? [];
    list.push(r);
    reactionsByEvent.set(r.eventId, list);
  }
```

In `chainFrom`, compute `const chainReactions = event ? (reactionsByEvent.get(event.id) ?? []) : [];`, include their modules in `modules` (`...chainReactions.map((r) => r.module)`) and their `at` in `times`, and add `reactions: chainReactions` to the returned object.

- [ ] **Step 5: Extend `buildFlowMap` with reaction edges.** In the loop over chains, after the existing task-edge loop, add reaction edges keyed by `(from,to,kind)`:

```ts
    for (const r of c.reactions) {
      const to = r.module;
      if (to === from) continue;
      const key = `${from}->${to}:reaction`;
      const e = edgeCounts.get(key) ?? { from, to, count: 0, kind: 'reaction' as const };
      e.count += 1;
      edgeCounts.set(key, e);
    }
```

and change the existing event-edge key to `` `${from}->${to}:event` `` and its object to include `kind: 'event' as const`. (Keep `edgeCounts` typed `Map<string, FlowMapEdge>`.)

- [ ] **Step 6: Add `deriveReactionKpis`.** Append:

```ts
export interface ReactionKpis { executed: number; failed: number; byAction: { action: string; executed: number; failed: number }[]; }

export function deriveReactionKpis(reactions: FlowReaction[]): ReactionKpis {
  let executed = 0, failed = 0;
  const by = new Map<string, { executed: number; failed: number }>();
  for (const r of reactions) {
    const ok = r.status === 'EXECUTED';
    if (ok) executed++; else failed++;
    const e = by.get(r.action) ?? { executed: 0, failed: 0 };
    if (ok) e.executed++; else e.failed++;
    by.set(r.action, e);
  }
  const byAction = [...by.entries()]
    .map(([action, c]) => ({ action, ...c }))
    .sort((a, b) => (b.executed + b.failed) - (a.executed + a.failed));
  return { executed, failed, byAction };
}
```

- [ ] **Step 7: Write the failing tests** in `flow.spec.ts`:

```ts
import { buildFlowChains, buildFlowMap, deriveReactionKpis, moduleOfReaction, type FlowEvent, type FlowReaction } from './flow';

const ev = (id: string, type: string): FlowEvent => ({ id, type, module: 'TRANSPORTATION', subjectType: 'load', subjectId: 'L1', at: '2026-06-22T10:00:00.000Z' });
const rx = (id: string, eventId: string, action: string, status = 'EXECUTED'): FlowReaction => ({ id, action, status, module: 'BILLING', eventId, at: '2026-06-22T10:00:01.000Z' });

describe('flow reactions', () => {
  it('attaches reactions to their event chain', () => {
    const chains = buildFlowChains([ev('e1', 'load.completed')], [], [], [rx('r1', 'e1', 'draft_customer_invoice')]);
    expect(chains[0].reactions).toHaveLength(1);
    expect(chains[0].modules).toContain('BILLING');
    expect(chains[0].crossModule).toBe(true);
  });
  it('back-compat: omitting reactions equals the 3-arg behavior', () => {
    const a = buildFlowChains([ev('e1', 'load.completed')], [], []);
    expect(a[0].reactions).toEqual([]);
  });
  it('buildFlowMap emits a reaction edge distinct from event edges', () => {
    const chains = buildFlowChains([ev('e1', 'load.completed')], [], [], [rx('r1', 'e1', 'draft_customer_invoice')]);
    const map = buildFlowMap(chains);
    const redge = map.edges.find((e) => e.kind === 'reaction');
    expect(redge).toMatchObject({ from: 'TRANSPORTATION', to: 'BILLING', kind: 'reaction' });
  });
  it('deriveReactionKpis counts executed/failed and sorts byAction', () => {
    const k = deriveReactionKpis([rx('r1', 'e1', 'a'), rx('r2', 'e1', 'a'), rx('r3', 'e2', 'b', 'FAILED')]);
    expect(k.executed).toBe(2); expect(k.failed).toBe(1);
    expect(k.byAction[0]).toEqual({ action: 'a', executed: 2, failed: 0 });
  });
  it('moduleOfReaction maps a known reaction to its FlowModule', () => {
    expect(moduleOfReaction('draft_customer_invoice')).toBe('BILLING');
    expect(moduleOfReaction('nonexistent')).toBe('CORE');
  });
});
```

- [ ] **Step 8: Run tests + build.** Run: `pnpm --filter @pulsar/shared test -- flow` (expect PASS), then `pnpm --filter @pulsar/shared build` (tsc exit 0). Note: `buildFlowMap`'s existing tests (if any) may need the `kind` field — update any existing edge assertion to include `kind`.

- [ ] **Step 9: Commit.**

```bash
git add packages/shared/src/analytics/flow.ts packages/shared/src/analytics/flow.spec.ts
git commit -m "feat(shared): flow reactions (FlowReaction, chain/map extensions, reaction KPIs)"
```

---

### Task 2: API — flow.service reads ReactionExecution

**Files:**
- Modify: `apps/api/src/modules/analytics/flow.service.ts`
- (the controller returns whatever `timeline()` returns — confirm `control-tower.controller.ts` or the flow controller passes it through)

**Interfaces:**
- Consumes: `buildFlowChains(events, tasks, actions, reactions)`, `moduleOfReaction`, `deriveReactionKpis`, `FlowReaction`, `ReactionKpis` from `@pulsar/shared`.
- Produces: `timeline()` returns `{ chains: FlowChain[]; reactionKpis: ReactionKpis }`.

- [ ] **Step 1: Import the new helpers/types.** In `flow.service.ts`, add to the `@pulsar/shared` import: `deriveReactionKpis`, `moduleOfReaction`, `type FlowReaction`, `type ReactionKpis`.

- [ ] **Step 2: Add the 4th parallel query.** In `timeline()`, extend the `Promise.all` destructure to `[rawEvents, rawTasks, rawActions, rawReactions]` and add:

```ts
      this.prisma.reactionExecution.findMany({
        where: { tenantId, createdAt: { gte: since } },
        orderBy: { createdAt: 'desc' },
        take: opts.limit,
        select: { id: true, action: true, status: true, eventId: true, createdAt: true },
      }),
```

- [ ] **Step 3: Map to `FlowReaction`** (after the `fActions` map):

```ts
    const fReactions: FlowReaction[] = rawReactions.map((r) => ({
      id: r.id,
      action: r.action,
      status: r.status,
      module: moduleOfReaction(r.action),
      eventId: r.eventId,
      at: r.createdAt.toISOString(),
    }));
```

- [ ] **Step 4: Pass to the helper + return KPIs.** Change `let chains = buildFlowChains(fEvents, fTasks, fActions);` to `buildFlowChains(fEvents, fTasks, fActions, fReactions);`. Change the return to:

```ts
    return { chains: chains.slice(0, opts.limit), reactionKpis: deriveReactionKpis(fReactions) };
```

Update the method return type to `Promise<{ chains: FlowChain[]; reactionKpis: ReactionKpis }>`.

- [ ] **Step 5: Fix the `map()` reuse.** `map()` does `const { chains } = await this.timeline(...)` — that destructure still works (it ignores `reactionKpis`). No change needed; confirm it compiles.

- [ ] **Step 6: Typecheck.** Run: `pnpm --filter @pulsar/api typecheck` (expect 0 errors). If the flow controller declares an explicit return type for the timeline endpoint, widen it to include `reactionKpis`.

- [ ] **Step 7: Commit.**

```bash
git add apps/api/src/modules/analytics/flow.service.ts apps/api/src/modules/analytics
git commit -m "feat(api): flow timeline reads ReactionExecution + reaction KPIs"
```

---

### Task 3: Web — reactions in timeline, map edges, KPI strip

**Files:**
- Modify: `apps/web/src/routes/(app)/analytics/flow/+page.svelte`

**Interfaces:**
- Consumes: `GET /analytics/flow` (timeline) now returns `{ chains, reactionKpis }`, each chain has `reactions: { id, action, status, module, eventId, at }[]`; map edges have `kind: 'event'|'reaction'`.

- [ ] **Step 1: Extend the timeline fetch + types.** In the page, add a local type for `FlowReaction` (`{ id; action; status; module; eventId; at }`) on the chain type, and a `reactionKpis` state (`{ executed; failed; byAction: {action;executed;failed}[] }`). Capture `reactionKpis` from the timeline response (`loadTimeline`).

- [ ] **Step 2: Render reactions in each chain (A).** In the timeline tab, inside each chain card after the tasks/actions rows, add (only when `chain.reactions?.length`):

```svelte
{#if chain.reactions?.length}
  <div class="mt-1 flex flex-wrap gap-1">
    {#each chain.reactions as r (r.id)}
      <span class="rounded px-1.5 py-0.5 text-xs {r.status === 'EXECUTED' ? 'bg-ok/10 text-ok' : 'bg-danger/10 text-danger'}">
        ⚡ {reactionLabel(r.action)} → {r.module}{r.status === 'FAILED' ? ' (échec)' : ''}
      </span>
    {/each}
  </div>
{/if}
```

where `reactionLabel(action)` returns a friendly label — import `reactionByKey` from `@pulsar/shared` and use `reactionByKey(action)?.label ?? action`.

- [ ] **Step 3: KPI strip (C).** At the top of the timeline tab (above the chain list), add (when `reactionKpis` present):

```svelte
{#if reactionKpis}
  <div class="mb-3 flex items-center gap-3 rounded-md border border-edge-soft px-3 py-2 text-sm">
    <span class="font-bold text-ink">⚡ Réactions</span>
    <span class="text-ok">{reactionKpis.executed} exécutées</span>
    <span class="text-danger">{reactionKpis.failed} échouées</span>
    {#if reactionKpis.byAction.length}
      <span class="text-ink-muted">· top : {reactionKpis.byAction.slice(0, 3).map((a) => `${reactionLabel(a.action)} (${a.executed + a.failed})`).join(', ')}</span>
    {/if}
  </div>
{/if}
```

- [ ] **Step 4: Reaction edges on the map (B).** In the map tab's "Flux entre modules" section, where edges are listed, distinguish `edge.kind === 'reaction'` (e.g. accent color + a ⚡ marker / "réaction" label) from event edges. Concretely, where each edge row renders, add a class/marker keyed on `edge.kind`:

```svelte
<span class="{edge.kind === 'reaction' ? 'text-accent' : 'text-ink-muted'}">
  {edge.from} → {edge.to} {edge.kind === 'reaction' ? '⚡' : ''} ({edge.count})
</span>
```

Update the section's legend/help text to mention reaction edges.

- [ ] **Step 5: svelte-check.** Run: `pnpm --filter @pulsar/web check`. Expected: no new errors. Do NOT run the browser step (the controller verifies separately).

- [ ] **Step 6: Commit.**

```bash
git add "apps/web/src/routes/(app)/analytics/flow/+page.svelte"
git commit -m "feat(web): show reactions in flow timeline + map edges + KPI strip"
```

---

### Task 4: e2e — flow reactions

**Files:**
- Modify: `apps/api/test/flow-control-tower.e2e-spec.ts` (extend the existing flow e2e)

**Interfaces:** Consumes `GET /analytics/flow` (timeline + map) + the automation rule + reaction infra.

- [ ] **Step 1: Add a reaction-visibility test.** In the existing flow e2e (which already bootstraps a tenant + drives flow), add a block: create a `RUN_ACTION` automation rule (e.g. on `load.completed` → `draft_customer_invoice`), seed the `service-account@pulsar.local` user if the suite doesn't already, drive the trigger (or emit the event) + `processPending`, then:
  - `GET /api/v1/analytics/flow` (timeline) → some chain's `reactions` array contains the reaction with `status: 'EXECUTED'`; the response `reactionKpis.executed >= 1`.
  - `GET` the map → `edges` contains one with `kind: 'reaction'`.
  - Back-compat: a tenant/window with no reactions → `reactionKpis.executed === 0` and no `kind:'reaction'` edge (the rest of the timeline unchanged).
  Mirror the existing flow e2e's bootstrap + the reaction-driving approach from `cross-module-automation.e2e-spec.ts` (it seeds the service-account and uses `domainEvents.processPending`).

- [ ] **Step 2: Run the suite.** DB up + seeded. Run: `pnpm --filter @pulsar/api test:e2e -- flow-control-tower`. Expect green.

- [ ] **Step 3: Full gate.** Run: `pnpm test && pnpm typecheck`. Expect 0 failures.

- [ ] **Step 4: Commit.**

```bash
git add apps/api/test/flow-control-tower.e2e-spec.ts
git commit -m "test(api): flow control tower surfaces reactions (timeline + map + kpi)"
```

---

## Self-review notes

- **Spec coverage:** A (reactions in timeline) → Task 1 (`FlowChain.reactions` + `buildFlowChains`) + Task 2 (read) + Task 3 Step 2 + Task 4. B (map edges) → Task 1 (`buildFlowMap` + `FlowMapEdge.kind`) + Task 3 Step 4 + Task 4. C (KPI) → Task 1 (`deriveReactionKpis`) + Task 2 (return) + Task 3 Step 3 + Task 4. Module mapping (spec §3) → Task 1 Step 3 (`moduleOfReaction`). Rule 30 (read-time, no migration) → no migration task exists; confirmed.
- **Placeholder scan:** every code step shows code; the web edits give concrete snippets + the `reactionLabel` helper; Task 4 references the existing e2e bootstrap + the cross-module reaction-driving pattern (both concrete in-repo).
- **Type consistency:** `FlowReaction` shape identical across Task 1 (def), Task 2 (map), Task 3 (consume); `reactionKpis`/`ReactionKpis` consistent (Task 1 def, Task 2 return, Task 3 read); `FlowMapEdge.kind` values `'event'|'reaction'` consistent (Task 1, Task 3, Task 4); `buildFlowChains` 4th param default `[]` preserves back-compat (asserted in Task 1 Step 7).
- **Known dependency:** Task 1 Step 3 cross-imports `reactionByKey` from `../automation/reactions` within `@pulsar/shared` — both are pure/browser-safe (no Node imports), so no bundling risk for the web (which aliases shared to source).
