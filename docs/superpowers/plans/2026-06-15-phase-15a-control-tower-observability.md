# Phase 15-A — Control Tower (observabilité) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface agent governance as observable KPIs, a tenant-wide manager dashboard, and a unified per-agent activity/audit timeline — all computed on read from existing rows, with no new table or migration.

**Architecture:** Pure ratio/merge helpers in `@pulsar/shared` (`deriveAgentKpis`, `mergeTimeline`); `AgentsService` gathers raw counts via Prisma (tenant-scoped) and shapes them; three read-only endpoints (`GET /agents/:id/kpis`, `GET /agents/control-tower`, `GET /agents/:id/timeline`); the `/agents` roster becomes the manager dashboard and `/agents/[id]` gains a KPI panel + timeline. Closes the phase-14 debt by feeding the real breaker-trip count into the trust score.

**Tech Stack:** `@pulsar/shared` (pure, browser-safe — NO module-scope `node:*`), NestJS 11 + Prisma 6, SvelteKit 5 runes, Jest (api) + vitest (shared).

**Design spec:** `docs/superpowers/specs/2026-06-15-phase-15a-control-tower-observability-design.md`

**Branch:** `phase-15` (already created off phase-14 tip; the design doc is its first commit). Do NOT switch branches. NO migration in this phase.

**Conventions reminder (CLAUDE.md):**
- Pure helpers in `@pulsar/shared` (vitest); rebuild it after editing (`pnpm --filter @pulsar/shared build`). No module-scope `node:*` (web SPA bundles shared from source).
- Tenant isolation (rule 1): every query filters `tenantId`. Agent projections exclude `secretHash`/`serviceUserId` (rule 26, the shared `agentSelect`).
- Route ordering: literal `:id/...` and `control-tower` routes MUST precede the bare `@Get(':id')`.
- Run `pnpm build` (full) AND `pnpm test` before declaring green.

---

## File Structure

**Create:**
- `packages/shared/src/agents/kpis.ts` — `AgentKpiRaw`, `AgentKpis`, `deriveAgentKpis`.
- `packages/shared/src/agents/kpis.spec.ts`
- `packages/shared/src/agents/timeline.ts` — `TimelineEntry`, `mergeTimeline`.
- `packages/shared/src/agents/timeline.spec.ts`
- `apps/api/src/core/agents/agents-observability.service.spec.ts` — unit tests for `kpis`/`controlTower`/`timeline`/trust-breakerTrips.
- `apps/api/test/phase15a-control-tower.e2e-spec.ts`

**Modify:**
- `packages/shared/src/index.ts` — export the two new modules.
- `apps/api/src/core/agents/agents.service.ts` — `gatherKpiRaw`, `kpis`, `controlTower`, `timeline`, real `breakerTrips` in `trust`.
- `apps/api/src/core/agents/agents.controller.ts` — `GET :id/kpis`, `GET control-tower`, `GET :id/timeline`.
- `apps/web/src/routes/(app)/agents/+page.svelte` — manager dashboard (tenant rollup header + KPI-enriched cards).
- `apps/web/src/routes/(app)/agents/[id]/+page.svelte` — KPI panel + timeline section.
- `CLAUDE.md`, `ROADMAP.md`, `docs/etat-du-projet.md`.

---

## Task 1: Shared — `deriveAgentKpis`

**Files:** Create `packages/shared/src/agents/kpis.ts`, `kpis.spec.ts`; Modify `packages/shared/src/index.ts`.

- [ ] **Step 1: Write the failing test** — `packages/shared/src/agents/kpis.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { deriveAgentKpis, type AgentKpiRaw } from './kpis';

const raw = (o: Partial<AgentKpiRaw> = {}): AgentKpiRaw => ({
  executed: 0, autoApproved: 0, pending: 0, rejected: 0, failed: 0,
  runsTotal: 0, runsSucceeded: 0, runsFailed: 0, runsSkipped: 0, runsKilled: 0,
  runLatenciesMs: [], breakerTrips: 0, tasksResolved: 0, ...o,
});

describe('deriveAgentKpis', () => {
  it('totals actions and computes bounded ratios', () => {
    const k = deriveAgentKpis(raw({ executed: 8, autoApproved: 5, pending: 1, rejected: 2, failed: 2 }));
    expect(k.actions.total).toBe(13); // 8+1+2+2
    expect(k.approvalRate).toBeCloseTo(8 / 10); // executed/(executed+rejected)
    expect(k.autoApprovalRate).toBeCloseTo(5 / 8); // autoApproved/executed
    expect(k.errorRate).toBeCloseTo(2 / 10); // failed/(executed+failed)
  });
  it('zero-guards: no decisions/runs → 0 rates and null latency', () => {
    const k = deriveAgentKpis(raw());
    expect(k.approvalRate).toBe(0);
    expect(k.autoApprovalRate).toBe(0);
    expect(k.errorRate).toBe(0);
    expect(k.avgRunLatencyMs).toBeNull();
  });
  it('averages run latencies when present', () => {
    const k = deriveAgentKpis(raw({ runLatenciesMs: [100, 300] }));
    expect(k.avgRunLatencyMs).toBe(200);
  });
  it('passes through run buckets, breakerTrips, tasksResolved', () => {
    const k = deriveAgentKpis(raw({ runsTotal: 5, runsSucceeded: 3, runsFailed: 1, runsSkipped: 1, breakerTrips: 2, tasksResolved: 4 }));
    expect(k.runs).toEqual({ total: 5, succeeded: 3, failed: 1, skipped: 1, killed: 0 });
    expect(k.breakerTrips).toBe(2);
    expect(k.tasksResolved).toBe(4);
  });
});
```

