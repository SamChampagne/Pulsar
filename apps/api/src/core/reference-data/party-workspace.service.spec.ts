import { PartyWorkspaceService } from './party-workspace.service';
import { PARTY_ACCESS, type AuthUser } from '@pulsar/shared';

describe('Party workspace least privilege', () => {
  const access = PARTY_ACCESS.find((a) => a.path === 'clients/data/customers')!;
  const actor = (permissions: string[]) => ({ tenantId: 'tenant', permissions }) as AuthUser;
  function fixture(
    enabled = ['clients', 'services', 'billing', 'crm', 'support', 'transportation'],
  ) {
    const tx = {
      customer: { findFirst: jest.fn(async () => ({ id: 'customer', name: 'Client' })) },
      businessPartner: { findFirstOrThrow: jest.fn() },
      crmCompany: { findFirstOrThrow: jest.fn() },
      serviceProject: { count: jest.fn(async () => 0), findMany: jest.fn(async () => []) },
      serviceJob: { count: jest.fn(async () => 0), findMany: jest.fn(async () => []) },
      serviceQuote: { count: jest.fn(async () => 0), findMany: jest.fn(async () => []) },
      supportCase: { count: jest.fn(), findMany: jest.fn() },
      customerInvoice: { count: jest.fn(), findMany: jest.fn() },
      crmDeal: { count: jest.fn(), findMany: jest.fn() },
      salesOrder: { count: jest.fn(), findMany: jest.fn() },
      transportOrder: { count: jest.fn(), findMany: jest.fn() },
    };
    const db = { $transaction: jest.fn(async (fn) => fn(tx)) };
    const service = new PartyWorkspaceService(
      db as any,
      { getEnabledKeys: async () => new Set(enabled) } as any,
    );
    return { tx, db, service };
  }
  it('does not query inaccessible modules, even for counters or identity links', async () => {
    const { service, tx, db } = fixture();
    const view = await service.get(
      actor(['clients.read', 'services.read']),
      access,
      'customer',
      {},
    );
    expect(view.sections.map((s) => s.key)).toEqual([
      'service-project',
      'service-job',
      'service-quote',
    ]);
    for (const delegate of [
      tx.supportCase,
      tx.customerInvoice,
      tx.crmDeal,
      tx.salesOrder,
      tx.transportOrder,
    ]) {
      expect(delegate.count).not.toHaveBeenCalled();
      expect(delegate.findMany).not.toHaveBeenCalled();
    }
    expect(tx.businessPartner.findFirstOrThrow).not.toHaveBeenCalled();
    expect(tx.crmCompany.findFirstOrThrow).not.toHaveBeenCalled();
    expect(tx.serviceProject.count).toHaveBeenCalledWith({
      where: { tenantId: 'tenant', partner: { tenantId: 'tenant', billingCustomerId: 'customer' } },
    });
    expect(db.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'RepeatableRead',
    });
  });
  it('does not infer document access from a customer or payment grant', async () => {
    const { service } = fixture();
    const view = await service.get(
      actor(['clients.read', 'billing.payments.read']),
      access,
      'customer',
      {},
    );
    expect(view.sections).toEqual([]);
    expect(view.items).toEqual([]);
    expect(view.source).toBeNull();
  });
  it('does not query a disabled module with a valid permission', async () => {
    const { service, tx } = fixture(['clients']);
    const view = await service.get(
      actor(['clients.read', 'services.read']),
      access,
      'customer',
      {},
    );
    expect(view.sections).toEqual([]);
    expect(tx.serviceProject.count).not.toHaveBeenCalled();
  });
  it('rejects requested forbidden sections before lookup, without revealing existence', async () => {
    const { service, db } = fixture();
    await expect(
      service.get(actor(['clients.read']), access, 'customer', { source: 'customer-invoice' }),
    ).rejects.toMatchObject({ status: 403 });
    expect(db.$transaction).not.toHaveBeenCalled();
  });
  it('rechecks source module and permission for internal callers', async () => {
    const { service, db } = fixture(['services']);
    await expect(
      service.get(actor(['clients.read', 'services.read']), access, 'customer', {}),
    ).rejects.toMatchObject({ status: 403 });
    expect(db.$transaction).not.toHaveBeenCalled();
  });
  it('propagates a read error instead of inventing zero counts', async () => {
    const { service, tx } = fixture();
    tx.serviceProject.count.mockRejectedValueOnce(new Error('database unavailable'));
    await expect(
      service.get(actor(['clients.read', 'services.read']), access, 'customer', {}),
    ).rejects.toThrow('database unavailable');
  });
});
