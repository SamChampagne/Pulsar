import { MaintenanceOrderStatus, MaintenanceType } from '@pulsar/shared';
import { MaintenanceService } from './maintenance.service';

function harness(assetStatus = 'AVAILABLE', otherOrders = 0) {
  const vehicle = { id: 'v1', tenantId: 't1', status: assetStatus };
  const wo: any = {
    id: 'wo1',
    tenantId: 't1',
    vehicleId: 'v1',
    trailerId: null,
    status: MaintenanceOrderStatus.OPEN,
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  };
  const prisma = {
    $transaction: async (run: any) => run(prisma),
    $queryRaw: async () => [{ id: 't1' }],
    vehicle: {
      findFirst: async () => vehicle,
      updateMany: async ({ where, data }: any) => {
        if (where.status === undefined || vehicle.status === where.status) {
          Object.assign(vehicle, data);
          return { count: 1 };
        }
        return { count: 0 };
      },
    },
    trailer: { findFirst: async () => null, updateMany: async () => ({ count: 0 }) },
    maintenanceOrder: {
      create: async ({ data }: any) => {
        Object.assign(wo, data);
        return wo;
      },
      findFirst: async () => wo,
      findMany: async () => [wo],
      count: async () => otherOrders + (['OPEN', 'IN_PROGRESS'].includes(wo.status) ? 1 : 0),
      updateMany: async ({ where, data }: any) => {
        if (
          where.status === undefined ||
          wo.status === where.status ||
          (where.status?.in ?? []).includes(wo.status)
        ) {
          Object.assign(wo, data);
          return { count: 1 };
        }
        return { count: 0 };
      },
    },
  } as any;
  const ownership = { assertOwnedIfSet: async () => undefined } as any;
  const audit = { log: async () => undefined } as any;
  const customFields = { validateValues: async () => undefined } as any;
  const domainEvents = { emit: async () => undefined } as any;
  return {
    svc: new MaintenanceService(prisma, ownership, audit, customFields, domainEvents),
    vehicle,
    wo,
  };
}

describe('MaintenanceService', () => {
  it('create on a vehicle flips it to MAINTENANCE', async () => {
    const h = harness('AVAILABLE');
    await h.svc.create('t1', 'u1', {
      vehicleId: 'v1',
      type: MaintenanceType.REPAIR,
      description: 'brakes',
    } as any);
    expect(h.vehicle.status).toBe('MAINTENANCE');
  });
  it('complete returns the vehicle to AVAILABLE + COMPLETED', async () => {
    const h = harness('MAINTENANCE');
    await h.svc.complete('t1', 'u1', 'wo1', { costAmount: 250 } as any);
    expect(h.wo.status).toBe(MaintenanceOrderStatus.COMPLETED);
    expect(h.vehicle.status).toBe('AVAILABLE');
  });
  it('rejects create with neither asset', async () => {
    const h = harness();
    await expect(
      h.svc.create('t1', 'u1', { type: MaintenanceType.REPAIR, description: 'x' } as any),
    ).rejects.toThrow();
  });
  it('rejects create with BOTH assets', async () => {
    const h = harness();
    await expect(
      h.svc.create('t1', 'u1', {
        vehicleId: 'v1',
        trailerId: 'tr1',
        type: MaintenanceType.REPAIR,
        description: 'x',
      } as any),
    ).rejects.toThrow();
  });
  it('does not release an asset with another active order', async () => {
    const h = harness('MAINTENANCE', 1);
    await h.svc.complete('t1', 'u1', 'wo1', {});
    expect(h.vehicle.status).toBe('MAINTENANCE');
  });
  it.each(['RETIRED', 'IN_SERVICE'])('does not overwrite %s on closing', async (status) => {
    const h = harness(status);
    await h.svc.cancel('t1', 'u1', 'wo1');
    expect(h.vehicle.status).toBe(status);
  });
  it('rejects stale edits without changing data', async () => {
    const h = harness();
    await expect(
      h.svc.update('t1', 'u1', 'wo1', {
        expectedUpdatedAt: '2025-01-01T00:00:00Z',
        description: 'stale',
      }),
    ).rejects.toThrow('Cet ordre a changé');
    expect(h.wo.description).toBeUndefined();
  });
  it('clears a due date, advances the version and refuses a closed order edit', async () => {
    const h = harness('MAINTENANCE');
    const version = h.wo.updatedAt.toISOString();
    await h.svc.update('t1', 'u1', 'wo1', { expectedUpdatedAt: version, dueDate: null });
    expect(h.wo.dueDate).toBeNull();
    expect(h.wo.updatedAt.toISOString()).not.toBe(version);
    await h.svc.complete('t1', 'u1', 'wo1', {});
    await expect(h.svc.update('t1', 'u1', 'wo1', { description: 'closed' })).rejects.toThrow(
      'terminé ou annulé',
    );
  });
});
