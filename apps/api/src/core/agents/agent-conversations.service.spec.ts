import { AgentConversationsService } from './agent-conversations.service';

describe('Global chat data projection', () => {
  it('scopes workers and default model to the JWT tenant with closed projections', async () => {
    const db = {
      agent: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'a', model: null },
          { id: 'b', model: 'worker-model' },
        ]),
      },
      agentRuntimeConfig: {
        findUnique: jest.fn().mockResolvedValue({ defaultModel: 'tenant-model' }),
      },
    };
    const service = new AgentConversationsService(db as never);
    expect(await service.workers('tenant-a')).toEqual([
      { id: 'a', model: 'tenant-model' },
      { id: 'b', model: 'worker-model' },
    ]);
    expect(db.agent.findMany).toHaveBeenCalledWith({
      where: { tenantId: 'tenant-a' },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, role: true, avatar: true, model: true, status: true },
    });
    expect(db.agentRuntimeConfig.findUnique).toHaveBeenCalledWith({
      where: { tenantId: 'tenant-a' },
      select: { defaultModel: true },
    });
  });
  it('titles only an owned untitled conversation, without an auxiliary LLM', async () => {
    const db = { agentConversation: { updateMany: jest.fn() } };
    await new AgentConversationsService(db as never).titleFromMessage(
      't',
      'u',
      'c',
      '  Bonjour\n monde ',
    );
    expect(db.agentConversation.updateMany).toHaveBeenCalledWith({
      where: { id: 'c', tenantId: 't', userId: 'u', title: null },
      data: { title: 'Bonjour monde' },
    });
  });
});
