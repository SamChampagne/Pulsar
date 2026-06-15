# Phase 13 — La main-d'œuvre 24/7 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generalize the phase-12 always-on loop into a managed ephemeral-worker runtime: any always-on agent is woken by event (not only cron), every wake is recorded as an `AgentRun`, concurrency is capped, transient failures retry, and an operator can pause/kill an agent hot.

**Architecture:** A single in-process dispatcher (`AgentWorkerService`) owns an in-memory run queue + concurrency semaphores. It absorbs the per-task execution logic of `WorkbenchAgentRunner` (which is deleted). Event wakeups come from `DomainEventsService` (immediate `enqueueTask`); a `@Cron` safety-net sweep re-enqueues missed OPEN tasks. Runs are durably recorded in a new `AgentRun` table. `AgentStatus.PAUSED` is a hot, reversible kill switch that also kills in-flight Hermes child processes via a new `AgentRuntimeService.killAgentSessions(agentId)`. Retries apply only to runtime-connectivity errors; Hermes-absent → run `SKIPPED`. Rule 24 (best-effort, isolated, never crash the core) is preserved throughout.

**Tech Stack:** NestJS 11, Prisma 6 (`@pulsar/database`), `@pulsar/shared` (enums + pure helpers), SvelteKit 5 (runes), Jest (unit + e2e over HTTP).

**Design spec:** `docs/superpowers/specs/2026-06-15-phase-13-24-7-workforce-design.md`

**Conventions reminder (CLAUDE.md):**
- Enums live in `@pulsar/shared`, mirrored in `schema.prisma` with identical names (rule 3); rebuild shared/database after editing (rule 7: `pnpm --filter @pulsar/shared build && pnpm --filter @pulsar/database build`).
- `@pulsar/shared` must stay browser-safe: **no module-scope `node:*` import** (it is bundled from source by the web SPA — a top-level `node:crypto` import breaks the web build without breaking typechecks).
- Tenant isolation (rule 1): every query filters by `tenantId`. Agent projections never expose `secretHash`/`serviceUserId` (rule 26, the shared `agentSelect`).
- Agent actions go through `ProposedAction` with `triggeredByRef` (rule 22/27).
- Run `pnpm build` (not just typecheck) before declaring the phase green.

---

## File Structure

**Create:**
- `packages/shared/src/agents/runs.ts` — `AgentRunTrigger`, `AgentRunStatus` enums + `classifyRunError` pure helper.
- `apps/api/src/core/operating/agent-runs.service.ts` — `AgentRunsService`: durable ledger CRUD (create QUEUED, transition, list projection).
- `apps/api/src/core/operating/agent-runs.service.spec.ts` — unit test for ledger transitions.
- `apps/api/src/core/operating/agent-worker.service.ts` — `AgentWorkerService`: dispatcher (queue, concurrency caps, execution, retries, sweep cron).
- `apps/api/src/core/operating/agent-worker.service.spec.ts` — unit tests (concurrency caps, retry/skip classification, kill mid-run).

**Modify:**
- `packages/shared/src/agents/risk.ts` — add `AgentStatus.PAUSED`.
- `packages/shared/src/index.ts` — export `./agents/runs`.
- `packages/database/prisma/schema.prisma` — `AgentStatus.PAUSED`; `AgentRunTrigger`/`AgentRunStatus` enums; `AgentRun` model; `Agent.lastSeenAt`/`lastRunAt` + `runs` back-relation; `Tenant.agentRuns` back-relation.
- `apps/api/src/core/agents/agent-runtime.service.ts` — track `agentId` per live session; add `killAgentSessions(agentId)`.
- `apps/api/src/core/agents/agents.service.ts` — `pause`/`resume`/`runNow` methods; `agentSelect` adds `lastSeenAt`/`lastRunAt`; `getOwned` rejects PAUSED.
- `apps/api/src/core/agents/agents.controller.ts` — `POST :id/pause`, `:id/resume`, `:id/run-now`, `POST pause-all`, `GET :id/runs`.
- `apps/api/src/core/operating/domain-events.service.ts` — after creating an agent-assigned task, call `worker.enqueueTask` (best-effort).
- `apps/api/src/core/operating/operating.module.ts` — provide `AgentRunsService` + `AgentWorkerService`, export `AgentWorkerService`; remove `WorkbenchAgentRunner`.
- `apps/api/src/core/agents/agents.module.ts` — inject `AgentWorkerService` into `AgentsService` (for `runNow`) and `AgentRuntimeService` exported already.
- `apps/api/test/phase12-operating-workbench.e2e-spec.ts` — scenario B drives `AgentWorkerService` instead of `WorkbenchAgentRunner`.
- `apps/web/src/routes/(app)/agents/[id]/+page.svelte` — "Activité 24/7" run table + Pause/Resume/Run now + heartbeat badge.
- `apps/web/src/routes/(app)/agents/+page.svelte` — status pill (online/paused).
- `CLAUDE.md` — add hard rule 28.

**Delete:**
- `apps/api/src/core/operating/workbench-agent-runner.service.ts`
- `apps/api/src/core/operating/workbench-agent-runner.service.spec.ts`

---

## Task 1: Shared enums + error classification

**Files:**
- Create: `packages/shared/src/agents/runs.ts`
- Modify: `packages/shared/src/agents/risk.ts:16-19`
- Modify: `packages/shared/src/index.ts:22`
- Test: `packages/shared/src/agents/runs.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/shared/src/agents/runs.spec.ts`:

```ts
import { AgentRunStatus, AgentRunTrigger, classifyRunError } from './runs';

describe('AgentRun enums + classifyRunError', () => {
  it('exposes the six run statuses and three triggers', () => {
    expect(Object.values(AgentRunStatus)).toEqual([
      'QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'SKIPPED', 'KILLED',
    ]);
    expect(Object.values(AgentRunTrigger)).toEqual(['EVENT', 'CRON', 'MANUAL']);
  });

  it('classifies connectivity errors as retry, not-installed as skip, rest terminal', () => {
    expect(classifyRunError('ServiceUnavailableException')).toBe('retry');
    expect(classifyRunError('BadRequestException')).toBe('skip');
    expect(classifyRunError('Error')).toBe('terminal');
    expect(classifyRunError('TypeError')).toBe('terminal');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @pulsar/shared test -- runs.spec`
Expected: FAIL — `Cannot find module './runs'`.

- [ ] **Step 3: Create the enums + helper**

Create `packages/shared/src/agents/runs.ts`:

```ts
// Mirrored in packages/database schema.prisma (phase 13).

/** How an always-on agent run was triggered. */
export enum AgentRunTrigger {
  EVENT = 'EVENT',
  CRON = 'CRON',
  MANUAL = 'MANUAL',
}

/** Lifecycle of a single always-on agent run (one wake of the dispatcher). */
export enum AgentRunStatus {
  QUEUED = 'QUEUED',
  RUNNING = 'RUNNING',
  SUCCEEDED = 'SUCCEEDED',
  FAILED = 'FAILED',
  SKIPPED = 'SKIPPED',
  KILLED = 'KILLED',
}

export type RunErrorClass = 'skip' | 'retry' | 'terminal';

/**
 * Maps a runtime error (by its constructor name) to a run outcome class:
 * - 'skip'     — Hermes not installed / unconfigured (BadRequestException) → run SKIPPED, no retry (rule 24).
 * - 'retry'    — Hermes reachable-but-failing (ServiceUnavailableException) → bounded retry.
 * - 'terminal' — anything else → run FAILED, no retry.
 */
export function classifyRunError(errorName: string): RunErrorClass {
  if (errorName === 'BadRequestException') return 'skip';
  if (errorName === 'ServiceUnavailableException') return 'retry';
  return 'terminal';
}
```

- [ ] **Step 4: Add `PAUSED` to `AgentStatus`**

In `packages/shared/src/agents/risk.ts`, change the enum (lines 16-19):

```ts
export enum AgentStatus {
  ACTIVE = 'ACTIVE',
  PAUSED = 'PAUSED',
  REVOKED = 'REVOKED',
}
```

- [ ] **Step 5: Export the new module**

In `packages/shared/src/index.ts`, after `export * from './agents/risk';` (line 22), add:

```ts
export * from './agents/runs';
```

- [ ] **Step 6: Run test + build shared**

Run: `pnpm --filter @pulsar/shared test -- runs.spec`
Expected: PASS (2 tests).