- [ ] **Step 2: Run → FAIL**

Run: `pnpm --filter @pulsar/shared test -- kpis.spec`
Expected: cannot find `./kpis`.

- [ ] **Step 3: Implement `packages/shared/src/agents/kpis.ts`**

```ts
// Pure, browser-safe. No node:* imports.

export interface AgentKpiRaw {
  executed: number;
  autoApproved: number;
  pending: number;
  rejected: number;
  failed: number;
  runsTotal: number;
  runsSucceeded: number;
  runsFailed: number;
  runsSkipped: number;
  runsKilled: number;
  runLatenciesMs: number[];
  breakerTrips: number;
  tasksResolved: number;
}

export interface AgentKpis {
  actions: { total: number; executed: number; autoApproved: number; pending: number; rejected: number; failed: number };
  approvalRate: number;
  autoApprovalRate: number;
  errorRate: number;
  runs: { total: number; succeeded: number; failed: number; skipped: number; killed: number };
  avgRunLatencyMs: number | null;
  breakerTrips: number;
  tasksResolved: number;
}

const ratio = (num: number, den: number): number => (den > 0 ? num / den : 0);

/** Shape raw counts into bounded KPI ratios. Pure. */
export function deriveAgentKpis(raw: AgentKpiRaw): AgentKpis {
  const avgRunLatencyMs =
    raw.runLatenciesMs.length > 0
      ? Math.round(raw.runLatenciesMs.reduce((a, b) => a + b, 0) / raw.runLatenciesMs.length)
      : null;
  return {
    actions: {
      total: raw.executed + raw.pending + raw.rejected + raw.failed,
      executed: raw.executed,
      autoApproved: raw.autoApproved,
      pending: raw.pending,
      rejected: raw.rejected,
      failed: raw.failed,
    },
    approvalRate: ratio(raw.executed, raw.executed + raw.rejected),
    autoApprovalRate: ratio(raw.autoApproved, raw.executed),
    errorRate: ratio(raw.failed, raw.executed + raw.failed),
    runs: {
      total: raw.runsTotal,
      succeeded: raw.runsSucceeded,
      failed: raw.runsFailed,
      skipped: raw.runsSkipped,
      killed: raw.runsKilled,
    },
    avgRunLatencyMs,
    breakerTrips: raw.breakerTrips,
    tasksResolved: raw.tasksResolved,
  };
}
```

- [ ] **Step 4: Export** — in `packages/shared/src/index.ts`, after `export * from './agents/trust';`, add:

```ts
export * from './agents/kpis';
```

- [ ] **Step 5: Run + build**

Run: `pnpm --filter @pulsar/shared test -- kpis.spec` → PASS.
Run: `pnpm --filter @pulsar/shared build` → clean.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/agents/kpis.ts packages/shared/src/agents/kpis.spec.ts packages/shared/src/index.ts
git commit -m "feat(shared): deriveAgentKpis — agent KPI ratios

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Shared — `mergeTimeline`

**Files:** Create `packages/shared/src/agents/timeline.ts`, `timeline.spec.ts`; Modify `index.ts`.

- [ ] **Step 1: Write the failing test** — `packages/shared/src/agents/timeline.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { mergeTimeline, type TimelineEntry } from './timeline';

const e = (at: string, kind: string): TimelineEntry => ({ at, kind, summary: `${kind}@${at}` });

describe('mergeTimeline', () => {
  it('merges sources sorted by `at` descending', () => {
    const a = [e('2026-06-10T00:00:00.000Z', 'run'), e('2026-06-12T00:00:00.000Z', 'run')];
    const b = [e('2026-06-11T00:00:00.000Z', 'action')];
    const out = mergeTimeline([a, b], 10);
    expect(out.map((x) => x.at)).toEqual([
      '2026-06-12T00:00:00.000Z',
      '2026-06-11T00:00:00.000Z',
      '2026-06-10T00:00:00.000Z',
    ]);
  });
  it('truncates to limit', () => {
    const a = [e('2026-06-03T00:00:00.000Z', 'x'), e('2026-06-02T00:00:00.000Z', 'x'), e('2026-06-01T00:00:00.000Z', 'x')];
    expect(mergeTimeline([a], 2).length).toBe(2);
  });
  it('handles empty sources', () => {
    expect(mergeTimeline([[], []], 5)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run → FAIL**

Run: `pnpm --filter @pulsar/shared test -- timeline.spec`
Expected: cannot find `./timeline`.

- [ ] **Step 3: Implement `packages/shared/src/agents/timeline.ts`**

```ts
// Pure, browser-safe.

export interface TimelineEntry {
  at: string;        // ISO timestamp
  kind: string;      // 'run' | 'action' | 'lifecycle'
  summary: string;
  ref?: string;
}

/** Flatten, sort by `at` descending (ISO strings compare lexicographically), truncate to `limit`. */
export function mergeTimeline(sources: TimelineEntry[][], limit: number): TimelineEntry[] {
  return sources
    .flat()
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
    .slice(0, limit);
}
```

- [ ] **Step 4: Export** — in `index.ts` add `export * from './agents/timeline';`.

- [ ] **Step 5: Run + build**

Run: `pnpm --filter @pulsar/shared test -- timeline.spec` → PASS.
Run: `pnpm --filter @pulsar/shared build` → clean.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/agents/timeline.ts packages/shared/src/agents/timeline.spec.ts packages/shared/src/index.ts
git commit -m "feat(shared): mergeTimeline — chronological merge of agent activity sources

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: API — `kpis` + real `breakerTrips` in `trust`

**Files:** Modify `apps/api/src/core/agents/agents.service.ts`, `agents.controller.ts`; Test `apps/api/src/core/agents/agents-observability.service.spec.ts`.

- [ ] **Step 1: Write the failing test** — `agents-observability.service.spec.ts`:

```ts
import { AgentAutonomy } from '@pulsar/shared';
import { AgentsService } from './agents.service';

