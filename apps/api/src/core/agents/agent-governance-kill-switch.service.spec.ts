import { AgentStatus } from '@pulsar/shared';
import { AgentsService } from './agents.service';
import { ProposedActionsService } from './proposed-actions.service';
import { ProposalStatus } from '@pulsar/shared';
import { TOOL_BY_NAME } from './tool-registry';

// The PAUSED kill switch (rule 28) and permanent REVOKE must hold at BOTH the
// MCP key-validation boundary (validateKey) and the human-approval boundary
// (ProposedActionsService.approve). These tests pin both.

function agentRow(status: AgentStatus) {
  return {
    id: 'a1',
    tenantId: 't1',
    status,
    serviceUserId: 'svc1',
    name: 'Dispatcher',
    permissions: [],
    caps: {},
    autonomyLevel: 'PROPOSE',
  };
}

function makeAgentsService(status: AgentStatus) {
  const prisma = {
    agent: {
      // validateKey falls back to findUnique-by-secretHash for a non-token key.
      findUnique: async () => agentRow(status),
      update: async () => agentRow(status),
    },
  } as any;
  process.env.JWT_SECRET = 'test-secret';
  return new AgentsService(prisma, {} as any, {} as any, {} as any);
}

describe('AgentsService.validateKey — kill switch', () => {
  it('accepts an ACTIVE agent', async () => {
    const svc = makeAgentsService(AgentStatus.ACTIVE);
    const principal = await svc.validateKey('raw-key-not-a-token');
    expect(principal.agentId).toBe('a1');
  });

  it('rejects a PAUSED agent (hot kill switch)', async () => {
    const svc = makeAgentsService(AgentStatus.PAUSED);
    await expect(svc.validateKey('raw-key-not-a-token')).rejects.toThrow('Invalid agent key');
  });

  it('rejects a REVOKED agent', async () => {
    const svc = makeAgentsService(AgentStatus.REVOKED);
    await expect(svc.validateKey('raw-key-not-a-token')).rejects.toThrow('Invalid agent key');
  });
});

function makeProposedActions(agentStatus: AgentStatus) {
  const toolName = [...TOOL_BY_NAME.keys()][0]; // any registered tool; the guard fires before run()
  const prisma = {
    proposedAction: {
      findFirst: async () => ({
        id: 'p1',
        tenantId: 't1',
        tool: toolName,
        agentId: 'a1',
        status: ProposalStatus.PENDING,
      }),
      updateMany: async () => ({ count: 1 }),
      update: async () => ({}),
    },
    agent: {
      findUniqueOrThrow: async () => agentRow(agentStatus),
      findFirstOrThrow: async () => agentRow(agentStatus),
    },
  } as any;
  const audit = { log: async () => undefined } as any;
  const notifications = { notify: async () => undefined } as any;
  return {
    svc: new ProposedActionsService(prisma, audit, notifications, {
      getEnabledKeys: async () => ({ has: () => true }),
    } as any),
    toolName,
  };
}

describe('ProposedActionsService.approve — kill switch', () => {
  it("refuses to execute a PAUSED agent's pending action", async () => {
    const { svc } = makeProposedActions(AgentStatus.PAUSED);
    await expect(svc.approve('t1', 'p1', 'approver1', {} as any)).rejects.toThrow(
      /Agent is PAUSED/,
    );
  });

  it("refuses to execute a REVOKED agent's pending action", async () => {
    const { svc } = makeProposedActions(AgentStatus.REVOKED);
    await expect(svc.approve('t1', 'p1', 'approver1', {} as any)).rejects.toThrow(
      /Agent is REVOKED/,
    );
  });
});
