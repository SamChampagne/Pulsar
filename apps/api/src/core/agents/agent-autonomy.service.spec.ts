import { ProposalStatus, RiskTier, AgentAutonomy } from '@pulsar/shared';
import { ProposedActionsService } from './proposed-actions.service';
import type { AgentPrincipal } from './agent-principal';

function principal(overrides: Partial<AgentPrincipal['caps']> = {}, level = AgentAutonomy.AUTONOMOUS): AgentPrincipal {
  return {
    agentId: 'a1',
    name: 'agent',
    autonomyLevel: level,
    caps: { ...overrides },
    user: { id: 'svc1', tenantId: 't1', email: 'agent:agent', firstName: 'Agent', lastName: 'agent', permissions: [] },
  } as AgentPrincipal;
}

const tenderDef = {
  name: 'tender_load', tier: RiskTier.SENSITIVE,
  run: async () => ({ ok: true }),
  amountFrom: (a: Record<string, unknown>) => (typeof a.amount === 'number' ? a.amount : undefined),
} as any;

function makePrisma(created: any[], opts: { breakerTrippedAt?: Date | null; recentCount?: number } = {}) {
  return {
    proposedAction: {
      count: async () => opts.recentCount ?? 0,
      findUnique: async () => null,
      findMany: async () => [],
      create: async ({ data }: any) => { created.push(data); return { id: `p${created.length}`, ...data }; },
    },
    agent: {
      findFirst: async () => ({ breakerTrippedAt: opts.breakerTrippedAt ?? null }),
      update: async () => ({}),
    },
  } as any;
}

describe('ProposedActionsService.handleMutatingTool', () => {
  it('AUTO: runs the tool and records an EXECUTED autoApproved proposal', async () => {
    const created: any[] = [];
    const svc = new ProposedActionsService(makePrisma(created), { log: async () => undefined } as any, { notify: async () => undefined } as any);
    const res = await svc.handleMutatingTool(principal(), tenderDef, { amount: 100 }, {} as any);
    expect(res.effect).toBe('AUTO');
    expect(created.some((d) => d.status === ProposalStatus.EXECUTED && d.autoApproved === true)).toBe(true);
  });

  it('PROPOSE: enqueues a PENDING proposal when a policy demotes', async () => {
    const created: any[] = [];
    const svc = new ProposedActionsService(makePrisma(created), { log: async () => undefined } as any, { notify: async () => undefined } as any);
    const res = await svc.handleMutatingTool(
      principal({ policies: [{ tool: 'tender_load', effect: 'PROPOSE' }] }),
      tenderDef, { amount: 100 }, {} as any,
    );
    expect(res.effect).toBe('PROPOSE');
    expect(created.some((d) => d.status === ProposalStatus.PENDING)).toBe(true);
  });

  it('DENY: refuses above the hard amount cap and records nothing', async () => {
    const created: any[] = [];
    const svc = new ProposedActionsService(makePrisma(created), { log: async () => undefined } as any, { notify: async () => undefined } as any);
    const res = await svc.handleMutatingTool(principal({ maxAmountPerAction: 50 }), tenderDef, { amount: 5000 }, {} as any);
    expect(res.effect).toBe('DENY');
    expect(created).toHaveLength(0);
  });

  it('breaker active → AUTO policy is demoted to PROPOSE', async () => {
    const created: any[] = [];
    const svc = new ProposedActionsService(makePrisma(created, { breakerTrippedAt: new Date() }), { log: async () => undefined } as any, { notify: async () => undefined } as any);
    const res = await svc.handleMutatingTool(principal(), tenderDef, { amount: 100 }, {} as any);
    expect(res.effect).toBe('PROPOSE');
  });
});
