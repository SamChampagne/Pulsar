import { AgentAutonomy } from '@pulsar/shared';
import { AgentsService } from './agents.service';

function makeService() {
  const prisma = {
    agent: {
      findFirst: async () => ({ id: 'a1', tenantId: 't1', autonomyLevel: AgentAutonomy.PROPOSE, status: 'ACTIVE' }),
      update: async ({ data }: any) => ({ id: 'a1', ...data }),
    },
    proposedAction: {
      count: async ({ where }: any) =>
        where.status === 'EXECUTED' ? 30 : where.status === 'REJECTED' ? 1 : where.status === 'FAILED' ? 0 : 0,
    },
    agentRun: { count: async ({ where }: any) => (where.status === 'SUCCEEDED' ? 30 : 30) },
    auditLog: { count: async () => 0 },
  } as any;
  process.env.JWT_SECRET = 'test-secret';
  return new AgentsService(prisma, {} as any, {} as any, {} as any);
}

describe('AgentsService trust + resetBreaker', () => {
  it('trust() returns a score + readiness for an agent with a clean record', async () => {
    const svc = makeService();
    const r = await svc.trust('t1', 'a1');
    expect(r.score).toBeGreaterThan(0);
    expect(typeof r.readyForNext).toBe('boolean');
    expect(r.currentLevel).toBe(AgentAutonomy.PROPOSE);
  });
  it('resetBreaker() clears breakerTrippedAt', async () => {
    const svc = makeService();
    const r = await svc.resetBreaker('t1', 'a1');
    expect(r).toEqual({ breakerReset: true });
  });
});
