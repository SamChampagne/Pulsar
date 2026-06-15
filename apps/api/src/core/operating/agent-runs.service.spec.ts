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
