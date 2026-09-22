import { RiskTier, PERMISSIONS, AgentAutonomy } from '@pulsar/shared';
import { connectedBusinessTools } from './connected-business.tools';
import { ProposedActionsService } from '../proposed-actions.service';
describe('Connected business agent tools', () => {
  it('exposes only two guarded mutations, no HR decisions or invoice writes', () => {
    expect(
      connectedBusinessTools.filter((t) => t.tier === RiskTier.MUTATING).map((t) => t.name),
    ).toEqual(['services_schedule_job', 'support_set_followup']);
    expect(
      connectedBusinessTools.find((t) => t.name === 'services_billable_context')
        ?.additionalPermissions,
    ).toContain(PERMISSIONS.BILLING.CUSTOMER_INVOICES_READ);
    expect(
      connectedBusinessTools.find((t) => t.name === 'services_schedule_job')?.additionalPermissions,
    ).toContain(PERMISSIONS.HR.AVAILABILITY_READ);
  });
  it('requires a bounded duration and source version', () => {
    const schema = connectedBusinessTools.find(
      (t) => t.name === 'services_schedule_job',
    )!.inputSchema;
    expect(
      schema.safeParse({
        jobId: 'job',
        assigneeUserId: 'user',
        plannedMinutes: 0,
        localStart: '2026-09-22T09:00',
      }).success,
    ).toBe(false);
  });
  it('passes the principal to existing services, never a request tenant', async () => {
    const planning = jest.fn().mockResolvedValue({});
    const principal = { user: { id: 'service-user', tenantId: 'tenant' } };
    await connectedBusinessTools
      .find((t) => t.name === 'services_planning')!
      .run({ date: '2026-09-22' }, {
        principal,
        services: { connectedBusiness: { planning } },
      } as never);
    expect(planning).toHaveBeenCalledWith(principal.user, { date: '2026-09-22' });
  });
  it('never lets an agent acknowledge unknown planning checks', () => {
    const tool = connectedBusinessTools.find((t) => t.name === 'services_schedule_job')!;
    expect(
      tool.inputSchema.safeParse({
        jobId: 'job',
        assigneeUserId: 'worker',
        localStart: '2030-01-07T09:00',
        plannedMinutes: 60,
        expectedUpdatedAt: '2030-01-01T00:00:00.000Z',
        acknowledgeUnknown: true,
      }).success,
    ).toBe(false);
  });
  it.each(['services_schedule_job', 'support_set_followup'])(
    '%s stays pending in PROPOSE without invoking the business writer',
    async (name) => {
      const created: Record<string, unknown>[] = [];
      const db = {
        proposedAction: {
          count: async () => 0,
          findUnique: async () => null,
          findMany: async () => [],
          create: async ({ data }: { data: Record<string, unknown> }) => {
            created.push(data);
            return { id: 'proposal', ...data };
          },
        },
        agent: { findFirst: async () => ({ breakerTrippedAt: null }) },
      };
      const service = new ProposedActionsService(
        db as never,
        { log: async () => {} } as never,
        { notify: async () => {} } as never,
        { getEnabledKeys: async () => new Set(['services', 'hr', 'support']) } as never,
      );
      const run = jest.fn();
      const tool = { ...connectedBusinessTools.find((t) => t.name === name)!, run };
      const result = await service.handleMutatingTool(
        {
          agentId: 'agent',
          name: 'Coordinator',
          autonomyLevel: AgentAutonomy.PROPOSE,
          caps: {},
          user: { id: 'service-user', tenantId: 'tenant', permissions: [] },
        } as never,
        tool,
        { caseId: 'case', expectedUpdatedAt: '2030-01-01T00:00:00.000Z' },
        {} as never,
      );
      expect(result.effect).toBe('PROPOSE');
      expect(created[0].status).toBe('PENDING');
      expect(run).not.toHaveBeenCalled();
    },
  );
});
