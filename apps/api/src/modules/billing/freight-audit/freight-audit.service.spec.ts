import { FreightAuditStatus } from '@pulsar/shared';
import { FreightAuditService } from './freight-audit.service';

function makeService(loads: Record<string, { id: string; estimatedCost: number | null }>) {
  const invoice: any = {
    id: 'inv1',
    tenantId: 't1',
    carrierId: 'c1',
    currency: 'CAD',
    status: FreightAuditStatus.RECEIVED,
    varianceTotal: null,
    lines: [
      { id: 'l1', lineRef: 'LD-1', chargedAmount: 100 },
      { id: 'l2', lineRef: 'LD-2', chargedAmount: 500 },
    ],
  };
  const prisma = {
    incomingCarrierInvoice: {
      findFirst: async () => invoice,
      updateMany: async ({ where, data }: any) => {
        const ok =
          where.status === undefined ||
          invoice.status === where.status ||
          (where.status?.in ?? []).includes(invoice.status);
        if (ok) {
          Object.assign(invoice, data);
          return { count: 1 };
        }
        return { count: 0 };
      },
    },
    incomingInvoiceLine: { updateMany: async () => ({ count: 1 }) },
    load: { findFirst: async ({ where }: any) => loads[where.loadNumber] ?? null },
    tenantModule: { findFirst: async () => ({ settings: {} }) },
    $transaction: async (ops: any[]) => Promise.all(ops),
  } as any;
  const ownership = {
    assertOwned: async () => undefined,
    assertOwnedIfSet: async () => undefined,
  } as any;
  const audit = { log: async () => undefined } as any;
  const customFields = { validateValues: async () => undefined } as any;
  const domainEvents = { emit: async () => undefined } as any;
  const moduleSettings = {
    resolve: async () => ({ tolerancePct: 2, toleranceAbsolute: 25 }),
  } as any;
  return {
    svc: new FreightAuditService(
      prisma,
      ownership,
      audit,
      customFields,
      domainEvents,
      moduleSettings,
    ),
    invoice,
  };
}

describe('FreightAuditService.audit', () => {
  it('reports recovered savings separately per currency and keeps the tenant filter', async () => {
    const findMany = jest.fn().mockResolvedValue([
      { currency: 'CAD', recoveredAmount: 12.35, disputedByAgentId: null },
      { currency: 'USD', recoveredAmount: 18.4, disputedByAgentId: 'agent1' },
      { currency: 'CAD', recoveredAmount: 7.65, disputedByAgentId: 'agent1' },
    ]);
    const svc = new FreightAuditService(
      { incomingCarrierInvoice: { findMany } } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
    const result = await svc.savings('tenant-a', 30);
    expect(result.byCurrency).toEqual([
      { currency: 'CAD', recovered: 20 },
      { currency: 'USD', recovered: 18.4 },
    ]);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: 'tenant-a',
          resolvedAt: { gte: expect.any(Date) },
        }),
        select: expect.objectContaining({ currency: true }),
      }),
    );
  });
  it('FLAGGED when a matched line is overcharged beyond tolerance', async () => {
    const { svc, invoice } = makeService({
      'LD-1': { id: 'a', estimatedCost: 100 },
      'LD-2': { id: 'b', estimatedCost: 400 },
    });
    await svc.audit('t1', 'u1', 'inv1');
    expect(invoice.status).toBe(FreightAuditStatus.FLAGGED);
    expect(Number(invoice.varianceTotal)).toBe(100);
  });
  it('MATCHED when within tolerance', async () => {
    const { svc, invoice } = makeService({
      'LD-1': { id: 'a', estimatedCost: 100 },
      'LD-2': { id: 'b', estimatedCost: 500 },
    });
    await svc.audit('t1', 'u1', 'inv1');
    expect(invoice.status).toBe(FreightAuditStatus.MATCHED);
  });
  it('FLAGGED when a line cannot be matched (unverifiable)', async () => {
    const { svc, invoice } = makeService({ 'LD-1': { id: 'a', estimatedCost: 100 } });
    await svc.audit('t1', 'u1', 'inv1');
    expect(invoice.status).toBe(FreightAuditStatus.FLAGGED);
  });
});