// Prisma mock that returns distinct counts per (model, status) and a couple of finished runs.
function makePrisma() {
  return {
    agent: { findFirst: async () => ({ id: 'a1', tenantId: 't1', autonomyLevel: AgentAutonomy.PROPOSE, status: 'ACTIVE', name: 'A', role: null, avatar: null, breakerTrippedAt: null }) },
    proposedAction: {
      count: async ({ where }: any) => {
        if (where.status === 'EXECUTED' && where.autoApproved === true) return 3;
        if (where.status === 'EXECUTED') return 6;
        if (where.status === 'PENDING') return 1;
        if (where.status === 'REJECTED') return 2;
        if (where.status === 'FAILED') return 1;
        return 0;
      },
    },
    agentRun: {
      count: async ({ where }: any) =>
        where.status === 'SUCCEEDED' ? 4 : where.status === 'FAILED' ? 1 : where.status === 'SKIPPED' ? 0 : where.status === 'KILLED' ? 0 : 5,
      findMany: async () => [
        { startedAt: new Date('2026-06-10T00:00:00Z'), finishedAt: new Date('2026-06-10T00:00:00.200Z') },
        { startedAt: new Date('2026-06-10T01:00:00Z'), finishedAt: new Date('2026-06-10T01:00:00.400Z') },
      ],
    },
    auditLog: { count: async () => 2 },
    operationalTask: { count: async () => 7 },
  } as any;
}

describe('AgentsService.kpis', () => {
  it('aggregates raw counts into KPIs', async () => {
    process.env.JWT_SECRET = 'test-secret';
    const svc = new AgentsService(makePrisma(), {} as any, {} as any, {} as any);
    const k = await svc.kpis('t1', 'a1', 30);
    expect(k.actions.executed).toBe(6);
    expect(k.actions.autoApproved).toBe(3);
    expect(k.actions.total).toBe(10); // 6+1+2+1
    expect(k.breakerTrips).toBe(2);
    expect(k.tasksResolved).toBe(7);
    expect(k.avgRunLatencyMs).toBe(300); // (200+400)/2
    expect(k.runs.succeeded).toBe(4);
  });
});
```

- [ ] **Step 2: Run → FAIL**

Run: `pnpm --filter @pulsar/api test -- agents-observability.service`
Expected: `kpis is not a function`.

- [ ] **Step 3: Implement in `agents.service.ts`**

3a. Imports — add `deriveAgentKpis`, `mergeTimeline`, and the types:
```ts
import { computeTrustScore, deriveAgentKpis, mergeTimeline, type AgentAutonomy, type AgentKpiRaw, type TimelineEntry } from '@pulsar/shared';
```
(merge with the existing `@pulsar/shared` import; `computeTrustScore`/`AgentAutonomy` are already imported from phase 14.)

3b. Add a private breaker-trip counter + raw gatherer (place near `trust`):
```ts
  /** Count circuit-breaker trips for an agent from the audit trail (phase-14 maybeTripBreaker logs them). */
  private breakerTripCount(tenantId: string, agentId: string, since?: Date) {
    return this.prisma.auditLog.count({
      where: {
        tenantId,
        entityType: 'agent',
        entityId: agentId,
        after: { path: ['breakerTripped'], equals: true },
        ...(since ? { createdAt: { gte: since } } : {}),
      },
    });
  }

  /** Gather all raw KPI counts for an agent within a window. */
  private async gatherKpiRaw(tenantId: string, agentId: string, since: Date): Promise<AgentKpiRaw> {
    const pa = (extra: object) => this.prisma.proposedAction.count({ where: { tenantId, agentId, proposedAt: { gte: since }, ...extra } });
    const run = (extra: object) => this.prisma.agentRun.count({ where: { tenantId, agentId, createdAt: { gte: since }, ...extra } });
    const [
      executed, autoApproved, pending, rejected, failed,
      runsTotal, runsSucceeded, runsFailed, runsSkipped, runsKilled,
      breakerTrips, tasksResolved, finishedRuns,
    ] = await Promise.all([
      pa({ status: 'EXECUTED' }),
      pa({ status: 'EXECUTED', autoApproved: true }),
      pa({ status: 'PENDING' }),
      pa({ status: 'REJECTED' }),
      pa({ status: 'FAILED' }),
      run({}),
      run({ status: 'SUCCEEDED' }),
      run({ status: 'FAILED' }),
      run({ status: 'SKIPPED' }),
      run({ status: 'KILLED' }),
      this.breakerTripCount(tenantId, agentId, since),
      this.prisma.operationalTask.count({ where: { tenantId, assigneeAgentId: agentId, status: 'RESOLVED' } }),
      this.prisma.agentRun.findMany({
        where: { tenantId, agentId, createdAt: { gte: since }, startedAt: { not: null }, finishedAt: { not: null } },
        select: { startedAt: true, finishedAt: true },
        orderBy: { createdAt: 'desc' },
        take: 200,
      }),
    ]);
    const runLatenciesMs = finishedRuns
      .filter((r) => r.startedAt && r.finishedAt)
      .map((r) => r.finishedAt!.getTime() - r.startedAt!.getTime());
    return { executed, autoApproved, pending, rejected, failed, runsTotal, runsSucceeded, runsFailed, runsSkipped, runsKilled, runLatenciesMs, breakerTrips, tasksResolved };
  }

  /** Per-agent KPI rollup (computed on read). */
  async kpis(tenantId: string, id: string, days = 30) {
    const agent = await this.prisma.agent.findFirst({ where: { id, tenantId }, select: { id: true } });
    if (!agent) throw new NotFoundException('Agent not found');
    const since = new Date(Date.now() - days * 86_400_000);
    return deriveAgentKpis(await this.gatherKpiRaw(tenantId, id, since));
  }