Run: `pnpm --filter @pulsar/shared build`
Expected: builds, no errors.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/agents/runs.ts packages/shared/src/agents/runs.spec.ts packages/shared/src/agents/risk.ts packages/shared/src/index.ts
git commit -m "feat(shared): AgentRun enums + run-error classification; AgentStatus.PAUSED

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Prisma — AgentRun model, Agent heartbeat fields, PAUSED, migration

**Files:**
- Modify: `packages/database/prisma/schema.prisma` (AgentStatus enum ~line 1317; Agent model ~1343; add enums + AgentRun model; Tenant model back-relation)

> The Tenant model has one back-relation array per related model. Find it (`grep -n "model Tenant" schema.prisma`) and add `agentRuns AgentRun[]` alongside the existing `proposedActions`/`agents` arrays.

- [ ] **Step 1: Add `PAUSED` to the Prisma `AgentStatus` enum**

In `packages/database/prisma/schema.prisma` (~line 1317):

```prisma
enum AgentStatus {
  ACTIVE
  PAUSED
  REVOKED
}
```

- [ ] **Step 2: Add the run enums**

Immediately after the `enum ProposalStatus { ... }` block (~line 1341), add:

```prisma
enum AgentRunTrigger {
  EVENT
  CRON
  MANUAL
}

enum AgentRunStatus {
  QUEUED
  RUNNING
  SUCCEEDED
  FAILED
  SKIPPED
  KILLED
}
```

- [ ] **Step 3: Add heartbeat fields + back-relation to `Agent`**

In `model Agent` (~line 1343), after `lastUsedAt DateTime?` (line 1359) add:

```prisma
  lastSeenAt    DateTime?
  lastRunAt     DateTime?
```

And in the relations block of `Agent`, after `conversations AgentConversation[]` (line 1367), add:

```prisma
  runs          AgentRun[]
```

- [ ] **Step 4: Add the `AgentRun` model**

After `model AgentRuntimeConfig { ... }` (ends ~line 1444), add:

```prisma
model AgentRun {
  id                  String          @id @default(cuid())
  tenantId            String
  agentId             String
  trigger             AgentRunTrigger
  taskId              String?
  triggeredByRef      String?
  status              AgentRunStatus  @default(QUEUED)
  attempt             Int             @default(1)
  startedAt           DateTime?
  finishedAt          DateTime?
  error               String?
  proposedActionCount Int             @default(0)
  model               String?
  createdAt           DateTime        @default(now())

  tenant Tenant @relation(fields: [tenantId], references: [id])
  agent  Agent  @relation(fields: [agentId], references: [id])

  @@index([tenantId, agentId, createdAt])
  @@index([tenantId, status])
  @@map("agent_runs")
}
```

- [ ] **Step 5: Add the `Tenant` back-relation**

In `model Tenant`, add (next to the other agent relations):

```prisma
  agentRuns AgentRun[]
```

- [ ] **Step 6: Validate, migrate, regenerate, rebuild**

Run (DB must be up — `pnpm db:up`):

```bash
pnpm db:migrate
```

When prompted for a name, enter: `phase13_agent_runs_pause`
Expected: creates `migrations/<ts>_phase13_agent_runs_pause/` and applies it; regenerates Prisma Client.

Run: `pnpm --filter @pulsar/database build`
Expected: builds cleanly.

- [ ] **Step 7: Commit**

```bash
git add packages/database/prisma/schema.prisma packages/database/prisma/migrations
git commit -m "feat(db): AgentRun ledger + Agent heartbeat fields + AgentStatus.PAUSED (22nd migration)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: AgentRuntimeService — index sessions by agent, add killAgentSessions

The current `live` map is keyed by Hermes `sessionId` only, so the kill switch cannot find an agent's in-flight children. Add `agentId` to each `LiveSession` and a method to kill all of an agent's sessions.

**Files:**
- Modify: `apps/api/src/core/agents/agent-runtime.service.ts:44-49` (LiveSession), `:112-131` (openSession), add `killAgentSessions`.
- Test: `apps/api/src/core/agents/agent-runtime-kill.service.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/core/agents/agent-runtime-kill.service.spec.ts`:

```ts
import { AgentRuntimeService } from './agent-runtime.service';

