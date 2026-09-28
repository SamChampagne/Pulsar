import { AgentRunStatus, AgentStatus, OperationalTaskStatus } from '@pulsar/shared';
import { AgentWorkerService } from './agent-worker.service';
import type { AcpEvent } from '../agents/hermes-acp.client';

function harness(
  overrides: Partial<{
    openSession: () => Promise<string>;
    start: () => Promise<unknown>;
    events: AcpEvent[];
  }> = {},
) {
  const calls: string[] = [];
  const agent = {
    id: 'a1',
    tenantId: 't1',
    model: null,
    persona: null,
    serviceUserId: 'svc1',
    status: AgentStatus.ACTIVE,
    autonomyLevel: 'AUTONOMOUS',
    caps: { alwaysOn: true },
  };
  const task = {
    id: 'task1',
    tenantId: 't1',
    status: OperationalTaskStatus.OPEN,
    assigneeAgentId: 'a1',
    title: 'late',
    category: 'DELAY',
    severity: 'WARNING',
    subjectType: 'stop',
    subjectId: 's1',
    slaDueAt: null,
  };
  const runs: any[] = [];
  const revertCalls: any[] = [];
  const prisma = {
    agentRun: { findFirst: async () => runs.at(-1) ?? null },
    agent: {
      findMany: async () => [agent],
      findFirst: async () => agent,
      findUnique: async () => agent,
      update: async () => agent,
    },
    operationalTask: {
      findFirst: async () => task,
      findMany: async () => (task.status === OperationalTaskStatus.OPEN ? [task] : []),
      updateMany: async ({ where, data }: any) => {
        // A revert is an updateMany guarded on status IN_PROGRESS -> OPEN.
        if (
          where.status === OperationalTaskStatus.IN_PROGRESS &&
          data.status === OperationalTaskStatus.OPEN
        ) {
          revertCalls.push({ where, data });
        }
        if (where.status === undefined || task.status === where.status) {
          Object.assign(task, data);
          return { count: 1 };
        }
        return { count: 0 };
      },
    },
    proposedAction: { count: async () => 0 },
  } as any;
  const ledger = {
    createQueued: async () => {
      const id = `r${runs.length + 1}`;
      runs.push({ id, status: AgentRunStatus.QUEUED });
      return id;
    },
    markRunning: async (id: string) => {
      runs.find((r) => r.id === id).status = AgentRunStatus.RUNNING;
    },
    bumpAttempt: async (id: string) => {
      runs.find((r) => r.id === id).status = AgentRunStatus.QUEUED;
    },
    finish: async (id: string, status: AgentRunStatus) => {
      runs.find((r) => r.id === id).status = status;
    },
  } as any;
  const runtime = {
    openSession:
      overrides.openSession ??
      (async () => {
        calls.push('open');
        return 'sess1';
      }),
    sendTurn: async function* () {
      calls.push('turn');
      yield* overrides.events ?? [
        { type: 'result', result: { version: 1, status: 'succeeded' } },
        { type: 'end' },
      ];
    },
    closeSession: async () => {
      calls.push('close');
    },
    killAgentSessions: async () => {
      calls.push('kill');
      return 1;
    },
  } as any;
  const tasks = {
    start:
      overrides.start ??
      (async () => {
        task.status = OperationalTaskStatus.IN_PROGRESS;
        return task;
      }),
    releaseWorkerClaim: async (tenantId: string, id: string) =>
      prisma.operationalTask.updateMany({
        where: { id, tenantId, status: OperationalTaskStatus.IN_PROGRESS },
        data: { status: OperationalTaskStatus.OPEN },
      }),
  } as any;
  const svc = new AgentWorkerService(prisma, runtime, tasks, ledger, undefined, {
    getEnabledKeys: async () => new Set(['manufacturing', 'wms', 'crm']),
  } as any);
  return { svc, calls, runs, task, agent, revertCalls, runtime };
}

