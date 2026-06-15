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
      findFirst: async () => agent,
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
    expect(h.task.status).toBe(OperationalTaskStatus.OPEN);
  });
});
