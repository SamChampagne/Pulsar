import { DriverAccessService } from './driver-access.service';
import { driverReference } from './driver-reference';

const load = {
  id: 'load-private',
  tenantId: 'tenant-private',
  status: 'IN_TRANSIT',
  driverId: 'driver-private',
  updatedAt: new Date('2026-10-02T12:00:00Z'),
  loadNumber: 'LD-1',
};
function fixture() {
  const tx = {
    load: { findUnique: jest.fn(async () => load as typeof load | null) },
    tenant: { findUnique: jest.fn(async () => ({ status: 'ACTIVE' })) },
    tenantModule: {
      findFirst: jest.fn(async () => ({ moduleId: 'tms' }) as { moduleId: string } | null),
    },
    $queryRaw: jest.fn(async () => [{ id: load.id }]),
  };
  const global = {
    load: {
      findUnique: jest.fn(() => {
        throw new Error('Global client forbidden');
      }),
    },
  };
  return { tx, global, service: new DriverAccessService(global as any) };
}

describe('Driver capability references', () => {
  it('is deterministic but separated by token, resource kind and internal ID', () => {
    const ref = driverReference('token-a', 'shipment', 'internal-id');
    expect(ref).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(ref).toBe(driverReference('token-a', 'shipment', 'internal-id'));
    expect(ref).not.toContain('internal-id');
    expect(ref).not.toBe(driverReference('token-b', 'shipment', 'internal-id'));
    expect(ref).not.toBe(driverReference('token-a', 'stop', 'internal-id'));
    expect(ref).not.toBe(driverReference('token-a', 'shipment', 'other-id'));
  });
});

describe('DriverAccessService', () => {
  it('resolves the minimal load and checks tenant/module in the provided transaction only', async () => {
    const f = fixture();
    expect(await f.service.resolve('token', f.tx as any)).toEqual(load);
    expect(f.tx.tenant.findUnique).toHaveBeenCalledWith({
      where: { id: load.tenantId },
      select: { status: true },
    });
    expect(f.tx.tenantModule.findFirst).toHaveBeenCalledWith({
      where: { tenantId: load.tenantId, enabled: true, module: { key: 'transportation' } },
      select: { moduleId: true },
    });
    expect(f.global.load.findUnique).not.toHaveBeenCalled();
  });
  it('rejects an unknown or revoked token', async () => {
    const f = fixture();
    f.tx.load.findUnique.mockResolvedValue(null);
    await expect(f.service.resolve('revoked', f.tx as any)).rejects.toThrow('Unknown driver link');
    expect(f.tx.tenant.findUnique).not.toHaveBeenCalled();
  });
  it('refuses suspended tenants and permits active trials', async () => {
    const f = fixture();
    f.tx.tenant.findUnique.mockResolvedValue({ status: 'SUSPENDED' });
    await expect(f.service.resolve('token', f.tx as any)).rejects.toThrow('not active');
    f.tx.tenant.findUnique.mockResolvedValue({ status: 'TRIAL' });
    await expect(f.service.resolve('token', f.tx as any)).resolves.toEqual(load);
  });
  it('refuses disabled Transportation without relying on a module cache', async () => {
    const f = fixture();
    f.tx.tenantModule.findFirst.mockResolvedValue(null);
    await expect(f.service.resolve('token', f.tx as any)).rejects.toThrow('not enabled');
  });
  it('revalidates the token after acquiring the tenant-scoped load lock', async () => {
    const f = fixture();
    f.tx.load.findUnique.mockResolvedValueOnce(load).mockResolvedValueOnce(null);
    await expect(f.service.lock('rotated', f.tx as any)).rejects.toThrow('Unknown driver link');
    expect(f.tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(f.tx.$queryRaw.mock.calls[0].slice(1)).toEqual([load.id, load.tenantId]);
    expect(f.global.load.findUnique).not.toHaveBeenCalled();
  });
  it('refuses a capability moved to another load while its original load was being locked', async () => {
    const f = fixture();
    f.tx.load.findUnique
      .mockResolvedValueOnce(load)
      .mockResolvedValueOnce({ ...load, id: 'other-load' });
    await expect(f.service.lock('moved-token', f.tx as any)).rejects.toThrow('Unknown driver link');
  });
  it('rechecks module activation after acquiring the lock', async () => {
    const f = fixture();
    f.tx.$queryRaw.mockImplementation(async () => {
      f.tx.tenantModule.findFirst.mockResolvedValue(null);
      return [{ id: load.id }];
    });
    await expect(f.service.lock('token', f.tx as any)).rejects.toThrow('not enabled');
  });
  it.each(['COMPLETED', 'CANCELLED'])(
    'rejects closed %s mutations with the legacy closed message',
    (status) => {
      expect(() => fixture().service.assertMutable(status)).toThrow('closed');
    },
  );
  it.each(['OPEN', 'PLANNED', 'TENDERED'])('rejects premature %s driver mutations', (status) => {
    expect(() => fixture().service.assertMutable(status)).toThrow('DISPATCHED or IN_TRANSIT');
  });
  it.each(['DISPATCHED', 'IN_TRANSIT'])('permits %s mutations', (status) => {
    expect(() => fixture().service.assertMutable(status)).not.toThrow();
  });
});
