import { DeliveryPackageStatus as S } from '@pulsar/shared';
import { DeliveryPackagesService } from './delivery-packages.service';

const date = new Date('2026-10-02T12:00:00Z');
const key = '11111111-1111-4111-8111-111111111111';
const contents = [{ reference: 'CMP-42', description: 'Supports', quantity: '40', unit: 'piece' }];
function fixture() {
  const shipment: any = {
    id: 's',
    tenantId: 't',
    loadId: 'l',
    status: 'PLANNED',
    updatedAt: date,
    packageTrackingEnabledAt: null,
    transportOrderId: 'o',
    originLocationId: 'a',
    destinationLocationId: 'b',
  };
  const load: any = {
    id: 'l',
    tenantId: 't',
    loadNumber: 'LD-1',
    status: 'PLANNED',
    updatedAt: date,
    vehicleId: 'truck',
    trailerId: null,
    driverId: 'driver',
    route: null,
  };
  const parcels: any[] = [],
    events: any[] = [];
  const tx: any = {
    $queryRaw: jest.fn(async () => []),
    $executeRaw: jest.fn(async () => 0),
    shipment: {
      findFirst: jest.fn(async ({ where }: any) =>
        where.tenantId === 't' && where.id === 's' ? shipment : null,
      ),
      updateMany: jest.fn(async ({ data }: any) => {
        Object.assign(shipment, data);
        return { count: 1 };
      }),
      count: jest.fn(async () => 0),
    },
    load: {
      findFirst: jest.fn(async ({ where }: any) =>
        where.tenantId === 't' && where.id === 'l' ? load : null,
      ),
      updateMany: jest.fn(async ({ data }: any) => {
        Object.assign(load, data);
        return { count: 1 };
      }),
    },
    deliveryPackage: {
      findFirst: jest.fn(
        async ({ where }: any) =>
          parcels.find((p) => p.tenantId === where.tenantId && p.id === where.id) ?? null,
      ),
      findFirstOrThrow: jest.fn(async ({ where }: any) =>
        parcels.find((p) => p.tenantId === where.tenantId && p.id === where.id),
      ),
      count: jest.fn(
        async ({ where }: any) =>
          parcels.filter(
            (p) =>
              p.tenantId === where.tenantId &&
              p.shipmentId === where.shipmentId &&
              (!where.status || !where.status.notIn.includes(p.status)),
          ).length,
      ),
      create: jest.fn(async ({ data }: any) => {
        const p = {
          id: `p${parcels.length}`,
          status: S.PREPARED,
          version: 1,
          loadedLoadId: null,
          loadedAt: null,
          deliveredAt: null,
          createdAt: date,
          updatedAt: date,
          ...data,
        };
        parcels.push(p);
        return p;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const p = parcels.find((p) => p.id === where.tenantId_id.id);
        const { version, loadedLoad, ...rest } = data;
        Object.assign(p, rest);
        p.version += version.increment;
        if (loadedLoad)
          p.loadedLoadId = loadedLoad.disconnect ? null : loadedLoad.connect.tenantId_id.id;
        return p;
      }),
    },
    deliveryPackageEvent: {
      findFirst: jest.fn(async ({ where }: any) =>
        events.find((e) => e.tenantId === where.tenantId && e.operationKey === where.operationKey),
      ),
      create: jest.fn(async ({ data }: any) => {
        events.push(data);
        return data;
      }),
    },
    trackingEvent: { create: jest.fn(async () => ({})) },
    proofOfDelivery: { findFirst: jest.fn(async () => ({ id: 'pod' })) },
  };
  tx.$transaction = jest.fn(async (cb: any) => cb(tx));
  const sequences = { nextNumber: jest.fn(async () => `PKG-${parcels.length + 1}`) };
  const audit = { log: jest.fn(async () => undefined) };
  const settings = { resolve: jest.fn(async () => ({ podRequiredBeforeCompletion: false })) };
  const orders = { completeFromDelivery: jest.fn(async () => true) };
  const service = new DeliveryPackagesService(
    tx,
    sequences as any,
    audit as any,
    settings as any,
    orders as any,
  );
  const create = (operationKey = key) =>
    service.create('t', 'u', 's', {
      operationKey,
      expectedUpdatedAt: shipment.updatedAt.toISOString(),
      label: 'Carton composants',
      contents,
    });
  return {
    service,
    tx,
    sequences,
    audit,
    settings,
    orders,
    shipment,
    load,
    parcels,
    events,
    create,
  };
}

