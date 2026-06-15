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