describe('AgentWorkerService', () => {
  it.each([
    [[{ type: 'end' }], 'FAILED'],
    [[{ type: 'error', message: 'provider refused' }, { type: 'end' }], 'FAILED'],
    [
      [
        { type: 'result', result: { version: 1, status: 'failed', code: 'RUNTIME_FAILURE' } },
        { type: 'end' },
      ],
      'FAILED',
    ],
    [
      [
        { type: 'result', result: { version: 1, status: 'cancelled', code: 'CANCELLED' } },
        { type: 'end' },
      ],
      'KILLED',
    ],
  ])('never succeeds or retries an unsuccessful turn', async (events, status) => {
    const h = harness({ events: events as AcpEvent[] });
    expect(await h.svc.tick('http://x/mcp', 1)).toBe(0);
    expect(h.runs[0].status).toBe(status);
    expect(h.calls).toEqual(['open', 'turn', 'close']);
    expect(h.task.status).toBe('OPEN');
    expect(h.revertCalls[0].where.tenantId).toBe('t1');
    expect(await h.svc.tick('http://x/mcp', 1)).toBe(0);
    await h.svc.enqueueTask('t1', 'a1', 'task1');
    expect(h.runs).toHaveLength(1); // cron/event never revive a terminal run
  });
  it('skips an ineligible MRP worker before claiming the task or opening Hermes', async () => {
    const h = harness();
    h.task.category = 'MRP_REVIEW';
    expect(await h.svc.tick('http://x/mcp', 10)).toBe(0);
    expect(h.task.status).toBe('OPEN');
    expect(h.calls).toEqual([]);
    expect(h.runs[0].status).toBe('SKIPPED');
    expect(h.revertCalls).toEqual([]);
  });
  it('does not reopen a task resolved before a terminal stream error', async () => {
    const h = harness();
    h.runtime.sendTurn = async function* () {
      h.task.status = OperationalTaskStatus.RESOLVED;
      const { ServiceUnavailableException } = await import('@nestjs/common');
      throw new ServiceUnavailableException('lost connection after an action');
    };
    expect(await h.svc.tick('http://x/mcp', 1)).toBe(0);
    expect(h.task.status).toBe('RESOLVED');
    expect(h.runs[0].status).toBe('FAILED');
    expect(h.calls).toEqual(['open', 'close']); // no connectivity retry after turn started
  });
  it('permits explicit manual retry after a terminal failure', async () => {
    const h = harness({ events: [{ type: 'end' }] });
    await h.svc.tick('http://x/mcp', 1);
    expect(h.runs[0].status).toBe('FAILED');
    const next = await h.svc.runNow('t1', 'a1');
    expect(next.enqueued).toBe(true);
    expect(h.runs).toHaveLength(2);
  });
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
    const h = harness({
      openSession: async () => {
        throw new BadRequestException('not installed');
      },
    });
    const driven = await h.svc.tick('http://x/mcp', 10);
    expect(driven).toBe(0);
    expect(h.runs[0].status).toBe(AgentRunStatus.SKIPPED);
    expect(h.task.status).toBe(OperationalTaskStatus.OPEN); // reverted
  });

  it('retries then FAILS on a connectivity error, reverting the task to OPEN', async () => {
    const { ServiceUnavailableException } = await import('@nestjs/common');
    const h = harness({
      openSession: async () => {
        throw new ServiceUnavailableException('hermes down');
      },
    });
    await h.svc.tick('http://x/mcp', 10);
    expect(h.runs[0].status).toBe(AgentRunStatus.FAILED);
    expect(h.task.status).toBe(OperationalTaskStatus.OPEN);
  });

  it('does NOT revert a task it never claimed (tasks.start rejects) — finishes SKIPPED', async () => {
    const { BadRequestException } = await import('@nestjs/common');
    // Simulate the race: another run already claimed the task → it is IN_PROGRESS,
    // and this run's tasks.start rejects (cannot transition IN_PROGRESS -> IN_PROGRESS).
    const h = harness({
      start: async () => {
        h.task.status = OperationalTaskStatus.IN_PROGRESS; // the winner already flipped it
        throw new BadRequestException(
          'Cannot transition OperationalTask from IN_PROGRESS to IN_PROGRESS',
        );
      },
    });

    const driven = await h.svc.tick('http://x/mcp', 10);

    // This run did not succeed.
    expect(driven).toBe(0);
    // It must finish SKIPPED (redundant trigger), never FAILED.
    expect(h.runs[0].status).toBe(AgentRunStatus.SKIPPED);
    // CRITICAL: it must NOT have reverted the task — the winning run's IN_PROGRESS stands.
    expect(h.revertCalls).toHaveLength(0);
    expect(h.task.status).toBe(OperationalTaskStatus.IN_PROGRESS);
  });
});