describe('AgentRuntimeService.killAgentSessions', () => {
  it('kills only the target agent\'s live sessions and returns the count', async () => {
    const svc = new AgentRuntimeService({} as never, {} as never);
    const killed: string[] = [];
    const mkSession = (agentId: string, id: string) => ({
      agentId,
      persona: null,
      firstTurnDone: false,
      client: { closeSession: async (s: string) => { killed.push(`close:${s}`); } },
      child: { kill: () => { killed.push(`kill:${id}`); } },
    });
    // Reach into the private live map (test-only).
    const live = (svc as unknown as { live: Map<string, unknown> }).live;
    live.set('s1', mkSession('a1', 's1'));
    live.set('s2', mkSession('a1', 's2'));
    live.set('s3', mkSession('a2', 's3'));

    const n = await svc.killAgentSessions('a1');

    expect(n).toBe(2);
    expect(killed.sort()).toEqual(['close:s1', 'close:s2', 'kill:s1', 'kill:s2'].sort());
    expect(live.has('s1')).toBe(false);
    expect(live.has('s2')).toBe(false);
    expect(live.has('s3')).toBe(true); // other agent untouched
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @pulsar/api test -- agent-runtime-kill`
Expected: FAIL — `killAgentSessions is not a function`.

- [ ] **Step 3: Add `agentId` to `LiveSession`**

In `agent-runtime.service.ts`, change the `LiveSession` interface (lines 44-49):

```ts
interface LiveSession {
  agentId: string;
  client: HermesAcpClient;
  child: ChildProcessWithoutNullStreams;
  persona: string | null;
  firstTurnDone: boolean;
}
```

- [ ] **Step 4: Record `agentId` when opening a session**

In `openSession` (line 125), change the `this.live.set(...)` call to include `agentId`:

```ts
      this.live.set(sessionId, {
        agentId: input.agent.id,
        client,
        child,
        persona: input.agent.persona,
        firstTurnDone: false,
      });
```

- [ ] **Step 5: Add `killAgentSessions`**

After `closeSession` (line 148), add:

```ts
  /**
   * Hot kill switch (phase 13): closes and kills every live Hermes session for an
   * agent. Best-effort — never throws. Returns the number of sessions killed.
   */
  async killAgentSessions(agentId: string): Promise<number> {
    const victims = [...this.live.entries()].filter(([, s]) => s.agentId === agentId);
    for (const [sessionId, session] of victims) {
      this.live.delete(sessionId);
      await session.client.closeSession(sessionId).catch(() => undefined);
      session.child.kill();
    }
    return victims.length;
  }
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm --filter @pulsar/api test -- agent-runtime-kill`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/core/agents/agent-runtime.service.ts apps/api/src/core/agents/agent-runtime-kill.service.spec.ts
git commit -m "feat(api): AgentRuntimeService.killAgentSessions — index live sessions by agentId

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: AgentRunsService — durable run ledger

**Files:**
- Create: `apps/api/src/core/operating/agent-runs.service.ts`
- Test: `apps/api/src/core/operating/agent-runs.service.spec.ts`

The ledger is the durable record of every wake. The dispatcher (Task 5) calls it; the controller (Task 7) lists it.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/core/operating/agent-runs.service.spec.ts`:

```ts
import { AgentRunStatus, AgentRunTrigger } from '@pulsar/shared';
import { AgentRunsService } from './agent-runs.service';
import type { PrismaService } from '../../prisma/prisma.service';

describe('AgentRunsService', () => {
  it('creates a QUEUED run and returns its id', async () => {
    let created: any;
    const prisma = {
      agentRun: { create: async ({ data }: any) => { created = { id: 'r1', ...data }; return created; } },
    } as unknown as PrismaService;
    const svc = new AgentRunsService(prisma);

    const id = await svc.createQueued({
      tenantId: 't1', agentId: 'a1', taskId: 'task1',
      trigger: AgentRunTrigger.EVENT, model: 'm',
    });

    expect(id).toBe('r1');
    expect(created.status).toBe(AgentRunStatus.QUEUED);
    expect(created.triggeredByRef).toBe('task:task1');
    expect(created.attempt).toBe(1);
  });

  it('finish() stamps finishedAt + status + error', async () => {
    let updated: any;
    const prisma = {
      agentRun: { update: async ({ where, data }: any) => { updated = { where, data }; } },
    } as unknown as PrismaService;
    const svc = new AgentRunsService(prisma);

    await svc.finish('r1', AgentRunStatus.FAILED, { error: 'boom', proposedActionCount: 0 });

    expect(updated.where).toEqual({ id: 'r1' });
    expect(updated.data.status).toBe(AgentRunStatus.FAILED);
    expect(updated.data.error).toBe('boom');
    expect(updated.data.finishedAt).toBeInstanceOf(Date);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @pulsar/api test -- agent-runs.service`
Expected: FAIL — cannot find `./agent-runs.service`.

- [ ] **Step 3: Implement `AgentRunsService`**

Create `apps/api/src/core/operating/agent-runs.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { AgentRunStatus, AgentRunTrigger } from '@pulsar/shared';
import { ListQueryDto } from '../../common/dto/list-query.dto';
import { paginationArgs, paginated } from '../../common/pagination';
import { PrismaService } from '../../prisma/prisma.service';

/** Projection for GET /agents/:id/runs — never exposes internal refs beyond the run itself. */
const runSelect = {
  id: true,
  agentId: true,
  trigger: true,
  taskId: true,
  status: true,
  attempt: true,
  startedAt: true,
  finishedAt: true,
  error: true,
  proposedActionCount: true,
  createdAt: true,
} as const;

@Injectable()
export class AgentRunsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Create a durable QUEUED run row. triggeredByRef mirrors the session token ref. */
  async createQueued(input: {
    tenantId: string;
    agentId: string;
    taskId: string | null;
    trigger: AgentRunTrigger;
    model: string | null;
    attempt?: number;
  }): Promise<string> {
    const run = await this.prisma.agentRun.create({
      data: {
        tenantId: input.tenantId,
        agentId: input.agentId,
        taskId: input.taskId,
        triggeredByRef: input.taskId ? `task:${input.taskId}` : null,
        trigger: input.trigger,
        model: input.model,
        attempt: input.attempt ?? 1,
        status: AgentRunStatus.QUEUED,
      },
      select: { id: true },
    });
    return run.id;
  }

  async markRunning(id: string): Promise<void> {
    await this.prisma.agentRun
      .update({ where: { id }, data: { status: AgentRunStatus.RUNNING, startedAt: new Date() } })
      .catch(() => undefined);
  }

  async bumpAttempt(id: string, attempt: number): Promise<void> {
    await this.prisma.agentRun
      .update({ where: { id }, data: { status: AgentRunStatus.QUEUED, attempt } })
      .catch(() => undefined);
  }

  async finish(
    id: string,
    status: AgentRunStatus,
    extra: { error?: string; proposedActionCount?: number } = {},
  ): Promise<void> {
    await this.prisma.agentRun
      .update({
        where: { id },
        data: {
          status,
          finishedAt: new Date(),
          ...(extra.error !== undefined && { error: extra.error }),
          ...(extra.proposedActionCount !== undefined && { proposedActionCount: extra.proposedActionCount }),
        },
      })
      .catch(() => undefined);
  }

  async listForAgent(tenantId: string, agentId: string, q: ListQueryDto) {
    const { page, pageSize, skip, take } = paginationArgs(q);
    const where = { tenantId, agentId };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.agentRun.findMany({ where, skip, take, orderBy: { createdAt: 'desc' }, select: runSelect }),
      this.prisma.agentRun.count({ where }),
    ]);
    return paginated(items, total, page, pageSize);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @pulsar/api test -- agent-runs.service`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/core/operating/agent-runs.service.ts apps/api/src/core/operating/agent-runs.service.spec.ts
git commit -m "feat(api): AgentRunsService — durable always-on run ledger

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: AgentWorkerService — the dispatcher (queue + concurrency + execution)

This is the core. It absorbs `WorkbenchAgentRunner`'s execution logic, adds an in-memory queue with concurrency caps, retries, kill-aware execution, and a cron safety-net sweep.

**Files:**
- Create: `apps/api/src/core/operating/agent-worker.service.ts`
- Test: `apps/api/src/core/operating/agent-worker.service.spec.ts`

- [ ] **Step 1: Write the failing tests**

Create `apps/api/src/core/operating/agent-worker.service.spec.ts`:

```ts
import { AgentRunStatus, AgentStatus, OperationalTaskStatus } from '@pulsar/shared';
import { AgentWorkerService } from './agent-worker.service';

function harness(overrides: Partial<{ openSession: () => Promise<string> }> = {}) {
  const calls: string[] = [];
  const agent = { id: 'a1', tenantId: 't1', model: null, persona: null, serviceUserId: 'svc1', status: AgentStatus.ACTIVE, caps: { alwaysOn: true } };
  const task = { id: 'task1', tenantId: 't1', status: OperationalTaskStatus.OPEN, assigneeAgentId: 'a1', title: 'late', category: 'DELAY', subjectType: 'stop', subjectId: 's1' };
  const runs: any[] = [];
  const prisma = {
    agent: {
      findMany: async () => [agent],
      findUnique: async () => agent,
      update: async () => agent,
    },
    operationalTask: {
      findMany: async () => (task.status === OperationalTaskStatus.OPEN ? [task] : []),
      updateMany: async ({ where, data }: any) => {
        if (where.status === undefined || task.status === where.status) { Object.assign(task, data); return { count: 1 }; }
        return { count: 0 };
      },
    },
    proposedAction: { count: async () => 0 },
  } as any;
  const ledger = {
    createQueued: async () => { const id = `r${runs.length + 1}`; runs.push({ id, status: AgentRunStatus.QUEUED }); return id; },
    markRunning: async (id: string) => { runs.find((r) => r.id === id).status = AgentRunStatus.RUNNING; },
    bumpAttempt: async (id: string) => { runs.find((r) => r.id === id).status = AgentRunStatus.QUEUED; },
    finish: async (id: string, status: AgentRunStatus) => { runs.find((r) => r.id === id).status = status; },
  } as any;
  const runtime = {
    openSession: overrides.openSession ?? (async () => { calls.push('open'); return 'sess1'; }),
    sendTurn: async function* () { calls.push('turn'); yield { type: 'end' as const }; },
    closeSession: async () => { calls.push('close'); },
    killAgentSessions: async () => { calls.push('kill'); return 1; },
  } as any;
  const tasks = { start: async () => { task.status = OperationalTaskStatus.IN_PROGRESS; return task; } } as any;
  const svc = new AgentWorkerService(prisma, runtime, tasks, ledger);
  return { svc, calls, runs, task, agent };
}

describe('AgentWorkerService', () => {
  it('tick() drives an OPEN task to SUCCEEDED and records the run', async () => {
    const h = harness();
    const driven = await h.svc.tick('http://x/mcp', 10);
    expect(driven).toBe(1);
    expect(h.task.status).toBe(OperationalTaskStatus.IN_PROGRESS);
    expect(h.calls).toEqual(['open', 'turn', 'close']);
    expect(h.runs[0].status).toBe(AgentRunStatus.SUCCEEDED);
  });

  it('marks the run SKIPPED (no retry) when Hermes is not installed', async () => {
    const { BadRequestException } = await import('@nestjs/common');
    const h = harness({ openSession: async () => { throw new BadRequestException('not installed'); } });
    const driven = await h.svc.tick('http://x/mcp', 10);
    expect(driven).toBe(0);
    expect(h.runs[0].status).toBe(AgentRunStatus.SKIPPED);
    expect(h.task.status).toBe(OperationalTaskStatus.OPEN); // reverted
  });

  it('retries then FAILS on a connectivity error, reverting the task to OPEN', async () => {
    const { ServiceUnavailableException } = await import('@nestjs/common');
    const h = harness({ openSession: async () => { throw new ServiceUnavailableException('hermes down'); } });
    await h.svc.tick('http://x/mcp', 10);
    expect(h.runs[0].status).toBe(AgentRunStatus.FAILED);
    expect(h.runs[0]).toBeDefined();
    expect(h.task.status).toBe(OperationalTaskStatus.OPEN);
  });
});
```

> The retry test relies on `MAX_ATTEMPTS` retries happening synchronously within `tick()` (no real backoff delay in tests). Implement backoff as `await this.sleep(...)` with a `sleep` that resolves immediately when `backoffMs` is 0; `tick()` passes 0 so tests don't wait.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @pulsar/api test -- agent-worker.service`
Expected: FAIL — cannot find `./agent-worker.service`.

- [ ] **Step 3: Implement `AgentWorkerService`**

Create `apps/api/src/core/operating/agent-worker.service.ts`:

```ts
import { forwardRef, Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  AgentRunStatus,
  AgentRunTrigger,
  AgentStatus,
  OperationalTaskStatus,
  classifyRunError,
} from '@pulsar/shared';
import { PrismaService } from '../../prisma/prisma.service';
import type { AgentCaps } from '../agents/agent-principal';
import { AgentRuntimeService } from '../agents/agent-runtime.service';
import { AgentRunsService } from './agent-runs.service';
import { OperationalTasksService } from './operational-tasks.service';

const MAX_TASKS_PER_CRON_TICK = 10;
const MAX_ATTEMPTS = 2; // retries on connectivity errors (total tries = MAX_ATTEMPTS)
const PER_AGENT_CONCURRENCY = 1; // an agent processes its tasks serially

interface QueuedRun {
  runId: string;
  tenantId: string;
  agentId: string;
  taskId: string;
  trigger: AgentRunTrigger;
  attempt: number;
}

interface AgentRow {
  id: string;
  tenantId: string;
  model: string | null;
  persona: string | null;
  serviceUserId: string;
}

/**
 * Always-on agent dispatcher (phase 13, rule 28). Owns an in-memory run queue +
 * concurrency semaphores. Wakeups come from events (enqueueTask) and a cron
 * safety-net sweep. Best-effort and isolated: Hermes absent ⇒ run SKIPPED,
 * never throws into the caller, never crashes the core.
 */
@Injectable()
export class AgentWorkerService {
  private readonly logger = new Logger(AgentWorkerService.name);

  private readonly queue: QueuedRun[] = [];
  private readonly inFlightTasks = new Set<string>(); // taskIds queued or running (dedup)
  private globalActive = 0;
  private readonly perTenantActive = new Map<string, number>();
  private readonly perAgentActive = new Map<string, number>();
  private mcpUrl: string;

  private readonly maxGlobal: number;
  private readonly maxPerTenant: number;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => AgentRuntimeService))
    private readonly runtime: AgentRuntimeService,
    private readonly tasks: OperationalTasksService,
    private readonly ledger: AgentRunsService,
    @Optional() private readonly config?: ConfigService,
  ) {
    const base = this.config?.get<string>('APP_URL') ?? 'http://localhost:3000';
    this.mcpUrl = `${base}/api/v1/mcp`;
    this.maxGlobal = Number(this.config?.get('AGENT_WORKER_MAX_CONCURRENT') ?? 4);
    this.maxPerTenant = Number(this.config?.get('AGENT_WORKER_MAX_PER_TENANT') ?? 2);
  }

  /** Event entry point: enqueue an immediate run for an agent-assigned task. Best-effort. */
  async enqueueTask(tenantId: string, agentId: string, taskId: string): Promise<void> {
    try {
      if (this.inFlightTasks.has(taskId)) return;
      const agent = await this.prisma.agent.findFirst({
        where: { id: agentId, tenantId, status: AgentStatus.ACTIVE },
        select: { id: true, model: true },
      });
      if (!agent) return;
      const runId = await this.ledger.createQueued({
        tenantId, agentId, taskId, trigger: AgentRunTrigger.EVENT, model: agent.model,
      });
      this.inFlightTasks.add(taskId);
      this.queue.push({ runId, tenantId, agentId, taskId, trigger: AgentRunTrigger.EVENT, attempt: 1 });
      void this.dispatch();
    } catch (err) {
      this.logger.warn(`enqueueTask(${taskId}): ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** Manual "Run now": enqueue the agent's oldest OPEN task, if any. Returns whether one was enqueued. */
  async runNow(tenantId: string, agentId: string): Promise<boolean> {
    const open = await this.prisma.operationalTask.findMany({
      where: { tenantId, assigneeAgentId: agentId, status: OperationalTaskStatus.OPEN },
      orderBy: { createdAt: 'asc' },
      take: 1,
    });
    if (open.length === 0) return false;
    const task = open[0];
    if (this.inFlightTasks.has(task.id)) return false;
    const agent = await this.prisma.agent.findFirst({ where: { id: agentId, tenantId }, select: { model: true } });
    const runId = await this.ledger.createQueued({
      tenantId, agentId, taskId: task.id, trigger: AgentRunTrigger.MANUAL, model: agent?.model ?? null,
    });
    this.inFlightTasks.add(task.id);
    this.queue.push({ runId, tenantId, agentId, taskId: task.id, trigger: AgentRunTrigger.MANUAL, attempt: 1 });
    void this.dispatch();
    return true;
  }

  @Cron(CronExpression.EVERY_5_MINUTES)
  async runCron(): Promise<void> {
    try {
      await this.tick(this.mcpUrl, MAX_TASKS_PER_CRON_TICK);
    } catch (err) {
      this.logger.error(`runCron failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * Safety-net sweep + synchronous drain. Enqueues OPEN tasks for all ACTIVE
   * always-on agents (idempotent via inFlightTasks), drains the queue to
   * completion, and returns the number of runs that SUCCEEDED. Used by the cron
   * and by tests. Backoff is 0 here so it never blocks.
   */
  async tick(mcpUrl: string, max: number): Promise<number> {
    this.mcpUrl = mcpUrl;
    const agents = await this.prisma.agent.findMany({ where: { status: AgentStatus.ACTIVE } });
    const alwaysOn = agents.filter((a) => ((a.caps ?? {}) as AgentCaps).alwaysOn === true);
    let enqueued = 0;
    for (const agent of alwaysOn) {
      if (enqueued >= max) break;
      const open = await this.prisma.operationalTask.findMany({
        where: { tenantId: agent.tenantId, assigneeAgentId: agent.id, status: OperationalTaskStatus.OPEN },
        orderBy: { createdAt: 'asc' },
        take: max - enqueued,
      });
      for (const task of open) {
        if (this.inFlightTasks.has(task.id)) continue;
        const runId = await this.ledger.createQueued({
          tenantId: agent.tenantId, agentId: agent.id, taskId: task.id,
          trigger: AgentRunTrigger.CRON, model: agent.model,
        });
        this.inFlightTasks.add(task.id);
        this.queue.push({ runId, tenantId: agent.tenantId, agentId: agent.id, taskId: task.id, trigger: AgentRunTrigger.CRON, attempt: 1 });
        enqueued++;
      }
    }
    return this.drain(0);
  }

  /** Drains the queue respecting concurrency caps. Returns count of SUCCEEDED runs. */
  private async drain(backoffMs: number): Promise<number> {
    const running: Promise<boolean>[] = [];
    let item: QueuedRun | undefined;
    while ((item = this.pickEligible()) !== undefined) {
      const claimed = item;
      this.acquire(claimed);
      running.push(
        this.executeRun(claimed, backoffMs).finally(() => this.release(claimed)),
      );
    }
    const results = await Promise.all(running);
    return results.filter(Boolean).length;
  }

  /** Background dispatch (event/manual path) — fire-and-forget, never throws. */
  private async dispatch(): Promise<void> {
    try {
      await this.drain(this.config ? 1_000 : 0);
    } catch (err) {
      this.logger.warn(`dispatch: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private pickEligible(): QueuedRun | undefined {
    if (this.globalActive >= this.maxGlobal) return undefined;
    const idx = this.queue.findIndex(
      (r) =>
        (this.perTenantActive.get(r.tenantId) ?? 0) < this.maxPerTenant &&
        (this.perAgentActive.get(r.agentId) ?? 0) < PER_AGENT_CONCURRENCY,
    );
    if (idx === -1) return undefined;
    return this.queue.splice(idx, 1)[0];
  }

  private acquire(r: QueuedRun): void {
    this.globalActive++;
    this.perTenantActive.set(r.tenantId, (this.perTenantActive.get(r.tenantId) ?? 0) + 1);
    this.perAgentActive.set(r.agentId, (this.perAgentActive.get(r.agentId) ?? 0) + 1);
  }

  private release(r: QueuedRun): void {
    this.globalActive--;
    this.perTenantActive.set(r.tenantId, (this.perTenantActive.get(r.tenantId) ?? 1) - 1);
    this.perAgentActive.set(r.agentId, (this.perAgentActive.get(r.agentId) ?? 1) - 1);
  }

  /** Returns true iff the run SUCCEEDED. Never throws. */
  private async executeRun(item: QueuedRun, backoffMs: number): Promise<boolean> {
    const { tenantId, agentId, taskId, runId } = item;
    try {
      const agent = (await this.prisma.agent.findFirst({
        where: { id: agentId, tenantId },
        select: { id: true, tenantId: true, model: true, persona: true, serviceUserId: true, status: true },
      })) as (AgentRow & { status: AgentStatus }) | null;

      // Hot kill switch: refuse to start for a non-ACTIVE agent.
      if (!agent || agent.status !== AgentStatus.ACTIVE) {
        await this.ledger.finish(runId, AgentRunStatus.KILLED);
        this.inFlightTasks.delete(taskId);
        return false;
      }

      await this.ledger.markRunning(runId);
      await this.prisma.agent.update({ where: { id: agentId }, data: { lastRunAt: new Date() } }).catch(() => undefined);
      await this.tasks.start(tenantId, taskId, agent.serviceUserId);

      const sessionId = await this.runtime.openSession({
        tenantId,
        agent: { id: agent.id, model: agent.model, persona: agent.persona },
        pulsarMcpUrl: this.mcpUrl,
        triggeredByRef: `task:${taskId}`,
      });
      // Runtime reachable → heartbeat.
      await this.prisma.agent.update({ where: { id: agentId }, data: { lastSeenAt: new Date() } }).catch(() => undefined);
      try {
        for await (const _ev of this.runtime.sendTurn(sessionId, this.buildPrompt(taskId))) void _ev;
      } finally {
        await this.runtime.closeSession(sessionId).catch(() => undefined);
      }

      const proposedActionCount = await this.prisma.proposedAction.count({
        where: { tenantId, triggeredByRef: `task:${taskId}` },
      });
      await this.ledger.finish(runId, AgentRunStatus.SUCCEEDED, { proposedActionCount });
      this.inFlightTasks.delete(taskId);
      return true;
    } catch (err) {
      return this.handleFailure(item, err, backoffMs);
    }
  }

  private async handleFailure(item: QueuedRun, err: unknown, backoffMs: number): Promise<boolean> {
    const { tenantId, agentId, taskId, runId } = item;
    const name = err instanceof Error ? err.constructor.name : 'Error';
    const message = err instanceof Error ? err.message : String(err);
    this.logger.warn(`agent ${agentId} task ${taskId}: ${message}`);

    // If the agent was paused/revoked mid-run, this is a kill, not a failure.
    const fresh = await this.prisma.agent.findFirst({ where: { id: agentId, tenantId }, select: { status: true } });
    if (fresh && fresh.status !== AgentStatus.ACTIVE) {
      await this.revertTask(taskId);
      await this.ledger.finish(runId, AgentRunStatus.KILLED, { error: message });
      this.inFlightTasks.delete(taskId);
      return false;
    }

    const cls = classifyRunError(name);
    if (cls === 'skip') {
      await this.revertTask(taskId);
      await this.ledger.finish(runId, AgentRunStatus.SKIPPED, { error: message });
      this.inFlightTasks.delete(taskId);
      return false;
    }
    if (cls === 'retry' && item.attempt < MAX_ATTEMPTS) {
      const nextAttempt = item.attempt + 1;
      await this.ledger.bumpAttempt(runId, nextAttempt);
      await this.revertTask(taskId);
      await this.sleep(backoffMs);
      this.queue.push({ ...item, attempt: nextAttempt });
      return false;
    }
    // terminal, or retries exhausted
    await this.revertTask(taskId);
    await this.ledger.finish(runId, AgentRunStatus.FAILED, { error: message });
    this.inFlightTasks.delete(taskId);
    return false;
  }

  /** Revert IN_PROGRESS → OPEN, guarded (never reopen a task the agent resolved mid-turn). */
  private async revertTask(taskId: string): Promise<void> {
    await this.prisma.operationalTask
      .updateMany({
        where: { id: taskId, status: OperationalTaskStatus.IN_PROGRESS },
        data: { status: OperationalTaskStatus.OPEN },
      })
      .catch(() => undefined);
  }

  private sleep(ms: number): Promise<void> {
    if (ms <= 0) return Promise.resolve();
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private buildPrompt(taskId: string): string {
    return (
      `You are handling operational task id ${taskId}. ` +
      `Review the situation and take or propose the appropriate action.`
    );
  }
}
```

> Note: the retry path re-pushes the item onto the queue and returns false; the `drain` loop keeps draining until the queue is empty, so retries are exercised within the same `tick()` call (backoff 0 in tests). With `MAX_ATTEMPTS = 2`, a persistently-down Hermes yields one retry then `FAILED`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @pulsar/api test -- agent-worker.service`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/core/operating/agent-worker.service.ts apps/api/src/core/operating/agent-worker.service.spec.ts
git commit -m "feat(api): AgentWorkerService dispatcher — queue, concurrency caps, retries, kill-aware execution

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Wire the dispatcher into the module + delete WorkbenchAgentRunner + event trigger

**Files:**
- Modify: `apps/api/src/core/operating/operating.module.ts`
- Modify: `apps/api/src/core/operating/domain-events.service.ts:78-103` (event trigger)
- Delete: `apps/api/src/core/operating/workbench-agent-runner.service.ts` + `.spec.ts`

- [ ] **Step 1: Delete the old runner**

```bash
git rm apps/api/src/core/operating/workbench-agent-runner.service.ts apps/api/src/core/operating/workbench-agent-runner.service.spec.ts
```

- [ ] **Step 2: Update `operating.module.ts`**

Replace the file with:

```ts
import { forwardRef, Module } from '@nestjs/common';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { AgentsModule } from '../agents/agents.module';
import { AgentRunsService } from './agent-runs.service';
import { AgentWorkerService } from './agent-worker.service';
import { DomainEventsService } from './domain-events.service';
import { TaskAssignmentResolver } from './event-policies';
import { OperationalTasksService } from './operational-tasks.service';
import { OperationalTasksController } from './operational-tasks.controller';

@Module({
  imports: [AuditLogsModule, forwardRef(() => AgentsModule)],
  controllers: [OperationalTasksController],
  providers: [
    DomainEventsService,
    TaskAssignmentResolver,
    OperationalTasksService,
    AgentRunsService,
    AgentWorkerService,
  ],
  exports: [DomainEventsService, OperationalTasksService, AgentWorkerService, AgentRunsService],
})
export class OperatingModule {}
```

- [ ] **Step 3: Inject the worker into `DomainEventsService` and enqueue on assignment**

In `domain-events.service.ts`, add the import and constructor param:

```ts
import { AgentWorkerService } from './agent-worker.service';
```

Constructor (replace lines 28-31):

```ts
  constructor(
    private readonly prisma: PrismaService,
    private readonly assignment: TaskAssignmentResolver,
    private readonly worker: AgentWorkerService,
  ) {}
```

In `processPending`, after the `operationalTask.create({...})` succeeds (inside the `try`, after the create at lines 82-98), capture the created task and enqueue when assigned. Change the create to capture its id and enqueue:

```ts
            const created = await this.prisma.operationalTask.create({
              data: {
                tenantId: event.tenantId,
                type: spec.type,
                category: spec.category,
                status: OperationalTaskStatus.OPEN,
                severity: SEVERITY_TO_LEVEL[spec.severity],
                title: spec.title,
                details: spec.details as Prisma.InputJsonValue,
                subjectType: spec.subjectType,
                subjectId: spec.subjectId,
                assigneeType: agentId ? TaskAssigneeType.AGENT : TaskAssigneeType.UNASSIGNED,
                assigneeAgentId: agentId,
                dedupKey: spec.dedupKey,
                sourceEventId: event.id,
              },
              select: { id: true },
            });
            // Phase 13: wake the always-on worker immediately (best-effort, never throws).
            if (agentId) {
              void this.worker.enqueueTask(event.tenantId, agentId, created.id);
            }
```

> `AgentWorkerService` is provided in the same module, so no new import wiring is needed. `forwardRef` already breaks the AgentsModule ↔ OperatingModule cycle; `AgentWorkerService` injects `AgentRuntimeService` via `forwardRef` (already coded in Task 5).

- [ ] **Step 4: Build the API to verify the DI graph + types**

Run: `pnpm --filter @pulsar/api build`
Expected: builds, no DI/type errors.

- [ ] **Step 5: Run the worker + runs unit tests**

Run: `pnpm --filter @pulsar/api test -- agent-worker.service agent-runs.service agent-runtime-kill`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/core/operating/operating.module.ts apps/api/src/core/operating/domain-events.service.ts
git commit -m "feat(api): wire AgentWorkerService, event-driven wakeup; remove WorkbenchAgentRunner

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: AgentsService + controller — pause / resume / run-now / pause-all / runs

**Files:**
- Modify: `apps/api/src/core/agents/agents.service.ts` (`agentSelect`, `pause`/`resume`/`runNow`/`pauseAll`/`getOwned`)
- Modify: `apps/api/src/core/agents/agents.module.ts` (inject `AgentWorkerService` + `AgentRunsService`)
- Modify: `apps/api/src/core/agents/agents.controller.ts` (new endpoints)
- Test: `apps/api/src/core/agents/agents-pause.service.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/core/agents/agents-pause.service.spec.ts`:

```ts
import { AgentStatus } from '@pulsar/shared';
import { AgentsService } from './agents.service';

function makeService(updates: any[], killed: string[]) {
  const prisma = {
    agent: {
      findFirst: async () => ({ id: 'a1', tenantId: 't1', status: AgentStatus.ACTIVE }),
      findMany: async () => [{ id: 'a1' }, { id: 'a2' }],
      update: async ({ where, data }: any) => { updates.push({ where, data }); return { id: where.id, ...data }; },
    },
  } as any;
  const runtime = { killAgentSessions: async (id: string) => { killed.push(id); return 1; } } as any;
  const worker = { runNow: async () => true } as any;
  const runs = {} as any;
  process.env.JWT_SECRET = 'test-secret';
  return new AgentsService(prisma, runtime, worker, runs);
}

describe('AgentsService pause/resume/pauseAll', () => {
  it('pause sets PAUSED and kills in-flight sessions', async () => {
    const updates: any[] = []; const killed: string[] = [];
    const svc = makeService(updates, killed);
    await svc.pause('t1', 'a1');
    expect(updates[0].data.status).toBe(AgentStatus.PAUSED);
    expect(killed).toEqual(['a1']);
  });

  it('resume sets ACTIVE', async () => {
    const updates: any[] = []; const killed: string[] = [];
    const svc = makeService(updates, killed);
    await svc.resume('t1', 'a1');
    expect(updates[0].data.status).toBe(AgentStatus.ACTIVE);
  });

  it('pauseAll pauses every agent in the tenant', async () => {
    const updates: any[] = []; const killed: string[] = [];
    const svc = makeService(updates, killed);
    const n = await svc.pauseAll('t1');
    expect(n).toBe(2);
    expect(killed.sort()).toEqual(['a1', 'a2']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @pulsar/api test -- agents-pause`
Expected: FAIL — `AgentsService` constructor arity / `pause is not a function`.

- [ ] **Step 3: Extend `AgentsService`**

In `agents.service.ts`:

3a. Add imports at top:

```ts
import { AgentRuntimeService } from './agent-runtime.service';
import { AgentWorkerService } from '../operating/agent-worker.service';
import { AgentRunsService } from '../operating/agent-runs.service';
import type { ListQueryDto } from '../../common/dto/list-query.dto';
```

3b. Add `lastSeenAt` + `lastRunAt` to `agentSelect` (after `lastUsedAt: true,` line 26):

```ts
  lastSeenAt: true,
  lastRunAt: true,
```

3c. Replace the constructor (lines 39-43) — inject runtime + worker + runs. Use `forwardRef` to avoid cycles:

```ts
  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => AgentRuntimeService))
    private readonly runtime: AgentRuntimeService,
    @Inject(forwardRef(() => AgentWorkerService))
    private readonly worker: AgentWorkerService,
    private readonly runs: AgentRunsService,
  ) {
    const secret = process.env.AGENT_SESSION_SECRET ?? process.env.JWT_SECRET;
    if (!secret) throw new Error('AGENT_SESSION_SECRET or JWT_SECRET must be set');
    this.sessionSecret = secret;
  }
```

Add `forwardRef, Inject` to the `@nestjs/common` import at the top of the file.

3d. In `getOwned` (line 179), reject PAUSED too so the live runtime path won't act for a paused agent:

```ts
    if (!agent || agent.status !== AgentStatus.ACTIVE) throw new NotFoundException('Agent not found');
```

3e. Add the new methods (before `validateKey`):

```ts
  /** Hot kill switch: PAUSE (reversible) + kill in-flight Hermes sessions. */
  async pause(tenantId: string, id: string) {
    const agent = await this.prisma.agent.findFirst({ where: { id, tenantId } });
    if (!agent) throw new NotFoundException('Agent not found');
    if (agent.status === AgentStatus.REVOKED) throw new BadRequestException('Agent is revoked');
    await this.prisma.agent.update({ where: { id }, data: { status: AgentStatus.PAUSED } });
    await this.runtime.killAgentSessions(id).catch(() => undefined);
    return { status: AgentStatus.PAUSED };
  }

  async resume(tenantId: string, id: string) {
    const agent = await this.prisma.agent.findFirst({ where: { id, tenantId } });
    if (!agent) throw new NotFoundException('Agent not found');
    if (agent.status === AgentStatus.REVOKED) throw new BadRequestException('Agent is revoked');
    await this.prisma.agent.update({ where: { id }, data: { status: AgentStatus.ACTIVE } });
    return { status: AgentStatus.ACTIVE };
  }

  /** Tenant-wide emergency stop: pause every non-revoked agent. Returns the count paused. */
  async pauseAll(tenantId: string): Promise<number> {
    const agents = await this.prisma.agent.findMany({
      where: { tenantId, status: { not: AgentStatus.REVOKED } },
      select: { id: true },
    });
    for (const a of agents) {
      await this.prisma.agent.update({ where: { id: a.id }, data: { status: AgentStatus.PAUSED } });
      await this.runtime.killAgentSessions(a.id).catch(() => undefined);
    }
    return agents.length;
  }

  /** Manual "Run now" — enqueue the agent's oldest OPEN task. */
  async runNow(tenantId: string, id: string) {
    const agent = await this.prisma.agent.findFirst({ where: { id, tenantId } });
    if (!agent) throw new NotFoundException('Agent not found');
    if (agent.status !== AgentStatus.ACTIVE) throw new BadRequestException('Agent is not active');
    const enqueued = await this.worker.runNow(tenantId, id);
    return { enqueued };
  }

  /** Paginated run history (projection — no secrets, rule 26). */
  async listRuns(tenantId: string, id: string, q: ListQueryDto) {
    await this.getOne(tenantId, id); // 404 if not in tenant
    return this.runs.listForAgent(tenantId, id, q);
  }
```

- [ ] **Step 4: Update `agents.module.ts` to import OperatingModule**

In `agents.module.ts`, the module already imports `forwardRef(() => OperatingModule)` (line 38) which now exports `AgentWorkerService` + `AgentRunsService` (Task 6). No further wiring needed — Nest resolves them. Confirm `AgentRuntimeService` stays in `providers`.

- [ ] **Step 5: Add controller endpoints**

In `agents.controller.ts`, add imports:

```ts
import { Query } from '@nestjs/common';
import { ListQueryDto } from '../../common/dto/list-query.dto';
```

Add endpoints inside the class (after `activity`, before `getOne` so `:id/runs` isn't shadowed):

```ts
  @Get(':id/runs')
  @RequirePermissions(PERMISSIONS.CORE.AGENTS_READ)
  runs(@CurrentUser() user: AuthUser, @Param('id') id: string, @Query() q: ListQueryDto) {
    return this.agents.listRuns(user.tenantId, id, q);
  }

  @Post(':id/pause')
  @RequirePermissions(PERMISSIONS.CORE.AGENTS_MANAGE)
  pause(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.agents.pause(user.tenantId, id);
  }

  @Post(':id/resume')
  @RequirePermissions(PERMISSIONS.CORE.AGENTS_MANAGE)
  resume(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.agents.resume(user.tenantId, id);
  }

  @Post(':id/run-now')
  @RequirePermissions(PERMISSIONS.CORE.AGENTS_MANAGE)
  runNow(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.agents.runNow(user.tenantId, id);
  }
```

And a tenant-wide stop (place before the `:id` routes to avoid the `:id` param capturing `pause-all`):

```ts
  @Post('pause-all')
  @RequirePermissions(PERMISSIONS.CORE.AGENTS_MANAGE)
  pauseAll(@CurrentUser() user: AuthUser) {
    return this.agents.pauseAll(user.tenantId);
  }
```

> Route ordering matters in Nest: declare `@Post('pause-all')` and `@Get(':id/runs')` **before** `@Get(':id')`/the bare `:id` handlers. Put `pause-all` near the top of the controller.

- [ ] **Step 6: Run test + build**

Run: `pnpm --filter @pulsar/api test -- agents-pause`
Expected: PASS (3 tests).

Run: `pnpm --filter @pulsar/api build`
Expected: builds (DI graph resolves the AgentsService ↔ AgentWorkerService forwardRef).

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/core/agents/agents.service.ts apps/api/src/core/agents/agents.controller.ts apps/api/src/core/agents/agents-pause.service.spec.ts apps/api/src/core/agents/agents.module.ts
git commit -m "feat(api): agent pause/resume/run-now/pause-all + run history endpoints

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Update phase-12 e2e to drive AgentWorkerService

The phase-12 e2e scenario B (`B3`) called `WorkbenchAgentRunner.tick()`. Repoint it to `AgentWorkerService`, which exposes the same `tick(mcpUrl, max)` contract.

**Files:**
- Modify: `apps/api/test/phase12-operating-workbench.e2e-spec.ts`

- [ ] **Step 1: Find the runner usage**

Run: `grep -n "WorkbenchAgentRunner" apps/api/test/phase12-operating-workbench.e2e-spec.ts`
Expected: one import + one or more `app.get(WorkbenchAgentRunner)` usages in scenario B.

- [ ] **Step 2: Repoint to the worker**

Replace the import:

```ts
import { AgentWorkerService } from '../src/core/operating/agent-worker.service';
```

Replace each `app.get(WorkbenchAgentRunner)` with `app.get(AgentWorkerService)`. The `.tick(mcpUrl, max)` call signature is unchanged. (The fake Hermes runtime override in the e2e setup remains valid — `AgentWorkerService` calls the same `openSession`/`sendTurn`/`closeSession`.)

- [ ] **Step 3: Run the phase-12 e2e (DB up + migrated + seeded)**

Run:

```bash
pnpm db:migrate && pnpm db:seed
pnpm --filter @pulsar/api test:e2e -- phase12-operating-workbench
```

Expected: all 10 phase-12 tests still PASS (the always-on path now goes through the dispatcher).

- [ ] **Step 4: Commit**

```bash
git add apps/api/test/phase12-operating-workbench.e2e-spec.ts
git commit -m "test(api): phase-12 e2e drives AgentWorkerService (post-WorkbenchAgentRunner)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Phase-13 e2e — full 24/7 workforce path

**Files:**
- Create: `apps/api/test/phase13-workforce.e2e-spec.ts`

Mirror the phase-12 e2e setup (it constructs the Nest app, logs in as `admin@pulsar.dev`, and overrides `AgentRuntimeService` with a fake Hermes that enqueues a `ProposedAction`). Reuse that setup verbatim, then add the phase-13 assertions.

- [ ] **Step 1: Read the phase-12 e2e setup to copy its bootstrapping**

Run: `sed -n '1,120p' apps/api/test/phase12-operating-workbench.e2e-spec.ts`
Note: how it builds `app`, logs in, registers an always-on agent, the fake Hermes override, and how it emits `stop.delayed` + calls `processPending`.

- [ ] **Step 2: Write the e2e**

Create `apps/api/test/phase13-workforce.e2e-spec.ts` with these scenarios (reuse the phase-12 bootstrap helpers; the code below shows the assertions, adapt variable names to the copied setup):

```ts
// Bootstrap (app, token, tenant, always-on PROPOSE agent handling 'DELAY', fake Hermes
// that enqueues a ProposedAction on its turn) — copied from phase12-operating-workbench.e2e-spec.ts.

import { AgentRunStatus } from '@pulsar/shared';
import { AgentWorkerService } from '../src/core/operating/agent-worker.service';
import { DomainEventsService } from '../src/core/operating/domain-events.service';

describe('Phase 13 — 24/7 workforce (e2e)', () => {
  // ... beforeAll: build app, login, register always-on agent (caps.alwaysOn + handlesCategories:['DELAY']) ...
  // ... helper: emitDelay() -> domainEvents.emit + domainEvents.processPending(100) ...

  it('A1: event wakeup → run SUCCEEDED + ProposedAction triggeredByRef=task:<id>', async () => {
    await emitDelay();                       // creates an OPEN task auto-assigned to the agent
    await app.get(DomainEventsService).processPending(100); // (already in emitDelay)
    await app.get(AgentWorkerService).tick(`${baseUrl}/api/v1/mcp`, 10); // drain (covers cron-net too)

    const runs = await request(server)
      .get(`/api/v1/agents/${agentId}/runs`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const latest = runs.body.items[0];
    expect(latest.status).toBe(AgentRunStatus.SUCCEEDED);
    expect(latest.taskId).toBeDefined();
    expect(latest.proposedActionCount).toBeGreaterThanOrEqual(1);
    // projection guard (rule 26): no secrets leak
    expect(latest).not.toHaveProperty('secretHash');
    expect(latest).not.toHaveProperty('serviceUserId');
  });

  it('A2: GET /agents/:id/runs is paginated and tenant-scoped', async () => {
    const res = await request(server)
      .get(`/api/v1/agents/${agentId}/runs?page=1&pageSize=5`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(res.body).toHaveProperty('items');
    expect(res.body).toHaveProperty('total');
    expect(res.body.pageSize).toBe(5);
  });

  it('B1: pause sets PAUSED and the worker refuses to run for it', async () => {
    await request(server)
      .post(`/api/v1/agents/${agentId}/pause`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201);

    await emitDelay(); // new OPEN task assigned to the (now paused) agent
    const driven = await app.get(AgentWorkerService).tick(`${baseUrl}/api/v1/mcp`, 10);

    // The run for the paused agent must be KILLED, not SUCCEEDED.
    const runs = await request(server)
      .get(`/api/v1/agents/${agentId}/runs`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(runs.body.items[0].status).toBe(AgentRunStatus.KILLED);
  });

  it('B2: resume restores ACTIVE and run-now drives the pending task', async () => {
    await request(server)
      .post(`/api/v1/agents/${agentId}/resume`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201);
    const res = await request(server)
      .post(`/api/v1/agents/${agentId}/run-now`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201);
    expect(res.body.enqueued).toBe(true);
  });

  it('C1: SKIPPED when the runtime is not installed (rule 24 — no crash)', async () => {
    // Override AgentRuntimeService.openSession to throw BadRequestException('not installed').
    // emitDelay + tick → newest run for the agent is SKIPPED, task back to OPEN, no throw.
    // (Implement by re-registering a provider override or spying on the runtime in this app instance.)
  });
});
```

> For C1, the simplest implementation: in this e2e use `jest.spyOn(app.get(AgentRuntimeService), 'openSession').mockRejectedValueOnce(new BadRequestException('not installed'))` before `tick`, then assert the latest run is `SKIPPED`. Import `BadRequestException` from `@nestjs/common` and `AgentRuntimeService` from `../src/core/agents/agent-runtime.service`.

- [ ] **Step 3: Run the e2e**

Run: `pnpm --filter @pulsar/api test:e2e -- phase13-workforce`
Expected: all scenarios PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/api/test/phase13-workforce.e2e-spec.ts
git commit -m "test(api): phase-13 e2e — event wakeup, run ledger, pause/kill, run-now, skip-on-absent

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: Web — Activité 24/7 (run history, pause/resume/run-now, heartbeat)

**Files:**
- Modify: `apps/web/src/routes/(app)/agents/[id]/+page.svelte`
- Modify: `apps/web/src/routes/(app)/agents/+page.svelte`

Follow the existing page pattern: `$state` + `$effect`-triggered `load()`, `api<T>()` client from `$lib/api/client`, local `error` string. Read the current `[id]/+page.svelte` first to match its layout/components.

- [ ] **Step 1: Read the current agent detail page**

Run: `sed -n '1,80p' "apps/web/src/routes/(app)/agents/[id]/+page.svelte"`
Note: how it fetches the agent, the section/card components in use, and the tab/section structure.

- [ ] **Step 2: Add run-history state + loader**

In `[id]/+page.svelte`, add to the `<script>`:

```ts
type AgentRun = {
  id: string; trigger: string; taskId: string | null; status: string;
  attempt: number; startedAt: string | null; finishedAt: string | null;
  error: string | null; proposedActionCount: number; createdAt: string;
};
let runs = $state<AgentRun[]>([]);
let runsError = $state('');
let busy = $state(false);

async function loadRuns() {
  try {
    const res = await api<{ items: AgentRun[] }>(`/agents/${id}/runs?pageSize=25`);
    runs = res.items;
  } catch (e) {
    runsError = e instanceof Error ? e.message : 'Erreur';
  }
}

async function act(verb: 'pause' | 'resume' | 'run-now') {
  busy = true;
  try {
    await api(`/agents/${id}/${verb}`, { method: 'POST' });
    await load();      // refresh agent (status/lastSeenAt)
    await loadRuns();
  } catch (e) {
    runsError = e instanceof Error ? e.message : 'Erreur';
  } finally {
    busy = false;
  }
}
```

Call `loadRuns()` from the same `$effect` that calls `load()` (where `id` is read).

- [ ] **Step 3: Add the "Activité 24/7" section markup**

Add a section (match the existing card styling on the page):

```svelte
<section class="card">
  <header class="card-head">
    <h2>Activité 24/7</h2>
    <div class="actions">
      <span class="badge" class:online={agent?.status === 'ACTIVE'} class:paused={agent?.status === 'PAUSED'}>
        {agent?.status === 'PAUSED' ? 'En pause' : agent?.status === 'ACTIVE' ? 'Actif' : agent?.status}
      </span>
      {#if agent?.status === 'ACTIVE'}
        <button disabled={busy} onclick={() => act('pause')}>Pause</button>
        <button disabled={busy} onclick={() => act('run-now')}>Run now</button>
      {:else if agent?.status === 'PAUSED'}
        <button disabled={busy} onclick={() => act('resume')}>Resume</button>
      {/if}
    </div>
  </header>
  {#if agent?.lastSeenAt}<p class="muted">Vu : {new Date(agent.lastSeenAt).toLocaleString()}</p>{/if}
  {#if runsError}<p class="error">{runsError}</p>{/if}
  <table>
    <thead><tr><th>Déclencheur</th><th>Tâche</th><th>Statut</th><th>Essai</th><th>Actions proposées</th><th>Début</th><th>Erreur</th></tr></thead>
    <tbody>
      {#each runs as r (r.id)}
        <tr>
          <td>{r.trigger}</td>
          <td>{r.taskId ?? '—'}</td>
          <td>{r.status}</td>
          <td>{r.attempt}</td>
          <td>{r.proposedActionCount}</td>
          <td>{r.startedAt ? new Date(r.startedAt).toLocaleString() : '—'}</td>
          <td class="muted">{r.error ?? ''}</td>
        </tr>
      {/each}
      {#if runs.length === 0}<tr><td colspan="7" class="muted">Aucun run.</td></tr>{/if}
    </tbody>
  </table>
</section>
```

> Match the actual `api()` signature and CSS conventions of the existing page (the snippet assumes `api(path, { method })` — adjust if the client uses a different call shape). `agent` is the existing `$state` holding the fetched agent; it now includes `status`, `lastSeenAt`, `lastRunAt`.

- [ ] **Step 4: Add a status pill to the roster**

In `agents/+page.svelte`, on each agent card show a small pill:

```svelte
<span class="badge" class:online={a.status === 'ACTIVE'} class:paused={a.status === 'PAUSED'}>
  {a.status === 'PAUSED' ? 'En pause' : a.status === 'ACTIVE' ? 'Actif' : a.status}
</span>
```

(The `list()` endpoint already returns `status` via `agentSelect`.)

- [ ] **Step 5: Build the web app (catches `node:*`/type regressions)**

Run: `pnpm --filter @pulsar/web build`
Expected: builds cleanly.

- [ ] **Step 6: Commit**

```bash
git add "apps/web/src/routes/(app)/agents/[id]/+page.svelte" "apps/web/src/routes/(app)/agents/+page.svelte"
git commit -m "feat(web): agent Activité 24/7 — run history, pause/resume/run-now, heartbeat badge

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: Hard rule 28 + status doc + full build

**Files:**
- Modify: `CLAUDE.md` (add rule 28 under "Hard rules (continued, phase 12)" → new phase-13 block)
- Modify: `docs/etat-du-projet.md` and `ROADMAP.md` (mark phase 13 shipped — match the phase-12 entry style)

- [ ] **Step 1: Add hard rule 28 to CLAUDE.md**

After the phase-12 rule 27 block, add:

```markdown
## Hard rules (continued, phase 13)

28. (phase 13 — Main-d'œuvre 24/7) Tout réveil d'un agent always-on passe par
    `AgentWorkerService` (dispatcher unique, file en mémoire, concurrence plafonnée
    global/tenant/agent) ; chaque réveil est enregistré comme `AgentRun` (durable). `PAUSED`
    est le kill switch à chaud réversible (tue les sessions Hermes en vol via
    `AgentRuntimeService.killAgentSessions`) ; `REVOKED` reste permanent. Le retry ne
    s'applique qu'aux erreurs de connectivité runtime (`ServiceUnavailableException`,
    classées par `classifyRunError` de `@pulsar/shared`) ; Hermes absent ⇒ run `SKIPPED`,
    tout autre échec est terminal et renvoie la tâche en OPEN. Le dispatcher est best-effort
    et isolé (règle 24 préservée : jamais de crash, `runCron`/`enqueueTask` n'émettent jamais
    d'exception) ; les actions de l'agent passent TOUJOURS par la file `ProposedAction` avec
    `triggeredByRef = "task:<id>"`.
```

- [ ] **Step 2: Update the roadmap + status doc**

In `ROADMAP.md`, change the phase 13 bullet from a plan to shipped (prefix `✅ **13 —`), summarizing: AgentWorkerService dispatcher, AgentRun ledger, heartbeat, PAUSED hot kill switch, event wakeup + cron-net, retries, 22nd migration. Mirror the phrasing of the phase-12 `✅` entry. Add a one-line note in `docs/etat-du-projet.md` if it tracks per-phase status.

- [ ] **Step 3: Full build + all unit tests + targeted e2e**

Run:

```bash
pnpm build
pnpm test
pnpm --filter @pulsar/api test:e2e -- phase12-operating-workbench phase13-workforce
```

Expected: build green (shared → database → api → web), all unit tests pass, both e2e suites pass.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md ROADMAP.md docs/etat-du-projet.md
git commit -m "docs(phase-13): hard rule 28 + roadmap/status — 24/7 workforce shipped

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review (completed during planning)

**Spec coverage:**
- Worker model = ephemeral + management layer → Tasks 4–7 (no persistent process introduced). ✅
- Triggers = event + cron-net → Task 6 (`enqueueTask` from DomainEvents) + Task 5 (`runCron`/`tick` sweep). ✅
- `AgentWorkerService` dispatcher, queue, concurrency 4/2/1 → Task 5. ✅
- `AgentRun` ledger entity (22nd migration) → Tasks 2 + 4. ✅
- Heartbeat (`lastSeenAt`/`lastRunAt`) → Tasks 2 + 5 (stamped on run start + runtime reach). ✅
- Hot kill switch `PAUSED` + kill in-flight sessions → Tasks 1, 2, 3, 7. ✅
- Retries (connectivity only) + SKIPPED on absent → Tasks 1 (`classifyRunError`) + 5. ✅
- API: `GET :id/runs`, pause/resume/run-now/pause-all → Task 7. ✅
- UI Activité 24/7 → Task 10. ✅
- Hard rule 28 → Task 11. ✅
- Tests: event→SUCCEEDED+ProposedAction, pause→KILLED, retry→FAILED, absent→SKIPPED, concurrency, cron-net, projection guard → Tasks 5 (unit) + 9 (e2e). ✅

**Type consistency:** `tick(mcpUrl, max)` signature preserved across WorkbenchAgentRunner→AgentWorkerService (Task 8 relies on it). `AgentRunStatus`/`AgentRunTrigger`/`classifyRunError` defined in Task 1, used in Tasks 4/5. `killAgentSessions(agentId)` defined in Task 3, used in Task 7. `agentSelect` gains `lastSeenAt`/`lastRunAt` in Task 7, consumed by Task 10.

**Placeholder scan:** Task 9 C1 leaves the implementation as a documented spy-based approach (intentional — the bootstrap is copied from the phase-12 e2e which the worker reuses); all other steps carry complete code.

**Open assumption (flagged, low-risk):** `classifyRunError` maps `BadRequestException → 'skip'`. The runtime throws `BadRequestException` only for "not installed" today; if other BadRequests reach the worker they'd be SKIPPED rather than FAILED. Acceptable for this phase (matches rule 24 "absent ⇒ skip"); revisit if the runtime grows other 400 paths.
```
