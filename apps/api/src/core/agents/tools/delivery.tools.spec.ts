import { RiskTier, DeliveryExceptionStatus } from '@pulsar/shared';
import { deliveryTools } from './delivery.tools';
import type { ToolContext } from '../tool-types';
describe('delivery agent contracts', () => {
  const find = (name: string) => deliveryTools.find((t) => t.name === name)!;
  it('reads through the service adapter using tenant from principal, never arguments', async () => {
    const context = jest.fn().mockResolvedValue({ load: 'scoped' });
    const tool = find('get_delivery_context');
    expect(tool.tier).toBe(RiskTier.READ);
    expect(tool.module).toBe('transportation');
    expect(tool.permission).toBe('transportation.planning.read');
    expect(tool.inputSchema.safeParse({ loadId: 'load', tenantId: 'other' }).success).toBe(false);
    await tool.run({ loadId: 'load' }, {
      principal: { user: { tenantId: 'tenant' } },
      services: { delivery: { context } },
    } as unknown as ToolContext);
    expect(context).toHaveBeenCalledWith('tenant', 'load');
  });
  it('bounds list reads and rejects unknown filters and pages', () => {
    const schema = find('list_delivery_operations').inputSchema;
    expect(schema.safeParse({ pageSize: 10001 }).success).toBe(false);
    expect(schema.safeParse({ filter: 'all_business' }).success).toBe(false);
    expect(schema.safeParse({ page: 1, filter: 'returns' }).success).toBe(true);
  });
  it('marks retry MUTATING for the governance gate, with versions and no physical return tool', async () => {
    const tool = find('plan_delivery_retry');
    expect(tool.tier).toBe(RiskTier.MUTATING);
    expect(tool.additionalPermissions).toContain('transportation.planning.read');
    expect(tool.permission).toBe('transportation.execution.manage');
    expect(deliveryTools.some((t) => /receive.*return|return.*receive|stock/.test(t.name))).toBe(
      false,
    );
    const args = {
      exceptionId: 'case',
      operationKey: '7c52aa7e-18c4-414a-a02c-aa02c19c7bac',
      expectedVersion: 1,
      expectedPackageVersion: 3,
      expectedLoadUpdatedAt: '2026-10-03T12:00:00Z',
      retryAt: '2026-10-05T12:00:00Z',
      note: 'Client présent lundi.',
    };
    expect(tool.inputSchema.safeParse({ ...args, target: 'RETURN_RECEIVED' }).success).toBe(false);
    expect(tool.inputSchema.safeParse({ ...args, expectedVersion: undefined }).success).toBe(false);
    const retry = jest.fn().mockResolvedValue({});
    await tool.run(tool.inputSchema.parse(args), {
      principal: { user: { tenantId: 'tenant', id: 'service-agent' } },
      services: { delivery: { retry } },
    } as unknown as ToolContext);
    expect(retry).toHaveBeenCalledWith(
      'tenant',
      'service-agent',
      'case',
      expect.objectContaining({
        target: DeliveryExceptionStatus.RETRY_PLANNED,
        expectedVersion: 1,
        operationKey: args.operationKey,
      }),
    );
  });
});
