import { AgentAutonomy } from '@pulsar/shared';
import { AgentsService } from './agents.service';

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
