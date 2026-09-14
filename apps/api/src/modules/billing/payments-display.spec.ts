import { PaymentsService } from './payments.service';

describe('Payment display projections', () => {
  let prisma: any;
  let service: PaymentsService;
  beforeEach(() => {
    prisma = Object.fromEntries(
      ['payment', 'customer', 'carrier', 'customerInvoice', 'invoice'].map((key) => [
        key,
        { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn() },
      ]),
    );
    service = new PaymentsService(
      prisma,
      null as any,
      null as any,
      null as any,
      null as any,
      null as any,
      null as any,
    );
  });

  it('batches unique party IDs by family and tenant with explicit projections', async () => {
    prisma.payment.findMany.mockResolvedValue([
      { id: 'p1', partyType: 'CUSTOMER', partyId: 'same-id' },
      { id: 'p2', partyType: 'CUSTOMER', partyId: 'same-id' },
      { id: 'p3', partyType: 'CARRIER', partyId: 'same-id' },
    ]);
    prisma.customer.findMany.mockResolvedValue([{ id: 'same-id', name: 'Client' }]);
    prisma.carrier.findMany.mockResolvedValue([{ id: 'same-id', name: 'Transporteur' }]);
    const rows = await service.list('tenant-a');
    expect(prisma.payment.findMany.mock.calls[0][0].where.tenantId).toBe('tenant-a');
    for (const kind of ['customer', 'carrier'])
      expect(prisma[kind].findMany).toHaveBeenCalledWith({
        where: { tenantId: 'tenant-a', id: { in: ['same-id'] } },
        select: { id: true, name: true },
      });
    expect(rows.map((p) => p.party?.name)).toEqual(['Client', 'Client', 'Transporteur']);
  });

  it('resolves invoice numbers by family without projecting sensitive invoice data', async () => {
    prisma.payment.findFirst.mockResolvedValue({
      id: 'p',
      partyType: 'CUSTOMER',
      partyId: 'c',
      allocations: [
        { targetType: 'CUSTOMER_INVOICE', targetId: 'same-id' },
        { targetType: 'CARRIER_INVOICE', targetId: 'same-id' },
      ],
    });
    prisma.customerInvoice.findMany.mockResolvedValue([{ id: 'same-id', invoiceNumber: 'CI-1' }]);
    prisma.invoice.findMany.mockResolvedValue([{ id: 'same-id', invoiceNumber: 'INV-1' }]);
    const record = await service.get('tenant-a', 'p');
    expect(record.allocations.map((a) => a.target?.invoiceNumber)).toEqual(['CI-1', 'INV-1']);
    for (const kind of ['customerInvoice', 'invoice'])
      expect(prisma[kind].findMany).toHaveBeenCalledWith({
        where: { tenantId: 'tenant-a', id: { in: ['same-id'] } },
        select: { id: true, invoiceNumber: true },
      });
  });

  it('represents unavailable relationships as null, never raw foreign data', async () => {
    prisma.payment.findFirst.mockResolvedValue({
      id: 'p',
      partyType: 'CARRIER',
      partyId: 'unavailable',
      allocations: [{ targetType: 'CARRIER_INVOICE', targetId: 'unavailable' }],
    });
    const record = await service.get('tenant-a', 'p');
    expect(record.party).toBeNull();
    expect(record.allocations[0].target).toBeNull();
  });

  it('stops before relationship lookups when the tenant cannot read a payment', async () => {
    prisma.payment.findFirst.mockResolvedValue(null);
    await expect(service.get('tenant-b', 'p')).rejects.toThrow('Payment not found');
    expect(prisma.customer.findMany).not.toHaveBeenCalled();
    expect(prisma.invoice.findMany).not.toHaveBeenCalled();
  });
});
