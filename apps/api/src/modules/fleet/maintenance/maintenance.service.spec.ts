import { MaintenanceOrderStatus, MaintenanceType } from '@pulsar/shared';
import { MaintenanceService } from './maintenance.service';

function harness(assetStatus = 'AVAILABLE') {
  const vehicle = { id: 'v1', tenantId: 't1', status: assetStatus };
  const wo: any = { id: 'wo1', tenantId: 't1', vehicleId: 'v1', trailerId: null, status: MaintenanceOrderStatus.OPEN };
  const prisma = {
    vehicle: { findFirst: async () => vehicle, updateMany: async ({ where, data }: any) => { if (where.status === undefined || vehicle.status === where.status) { Object.assign(vehicle, data); return { count: 1 }; } return { count: 0 }; } },
    trailer: { findFirst: async () => null, updateMany: async () => ({ count: 0 }) },
    maintenanceOrder: {
      create: async ({ data }: any) => { Object.assign(wo, data); return wo; },
      findFirst: async () => wo,
      findMany: async () => [wo],
      updateMany: async ({ where, data }: any) => { if (where.status === undefined || wo.status === where.status || (where.status?.in ?? []).includes(wo.status)) { Object.assign(wo, data); return { count: 1 }; } return { count: 0 }; },
    },
  } as any;
  const ownership = { assertOwnedIfSet: async () => undefined } as any;
  const audit = { log: async () => undefined } as any;
  return { svc: new MaintenanceService(prisma, ownership, audit), vehicle, wo };
}

describe('MaintenanceService', () => {
  it('create on a vehicle flips it to MAINTENANCE', async () => {
    const h = harness('AVAILABLE');
    await h.svc.create('t1', 'u1', { vehicleId: 'v1', type: MaintenanceType.REPAIR, description: 'brakes' } as any);
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
    await expect(h.svc.create('t1', 'u1', { type: MaintenanceType.REPAIR, description: 'x' } as any)).rejects.toThrow();
  });
  it('rejects create with BOTH assets', async () => {
    const h = harness();
    await expect(h.svc.create('t1', 'u1', { vehicleId: 'v1', trailerId: 'tr1', type: MaintenanceType.REPAIR, description: 'x' } as any)).rejects.toThrow();
  });
});