```

3c. Fix `trust()` to pass the real breaker-trip count. In `trust`, the `computeTrustScore` call currently passes `breakerTrips: 0`. Replace with the real count (all-time):
```ts
    const breakerTrips = await this.breakerTripCount(tenantId, id);
    const result = computeTrustScore(
      { executed, rejected, failed, runsSucceeded, runsTotal, breakerTrips },
      agent.autonomyLevel as AgentAutonomy,
    );
```
(Add `breakerTrips` to the `Promise.all` destructuring OR fetch it on its own line as shown — keep it simple with a separate `await`.)

- [ ] **Step 4: Add the controller endpoint** — in `agents.controller.ts`, add `@Query` import if missing, and (place with the other `@Get(':id/...')` routes, before `@Get(':id')`):
```ts
  @Get(':id/kpis')
  @RequirePermissions(PERMISSIONS.CORE.AGENTS_READ)
  kpis(@CurrentUser() user: AuthUser, @Param('id') id: string, @Query('days') days?: string) {
    return this.agents.kpis(user.tenantId, id, days ? Number(days) : 30);
  }
```

- [ ] **Step 5: Run test + build**

Run: `pnpm --filter @pulsar/api test -- agents-observability.service` → PASS.
Run: `pnpm --filter @pulsar/api test -- agents-trust` → still PASS (trust shape unchanged; breakerTrips now real — the mock returns 0 trips so the score is unchanged there).
Run: `pnpm --filter @pulsar/api build` → clean.

> If the existing `agents-trust.service.spec.ts` mock doesn't define `auditLog.count`, add `auditLog: { count: async () => 0 }` to its prisma mock so `breakerTripCount` resolves. Update that spec if needed.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/core/agents/agents.service.ts apps/api/src/core/agents/agents.controller.ts apps/api/src/core/agents/agents-observability.service.spec.ts apps/api/src/core/agents/agents-trust.service.spec.ts
git commit -m "feat(api): GET /agents/:id/kpis + real breakerTrips in trust score

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: API — `controlTower` (manager dashboard)

**Files:** Modify `agents.service.ts`, `agents.controller.ts`; extend `agents-observability.service.spec.ts`.

- [ ] **Step 1: Add a failing test** to `agents-observability.service.spec.ts`:

```ts
describe('AgentsService.controlTower', () => {
  it('returns per-agent KPI summaries + tenant rollup', async () => {
    process.env.JWT_SECRET = 'test-secret';
    const base = makePrisma();
    const prisma = {
      ...base,
      agent: {
        ...base.agent,
        findMany: async () => [
          { id: 'a1', name: 'A', role: null, avatar: null, status: 'ACTIVE', autonomyLevel: AgentAutonomy.PROPOSE, breakerTrippedAt: null },
          { id: 'a2', name: 'B', role: null, avatar: null, status: 'PAUSED', autonomyLevel: AgentAutonomy.ACT_LOW, breakerTrippedAt: new Date() },
        ],
      },
    } as any;
    const svc = new AgentsService(prisma, {} as any, {} as any, {} as any);
    const out = await svc.controlTower('t1', 30);
    expect(out.items).toHaveLength(2);
    expect(out.items[0].kpis.actions.executed).toBe(6);
    expect(out.rollup.agents).toBe(2);
    expect(out.rollup.active).toBe(1);
    expect(out.rollup.paused).toBe(1);
    expect(out.rollup.totalActions).toBe(20); // 10 per agent
    expect(out.rollup.pendingApprovals).toBe(2);
  });
});
```

- [ ] **Step 2: Run → FAIL**

Run: `pnpm --filter @pulsar/api test -- agents-observability.service`
Expected: `controlTower is not a function`.

- [ ] **Step 3: Implement `controlTower` in `agents.service.ts`** (place after `kpis`):

```ts
  /** Tenant-wide manager dashboard: per-agent KPI summaries + aggregate rollup (computed on read). */
  async controlTower(tenantId: string, days = 30) {
    const since = new Date(Date.now() - days * 86_400_000);
    const agents = await this.prisma.agent.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      select: { id: true, name: true, role: true, avatar: true, status: true, autonomyLevel: true, breakerTrippedAt: true },
    });
    const items = await Promise.all(
      agents.map(async (a) => ({
        id: a.id,
        name: a.name,
        role: a.role,
        avatar: a.avatar,
        status: a.status,
        autonomyLevel: a.autonomyLevel,
        breakerTrippedAt: a.breakerTrippedAt,
        kpis: deriveAgentKpis(await this.gatherKpiRaw(tenantId, a.id, since)),
      })),
    );
    const rollup = {
      agents: items.length,
      active: items.filter((i) => i.status === 'ACTIVE').length,
      paused: items.filter((i) => i.status === 'PAUSED').length,
      revoked: items.filter((i) => i.status === 'REVOKED').length,
      totalActions: items.reduce((s, i) => s + i.kpis.actions.total, 0),
      pendingApprovals: items.reduce((s, i) => s + i.kpis.actions.pending, 0),
      totalBreakerTrips: items.reduce((s, i) => s + i.kpis.breakerTrips, 0),
      totalTasksResolved: items.reduce((s, i) => s + i.kpis.tasksResolved, 0),
    };
    return { items, rollup };
  }
