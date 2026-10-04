import { TrackingService } from './tracking.service';

describe('TrackingService POD transaction participation', () => {
  function fixture() {
    const global = {
      shipment: {
        findFirst: jest.fn(() => {
          throw new Error('Global client forbidden');
        }),
      },
    };
    const tx = {
      shipment: { findFirst: jest.fn(async () => ({ id: 'shipment', status: 'IN_TRANSIT' })) },
      proofOfDelivery: {
        findFirst: jest.fn(async () => null as { id: string } | null),
        create: jest.fn(async (args) => ({ id: 'pod', ...args.data })),
      },
    };
    return { global, tx, service: new TrackingService(global as any, {} as any) };
  }
  it('reads and writes within the caller transaction with tenant-scoped proof checks', async () => {
    const f = fixture();
    await f.service.createPod(
      'tenant',
      undefined,
      { shipmentId: 'shipment', signedByName: 'Receiver' },
      f.tx as any,
    );
    expect(f.global.shipment.findFirst).not.toHaveBeenCalled();
    expect(f.tx.proofOfDelivery.findFirst).toHaveBeenCalledWith({
      where: { tenantId: 'tenant', shipmentId: 'shipment' },
      select: { id: true },
    });
    expect(f.tx.proofOfDelivery.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId: 'tenant',
          shipmentId: 'shipment',
          signedByName: 'Receiver',
        }),
      }),
    );
  });
  it('preserves the no-overwrite rule for existing PODs', async () => {
    const f = fixture();
    f.tx.proofOfDelivery.findFirst.mockResolvedValue({ id: 'existing-pod' });
    await expect(
      f.service.createPod('tenant', undefined, { shipmentId: 'shipment' }, f.tx as any),
    ).rejects.toThrow('already exists');
    expect(f.tx.proofOfDelivery.create).not.toHaveBeenCalled();
  });
  it('rejects PODs before transit', async () => {
    const f = fixture();
    f.tx.shipment.findFirst.mockResolvedValue({ id: 'shipment', status: 'DISPATCHED' });
    await expect(
      f.service.createPod('tenant', undefined, { shipmentId: 'shipment' }, f.tx as any),
    ).rejects.toThrow('IN_TRANSIT or DELIVERED');
    expect(f.tx.proofOfDelivery.create).not.toHaveBeenCalled();
  });
});