describe('DeliveryPackagesService', () => {
  it('permits a label-only edit despite PostgreSQL jsonb key ordering on allocated content', async () => {
    const f = fixture();
    await f.create();
    f.parcels[0].contents = [{ unit: 'piece', quantity: '40', description: 'Supports', reference: 'CMP-42' }];
    f.tx.deliveryContentAllocation = { count: jest.fn(async () => 1) };
    await f.service.edit('t', 'u', 'p0', { operationKey: 'label-only', expectedVersion: 1, label: 'Fragile', contents });
    expect(f.parcels[0].label).toBe('Fragile');
    expect(f.parcels[0].version).toBe(2);
    expect(f.tx.deliveryContentAllocation.count).not.toHaveBeenCalled();
  });
  it('clears the full-pickup time when another prepared parcel is declared', async () => {
    const f = fixture();
    f.shipment.actualPickupAt = date;
    await f.create();
    expect(f.shipment.actualPickupAt).toBeNull();
  });
  it('refuses a stale loading confirmation after resource change', async () => {
    const f = fixture();
    await f.create();
    const dto = {
      operationKey: 'stale-load',
      expectedVersion: 1,
      target: S.LOADED,
      expectedLoadId: 'l',
      expectedLoadUpdatedAt: date.toISOString(),
    };
    await expect(f.service.transition('t', 'u', 'p0', dto)).rejects.toThrow('ressources');
    expect(f.parcels[0].status).toBe(S.PREPARED);
  });
  it('creates a numbered package, exact content, opt-in marker and atomic event/audit', async () => {
    const f = fixture();
    const result = await f.create();
    expect(result).toMatchObject({ code: 'PKG-1', status: S.PREPARED, version: 1 });
    expect(f.parcels[0].contents).toEqual(contents);
    expect(f.shipment.packageTrackingEnabledAt).toBeInstanceOf(Date);
    expect(f.sequences.nextNumber).toHaveBeenCalledWith('t', 'delivery-package', f.tx);
    expect(f.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 't', userId: 'u' }),
      f.tx,
    );
    expect(f.events[0].snapshot.receipt).toEqual(result);
  });
  it('replays exactly even after the shipment/load became terminal, without new sequence', async () => {
    const f = fixture();
    const dto = {
      operationKey: key,
      expectedUpdatedAt: date.toISOString(),
      label: 'Carton',
      contents,
    };
    const first = await f.service.create('t', 'u', 's', dto);
    f.shipment.status = 'DELIVERED';
    f.load.status = 'COMPLETED';
    expect(await f.service.create('t', 'u', 's', dto)).toEqual(first);
    expect(f.sequences.nextNumber).toHaveBeenCalledTimes(1);
  });
  it('does not share an operation key across actors or changed bodies', async () => {
    const f = fixture();
    const dto = {
      operationKey: key,
      expectedUpdatedAt: date.toISOString(),
      label: 'Carton',
      contents,
    };
    await f.service.create('t', 'u', 's', dto);
    await expect(f.service.create('t', 'other', 's', dto)).rejects.toThrow('autre demande');
    await expect(f.service.create('t', 'u', 's', { ...dto, label: 'Autre' })).rejects.toThrow(
      'autre demande',
    );
  });
  it('rejects invalid quantity without opening a write transaction', async () => {
    const f = fixture();
    await expect(
      f.service.create('t', 'u', 's', {
        operationKey: key,
        expectedUpdatedAt: date.toISOString(),
        label: '',
        contents: [{ ...contents[0], quantity: '-1' }],
      }),
    ).rejects.toThrow();
    expect(f.tx.$transaction).not.toHaveBeenCalled();
  });
  it('rejects another tenant shipment and package', async () => {
    const f = fixture();
    await f.create();
    await expect(
      f.service.create('foreign', 'u', 's', {
        operationKey: key,
        expectedUpdatedAt: date.toISOString(),
        label: '',
        contents,
      }),
    ).rejects.toThrow('introuvable');
    await expect(
      f.service.edit('foreign', 'u', 'p0', {
        operationKey: key,
        expectedVersion: 1,
        label: '',
        contents,
      }),
    ).rejects.toThrow('introuvable');
  });
  it('rejects stale shipment versions and late package creation', async () => {
    const f = fixture();
    await f.create();
    await expect(
      f.service.create('t', 'u', 's', {
        operationKey: 'new',
        expectedUpdatedAt: date.toISOString(),
        label: '',
        contents,
      }),
    ).rejects.toThrow('modifiée');
    f.load.status = 'DISPATCHED';
    await expect(f.create('other')).rejects.toThrow('avant engagement');
  });
  it('edits only prepared contents and keeps revisions in the journal', async () => {
    const f = fixture();
    await f.create();
    await f.service.edit('t', 'u', 'p0', {
      operationKey: 'edit',
      expectedVersion: 1,
      label: 'Palette',
      contents,
    });
    expect(f.parcels[0].version).toBe(2);
    expect(f.events[0].snapshot.package.label).toBe('Carton composants');
    await expect(
      f.service.edit('t', 'u', 'p0', {
        operationKey: 'stale',
        expectedVersion: 1,
        label: '',
        contents,
      }),
    ).rejects.toThrow('modifié');
  });
  it('records physical loading, permits withdrawal before transit and preserves history', async () => {
    const f = fixture();
    await f.create();
    await f.service.transition('t', 'u', 'p0', {
      operationKey: 'load',
      expectedVersion: 1,
      expectedLoadId: 'l',
      expectedLoadUpdatedAt: f.load.updatedAt.toISOString(),
      target: S.LOADED,
    });
    expect(f.parcels[0]).toMatchObject({ status: S.LOADED, loadedLoadId: 'l', version: 2 });
    expect(f.events[1].snapshot.evidence.load).toMatchObject({ vehicleId: 'truck' });
    await expect(
      f.service.edit('t', 'u', 'p0', {
        operationKey: 'edit',
        expectedVersion: 2,
        label: '',
        contents,
      }),
    ).rejects.toThrow('chargé');
    await f.service.transition('t', 'u', 'p0', {
      operationKey: 'unload',
      expectedVersion: 2,
      expectedLoadId: 'l',
      expectedLoadUpdatedAt: f.load.updatedAt.toISOString(),
      target: S.PREPARED,
    });
    expect(f.parcels[0]).toMatchObject({ loadedLoadId: null, loadedAt: null, status: S.PREPARED });
    expect(f.events[1].snapshot.package.status).toBe(S.LOADED);
  });
  it('rejects delivery before loading and before transit', async () => {
    const f = fixture();
    await f.create();
    await expect(
      f.service.transition('t', 'u', 'p0', {
        operationKey: 'd',
        expectedVersion: 1,
        expectedLoadId: 'l',
        expectedLoadUpdatedAt: f.load.updatedAt.toISOString(),
        target: S.DELIVERED,
        recipientName: 'Lucie',
      }),
    ).rejects.toThrow('Transition');
    await f.service.transition('t', 'u', 'p0', {
      operationKey: 'l',
      expectedVersion: 1,
      expectedLoadId: 'l',
      expectedLoadUpdatedAt: f.load.updatedAt.toISOString(),
      target: S.LOADED,
    });
    await expect(
      f.service.transition('t', 'u', 'p0', {
        operationKey: 'd2',
        expectedVersion: 2,
        expectedLoadId: 'l',
        expectedLoadUpdatedAt: f.load.updatedAt.toISOString(),
        target: S.DELIVERED,
        recipientName: 'Lucie',
      }),
    ).rejects.toThrow('transit');
  });
  it('requires a recipient, guards route arrival and forbids in-transit withdrawal', async () => {
    const f = fixture();
    await f.create();
    await f.service.transition('t', 'u', 'p0', {
      operationKey: 'l',
      expectedVersion: 1,
      expectedLoadId: 'l',
      expectedLoadUpdatedAt: f.load.updatedAt.toISOString(),
      target: S.LOADED,
    });
    f.load.status = f.shipment.status = 'IN_TRANSIT';
    await expect(
      f.service.transition('t', 'u', 'p0', {
        operationKey: 'u',
        expectedVersion: 2,
        expectedLoadId: 'l',
        expectedLoadUpdatedAt: f.load.updatedAt.toISOString(),
        target: S.PREPARED,
      }),
    ).rejects.toThrow('avant transit');
    await expect(
      f.service.transition('t', 'u', 'p0', {
        operationKey: 'd',
        expectedVersion: 2,
        expectedLoadId: 'l',
        expectedLoadUpdatedAt: f.load.updatedAt.toISOString(),
        target: S.DELIVERED,
      }),
    ).rejects.toThrow('destinataire');
    f.load.route = {
      deliveryPlan: {},
      stops: [{ type: 'DELIVERY', shipmentId: 's', status: 'PENDING' }],
    };
    await expect(
      f.service.transition('t', 'u', 'p0', {
        operationKey: 'd',
        expectedVersion: 2,
        expectedLoadId: 'l',
        expectedLoadUpdatedAt: f.load.updatedAt.toISOString(),
        target: S.DELIVERED,
        recipientName: 'Lucie',
      }),
    ).rejects.toThrow('arrivée');
  });
  it('keeps a partially delivered shipment in transit, then delivers it separately', async () => {
    const f = fixture();
    await f.create();
    await f.create('second');
    for (const p of f.parcels)
      await f.service.transition('t', 'u', p.id, {
        operationKey: `l-${p.id}`,
        expectedVersion: 1,
        expectedLoadId: 'l',
        expectedLoadUpdatedAt: f.load.updatedAt.toISOString(),
        target: S.LOADED,
      });
    f.load.status = f.shipment.status = 'IN_TRANSIT';
    const dto = {
      operationKey: 'delivery',
      expectedVersion: 2,
      expectedLoadId: 'l',
      expectedLoadUpdatedAt: f.load.updatedAt.toISOString(),
      target: S.DELIVERED,
      recipientName: 'Lucie Fortin',
    };
    const first = await f.service.transition('t', 'u', 'p0', dto);
    expect(f.shipment.status).toBe('IN_TRANSIT');
    expect(f.tx.trackingEvent.create).not.toHaveBeenCalled();
    expect(await f.service.transition('t', 'u', 'p0', dto)).toEqual(first);
    await f.service.transition('t', 'u', 'p1', {
      ...dto,
      operationKey: 'last',
      expectedLoadUpdatedAt: f.load.updatedAt.toISOString(),
    });
    expect(f.shipment.status).toBe('DELIVERED');
    expect(f.load.status).toBe('IN_TRANSIT');
    expect(f.tx.trackingEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ tenantId: 't', shipmentId: 's', type: 'DELIVERED' }),
    });
    expect(f.orders.completeFromDelivery).toHaveBeenCalledWith('t', 'u', 'o');
  });
  it('revalidates a live driver capability even before replaying its receipt', async () => {
    const f = fixture();
    await f.create();
    const driver = {
      source: { kind: 'DRIVER_LINK' as const, linkFingerprint: 'hashed-link', loadId: 'l' },
      authorize: jest.fn(async () => undefined),
    };
    const dto = {
      operationKey: 'load-driver',
      expectedVersion: 1,
      expectedLoadId: 'l',
      expectedLoadUpdatedAt: f.load.updatedAt.toISOString(),
      target: S.LOADED,
    };
    const result = await f.service.transition('t', 'u', 'p0', dto, driver);
    expect(driver.authorize).toHaveBeenLastCalledWith(f.tx, false);
    expect(await f.service.transition('t', 'u', 'p0', dto, driver)).toEqual(result);
    expect(driver.authorize).toHaveBeenLastCalledWith(f.tx, true);
    driver.authorize.mockRejectedValue(new Error('revoked'));
    await expect(f.service.transition('t', 'u', 'p0', dto, driver)).rejects.toThrow('revoked');
    expect(f.events).toHaveLength(2);
    expect(f.events[1].snapshot.evidence.source).toEqual(driver.source);
    expect(f.audit.log).toHaveBeenLastCalledWith(
      expect.objectContaining({
        after: expect.objectContaining({ source: driver.source }),
      }),
      f.tx,
    );
  });
  it('records driver incidents exactly once without a package or shipment transition', async () => {
    const f = fixture();
    await f.create();
    const before = JSON.stringify({ p: f.parcels, s: f.shipment, l: f.load });
    const driver = {
      source: { kind: 'DRIVER_LINK' as const, linkFingerprint: 'hashed-link', loadId: 'l' },
      authorize: jest.fn(async () => undefined),
    };
    const dto = {
      operationKey: 'AABB1111-1111-4111-8111-111111111111',
      expectedVersion: 1,
      expectedLoadUpdatedAt: f.load.updatedAt.toISOString(),
      kind: 'DAMAGE' as const,
      note: 'Boîte abîmée',
    };
    const receipt = await f.service.driverException('t', 'u', 'p0', dto, driver);
    expect(
      await f.service.driverException(
        't',
        'u',
        'p0',
        { ...dto, operationKey: dto.operationKey.toLowerCase() },
        driver,
      ),
    ).toEqual(receipt);
    expect(JSON.stringify({ p: f.parcels, s: f.shipment, l: f.load })).toBe(before);
    expect(f.tx.trackingEvent.create).toHaveBeenCalledTimes(1);
    expect(f.events[1].kind).toBe('DRIVER_EXCEPTION');
    expect(driver.authorize).toHaveBeenLastCalledWith(f.tx, true);
    await expect(
      f.service.driverException('t', 'u', 'p0', { ...dto, note: 'Autre contenu' }, driver),
    ).rejects.toThrow('autre demande');
    expect(f.events).toHaveLength(2);
  });
  it('rejects stale or empty driver incident reports', async () => {
    const f = fixture();
    await f.create();
    const driver = {
      source: { kind: 'DRIVER_LINK' as const, linkFingerprint: 'hashed-link', loadId: 'l' },
      authorize: jest.fn(async () => undefined),
    };
    const dto = {
      operationKey: 'incident',
      expectedVersion: 99,
      expectedLoadUpdatedAt: f.load.updatedAt.toISOString(),
      kind: 'MISSING' as const,
      note: 'Absent',
    };
    await expect(f.service.driverException('t', 'u', 'p0', dto, driver)).rejects.toThrow('changé');
    await expect(
      f.service.driverException('t', 'u', 'p0', { ...dto, note: '  ' }, driver),
    ).rejects.toThrow('Décrivez');
    expect(f.events).toHaveLength(1);
    expect(f.tx.trackingEvent.create).not.toHaveBeenCalled();
  });
  it('does not bypass the tenant POD requirement for the final parcel', async () => {
    const f = fixture();
    await f.create();
    await f.service.transition('t', 'u', 'p0', {
      operationKey: 'l',
      expectedVersion: 1,
      expectedLoadId: 'l',
      expectedLoadUpdatedAt: f.load.updatedAt.toISOString(),
      target: S.LOADED,
    });
    f.load.status = f.shipment.status = 'IN_TRANSIT';
    f.settings.resolve.mockResolvedValue({ podRequiredBeforeCompletion: true });
    f.tx.proofOfDelivery.findFirst.mockResolvedValue(null);
    await expect(
      f.service.transition('t', 'u', 'p0', {
        operationKey: 'd',
        expectedVersion: 2,
        expectedLoadId: 'l',
        expectedLoadUpdatedAt: f.load.updatedAt.toISOString(),
        target: S.DELIVERED,
        recipientName: 'Lucie',
      }),
    ).rejects.toThrow('POD');
    expect(f.shipment.status).toBe('IN_TRANSIT');
    expect(f.events).toHaveLength(2);
  });
});