```

> The `select` here is an explicit safe projection (no `secretHash`/`serviceUserId`) — rule 26. Don't switch it to the full `agentSelect` (which carries more than the dashboard needs).

- [ ] **Step 4: Controller endpoint** — in `agents.controller.ts`, add **before** the `@Get(':id')` route AND before `@Get(':id/...')` routes (a bare literal segment — must not be shadowed by `:id`):

```ts
  @Get('control-tower')
  @RequirePermissions(PERMISSIONS.CORE.AGENTS_READ)
  controlTower(@CurrentUser() user: AuthUser, @Query('days') days?: string) {
    return this.agents.controlTower(user.tenantId, days ? Number(days) : 30);
  }
```
Place it near the top of the controller (right after the constructor / the bare `@Get()` list route), so neither `:id` nor `:id/...` can capture `control-tower`.

- [ ] **Step 5: Run test + build**

Run: `pnpm --filter @pulsar/api test -- agents-observability.service` → PASS (both describes).
Run: `pnpm --filter @pulsar/api build` → clean.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/core/agents/agents.service.ts apps/api/src/core/agents/agents.controller.ts apps/api/src/core/agents/agents-observability.service.spec.ts
git commit -m "feat(api): GET /agents/control-tower — tenant manager dashboard rollup

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: API — `timeline`

**Files:** Modify `agents.service.ts`, `agents.controller.ts`; extend the observability spec.

- [ ] **Step 1: Add a failing test** to `agents-observability.service.spec.ts`:

```ts
describe('AgentsService.timeline', () => {
  it('merges runs, actions and audit lifecycle entries, newest first', async () => {
    process.env.JWT_SECRET = 'test-secret';
    const base = makePrisma();
    const prisma = {
      ...base,
      agent: { ...base.agent, findFirst: async () => ({ id: 'a1', name: 'A' }) },
      agentRun: { ...base.agentRun, findMany: async () => [{ id: 'r1', trigger: 'EVENT', status: 'SUCCEEDED', taskId: 't1', createdAt: new Date('2026-06-12T00:00:00Z'), finishedAt: new Date('2026-06-12T00:00:01Z') }] },
      proposedAction: { ...base.proposedAction, findMany: async () => [{ id: 'p1', tool: 'create_load', status: 'EXECUTED', autoApproved: true, proposedAt: new Date('2026-06-13T00:00:00Z') }] },
      auditLog: { ...base.auditLog, findMany: async () => [{ id: 'au1', action: 'UPDATE', after: { breakerTripped: true }, createdAt: new Date('2026-06-11T00:00:00Z') }] },
    } as any;
    const svc = new AgentsService(prisma, {} as any, {} as any, {} as any);
    const tl = await svc.timeline('t1', 'a1', 10);
    expect(tl.map((e: any) => e.kind)).toEqual(['action', 'run', 'lifecycle']); // 06-13, 06-12, 06-11
    expect(tl[0].ref).toBe('p1');
  });
});
```

- [ ] **Step 2: Run → FAIL**

Run: `pnpm --filter @pulsar/api test -- agents-observability.service`
Expected: `timeline is not a function`.

- [ ] **Step 3: Implement `timeline` in `agents.service.ts`** (place after `controlTower`):

```ts
  /** Unified per-agent activity/audit timeline (runs + actions + lifecycle audits), newest first. */
  async timeline(tenantId: string, id: string, limit = 50) {
    const agent = await this.prisma.agent.findFirst({ where: { id, tenantId }, select: { id: true } });
    if (!agent) throw new NotFoundException('Agent not found');
    const [runs, actions, audits] = await Promise.all([
      this.prisma.agentRun.findMany({ where: { tenantId, agentId: id }, orderBy: { createdAt: 'desc' }, take: limit, select: { id: true, trigger: true, status: true, taskId: true, createdAt: true } }),
      this.prisma.proposedAction.findMany({ where: { tenantId, agentId: id }, orderBy: { proposedAt: 'desc' }, take: limit, select: { id: true, tool: true, status: true, autoApproved: true, proposedAt: true } }),
      this.prisma.auditLog.findMany({ where: { tenantId, entityType: 'agent', entityId: id }, orderBy: { createdAt: 'desc' }, take: limit, select: { id: true, action: true, after: true, createdAt: true } }),
    ]);
    const runEntries: TimelineEntry[] = runs.map((r) => ({
      at: r.createdAt.toISOString(),
      kind: 'run',
      summary: `Run ${r.trigger} → ${r.status}${r.taskId ? ` (task ${r.taskId})` : ''}`,
      ref: r.id,
    }));
    const actionEntries: TimelineEntry[] = actions.map((a) => ({
      at: a.proposedAt.toISOString(),
      kind: 'action',
      summary: `${a.autoApproved ? 'Auto' : 'Proposé'} ${a.tool} → ${a.status}`,
      ref: a.id,
    }));
    const auditEntries: TimelineEntry[] = audits.map((a) => {
      const after = (a.after ?? {}) as { breakerTripped?: boolean };
      return {
        at: a.createdAt.toISOString(),
        kind: 'lifecycle',
        summary: after.breakerTripped ? 'Circuit breaker déclenché' : `Audit ${a.action}`,
        ref: a.id,
      };
    });
    return mergeTimeline([runEntries, actionEntries, auditEntries], limit);
  }
