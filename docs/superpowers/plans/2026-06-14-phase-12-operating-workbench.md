# Phase 12 — Operating Workbench Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the operating substrate — `domain event → policy → OperationalTask → assignment (human|agent) → ProposedAction → audit` — proven end-to-end by the dispatch/exceptions agent working its assigned cases headlessly (no ⌘K).

**Architecture:** A new `core/operating` module holds a durable `DomainEvent` outbox (mirrors the webhook outbox), code-registered event policies that turn events into `OperationalTask` rows, a unified inbox (REST + web), and a bounded best-effort `WorkbenchAgentRunner` cron that wakes the dispatch agent on its OPEN tasks. Agent tool calls reuse the phase-11 governance path (`ProposedAction` queue + caps), with the task linked via `triggeredByRef = "task:<id>"`. Extends phase-11; rebuilds nothing.

**Tech Stack:** NestJS (`@nestjs/schedule` crons), Prisma/PostgreSQL, `@pulsar/shared` (enums + state machines + pure policy resolution), Zod (tool schemas), SvelteKit (Svelte 5 runes SPA), Jest (unit + supertest e2e), the vendored fake ACP server from palier 2a.

**Reference spec:** `docs/superpowers/specs/2026-06-14-phase-12-operating-workbench-design.md`

**Hard rules that apply (CLAUDE.md):** tenant isolation (1), state-machine transitions only (2), enums mirrored shared↔prisma (3), `@RequirePermissions` on every endpoint (5), audit sensitive mutations (6), rebuild shared/database after changes (7), tools always via the registry (21), mutating tools go through the `ProposedAction` queue (22), autonomy never lifts caps (23), agent runtime best-effort/isolated (24).

---

## File Structure

**packages/shared (source of truth — rebuild after edits):**
- Create `src/enums/operating.ts` — `OperationalTaskType`, `OperationalTaskStatus`, `TaskAssigneeType`, `DomainEventStatus`.
- Create `src/workflows/operational-task.workflow.ts` — `canTransitionOperationalTask`.
- Create `src/operating/policies.ts` — pure `resolvePolicies(event)` + `TaskSpec` type + the policy registry.
- Modify `src/permissions.ts` — add 2 core permission keys + catalog entries.
- Modify `src/index.ts` — export the 3 new files.
- Tests: `src/workflows/__tests__/operational-task.workflow.spec.ts`, `src/operating/policies.spec.ts`.

**packages/database:**
- Modify `prisma/schema.prisma` — `DomainEvent` + `OperationalTask` models + 4 enums.
- Migration `prisma/migrations/<ts>_phase12_operating_workbench/migration.sql`.
- Modify `prisma/seed.ts` if the admin role is not seeded from `ALL_PERMISSION_KEYS` (verify).

**apps/api/src/core/operating/ (new module):**
- `operating.module.ts`, `domain-events.service.ts`, `event-policies.ts` (thin re-export/wiring of shared policies + agent resolution), `operational-tasks.service.ts`, `operational-tasks.controller.ts`, `workbench-agent-runner.service.ts`, `dto/list-tasks.dto.ts`, `dto/task-action.dto.ts`.

**apps/api/src/core/agents/ (extend):**
- `tool-registry.ts` — make `module` optional; add 4 workbench tools + `OPERATING_TOOL_SERVICES` shape.
- `mcp-server.factory.ts` — treat `module===undefined` as always-available; pass `principal.triggeredByRef` to `enqueue`.
- `agent-principal.ts` — add optional `triggeredByRef`.
- `agent-session-token.ts` — optional `triggeredByRef` in the token payload (backward compatible).
- `agents.service.ts` — `mintSessionToken` gains optional `triggeredByRef`.
- `agent-runtime.service.ts` — `openSession` gains optional `triggeredByRef`.
- `mcp.controller.ts` — read `triggeredByRef` from the verified token into the principal.

**apps/api/src/modules/transportation/ (wire emitters):**
- `exceptions/delay-detection.service.ts` — emit `stop.delayed` after the existing notification.
- `tenders/tenders.service.ts` + `tenders/tender-expiry.service.ts` — emit `tender.declined` / `tender.expired`.
- `transportation.module.ts` — import `OperatingModule`.

**apps/api/src/app.module.ts:** register `OperatingModule`.

**apps/web/src/routes/(app)/workbench/+page.svelte** (new) + nav entry in `(app)/+layout.svelte`.

**apps/api/test/phase12-operating-workbench.e2e-spec.ts** (new).

**Docs (end of phase):** `CLAUDE.md` rule 27, `docs/etat-du-projet.md`, `ROADMAP.md` phase-12 ✅.

---

## Task 1: Shared enums + OperationalTask state machine

**Files:**
- Create: `packages/shared/src/enums/operating.ts`
- Create: `packages/shared/src/workflows/operational-task.workflow.ts`
- Create: `packages/shared/src/workflows/__tests__/operational-task.workflow.spec.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: Write the enums file**

`packages/shared/src/enums/operating.ts`:
```ts
/** Operating Workbench enums (phase 12). Mirrored verbatim in schema.prisma. */
export enum OperationalTaskType {
  EXCEPTION = 'EXCEPTION',
}

export enum OperationalTaskStatus {
  OPEN = 'OPEN',
  IN_PROGRESS = 'IN_PROGRESS',
  RESOLVED = 'RESOLVED',
  DISMISSED = 'DISMISSED',
}

export enum TaskAssigneeType {
  UNASSIGNED = 'UNASSIGNED',
  HUMAN = 'HUMAN',
  AGENT = 'AGENT',
}

export enum DomainEventStatus {
  PENDING = 'PENDING',
  PROCESSED = 'PROCESSED',
  FAILED = 'FAILED',
}
```

- [ ] **Step 2: Write the failing state-machine test**

`packages/shared/src/workflows/__tests__/operational-task.workflow.spec.ts`:
```ts
import { OperationalTaskStatus as S } from '../../enums/operating';
import { canTransitionOperationalTask } from '../operational-task.workflow';

