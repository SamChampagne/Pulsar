import { Prisma } from '@pulsar/database';
import type { AuthUser } from '@pulsar/shared';
import { DeliveryAllocationService } from './delivery-allocation.service';
import type { CreateDeliveryAllocationDto } from './delivery-allocation.dto';

const date = new Date('2026-10-03T12:00:00.000Z');
const key = 'AAAA1111-1111-4111-8111-111111111111';
const user = { id: 'u', tenantId: 't', permissions: ['crm.read', 'wms.read'] } as AuthUser;
const decimal = (value: string) => new Prisma.Decimal(value);
function fixture() {
  const pkg: any = {
    id: 'p',
    tenantId: 't',
    shipmentId: 's',
    code: 'PKG-1',
    status: 'PREPARED',
    version: 1,
    contents: [{ reference: 'AX', description: 'Axes', quantity: '2.125', unit: 'ea' }],
  };
  const shipment: any = {
    id: 's',
    tenantId: 't',
    status: 'PLANNED',
    loadId: 'l',
    transportOrderId: 'to',
    originLocationId: 'site',
    updatedAt: date,
    transportOrder: { sourceSalesOrderId: 'so' },
    load: { status: 'PLANNED' },
  };
  const load = { id: 'l', status: 'PLANNED', updatedAt: date };
  const source: any = {
    id: 'sl',
    tenantId: 't',
    salesOrderId: 'so',
    name: 'Axes',
    quantity: decimal('5'),
    updatedAt: date,
    salesOrder: { id: 'so', tenantId: 't', status: 'CONFIRMED', number: 'SO-1', updatedAt: date },
  };
  const pick: any = {
    id: 'pl',
    tenantId: 't',
    qty: decimal('5'),
    pickOrderId: 'po',
    itemId: 'i',
    fromBinId: 'bin',
    lotId: null,
    item: { id: 'i', tenantId: 't', sku: 'AX', name: 'Axes', unit: 'ea' },
    pickOrder: { id: 'po', number: 'PK-1', locationId: 'site', updatedAt: date, completedAt: date },
  };
  const operations: any[] = [],
    allocations: any[] = [];
  const tx: any = {
    $executeRaw: jest.fn(async () => 1),
    $queryRaw: jest.fn(async () => []),
    deliveryPackage: {
      findFirst: jest.fn(async ({ where }: any) =>
        where.tenantId === 't' && where.id === pkg.id ? { ...pkg } : null,
      ),
      findFirstOrThrow: jest.fn(async () => ({ ...pkg })),
      findMany: jest.fn(async () => [{ ...pkg }]),
      updateMany: jest.fn(async () => {
        pkg.version++;
        return { count: 1 };
      }),
    },
    shipment: {
      findFirstOrThrow: jest.fn(async () => shipment),
      findFirst: jest.fn(async () => shipment),
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
    load: {
      findFirstOrThrow: jest.fn(async () => load),
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
    deliveryPackageEvent: {
      findFirst: jest.fn(async () => null),
      findMany: jest.fn(async () => []),
    },
    user: { findFirst: jest.fn(async () => ({ id: 'u' })) },
    transportOrder: { findFirstOrThrow: jest.fn(async () => ({ sourceSalesOrderId: 'so' })) },
    salesOrderLineItem: {
      findFirst: jest.fn(async ({ where }: any) =>
        where.id === source.id && where.salesOrderId === source.salesOrderId ? source : null,
      ),
      findMany: jest.fn(async () => []),
    },
    pickLine: { findFirst: jest.fn(async () => pick), findMany: jest.fn(async () => []) },
    deliveryAllocationOperation: {
      findUnique: jest.fn(
        async ({ where }: any) =>
          operations.find((o) => o.operationKey === where.tenantId_operationKey.operationKey) ??
          null,
      ),
      create: jest.fn(async ({ data }: any) => {
        operations.push(data);
        return data;
      }),
    },
    deliveryContentAllocation: {
      findFirst: jest.fn(
        async ({ where }: any) =>
          allocations.find(
            (a) =>
              (!where.id || a.id === where.id) &&
              (!where.packageId || a.packageId === where.packageId) &&
              (where.contentIndex === undefined || a.contentIndex === where.contentIndex) &&
              (!Object.hasOwn(where, 'releasedAt') || a.releasedAt === where.releasedAt),
          ) ?? null,
      ),
      findMany: jest.fn(async ({ where }: any) =>
        allocations
          .filter(
            (a) =>
              a.releasedAt === null &&
              (typeof where.sourceSalesOrderLineId !== 'string' ||
                a.sourceSalesOrderLineId === where.sourceSalesOrderLineId) &&
              (typeof where.sourcePickLineId !== 'string' ||
                a.sourcePickLineId === where.sourcePickLineId),
          )
          .map((a) => ({ ...a, package: { status: a.packageStatus ?? pkg.status } })),
      ),
      create: jest.fn(async ({ data }: any) => {
        const a = {
          ...data,
          id: `a${allocations.length + 1}`,
          quantity: decimal(data.quantity),
          createdAt: date,
          releasedAt: null,
        };
        allocations.push(a);
        return a;
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const a = allocations.find((v) => v.id === where.id && v.releasedAt === null);
        if (!a) return { count: 0 };
        Object.assign(a, data);
        return { count: 1 };
      }),
    },
  };
  const prisma = { $transaction: jest.fn(async (callback: any) => callback(tx)) };
  const modules = {
    getEnabledKeys: jest.fn(async () => new Set(['transportation', 'crm', 'wms'])),
  };
  const audit = { log: jest.fn(async () => {}) };
  const service = new DeliveryAllocationService(prisma as any, modules as any, audit as any);
  const dto: CreateDeliveryAllocationDto = {
    operationKey: key,
    packageId: 'p',
    contentIndex: 0,
    expectedVersion: 1,
    sourceSalesOrderLineId: 'sl',
    sourcePickLineId: 'pl',
    salesUnitAcknowledged: true,
    expectedSalesLineUpdatedAt: date.toISOString(),
    expectedSalesOrderUpdatedAt: date.toISOString(),
    expectedPickUpdatedAt: date.toISOString(),
  };
  return {
    service,
    tx,
    prisma,
    modules,
    audit,
    pkg,
    shipment,
    load,
    source,
    pick,
    dto,
    allocations,
    operations,
  };
}

describe('DeliveryAllocationService', () => {
  it('captures both explicit sources and contents with no stock writer', async () => {
    const f = fixture();
    const result: any = await f.service.create(user, f.dto);
    expect(result).toMatchObject({
      operationKey: key.toLowerCase(),
      packageId: 'p',
      version: 2,
      released: false,
    });
    expect(f.allocations[0].sourceSnapshot).toMatchObject({
      schemaVersion: 1,
      siteId: 'site',
      sales: { unitBasis: 'HUMAN_ATTESTED_1_TO_1', quantity: '5' },
      pick: { quantity: '5', unit: 'ea', locationId: 'site' },
    });
    expect(f.allocations[0].quantity.toFixed()).toBe('2.125');
    expect(f.audit.log).toHaveBeenCalledTimes(1);
    expect(f.tx.$executeRaw).toHaveBeenCalledTimes(2); // operation then business
    expect(f.tx.$queryRaw.mock.calls.map((call: any[]) => call[0].join(' '))).toEqual(
      expect.arrayContaining([
        expect.stringContaining('tenants'),
        expect.stringContaining('loads'),
        expect.stringContaining('shipments'),
      ]),
    );
  });
  it('replays exactly after versions changed; UUID casing does not duplicate', async () => {
    const f = fixture();
    const first = await f.service.create(user, f.dto);
    f.pkg.status = 'DELIVERED';
    f.pkg.version = 9;
    expect(await f.service.create(user, { ...f.dto, operationKey: key.toLowerCase() })).toEqual(
      first,
    );
    expect(f.allocations).toHaveLength(1);
    expect(f.audit.log).toHaveBeenCalledTimes(1);
  });
  it('rejects operation key reuse by different body or actor', async () => {
    const f = fixture();
    await f.service.create(user, f.dto);
    await expect(f.service.create(user, { ...f.dto, contentIndex: 1 })).rejects.toThrow(
      'autre demande',
    );
    await expect(f.service.create({ ...user, id: 'other' }, f.dto)).rejects.toThrow(
      'autre demande',
    );
  });
  it('checks modules and rights before reading private source records', async () => {
    const f = fixture();
    f.modules.getEnabledKeys.mockResolvedValue(new Set(['transportation']));
    await expect(f.service.create(user, f.dto)).rejects.toThrow('CRM');
    expect(f.prisma.$transaction).not.toHaveBeenCalled();
    expect(f.tx.salesOrderLineItem.findFirst).not.toHaveBeenCalled();
  });
  it('does not query CRM or WMS when Transport operates alone', async () => {
    const f = fixture();
    f.modules.getEnabledKeys.mockResolvedValue(new Set(['transportation']));
    const result = await f.service.list({ ...user, permissions: [] }, 's');
    expect(result.access).toEqual({ sales: false, picking: false });
    expect(result.salesLines).toEqual([]);
    expect(result.pickLines).toEqual([]);
    expect(f.tx.salesOrderLineItem.findMany).not.toHaveBeenCalled();
    expect(f.tx.pickLine.findMany).not.toHaveBeenCalled();
  });
  it('requires human 1:1 attestation for CRM without inferred units', async () => {
    const f = fixture();
    await expect(
      f.service.create(user, { ...f.dto, salesUnitAcknowledged: false }),
    ).rejects.toThrow('Confirmez explicitement');
    f.tx.user.findFirst.mockResolvedValue(null);
    await expect(f.service.create(user, f.dto)).rejects.toThrow('humain actif');
  });
  it('accepts WMS alone without querying CRM or human attestation', async () => {
    const f = fixture();
    f.modules.getEnabledKeys.mockResolvedValue(new Set(['transportation', 'wms']));
    await f.service.create(user, {
      ...f.dto,
      sourceSalesOrderLineId: undefined,
      salesUnitAcknowledged: undefined,
    });
    expect(f.tx.salesOrderLineItem.findFirst).not.toHaveBeenCalled();
    expect(f.tx.user.findFirst).not.toHaveBeenCalled();
    expect(f.allocations[0].sourceSalesOrderLineId).toBeNull();
  });
  it('requires strict WMS unit equality and source parent version', async () => {
    const f = fixture();
    f.pick.item.unit = 'EA';
    await expect(f.service.create(user, f.dto)).rejects.toThrow('strictement identique');
    f.pick.item.unit = 'ea';
    await expect(
      f.service.create(user, { ...f.dto, expectedPickUpdatedAt: '2020-01-01T00:00:00Z' }),
    ).rejects.toThrow('préparation a changé');
  });
  it('refuses missing/wrong CRM source and stale commercial version', async () => {
    const f = fixture();
    await expect(
      f.service.create(user, { ...f.dto, sourceSalesOrderLineId: 'foreign' }),
    ).rejects.toThrow('commande CRM confirmée');
    await expect(
      f.service.create(user, { ...f.dto, expectedSalesLineUpdatedAt: undefined }),
    ).rejects.toThrow('source commerciale a changé');
  });
  it('checks package version and content index', async () => {
    const f = fixture();
    await expect(f.service.create(user, { ...f.dto, expectedVersion: 2 })).rejects.toThrow(
      'colis a changé',
    );
    await expect(f.service.create(user, { ...f.dto, contentIndex: 3 })).rejects.toThrow(
      'inexistante',
    );
  });
  it('refuses double attribution and over-allocation including returned packages', async () => {
    const f = fixture();
    await f.service.create(user, f.dto);
    await expect(
      f.service.create(user, {
        ...f.dto,
        operationKey: 'bbbb1111-1111-4111-8111-111111111111',
        expectedVersion: 2,
      }),
    ).rejects.toThrow('déjà attribuée');
    f.allocations[0].packageId = 'old';
    f.allocations[0].contentIndex = 1;
    f.allocations[0].quantity = decimal('4');
    f.allocations[0].packageStatus = 'RETURNED';
    await expect(
      f.service.create(user, {
        ...f.dto,
        operationKey: 'bbbb1111-1111-4111-8111-111111111111',
        expectedVersion: 2,
      }),
    ).rejects.toThrow('dépasse');
  });
  it('retains immutable source history after release and permits exact release replay', async () => {
    const f = fixture();
    await f.service.create(user, f.dto);
    const snapshot = JSON.stringify(f.allocations[0].sourceSnapshot);
    const body = { operationKey: 'bbbb1111-1111-4111-8111-111111111111', expectedVersion: 2 };
    const receipt = await f.service.release(user, 'a1', body);
    expect(f.allocations[0].releasedById).toBe('u');
    expect(JSON.stringify(f.allocations[0].sourceSnapshot)).toBe(snapshot);
    expect(await f.service.release(user, 'a1', body)).toEqual(receipt);
  });
  it('cannot release or reassign after the first physical loading, even unloaded', async () => {
    const f = fixture();
    await f.service.create(user, f.dto);
    f.tx.deliveryPackageEvent.findFirst.mockResolvedValue({ id: 'loaded' });
    await expect(
      f.service.release(user, 'a1', {
        operationKey: 'bbbb1111-1111-4111-8111-111111111111',
        expectedVersion: 2,
      }),
    ).rejects.toThrow('déjà été chargé');
    expect(f.allocations[0].releasedAt).toBeNull();
  });
  it('rejects source-less operations without touching the database', async () => {
    const f = fixture();
    await expect(
      f.service.create(user, {
        ...f.dto,
        sourceSalesOrderLineId: undefined,
        sourcePickLineId: undefined,
      }),
    ).rejects.toThrow('Choisissez');
    expect(f.prisma.$transaction).not.toHaveBeenCalled();
  });
});