```

- [ ] **Step 4: Controller endpoint** — in `agents.controller.ts` (with the other `@Get(':id/...')` routes, before `@Get(':id')`):

```ts
  @Get(':id/timeline')
  @RequirePermissions(PERMISSIONS.CORE.AGENTS_READ)
  timeline(@CurrentUser() user: AuthUser, @Param('id') id: string, @Query('limit') limit?: string) {
    return this.agents.timeline(user.tenantId, id, limit ? Number(limit) : 50);
  }
```

- [ ] **Step 5: Run test + build**

Run: `pnpm --filter @pulsar/api test -- agents-observability.service` → PASS (all three describes).
Run: `pnpm --filter @pulsar/api build` → clean.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/core/agents/agents.service.ts apps/api/src/core/agents/agents.controller.ts apps/api/src/core/agents/agents-observability.service.spec.ts
git commit -m "feat(api): GET /agents/:id/timeline — unified activity/audit feed

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Web — `/agents` manager dashboard

**Files:** Modify `apps/web/src/routes/(app)/agents/+page.svelte`.

READ the file first (it loads `api<AgentRow[]>('/agents')` and renders cards with status/autonomy badges). Switch it to the dashboard.

- [ ] **Step 1: Load the control-tower payload**

Replace the `AgentRow`/`load` logic with the dashboard shape. In `<script>`:
```ts
type Kpis = { actions: { total: number; executed: number; pending: number }; approvalRate: number; errorRate: number; breakerTrips: number };
type DashAgent = { id: string; name: string; role: string | null; avatar: string | null; status: string; autonomyLevel?: string; breakerTrippedAt?: string | null; kpis: Kpis };
type Rollup = { agents: number; active: number; paused: number; revoked: number; totalActions: number; pendingApprovals: number; totalBreakerTrips: number; totalTasksResolved: number };
let items = $state<DashAgent[]>([]);
let rollup = $state<Rollup | null>(null);