describe('canTransitionOperationalTask', () => {
  it('allows OPEN → IN_PROGRESS, RESOLVED, DISMISSED', () => {
    expect(canTransitionOperationalTask(S.OPEN, S.IN_PROGRESS)).toBe(true);
    expect(canTransitionOperationalTask(S.OPEN, S.RESOLVED)).toBe(true);
    expect(canTransitionOperationalTask(S.OPEN, S.DISMISSED)).toBe(true);
  });
  it('allows IN_PROGRESS → RESOLVED, DISMISSED, OPEN', () => {
    expect(canTransitionOperationalTask(S.IN_PROGRESS, S.RESOLVED)).toBe(true);
    expect(canTransitionOperationalTask(S.IN_PROGRESS, S.DISMISSED)).toBe(true);
    expect(canTransitionOperationalTask(S.IN_PROGRESS, S.OPEN)).toBe(true);
  });
  it('treats RESOLVED and DISMISSED as terminal', () => {
    expect(canTransitionOperationalTask(S.RESOLVED, S.OPEN)).toBe(false);
    expect(canTransitionOperationalTask(S.DISMISSED, S.IN_PROGRESS)).toBe(false);
  });
  it('rejects no-op transitions', () => {
    expect(canTransitionOperationalTask(S.OPEN, S.OPEN)).toBe(false);
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm --filter @pulsar/shared test -- operational-task.workflow`
Expected: FAIL — cannot find module `../operational-task.workflow`.

- [ ] **Step 4: Write the state machine**

`packages/shared/src/workflows/operational-task.workflow.ts`:
```ts
import { OperationalTaskStatus } from '../enums/operating';

export const OPERATIONAL_TASK_TRANSITIONS: Record<OperationalTaskStatus, OperationalTaskStatus[]> = {
  [OperationalTaskStatus.OPEN]: [
    OperationalTaskStatus.IN_PROGRESS,
    OperationalTaskStatus.RESOLVED,
    OperationalTaskStatus.DISMISSED,
  ],
  [OperationalTaskStatus.IN_PROGRESS]: [
    OperationalTaskStatus.RESOLVED,
    OperationalTaskStatus.DISMISSED,
    OperationalTaskStatus.OPEN,
  ],
  [OperationalTaskStatus.RESOLVED]: [],
  [OperationalTaskStatus.DISMISSED]: [],
};

export function canTransitionOperationalTask(
  from: OperationalTaskStatus,
  to: OperationalTaskStatus,
): boolean {
  return OPERATIONAL_TASK_TRANSITIONS[from]?.includes(to) ?? false;
}
```

- [ ] **Step 5: Add exports to the shared barrel**

In `packages/shared/src/index.ts`, after the existing `export * from './enums/billing';` line add:
```ts
export * from './enums/operating';
```
and after `export * from './workflows/customer-invoice.workflow';` add:
```ts
export * from './workflows/operational-task.workflow';
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm --filter @pulsar/shared test -- operational-task.workflow`
Expected: PASS (4 tests).

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/enums/operating.ts packages/shared/src/workflows/operational-task.workflow.ts packages/shared/src/workflows/__tests__/operational-task.workflow.spec.ts packages/shared/src/index.ts
git commit -m "feat(shared): operating workbench enums + OperationalTask state machine"
```

---

## Task 2: Event policies (pure resolution) in shared

**Files:**
- Create: `packages/shared/src/operating/policies.ts`
- Create: `packages/shared/src/operating/policies.spec.ts`
- Modify: `packages/shared/src/index.ts`

Policies are PURE: they map a domain event to zero or more `TaskSpec`s. They never touch the DB or pick a concrete agent (agent resolution happens in the API service, Task 6). `assignHint` says whether the task should be auto-routed to a handling agent or left for humans.

- [ ] **Step 1: Write the failing test**

`packages/shared/src/operating/policies.spec.ts`:
```ts
import { OperationalTaskType } from '../enums/operating';
import { resolvePolicies, type DomainEventInput } from './policies';

const delayed: DomainEventInput = {
  type: 'stop.delayed',
  payload: { stopId: 's1', loadId: 'l1', deadline: '2026-06-14T12:00:00.000Z', minutesLate: 45 },
};

describe('resolvePolicies', () => {
  it('turns stop.delayed into one EXCEPTION/DELAY task with a stable dedupKey', () => {
    const specs = resolvePolicies(delayed);
    expect(specs).toHaveLength(1);
    expect(specs[0].type).toBe(OperationalTaskType.EXCEPTION);
    expect(specs[0].category).toBe('DELAY');
    expect(specs[0].subjectType).toBe('stop');
    expect(specs[0].subjectId).toBe('s1');
    expect(specs[0].dedupKey).toBe('DELAY:s1:2026-06-14T12:00:00.000Z');
    expect(specs[0].assignHint).toBe('AUTO');
  });

  it('escalates severity to CRITICAL when more than 60 minutes late', () => {
    const specs = resolvePolicies({ ...delayed, payload: { ...delayed.payload, minutesLate: 90 } });
    expect(specs[0].severity).toBe('CRITICAL');
  });

  it('turns tender.declined and tender.expired into TENDER_FAILURE tasks', () => {
    const declined = resolvePolicies({
      type: 'tender.declined',
      payload: { loadId: 'l1', loadNumber: 'LD-1', carrierId: 'c1', tenderId: 't1' },
    });
    expect(declined[0].category).toBe('TENDER_FAILURE');
    expect(declined[0].dedupKey).toBe('TENDER_FAILURE:t1');
  });

  it('returns [] for an event with no matching policy', () => {
    expect(resolvePolicies({ type: 'load.completed', payload: {} })).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @pulsar/shared test -- operating/policies`
Expected: FAIL — cannot find module `./policies`.

- [ ] **Step 3: Write the policies module**

`packages/shared/src/operating/policies.ts`:
```ts
import { OperationalTaskType } from '../enums/operating';

/** Domain-event type catalog (phase 12). Free strings, like webhook event names. */
export const DOMAIN_EVENT_TYPES = {
  STOP_DELAYED: 'stop.delayed',
  TENDER_DECLINED: 'tender.declined',
  TENDER_EXPIRED: 'tender.expired',
} as const;

export interface DomainEventInput {
  type: string;
  payload: Record<string, unknown>;
}

export type Severity = 'INFO' | 'WARNING' | 'CRITICAL';
export type AssignHint = 'AUTO' | 'UNASSIGNED';

export interface TaskSpec {
  type: OperationalTaskType;
  category: string;
  severity: Severity;
  title: string;
  subjectType: string;
  subjectId: string;
  /** Stable per logical exception — used for idempotent dedup (tenantId, dedupKey). */
  dedupKey: string;
  details: Record<string, unknown>;
  /** AUTO = route to a handling always-on agent if one exists; else fall back to UNASSIGNED. */
  assignHint: AssignHint;
}

interface Policy {
  eventType: string;
  produce(event: DomainEventInput): TaskSpec[];
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const num = (v: unknown): number => (typeof v === 'number' ? v : 0);

const POLICIES: Policy[] = [
  {
    eventType: DOMAIN_EVENT_TYPES.STOP_DELAYED,
    produce: (e) => {
      const stopId = str(e.payload.stopId);
      const deadline = str(e.payload.deadline);
      const minutesLate = num(e.payload.minutesLate);
      return [
        {
          type: OperationalTaskType.EXCEPTION,
          category: 'DELAY',
          severity: minutesLate > 60 ? 'CRITICAL' : 'WARNING',
          title: `Stop ${minutesLate} min late`,
          subjectType: 'stop',
          subjectId: stopId,
          dedupKey: `DELAY:${stopId}:${deadline}`,
          details: { ...e.payload },
          assignHint: 'AUTO',
        },
      ];
    },
  },
  ...[DOMAIN_EVENT_TYPES.TENDER_DECLINED, DOMAIN_EVENT_TYPES.TENDER_EXPIRED].map(
    (eventType): Policy => ({
      eventType,
      produce: (e) => {
        const tenderId = str(e.payload.tenderId);
        const loadId = str(e.payload.loadId);
        const reason = eventType === DOMAIN_EVENT_TYPES.TENDER_DECLINED ? 'declined' : 'expired';
        return [
          {
            type: OperationalTaskType.EXCEPTION,
            category: 'TENDER_FAILURE',
            severity: 'WARNING',
            title: `Tender ${reason} on load ${str(e.payload.loadNumber) || loadId}`,
            subjectType: 'load',
            subjectId: loadId,
            dedupKey: `TENDER_FAILURE:${tenderId}`,
            details: { ...e.payload, reason },
            assignHint: 'AUTO',
          },
        ];
      },
    }),
  ),
];

const POLICIES_BY_EVENT = new Map<string, Policy[]>();
for (const p of POLICIES) {
  const arr = POLICIES_BY_EVENT.get(p.eventType) ?? [];
  arr.push(p);
  POLICIES_BY_EVENT.set(p.eventType, arr);
}

export function resolvePolicies(event: DomainEventInput): TaskSpec[] {
  return (POLICIES_BY_EVENT.get(event.type) ?? []).flatMap((p) => p.produce(event));
}
```

- [ ] **Step 4: Add the barrel export**

In `packages/shared/src/index.ts` add after the operating enums export:
```ts
export * from './operating/policies';
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @pulsar/shared test -- operating/policies`
Expected: PASS (4 tests).

- [ ] **Step 6: Rebuild shared (the API consumes its dist/)**

Run: `pnpm --filter @pulsar/shared build`
Expected: tsc succeeds, `dist/` updated.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/operating/policies.ts packages/shared/src/operating/policies.spec.ts packages/shared/src/index.ts
git commit -m "feat(shared): pure event-policy resolution (stop.delayed, tender failures)"
```

---

## Task 3: Permissions catalog

**Files:**
- Modify: `packages/shared/src/permissions.ts`

- [ ] **Step 1: Add the two permission keys**

In `PERMISSIONS.CORE` (after `AGENTS_CHAT`), add:
```ts
    OPERATING_TASKS_READ: 'core.operating.tasks.read',
    OPERATING_TASKS_MANAGE: 'core.operating.tasks.manage',
```

- [ ] **Step 2: Add the catalog descriptors**

In `PERMISSION_CATALOG`, after the `core(PERMISSIONS.CORE.AGENTS_CHAT, ...)` line add:
```ts
  core(PERMISSIONS.CORE.OPERATING_TASKS_READ, 'View the operating workbench (tasks & exceptions)'),
  core(PERMISSIONS.CORE.OPERATING_TASKS_MANAGE, 'Assign, resolve and dismiss operating tasks'),
```

- [ ] **Step 3: Rebuild shared**

Run: `pnpm --filter @pulsar/shared build`
Expected: success.

- [ ] **Step 4: Verify the admin role will receive them**

Run: `grep -n "ALL_PERMISSION_KEYS\|adminRole\|permissions:" packages/database/prisma/seed.ts`
Expected: the demo admin role is seeded from `ALL_PERMISSION_KEYS` (catalog-driven). If it instead lists keys explicitly, add the two new keys to that list. Note the finding in the commit body.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/permissions.ts
git commit -m "feat(shared): core.operating.tasks.read/manage permissions"
```

---

## Task 4: Prisma models + migration

**Files:**
- Modify: `packages/database/prisma/schema.prisma`
- Create: `packages/database/prisma/migrations/<ts>_phase12_operating_workbench/migration.sql`

- [ ] **Step 1: Add the enums to schema.prisma**

Near the other enums add (values MUST match `packages/shared/src/enums/operating.ts` exactly — hard rule 3):
```prisma
enum OperationalTaskType {
  EXCEPTION
}

enum OperationalTaskStatus {
  OPEN
  IN_PROGRESS
  RESOLVED
  DISMISSED
}

enum TaskAssigneeType {
  UNASSIGNED
  HUMAN
  AGENT
}

enum DomainEventStatus {
  PENDING
  PROCESSED
  FAILED
}
```

- [ ] **Step 2: Add the DomainEvent model**

```prisma
model DomainEvent {
  id          String            @id @default(cuid())
  tenantId    String
  type        String
  subjectType String?
  subjectId   String?
  payload     Json
  status      DomainEventStatus @default(PENDING)
  attempts    Int               @default(0)
  lastError   String?
  processedAt DateTime?
  createdAt   DateTime          @default(now())

  @@index([status, createdAt])
  @@index([tenantId, type, createdAt])
  @@map("domain_events")
}
```

- [ ] **Step 3: Add the OperationalTask model**

```prisma
model OperationalTask {
  id              String                @id @default(cuid())
  tenantId        String
  type            OperationalTaskType
  category        String
  status          OperationalTaskStatus @default(OPEN)
  severity        NotificationLevel     @default(WARNING)
  title           String
  details         Json?
  subjectType     String
  subjectId       String
  assigneeType    TaskAssigneeType      @default(UNASSIGNED)
  assigneeUserId  String?
  assigneeAgentId String?
  dedupKey        String
  sourceEventId   String?
  resolvedById    String?
  resolutionNote  String?
  createdAt       DateTime              @default(now())
  updatedAt       DateTime              @updatedAt
  resolvedAt      DateTime?

  @@unique([tenantId, dedupKey])
  @@index([tenantId, status, assigneeType])
  @@index([tenantId, assigneeAgentId, status])
  @@map("operational_tasks")
}
```

- [ ] **Step 4: Validate the schema**

Run: `pnpm --filter @pulsar/database exec prisma validate`
Expected: "The schema at prisma/schema.prisma is valid".

- [ ] **Step 5: Generate the migration SQL (non-interactive)**

In the session/CI Postgres (shadow DB `pulsar_shadow` available), generate the diff and place it in a new migration folder. Use the established pattern (see prior migrations' provenance note in `docs/etat-du-projet.md`):
```bash
TS=$(node -e "process.stdout.write(new Date().toISOString().replace(/[-:TZ.]/g,'').slice(0,14))")
DIR="packages/database/prisma/migrations/${TS}_phase12_operating_workbench"
mkdir -p "$DIR"
pnpm --filter @pulsar/database exec prisma migrate diff \
  --from-schema-datamodel <(git show HEAD:packages/database/prisma/schema.prisma) \
  --to-schema-datamodel packages/database/prisma/schema.prisma \
  --script > "$DIR/migration.sql"
```
Expected: `migration.sql` contains `CREATE TYPE "OperationalTaskType"`, the two `CREATE TABLE` statements, and the indexes. Review it.

- [ ] **Step 6: Apply + regenerate client**

```bash
pnpm --filter @pulsar/database exec prisma migrate deploy
pnpm db:generate
```
Expected: migration applied; `@prisma/client` regenerated with `domainEvent` + `operationalTask` delegates.

- [ ] **Step 7: Rebuild database package**

Run: `pnpm --filter @pulsar/database build`
Expected: success.

- [ ] **Step 8: Commit**

```bash
git add packages/database/prisma/schema.prisma packages/database/prisma/migrations
git commit -m "feat(db): DomainEvent + OperationalTask models, 21st migration"
```

---

## Task 5: OperatingModule + DomainEventsService

**Files:**
- Create: `apps/api/src/core/operating/operating.module.ts`
- Create: `apps/api/src/core/operating/domain-events.service.ts`
- Create: `apps/api/src/core/operating/event-policies.ts`
- Create: `apps/api/test-unit/domain-events.service.spec.ts` (co-located unit spec; match the repo's existing `*.spec.ts` placement next to the service if that is the convention — verify with `git ls-files 'apps/api/src/**/*.spec.ts' | head`)
- Modify: `apps/api/src/app.module.ts`

`event-policies.ts` wires the pure shared `resolvePolicies` to agent resolution. `DomainEventsService.emit` is best-effort (never throws into the caller); `processPending` is the cron worker.

- [ ] **Step 1: Write `event-policies.ts` (agent resolution helper)**

```ts
import { Injectable } from '@nestjs/common';
import { AgentStatus } from '@pulsar/database';
import type { TaskSpec } from '@pulsar/shared';
import { PrismaService } from '../../prisma/prisma.service';

/** Resolve which always-on agent (if any) should handle a category for a tenant. */
@Injectable()
export class TaskAssignmentResolver {
  constructor(private readonly prisma: PrismaService) {}

  /** First ACTIVE agent with caps.alwaysOn === true and the category in caps.handlesCategories. */
  async resolveAgent(tenantId: string, spec: TaskSpec): Promise<string | null> {
    if (spec.assignHint !== 'AUTO') return null;
    const agents = await this.prisma.agent.findMany({
      where: { tenantId, status: AgentStatus.ACTIVE },
      orderBy: { createdAt: 'asc' },
    });
    for (const a of agents) {
      const caps = (a.caps ?? {}) as { alwaysOn?: boolean; handlesCategories?: string[] };
      if (caps.alwaysOn && (caps.handlesCategories ?? []).includes(spec.category)) return a.id;
    }
    return null;
  }
}
```

- [ ] **Step 2: Write the failing DomainEventsService test**

```ts
import { Test } from '@nestjs/testing';
import { DomainEventStatus, OperationalTaskStatus } from '@pulsar/shared';
import { PrismaService } from '../src/prisma/prisma.service';
import { DomainEventsService } from '../src/core/operating/domain-events.service';
import { TaskAssignmentResolver } from '../src/core/operating/event-policies';

// Minimal in-memory prisma fake: enough for emit + processPending.
function makePrismaFake() {
  const events: any[] = [];
  const tasks: any[] = [];
  let seq = 0;
  return {
    _events: events,
    _tasks: tasks,
    domainEvent: {
      create: async ({ data }: any) => { const e = { id: `e${++seq}`, attempts: 0, ...data }; events.push(e); return e; },
      findMany: async ({ where }: any) => events.filter((e) => e.status === where.status.PENDING ?? e.status === 'PENDING'),
      updateMany: async ({ where, data }: any) => {
        let n = 0;
        for (const e of events) if (e.id === where.id && e.status === where.status) { Object.assign(e, data); n++; }
        return { count: n };
      },
    },
    operationalTask: {
      create: async ({ data }: any) => {
        if (tasks.some((t) => t.tenantId === data.tenantId && t.dedupKey === data.dedupKey)) {
          const err: any = new Error('unique'); err.code = 'P2002'; throw err;
        }
        const t = { id: `t${++seq}`, ...data }; tasks.push(t); return t;
      },
    },
    agent: { findMany: async () => [] },
  } as unknown as PrismaService;
}

describe('DomainEventsService', () => {
  it('emit persists a PENDING event; processPending creates an UNASSIGNED task and marks PROCESSED', async () => {
    const prisma = makePrismaFake();
    const moduleRef = await Test.createTestingModule({
      providers: [
        DomainEventsService,
        TaskAssignmentResolver,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    const svc = moduleRef.get(DomainEventsService);

    await svc.emit('tenant1', 'stop.delayed', { type: 'stop', id: 's1' }, {
      stopId: 's1', loadId: 'l1', deadline: '2026-06-14T12:00:00.000Z', minutesLate: 30,
    });
    expect((prisma as any)._events).toHaveLength(1);
    expect((prisma as any)._events[0].status).toBe(DomainEventStatus.PENDING);

    const processed = await svc.processPending(50);
    expect(processed).toBe(1);
    expect((prisma as any)._tasks).toHaveLength(1);
    expect((prisma as any)._tasks[0].status).toBe(OperationalTaskStatus.OPEN);
    expect((prisma as any)._tasks[0].assigneeType).toBe('UNASSIGNED');
    expect((prisma as any)._events[0].status).toBe(DomainEventStatus.PROCESSED);
  });

  it('emit never throws even if create fails (best-effort)', async () => {
    const prisma = makePrismaFake();
    (prisma as any).domainEvent.create = async () => { throw new Error('db down'); };
    const moduleRef = await Test.createTestingModule({
      providers: [DomainEventsService, TaskAssignmentResolver, { provide: PrismaService, useValue: prisma }],
    }).compile();
    await expect(moduleRef.get(DomainEventsService).emit('t', 'stop.delayed', null, {})).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm --filter @pulsar/api test -- domain-events.service`
Expected: FAIL — cannot find `DomainEventsService`.

- [ ] **Step 4: Write `domain-events.service.ts`**

```ts
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  DomainEventStatus,
  OperationalTaskStatus,
  TaskAssigneeType,
  resolvePolicies,
  type Severity,
} from '@pulsar/shared';
import { NotificationLevel, Prisma } from '@pulsar/database';
import { PrismaService } from '../../prisma/prisma.service';
import { TaskAssignmentResolver } from './event-policies';

const SEVERITY_TO_LEVEL: Record<Severity, NotificationLevel> = {
  INFO: NotificationLevel.INFO,
  WARNING: NotificationLevel.WARNING,
  CRITICAL: NotificationLevel.CRITICAL,
};

@Injectable()
export class DomainEventsService {
  private readonly logger = new Logger(DomainEventsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly assignment: TaskAssignmentResolver,
  ) {}

  /** Persist a domain event. Best-effort: a failure is logged, never thrown into the caller. */
  async emit(
    tenantId: string,
    type: string,
    subject: { type: string; id: string } | null,
    payload: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.prisma.domainEvent.create({
        data: {
          tenantId,
          type,
          subjectType: subject?.type ?? null,
          subjectId: subject?.id ?? null,
          payload: payload as Prisma.InputJsonValue,
          status: DomainEventStatus.PENDING,
        },
      });
    } catch (err) {
      this.logger.error(`emit(${type}) failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async processCron(): Promise<void> {
    await this.processPending(100);
  }

  /** Claim PENDING events, run policies, create tasks (idempotent), mark PROCESSED/FAILED. */
  async processPending(limit: number): Promise<number> {
    const pending = await this.prisma.domainEvent.findMany({
      where: { status: DomainEventStatus.PENDING },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });

    let handled = 0;
    for (const event of pending) {
      // Race-safe claim — only one worker transitions this event.
      const claimed = await this.prisma.domainEvent.updateMany({
        where: { id: event.id, status: DomainEventStatus.PENDING },
        data: { status: DomainEventStatus.PROCESSED, attempts: { increment: 1 } },
      });
      if (claimed.count === 0) continue;

      try {
        const specs = resolvePolicies({ type: event.type, payload: (event.payload ?? {}) as Record<string, unknown> });
        for (const spec of specs) {
          const agentId = await this.assignment.resolveAgent(event.tenantId, spec);
          try {
            await this.prisma.operationalTask.create({
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
            });
          } catch (err) {
            // P2002 = (tenantId, dedupKey) already exists → idempotent, skip.
            if (!(err && typeof err === 'object' && (err as { code?: string }).code === 'P2002')) throw err;
          }
        }
        handled++;
      } catch (err) {
        await this.prisma.domainEvent.updateMany({
          where: { id: event.id },
          data: { status: DomainEventStatus.FAILED, lastError: err instanceof Error ? err.message : String(err) },
        });
      }
    }
    return handled;
  }
}
```

- [ ] **Step 5: Write `operating.module.ts` (partial — services added in later tasks)**

```ts
import { Module } from '@nestjs/common';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { DomainEventsService } from './domain-events.service';
import { TaskAssignmentResolver } from './event-policies';

@Module({
  imports: [AuditLogsModule],
  providers: [DomainEventsService, TaskAssignmentResolver],
  exports: [DomainEventsService],
})
export class OperatingModule {}
```
(If `AuditLogsModule` is global or differently named, verify with `grep -rn "class AuditLogsModule" apps/api/src` and adjust the import; `PrismaModule` is global in this codebase — confirm via `grep -rn "@Global" apps/api/src/prisma`.)

- [ ] **Step 6: Register the module**

In `apps/api/src/app.module.ts`, add `OperatingModule` to the `imports` array (next to the other core modules) and the import statement at the top.

- [ ] **Step 7: Run the unit test**

Run: `pnpm --filter @pulsar/api test -- domain-events.service`
Expected: PASS (2 tests).

- [ ] **Step 8: Typecheck + commit**

```bash
pnpm --filter @pulsar/api typecheck
git add apps/api/src/core/operating apps/api/src/app.module.ts apps/api/test-unit/domain-events.service.spec.ts
git commit -m "feat(api): OperatingModule + DomainEventsService (durable outbox + policy worker)"
```

---

## Task 6: OperationalTasksService (CRUD + transitions)

**Files:**
- Create: `apps/api/src/core/operating/operational-tasks.service.ts`
- Create: `apps/api/test-unit/operational-tasks.service.spec.ts`
- Modify: `apps/api/src/core/operating/operating.module.ts`

- [ ] **Step 1: Write the failing test (transition guard + tenant isolation)**

```ts
import { Test } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { OperationalTaskStatus, TaskAssigneeType } from '@pulsar/shared';
import { PrismaService } from '../src/prisma/prisma.service';
import { AuditLogsService } from '../src/core/audit-logs/audit-logs.service';
import { OperationalTasksService } from '../src/core/operating/operational-tasks.service';

function fakePrisma(task: any) {
  return {
    operationalTask: {
      findFirst: async ({ where }: any) => (where.tenantId === task.tenantId && where.id === task.id ? task : null),
      updateMany: async ({ where, data }: any) => {
        if (where.id === task.id && where.tenantId === task.tenantId && where.status === task.status) {
          Object.assign(task, data); return { count: 1 };
        }
        return { count: 0 };
      },
    },
    proposedAction: { findMany: async () => [] },
  } as unknown as PrismaService;
}
const audit = { log: async () => undefined } as unknown as AuditLogsService;

async function build(task: any) {
  const m = await Test.createTestingModule({
    providers: [
      OperationalTasksService,
      { provide: PrismaService, useValue: fakePrisma(task) },
      { provide: AuditLogsService, useValue: audit },
    ],
  }).compile();
  return m.get(OperationalTasksService);
}

describe('OperationalTasksService.resolve', () => {
  it('moves OPEN → RESOLVED and stamps resolver + note', async () => {
    const task = { id: 't1', tenantId: 'ten1', status: OperationalTaskStatus.OPEN };
    const svc = await build(task);
    await svc.resolve('ten1', 't1', 'user1', 'fixed');
    expect(task.status).toBe(OperationalTaskStatus.RESOLVED);
    expect(task.resolvedById).toBe('user1');
    expect(task.resolutionNote).toBe('fixed');
  });

  it('rejects an illegal transition (RESOLVED → RESOLVED)', async () => {
    const task = { id: 't1', tenantId: 'ten1', status: OperationalTaskStatus.RESOLVED };
    const svc = await build(task);
    await expect(svc.resolve('ten1', 't1', 'user1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('does not find a task from another tenant', async () => {
    const task = { id: 't1', tenantId: 'ten1', status: OperationalTaskStatus.OPEN };
    const svc = await build(task);
    await expect(svc.resolve('OTHER', 't1', 'user1')).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @pulsar/api test -- operational-tasks.service`
Expected: FAIL — cannot find `OperationalTasksService`.

- [ ] **Step 3: Write the service**

`apps/api/src/core/operating/operational-tasks.service.ts`:
```ts
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  AuditAction,
  OperationalTaskStatus,
  TaskAssigneeType,
  canTransitionOperationalTask,
} from '@pulsar/shared';
import { Prisma } from '@pulsar/database';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';

interface ListFilter {
  status?: OperationalTaskStatus;
  type?: string;
  category?: string;
  assigneeType?: TaskAssigneeType;
  page: number;
  pageSize: number;
  skip: number;
  take: number;
}

@Injectable()
export class OperationalTasksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
  ) {}

  async list(tenantId: string, f: ListFilter) {
    const where: Prisma.OperationalTaskWhereInput = {
      tenantId,
      ...(f.status ? { status: f.status } : {}),
      ...(f.type ? { type: f.type as OperationalTaskStatus } : {}),
      ...(f.category ? { category: f.category } : {}),
      ...(f.assigneeType ? { assigneeType: f.assigneeType } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.operationalTask.findMany({ where, orderBy: { createdAt: 'desc' }, skip: f.skip, take: f.take }),
      this.prisma.operationalTask.count({ where }),
    ]);
    return { items, total, page: f.page, pageSize: f.pageSize };
  }

  async get(tenantId: string, id: string) {
    const task = await this.prisma.operationalTask.findFirst({ where: { id, tenantId } });
    if (!task) throw new NotFoundException('Task not found');
    const actions = await this.prisma.proposedAction.findMany({
      where: { tenantId, triggeredByRef: `task:${id}` },
      orderBy: { proposedAt: 'desc' },
    });
    return { ...task, proposedActions: actions };
  }

  /** Atomic status change guarded by the state machine. Returns the updated row. */
  private async transition(
    tenantId: string,
    id: string,
    to: OperationalTaskStatus,
    extra: Prisma.OperationalTaskUpdateManyMutationInput,
    actorId: string,
  ) {
    const task = await this.prisma.operationalTask.findFirst({ where: { id, tenantId } });
    if (!task) throw new NotFoundException('Task not found');
    if (!canTransitionOperationalTask(task.status as OperationalTaskStatus, to)) {
      throw new BadRequestException(`Cannot move task from ${task.status} to ${to}`);
    }
    const claimed = await this.prisma.operationalTask.updateMany({
      where: { id, tenantId, status: task.status },
      data: { status: to, ...extra },
    });
    if (claimed.count === 0) throw new BadRequestException('Task changed concurrently — retry');
    await this.audit.log({
      tenantId,
      userId: actorId,
      action: AuditAction.UPDATE,
      entityType: 'operational-task',
      entityId: id,
      before: { status: task.status },
      after: { status: to },
    });
    return this.prisma.operationalTask.findFirst({ where: { id, tenantId } });
  }

  resolve(tenantId: string, id: string, userId: string, note?: string) {
    return this.transition(
      tenantId, id, OperationalTaskStatus.RESOLVED,
      { resolvedById: userId, resolutionNote: note ?? null, resolvedAt: new Date() }, userId,
    );
  }

  dismiss(tenantId: string, id: string, userId: string, note?: string) {
    return this.transition(
      tenantId, id, OperationalTaskStatus.DISMISSED,
      { resolvedById: userId, resolutionNote: note ?? null, resolvedAt: new Date() }, userId,
    );
  }

  /** Mark IN_PROGRESS (used by the agent runner when it starts working a task). */
  start(tenantId: string, id: string, actorId: string) {
    return this.transition(tenantId, id, OperationalTaskStatus.IN_PROGRESS, {}, actorId);
  }

  async assign(
    tenantId: string,
    id: string,
    actorId: string,
    body: { assigneeType: TaskAssigneeType; assigneeUserId?: string; assigneeAgentId?: string },
  ) {
    const task = await this.prisma.operationalTask.findFirst({ where: { id, tenantId } });
    if (!task) throw new NotFoundException('Task not found');
    await this.prisma.operationalTask.updateMany({
      where: { id, tenantId },
      data: {
        assigneeType: body.assigneeType,
        assigneeUserId: body.assigneeType === TaskAssigneeType.HUMAN ? body.assigneeUserId ?? null : null,
        assigneeAgentId: body.assigneeType === TaskAssigneeType.AGENT ? body.assigneeAgentId ?? null : null,
      },
    });
    await this.audit.log({
      tenantId, userId: actorId, action: AuditAction.UPDATE,
      entityType: 'operational-task', entityId: id, after: { assigneeType: body.assigneeType },
    });
    return this.prisma.operationalTask.findFirst({ where: { id, tenantId } });
  }
}
```

- [ ] **Step 4: Add it to the module**

In `operating.module.ts` add `OperationalTasksService` to `providers` and `exports`.

- [ ] **Step 5: Run the test**

Run: `pnpm --filter @pulsar/api test -- operational-tasks.service`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/core/operating/operational-tasks.service.ts apps/api/src/core/operating/operating.module.ts apps/api/test-unit/operational-tasks.service.spec.ts
git commit -m "feat(api): OperationalTasksService — state-machine transitions, tenant-scoped"
```

---

## Task 7: OperationalTasksController (REST inbox)

**Files:**
- Create: `apps/api/src/core/operating/dto/list-tasks.dto.ts`
- Create: `apps/api/src/core/operating/dto/task-action.dto.ts`
- Create: `apps/api/src/core/operating/operational-tasks.controller.ts`
- Modify: `apps/api/src/core/operating/operating.module.ts`

Follow the existing controller pattern (`@RequirePermissions`, `@CurrentUser`, `paginationArgs`). Verify the exact decorator import paths with `grep -rn "RequirePermissions" apps/api/src/core/agents/agents.controller.ts`.

- [ ] **Step 1: Write the DTOs**

`dto/list-tasks.dto.ts`:
```ts
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString } from 'class-validator';
import { OperationalTaskStatus, TaskAssigneeType } from '@pulsar/shared';
import { ListQueryDto } from '../../../common/dto/list-query.dto';

export class ListTasksDto extends ListQueryDto {
  @ApiPropertyOptional({ enum: OperationalTaskStatus })
  @IsOptional() @IsEnum(OperationalTaskStatus)
  status?: OperationalTaskStatus;

  @ApiPropertyOptional() @IsOptional() @IsString()
  category?: string;

  @ApiPropertyOptional({ enum: TaskAssigneeType })
  @IsOptional() @IsEnum(TaskAssigneeType)
  assigneeType?: TaskAssigneeType;
}
```

`dto/task-action.dto.ts`:
```ts
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString } from 'class-validator';
import { TaskAssigneeType } from '@pulsar/shared';

export class ResolveTaskDto {
  @ApiPropertyOptional() @IsOptional() @IsString()
  note?: string;
}

export class AssignTaskDto {
  @IsEnum(TaskAssigneeType)
  assigneeType!: TaskAssigneeType;

  @ApiPropertyOptional() @IsOptional() @IsString()
  assigneeUserId?: string;

  @ApiPropertyOptional() @IsOptional() @IsString()
  assigneeAgentId?: string;
}

export class NoteDto {
  @IsString()
  note!: string;
}
```

- [ ] **Step 2: Write the controller**

`operational-tasks.controller.ts` (match `RequirePermissions` import path to the verified one):
```ts
import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS, type AuthUser } from '@pulsar/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { paginationArgs } from '../../common/pagination';
import { OperationalTasksService } from './operational-tasks.service';
import { ListTasksDto } from './dto/list-tasks.dto';
import { AssignTaskDto, NoteDto, ResolveTaskDto } from './dto/task-action.dto';

@ApiTags('core/operating')
@ApiBearerAuth()
@Controller('operational-tasks')
export class OperationalTasksController {
  constructor(private readonly tasks: OperationalTasksService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.CORE.OPERATING_TASKS_READ)
  list(@CurrentUser() user: AuthUser, @Query() query: ListTasksDto) {
    const { page, pageSize, skip, take } = paginationArgs(query);
    return this.tasks.list(user.tenantId, {
      status: query.status, category: query.category, assigneeType: query.assigneeType,
      page, pageSize, skip, take,
    });
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.CORE.OPERATING_TASKS_READ)
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.tasks.get(user.tenantId, id);
  }

  @Post(':id/assign')
  @RequirePermissions(PERMISSIONS.CORE.OPERATING_TASKS_MANAGE)
  assign(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: AssignTaskDto) {
    return this.tasks.assign(user.tenantId, id, user.id, body);
  }

  @Post(':id/resolve')
  @RequirePermissions(PERMISSIONS.CORE.OPERATING_TASKS_MANAGE)
  resolve(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: ResolveTaskDto) {
    return this.tasks.resolve(user.tenantId, id, user.id, body.note);
  }

  @Post(':id/dismiss')
  @RequirePermissions(PERMISSIONS.CORE.OPERATING_TASKS_MANAGE)
  dismiss(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: ResolveTaskDto) {
    return this.tasks.dismiss(user.tenantId, id, user.id, body.note);
  }
}
```

- [ ] **Step 3: Register the controller**

In `operating.module.ts`, add `controllers: [OperationalTasksController]`.

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @pulsar/api typecheck`
Expected: success. Fix any import-path mismatches surfaced (decorators).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/core/operating
git commit -m "feat(api): operational-tasks REST inbox (list/get/assign/resolve/dismiss)"
```

---

## Task 8: Wire emitters (delay detection + tenders)

**Files:**
- Modify: `apps/api/src/modules/transportation/exceptions/delay-detection.service.ts`
- Modify: `apps/api/src/modules/transportation/tenders/tenders.service.ts:340` (decline path)
- Modify: `apps/api/src/modules/transportation/tenders/tender-expiry.service.ts:43`
- Modify: `apps/api/src/modules/transportation/transportation.module.ts`

- [ ] **Step 1: Import OperatingModule into TransportationModule**

In `transportation.module.ts`, add `OperatingModule` to `imports` (and the import statement). This makes `DomainEventsService` injectable in transportation services.

- [ ] **Step 2: Emit from delay detection**

In `delay-detection.service.ts`: inject `private readonly domainEvents: DomainEventsService` in the constructor. Immediately AFTER the existing `notifications.notify(...)` call (inside the per-late-stop block, after the TrackingEvent is created), add:
```ts
await this.domainEvents.emit(
  stop.load.tenantId,        // use the same tenantId already resolved for the notification
  'stop.delayed',
  { type: 'stop', id: stop.id },
  { stopId: stop.id, loadId: stop.loadId, deadline: deadline.toISOString(), minutesLate },
);
```
(Match the actual variable names in scope — `stop`, `deadline`, `minutesLate` — confirm by reading lines 43–106 first. The emit is best-effort and will not throw.)

- [ ] **Step 3: Emit from the tender decline path**

In `tenders.service.ts` near line 340 where `'tender.declined'` is emitted to webhooks, add a parallel domain event (inject `DomainEventsService`):
```ts
await this.domainEvents.emit(
  tenantId, 'tender.declined',
  { type: 'load', id: tender.loadId },
  { loadId: tender.loadId, loadNumber: load.number, carrierId: tender.carrierId, tenderId: tender.id },
);
```
(Use the variable names already in scope at that call site; only emit on the DECLINED branch, not ACCEPTED.)

- [ ] **Step 4: Emit from tender expiry**

In `tender-expiry.service.ts` near line 43 where `'tender.expired'` is emitted, add:
```ts
await this.domainEvents.emit(
  tenantId, 'tender.expired',
  { type: 'load', id: loadId },
  { loadId, loadNumber, carrierId, tenderId },
);
```
(Match in-scope variables.)

- [ ] **Step 5: Typecheck + build**

Run: `pnpm --filter @pulsar/api typecheck`
Expected: success (DomainEventsService resolvable via OperatingModule export).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/transportation
git commit -m "feat(api): emit domain events on stop.delayed + tender decline/expiry"
```

---

## Task 9: Workbench tools + governance threading (triggeredByRef)

**Files:**
- Modify: `apps/api/src/core/agents/agent-principal.ts`
- Modify: `apps/api/src/core/agents/agent-session-token.ts`
- Modify: `apps/api/src/core/agents/agent-session-token.spec.ts`
- Modify: `apps/api/src/core/agents/agents.service.ts` (mintSessionToken)
- Modify: `apps/api/src/core/agents/mcp.controller.ts`
- Modify: `apps/api/src/core/agents/mcp-server.factory.ts`
- Modify: `apps/api/src/core/agents/tool-registry.ts`

The session token gains an OPTIONAL third payload segment carrying `triggeredByRef`. Backward compatible: ⌘K tokens stay two-segment.

- [ ] **Step 1: Extend `agent-principal.ts`**

Add an optional field to the `AgentPrincipal` interface:
```ts
  /** When the agent acts on behalf of a specific operating task (headless runner). */
  triggeredByRef?: string;
```

- [ ] **Step 2: Write the failing token test**

Add to `agent-session-token.spec.ts`:
```ts
it('round-trips an optional triggeredByRef', () => {
  const token = mintAgentSessionToken('agent1', 'secret', 300, { triggeredByRef: 'task:t1' });
  const parsed = verifyAgentSessionTokenFull(token, 'secret');
  expect(parsed).toEqual({ agentId: 'agent1', triggeredByRef: 'task:t1' });
});
it('still verifies a legacy 2-segment token with no ref', () => {
  const token = mintAgentSessionToken('agent1', 'secret', 300);
  expect(verifyAgentSessionToken(token, 'secret')).toBe('agent1');
  expect(verifyAgentSessionTokenFull(token, 'secret')).toEqual({ agentId: 'agent1', triggeredByRef: undefined });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm --filter @pulsar/api test -- agent-session-token`
Expected: FAIL — `verifyAgentSessionTokenFull` undefined; mint signature mismatch.

- [ ] **Step 4: Extend the token util**

Edit `agent-session-token.ts`:
```ts
export function mintAgentSessionToken(
  agentId: string,
  secret: string,
  ttlSeconds: number,
  opts: { triggeredByRef?: string } = {},
  nowMs: number = Math.floor(Date.now() / 1000),
): string {
  const expiresAt = nowMs + ttlSeconds;
  const ref = opts.triggeredByRef ? Buffer.from(opts.triggeredByRef).toString('base64url') : '';
  // 2-segment payload when no ref (legacy-compatible); 3-segment when present.
  const payload = ref ? `${agentId}.${expiresAt}.${ref}` : `${agentId}.${expiresAt}`;
  const sig = createHmac('sha256', secret).update(payload).digest('base64url');
  return `${PREFIX}${Buffer.from(payload).toString('base64url')}.${sig}`;
}

export interface ParsedSessionToken {
  agentId: string;
  triggeredByRef?: string;
}

/** Full parse: validates signature + expiry, returns agentId and optional ref. */
export function verifyAgentSessionTokenFull(
  token: string,
  secret: string,
  nowMs: number = Math.floor(Date.now() / 1000),
): ParsedSessionToken | null {
  if (!token.startsWith(PREFIX)) return null;
  const body = token.slice(PREFIX.length);
  const dot = body.lastIndexOf('.');
  if (dot < 0) return null;
  const payloadB64 = body.slice(0, dot);
  const sig = body.slice(dot + 1);
  let payload: string;
  try { payload = Buffer.from(payloadB64, 'base64url').toString('utf8'); } catch { return null; }
  const expected = createHmac('sha256', secret).update(payload).digest('base64url');
  const a = Buffer.from(sig); const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const parts = payload.split('.');
  if (parts.length < 2) return null;
  const agentId = parts[0];
  const expiresAt = Number(parts[1]);
  if (!agentId || !Number.isFinite(expiresAt) || nowMs > expiresAt) return null;
  const triggeredByRef = parts[2] ? Buffer.from(parts[2], 'base64url').toString('utf8') : undefined;
  return { agentId, triggeredByRef };
}

export function verifyAgentSessionToken(
  token: string,
  secret: string,
  nowMs: number = Math.floor(Date.now() / 1000),
): string | null {
  return verifyAgentSessionTokenFull(token, secret, nowMs)?.agentId ?? null;
}
```
Remove the old `verifyAgentSessionToken` body it replaces. Keep the existing `import { createHmac, timingSafeEqual } from 'node:crypto';` and `PREFIX`.

- [ ] **Step 5: Run the token test**

Run: `pnpm --filter @pulsar/api test -- agent-session-token`
Expected: PASS (existing + 2 new).

- [ ] **Step 6: Thread the ref through `agents.service.ts`**

Update `mintSessionToken` to accept an optional ref and forward it:
```ts
mintSessionToken(agentId: string, ttlSeconds: number, triggeredByRef?: string): string {
  return mintAgentSessionToken(agentId, this.sessionSecret(), ttlSeconds, { triggeredByRef });
}
```
(Match the real secret accessor used today — read the method first; only ADD the third param + opts object.)

- [ ] **Step 7: Read the ref in `mcp.controller.ts`**

Where the controller verifies `X-Agent-Key` for session tokens (it calls `verifyAgentSessionToken` today), switch to `verifyAgentSessionTokenFull` and set `principal.triggeredByRef = parsed.triggeredByRef` on the built principal. Real `ak_` agent keys (non-session) leave it undefined.

- [ ] **Step 8: Pass it to enqueue in `mcp-server.factory.ts`**

Change line 58–60 from `{ triggeredByRef: undefined }` to:
```ts
        const proposal = await proposals.enqueue(principal, def.name, args, {
          triggeredByRef: principal.triggeredByRef,
        });
```

- [ ] **Step 9: Make `module` optional + add workbench tools in `tool-registry.ts`**

(a) Change the `ToolDef` interface: `module?: ModuleKey;` (optional).
(b) Extend `ToolServices` with the operating shape:
```ts
  operatingTasks: {
    listForAgent(tenantId: string, agentId: string): Promise<unknown>;
    getForTenant(tenantId: string, id: string): Promise<unknown>;
    resolve(tenantId: string, id: string, userId: string, note?: string): Promise<unknown>;
    addNote(tenantId: string, id: string, userId: string, note: string): Promise<unknown>;
  };
```
(c) Append four tools to `TOOL_REGISTRY` (no `module` → always available):
```ts
  {
    name: 'list_my_tasks',
    description: 'List the operating tasks currently assigned to me (this agent).',
    tier: RiskTier.READ,
    permission: PERMISSIONS.CORE.OPERATING_TASKS_READ,
    inputSchema: z.object({}),
    run: (_args, ctx) =>
      ctx.services.operatingTasks.listForAgent(ctx.principal.user.tenantId, ctx.principal.agentId),
  },
  {
    name: 'get_task',
    description: 'Get one operating task by id, with its subject and linked proposed actions.',
    tier: RiskTier.READ,
    permission: PERMISSIONS.CORE.OPERATING_TASKS_READ,
    inputSchema: z.object({ taskId: z.string().min(1) }),
    run: (args, ctx) =>
      ctx.services.operatingTasks.getForTenant(ctx.principal.user.tenantId, args.taskId as string),
  },
  {
    name: 'resolve_task',
    description: 'Resolve an operating task assigned to me, with a short note.',
    tier: RiskTier.LOW,
    permission: PERMISSIONS.CORE.OPERATING_TASKS_MANAGE,
    inputSchema: z.object({ taskId: z.string().min(1), note: z.string().optional() }),
    run: (args, ctx) =>
      ctx.services.operatingTasks.resolve(
        ctx.principal.user.tenantId, args.taskId as string, ctx.principal.user.id, args.note as string | undefined),
  },
  {
    name: 'add_task_note',
    description: 'Add a note to an operating task (audit trail / human handoff).',
    tier: RiskTier.LOW,
    permission: PERMISSIONS.CORE.OPERATING_TASKS_MANAGE,
    inputSchema: z.object({ taskId: z.string().min(1), note: z.string().min(1) }),
    run: (args, ctx) =>
      ctx.services.operatingTasks.addNote(
        ctx.principal.user.tenantId, args.taskId as string, ctx.principal.user.id, args.note as string),
  },
```
Add `import { PERMISSIONS } from '@pulsar/shared';` if not already imported (it is, line 2 — extend the existing import).

(d) Add an `addNote` method to `OperationalTasksService` (Task 6 file) that appends a note as an audit entry (no status change):
```ts
async addNote(tenantId: string, id: string, userId: string, note: string) {
  const task = await this.prisma.operationalTask.findFirst({ where: { id, tenantId } });
  if (!task) throw new NotFoundException('Task not found');
  await this.audit.log({
    tenantId, userId, action: AuditAction.UPDATE,
    entityType: 'operational-task', entityId: id, after: { note },
  });
  return { ok: true };
}
```
And `listForAgent` / `getForTenant` thin wrappers:
```ts
listForAgent(tenantId: string, agentId: string) {
  return this.prisma.operationalTask.findMany({
    where: { tenantId, assigneeAgentId: agentId, status: { in: [OperationalTaskStatus.OPEN, OperationalTaskStatus.IN_PROGRESS] } },
    orderBy: { createdAt: 'asc' }, take: 50,
  });
}
getForTenant(tenantId: string, id: string) { return this.get(tenantId, id); }
```

- [ ] **Step 10: Verify the module filter already handles optional module**

Confirm `mcp-server.factory.ts` line 24 reads (edit to) `if (def.module && !enabledModules.has(def.module)) continue;` so undefined-module (core) tools are always available.

- [ ] **Step 11: Wire the adapter**

In `AgentsModule` (where `AGENT_TOOL_SERVICES` is provided — `grep -rn "AGENT_TOOL_SERVICES" apps/api/src`), extend the provided object with an `operatingTasks` adapter delegating to `OperationalTasksService`. Import `OperatingModule` into `AgentsModule` so the service is injectable.

- [ ] **Step 12: Typecheck + run agent tests**

Run: `pnpm --filter @pulsar/api typecheck && pnpm --filter @pulsar/api test -- agents`
Expected: success.

- [ ] **Step 13: Commit**

```bash
git add apps/api/src/core/agents apps/api/src/core/operating
git commit -m "feat(api): workbench agent tools + thread triggeredByRef=task:<id> through governance"
```

---

## Task 10: WorkbenchAgentRunner (headless tick)

**Files:**
- Create: `apps/api/src/core/operating/workbench-agent-runner.service.ts`
- Create: `apps/api/test-unit/workbench-agent-runner.service.spec.ts`
- Modify: `apps/api/src/core/operating/operating.module.ts`

The runner is best-effort and bounded: per tick it processes up to N AGENT-assigned OPEN tasks; for each it marks IN_PROGRESS, opens a headless Hermes session (passing `triggeredByRef = task:<id>`), drives ONE turn with a structured prompt, then closes. Hermes failure → log + revert task to OPEN, never throw.

- [ ] **Step 1: Write the failing test (drives a fake runtime)**

```ts
import { Test } from '@nestjs/testing';
import { OperationalTaskStatus } from '@pulsar/shared';
import { PrismaService } from '../src/prisma/prisma.service';
import { AgentRuntimeService } from '../src/core/agents/agent-runtime.service';
import { OperationalTasksService } from '../src/core/operating/operational-tasks.service';
import { WorkbenchAgentRunner } from '../src/core/operating/workbench-agent-runner.service';

describe('WorkbenchAgentRunner.tick', () => {
  it('opens a session per agent-assigned OPEN task and closes it, marking IN_PROGRESS', async () => {
    const task = { id: 't1', tenantId: 'ten1', status: OperationalTaskStatus.OPEN, assigneeAgentId: 'a1', title: 'late' };
    const opened: string[] = []; const closed: string[] = []; const turns: string[] = [];
    const prisma = {
      agent: { findMany: async () => [{ id: 'a1', tenantId: 'ten1', model: null, persona: null, caps: { alwaysOn: true } }] },
      operationalTask: {
        findMany: async () => [task],
        findFirst: async () => task,
        updateMany: async ({ data }: any) => { Object.assign(task, data); return { count: 1 }; },
      },
    } as unknown as PrismaService;
    const runtime = {
      openSession: async ({ triggeredByRef }: any) => { opened.push(triggeredByRef); return 'sess1'; },
      sendTurn: async function* () { turns.push('x'); yield { type: 'end' as const }; },
      closeSession: async (s: string) => { closed.push(s); },
    } as unknown as AgentRuntimeService;
    const tasksSvc = {
      start: async (t: string, id: string) => { task.status = OperationalTaskStatus.IN_PROGRESS; return task; },
    } as unknown as OperationalTasksService;

    const moduleRef = await Test.createTestingModule({
      providers: [
        WorkbenchAgentRunner,
        { provide: PrismaService, useValue: prisma },
        { provide: AgentRuntimeService, useValue: runtime },
        { provide: OperationalTasksService, useValue: tasksSvc },
      ],
    }).compile();

    const n = await moduleRef.get(WorkbenchAgentRunner).tick('http://localhost:3000/api/v1/mcp', 10);
    expect(n).toBe(1);
    expect(task.status).toBe(OperationalTaskStatus.IN_PROGRESS);
    expect(opened).toEqual(['task:t1']);
    expect(turns).toHaveLength(1);
    expect(closed).toEqual(['sess1']);
  });

  it('reverts the task to OPEN and does not throw when the runtime fails', async () => {
    const task = { id: 't1', tenantId: 'ten1', status: OperationalTaskStatus.OPEN, assigneeAgentId: 'a1', title: 'late' };
    const prisma = {
      agent: { findMany: async () => [{ id: 'a1', tenantId: 'ten1', model: null, persona: null, caps: { alwaysOn: true } }] },
      operationalTask: { findMany: async () => [task], findFirst: async () => task,
        updateMany: async ({ data }: any) => { Object.assign(task, data); return { count: 1 }; } },
    } as unknown as PrismaService;
    const runtime = { openSession: async () => { throw new Error('hermes down'); } } as unknown as AgentRuntimeService;
    const tasksSvc = { start: async () => { task.status = OperationalTaskStatus.IN_PROGRESS; return task; } } as unknown as OperationalTasksService;
    const moduleRef = await Test.createTestingModule({
      providers: [WorkbenchAgentRunner, { provide: PrismaService, useValue: prisma },
        { provide: AgentRuntimeService, useValue: runtime }, { provide: OperationalTasksService, useValue: tasksSvc }],
    }).compile();
    await expect(moduleRef.get(WorkbenchAgentRunner).tick('http://x/mcp', 10)).resolves.toBe(0);
    expect(task.status).toBe(OperationalTaskStatus.OPEN); // reverted
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @pulsar/api test -- workbench-agent-runner`
Expected: FAIL — cannot find `WorkbenchAgentRunner`.

- [ ] **Step 3: Write the runner**

`workbench-agent-runner.service.ts`:
```ts
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { AgentStatus } from '@pulsar/database';
import { OperationalTaskStatus } from '@pulsar/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AgentRuntimeService } from '../agents/agent-runtime.service';
import { OperationalTasksService } from './operational-tasks.service';

@Injectable()
export class WorkbenchAgentRunner {
  private readonly logger = new Logger(WorkbenchAgentRunner.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly runtime: AgentRuntimeService,
    private readonly tasks: OperationalTasksService,
    private readonly config?: ConfigService, // optional in unit tests
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async runCron(): Promise<void> {
    const base = this.config?.get<string>('PUBLIC_API_URL') ?? 'http://localhost:3000';
    await this.tick(`${base}/api/v1/mcp`, 10);
  }

  /** Returns the number of tasks successfully driven through one agent turn. */
  async tick(mcpUrl: string, max: number): Promise<number> {
    const agents = await this.prisma.agent.findMany({ where: { status: AgentStatus.ACTIVE } });
    const alwaysOn = agents.filter((a) => ((a.caps ?? {}) as { alwaysOn?: boolean }).alwaysOn === true);
    let driven = 0;
    let budget = max;

    for (const agent of alwaysOn) {
      if (budget <= 0) break;
      const open = await this.prisma.operationalTask.findMany({
        where: { tenantId: agent.tenantId, assigneeAgentId: agent.id, status: OperationalTaskStatus.OPEN },
        orderBy: { createdAt: 'asc' },
        take: budget,
      });
      for (const task of open) {
        if (budget <= 0) break;
        budget--;
        try {
          await this.tasks.start(task.tenantId, task.id, agent.serviceUserId);
          const sessionId = await this.runtime.openSession({
            tenantId: agent.tenantId,
            agent: { id: agent.id, model: agent.model, persona: agent.persona },
            pulsarMcpUrl: mcpUrl,
            triggeredByRef: `task:${task.id}`,
          });
          try {
            const prompt = this.buildPrompt(task);
            // Drain the single turn; the agent's tool calls hit /mcp via the session token.
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            for await (const _ev of this.runtime.sendTurn(sessionId, prompt)) { /* consume */ }
            driven++;
          } finally {
            await this.runtime.closeSession(sessionId).catch(() => undefined);
          }
        } catch (err) {
          this.logger.warn(`agent ${agent.id} task ${task.id}: ${err instanceof Error ? err.message : String(err)}`);
          // Best-effort: revert so a later tick can retry; never throw.
          await this.prisma.operationalTask
            .updateMany({ where: { id: task.id, tenantId: task.tenantId }, data: { status: OperationalTaskStatus.OPEN } })
            .catch(() => undefined);
        }
      }
    }
    return driven;
  }

  private buildPrompt(task: { id: string; title: string; category: string; subjectType: string; subjectId: string }): string {
    return [
      `You have one assigned operating task to work.`,
      `Task id: ${task.id}`,
      `Category: ${task.category}`,
      `Title: ${task.title}`,
      `Subject: ${task.subjectType} ${task.subjectId}`,
      ``,
      `Use get_task to read details, investigate with your read tools, and either propose a`,
      `corrective action (it will be queued for human approval) or resolve_task with a note if`,
      `no action is needed. Do not ask the user questions — act autonomously within your tools.`,
    ].join('\n');
  }
}
```

- [ ] **Step 4: Extend `AgentRuntimeService.openSession` to accept the ref**

In `agent-runtime.service.ts`, add `triggeredByRef?: string` to `OpenSessionInput` and pass it into `mintSessionToken`:
```ts
      const token = this.agents.mintSessionToken(input.agent.id, 300, input.triggeredByRef);
```

- [ ] **Step 5: Register the runner + import AgentsModule into OperatingModule**

In `operating.module.ts`: `imports: [AuditLogsModule, AgentsModule]`, add `WorkbenchAgentRunner` to providers. Verify no circular import: `AgentsModule` imports `OperatingModule` (Task 9 step 11) AND `OperatingModule` imports `AgentsModule` → use `forwardRef(() => AgentsModule)` on the OperatingModule side and `forwardRef(() => OperatingModule)` on the AgentsModule side. Inject with `@Inject(forwardRef(() => AgentRuntimeService))` if Nest reports a cycle.

- [ ] **Step 6: Run the test**

Run: `pnpm --filter @pulsar/api test -- workbench-agent-runner`
Expected: PASS (2 tests).

- [ ] **Step 7: Build the whole API + typecheck**

Run: `pnpm --filter @pulsar/api typecheck`
Expected: success (resolve any forwardRef cycle errors before moving on).

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/core/operating/workbench-agent-runner.service.ts apps/api/test-unit/workbench-agent-runner.service.spec.ts apps/api/src/core/operating/operating.module.ts apps/api/src/core/agents/agent-runtime.service.ts
git commit -m "feat(api): WorkbenchAgentRunner — bounded best-effort headless agent tick"
```

---

## Task 11: Web — /workbench inbox page + nav

**Files:**
- Create: `apps/web/src/routes/(app)/workbench/+page.svelte`
- Modify: `apps/web/src/routes/(app)/+layout.svelte` (nav entry)

Follow the existing list+Panel pattern. Read `apps/web/src/routes/(app)/agent-actions/+page.svelte` first to mirror exact imports (`api` client, UI components, `$state`/`$effect`, Panel usage).

- [ ] **Step 1: Build the page (mirror agent-actions structure)**

`+page.svelte` — list of tasks with status/assignee filters, a Panel detail showing the task subject, its linked proposed actions, and Resolve/Dismiss/Assign actions. Use:
```svelte
<script lang="ts">
  import { api } from '$lib/api/client';
  // ...mirror the UI component imports used by agent-actions/+page.svelte
  type Task = {
    id: string; type: string; category: string; status: string; severity: string;
    title: string; subjectType: string; subjectId: string; assigneeType: string;
    createdAt: string; proposedActions?: { id: string; tool: string; status: string }[];
  };
  let tasks = $state<Task[]>([]);
  let total = $state(0);
  let statusFilter = $state('OPEN');
  let selected = $state<Task | null>(null);
  let error = $state('');

  async function load() {
    try {
      const res = await api<{ items: Task[]; total: number }>(
        `/operational-tasks?status=${statusFilter}&pageSize=50`,
      );
      tasks = res.items; total = res.total;
    } catch (e) { error = e instanceof Error ? e.message : 'Failed to load'; }
  }
  async function open(t: Task) {
    selected = await api<Task>(`/operational-tasks/${t.id}`);
  }
  async function resolve(id: string) {
    await api(`/operational-tasks/${id}/resolve`, { method: 'POST', body: { note: 'Resolved from workbench' } });
    selected = null; await load();
  }
  async function dismiss(id: string) {
    await api(`/operational-tasks/${id}/dismiss`, { method: 'POST', body: {} });
    selected = null; await load();
  }
  $effect(() => { statusFilter; load(); });
</script>
<!-- list + Panel markup mirroring agent-actions; render task.title, severity badge,
     subject link, and (in the Panel) the proposedActions with their status. -->
```
(Match the real `api()` signature — confirm whether the body key is `body` or `json` by reading the client + an existing POST call in agent-actions.)

- [ ] **Step 2: Add the nav entry**

In `(app)/+layout.svelte`, add a "Workbench" nav item gated on the permission, mirroring how `agent-actions` is gated:
```svelte
{#if hasPermission('core.operating.tasks.read')}
  <a href="/workbench">Workbench</a>
{/if}
```
(Use the exact permission-check helper + markup the layout already uses for agent-actions.)

- [ ] **Step 3: Typecheck web + build**

Run: `pnpm --filter @pulsar/web check`
Expected: no Svelte/TS errors. (Use the repo's actual web typecheck script — confirm in `apps/web/package.json`.)

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/routes/(app)/workbench apps/web/src/routes/(app)/+layout.svelte
git commit -m "feat(web): operating workbench inbox page + nav entry"
```

---

## Task 12: End-to-end test

**Files:**
- Create: `apps/api/test/phase12-operating-workbench.e2e-spec.ts`

Reuse the seeded DB + login helpers from an existing e2e (read `apps/api/test/*.e2e-spec.ts` headers for the bootstrap pattern: `Test.createTestingModule({ imports: [AppModule] })`, login as admin, unique master-data codes). Reuse the fake ACP server from `phase11b-agents-employes.e2e-spec.ts` for the headless turn.

- [ ] **Step 1: Write the e2e covering the full loop**

Scenario A (human path):
```ts
// 1. emit a stop.delayed domain event directly via DomainEventsService (resolve from app)
//    OR seed a late stop and call DelayDetectionService.tick(futureDate).
// 2. call domainEvents.processPending(50) → expect 1.
// 3. GET /operational-tasks?status=OPEN → expect a DELAY task (assigneeType UNASSIGNED, no always-on agent).
// 4. POST /operational-tasks/:id/resolve → 200; status RESOLVED.
// 5. GET again with status=OPEN → task no longer listed.
```
Scenario B (agent path, fake ACP):
```ts
// 1. register an agent with caps { alwaysOn: true, handlesCategories: ['DELAY'] } + PLANNING_MANAGE perm.
// 2. emit stop.delayed + processPending → task auto-assigned (assigneeType AGENT).
// 3. run WorkbenchAgentRunner.tick(mcpUrl, 10) with the fake ACP wired to call `tender_load`
//    (or assign_shipment) via /mcp → expect a ProposedAction created with triggeredByRef='task:<id>'.
// 4. GET /operational-tasks/:id → proposedActions array contains it.
// 5. approve via POST /agent-actions/:id/approve → EXECUTED.
```
Write concrete assertions with supertest, following the existing e2e style exactly (status codes, response shapes).

- [ ] **Step 2: Run the e2e (needs seeded DB)**

```bash
pnpm db:up && pnpm db:migrate && pnpm db:seed
pnpm --filter @pulsar/api test:e2e -- phase12-operating-workbench
```
Expected: PASS (both scenarios).

- [ ] **Step 3: Commit**

```bash
git add apps/api/test/phase12-operating-workbench.e2e-spec.ts
git commit -m "test(api): phase12 operating workbench e2e (human + agent paths)"
```

---

## Task 13: Full verification + docs + CLAUDE.md rule

**Files:**
- Modify: `CLAUDE.md`, `docs/etat-du-projet.md`, `ROADMAP.md`
- Modify: `docs/agents.md` (mention workbench tools) if it enumerates tools.

- [ ] **Step 1: Full build (catches shared-aliasing breakage — lesson from phase 11)**

Run: `pnpm build`
Expected: shared → database → api → web all build. If `packages/shared` introduced any `node:*` import at module top-level, it will break the web build — fix with lazy `require` (CommonJS) as done for `risk.ts`. (Our shared additions are pure data — should be clean.)

- [ ] **Step 2: Full typecheck + unit + e2e**

```bash
pnpm typecheck
pnpm test
pnpm test:e2e
```
Expected: all green (new unit specs + phase12 e2e included).

- [ ] **Step 3: Add hard rule 27 to CLAUDE.md**

Under a new "## Hard rules (continued, phase 12)" heading, add:
```
27. (phase 12) Les `OperationalTask` ne changent de statut QUE via `canTransitionOperationalTask`
    (`@pulsar/shared/workflows`). Une tâche produite par une policy est idempotente sur
    `(tenantId, dedupKey)`. Les domain events passent par `DomainEventsService.emit` (best-effort,
    jamais bloquant) ; le worker `processPending` est race-safe (claim `PENDING→PROCESSED`).
    Le `WorkbenchAgentRunner` est best-effort et isolé (Hermes absent ⇒ skip, tâche revenue OPEN,
    jamais de crash) ; les actions de l'agent passent TOUJOURS par la file `ProposedAction` avec
    `triggeredByRef = "task:<id>"` — l'autonomie n'exécute jamais hors caps.
```

- [ ] **Step 4: Update status docs**

Add a phase-12 row to the table in `docs/etat-du-projet.md` and mark Phase 12 ✅ in `ROADMAP.md`. Update the "chiffres" line (4 core operating endpoints, 21st migration already counted → now describes the workbench).

- [ ] **Step 5: Commit + push**

```bash
git add CLAUDE.md docs ROADMAP.md
git commit -m "docs(phase-12): operating workbench shipped — rule 27 + status sync"
git push -u origin phase-12
```

- [ ] **Step 6: Hand off for PR**

Provide the PR link `https://github.com/SamChampagne/Pulsar/pull/new/phase-12` for Sam to open + merge.

---

## Self-Review notes (author)

- **Spec coverage:** DomainEventsService (§Composants 1) → Task 5; EventPolicy (§2) → Task 2; OperationalTask + state machine (§3) → Tasks 1, 4, 6; inbox API+web (§4) → Tasks 7, 11; WorkbenchAgentRunner (§5) → Task 10; workbench tools + triggeredByRef (§6) → Task 9; DelayDetection upgrade (§7) → Task 8; migration → Task 4; tests → Tasks 1,2,5,6,10,12; rule 27 → Task 13. All spec sections mapped.
- **Deferred (per spec "Hors périmètre"):** data-driven policies, all-agents always-on/heartbeat, ExceptionCase as a second table, configurability — none appear as tasks. Correct.
- **Open verification points flagged inline** (not placeholders — explicit "read X first" checks): exact `RequirePermissions`/`CurrentUser` decorator paths; the `api()` client body key; seed admin-role permission source; PrismaModule globality; the forwardRef cycle between AgentsModule↔OperatingModule; in-scope variable names at the 3 emit sites. These are codebase confirmations, with the intended change fully specified.
- **Type consistency:** `triggeredByRef` string `task:<id>` used consistently across Tasks 6, 9, 10, 12; `assignHint`/`AUTO` consistent Tasks 2, 5; `canTransitionOperationalTask` signature consistent Tasks 1, 6.