async function load() {
  loading = true;
  try {
    const data = await api<{ items: DashAgent[]; rollup: Rollup }>('/agents/control-tower');
    items = data.items;
    rollup = data.rollup;
  } catch (e) {
    error = e instanceof ApiError ? e.message : 'Failed to load agents';
  } finally {
    loading = false;
  }
}
```
Keep `pct = (r: number) => `${Math.round(r * 100)}%``.

- [ ] **Step 2: Render the tenant rollup header + KPI-enriched cards**

Above the grid, when `rollup`, render a summary strip (match existing markup/classes — small stat tiles using the page's `Card`/text classes):
```svelte
{#if rollup}
  <div class="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
    <Card><p class="text-xs text-ink-muted">Agents</p><p class="text-xl font-semibold text-ink">{rollup.active}/{rollup.agents} actifs</p></Card>
    <Card><p class="text-xs text-ink-muted">Actions ({'30j'})</p><p class="text-xl font-semibold text-ink">{rollup.totalActions}</p></Card>
    <Card><p class="text-xs text-ink-muted">En attente d'approbation</p><p class="text-xl font-semibold text-ink">{rollup.pendingApprovals}</p></Card>
    <Card><p class="text-xs text-ink-muted">Tâches résolues</p><p class="text-xl font-semibold text-ink">{rollup.totalTasksResolved}</p></Card>
  </div>
{/if}
```
In each agent card (iterate `items` instead of `agents`), keep the existing avatar/name/status/autonomy badges, and add a KPI row:
```svelte
        <div class="mt-2 flex flex-wrap gap-1.5 text-xs">
          <Badge tone="neutral">{agent.kpis.actions.total} actions</Badge>
          <Badge tone="ok">{pct(agent.kpis.approvalRate)} appr.</Badge>
          {#if agent.kpis.errorRate > 0}<Badge tone="danger">{pct(agent.kpis.errorRate)} err.</Badge>{/if}
          {#if agent.breakerTrippedAt}<Badge tone="warn">breaker</Badge>{/if}
        </div>
```
Keep the `revokedAt`/status badge logic (note: control-tower items don't include `revokedAt`; use `status === 'REVOKED'`). Keep the empty/loading states. Keep `RegisterAgentModal` with `onCreated={load}`.

- [ ] **Step 3: Build + typecheck**

Run: `pnpm --filter @pulsar/web build` → clean.
Run: `pnpm --filter @pulsar/web typecheck` → 0 errors.

- [ ] **Step 4: Commit**

```bash
git add "apps/web/src/routes/(app)/agents/+page.svelte"
git commit -m "feat(web): /agents manager dashboard — tenant rollup + KPI cards

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Web — agent detail KPI panel + timeline

**Files:** Modify `apps/web/src/routes/(app)/agents/[id]/+page.svelte`.

READ the file first (phases 13/14 added "Activité 24/7", trust/breaker banners, a `$effect` calling `load()`/`loadRuns()`/`loadTrust()`, and the real `api()` signature). Follow those idioms.

- [ ] **Step 1: Add KPI + timeline state and loaders**

```ts
type Kpis = {
  actions: { total: number; executed: number; autoApproved: number; pending: number; rejected: number; failed: number };
  approvalRate: number; autoApprovalRate: number; errorRate: number;
  runs: { total: number; succeeded: number; failed: number; skipped: number; killed: number };
  avgRunLatencyMs: number | null; breakerTrips: number; tasksResolved: number;
};
type TimelineEntry = { at: string; kind: string; summary: string; ref?: string };
let kpis = $state<Kpis | null>(null);
let timeline = $state<TimelineEntry[]>([]);
const pct = (r: number) => `${Math.round(r * 100)}%`;

async function loadKpis(id: string) {
  try { kpis = await api<Kpis>(`/agents/${id}/kpis`); } catch { kpis = null; }
}
async function loadTimeline(id: string) {
  try { timeline = await api<TimelineEntry[]>(`/agents/${id}/timeline`, { query: { limit: 50 } }); } catch { timeline = []; }
}
```
Call `loadKpis(agentId)` and `loadTimeline(agentId)` from the SAME `$effect` that already calls `load()`/`loadRuns()`/`loadTrust()`.

- [ ] **Step 2: Render a KPI panel + timeline section** (match existing Card markup + French):

```svelte
{#if kpis}
  <section class="...card-section-classes...">
    <h2 class="...">KPI ({'30 derniers jours'})</h2>
    <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <Card><p class="text-xs text-ink-muted">Actions</p><p class="text-xl font-semibold text-ink">{kpis.actions.total}</p></Card>
      <Card><p class="text-xs text-ink-muted">Taux d'approbation</p><p class="text-xl font-semibold text-ink">{pct(kpis.approvalRate)}</p></Card>
      <Card><p class="text-xs text-ink-muted">Auto-approbation</p><p class="text-xl font-semibold text-ink">{pct(kpis.autoApprovalRate)}</p></Card>
      <Card><p class="text-xs text-ink-muted">Taux d'erreur</p><p class="text-xl font-semibold text-ink">{pct(kpis.errorRate)}</p></Card>
      <Card><p class="text-xs text-ink-muted">Runs réussis</p><p class="text-xl font-semibold text-ink">{kpis.runs.succeeded}/{kpis.runs.total}</p></Card>
      <Card><p class="text-xs text-ink-muted">Latence moy.</p><p class="text-xl font-semibold text-ink">{kpis.avgRunLatencyMs == null ? '—' : Math.round(kpis.avgRunLatencyMs) + ' ms'}</p></Card>
      <Card><p class="text-xs text-ink-muted">Tâches résolues</p><p class="text-xl font-semibold text-ink">{kpis.tasksResolved}</p></Card>
      <Card><p class="text-xs text-ink-muted">Trips breaker</p><p class="text-xl font-semibold text-ink">{kpis.breakerTrips}</p></Card>
    </div>
  </section>
{/if}

<section class="...card-section-classes...">
  <h2 class="...">Timeline</h2>
  {#if timeline.length === 0}
    <p class="text-sm text-ink-faint">Aucune activité.</p>
  {:else}
    <ul class="divide-y divide-edge">
      {#each timeline as t (t.kind + t.ref + t.at)}
        <li class="flex items-center justify-between py-2 text-sm">
          <span><Badge tone="neutral">{t.kind}</Badge> {t.summary}</span>
          <span class="text-ink-faint">{formatDateTime(t.at)}</span>
        </li>
      {/each}
    </ul>
  {/if}
</section>
```
Use the page's actual section/Card classes (copy from the existing "Activité 24/7" section). `formatDateTime` is already imported.

- [ ] **Step 3: Build + typecheck**

Run: `pnpm --filter @pulsar/web build` → clean.
Run: `pnpm --filter @pulsar/web typecheck` → 0 errors.

- [ ] **Step 4: Commit**

```bash
git add "apps/web/src/routes/(app)/agents/[id]/+page.svelte"
git commit -m "feat(web): agent detail KPI panel + activity timeline

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Phase-15a e2e

**Files:** Create `apps/api/test/phase15a-control-tower.e2e-spec.ts`.

Reuse the phase-14 e2e bootstrap (read `apps/api/test/phase14-autonomy.e2e-spec.ts`): build the app, login admin@pulsar.dev/admin123 tenant acme, resolve tenantId, the token-minting `/api/v1/mcp` driver + `parseMcp`, and the `afterAll` cleanup. This suite SEEDS data then reads it back via the new endpoints.

- [ ] **Step 1: Implement the scenarios**

Setup (in `beforeAll` after login): register an agent with `caps.policies=[{tool:'create_load', effect:'AUTO'}]` (so a create_load auto-executes), plus permissions for create_load/tender_load. Then generate a known fixture state directly (prefer direct `prisma` writes for determinism, OR drive `/mcp` for the auto-execute path):
- Drive one `create_load` via `/mcp` → an EXECUTED autoApproved ProposedAction.
- Insert (via `app.get(PrismaService)`) for the agent: 1 more EXECUTED (autoApproved:false), 1 REJECTED, 1 FAILED ProposedAction; 1 SUCCEEDED + 1 FAILED AgentRun (with startedAt/finishedAt 200ms apart); 1 RESOLVED OperationalTask assigned to the agent; 1 AuditLog `{entityType:'agent', entityId:<agentId>, action:'UPDATE', after:{breakerTripped:true}}`.

Scenarios (use the seeded agentId; assert via the endpoints with the admin token):
1. `GET /api/v1/agents/:id/kpis` → `actions.executed >= 2`, `actions.rejected >= 1`, `actions.failed >= 1`, `breakerTrips >= 1`, `tasksResolved >= 1`, `avgRunLatencyMs` is a number, `approvalRate`/`errorRate` in [0,1].
2. `GET /api/v1/agents/control-tower` → `body.items` includes the agent; `body.rollup.agents >= 1`, `rollup.totalBreakerTrips >= 1`, `rollup.pendingApprovals` numeric.
3. `GET /api/v1/agents/:id/timeline?limit=50` → array, sorted desc by `at` (assert `out[i].at >= out[i+1].at`), contains at least one `run`, one `action`, and one `lifecycle` entry.
4. Projection: none of the three responses' serialized bodies contain `secretHash` or `serviceUserId`.
5. Tenant isolation: `control-tower` items all belong to the acme tenant (the seeded agent appears; no foreign-tenant agent). (If seeding a second tenant is heavy, assert the seeded agent is present and every item has the expected shape — the per-query `tenantId` filter is unit-covered.)

- [ ] **Step 2: Run (DB up + seeded)**

Run: `pnpm db:migrate && pnpm db:seed` if needed, then `pnpm --filter @pulsar/api test:e2e -- phase15a-control-tower` → all pass. Run 2× for determinism (afterAll cleanup deletes the agent's proposedAction/agentRun/auditLog/task rows + the agent).

Then regression: `pnpm --filter @pulsar/api test:e2e -- phase12-operating-workbench phase13-workforce phase14-autonomy phase15a-control-tower` → all pass.

- [ ] **Step 3: Commit**

```bash
git add apps/api/test/phase15a-control-tower.e2e-spec.ts
git commit -m "test(api): phase-15a e2e — KPIs, control-tower rollup, timeline, projection/isolation

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Rule 30 + docs + full verification

**Files:** `CLAUDE.md`, `ROADMAP.md`, `docs/etat-du-projet.md`.

- [ ] **Step 1: Hard rule 30 in `CLAUDE.md`** — after the phase-14 rule 29 block:

```markdown
## Hard rules (continued, phase 15)

30. (phase 15 — Control Tower observabilité) Les KPI, rollups et timeline du Control Tower sont
    calculés **à la lecture** depuis `AgentRun`/`ProposedAction`/`OperationalTask`/`AuditLog`
    (aucun store de rollup, aucune migration) ; les calculs de ratio/fusion vivent dans
    `@pulsar/shared` (`deriveAgentKpis`, `mergeTimeline` — purs) ; le compteur de trips de breaker
    vient des `AuditLog` `entityType='agent'` / `after.breakerTripped=true` (alimente aussi le
    `breakerTrips` du trust score) ; toute projection agent/KPI exclut `secretHash`/`serviceUserId`
    (règle 26) et reste scopée `tenantId` (règle 1).
```

- [ ] **Step 2: `ROADMAP.md`** — update the phase 15 bullet: mark the observability slice shipped, e.g. `✅ **15-A — Control Tower (observabilité)**` with a one-line summary (per-agent KPIs, tenant manager dashboard, unified timeline, breaker-trip count feeding trust; no migration), and note `15-B red-team` + `15-C playbooks` remain as separate slices. Match the phase-14 entry style.

- [ ] **Step 3: `docs/etat-du-projet.md`** — note 15-A shipped (observability); migrations unchanged (still 23); next = 15-B/15-C or pivot to Acte II (phase 16 Freight Audit). Match the doc's format.

- [ ] **Step 4: Full verification**

```bash
pnpm build
pnpm test
pnpm --filter @pulsar/api test:e2e -- phase12-operating-workbench phase13-workforce phase14-autonomy phase15a-control-tower
```
All must pass (build shared→database→api→web; all unit suites incl. the new kpis/timeline/observability specs; e2e green). If anything fails, STOP and report BLOCKED with the exact output (docs-only edits fine; don't force code to pass).

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md ROADMAP.md docs/etat-du-projet.md
git commit -m "docs(phase-15a): hard rule 30 + roadmap/status — Control Tower observability shipped

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review (completed during planning)

**Spec coverage:**
- Per-agent KPI rollup (actions, approval/auto/error rates, runs, latency, breakerTrips, tasksResolved) → Tasks 1 + 3. ✅
- Manager dashboard (per-agent summaries + tenant rollup) → Task 4. ✅
- Unified activity/audit timeline → Tasks 2 + 5. ✅
- Phase-14 debt (real breakerTrips in trust) → Task 3. ✅
- Compute-on-read, no table/migration → all API tasks query existing models; no Prisma schema change anywhere. ✅
- Web dashboard + per-agent panels → Tasks 6 + 7. ✅
- Rule 30 → Task 9. ✅
- Tests: pure unit (kpis/timeline) + service unit + e2e (kpis/control-tower/timeline/projection/isolation) → Tasks 1,2,3,4,5,8. ✅

**Placeholder scan:** Web tasks reference "...card-section-classes..." as a directive to copy the existing section's real classes (the implementer reads the file first) — not a code placeholder in logic. All logic/code blocks are complete. Task 8 allows direct-prisma seeding for deterministic fixtures (explicit, not vague).

**Type consistency:** `AgentKpiRaw`/`AgentKpis`/`deriveAgentKpis` (Task 1) consumed by `gatherKpiRaw`/`kpis`/`controlTower` (Tasks 3,4). `TimelineEntry`/`mergeTimeline` (Task 2) consumed by `timeline` (Task 5). `breakerTripCount` (Task 3) reused by `gatherKpiRaw` and `trust`. Endpoint names (`kpis`/`control-tower`/`timeline`) consistent between controller (Tasks 3,4,5) and web (Tasks 6,7) and e2e (Task 8).

**Known acceptable items:** `controlTower` runs N×(~13 queries) for N agents — acceptable for modest agent counts, documented; optimize later if needed. The `AuditLog` JSON-path filter (`after: { path: ['breakerTripped'], equals: true }`) is Postgres/Prisma-supported; if the running Prisma version rejects the syntax, fall back to counting `entityType='agent' AND action='UPDATE'` for the agent (breaker trip is currently the only such audit) — note in the implementer's report if the fallback is used.
```
